import { prisma } from "@/db/prisma";
import { AppError } from "@/utils/AppError";
import { getMonographForIngredient, type MonographLookup } from "@/services/medicineInfo/monograph.service";
import { lookupPrice } from "@/services/medicineInfo/price.service";
import type { CreateManualMedicationInput, UpdateMedicationInput } from "@/validation/medication.schema";
import { logPrescriptionEvent } from "@/services/prescription.service";

// Narrow, explicit type for the confirmed-field patch this service
// computes — deliberately NOT `Partial<Medication>`, because that would
// structurally include the model's Json columns (extractionFieldConfidence,
// extractionWarnings, referenceMatchCandidates) and Prisma's update-input
// types for Json fields are stricter than plain `JsonValue`, which breaks
// the spread below even though none of those keys are ever actually set.
type ConfirmedFieldPatch = {
  confirmedName: string | null;
  confirmedBrand: string | null;
  confirmedGenericName: string | null;
  confirmedStrength: string | null;
  confirmedForm: string | null;
  confirmedRoute: string | null;
  confirmedDosageInstructions: string | null;
  confirmedInstructions: string | null;
  confirmedFrequency: string | null;
  confirmedDurationDays: number | null;
  confirmedTiming: string | null;
  confirmedQuantity: string | null;
  medicineReferenceId: string | null;
};

// Fields a change to is worth recording in the audit trail. Keeps the
// trail focused on medically meaningful edits rather than every touch of
// the row (e.g. reviewStatus transitions are already implied by the
// "reviewStatus" entry and don't need to be duplicated field-by-field).
const AUDITED_FIELDS = [
  "confirmedName",
  "confirmedBrand",
  "confirmedGenericName",
  "confirmedStrength",
  "confirmedForm",
  "confirmedRoute",
  "confirmedDosageInstructions",
  "confirmedInstructions",
  "confirmedFrequency",
  "confirmedDurationDays",
  "confirmedTiming",
  "confirmedQuantity",
  "medicineReferenceId",
] as const satisfies readonly (keyof ConfirmedFieldPatch)[];

export async function updateMedication(userId: string, medicationId: string, input: UpdateMedicationInput) {
  const medication = await prisma.medication.findFirst({
    where: { id: medicationId, userId },
    include: { prescription: { select: { status: true } } },
  });
  if (!medication) throw AppError.notFound("Medication not found.");

  // A MANUAL medication has no prescription to finalise, so it stays
  // editable by its owner. A prescription's medications freeze once the
  // prescription itself is approved or rejected.
  // The one exception: a medicine left as NEEDS_CLARIFICATION when the
  // prescription was approved can still be resolved afterwards (e.g. once
  // the pharmacist has read it), because approval deliberately excluded it.
  const prescriptionStatus = medication.prescription?.status;
  const resolvingClarification = prescriptionStatus === "APPROVED" && medication.reviewStatus === "NEEDS_CLARIFICATION";
  if ((prescriptionStatus === "APPROVED" && !resolvingClarification) || prescriptionStatus === "REJECTED") {
    throw AppError.conflict(
      `This prescription has already been ${prescriptionStatus.toLowerCase()} — its medications can no longer be edited.`
    );
  }

  // A reference selection must come from this medication's own candidate
  // list (populated by the automated matcher) or be an explicit clear
  // (null) — a client can't link an arbitrary/unrelated reference row.
  let medicineReferenceId = medication.medicineReferenceId;
  let referenceMatchStatus = medication.referenceMatchStatus;
  if (input.medicineReferenceId !== undefined) {
    if (input.medicineReferenceId === null) {
      medicineReferenceId = null;
      referenceMatchStatus = "NO_VERIFIED_RECORD";
    } else {
      const candidates = (medication.referenceMatchCandidates as Array<{ id: string }> | null) ?? [];
      const isKnownCandidate = candidates.some((c) => c.id === input.medicineReferenceId);
      if (!isKnownCandidate) {
        throw AppError.badRequest(
          "That medicine reference wasn't one of the suggested matches for this medication."
        );
      }
      const exists = await prisma.medicineReference.findUnique({ where: { id: input.medicineReferenceId } });
      if (!exists) throw AppError.badRequest("That medicine reference no longer exists.");
      medicineReferenceId = input.medicineReferenceId;
      // The user explicitly chose this one — that's now a human-verified
      // match, stronger than anything the automated matcher could claim.
      referenceMatchStatus = "VERIFIED_MATCH";
    }
  }

  const nextValues: ConfirmedFieldPatch = {
    confirmedName: input.confirmedName ?? medication.confirmedName,
    confirmedBrand: input.confirmedBrand ?? medication.confirmedBrand,
    confirmedGenericName: input.confirmedGenericName ?? medication.confirmedGenericName,
    confirmedStrength: input.confirmedStrength ?? medication.confirmedStrength,
    confirmedForm: input.confirmedForm ?? medication.confirmedForm,
    confirmedRoute: input.confirmedRoute ?? medication.confirmedRoute,
    confirmedDosageInstructions: input.confirmedDosageInstructions ?? medication.confirmedDosageInstructions,
    confirmedInstructions: input.confirmedInstructions ?? medication.confirmedInstructions,
    confirmedFrequency: input.confirmedFrequency ?? medication.confirmedFrequency,
    confirmedDurationDays: input.confirmedDurationDays ?? medication.confirmedDurationDays,
    confirmedTiming: input.confirmedTiming ?? medication.confirmedTiming,
    confirmedQuantity: input.confirmedQuantity ?? medication.confirmedQuantity,
    medicineReferenceId,
  };

  const changedFields = AUDITED_FIELDS.filter((field) => nextValues[field] !== medication[field]).map((field) => ({
    field,
    from: medication[field],
    to: nextValues[field],
  }));

  const updated = await prisma.medication.update({
    where: { id: medicationId },
    data: {
      ...nextValues,
      medicineReferenceId,
      referenceMatchStatus,
      reviewStatus: input.reviewStatus,
      reviewNotes: input.reviewNotes,
      confirmedById: input.reviewStatus === "CONFIRMED" ? userId : medication.confirmedById,
      confirmedAt: input.reviewStatus === "CONFIRMED" ? new Date() : medication.confirmedAt,
    },
  });

  // The audit trail is per prescription; a MANUAL medication has none.
  if (medication.prescriptionId) {
    await logPrescriptionEvent(medication.prescriptionId, userId, "MEDICATION_UPDATED", {
      medicationId,
      reviewStatus: input.reviewStatus,
      previousReviewStatus: medication.reviewStatus,
      // Audit trail of meaningful changes — field-level before/after, not
      // just "something changed". Values are the user's own confirmed data
      // on their own prescription, scoped to their own event log.
      changedFields,
    });
  }

  return updated;
}

