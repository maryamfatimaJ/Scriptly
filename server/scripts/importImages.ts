// Attaches VERIFIED product photographs to catalogue records.
//
//   npm run catalogue:images -- path/to/images.csv            (dry run)
//   npm run catalogue:images -- path/to/images.csv --apply    (writes)
//
// Each photo must be one Scriptly may show (its own photograph of a
// purchased pack, a manufacturer asset used with permission, or another
// explicitly licensed image) and must show THE EXACT product: same brand,
// strength and dosage form. A person confirms that per row
// (exact_product_confirmed = yes). There is no "similar product" fallback,
// and the same photo can never be attached to two different products.
//
// Template (header row): docs/catalogue-images-template.csv
//
// Required: generic_name, strength, dosage_form, image_file (local path,
//   relative to the CSV), kind (PACK_BOX | BLISTER | BOTTLE | CONTAINER |
//   FORMULATION | OTHER), source_name, licence, attribution,
//   permission_basis, verified_on (YYYY-MM-DD), exact_product_confirmed (yes)
// Optional: brand_name, pack_size (required when the product has several
//   packs), source_url (https)
//
// Photos are validated as real images, re-encoded as JPEG (which drops
// EXIF/GPS metadata), capped at 1600px and stored in MEDICINE_IMAGE_DIR.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { env } from "@/config/env";
import { prisma } from "@/db/prisma";
import { canonicalFormName, normalizeStrength } from "@/services/medicine.service";
import { parseCsv } from "./importPrices";

const REQUIRED = [
  "generic_name",
  "strength",
  "dosage_form",
  "image_file",
  "kind",
  "source_name",
  "licence",
  "attribution",
  "permission_basis",
  "verified_on",
  "exact_product_confirmed",
] as const;
const KINDS = ["PACK_BOX", "BLISTER", "BOTTLE", "CONTAINER", "FORMULATION", "OTHER"] as const;
const MIN_EDGE_PX = 200;
const MAX_EDGE_PX = 1600;

const clean = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

