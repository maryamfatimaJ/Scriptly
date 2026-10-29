import type { Request } from "express";
import { doubleCsrf } from "csrf-csrf";
import { env, isProduction } from "@/config/env";

// Double-submit-cookie CSRF protection. Because auth uses httpOnly cookies
// (not an Authorization header), the browser will attach the session
// cookie to any cross-site request automatically — CSRF tokens are the
// mitigation for state-changing requests (POST/PATCH/DELETE).
//
// Flow: GET /api/auth/csrf-token returns a token (also set as a readable,
// non-httpOnly cookie); the frontend echoes it back in the
// `x-csrf-token` header on every mutating request.
const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => env.csrfSecret,
  cookieName: isProduction ? "__Host-csrf" : "csrf_token",
  cookieOptions: {
    httpOnly: false, // must be readable by the frontend to echo back in the header
    sameSite: "lax",
    secure: env.cookieSecure,
    path: "/",
  },
  getTokenFromRequest: (req: Request) => req.headers["x-csrf-token"],
});

export const csrfProtection = doubleCsrfProtection;
export const generateCsrfToken = generateToken;
