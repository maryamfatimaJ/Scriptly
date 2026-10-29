-- CreateEnum
CREATE TYPE "ReminderDeliveryChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "ReminderDeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED_NOT_CONFIGURED');

-- AlterEnum
ALTER TYPE "PrescriptionEventType" ADD VALUE 'SCHEDULE_STATUS_CHANGED';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- CreateTable
CREATE TABLE "reminder_deliveries" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "channel" "ReminderDeliveryChannel" NOT NULL,
    "status" "ReminderDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reminder_deliveries_status_idx" ON "reminder_deliveries"("status");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_deliveries_reminderId_channel_key" ON "reminder_deliveries"("reminderId", "channel");

-- AddForeignKey
ALTER TABLE "reminder_deliveries" ADD CONSTRAINT "reminder_deliveries_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "reminders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
