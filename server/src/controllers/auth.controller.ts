import type { Request, Response } from "express";
import { asyncHandler } from "@/utils/asyncHandler";
import { AppError } from "@/utils/AppError";
import * as authService from "@/services/auth.service";
import { env } from "@/config/env";
import { ACCESS_COOKIE_NAME } from "@/middleware/auth.middleware";
import { generateCsrfToken } from "@/middleware/csrf.middleware";

const REFRESH_COOKIE_NAME = "refresh_token";

const accessCookieOptions = {
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: "lax" as const,
  domain: env.cookieDomain,
  maxAge: env.accessTokenTtlMinutes * 60 * 1000,
  path: "/",
};

const refreshCookieOptions = {
  httpOnly: true,
  secure: env.cookieSecure,
  sameSite: "lax" as const,
  domain: env.cookieDomain,
  maxAge: env.refreshTokenTtlDays * 24 * 60 * 60 * 1000,
  path: "/api/auth",
};

function setAuthCookies(res: Response, accessToken: string, refreshToken: string) {
  res.cookie(ACCESS_COOKIE_NAME, accessToken, accessCookieOptions);
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);
}

function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE_NAME, { path: "/" });
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
}

function sessionContext(req: Request) {
  return { userAgent: req.headers["user-agent"], ipAddress: req.ip };
}

export const register = asyncHandler(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await authService.register(req.body, sessionContext(req));
  setAuthCookies(res, accessToken, refreshToken);
  res.status(201).json({ user });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const { user, accessToken, refreshToken } = await authService.login(req.body, sessionContext(req));
  setAuthCookies(res, accessToken, refreshToken);
  res.status(200).json({ user });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const existingRefresh = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!existingRefresh) throw AppError.unauthorized();
  const { user, accessToken, refreshToken } = await authService.refreshSession(existingRefresh, sessionContext(req));
  setAuthCookies(res, accessToken, refreshToken);
  res.status(200).json({ user });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.cookies?.[REFRESH_COOKIE_NAME]);
  clearAuthCookies(res);
  res.status(204).send();
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const accessToken = req.cookies?.[ACCESS_COOKIE_NAME];
  if (!accessToken) throw AppError.unauthorized();
  const user = await authService.getCurrentUser(accessToken);
  res.status(200).json({ user });
});

export const updateMe = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.updateProfile(req.user!.id, req.body);
  res.status(200).json({ user });
});

// Issues a CSRF token the frontend must echo back (x-csrf-token header) on
// every mutating request. Call this once on app load / before showing any
// form that submits a POST/PATCH/DELETE.
export const csrfToken = asyncHandler(async (req: Request, res: Response) => {
  const token = generateCsrfToken(req, res);
  res.status(200).json({ csrfToken: token });
});
