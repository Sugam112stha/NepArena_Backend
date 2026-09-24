import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { connectToDatabase } from "./config/db.js";
import authRoutes from "./routes/auth.js";

dotenv.config({ path: new URL("../.env", import.meta.url) });

const app = express();
const port = Number(process.env.PORT) || 5000;
const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";

app.use(cors({ origin: clientUrl, credentials: true }));
app.use(express.json());
app.use("/api/auth", authRoutes);

app.get("/api/health", (_request, response) => {
  response.json({
    success: true,
    message: "NepArena API is running",
  });
});

const startServer = async () => {
  await connectToDatabase();

  app.listen(port, () => {
    console.log(`NepArena API listening on http://localhost:${port}`);
  });
};

startServer().catch((error: unknown) => {
  console.error("Unable to start NepArena API", error);
  process.exit(1);
});
