import mongoose, { Document, Model, Types } from "mongoose";

export interface TournamentRegistrationDocument extends Document {
  owner: Types.ObjectId;
  team: Types.ObjectId;
  tournamentId: string;
  tournamentTitle: string;
  game: string;
  group: string;
  round: string;
}

const tournamentRegistrationSchema = new mongoose.Schema<TournamentRegistrationDocument>(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    team: { type: mongoose.Schema.Types.ObjectId, ref: "Team", required: true },
    tournamentId: { type: String, required: true, trim: true },
    tournamentTitle: { type: String, required: true, trim: true, maxlength: 120 },
    game: { type: String, required: true, trim: true },
    group: { type: String, required: true, enum: ["A", "B", "C", "D"] },
    round: { type: String, required: true, default: "Round 1" },
  },
  { timestamps: true }
);

tournamentRegistrationSchema.index({ tournamentId: 1, team: 1 }, { unique: true });

export const TournamentRegistration: Model<TournamentRegistrationDocument> = mongoose.model<TournamentRegistrationDocument>(
  "TournamentRegistration",
  tournamentRegistrationSchema
);