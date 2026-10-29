import { z } from "zod";

// PENDING is included so a mistaken TAKEN/MISSED mark can be corrected
// back to "not yet responded to" — see reminder.service.ts, which logs
// the before/after status on every change rather than silently
// overwriting it, so a correction is visible in history, not erased.
export const updateReminderSchema = z.object({
  status: z.enum(["PENDING", "TAKEN", "MISSED", "SKIPPED"]),
});

export type UpdateReminderInput = z.infer<typeof updateReminderSchema>;
