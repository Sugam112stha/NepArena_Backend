import { Router } from "express";
import { Types } from "mongoose";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { Team } from "../models/Team.js";
import { TournamentRegistration } from "../models/TournamentRegistration.js";

const router = Router();
const GROUPS = ["A", "B", "C", "D"];

router.get("/", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const registrations = await TournamentRegistration.find({ owner: ownerId })
      .populate("team", "name tag game")
      .sort({ createdAt: -1 })
      .lean();
    response.json({ success: true, registrations });
  } catch (error) {
    console.error("Tournament registration lookup failed", error);
    response.status(500).json({ success: false, message: "Unable to load your matches right now." });
  }
});

router.post("/", requireAuth, async (request, response) => {
  try {
    const ownerId = (request as AuthenticatedRequest).userId;
    const { tournamentId, tournamentTitle, game, teamId } = request.body as {
      tournamentId?: unknown;
      tournamentTitle?: unknown;
      game?: unknown;
      teamId?: unknown;
    };

    if (!ownerId || !Types.ObjectId.isValid(ownerId) || typeof tournamentId !== "string" || !tournamentId.trim() || typeof tournamentTitle !== "string" || !tournamentTitle.trim() || game !== "Free Fire" || typeof teamId !== "string" || !Types.ObjectId.isValid(teamId)) {
      response.status(400).json({ success: false, message: "Choose a tournament and one of your teams to register." });
      return;
    }

    const team = await Team.findOne({ _id: teamId, owner: ownerId }).select("name tag game").lean();
    if (!team) {
      response.status(404).json({ success: false, message: "That team was not found in your account." });
      return;
    }
    if (team.game !== "Free Fire") {
      response.status(400).json({ success: false, message: "Only Free Fire teams can be registered." });
      return;
    }

    const existingRegistration = await TournamentRegistration.exists({ tournamentId: tournamentId.trim(), team: team._id });
    if (existingRegistration) {
      response.status(409).json({ success: false, message: "This team is already registered for that tournament." });
      return;
    }

    const existingGroups = await TournamentRegistration.find({ tournamentId: tournamentId.trim() }).select("group").lean();
    const groupCounts = GROUPS.map((group) => ({
      group,
      count: existingGroups.filter((registration) => registration.group === group).length,
    }));
    const assignedGroup = groupCounts.reduce((leastPopulated, current) => current.count < leastPopulated.count ? current : leastPopulated).group;

    const registration = await TournamentRegistration.create({
      owner: ownerId,
      team: team._id,
      tournamentId: tournamentId.trim(),
      tournamentTitle: tournamentTitle.trim(),
      game: "Free Fire",
      group: assignedGroup,
      round: "Round 1",
    });

    response.status(201).json({
      success: true,
      registration: {
        id: registration.id,
        group: registration.group,
        round: registration.round,
        team: { name: team.name, tag: team.tag },
      },
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === 11000) {
      response.status(409).json({ success: false, message: "This team is already registered for that tournament." });
      return;
    }
    console.error("Tournament registration failed", error);
    response.status(500).json({ success: false, message: "Unable to register your team right now." });
  }
});

export default router;