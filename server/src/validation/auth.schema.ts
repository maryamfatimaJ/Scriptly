import { z } from "zod";

function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimezone, "Enter a valid IANA timezone, e.g. Asia/Karachi.");

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password is too long."),
  fullName: z.string().trim().min(1, "Full name is required.").max(120),
  // Optional at registration — defaults to UTC (see prisma schema) if the
  // client doesn't supply one (e.g. couldn't detect it). The frontend
  // registration form pre-fills this from Intl.DateTimeFormat().resolvedOptions().timeZone.
  timezone: timezoneSchema.optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
});

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  timezone: timezoneSchema.optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
