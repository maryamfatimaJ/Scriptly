-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('OFFICIAL_MRP', 'RETAILER_LISTED');

-- CreateEnum
CREATE TYPE "LabelMarket" AS ENUM ('US', 'PAKISTAN', 'INTERNATIONAL');

-- AlterTable
ALTER TABLE "medicine_reference" ADD COLUMN     "packSize" TEXT,
ADD COLUMN     "priceEffectiveFrom" TIMESTAMP(3),
ADD COLUMN     "priceType" "PriceType";

-- CreateTable
CREATE TABLE "medicine_monographs" (
    "id" TEXT NOT NULL,
    "ingredientKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "market" "LabelMarket" NOT NULL,
    "uses" TEXT,
    "howToUse" TEXT,
    "sideEffects" TEXT,
    "warnings" TEXT,
    "precautions" TEXT,
    "contraindications" TEXT,
    "storage" TEXT,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "labelUpdatedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medicine_monographs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monograph_lookup_misses" (
    "ingredientKey" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "monograph_lookup_misses_pkey" PRIMARY KEY ("ingredientKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "medicine_monographs_ingredientKey_key" ON "medicine_monographs"("ingredientKey");

-- CreateIndex
CREATE INDEX "medicine_monographs_market_idx" ON "medicine_monographs"("market");
