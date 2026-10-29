-- pg_trgm backs the trigram indexes below (prefix/substring/misspelling search).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateEnum
CREATE TYPE "MedicineImageKind" AS ENUM ('PACK_BOX', 'BLISTER', 'BOTTLE', 'CONTAINER', 'FORMULATION', 'OTHER');

-- DropIndex
DROP INDEX "medicine_reference_genericName_brandName_strength_formulati_key";

-- AlterTable
ALTER TABLE "medicine_reference" ADD COLUMN     "isSynthetic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "medicine_reference_sources" ADD COLUMN     "permissionBasis" TEXT;

-- CreateTable
CREATE TABLE "medicine_images" (
    "id" TEXT NOT NULL,
    "medicineReferenceId" TEXT NOT NULL,
    "kind" "MedicineImageKind" NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "licence" TEXT NOT NULL,
    "attribution" TEXT NOT NULL,
    "permissionBasis" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medicine_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "medicine_images_medicineReferenceId_idx" ON "medicine_images"("medicineReferenceId");

-- CreateIndex
CREATE INDEX "medicine_reference_isSynthetic_idx" ON "medicine_reference"("isSynthetic");

-- CreateIndex
CREATE INDEX "medicine_reference_brand_trgm" ON "medicine_reference" USING GIN ("brandName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "medicine_reference_generic_trgm" ON "medicine_reference" USING GIN ("genericName" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "medicine_reference_ingredient_trgm" ON "medicine_reference" USING GIN ("activeIngredient" gin_trgm_ops);

-- CreateIndex
CREATE UNIQUE INDEX "medicine_reference_genericName_brandName_strength_formulati_key" ON "medicine_reference"("genericName", "brandName", "strength", "formulation", "packSize", "dataProvenance");

-- AddForeignKey
ALTER TABLE "medicine_images" ADD CONSTRAINT "medicine_images_medicineReferenceId_fkey" FOREIGN KEY ("medicineReferenceId") REFERENCES "medicine_reference"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The only existing reference rows are the ten generic medicines created by
-- prisma/seed.ts for local development: MANUAL provenance, no market, no
-- price, never verified, no recorded source. Mark exactly those as
-- synthetic so they leave the normal app. Rows are kept (not deleted)
-- because development/test medications link to them.
UPDATE "medicine_reference" m
SET "isSynthetic" = true
WHERE m."dataProvenance" = 'MANUAL'
  AND m."countryOrMarket" IS NULL
  AND m."verificationStatus" = 'UNVERIFIED'
  AND m."referencePrice" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "medicine_reference_sources" s WHERE s."medicineReferenceId" = m.id);
