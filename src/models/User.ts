import mongoose, { Document, Model } from "mongoose";

export interface UserDocument extends Document {
  fullName: string;
  username: string;
  email: string;
  passwordHash: string;
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
    passwordHash: { type: String, required: true, select: false },
  },
  { timestamps: true }
);

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ username: 1 }, { unique: true });

export const User: Model<UserDocument> = mongoose.model<UserDocument>(
  "User",
  userSchema
);
