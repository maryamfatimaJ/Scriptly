import { z } from "zod";

// Mirrors server/src/validation/medication.schema.ts so the review form
// can show a clear inline error before ever hitting the API — the
// server remains the source of truth and re-validates independently.
export const medicationReviewSchema = z
  .object({
    confirmedName: z.string().trim().max(200).optional(),
    confirmedBrand: z.string().trim().max(200).optional(),
    confirmedGenericName: z.string().trim().max(200).optional(),
    confirmedStrength: z.string().trim().max(100).optional(),
    confirmedForm: z.string().trim().max(100).optional(),
    confirmedRoute: z.string().trim().max(100).optional(),
    confirmedDosageInstructions: z.string().trim().max(1000).optional(),
    confirmedInstructions: z.string().trim().max(1000).optional(),
    confirmedFrequency: z.string().trim().max(200).optional(),
    confirmedTiming: z.string().trim().max(200).optional(),
    confirmedQuantity: z.string().trim().max(100).optional(),
    confirmedDurationDays: z.coerce.number().int().positive().max(3650).optional().or(z.literal("").transform(() => undefined)),
    reviewStatus: z.enum(["NEEDS_REVIEW", "CONFIRMED", "NEEDS_CLARIFICATION", "REJECTED"]),
    reviewNotes: z.string().trim().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.reviewStatus === "CONFIRMED") {
      // Only the name is required. A dose or frequency the prescription
      // doesn't state is left empty, never filled in.
      if (!data.confirmedName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter the medicine's name from your prescription before confirming.",
          path: ["confirmedName"],
        });
      }
    }
  });

export type MedicationReviewInput = z.infer<typeof medicationReviewSchema>;