export function validateImageRow(row: Record<string, string>): string[] {
  const problems: string[] = [];
  for (const column of REQUIRED) {
    if (!clean(row[column])) problems.push(`missing ${column}`);
  }
  if (row.kind && !KINDS.includes(clean(row.kind) as (typeof KINDS)[number])) problems.push(`kind must be one of ${KINDS.join(", ")}`);
  if (row.exact_product_confirmed && clean(row.exact_product_confirmed).toLowerCase() !== "yes") {
    problems.push("exact_product_confirmed must be yes — only a photo of this exact product, strength and form may be attached");
  }
  if (row.source_url && clean(row.source_url) && !/^https:\/\//.test(clean(row.source_url))) problems.push("source_url must be an https URL");
  if (row.verified_on && !isDate(clean(row.verified_on))) problems.push("verified_on must be YYYY-MM-DD");
  return problems;
}

async function findProduct(row: Record<string, string>) {
  const form = canonicalFormName(row.dosage_form) ?? clean(row.dosage_form).toLowerCase();
  const candidates = await prisma.medicineReference.findMany({
    where: {
      isSynthetic: false,
      genericName: { equals: clean(row.generic_name), mode: "insensitive" },
      brandName: clean(row.brand_name) ? { equals: clean(row.brand_name), mode: "insensitive" } : null,
      formulation: { equals: form, mode: "insensitive" },
    },
  });
  const strength = normalizeStrength(clean(row.strength));
  const pack = clean(row.pack_size).toLowerCase().replace(/\s+/g, "");
  return candidates.filter(
    (c) =>
      normalizeStrength(c.strength ?? "") === strength &&
      (!pack || (c.packSize ?? "").toLowerCase().replace(/\s+/g, "") === pack)
  );
}

async function main() {
  const [file, ...flags] = process.argv.slice(2);
  const apply = flags.includes("--apply");
  if (!file) {
    console.error("Usage: npm run catalogue:images -- <images.csv> [--apply]");
    process.exit(2);
  }
  const baseDir = path.dirname(path.resolve(file));
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  if (rows.length < 2) {
    console.error("The file has no data rows.");
    process.exit(2);
  }
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const records = rows.slice(1).map((values) => Object.fromEntries(header.map((h, i) => [h, values[i] ?? ""])));

  const problems: string[] = [];
  const prepared: Array<{ row: Record<string, string>; productId: string; buffer: Buffer; width: number; height: number; hash: string }> = [];
  const hashOwner = new Map<string, string>();

  for (const [index, row] of records.entries()) {
    const line = index + 2;
    const rowProblems = validateImageRow(row);
    if (rowProblems.length > 0) {
      problems.push(`line ${line}: ${rowProblems.join("; ")}`);
      continue;
    }
    const matches = await findProduct(row);
    if (matches.length === 0) {
      problems.push(`line ${line}: no catalogue record for this exact product (brand, generic, strength, form${clean(row.pack_size) ? ", pack" : ""}) — import the product first`);
      continue;
    }
    if (matches.length > 1) {
      problems.push(`line ${line}: ${matches.length} packs of this product exist — add pack_size to say which pack the photo shows`);
      continue;
    }

    const imagePath = path.resolve(baseDir, clean(row.image_file));
    let buffer: Buffer;
    let width = 0;
    let height = 0;
    try {
      const meta = await sharp(imagePath).metadata();
      if (!meta.format || !["jpeg", "png", "webp"].includes(meta.format)) throw new Error("not a JPG, PNG or WebP image");
      const { data, info } = await sharp(imagePath)
        .rotate()
        .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer({ resolveWithObject: true });
      buffer = data;
      width = info.width;
      height = info.height;
    } catch (err) {
      problems.push(`line ${line}: ${clean(row.image_file)} could not be read as an image (${err instanceof Error ? err.message : err})`);
      continue;
    }
    if (Math.min(width, height) < MIN_EDGE_PX) {
      problems.push(`line ${line}: image is ${width}x${height}px — too small to show the product legibly (min ${MIN_EDGE_PX}px)`);
      continue;
    }

    const hash = crypto.createHash("sha256").update(buffer).digest("hex");
    const productId = matches[0].id;
    const earlierOwner = hashOwner.get(hash);
    const storedElsewhere = await prisma.medicineImage.findFirst({
      where: { storagePath: `${hash}.jpg`, medicineReferenceId: { not: productId } },
      select: { medicineReferenceId: true },
    });
    if ((earlierOwner && earlierOwner !== productId) || storedElsewhere) {
      problems.push(`line ${line}: this exact photo is already attached to a different product — one product's image is never reused for another`);
      continue;
    }
    hashOwner.set(hash, productId);
    prepared.push({ row, productId, buffer, width, height, hash });
  }

  if (problems.length > 0) {
    for (const p of problems.slice(0, 50)) console.error(p);
    console.error(`${problems.length} problem(s). Nothing was imported.`);
    process.exit(1);
  }

  let added = 0;
  let skipped = 0;
  for (const item of prepared) {
    const storagePath = `${item.hash}.jpg`;
    const exists = await prisma.medicineImage.findFirst({ where: { medicineReferenceId: item.productId, storagePath } });
    if (exists) {
      skipped += 1;
      continue;
    }
    added += 1;
    if (!apply) continue;
    fs.mkdirSync(path.resolve(env.medicineImageDir), { recursive: true });
    fs.writeFileSync(path.resolve(env.medicineImageDir, storagePath), item.buffer);
    await prisma.medicineImage.create({
      data: {
        medicineReferenceId: item.productId,
        kind: clean(item.row.kind) as (typeof KINDS)[number],
        storagePath,
        mimeType: "image/jpeg",
        width: item.width,
        height: item.height,
        sourceName: clean(item.row.source_name),
        sourceUrl: clean(item.row.source_url) || null,
        licence: clean(item.row.licence),
        attribution: clean(item.row.attribution),
        permissionBasis: clean(item.row.permission_basis),
        verifiedAt: new Date(`${clean(item.row.verified_on)}T00:00:00Z`),
      },
    });
  }
  console.log(`${prepared.length} valid photo(s): ${added} new, ${skipped} already attached.${apply ? "" : " Dry run — pass --apply to write."}`);
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