/**
 * A medicine the user adds themselves, without uploading a prescription.
 *
 * Every value is typed by the user, so the user is the confirming
 * reviewer: the row is created CONFIRMED with confirmedById set to them,
 * exactly as if they had confirmed an extracted reading. Nothing is
 * filled in by the app. The same minimum as a review confirmation applies
 * (name, dose instructions, frequency) because a schedule needs all three.
 */
export async function createManualMedication(userId: string, input: CreateManualMedicationInput) {
  return prisma.medication.create({
    data: {
      userId,
      source: "MANUAL",
      prescriptionId: null,
      confirmedName: input.name,
      confirmedGenericName: input.genericName,
      confirmedStrength: input.strength,
      confirmedForm: input.form,
      confirmedRoute: input.route,
      confirmedDosageInstructions: input.dosageInstructions,
      confirmedInstructions: input.instructions,
      confirmedFrequency: input.frequency,
      confirmedTiming: input.timing,
      confirmedDurationDays: input.durationDays,
      reviewStatus: "CONFIRMED",
      confirmedById: userId,
      confirmedAt: new Date(),
      // Nothing was extracted, so there is nothing to match against yet.
      referenceMatchStatus: "NOT_EVALUATED",
    },
  });
}

export async function getMedicationForUser(userId: string, medicationId: string) {
  const medication = await prisma.medication.findFirst({
    where: { id: medicationId, userId },
    include: { medicineReference: true },
  });
  if (!medication) throw AppError.notFound("Medication not found.");
  return medication;
}

/**
 * Sourced label information for ONE of the user's own medications.
 *
 * Exists as a first-class endpoint rather than making the client search
 * the reference database by name and hope for a hit: the medication row
 * already knows its generic name, and routing through here keeps the
 * ownership check in the query instead of trusting a client-supplied
 * reference id.
 */
