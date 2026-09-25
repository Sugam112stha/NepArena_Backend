import mongoose, { Document, Model, Types } from "mongoose";

export interface TeamPlayer {
  user: Types.ObjectId;
  username: string;
  inGameId: string;
  role: string;
}

export interface TeamDocument extends Document {
  owner: Types.ObjectId;
  name: string;
  tag: string;
  game: string;
  slogan?: string;
  logo?: string;
  players: TeamPlayer[];
}

const teamSchema = new mongoose.Schema<TeamDocument>(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true, trim: true, maxlength: 60 },
    tag: { type: String, required: true, trim: true, uppercase: true, maxlength: 4 },
    game: { type: String, required: true, trim: true },
    slogan: { type: String, trim: true, maxlength: 160 },
    logo: { type: String, maxlength: 2_000_000 },
    players: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        username: { type: String, required: true },
        inGameId: { type: String, required: true, trim: true },
        role: { type: String, required: true },
      },
    ],
  },
  { timestamps: true }
);

export const Team: Model<TeamDocument> = mongoose.model<TeamDocument>("Team", teamSchema);
