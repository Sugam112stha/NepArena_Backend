import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { Notification } from "../models/Notification.js";

const router = Router();

router.get("/", requireAuth, async (request, response) => {
  try {
    const userId = (request as AuthenticatedRequest).userId;
    const notifications = await Notification.find({ user: userId }).sort({ createdAt: -1 }).limit(30).lean();
    response.json({ success: true, notifications });
  } catch (error) {
    console.error("Notification lookup failed", error);
    response.status(500).json({ success: false, message: "Unable to load notifications." });
  }
});

router.patch("/read", requireAuth, async (request, response) => {
  try {
    const userId = (request as AuthenticatedRequest).userId;
    await Notification.updateMany({ user: userId, read: false }, { $set: { read: true } });
    response.json({ success: true });
  } catch (error) {
    console.error("Notification update failed", error);
    response.status(500).json({ success: false, message: "Unable to update notifications." });
  }
});

export default router;
