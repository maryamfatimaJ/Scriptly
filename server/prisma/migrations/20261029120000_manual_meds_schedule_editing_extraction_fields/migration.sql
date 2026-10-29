-- CreateEnum
CREATE TYPE "MedicationSource" AS ENUM ('PRESCRIPTION', 'MANUAL');

-- AlterEnum
ALTER TYPE "PrescriptionEventType" ADD VALUE 'SCHEDULE_UPDATED';

-- AlterEnum
ALTER TYPE "ReminderDeliveryStatus" ADD VALUE 'SKIPPED_DISABLED';

-- AlterTable
ALTER TABLE "medications" ADD COLUMN     "confirmedQuantity" TEXT,
ADD COLUMN     "confirmedTiming" TEXT,
ADD COLUMN     "extractedQuantity" TEXT,
ADD COLUMN     "extractedTiming" TEXT,
ADD COLUMN     "extractionFieldSource" JSONB,
ADD COLUMN     "source" "MedicationSource" NOT NULL DEFAULT 'PRESCRIPTION',
ALTER COLUMN "prescriptionId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "extractionLegibility" TEXT;

-- AlterTable
ALTER TABLE "schedule_slots" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "schedules" ADD COLUMN     "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
ADD COLUMN     "doseAmount" TEXT,
ADD COLUMN     "remindersEnabled" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE UNIQUE INDEX "reminders_scheduleSlotId_scheduledFor_key" ON "reminders"("scheduleSlotId", "scheduledFor");


-- A medication without a prescription must be one the user entered manually.
ALTER TABLE "medications" ADD CONSTRAINT "medications_prescription_or_manual" CHECK ("source" = 'MANUAL' OR "prescriptionId" IS NOT NULL);
