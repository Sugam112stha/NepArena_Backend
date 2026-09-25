import { Router } from "express";
import { Types } from "mongoose";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { Team } from "../models/Team.js";
import { User } from "../models/User.js";

const router = Router();

router.get("/", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const teams = await Team.find({ owner: ownerId }).sort({ createdAt: -1 }).lean();
    response.json({ success: true, teams });
  } catch (error) {
    console.error("Team lookup failed", error);
    response.status(500).json({ success: false, message: "Unable to load your teams right now." });
  }
});

router.patch("/:teamId", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const teamIdParam = request.params.teamId;
    const teamId = typeof teamIdParam === "string" ? teamIdParam : "";
    const { name, tag, slogan, players } = request.body as {
      name?: unknown;
      tag?: unknown;
      slogan?: unknown;
      players?: unknown;
    };

    if (!ownerId || !Types.ObjectId.isValid(teamId)) {
      response.status(400).json({ success: false, message: "Invalid team request." });
      return;
    }

    const update: Record<string, unknown> = {};
    if (typeof name === "string" && name.trim()) update.name = name.trim();
    if (typeof tag === "string" && tag.trim()) update.tag = tag.trim().toUpperCase();
    if (typeof slogan === "string") update.slogan = slogan.trim();

    if (Array.isArray(players)) {
      const requestedPlayers = players as Array<{ username?: unknown; inGameId?: unknown; role?: unknown }>;
      const usernames = requestedPlayers.map((player) => typeof player.username === "string" ? player.username.trim().toLowerCase() : "");
      if (requestedPlayers.length === 0 || requestedPlayers.length > 6 || usernames.some((username) => !username) || new Set(usernames).size !== usernames.length || requestedPlayers.some((player) => typeof player.inGameId !== "string" || !player.inGameId.trim())) {
        response.status(400).json({ success: false, message: "Each player needs a unique username and in-game ID." });
        return;
      }
      const users = await User.find({ username: { $in: usernames } }).select("username");
      if (users.length !== usernames.length) {
        response.status(400).json({ success: false, message: "One or more invited usernames do not exist." });
        return;
      }
      const userByUsername = new Map(users.map((user) => [user.username, user]));
      update.players = requestedPlayers.map((player, index) => ({
        user: userByUsername.get(usernames[index])!._id,
        username: usernames[index],
        inGameId: String(player.inGameId).trim(),
        role: typeof player.role === "string" ? player.role : "Player",
      }));
    }

    const team = await Team.findOneAndUpdate({ _id: teamId, owner: ownerId }, update, { new: true, runValidators: true }).lean();
    if (!team) {
      response.status(404).json({ success: false, message: "Team not found." });
      return;
    }
    response.json({ success: true, team });
  } catch (error) {
    console.error("Team update failed", error);
    response.status(500).json({ success: false, message: "Unable to update your team right now." });
  }
});

router.post("/", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const { name, tag, game, slogan, logo, players } = request.body as {
      name?: unknown;
      tag?: unknown;
      game?: unknown;
      slogan?: unknown;
      logo?: unknown;
      players?: unknown;
    };

    if (!ownerId || !Types.ObjectId.isValid(ownerId) || typeof name !== "string" || !name.trim() || typeof tag !== "string" || !tag.trim() || typeof game !== "string" || !game.trim() || !Array.isArray(players) || players.length === 0 || players.length > 6) {
      response.status(400).json({ success: false, message: "Complete team and roster details are required." });
      return;
    }

    const requestedPlayers = players as Array<{ username?: unknown; inGameId?: unknown; role?: unknown }>;
    const usernames = requestedPlayers.map((player) => typeof player.username === "string" ? player.username.trim().toLowerCase() : "");
    if (usernames.some((username) => !username) || new Set(usernames).size !== usernames.length || requestedPlayers.some((player) => typeof player.inGameId !== "string" || !player.inGameId.trim())) {
      response.status(400).json({ success: false, message: "Each player needs a unique username and in-game ID." });
      return;
    }

    const users = await User.find({ username: { $in: usernames } }).select("username");
    if (users.length !== usernames.length) {
      response.status(400).json({ success: false, message: "One or more invited usernames do not exist." });
      return;
    }

    const userByUsername = new Map(users.map((user) => [user.username, user]));
    const teamPlayers = requestedPlayers.map((player, index) => {
      const username = usernames[index];
      return {
        user: userByUsername.get(username)!._id,
        username,
        inGameId: String(player.inGameId).trim(),
        role: typeof player.role === "string" ? player.role : "Player",
      };
    });

    const team = await Team.create({
      owner: ownerId,
      name: name.trim(),
      tag: tag.trim().toUpperCase(),
      game: game.trim(),
      slogan: typeof slogan === "string" ? slogan.trim() : undefined,
      logo: typeof logo === "string" ? logo : undefined,
      players: teamPlayers,
    });

    response.status(201).json({ success: true, team: { id: team.id, name: team.name, tag: team.tag, game: team.game, players: team.players } });
  } catch (error) {
    console.error("Team creation failed", error);
    response.status(500).json({ success: false, message: "Unable to create the team right now." });
  }
});

export default router;
