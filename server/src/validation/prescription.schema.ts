import { z } from "zod";

export const rejectPrescriptionSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const requestClarificationSchema = z.object({
  note: z.string().trim().min(1, "Describe what needs clarification.").max(1000),
});

export type RejectPrescriptionInput = z.infer<typeof rejectPrescriptionSchema>;
export type RequestClarificationInput = z.infer<typeof requestClarificationSchema>;
