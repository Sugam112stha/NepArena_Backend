import mongoose, { Document, Model, Types } from "mongoose";

export interface NotificationDocument extends Document {
  user: Types.ObjectId;
  type: "team_created" | "team_updated" | "team_deleted";
  message: string;
  read: boolean;
}

const notificationSchema = new mongoose.Schema<NotificationDocument>(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["team_created", "team_updated", "team_deleted"], required: true },
    message: { type: String, required: true, trim: true, maxlength: 240 },
    read: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const Notification: Model<NotificationDocument> = mongoose.model<NotificationDocument>("Notification", notificationSchema);
