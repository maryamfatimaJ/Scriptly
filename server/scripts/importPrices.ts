// Imports VERIFIED Pakistani medicine prices from a CSV file.
//
//   npm run prices:import -- path/to/prices.csv            (dry run: validates and reports)
//   npm run prices:import -- path/to/prices.csv --apply    (writes)
//
// READ docs/medicine-data-sources.md FIRST. This tool exists so that real
// prices can be loaded the moment a permitted source exists — written
// permission from DRAP or a republisher, or a person transcribing entries
// from DRAP's public Drug Pricing Index under such permission. It does not
// fetch anything from anywhere. It never estimates, and a row missing any
// required field is rejected rather than partly imported.
//
// Template (header row): docs/price-import-template.csv
//
// Required columns, all non-empty:
//   brand_name, generic_name, active_ingredient, strength, dosage_form,
//   pack_size, price_pkr, price_type (OFFICIAL_MRP | RETAILER_LISTED),
//   source_name, source_url (https), effective_from (YYYY-MM-DD),
//   verified_on (YYYY-MM-DD — the day a person checked it against the source)
// Optional: registration_number, manufacturer

import fs from "node:fs";
import { Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";

const REQUIRED = [
  "brand_name",
  "generic_name",
  "active_ingredient",
  "strength",
  "dosage_form",
  "pack_size",
  "price_pkr",
  "price_type",
  "source_name",
  "source_url",
  "effective_from",
  "verified_on",
] as const;

/** Minimal RFC 4180 CSV parser: quoted fields, escaped quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim() !== "")) rows.push(row);
  return rows;
}

const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function validateRow(record: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const column of REQUIRED) {
    if (!record[column]?.trim()) problems.push(`missing ${column}`);
  }
  if (record.price_pkr && !/^\d+(\.\d{1,2})?$/.test(record.price_pkr.trim())) problems.push("price_pkr must be a number like 123.45");
  if (record.price_pkr && Number(record.price_pkr) <= 0) problems.push("price_pkr must be greater than 0");
  if (record.price_type && !["OFFICIAL_MRP", "RETAILER_LISTED"].includes(record.price_type.trim())) {
    problems.push("price_type must be OFFICIAL_MRP or RETAILER_LISTED");
  }
  if (record.source_url && !/^https:\/\//.test(record.source_url.trim())) problems.push("source_url must be an https URL");
  for (const column of ["effective_from", "verified_on"] as const) {
    if (record[column] && !isDate(record[column].trim())) problems.push(`${column} must be YYYY-MM-DD`);
  }
  if (record.verified_on && isDate(record.verified_on) && new Date(`${record.verified_on}T00:00:00Z`) > new Date()) {
    problems.push("verified_on is in the future");
  }
  return problems;
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");
  if (!file) {
    console.error("Usage: npm run prices:import -- <file.csv> [--apply]");
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

  const records = rows.slice(1).map((values) => Object.fromEntries(header.map((h, i) => [h, (values[i] ?? "").trim()])));
  const invalid = records
    .map((record, index) => ({ line: index + 2, problems: validateRow(record) }))
    .filter((r) => r.problems.length > 0);

  if (invalid.length > 0) {
    // All or nothing: a file with any bad row is not imported at all, so
    // a half-imported price list can never exist.
    for (const r of invalid.slice(0, 50)) console.error(`line ${r.line}: ${r.problems.join("; ")}`);
    console.error(`${invalid.length} invalid row(s). Nothing was imported.`);
    process.exit(1);
  }

  console.log(`${records.length} valid row(s).${apply ? "" : " Dry run — pass --apply to write them."}`);
  if (!apply) return;

  for (const r of records) {
    const provenance = /\bdrap\b/i.test(r.source_name) ? "DRAP" : "OTHER";
    const data = {
      genericName: r.generic_name,
      brandName: r.brand_name,
      activeIngredient: r.active_ingredient,
      strength: r.strength,
      formulation: r.dosage_form.toLowerCase(),
      manufacturer: r.manufacturer || null,
      registrationId: r.registration_number || null,
      countryOrMarket: "Pakistan",
      packSize: r.pack_size,
      referencePrice: new Prisma.Decimal(r.price_pkr),
      currency: "PKR",
      priceType: r.price_type as "OFFICIAL_MRP" | "RETAILER_LISTED",
      priceSource: r.source_name,
      priceSourceUrl: r.source_url,
      priceEffectiveFrom: new Date(`${r.effective_from}T00:00:00Z`),
      priceLastVerifiedAt: new Date(`${r.verified_on}T00:00:00Z`),
      sourceUrl: r.source_url,
      dataProvenance: provenance as "DRAP" | "OTHER",
      verificationStatus: "VERIFIED" as const,
      lastVerifiedAt: new Date(`${r.verified_on}T00:00:00Z`),
    };
    const saved = await prisma.medicineReference.upsert({
      where: {
        uniq_medicine_identity_per_source: {
          genericName: data.genericName,
          brandName: data.brandName,
          strength: data.strength,
          formulation: data.formulation,
          packSize: data.packSize,
          dataProvenance: data.dataProvenance,
        },
      },
      create: data,
      update: data,
    });
    await prisma.medicineReferenceSource.create({
      data: {
        medicineReferenceId: saved.id,
        sourceName: r.source_name,
        sourceUrl: r.source_url,
        fieldsProvided: ["packSize", "referencePrice", "priceType", "priceEffectiveFrom", "registrationId"],
        retrievedAt: data.priceLastVerifiedAt,
        notes: "Imported by scripts/importPrices.ts",
      },
    });
  }
  console.log(`Imported ${records.length} price record(s).`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
