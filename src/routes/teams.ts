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

const createInviteNotification = async (userId: string, teamId: string, message: string) => {
  try {
    await Notification.create({ user: userId, team: teamId, type: "team_invite", message });
  } catch (error) {
    console.error("Team invitation notification failed", error);
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
    }).sort({ createdAt: -1 }).populate("players.user", "playerId").select("owner name tag game slogan logo players pendingInvites").lean();
    response.json({ success: true, team: team || null });
  } catch (error) {
    console.error("My team lookup failed", error);
    response.status(500).json({ success: false, message: "Unable to load your team right now." });
  }
});

router.post("/:teamId/invitations/:notificationId/respond", requireAuth, async (request, response) => {
  try {
    const userId = (request as AuthenticatedRequest).userId;
    const { decision } = request.body as { decision?: unknown };
    const teamIdParam = request.params.teamId;
    const notificationIdParam = request.params.notificationId;
    const teamId = typeof teamIdParam === "string" ? teamIdParam : "";
    const notificationId = typeof notificationIdParam === "string" ? notificationIdParam : "";

    if (!userId || !Types.ObjectId.isValid(teamId) || !Types.ObjectId.isValid(notificationId) || (decision !== "accept" && decision !== "reject")) {
      response.status(400).json({ success: false, message: "Invalid invitation response." });
      return;
    }

    const inviteNotification = await Notification.findOne({
      _id: notificationId,
      user: userId,
      team: teamId,
      type: "team_invite",
    });
    if (!inviteNotification) {
      response.status(404).json({ success: false, message: "Invitation not found or already handled." });
      return;
    }

    if (decision === "reject") {
      const team = await Team.findOneAndUpdate(
        { _id: teamId, "pendingInvites.user": userId },
        { $pull: { pendingInvites: { user: userId } } },
        { returnDocument: "after" }
      ).lean();
      if (!team) {
        await inviteNotification.deleteOne();
        response.status(404).json({ success: false, message: "This team invitation is no longer active." });
        return;
      }
      await Notification.deleteMany({ user: userId, team: teamId, type: "team_invite" });
      response.json({ success: true, decision: "reject", message: "Team invitation declined." });
      return;
    }

    const team = await Team.findOne({ _id: teamId, "pendingInvites.user": userId });
    if (!team) {
      await Notification.deleteMany({ user: userId, team: teamId, type: "team_invite" });
      response.status(404).json({ success: false, message: "This team invitation is no longer active." });
      return;
    }
    if (team.players.some((player) => String(player.user) === userId)) {
      response.status(409).json({ success: false, message: "You are already a member of this team." });
      return;
    }
    const otherMembership = await Team.exists({ "players.user": userId });
    if (otherMembership) {
      response.status(409).json({ success: false, message: "You already belong to another team. Leave that team before accepting this invitation." });
      return;
    }
    if (team.players.length >= 6) {
      response.status(409).json({ success: false, message: "This team roster is full." });
      return;
    }

    const invite = team.pendingInvites.find((pendingInvite) => String(pendingInvite.user) === userId);
    if (!invite) {
      response.status(404).json({ success: false, message: "This team invitation is no longer active." });
      return;
    }
    team.players.push({
      user: invite.user,
      username: invite.username,
      ign: invite.ign,
      inGameId: invite.inGameId,
      role: invite.role,
    });
    team.pendingInvites = team.pendingInvites.filter((pendingInvite) => String(pendingInvite.user) !== userId);
    await team.save();
    await Notification.deleteMany({ user: userId, team: teamId, type: "team_invite" });
    await createNotification(String(team.owner), "team_updated", `${invite.username} accepted the invitation to ${team.name}.`);
    response.json({ success: true, decision: "accept", message: `You joined ${team.name}.` });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 11000) {
      response.status(409).json({ success: false, message: "You already belong to another team." });
      return;
    }
    console.error("Team invitation response failed", error);
    response.status(500).json({ success: false, message: "Unable to respond to this invitation right now." });
  }
});

