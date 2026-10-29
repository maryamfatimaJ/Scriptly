// Imports Pakistani medicine CATALOGUE records (products, packs and,
// optionally, verified prices) from a CSV file.
//
//   npm run catalogue:import -- path/to/catalogue.csv            (dry run: validates and reports)
//   npm run catalogue:import -- path/to/catalogue.csv --apply    (writes)
//
// READ docs/medicine-data-sources.md FIRST. Only import data from a source
// whose reuse is permitted — every row must say why (permission_basis).
// This tool fetches nothing from any website. It normalizes, validates,
// deduplicates and upserts; it never estimates or fills in a value.
//
// Template (header row): docs/catalogue-import-template.csv
//
// Required, non-empty:
//   generic_name, active_ingredient, strength, dosage_form,
//   source_name, source_url (https), permission_basis,
//   verified_on (YYYY-MM-DD — the day a person checked the row against the source)
// Optional: brand_name, pack_size, manufacturer, registration_number
// Price block — all three or none:
//   price_pkr, price_type (OFFICIAL_MRP | RETAILER_LISTED), effective_from (YYYY-MM-DD)
//   A price requires pack_size: a price without its pack is meaningless.
//
// One row = one pack of one product. The whole file is rejected if any row
// is invalid or if two rows describe the same pack.

import fs from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { canonicalFormName, normalizeStrength } from "@/services/medicine.service";
import { parseCsv } from "./importPrices";

const REQUIRED = [
  "generic_name",
  "active_ingredient",
  "strength",
  "dosage_form",
  "source_name",
  "source_url",
  "permission_basis",
  "verified_on",
] as const;
const PRICE_BLOCK = ["price_pkr", "price_type", "effective_from"] as const;

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const clean = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

export type CatalogueRow = Record<string, string>;

/** Identity of one pack, used to find duplicates within a file. */
export function packKey(row: CatalogueRow): string {
  return [
    clean(row.brand_name).toLowerCase(),
    clean(row.generic_name).toLowerCase(),
    normalizeStrength(clean(row.strength)),
    canonicalFormName(row.dosage_form) ?? clean(row.dosage_form).toLowerCase(),
    clean(row.pack_size).toLowerCase().replace(/\s+/g, ""),
  ].join("|");
}

export function validateCatalogueRow(row: CatalogueRow): string[] {
  const problems: string[] = [];
  for (const column of REQUIRED) {
    if (!clean(row[column])) problems.push(`missing ${column}`);
  }
  if (row.strength && !/\d/.test(row.strength)) problems.push("strength must contain an amount, e.g. 500 mg");
  if (row.source_url && !/^https:\/\//.test(clean(row.source_url))) problems.push("source_url must be an https URL");
  if (row.verified_on && !isDate(clean(row.verified_on))) problems.push("verified_on must be YYYY-MM-DD");
  if (row.verified_on && isDate(clean(row.verified_on)) && new Date(`${clean(row.verified_on)}T00:00:00Z`) > new Date()) {
    problems.push("verified_on is in the future");
  }

  const priceFields = PRICE_BLOCK.filter((column) => clean(row[column]));
  if (priceFields.length > 0 && priceFields.length < PRICE_BLOCK.length) {
    problems.push(`price fields must be all present or all empty (missing ${PRICE_BLOCK.filter((c) => !clean(row[c])).join(", ")})`);
  }
  if (priceFields.length === PRICE_BLOCK.length) {
    if (!/^\d+(\.\d{1,2})?$/.test(clean(row.price_pkr)) || Number(row.price_pkr) <= 0) {
      problems.push("price_pkr must be a positive number like 123.45");
    }
    if (!["OFFICIAL_MRP", "RETAILER_LISTED"].includes(clean(row.price_type))) {
      problems.push("price_type must be OFFICIAL_MRP or RETAILER_LISTED");
    }
    if (!isDate(clean(row.effective_from))) problems.push("effective_from must be YYYY-MM-DD");
    if (!clean(row.pack_size)) problems.push("a price needs pack_size — a price without its pack is meaningless");
  }
  return problems;
}

/** Validates a whole file. Returns per-line problems, including duplicate packs. */
export function validateCatalogueFile(rows: CatalogueRow[]): Array<{ line: number; problems: string[] }> {
  const seen = new Map<string, number>();
  const invalid: Array<{ line: number; problems: string[] }> = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    const problems = validateCatalogueRow(row);
    const key = packKey(row);
    const first = seen.get(key);
    if (first) problems.push(`duplicate of line ${first} (same product and pack)`);
    else seen.set(key, line);
    if (problems.length > 0) invalid.push({ line, problems });
  });
  return invalid;
}

