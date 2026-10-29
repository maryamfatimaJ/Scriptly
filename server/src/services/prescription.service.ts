import path from "node:path";
import fs from "node:fs/promises";
import { prisma } from "@/db/prisma";
import { AppError } from "@/utils/AppError";
import { extractPrescription } from "@/services/extractionService";
import { VisionProviderError, type VisionErrorKind } from "@/services/extraction/visionTransport";
import { matchMedicineReference } from "@/services/medicineMatching.service";
import { lookupPrice } from "@/services/medicineInfo/price.service";
import { env } from "@/config/env";
import type { Prisma } from "@prisma/client";

interface UploadedFile {
  path: string;
  originalname: string;
  mimetype: string;
  size: number;
}

// Prescription statuses from which a new (or first) extraction is allowed.
// APPROVED/REJECTED are finalized and must not be re-extracted; EXTRACTING
// is claimed by whichever request gets there first (see runExtraction).
const EXTRACTABLE_STATUSES = ["UPLOADED", "EXTRACTED", "NEEDS_CLARIFICATION"] as const;

export async function createPrescription(userId: string, file: UploadedFile) {
  const prescription = await prisma.prescription.create({
    data: {
      userId,
      imagePath: file.path,
      originalFilename: file.originalname,
      mimeType: file.mimetype,
      fileSizeBytes: file.size,
      status: "UPLOADED",
    },
  });

  await logEvent(prescription.id, userId, "CREATED", { originalFilename: file.originalname });
  return sanitizePrescription(prescription);
}

export async function listPrescriptions(userId: string) {
  const prescriptions = await prisma.prescription.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { medications: { include: { medicineReference: true } } },
  });
  return prescriptions.map(sanitizePrescription);
}

