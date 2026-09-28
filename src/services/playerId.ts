import { randomInt } from "node:crypto";
import { User } from "../models/User.js";

const generatePlayerId = () => String(randomInt(1_000_000_000, 10_000_000_000));

const isPlayerIdCollision = (error: unknown) =>
  typeof error === "object" && error !== null && "code" in error && error.code === 11000 &&
  "keyPattern" in error && typeof error.keyPattern === "object" && error.keyPattern !== null &&
  "playerId" in error.keyPattern;

export const createUserWithPlayerId = async (userData: Record<string, unknown>) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      return await User.create({ ...userData, playerId: generatePlayerId() });
    } catch (error) {
      if (!isPlayerIdCollision(error) || attempt === 4) throw error;
    }
  }
  throw new Error("Unable to assign a unique player ID.");
};

export const ensureAllPlayerIds = async () => {
  await User.collection.createIndex({ playerId: 1 }, { unique: true, sparse: true });
  const usersWithoutIds = await User.find({ $or: [{ playerId: { $exists: false } }, { playerId: null }] })
    .select("_id")
    .lean();

  for (const user of usersWithoutIds) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const result = await User.updateOne(
          { _id: user._id, $or: [{ playerId: { $exists: false } }, { playerId: null }] },
          { $set: { playerId: generatePlayerId() } }
        );
        if (result.modifiedCount > 0) break;
      } catch (error) {
        if (!isPlayerIdCollision(error) || attempt === 4) throw error;
      }
    }
  }
};