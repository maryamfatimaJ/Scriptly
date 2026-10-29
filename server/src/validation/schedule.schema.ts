import { z } from "zod";

const timeOfDayPattern = /^([01]\d|2[0-3]):([0-5]\d)$/;

const slotsSchema = z
  .array(
    z.object({
      timeOfDay: z.string().regex(timeOfDayPattern, "Time must be in HH:mm format."),
      label: z.string().trim().max(50).optional(),
    })
  )
  .min(1, "At least one reminder time is required.")
  .max(12);

// ISO weekdays: 1 = Monday … 7 = Sunday. An empty list means every day.
const daysOfWeekSchema = z.array(z.number().int().min(1).max(7)).max(7);

export const createScheduleSchema = z.object({
  medicationId: z.string().uuid(),
  startDate: z.coerce.date(),
  // Omitted = ongoing. The UI only sends no end date when the user has
  // explicitly chosen "ongoing" — it is never a silent default.
  endDate: z.coerce.date().optional(),
  slots: slotsSchema,
  notes: z.string().trim().max(500).optional(),
  doseAmount: z.string().trim().max(100).optional(),
  daysOfWeek: daysOfWeekSchema.optional(),
  remindersEnabled: z.boolean().optional(),
});

export const editScheduleSchema = z
  .object({
    slots: slotsSchema.optional(),
    // null clears the end date (ongoing).
    endDate: z.coerce.date().nullable().optional(),
    daysOfWeek: daysOfWeekSchema.optional(),
    doseAmount: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
    remindersEnabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

export const scheduleQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be formatted as YYYY-MM-DD")
    .optional(),
  view: z.enum(["day", "week"]).optional().default("day"),
});

export const updateScheduleSchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "CANCELLED"]),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type EditScheduleInput = z.infer<typeof editScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
