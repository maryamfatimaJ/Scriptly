-- CreateEnum
CREATE TYPE "MedicineMatchStatus" AS ENUM ('NOT_EVALUATED', 'VERIFIED_MATCH', 'POSSIBLE_MATCH', 'MULTIPLE_MATCHES', 'NO_VERIFIED_RECORD');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PrescriptionEventType" ADD VALUE 'EXTRACTION_RETRY_BLOCKED';
ALTER TYPE "PrescriptionEventType" ADD VALUE 'MEDICINE_MATCHING_COMPLETED';

-- AlterTable
ALTER TABLE "medications" ADD COLUMN     "confirmedBrand" TEXT,
ADD COLUMN     "confirmedGenericName" TEXT,
ADD COLUMN     "confirmedInstructions" TEXT,
ADD COLUMN     "confirmedRoute" TEXT,
ADD COLUMN     "extractedBrand" TEXT,
ADD COLUMN     "extractedGenericName" TEXT,
ADD COLUMN     "extractedInstructions" TEXT,
ADD COLUMN     "extractedRoute" TEXT,
ADD COLUMN     "extractionFieldConfidence" JSONB,
ADD COLUMN     "referenceMatchCandidates" JSONB,
ADD COLUMN     "referenceMatchStatus" "MedicineMatchStatus" NOT NULL DEFAULT 'NOT_EVALUATED';

-- AlterTable
ALTER TABLE "prescriptions" ADD COLUMN     "extractionAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "extractionOverallConfidence" DOUBLE PRECISION,
ADD COLUMN     "extractionOverallWarnings" JSONB;