function toData(r: CatalogueRow) {
  const verified = new Date(`${clean(r.verified_on)}T00:00:00Z`);
  const hasPrice = PRICE_BLOCK.every((column) => clean(r[column]));
  const form = canonicalFormName(r.dosage_form) ?? clean(r.dosage_form).toLowerCase();
  return {
    genericName: clean(r.generic_name),
    brandName: clean(r.brand_name) || null,
    activeIngredient: clean(r.active_ingredient),
    strength: clean(r.strength),
    formulation: form,
    manufacturer: clean(r.manufacturer) || null,
    registrationId: clean(r.registration_number) || null,
    countryOrMarket: "Pakistan",
    packSize: clean(r.pack_size) || null,
    referencePrice: hasPrice ? new Prisma.Decimal(clean(r.price_pkr)) : null,
    currency: hasPrice ? "PKR" : null,
    priceType: hasPrice ? (clean(r.price_type) as "OFFICIAL_MRP" | "RETAILER_LISTED") : null,
    priceSource: hasPrice ? clean(r.source_name) : null,
    priceSourceUrl: hasPrice ? clean(r.source_url) : null,
    priceEffectiveFrom: hasPrice ? new Date(`${clean(r.effective_from)}T00:00:00Z`) : null,
    priceLastVerifiedAt: hasPrice ? verified : null,
    sourceUrl: clean(r.source_url),
    dataProvenance: (/\bdrap\b/i.test(r.source_name) ? "DRAP" : "OTHER") as "DRAP" | "OTHER",
    verificationStatus: "VERIFIED" as const,
    lastVerifiedAt: verified,
    isSynthetic: false,
  };
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");
  if (!file) {
    console.error("Usage: npm run catalogue:import -- <file.csv> [--apply]");
    process.exit(2);
  }

  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) {
    console.error("The file has no data rows.");
    process.exit(2);
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missingColumns = REQUIRED.filter((column) => !header.includes(column));
  if (missingColumns.length > 0) {
    console.error(`Missing columns: ${missingColumns.join(", ")}`);
    process.exit(2);
  }
  const records = rows.slice(1).map((values) => Object.fromEntries(header.map((h, i) => [h, values[i] ?? ""])));

  const invalid = validateCatalogueFile(records);
  if (invalid.length > 0) {
    // All or nothing: a half-imported catalogue can never exist.
    for (const r of invalid.slice(0, 50)) console.error(`line ${r.line}: ${r.problems.join("; ")}`);
    console.error(`${invalid.length} invalid row(s). Nothing was imported.`);
    process.exit(1);
  }

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let crossSource = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const r of records) {
        const data = toData(r);
        const identity = {
          genericName: data.genericName,
          brandName: data.brandName,
          strength: data.strength,
          formulation: data.formulation,
          packSize: data.packSize,
          dataProvenance: data.dataProvenance,
        };
        // findFirst rather than findUnique: the compound unique input
        // type does not accept null for nullable columns.
        const existing = await tx.medicineReference.findFirst({ where: { ...identity, isSynthetic: false } });
        const sameProductOtherSource = await tx.medicineReference.count({
          where: {
            isSynthetic: false,
            genericName: { equals: data.genericName, mode: "insensitive" },
            brandName: data.brandName ? { equals: data.brandName, mode: "insensitive" } : null,
            strength: data.strength,
            formulation: data.formulation,
            packSize: data.packSize,
            dataProvenance: { not: data.dataProvenance },
          },
        });
        if (sameProductOtherSource > 0) crossSource += 1;

        let id: string;
        if (!existing) {
          id = (await tx.medicineReference.create({ data })).id;
          created += 1;
        } else {
          const changed = (Object.keys(data) as Array<keyof typeof data>).some(
            (key) => String(existing[key] ?? "") !== String(data[key] ?? "")
          );
          if (!changed) {
            unchanged += 1;
            continue;
          }
          id = (await tx.medicineReference.update({ where: { id: existing.id }, data })).id;
          updated += 1;
        }
        await tx.medicineReferenceSource.create({
          data: {
            medicineReferenceId: id,
            sourceName: clean(r.source_name),
            sourceUrl: clean(r.source_url),
            permissionBasis: clean(r.permission_basis),
            fieldsProvided: Object.entries(r)
              .filter(([key, value]) => clean(value) && !["source_name", "source_url", "permission_basis", "verified_on"].includes(key))
              .map(([key]) => key),
            retrievedAt: data.lastVerifiedAt,
            notes: "Imported by scripts/importCatalogue.ts",
          },
        });
      }
      if (!apply) throw new DryRun();
    },
    { timeout: 10 * 60 * 1000 }
  ).catch((err) => {
    if (!(err instanceof DryRun)) throw err;
  });

  console.log(
    `${records.length} valid row(s): ${created} new, ${updated} updated, ${unchanged} unchanged.` +
      (crossSource ? ` ${crossSource} also exist from another source (kept separately, per provenance).` : "") +
      (apply ? "" : " Dry run — nothing was written. Pass --apply to write.")
  );
}

/** Thrown to roll back a dry run after computing its report. */
class DryRun extends Error {}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
