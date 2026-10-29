-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('UPLOADED', 'EXTRACTING', 'EXTRACTED', 'APPROVED', 'REJECTED', 'NEEDS_CLARIFICATION');

-- CreateEnum
CREATE TYPE "MedicationReviewStatus" AS ENUM ('NEEDS_REVIEW', 'CONFIRMED', 'NEEDS_CLARIFICATION', 'REJECTED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'TAKEN', 'MISSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "DataProvenance" AS ENUM ('DRAP', 'OPENFDA', 'WHO_EML', 'RXNORM', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "PrescriptionEventType" AS ENUM ('CREATED', 'EXTRACTION_STARTED', 'EXTRACTION_COMPLETED', 'EXTRACTION_FAILED', 'APPROVED', 'REJECTED', 'CLARIFICATION_REQUESTED', 'MEDICATION_UPDATED', 'SCHEDULE_CREATED', 'REMINDER_UPDATED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imagePath" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'UPLOADED',
    "extractionError" TEXT,
    "aiProvider" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medications" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "extractedName" TEXT,
    "extractedStrength" TEXT,
    "extractedForm" TEXT,
    "extractedDosageInstructions" TEXT,
    "extractedFrequency" TEXT,
    "extractedDurationDays" INTEGER,
    "extractionConfidence" DOUBLE PRECISION,
    "extractionWarnings" JSONB,
    "confirmedName" TEXT,
    "confirmedStrength" TEXT,
    "confirmedForm" TEXT,
    "confirmedDosageInstructions" TEXT,
    "confirmedFrequency" TEXT,
    "confirmedDurationDays" INTEGER,
    "reviewStatus" "MedicationReviewStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
    "reviewNotes" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "medicineReferenceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedules" (
    "id" TEXT NOT NULL,
    "medicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" "ScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_slots" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "label" TEXT,

    CONSTRAINT "schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "scheduleSlotId" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_reference" (
    "id" TEXT NOT NULL,
    "genericName" TEXT NOT NULL,
    "brandName" TEXT,
    "activeIngredient" TEXT NOT NULL,
    "strength" TEXT,
    "formulation" TEXT,
    "manufacturer" TEXT,
    "countryOrMarket" TEXT,
    "registrationId" TEXT,
    "referencePrice" DECIMAL(12,2),
    "currency" TEXT,
    "priceSource" TEXT,
    "priceSourceUrl" TEXT,
    "priceLastVerifiedAt" TIMESTAMP(3),
    "sourceUrl" TEXT,
    "dataProvenance" "DataProvenance" NOT NULL DEFAULT 'MANUAL',
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_reference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_reference_sources" (
    "id" TEXT NOT NULL,
    "medicineReferenceId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "fieldsProvided" JSONB NOT NULL,
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_reference_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_events" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" "PrescriptionEventType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "prescriptions_userId_idx" ON "prescriptions"("userId");

-- CreateIndex
CREATE INDEX "prescriptions_status_idx" ON "prescriptions"("status");

-- CreateIndex
CREATE INDEX "medications_prescriptionId_idx" ON "medications"("prescriptionId");

-- CreateIndex
CREATE INDEX "medications_userId_idx" ON "medications"("userId");

-- CreateIndex
CREATE INDEX "medications_reviewStatus_idx" ON "medications"("reviewStatus");

-- CreateIndex
CREATE INDEX "schedules_medicationId_idx" ON "schedules"("medicationId");

-- CreateIndex
CREATE INDEX "schedules_userId_idx" ON "schedules"("userId");

-- CreateIndex
CREATE INDEX "schedule_slots_scheduleId_idx" ON "schedule_slots"("scheduleId");

-- CreateIndex
CREATE INDEX "reminders_scheduleSlotId_idx" ON "reminders"("scheduleSlotId");

-- CreateIndex
CREATE INDEX "reminders_scheduledFor_idx" ON "reminders"("scheduledFor");

-- CreateIndex
CREATE INDEX "reminders_status_idx" ON "reminders"("status");

-- CreateIndex
CREATE INDEX "medicine_reference_genericName_idx" ON "medicine_reference"("genericName");

-- CreateIndex
CREATE INDEX "medicine_reference_brandName_idx" ON "medicine_reference"("brandName");

-- CreateIndex
CREATE INDEX "medicine_reference_countryOrMarket_idx" ON "medicine_reference"("countryOrMarket");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_reference_genericName_brandName_strength_formulati_key" ON "medicine_reference"("genericName", "brandName", "strength", "formulation", "dataProvenance");

-- CreateIndex
CREATE INDEX "medicine_reference_sources_medicineReferenceId_idx" ON "medicine_reference_sources"("medicineReferenceId");

-- CreateIndex
CREATE INDEX "prescription_events_prescriptionId_idx" ON "prescription_events"("prescriptionId");

-- CreateIndex
CREATE INDEX "prescription_events_eventType_idx" ON "prescription_events"("eventType");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medications" ADD CONSTRAINT "medications_medicineReferenceId_fkey" FOREIGN KEY ("medicineReferenceId") REFERENCES "medicine_reference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_scheduleSlotId_fkey" FOREIGN KEY ("scheduleSlotId") REFERENCES "schedule_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_reference_sources" ADD CONSTRAINT "medicine_reference_sources_medicineReferenceId_fkey" FOREIGN KEY ("medicineReferenceId") REFERENCES "medicine_reference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_events" ADD CONSTRAINT "prescription_events_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_events" ADD CONSTRAINT "prescription_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
