import mongoose from "mongoose";

export const connectToDatabase = async () => {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri || mongoUri.includes("<db_password>")) {
    throw new Error(
      "MONGODB_URI is missing or still contains <db_password>. Add your Atlas password to backend/.env."
    );
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
  } catch (error) {
    throw new Error(
      `MongoDB connection failed. Check your Atlas URI, password, and Network Access settings. ${error instanceof Error ? error.message : "Unknown connection error"}`
    );
  }

  console.log("Connected to MongoDB");
};
