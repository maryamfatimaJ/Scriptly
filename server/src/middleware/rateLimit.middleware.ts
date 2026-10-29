import rateLimit from "express-rate-limit";
import { env } from "@/config/env";

// The integration test suite (tests/prescriptionWorkflow.test.ts) registers
// dozens of users in quick succession by design — real rate limiting would
// make the test suite flaky/order-dependent rather than actually testing
// anything. Skip it in test mode instead of inflating the real limits.
// Vitest sets NODE_ENV=test automatically; this is never true outside a
// test run.
const skipInTests = () => env.nodeEnv === "test";

// General API rate limit — generous, just a backstop against abuse.
export const apiRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMinutes * 60 * 1000,
  max: env.rateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: { code: "RATE_LIMITED", message: "Too many requests. Please slow down." } },
});

// Per-user limit on Scripty messages. Each one is a paid model call (often
// several, with tool rounds), so this bounds cost as well as abuse. Keyed
// on the authenticated user rather than IP: it runs after requireAuth,
// and a shared clinic or office network should not share one budget.
export const scriptyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: env.scriptyRateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  keyGenerator: (req) => `scripty:${req.user?.id ?? req.ip}`,
  message: {
    error: { code: "RATE_LIMITED", message: "You're sending messages to Scripty very quickly. Please wait a minute." },
  },
});

// Tighter limit for auth endpoints specifically, to slow down credential
// stuffing / brute-force attempts against login and registration.
export const authRateLimiter = rateLimit({
  windowMs: env.rateLimitWindowMinutes * 60 * 1000,
  max: env.authRateLimitMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTests,
  message: { error: { code: "RATE_LIMITED", message: "Too many attempts. Please try again later." } },
});