export async function getMedicationInformation(userId: string, medicationId: string) {
  const medication = await getMedicationForUser(userId, medicationId);

  const displayName = medication.confirmedName ?? medication.extractedName;
  // A drug label is indexed by ingredient, not by brand, so prefer the
  // generic name wherever we have one.
  const ingredient =
    medication.confirmedGenericName ??
    medication.extractedGenericName ??
    medication.medicineReference?.activeIngredient ??
    displayName;

  if (!ingredient) {
    return {
      medicationId: medication.id,
      medicineName: displayName,
      activeIngredient: null,
      isConfirmed: medication.reviewStatus === "CONFIRMED",
      information: {
        status: "NOT_AVAILABLE" as const,
        ingredient: "",
        reason: "This medication has no name recorded yet, so there is nothing to look up.",
      },
    };
  }

  const information = await getMonographForIngredient(ingredient);

  return {
    medicationId: medication.id,
    medicineName: displayName,
    activeIngredient: ingredient,
    // Surfaced so the UI can say "this is based on a reading you haven't
    // confirmed yet" rather than presenting it as settled.
    isConfirmed: medication.reviewStatus === "CONFIRMED",
    information,
    marketNote: buildMarketNote(ingredient, information),
  };
}

/**
 * Explains, in the panel itself, why the label may be headed by a
 * different name than the one on the prescription.
 *
 * The US label for Paracetamol is published as Acetaminophen. Showing a
 * Pakistani user a card that reads "Paracetamol" above a panel headed
 * "ACETAMINOPHEN" invites exactly the conclusion that the app fetched the
 * wrong drug — the specific failure the medicine-resolution work exists
 * to prevent. Naming both spellings costs one sentence.
 */
function buildMarketNote(ingredient: string, lookup: MonographLookup): string | undefined {
  if (lookup.status !== "FOUND" || lookup.monograph.market !== "US") return undefined;

  const labelName = lookup.monograph.displayName;
  const sameName = labelName.toLowerCase().includes(ingredient.toLowerCase());
  const synonymNote = sameName
    ? ""
    : ` ${ingredient} is published under the name ${labelName} in the United States — the same medicine, a different name.`;

  return (
    `This is United States FDA label information for the active ingredient.${synonymNote} ` +
    `The Pakistani product leaflet for this brand may differ in approved uses, pack sizes and wording.`
  );
}

/** Pakistan price lookup for one of the user's own medications. */
export async function getMedicationPrice(userId: string, medicationId: string) {
  const medication = await getMedicationForUser(userId, medicationId);

  const name = medication.confirmedName ?? medication.extractedName;
  if (!name) {
    throw AppError.unprocessable("This medication has no name recorded yet, so a price cannot be looked up.");
  }

  // Strength and form make the match STRICTER, not looser — a different
  // strength of the same brand is a different product at a different
  // price. See price.service.ts.
  const price = await lookupPrice({
    name,
    strength: medication.confirmedStrength ?? medication.extractedStrength,
    form: medication.confirmedForm ?? medication.extractedForm,
  });

  return {
    medicationId: medication.id,
    medicineName: name,
    isConfirmed: medication.reviewStatus === "CONFIRMED",
    price,
  };
}

export async function listMedicationsForUser(userId: string) {
  return prisma.medication.findMany({
    where: { userId },
    include: {
      prescription: { select: { id: true, status: true, createdAt: true } },
      medicineReference: true,
      // Lets the frontend tell "already has an active/paused schedule"
      // apart from "never scheduled" without a second round-trip — used
      // to stop offering "set up reminders" for a medication that's
      // already on one (previously a known gap, see README history).
      schedules: { select: { id: true, status: true } },
    },
    // Tie-broken on id — medications from one extraction share a createdAt.
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
  });
}

/**
 * Removes one medicine from the user's account.
 *
 * Ownership is checked in the same query that finds the row, so another
 * user's id is a plain 404. The schema cascades from Medication to its
 * Schedules -> ScheduleSlots -> Reminders -> ReminderDeliveries, so no
 * reminder for a deleted medicine can fire afterwards; nothing outside
 * that chain (the prescription, other medicines, the shared medicine
 * catalogue) is touched.
 */
export async function deleteMedication(userId: string, medicationId: string) {
  const medication = await prisma.medication.findFirst({
    where: { id: medicationId, userId },
    select: { id: true, prescriptionId: true, confirmedName: true, extractedName: true },
  });
  if (!medication) throw AppError.notFound("Medication not found.");

  await prisma.$transaction(async (tx) => {
    await tx.medication.delete({ where: { id: medication.id } });
    if (medication.prescriptionId) {
      await tx.prescriptionEvent.create({
        data: {
          prescriptionId: medication.prescriptionId,
          userId,
          eventType: "MEDICATION_UPDATED",
          metadata: { action: "deleted", medicationId: medication.id, name: medication.confirmedName ?? medication.extractedName },
        },
      });
    }
  });
}
