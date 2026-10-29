import { z } from "zod";

// Fields a reviewer can edit/confirm on an extracted medication. Confirming
// a medication (reviewStatus: "CONFIRMED") requires only its name: a dose
// or frequency that isn't written on the prescription stays empty rather
// than being made up. Scheduling handles the gap — with no frequency the
// planner proposes no times (see utils/schedulePlanner.ts).
export const updateMedicationSchema = z
  .object({
    confirmedName: z.string().trim().min(1).max(200).optional(),
    confirmedBrand: z.string().trim().max(200).optional(),
    confirmedGenericName: z.string().trim().max(200).optional(),
    confirmedStrength: z.string().trim().max(100).optional(),
    confirmedForm: z.string().trim().max(100).optional(),
    confirmedRoute: z.string().trim().max(100).optional(),
    confirmedDosageInstructions: z.string().trim().max(1000).optional(),
    confirmedInstructions: z.string().trim().max(1000).optional(),
    confirmedFrequency: z.string().trim().max(200).optional(),
    confirmedDurationDays: z.number().int().positive().max(3650).optional(),
    confirmedTiming: z.string().trim().max(200).optional(),
    confirmedQuantity: z.string().trim().max(100).optional(),
    reviewStatus: z.enum(["NEEDS_REVIEW", "CONFIRMED", "NEEDS_CLARIFICATION", "REJECTED"]),
    reviewNotes: z.string().trim().max(1000).optional(),
    // Lets the user pick a specific medicine_reference row when the
    // automated matcher returned POSSIBLE_MATCH / MULTIPLE_MATCHES
    // (never auto-selected for them — see medicineMatching.service.ts).
    // Pass null to explicitly clear a previous selection.
    medicineReferenceId: z.string().uuid().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.reviewStatus === "CONFIRMED") {
      if (!data.confirmedName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter the medicine's name before confirming it.",
          path: ["confirmedName"],
        });
      }
    }
  });

export type UpdateMedicationInput = z.infer<typeof updateMedicationSchema>;

// A medicine the user enters themselves (no prescription upload). The
// same three fields a review confirmation requires are required here.
export const createManualMedicationSchema = z.object({
  name: z.string().trim().min(1, "Enter the medicine's name.").max(200),
  genericName: z.string().trim().max(200).optional(),
  strength: z.string().trim().max(100).optional(),
  form: z.string().trim().max(100).optional(),
  route: z.string().trim().max(100).optional(),
  dosageInstructions: z.string().trim().min(1, "Enter the dose, e.g. \"1 tablet\".").max(1000),
  frequency: z.string().trim().min(1, "Enter how often it is taken, e.g. \"twice daily\".").max(200),
  timing: z.string().trim().max(200).optional(),
  instructions: z.string().trim().max(1000).optional(),
  durationDays: z.number().int().positive().max(3650).optional(),
});

export type CreateManualMedicationInput = z.infer<typeof createManualMedicationSchema>;
