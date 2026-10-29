// Measures the medicine catalogue from the actual database.
//
//   npm run catalogue:report
//
// Every figure is a COUNT of stored rows — nothing is estimated. Synthetic
// rows (seed data, test fixtures) are counted separately and excluded
// from every coverage figure.

import { prisma } from "@/db/prisma";

async function main() {
  const real = { isSynthetic: false };
  const [
    totalRows,
    syntheticRows,
    realRows,
    pakistanRows,
    verifiedRows,
    pricedRows,
    officialMrpRows,
    retailerRows,
    packRows,
    manufacturerRows,
    registrationRows,
    productsWithImages,
    imageCount,
    byProvenance,
    bySource,
  ] = await Promise.all([
    prisma.medicineReference.count(),
    prisma.medicineReference.count({ where: { isSynthetic: true } }),
    prisma.medicineReference.count({ where: real }),
    prisma.medicineReference.count({ where: { ...real, countryOrMarket: { equals: "Pakistan", mode: "insensitive" } } }),
    prisma.medicineReference.count({ where: { ...real, verificationStatus: "VERIFIED" } }),
    prisma.medicineReference.count({
      where: { ...real, referencePrice: { not: null }, currency: { not: null }, priceType: { not: null } },
    }),
    prisma.medicineReference.count({ where: { ...real, referencePrice: { not: null }, priceType: "OFFICIAL_MRP" } }),
    prisma.medicineReference.count({ where: { ...real, referencePrice: { not: null }, priceType: "RETAILER_LISTED" } }),
    prisma.medicineReference.count({ where: { ...real, packSize: { not: null } } }),
    prisma.medicineReference.count({ where: { ...real, manufacturer: { not: null } } }),
    prisma.medicineReference.count({ where: { ...real, registrationId: { not: null } } }),
    prisma.medicineReference.count({ where: { ...real, images: { some: {} } } }),
    prisma.medicineImage.count({ where: { medicineReference: real } }),
    prisma.medicineReference.groupBy({ by: ["dataProvenance"], where: real, _count: true }),
    prisma.medicineReferenceSource.groupBy({ by: ["sourceName"], where: { medicineReference: real }, _count: true }),
  ]);

  // Duplicates: real rows describing the same pack (same brand, generic,
  // strength, form and pack), normally because two sources both list it.
  const [dup] = await prisma.$queryRaw<Array<{ products: bigint; duplicate_rows: bigint }>>`
    SELECT COUNT(*) AS products, COALESCE(SUM(n - 1), 0) AS duplicate_rows FROM (
      SELECT COUNT(*) AS n FROM "medicine_reference"
      WHERE NOT "isSynthetic"
      GROUP BY lower(COALESCE("brandName", '')), lower("genericName"),
               regexp_replace(lower(COALESCE("strength", '')), '[[:space:]]+', '', 'g'),
               lower(COALESCE("formulation", '')), lower(regexp_replace(COALESCE("packSize", ''), '[[:space:]]+', '', 'g'))
    ) g`;
  const [distinct] = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT COUNT(DISTINCT (lower(COALESCE("brandName", '')), lower("genericName"),
           regexp_replace(lower(COALESCE("strength", '')), '[[:space:]]+', '', 'g'), lower(COALESCE("formulation", '')))) AS n
    FROM "medicine_reference" WHERE NOT "isSynthetic"`;

  const pct = (n: number) => (realRows ? `${((n / realRows) * 100).toFixed(1)}%` : "n/a");
  const report = {
    measuredAt: new Date().toISOString(),
    rows: { total: totalRows, synthetic: syntheticRows, real: realRows },
    real: {
      pakistanMarket: pakistanRows,
      distinctProducts: Number(distinct?.n ?? 0),
      verifiedRecords: verifiedRows,
      verifiedPrices: pricedRows,
      officialMrp: officialMrpRows,
      retailerListed: retailerRows,
      withPackSize: packRows,
      withManufacturer: manufacturerRows,
      withRegistrationNo: registrationRows,
      productsWithImages,
      images: imageCount,
      duplicateRows: Number(dup?.duplicate_rows ?? 0),
      duplicateRate: realRows ? Number(dup?.duplicate_rows ?? 0) / realRows : 0,
    },
    byProvenance: Object.fromEntries(byProvenance.map((g) => [g.dataProvenance, g._count])),
    bySource: Object.fromEntries(bySource.map((g) => [g.sourceName, g._count])),
  };

  console.log(JSON.stringify(report, null, 2));
  console.log(
    `\nReal catalogue rows: ${realRows} (synthetic, hidden from users: ${syntheticRows}).` +
      `\nPakistan market ${pct(pakistanRows)} · verified prices ${pct(pricedRows)} · pack size ${pct(packRows)}` +
      ` · with photo ${pct(productsWithImages)} · duplicates ${pct(report.real.duplicateRows)}.`
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
