import { Router } from "express";
import { Types } from "mongoose";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { Team } from "../models/Team.js";
import { User } from "../models/User.js";
import { Notification } from "../models/Notification.js";

const router = Router();

const createNotification = async (userId: string, type: "team_created" | "team_updated" | "team_deleted", message: string) => {
  try {
    await Notification.create({ user: userId, type, message });
  } catch (error) {
    console.error("Notification creation failed", error);
  }
};

router.get("/", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const teams = await Team.find({
      game: "Free Fire",
      $or: [{ owner: ownerId }, { "players.user": ownerId }],
    }).sort({ createdAt: -1 }).lean();
    response.json({ success: true, teams });
  } catch (error) {
    console.error("Team lookup failed", error);
    response.status(500).json({ success: false, message: "Unable to load your teams right now." });
  }
});

router.get("/mine", requireAuth, async (request, response) => {
  try {
    const userId = (request as AuthenticatedRequest).userId;
    const team = await Team.findOne({
      game: "Free Fire",
      $or: [{ owner: userId }, { "players.user": userId }],
    }).sort({ createdAt: -1 }).lean();
    response.json({ success: true, team: team || null });
  } catch (error) {
    console.error("My team lookup failed", error);
    response.status(500).json({ success: false, message: "Unable to load your team right now." });
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
      const requestedPlayers = players as Array<{ username?: unknown; ign?: unknown; inGameId?: unknown; role?: unknown }>;
      const usernames = requestedPlayers.map((player) => typeof player.username === "string" ? player.username.trim().toLowerCase() : "");
      if (requestedPlayers.length === 0 || requestedPlayers.length > 6 || usernames.some((username) => !username) || new Set(usernames).size !== usernames.length || requestedPlayers.some((player) => typeof player.inGameId !== "string" || !player.inGameId.trim() || (player.ign !== undefined && typeof player.ign !== "string"))) {
        response.status(400).json({ success: false, message: "Each player needs a unique username and Free Fire UID." });
        return;
      }
      const users = await User.find({ username: { $in: usernames } }).select("username");
      if (users.length !== usernames.length) {
        response.status(400).json({ success: false, message: "One or more invited usernames do not exist." });
        return;
      }
      const memberIds = users.map((user) => user._id);
      const anotherTeam = await Team.exists({ _id: { $ne: teamId }, "players.user": { $in: memberIds } });
      if (anotherTeam) {
        response.status(409).json({ success: false, message: "A player can belong to only one team. Remove players from their current team before adding them here." });
        return;
      }
      const userByUsername = new Map(users.map((user) => [user.username, user]));
      update.players = requestedPlayers.map((player, index) => ({
        user: userByUsername.get(usernames[index])!._id,
        username: usernames[index],
        ...(typeof player.ign === "string" ? { ign: player.ign.trim() } : {}),
        inGameId: String(player.inGameId).trim(),
        role: typeof player.role === "string" ? player.role : "Player",
      }));
    }

    const team = await Team.findOneAndUpdate({ _id: teamId, owner: ownerId }, update, { returnDocument: "after", runValidators: true }).lean();
    if (!team) {
      response.status(404).json({ success: false, message: "Team not found." });
      return;
    }
    response.json({ success: true, team });
    await createNotification(ownerId, "team_updated", `${team.name} was updated successfully.`);
  } catch (error) {
    console.error("Team update failed", error);
    response.status(500).json({ success: false, message: "Unable to update your team right now." });
  }
});

router.delete("/:teamId", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const teamIdParam = request.params.teamId;
    const teamId = typeof teamIdParam === "string" ? teamIdParam : "";
    if (!ownerId || !Types.ObjectId.isValid(teamId)) {
      response.status(400).json({ success: false, message: "Invalid team request." });
      return;
    }

    const team = await Team.findOneAndDelete({ _id: teamId, owner: ownerId }).lean();
    if (!team) {
      response.status(404).json({ success: false, message: "Team not found." });
      return;
    }

    await createNotification(ownerId, "team_deleted", `${team.name} was deleted.`);
    response.json({ success: true, teamId });
  } catch (error) {
    console.error("Team deletion failed", error);
    response.status(500).json({ success: false, message: "Unable to delete your team right now." });
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

    if (!ownerId || !Types.ObjectId.isValid(ownerId) || typeof name !== "string" || !name.trim() || typeof tag !== "string" || !tag.trim() || game !== "Free Fire" || !Array.isArray(players) || players.length === 0 || players.length > 6) {
      response.status(400).json({ success: false, message: "Complete team and roster details are required." });
      return;
    }

    const requestedPlayers = players as Array<{ playerId?: unknown; ign?: unknown; inGameId?: unknown; role?: unknown }>;
    const playerIds = requestedPlayers.map((player) => typeof player.playerId === "string" ? player.playerId.trim() : "");
    if (playerIds.some((playerId) => !/^\d{10}$/.test(playerId)) || new Set(playerIds).size !== playerIds.length || requestedPlayers.some((player) => typeof player.ign !== "string" || !player.ign.trim() || typeof player.inGameId !== "string" || !player.inGameId.trim())) {
      response.status(400).json({ success: false, message: "Each player needs a unique 10-digit Player ID, Free Fire IGN, and UID." });
      return;
    }

    const users = await User.find({ playerId: { $in: playerIds } }).select("playerId username");
    if (users.length !== playerIds.length) {
      response.status(400).json({ success: false, message: "One or more Player IDs do not belong to a NepArena user." });
      return;
    }

    const memberIds = users.map((user) => user._id);
    const existingMembership = await Team.exists({ "players.user": { $in: memberIds } });
    if (existingMembership) {
      response.status(409).json({ success: false, message: "A player in this roster already belongs to a team. Each player can join only one team." });
      return;
    }

    if (!users.some((user) => String(user._id) === ownerId)) {
      response.status(400).json({ success: false, message: "Your own account must be included as the team captain." });
      return;
    }

    const userByPlayerId = new Map(users.map((user) => [user.playerId, user]));
    const teamPlayers = requestedPlayers.map((player, index) => {
      const invitedUser = userByPlayerId.get(playerIds[index])!;
      return {
        user: invitedUser._id,
        username: invitedUser.username,
        ign: String(player.ign).trim(),
        inGameId: String(player.inGameId).trim(),
        role: typeof player.role === "string" ? player.role : "Player",
      };
    });

    const team = await Team.create({
      owner: ownerId,
      name: name.trim(),
      tag: tag.trim().toUpperCase(),
      game: "Free Fire",
      slogan: typeof slogan === "string" ? slogan.trim() : undefined,
      logo: typeof logo === "string" ? logo : undefined,
      players: teamPlayers,
    });

    response.status(201).json({ success: true, team: { id: team.id, name: team.name, tag: team.tag, game: team.game, players: team.players } });
    await createNotification(ownerId, "team_created", `${team.name} was created successfully.`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 11000) {
      response.status(409).json({ success: false, message: "A player in this roster already belongs to another team." });
      return;
    }
    console.error("Team creation failed", error);
    response.status(500).json({ success: false, message: "Unable to create the team right now." });
  }
});

export default router;