router.post("/:teamId/invitations", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const teamIdParam = request.params.teamId;
    const teamId = typeof teamIdParam === "string" ? teamIdParam : "";
    const { playerId, ign, inGameId, role } = request.body as {
      playerId?: unknown;
      ign?: unknown;
      inGameId?: unknown;
      role?: unknown;
    };

    if (!ownerId || !Types.ObjectId.isValid(teamId) || typeof playerId !== "string" || !/^\d{10}$/.test(playerId.trim()) || typeof ign !== "string" || !ign.trim() || typeof inGameId !== "string" || !inGameId.trim()) {
      response.status(400).json({ success: false, message: "Enter a valid Player ID, Free Fire IGN, and UID." });
      return;
    }

    const team = await Team.findOne({ _id: teamId, owner: ownerId });
    if (!team) {
      response.status(403).json({ success: false, message: "Only the team leader can invite players." });
      return;
    }
    if (team.players.length + team.pendingInvites.length >= 6) {
      response.status(409).json({ success: false, message: "The team roster and pending invitations already fill all 6 spots." });
      return;
    }

    const invitedUser = await User.findOne({ playerId: playerId.trim() }).select("_id username playerId");
    if (!invitedUser) {
      response.status(404).json({ success: false, message: "No NepArena player found with that Player ID." });
      return;
    }
    if (String(invitedUser._id) === ownerId) {
      response.status(400).json({ success: false, message: "You are already the team leader." });
      return;
    }
    if (team.players.some((player) => String(player.user) === String(invitedUser._id))) {
      response.status(409).json({ success: false, message: "That player is already on this team." });
      return;
    }
    if (team.pendingInvites.some((invite) => String(invite.user) === String(invitedUser._id))) {
      response.status(409).json({ success: false, message: "That player already has a pending invitation." });
      return;
    }
    const existingMembership = await Team.exists({ "players.user": invitedUser._id });
    if (existingMembership) {
      response.status(409).json({ success: false, message: "That player already belongs to a team." });
      return;
    }

    const invitation = {
      user: invitedUser._id,
      username: invitedUser.username,
      ign: ign.trim(),
      inGameId: inGameId.trim(),
      role: typeof role === "string" && role.trim() ? role.trim() : "Player",
      invitedBy: new Types.ObjectId(ownerId),
      createdAt: new Date(),
    };
    team.pendingInvites.push(invitation);
    await team.save();
    await createInviteNotification(
      String(invitedUser._id),
      team.id,
      `${team.name} [${team.tag}] invited you to join as ${invitation.role}.`
    );
    response.status(201).json({ success: true, message: `Invitation sent to @${invitedUser.username}.` });
  } catch (error) {
    console.error("Team invitation creation failed", error);
    response.status(500).json({ success: false, message: "Unable to send the team invitation right now." });
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

router.delete("/:teamId/members/me", requireAuth, async (request, response) => {
  try {
    const userId = (request as AuthenticatedRequest).userId;
    const teamIdParam = request.params.teamId;
    const teamId = typeof teamIdParam === "string" ? teamIdParam : "";
    if (!userId || !Types.ObjectId.isValid(teamId)) {
      response.status(400).json({ success: false, message: "Invalid team request." });
      return;
    }

    const team = await Team.findOne({ _id: teamId, "players.user": userId }).lean();
    if (!team) {
      response.status(404).json({ success: false, message: "You are not a member of this team." });
      return;
    }

    const remainingPlayers = team.players.filter((player) => String(player.user) !== userId);
    if (remainingPlayers.length === 0) {
      await Team.findOneAndDelete({ _id: teamId, "players.user": userId });
      response.json({ success: true, teamDeleted: true, message: "You left the team. The empty team was closed." });
      return;
    }

    const update: { players: typeof remainingPlayers; owner?: Types.ObjectId } = { players: remainingPlayers };
    if (String(team.owner) === userId) {
      update.owner = remainingPlayers[0].user;
      remainingPlayers[0].role = "Captain";
    }

    const updatedTeam = await Team.findOneAndUpdate(
      { _id: teamId, "players.user": userId },
      { $set: update },
      { returnDocument: "after", runValidators: true }
    ).lean();
    if (!updatedTeam) {
      response.status(409).json({ success: false, message: "Team membership changed. Refresh and try again." });
      return;
    }

    response.json({ success: true, team: updatedTeam, message: String(team.owner) === userId ? "You left the team and leadership was transferred." : "You left the team." });
  } catch (error) {
    console.error("Team leave failed", error);
    response.status(500).json({ success: false, message: "Unable to leave the team right now." });
  }
});

router.delete("/:teamId/members/:playerId", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const teamIdParam = request.params.teamId;
    const playerIdParam = request.params.playerId;
    const teamId = typeof teamIdParam === "string" ? teamIdParam : "";
    const playerId = typeof playerIdParam === "string" ? playerIdParam.trim() : "";
    if (!ownerId || !Types.ObjectId.isValid(teamId) || !/^\d{10}$/.test(playerId)) {
      response.status(400).json({ success: false, message: "Invalid team or player ID." });
      return;
    }

    const team = await Team.findOne({ _id: teamId, owner: ownerId }).lean();
    if (!team) {
      response.status(403).json({ success: false, message: "Only the team leader can kick players." });
      return;
    }

    const targetUser = await User.findOne({ playerId }).select("_id username").lean();
    if (!targetUser) {
      response.status(404).json({ success: false, message: "Player not found." });
      return;
    }
    if (String(targetUser._id) === ownerId) {
      response.status(400).json({ success: false, message: "Use Leave Team to leave your own team." });
      return;
    }

    const updatedTeam = await Team.findOneAndUpdate(
      { _id: teamId, owner: ownerId, "players.user": targetUser._id },
      { $pull: { players: { user: targetUser._id } } },
      { returnDocument: "after", runValidators: true }
    ).lean();
    if (!updatedTeam) {
      response.status(404).json({ success: false, message: "That player is not a member of this team." });
      return;
    }

    response.json({ success: true, team: updatedTeam, message: `${targetUser.username} was removed from the team.` });
  } catch (error) {
    console.error("Team member removal failed", error);
    response.status(500).json({ success: false, message: "Unable to remove that player right now." });
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

    const inviter = users.find((user) => String(user._id) === ownerId);
    if (!inviter) {
      response.status(400).json({ success: false, message: "Your own account must be included as the team captain." });
      return;
    }

    const inviteeIds = users.filter((user) => String(user._id) !== ownerId).map((user) => user._id);
    const existingMembership = await Team.exists({ "players.user": { $in: inviteeIds } });
    if (existingMembership) {
      response.status(409).json({ success: false, message: "A player you invited already belongs to a team and cannot receive another team invitation." });
      return;
    }

    const userByPlayerId = new Map(users.map((user) => [user.playerId, user]));
    const captainInputIndex = playerIds.findIndex((playerId) => userByPlayerId.get(playerId)?._id.toString() === ownerId);
    const captainInput = requestedPlayers[captainInputIndex];
    const teamPlayers = [{
      user: inviter._id,
      username: inviter.username,
      ign: String(captainInput.ign).trim(),
      inGameId: String(captainInput.inGameId).trim(),
      role: "Captain",
    }];
    const pendingInvites = requestedPlayers.flatMap((player, index) => {
      const invitedUser = userByPlayerId.get(playerIds[index])!;
      if (String(invitedUser._id) === ownerId) return [];
      return [{
        user: invitedUser._id,
        username: invitedUser.username,
        ign: String(player.ign).trim(),
        inGameId: String(player.inGameId).trim(),
        role: typeof player.role === "string" ? player.role : "Player",
        invitedBy: inviter._id,
        createdAt: new Date(),
      }];
    });

    const team = await Team.create({
      owner: ownerId,
      name: name.trim(),
      tag: tag.trim().toUpperCase(),
      game: "Free Fire",
      slogan: typeof slogan === "string" ? slogan.trim() : undefined,
      logo: typeof logo === "string" ? logo : undefined,
      players: teamPlayers,
      pendingInvites,
    });

    response.status(201).json({ success: true, team: { id: team.id, name: team.name, tag: team.tag, game: team.game, players: team.players } });
    await createNotification(ownerId, "team_created", `${team.name} was created successfully.`);
    await Promise.all(pendingInvites.map((invite) => createInviteNotification(
      String(invite.user),
      team.id,
      `${inviter.username} invited you to join ${team.name} [${team.tag}].`
    )));
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
