import mongoose, { Document, Model } from "mongoose";

export interface UserDocument extends Document {
  fullName: string;
  username: string;
  email: string;
  profilePicture?: string;
  gameProfiles: Array<{ game: string; ign: string; uid: string }>;
  passwordHash?: string;
  authProvider: "local" | "google" | "discord";
  providerId?: string;
}

const userSchema = new mongoose.Schema<UserDocument>(
  {
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    username: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      minlength: 3,
      maxlength: 30,
      match: /^[a-zA-Z0-9_]+$/,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    profilePicture: { type: String, maxlength: 2_100_000 },
    gameProfiles: {
      type: [
        {
          game: { type: String, required: true },
          ign: { type: String, trim: true, maxlength: 50 },
          uid: { type: String, trim: true, maxlength: 80 },
        },
      ],
      default: [],
    },
    passwordHash: { type: String, required: false, select: false },
    authProvider: {
      type: String,
      enum: ["local", "google", "discord"],
      default: "local",
      required: true,
    },
    providerId: { type: String, required: false },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });
userSchema.index(
  { authProvider: 1, providerId: 1 },
  { unique: true, partialFilterExpression: { providerId: { $exists: true } } }
);

export const User: Model<UserDocument> = mongoose.model<UserDocument>(
  "User",
  userSchema
);
