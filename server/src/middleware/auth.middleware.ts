import type { NextFunction, Request, Response } from "express";
import { AppError } from "@/utils/AppError";
import { verifyAccessToken } from "@/utils/tokens";

const ACCESS_COOKIE_NAME = "access_token";

// Reads the httpOnly access-token cookie, verifies it, and attaches the
// authenticated user's id/email to req.user. Every route that touches
// user-owned data (prescriptions, medications, schedules, reminders) must
// sit behind this middleware so ownership checks downstream have a
// trustworthy req.user to compare against.
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[ACCESS_COOKIE_NAME];

  if (!token) {
    return next(AppError.unauthorized());
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    next(AppError.unauthorized("Session expired or invalid"));
  }
}

export { ACCESS_COOKIE_NAME };
