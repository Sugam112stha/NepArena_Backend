import bcrypt from "bcryptjs";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

const router = Router();
const passwordMinimumLength = 8;

type AuthRequest = {
  fullName?: unknown;
  username?: unknown;
  email?: unknown;
  password?: unknown;
};

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "replace-this-with-a-long-random-secret") {
    throw new Error("JWT_SECRET is missing or still uses the example value.");
  }
  return secret;
};

const toPublicUser = (user: { id: string; fullName: string; username: string; email: string }) => ({
  id: user.id,
  fullName: user.fullName,
  username: user.username,
  email: user.email,
});

const createToken = (userId: string) =>
  jwt.sign({ sub: userId }, getJwtSecret(), { expiresIn: "7d" });

const getClientUrl = () => process.env.CLIENT_URL || "http://localhost:5173";

const getOAuthConfig = (provider: "google" | "discord") => {
  if (provider === "google") {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;
    return {
      clientId,
      clientSecret,
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userUrl: "https://openidconnect.googleapis.com/v1/userinfo",
      scope: "openid email profile",
    };
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    authorizeUrl: "https://discord.com/oauth2/authorize",
    tokenUrl: "https://discord.com/api/oauth2/token",
    userUrl: "https://discord.com/api/users/@me",
    scope: "identify email",
  };
};

const callbackUrl = (provider: "google" | "discord") =>
  `${process.env.API_URL || "http://localhost:5001"}/api/auth/${provider}/callback`;

router.get("/:provider", (request, response) => {
  const provider = request.params.provider as "google" | "discord";
  if (provider !== "google" && provider !== "discord") {
    response.status(404).send("Unsupported authentication provider");
    return;
  }

  const config = getOAuthConfig(provider);
  if (!config) {
    const message = `${provider === "discord" ? "Discord" : "Google"} login is not configured. Add the provider credentials to backend/.env.`;
    response.redirect(`${getClientUrl()}/login?oauthError=${encodeURIComponent(message)}`);
    return;
  }

  const state = jwt.sign({ provider }, getJwtSecret(), { expiresIn: "10m" });
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: callbackUrl(provider),
    response_type: "code",
    scope: config.scope,
    state,
  });
  if (provider === "google") params.set("access_type", "offline");

  response.redirect(`${config.authorizeUrl}?${params.toString()}`);
});

router.get("/:provider/callback", async (request, response) => {
  const provider = request.params.provider as "google" | "discord";
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const state = typeof request.query.state === "string" ? request.query.state : "";
  const frontendError = `${getClientUrl()}/login?oauthError=Authentication%20was%20cancelled`;

  try {
    if (provider !== "google" && provider !== "discord" || !code || !state) {
      response.redirect(frontendError);
      return;
    }

    const statePayload = jwt.verify(state, getJwtSecret()) as { provider?: string };
    if (statePayload.provider !== provider) {
      response.redirect(frontendError);
      return;
    }

    const config = getOAuthConfig(provider);
    if (!config) {
      response.redirect(`${getClientUrl()}/login?oauthError=${provider}%20authentication%20is%20not%20configured`);
      return;
    }

    const tokenResponse = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: callbackUrl(provider),
      }),
    });
    const tokenData = (await tokenResponse.json()) as { access_token?: string };
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error("OAuth token exchange failed");

    const profileResponse = await fetch(config.userUrl, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profile = (await profileResponse.json()) as {
      sub?: string;
      id?: string;
      email?: string;
      name?: string;
      global_name?: string;
      username?: string;
    };
    const providerId = provider === "google" ? profile.sub : profile.id;
    const email = profile.email?.trim().toLowerCase();
    if (!profileResponse.ok || !providerId || !email) {
      throw new Error("The provider did not return a usable email address");
    }

    let user = await User.findOne({
      $or: [{ authProvider: provider, providerId }, { email }],
    });
    if (!user) {
      const baseUsername = (provider === "google" ? email.split("@")[0] : profile.username || `user_${providerId}`).replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24) || "player";
      let username = baseUsername.toLowerCase();
      let suffix = 1;
      while (await User.exists({ username })) username = `${baseUsername.slice(0, 20)}${suffix++}`.toLowerCase();
      user = await User.create({
        fullName: profile.name || profile.global_name || username,
        username,
        email,
        authProvider: provider,
        providerId,
      });
    } else if (!user.providerId) {
      user.authProvider = provider;
      user.providerId = providerId;
      await user.save();
    }

    const token = createToken(user.id);
    const userData = encodeURIComponent(JSON.stringify(toPublicUser(user)));
    response.redirect(`${getClientUrl()}/auth/callback?token=${encodeURIComponent(token)}&user=${userData}`);
  } catch (error) {
    console.error(`${provider} OAuth callback failed`, error);
    response.redirect(`${getClientUrl()}/login?oauthError=Social%20login%20could%20not%20be%20completed`);
  }
});

router.post("/signup", async (request, response) => {
  try {
    const { fullName, username, email, password } = request.body as AuthRequest;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedUsername = typeof username === "string" ? username.trim().toLowerCase() : "";

    if (
      typeof fullName !== "string" || !fullName.trim() ||
      !normalizedUsername || !/^[a-z0-9_]+$/.test(normalizedUsername) ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      typeof password !== "string" || password.length < passwordMinimumLength
    ) {
      response.status(400).json({ success: false, message: "Please provide valid account details." });
      return;
    }

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { username: normalizedUsername }],
    }).lean();

    if (existingUser) {
      const message = existingUser.email === normalizedEmail
        ? "An account with this email already exists."
        : "That username is already taken.";
      response.status(409).json({ success: false, message });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      fullName: fullName.trim(),
      username: normalizedUsername,
      email: normalizedEmail,
      passwordHash,
    });

    response.status(201).json({
      success: true,
      user: toPublicUser(user),
      token: createToken(user.id),
    });
  } catch (error) {
    console.error("Signup failed", error);
    response.status(500).json({ success: false, message: "Unable to create your account right now." });
  }
});

router.post("/login", async (request, response) => {
  try {
    const { email, password } = request.body as AuthRequest;
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!normalizedEmail || typeof password !== "string" || !password) {
      response.status(400).json({ success: false, message: "Email and password are required." });
      return;
    }

    const user = await User.findOne({ email: normalizedEmail }).select("+passwordHash");
    if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      response.status(401).json({ success: false, message: "Invalid email or password." });
      return;
    }

    response.json({
      success: true,
      user: toPublicUser(user),
      token: createToken(user.id),
    });
  } catch (error) {
    console.error("Login failed", error);
    response.status(500).json({ success: false, message: "Unable to log in right now." });
  }
});

export default router;
