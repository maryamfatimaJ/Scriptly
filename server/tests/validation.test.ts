import { describe, expect, it } from "vitest";
import { registerSchema, loginSchema } from "@/validation/auth.schema";
import { updateMedicationSchema } from "@/validation/medication.schema";
import { createScheduleSchema } from "@/validation/schedule.schema";

describe("auth validation", () => {
  it("rejects a short password on registration", () => {
    const result = registerSchema.safeParse({ email: "a@b.com", password: "short", fullName: "A" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid login payload", () => {
    const result = loginSchema.safeParse({ email: "a@b.com", password: "whatever" });
    expect(result.success).toBe(true);
  });
});

describe("medication confirmation rules", () => {
  it("refuses to confirm a medication without a name", () => {
    const result = updateMedicationSchema.safeParse({ reviewStatus: "CONFIRMED" });
    expect(result.success).toBe(false);
  });

  it("refuses to confirm with a blank name", () => {
    const result = updateMedicationSchema.safeParse({
      reviewStatus: "CONFIRMED",
      confirmedName: "   ",
      confirmedDosageInstructions: "1 tablet",
      confirmedFrequency: "BD",
    });
    expect(result.success).toBe(false);
  });

  it("allows confirming with a name when dose and frequency are not written", () => {
    expect(updateMedicationSchema.safeParse({ reviewStatus: "CONFIRMED", confirmedName: "Cetirizine" }).success).toBe(true);
    // As the review form sends unwritten fields: empty strings.
    expect(
      updateMedicationSchema.safeParse({
        reviewStatus: "CONFIRMED",
        confirmedName: "Cetirizine",
        confirmedDosageInstructions: "",
        confirmedFrequency: "",
        confirmedTiming: "",
      }).success
    ).toBe(true);
  });

  it("allows confirming once name, dosage instructions, and frequency are present", () => {
    const result = updateMedicationSchema.safeParse({
      reviewStatus: "CONFIRMED",
      confirmedName: "Amoxicillin",
      confirmedDosageInstructions: "Take one capsule three times daily",
      confirmedFrequency: "3x daily",
    });
    expect(result.success).toBe(true);
  });

  it("allows setting NEEDS_REVIEW without any confirmed fields", () => {
    const result = updateMedicationSchema.safeParse({ reviewStatus: "NEEDS_REVIEW" });
    expect(result.success).toBe(true);
  });
});

describe("schedule validation", () => {
  it("requires at least one reminder slot", () => {
    const result = createScheduleSchema.safeParse({
      medicationId: "11111111-1111-1111-1111-111111111111",
      startDate: "2026-01-01",
      slots: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-format time of day", () => {
    const result = createScheduleSchema.safeParse({
      medicationId: "11111111-1111-1111-1111-111111111111",
      startDate: "2026-01-01",
      slots: [{ timeOfDay: "8am" }],
    });
    expect(result.success).toBe(false);
  });
});
