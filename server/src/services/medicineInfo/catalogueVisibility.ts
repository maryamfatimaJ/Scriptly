import { env } from "@/config/env";

/**
 * Prisma `where` fragment that keeps synthetic medicine rows (development
 * seed data, automated-test fixtures) out of everything a user sees:
 * search, detail pages, prescription matching and price lookups.
 */
export function visibleCatalogue(): { isSynthetic?: false } {
  return env.catalogueIncludeSynthetic ? {} : { isSynthetic: false };
}
