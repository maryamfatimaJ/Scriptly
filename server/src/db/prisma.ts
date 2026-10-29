import { PrismaClient } from "@prisma/client";

// Reuse a single PrismaClient instance across hot reloads in dev to avoid
// exhausting the Postgres connection pool.
declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClient | undefined;
}

export const prisma =
  global.__prismaClient ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__prismaClient = prisma;
}
