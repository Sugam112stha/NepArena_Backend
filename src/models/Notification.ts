import mongoose, { Document, Model, Types } from "mongoose";

export interface NotificationDocument extends Document {
  user: Types.ObjectId;
  type: "team_created" | "team_updated" | "team_deleted" | "team_invite";
  message: string;
  read: boolean;
  team?: Types.ObjectId;
}

const notificationSchema = new mongoose.Schema<NotificationDocument>(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["team_created", "team_updated", "team_deleted", "team_invite"], required: true },
    message: { type: String, required: true, trim: true, maxlength: 240 },
    read: { type: Boolean, default: false },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team" },
  },
  { timestamps: true }
);

export const Notification: Model<NotificationDocument> = mongoose.model<NotificationDocument>("Notification", notificationSchema);
