import { prisma } from "@/db/prisma";
import { AppError } from "@/utils/AppError";
import { hashPassword, verifyPassword } from "@/utils/password";
import {
  generateRefreshToken,
  hashRefreshToken,
  refreshTokenExpiry,
  signAccessToken,
  verifyAccessToken,
} from "@/utils/tokens";
import type { RegisterInput, LoginInput, UpdateProfileInput } from "@/validation/auth.schema";

interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

async function issueSession(userId: string, email: string, ctx: SessionContext) {
  const accessToken = signAccessToken({ sub: userId, email });
  const refreshToken = generateRefreshToken();

  await prisma.session.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      userAgent: ctx.userAgent,
      ipAddress: ctx.ipAddress,
      expiresAt: refreshTokenExpiry(),
    },
  });

  return { accessToken, refreshToken };
}

export async function register(input: RegisterInput, ctx: SessionContext) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) {
    throw AppError.conflict("An account with this email already exists.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash, fullName: input.fullName, timezone: input.timezone ?? "UTC" },
  });

  const tokens = await issueSession(user.id, user.email, ctx);
  return { user: toPublicUser(user), ...tokens };
}

export async function login(input: LoginInput, ctx: SessionContext) {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  if (!user) {
    throw AppError.unauthorized("Invalid email or password.");
  }

  const valid = await verifyPassword(input.password, user.passwordHash);
  if (!valid) {
    throw AppError.unauthorized("Invalid email or password.");
  }

  const tokens = await issueSession(user.id, user.email, ctx);
  return { user: toPublicUser(user), ...tokens };
}

export async function refreshSession(refreshToken: string, ctx: SessionContext) {
  const tokenHash = hashRefreshToken(refreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: tokenHash } });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw AppError.unauthorized("Session expired. Please sign in again.");
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) {
    throw AppError.unauthorized("Session expired. Please sign in again.");
  }

  // Rotate: revoke the used refresh token and issue a new one, so a stolen
  // (but already-used) refresh token cannot be replayed indefinitely.
  await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
  const tokens = await issueSession(user.id, user.email, ctx);

  return { user: toPublicUser(user), ...tokens };
}

export async function logout(refreshToken: string | undefined) {
  if (!refreshToken) return;
  const tokenHash = hashRefreshToken(refreshToken);
  await prisma.session.updateMany({
    where: { refreshTokenHash: tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getCurrentUser(accessToken: string) {
  const payload = verifyAccessToken(accessToken);
  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user) {
    throw AppError.unauthorized();
  }
  return toPublicUser(user);
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await prisma.user.update({
    where: { id: userId },
    data: { fullName: input.fullName, timezone: input.timezone },
  });
  return toPublicUser(user);
}

function toPublicUser(user: { id: string; email: string; fullName: string; timezone: string; createdAt: Date }) {
  return { id: user.id, email: user.email, fullName: user.fullName, timezone: user.timezone, createdAt: user.createdAt };
}
