import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === "replace-this-with-a-long-random-secret") {
    throw new Error("JWT_SECRET is missing or still uses the example value.");
  }
  return secret;
};

export const requireAuth = (
  request: AuthenticatedRequest,
  response: Response,
  next: NextFunction
) => {
  const authorization = request.headers.authorization;
  const token = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : "";

  if (!token) {
    response.status(401).json({ success: false, message: "Authentication required." });
    return;
  }

  try {
    const payload = jwt.verify(token, getJwtSecret()) as { sub?: string };
    if (!payload.sub) {
      response.status(401).json({ success: false, message: "Invalid authentication token." });
      return;
    }

    request.userId = payload.sub;
    next();
  } catch {
    response.status(401).json({ success: false, message: "Your session has expired. Please log in again." });
  }
};
