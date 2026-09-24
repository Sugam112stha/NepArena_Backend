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
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
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