export async function getPrescription(userId: string, prescriptionId: string) {
  const prescription = await prisma.prescription.findFirst({
    where: { id: prescriptionId, userId },
    // Secondary sort on id is not cosmetic: every medication from one
    // extraction is written in the same createMany and shares an
    // identical createdAt, so ordering on that column alone left the
    // sequence up to the database. The review list visibly reshuffled
    // between loads, and anything that said "the first medication"
    // meant a different row each time.
    include: {
      medications: {
        // Schedule ids/statuses only — the review page uses them to know which
        // confirmed medicines still need reminders set up.
        include: { medicineReference: true, schedules: { select: { id: true, status: true } } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!prescription) throw AppError.notFound("Prescription not found.");
  return sanitizePrescription(prescription);
}

// Full audit trail for one prescription — the backbone of the History
// view. Ownership-checked like everything else; a user can only ever see
// the event log for their own prescriptions.
export async function getPrescriptionEvents(userId: string, prescriptionId: string) {
  await assertOwnedPrescription(userId, prescriptionId);
  return prisma.prescriptionEvent.findMany({
    where: { prescriptionId },
    orderBy: { createdAt: "asc" },
  });
}

// Used only by the authenticated image-streaming endpoint
// (prescription.controller.ts -> getImage) — this is the one place the raw
// file path is allowed to leave this service.
export async function getPrescriptionImageFile(userId: string, prescriptionId: string) {
  const prescription = await assertOwnedPrescription(userId, prescriptionId);
  return { path: prescription.imagePath, mimeType: prescription.mimeType };
}

async function assertOwnedPrescription(userId: string, prescriptionId: string) {
  const prescription = await prisma.prescription.findFirst({ where: { id: prescriptionId, userId } });
  if (!prescription) throw AppError.notFound("Prescription not found.");
  return prescription;
}

export async function runExtraction(userId: string, prescriptionId: string) {
  const prescription = await assertOwnedPrescription(userId, prescriptionId);

  if (prescription.status === "APPROVED" || prescription.status === "REJECTED") {
    await logEvent(prescription.id, userId, "EXTRACTION_RETRY_BLOCKED", {
      reason: "prescription_finalized",
      status: prescription.status,
    });
    throw AppError.conflict(
      `This prescription has already been ${prescription.status.toLowerCase()} and cannot be re-extracted.`
    );
  }

  // Never re-run extraction over medications a human has already reviewed
  // — that would silently discard their work. If anything needs
  // re-extracting at that point, it should be edited per-medication via
  // PATCH /api/medications/:id instead.
  const reviewedCount = await prisma.medication.count({
    where: { prescriptionId, reviewStatus: { in: ["CONFIRMED", "REJECTED", "NEEDS_CLARIFICATION"] } },
  });
  if (reviewedCount > 0) {
    await logEvent(prescription.id, userId, "EXTRACTION_RETRY_BLOCKED", {
      reason: "medications_already_reviewed",
      reviewedCount,
    });
    throw AppError.conflict(
      "Some medications on this prescription have already been reviewed. Edit them individually instead of re-extracting."
    );
  }

  // Atomically claim the extraction slot: only succeeds if the status is
  // still one we expect, so two concurrent /extract calls can't both
  // proceed (the loser gets count: 0 and a clear conflict error instead of
  // racing to create duplicate medication rows).
  const claimed = await prisma.prescription.updateMany({
    where: { id: prescription.id, status: { in: [...EXTRACTABLE_STATUSES] } },
    data: { status: "EXTRACTING", extractionAttempts: { increment: 1 } },
  });
  if (claimed.count === 0) {
    throw AppError.conflict("Extraction is already in progress for this prescription.");
  }

  await logEvent(prescription.id, userId, "EXTRACTION_STARTED", { provider: env.aiProvider });

  // Safe to retry: any medications left over from a prior, un-reviewed
  // extraction attempt are cleared before inserting the new ones, so a
  // retry never produces duplicate medication rows (guaranteed safe here
  // because the reviewedCount check above already confirmed none of them
  // have been reviewed yet).
  await prisma.medication.deleteMany({ where: { prescriptionId, reviewStatus: "NEEDS_REVIEW" } });

  try {
    const result = await extractPrescription({ imagePath: prescription.imagePath, mimeType: prescription.mimeType });

    // Medicine-reference matching happens once per candidate, before the
    // transaction, so a slow DB lookup doesn't hold the transaction open.
    const matches = await Promise.all(
      result.medications.map((candidate) =>
        matchMedicineReference({
          name: candidate.name,
          genericName: candidate.genericName,
          brand: candidate.brand,
          strength: candidate.strength,
          form: candidate.form,
        })
      )
    );

    await prisma.$transaction([
      ...result.medications.map((candidate, index) => {
        const match = matches[index];
        return prisma.medication.create({
          data: {
            prescriptionId: prescription.id,
            userId,
            extractedName: candidate.name,
            extractedBrand: candidate.brand,
            extractedGenericName: candidate.genericName,
            extractedStrength: candidate.strength,
            extractedForm: candidate.form,
            extractedRoute: candidate.route,
            extractedDosageInstructions: candidate.dosageInstructions,
            extractedInstructions: candidate.instructions,
            extractedFrequency: candidate.frequency,
            extractedDurationDays: candidate.durationDays,
            extractedTiming: candidate.timing,
            extractedQuantity: candidate.quantity,
            extractionFieldSource: (candidate.fieldSource ?? {}) as Prisma.InputJsonValue,
            extractionConfidence: candidate.confidence,
            extractionFieldConfidence: (candidate.fieldConfidence ?? {}) as Prisma.InputJsonValue,
            extractionWarnings: (candidate.warnings ?? []) as unknown as Prisma.InputJsonValue,
            reviewStatus: "NEEDS_REVIEW",
            medicineReferenceId: match.selectedId,
            referenceMatchStatus: match.status,
            referenceMatchCandidates: match.candidates as unknown as Prisma.InputJsonValue,
          },
        });
      }),
      prisma.prescription.update({
        where: { id: prescription.id },
        data: {
          status: "EXTRACTED",
          aiProvider: result.provider,
          extractionError: null,
          extractionOverallConfidence: result.confidence,
          extractionLegibility: result.legibility ?? null,
          extractionOverallWarnings: withLegibilityWarning(result) as unknown as Prisma.InputJsonValue,
        },
      }),
    ]);

    await logEvent(prescription.id, userId, "EXTRACTION_COMPLETED", {
      provider: result.provider,
      medicationCount: result.medications.length,
      overallConfidence: result.confidence,
      warnings: result.warnings,
    });

    await logEvent(prescription.id, userId, "MEDICINE_MATCHING_COMPLETED", {
      results: matches.map((m) => ({ status: m.status, candidateCount: m.candidates.length })),
    });

    return getPrescription(userId, prescriptionId);
  } catch (err) {
    // Only messages written by our own providers reach the user — never a
    // raw upstream error, which can contain request details.
    const providerError = err instanceof VisionProviderError ? err : null;
    if (!providerError) console.error("[extraction] unexpected failure:", err instanceof Error ? err.name : err);
    const kind: VisionErrorKind = providerError?.kind ?? "UNKNOWN";
    const retryable = providerError?.retryable ?? true;
    const message =
      providerError?.message ?? "Something went wrong while reading this prescription. Please try again.";

    await prisma.prescription.update({
      where: { id: prescription.id },
      data: { status: "NEEDS_CLARIFICATION", extractionError: message },
    });
    await logEvent(prescription.id, userId, "EXTRACTION_FAILED", { kind, retryable });
    throw new AppError(EXTRACTION_ERROR_STATUS[kind], "EXTRACTION_FAILED", message, { kind, retryable });
  }
}

// The HTTP status a failed extraction is reported with, so the client can
// tell "try again in a minute" from "this image can't be read".
const EXTRACTION_ERROR_STATUS: Record<VisionErrorKind, number> = {
  NOT_CONFIGURED: 503,
  AUTH: 503,
  QUOTA_EXHAUSTED: 503,
  MODEL_UNAVAILABLE: 503,
  NETWORK: 503,
  RATE_LIMITED: 429,
  TIMEOUT: 504,
  BAD_RESPONSE: 422,
  UNKNOWN: 500,
};

/** A page the model judged mostly unreadable gets a critical, prescription-wide warning. */
function withLegibilityWarning(result: { legibility?: string; warnings: Array<{ severity: string; message: string }> }) {
  if (result.legibility !== "POOR") return result.warnings;
  return [
    {
      severity: "critical",
      message:
        "Most of this prescription could not be read reliably. Check every medicine against the paper, retake the photo in good light, or ask your pharmacist to read it with you.",
    },
    ...result.warnings,
  ];
}

export async function approvePrescription(userId: string, prescriptionId: string) {
  const prescription = await assertOwnedPrescription(userId, prescriptionId);

  const medicationCount = await prisma.medication.count({ where: { prescriptionId } });
  if (medicationCount === 0) {
    throw AppError.unprocessable("This prescription has no medications to approve yet.");
  }

  // Every medicine must have been looked at. One the user marked as
  // needing clarification does not block saving the others: it is left
  // out of every schedule, listed as outstanding in the summary, and stays
  // editable after approval so it can be resolved later.
  const unreviewed = await prisma.medication.count({ where: { prescriptionId, reviewStatus: "NEEDS_REVIEW" } });
  if (unreviewed > 0) {
    throw AppError.unprocessable(
      "Every medicine needs a decision first: confirm it, correct and confirm it, mark it as needing clarification, or remove it."
    );
  }
  const confirmed = await prisma.medication.count({ where: { prescriptionId, reviewStatus: "CONFIRMED" } });
  if (confirmed === 0) {
    throw AppError.unprocessable("No medicine on this prescription is confirmed yet, so there is nothing to save.");
  }

  const updated = await prisma.prescription.update({ where: { id: prescription.id }, data: { status: "APPROVED" } });
  await logEvent(prescription.id, userId, "APPROVED", {});
  return sanitizePrescription(updated);
}

/**
 * What was actually saved for a prescription, for the completion screen.
 *
 * Everything here is read back from the database after the fact — the
 * medicines as confirmed, the schedules that exist, the reminder times on
 * them — so the screen can never show a success the backend didn't
 * record. Prices are looked up live and are either VERIFIED with a source
 * or explicitly unavailable. Anything still unresolved is listed.
 */
export async function getPrescriptionSummary(userId: string, prescriptionId: string) {
  const prescription = await prisma.prescription.findFirst({
    where: { id: prescriptionId, userId },
    include: {
      medications: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          schedules: {
            where: { status: { in: ["ACTIVE", "PAUSED"] } },
            include: { slots: { where: { active: true }, orderBy: { timeOfDay: "asc" } } },
          },
        },
      },
    },
  });
  if (!prescription) throw AppError.notFound("Prescription not found.");

  const confirmed = prescription.medications.filter((m) => m.reviewStatus === "CONFIRMED");
  const outstanding: Array<{ medicationId: string | null; name: string | null; reason: string }> = [];

  const medicines = await Promise.all(
    confirmed.map(async (m) => {
      const name = m.confirmedName ?? m.extractedName;
      const price = name
        ? await lookupPrice({ name, strength: m.confirmedStrength, form: m.confirmedForm })
        : null;
      const schedules = m.schedules.map((s) => ({
        id: s.id,
        status: s.status,
        startDate: s.startDate,
        endDate: s.endDate,
        doseAmount: s.doseAmount,
        daysOfWeek: s.daysOfWeek,
        remindersEnabled: s.remindersEnabled,
        times: s.slots.map((slot) => ({ timeOfDay: slot.timeOfDay, label: slot.label })),
      }));
      if (schedules.length === 0) {
        outstanding.push({ medicationId: m.id, name, reason: "No reminder schedule has been saved for this medicine yet." });
      }
      return {
        medicationId: m.id,
        name,
        genericName: m.confirmedGenericName,
        strength: m.confirmedStrength,
        form: m.confirmedForm,
        route: m.confirmedRoute,
        dosageInstructions: m.confirmedDosageInstructions,
        frequency: m.confirmedFrequency,
        timing: m.confirmedTiming,
        durationDays: m.confirmedDurationDays,
        quantity: m.confirmedQuantity,
        instructions: m.confirmedInstructions,
        schedules,
        price,
      };
    })
  );

  for (const m of prescription.medications) {
    if (m.reviewStatus === "NEEDS_CLARIFICATION") {
      outstanding.push({
        medicationId: m.id,
        name: m.confirmedName ?? m.extractedName,
        reason:
          "You marked this medicine as needing clarification. It is not in any schedule. Check it with your prescriber or pharmacist, then confirm or remove it." +
          (m.reviewNotes ? ` Your note: "${m.reviewNotes}"` : ""),
      });
    }
  }

  return {
    prescriptionId: prescription.id,
    status: prescription.status,
    medicines,
    removedCount: prescription.medications.filter((m) => m.reviewStatus === "REJECTED").length,
    outstanding,
    reminderDelivery: {
      emailConfigured: env.emailProvider === "smtp",
      explanation:
        env.emailProvider === "smtp"
          ? "Reminder emails are sent to your account email at each dose time."
          : "Email reminders are not configured on this server. Reminders appear in Scriptly on the Schedule page; no email or push notification is sent.",
    },
  };
}

export async function rejectPrescription(userId: string, prescriptionId: string, reason?: string) {
  const prescription = await assertOwnedPrescription(userId, prescriptionId);
  const updated = await prisma.prescription.update({ where: { id: prescription.id }, data: { status: "REJECTED" } });
  await logEvent(prescription.id, userId, "REJECTED", { reason });
  return sanitizePrescription(updated);
}

export async function requestClarification(userId: string, prescriptionId: string, note: string) {
  const prescription = await assertOwnedPrescription(userId, prescriptionId);
  const updated = await prisma.prescription.update({
    where: { id: prescription.id },
    data: { status: "NEEDS_CLARIFICATION" },
  });
  await logEvent(prescription.id, userId, "CLARIFICATION_REQUESTED", { note });
  return sanitizePrescription(updated);
}

type PrescriptionEventType =
  | "CREATED"
  | "EXTRACTION_STARTED"
  | "EXTRACTION_COMPLETED"
  | "EXTRACTION_FAILED"
  | "EXTRACTION_RETRY_BLOCKED"
  | "MEDICINE_MATCHING_COMPLETED"
  | "APPROVED"
  | "REJECTED"
  | "CLARIFICATION_REQUESTED"
  | "MEDICATION_UPDATED"
  | "SCHEDULE_CREATED"
  | "SCHEDULE_STATUS_CHANGED"
  | "REMINDER_UPDATED";

async function logEvent(
  prescriptionId: string,
  userId: string | null,
  eventType: PrescriptionEventType,
  metadata: Record<string, unknown>
) {
  await prisma.prescriptionEvent.create({
    data: { prescriptionId, userId: userId ?? undefined, eventType, metadata: metadata as object },
  });
}

// Never return the raw filesystem path to the client — images are served
// through an authenticated, ownership-checked endpoint, not a static path.
function sanitizePrescription<T extends { imagePath: string }>(prescription: T) {
  const { imagePath: _imagePath, ...rest } = prescription;
  return rest;
}

export { logEvent as logPrescriptionEvent };
export type { PrescriptionEventType };

/**
 * Deletes a prescription from the user's history: its medicines (and,
 * through the schema's cascades, their schedules, reminders and delivery
 * records), its event trail, and the uploaded image file. Ownership is
 * checked first; another user's id is a 404.
 */
export async function deletePrescription(userId: string, prescriptionId: string) {
  const prescription = await assertOwnedPrescription(userId, prescriptionId);
  await prisma.prescription.delete({ where: { id: prescription.id } });

  // The database row is gone first, so a failure here can only leave an
  // orphaned file, never a record pointing at a missing image. Only files
  // inside the upload directory are ever removed.
  const uploadRoot = path.resolve(env.uploadDir);
  const imageFile = path.resolve(prescription.imagePath);
  if (imageFile.startsWith(uploadRoot + path.sep)) {
    await fs.rm(imageFile, { force: true }).catch(() => undefined);
  }
}
