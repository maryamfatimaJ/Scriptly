import path from "node:path";
import { prisma } from "@/db/prisma";
import { AppError } from "@/utils/AppError";
import { env } from "@/config/env";
import { Prisma } from "@prisma/client";
import { getMonographForIngredient } from "@/services/medicineInfo/monograph.service";
import { lookupPrice, manualCheckLinksFor, toVerifiedPrice } from "@/services/medicineInfo/price.service";
import { visibleCatalogue } from "@/services/medicineInfo/catalogueVisibility";
import type { MedicineImage, MedicineReference } from "@prisma/client";

// Medicine catalogue search and detail.
//
// Search runs in PostgreSQL over indexed columns (pg_trgm GIN indexes on
// brand, generic and active ingredient — see the catalogue migration), so
// it stays fast and paginated as the catalogue grows. Nothing is searched
// in the browser and nothing comes from a hard-coded list or a model.
//
// Relevance, per field (brand, generic, ingredient — ingredient weighted
// slightly lower):
//   1.0  exact name
//   0.9  name starts with the query        ("P" → Panadol, Paracetamol…)
//   0.8  a word in the name starts with it ("potassium" → Losartan potassium)
//   0.7  substring, only for 4+ characters (stops "dip" → Amlodipine)
//   sim  trigram similarity, only for 4+ characters (misspellings)
// Rows scoring below MIN_RELEVANCE are dropped, never padded in.
//
// A strength ("500 mg") and dosage form ("tab", "syrup") typed into the
// query are recognised and applied as filters, so "panadol 500mg tablet"
// narrows to that product rather than matching the words loosely.

const MIN_RELEVANCE = 0.34;
const MIN_FUZZY_QUERY_LENGTH = 4;
export const MAX_PAGE_SIZE = 50;

// Dosage-form vocabulary, including prescription abbreviations.
const FORM_ALIASES: Record<string, string[]> = {
  tablet: ["tablet", "tablets", "tab", "tabs"],
  capsule: ["capsule", "capsules", "cap", "caps"],
  syrup: ["syrup", "syp", "syr"],
  suspension: ["suspension", "susp"],
  injection: ["injection", "inj", "injectable"],
  drops: ["drops", "drop"],
  cream: ["cream"],
  ointment: ["ointment", "oint"],
  gel: ["gel"],
  inhaler: ["inhaler"],
  sachet: ["sachet", "sachets"],
  solution: ["solution", "soln"],
  lotion: ["lotion"],
  suppository: ["suppository", "suppositories", "supp"],
  spray: ["spray"],
};

export function canonicalFormName(word: string | null | undefined): string | null {
  const key = (word ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!key) return null;
  for (const [canonical, aliases] of Object.entries(FORM_ALIASES)) {
    if (aliases.includes(key)) return canonical;
  }
  return null;
}

const STRENGTH_PATTERN = /(\d+(?:\.\d+)?)\s*(mcg|µg|ug|mg|g|ml|iu|%)(?![a-z])/i;

/** "500 mg" → "500mg"; "1.0 g" → "1g". Used only for matching, never for display. */
export function normalizeStrength(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/µg|ug/g, "mcg")
    .replace(/(\d+)\.0+(?=[a-z%])/g, "$1");
}

export interface InterpretedQuery {
  /** Name part of the query (may be empty when only a strength/form was typed). */
  name: string;
  strength: string | null;
  form: string | null;
}

/** Splits "panadol 500mg tab" into name "panadol", strength "500mg", form "tablet". */
export function interpretQuery(q: string, strength?: string | null, form?: string | null): InterpretedQuery {
  let rest = ` ${q} `;
  let foundStrength = strength?.trim() || null;
  if (!foundStrength) {
    const match = rest.match(STRENGTH_PATTERN);
    if (match) {
      foundStrength = match[0].trim();
      rest = rest.replace(match[0], " ");
    }
  }
  let foundForm = form?.trim() ? canonicalFormName(form) ?? form.trim().toLowerCase() : null;
  if (!foundForm) {
    const words = rest.split(/\s+/).filter(Boolean);
    const index = words.findIndex((word) => canonicalFormName(word));
    // A lone form word ("tab") is treated as a name, not a filter.
    if (index >= 0 && words.length > 1) {
      foundForm = canonicalFormName(words[index]);
      words.splice(index, 1);
      rest = words.join(" ");
    }
  }
  return { name: rest.replace(/\s+/g, " ").trim(), strength: foundStrength, form: foundForm };
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface CatalogueImageView {
  id: string;
  kind: string;
  url: string;
  width: number;
  height: number;
  sourceName: string;
  sourceUrl: string | null;
  licence: string;
  attribution: string;
  verifiedAt: Date;
}

function toImageView(image: MedicineImage): CatalogueImageView {
  return {
    id: image.id,
    kind: image.kind,
    // Served by the API (auth required); the stored file path is never exposed.
    url: `/medicines/${image.medicineReferenceId}/images/${image.id}`,
    width: image.width,
    height: image.height,
    sourceName: image.sourceName,
    sourceUrl: image.sourceUrl,
    licence: image.licence,
    attribution: image.attribution,
    verifiedAt: image.verifiedAt,
  };
}

export interface MedicineSearchHit {
  medicine: MedicineReference;
  score: number;
  /** Which field produced the match, so the UI can say why a row is here. */
  matchedOn: "brandName" | "genericName" | "activeIngredient" | "filter";
  image: CatalogueImageView | null;
}

export interface CatalogueSearchResult {
  interpreted: InterpretedQuery;
  hits: MedicineSearchHit[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

function fieldScore(column: Prisma.Sql, name: string, fuzzy: boolean): Prisma.Sql {
  const prefix = `${escapeLike(name)}%`;
  const contains = `%${escapeLike(name)}%`;
  const wordStart = `\\m${escapeRegex(name)}`;
  return Prisma.sql`(CASE
      WHEN lower(COALESCE(${column}, '')) = ${name} THEN 1.0
      WHEN ${column} ILIKE ${prefix} THEN 0.9
      WHEN ${column} ~* ${wordStart} THEN 0.8
      WHEN ${fuzzy} AND ${column} ILIKE ${contains} THEN 0.7
      WHEN ${fuzzy} THEN COALESCE(similarity(lower(COALESCE(${column}, '')), ${name}), 0)
      ELSE 0 END)`;
}

function nameMatches(column: Prisma.Sql, name: string, fuzzy: boolean): Prisma.Sql {
  return Prisma.sql`(${column} ILIKE ${`${escapeLike(name)}%`}
    OR ${column} ~* ${`\\m${escapeRegex(name)}`}
    OR (${fuzzy} AND (${column} ILIKE ${`%${escapeLike(name)}%`} OR ${column} % ${name})))`;
}

/**
 * Searches the medicine catalogue. Paginated; `total` counts every match,
 * not just this page. An empty result means nothing in the catalogue
 * matches — it is never padded with weak matches.
 */
export async function searchCatalogue(input: {
  q: string;
  strength?: string | null;
  form?: string | null;
  page?: number;
  pageSize?: number;
}): Promise<CatalogueSearchResult> {
  const interpreted = interpretQuery(input.q, input.strength, input.form);
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? 20));
  const empty: CatalogueSearchResult = { interpreted, hits: [], total: 0, page, pageSize, hasMore: false };
  if (!interpreted.name && !interpreted.strength && !interpreted.form) return empty;

  const name = interpreted.name.toLowerCase();
  const fuzzy = name.length >= MIN_FUZZY_QUERY_LENGTH;
  const brand = Prisma.sql`"brandName"`;
  const generic = Prisma.sql`"genericName"`;
  const ingredient = Prisma.sql`"activeIngredient"`;

  const strengthPattern = interpreted.strength
    ? `^${escapeRegex(normalizeStrength(interpreted.strength))}($|[^0-9.])`
    : null;
  const formAliases = interpreted.form ? FORM_ALIASES[interpreted.form] ?? [escapeRegex(interpreted.form)] : null;
  const formPattern = formAliases ? `\\m(${formAliases.join("|")})` : null;

  const nameFilter = name
    ? Prisma.sql`(${nameMatches(brand, name, fuzzy)} OR ${nameMatches(generic, name, fuzzy)} OR ${nameMatches(ingredient, name, fuzzy)})`
    : Prisma.sql`TRUE`;

  const scores = name
    ? Prisma.sql`${fieldScore(brand, name, fuzzy)} AS brand_score,
        ${fieldScore(generic, name, fuzzy)} AS generic_score,
        0.95 * ${fieldScore(ingredient, name, fuzzy)} AS ingredient_score`
    : Prisma.sql`1.0 AS brand_score, 0 AS generic_score, 0 AS ingredient_score`;

  const rows = await prisma.$queryRaw<
    Array<{ id: string; brand_score: number; generic_score: number; ingredient_score: number; total: bigint }>
  >(Prisma.sql`
    SELECT id, brand_score::float8 AS brand_score, generic_score::float8 AS generic_score,
           ingredient_score::float8 AS ingredient_score, COUNT(*) OVER () AS total
    FROM (
      SELECT id, "brandName", "genericName", "strength", "packSize", ${scores}
      FROM "medicine_reference"
      WHERE (${env.catalogueIncludeSynthetic} OR NOT "isSynthetic")
        AND ${nameFilter}
        AND (${strengthPattern}::text IS NULL
             OR regexp_replace(lower(COALESCE("strength", '')), '[[:space:]]+', '', 'g') ~ ${strengthPattern})
        AND (${formPattern}::text IS NULL OR COALESCE("formulation", '') ~* ${formPattern})
    ) scored
    WHERE GREATEST(brand_score, generic_score, ingredient_score) >= ${name ? MIN_RELEVANCE : 0}
    ORDER BY GREATEST(brand_score, generic_score, ingredient_score) DESC,
             lower(COALESCE("brandName", "genericName")) ASC, "strength" ASC NULLS LAST,
             "packSize" ASC NULLS LAST, id ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
  `);

  if (rows.length === 0) return empty;
  const total = Number(rows[0].total);

  const records = await prisma.medicineReference.findMany({
    where: { id: { in: rows.map((row) => row.id) } },
    include: { images: { orderBy: [{ kind: "asc" }, { createdAt: "asc" }], take: 1 } },
  });
  const byId = new Map(records.map((record) => [record.id, record]));

  const hits: MedicineSearchHit[] = [];
  for (const row of rows) {
    const record = byId.get(row.id);
    if (!record) continue;
    const { images, ...medicine } = record;
    const best = Math.max(row.brand_score, row.generic_score, row.ingredient_score);
    hits.push({
      medicine,
      score: Math.round(best * 1000) / 1000,
      matchedOn: !name
        ? "filter"
        : best === row.brand_score
          ? "brandName"
          : best === row.generic_score
            ? "genericName"
            : "activeIngredient",
      image: images[0] ? toImageView(images[0]) : null,
    });
  }

  return { interpreted, hits, total, page, pageSize, hasMore: page * pageSize < total };
}

/** First-page convenience used by Scripty's tools and the interaction checker. */
export async function searchMedicines(query: string, limit = 20): Promise<MedicineSearchHit[]> {
  if (!query.trim()) return [];
  return (await searchCatalogue({ q: query, pageSize: limit })).hits;
}

// Dosage forms we can recognise in free label text. Used only to WARN
// about a mismatch, never to correct one.
const DOSAGE_FORM_WORDS = ["tablet", "capsule", "caplet", "gelcap", "suspension", "syrup", "injection", "cream", "ointment", "drops", "inhaler", "patch", "suppository", "gel", "solution"];

// Whole words only (plural allowed): "gelcaps" is a gelcap, not a gel.
const hasFormWord = (text: string, word: string) => new RegExp(`\\b${word}s?\\b`).test(text);

/**
 * Detects when the label text we are about to show describes a different
 * dosage form from the product the user is looking at.
 *
 * This is a real hazard, not a nicety: a monograph is keyed by ACTIVE
 * INGREDIENT, so the omeprazole record for a *capsule* can legitimately
 * attach to a US label whose dosing section says "swallow 1 tablet whole,
 * do not chew or crush tablets". Silently showing that is handing a
 * patient instructions for something they are not holding. We cannot fix
 * the mismatch — we can refuse to hide it.
 */
export function detectFormMismatch(
  productForm: string | null,
  labelText: string | null | undefined
): { productForm: string; labelForms: string[] } | null {
  if (!productForm || !labelText) return null;

  const product = productForm.toLowerCase();
  const text = labelText.toLowerCase();

  const productWord = DOSAGE_FORM_WORDS.find((word) => hasFormWord(product, word));
  if (!productWord) return null;

  // If the label mentions the product's own form at all, assume it covers it.
  if (hasFormWord(text, productWord)) return null;

  const labelForms = DOSAGE_FORM_WORDS.filter((word) => word !== productWord && hasFormWord(text, word));
  if (labelForms.length === 0) return null;

  return { productForm: productWord, labelForms };
}

/**
 * Full detail for one medicine: the stored reference row, plus live
 * label information and a price lookup.
 *
 * Label text and price are fetched independently and each carries its own
 * status, because they fail independently — openFDA being slow should not
 * blank out the price section, and vice versa.
 */
export async function getMedicineById(id: string) {
  const record = await prisma.medicineReference.findFirst({
    where: { id, ...visibleCatalogue() },
    include: { sources: true, images: { orderBy: [{ kind: "asc" }, { createdAt: "asc" }] } },
  });
  if (!record) throw AppError.notFound("No verified record for this medicine.");
  const { images, sources, ...medicine } = record;

  // Other packs of the SAME product (same name, strength and form). A
  // different pack size is a different price, never interchangeable.
  // Strength and form are compared normalized: sources write "500 mg"
  // and "500mg", "Tab." and "tablet" for the same product.
  const sameName = await prisma.medicineReference.findMany({
    where: {
      ...visibleCatalogue(),
      id: { not: medicine.id },
      genericName: { equals: medicine.genericName, mode: "insensitive" },
      brandName: medicine.brandName ? { equals: medicine.brandName, mode: "insensitive" } : null,
    },
    orderBy: [{ packSize: "asc" }],
    take: 100,
  });
  const strengthKey = normalizeStrength(medicine.strength ?? "");
  const formKey = canonicalFormName(medicine.formulation) ?? (medicine.formulation ?? "").toLowerCase();
  const otherPacks = sameName
    .filter(
      (row) =>
        normalizeStrength(row.strength ?? "") === strengthKey &&
        (canonicalFormName(row.formulation) ?? (row.formulation ?? "").toLowerCase()) === formKey
    )
    .slice(0, 20);

  const [monograph, price] = await Promise.all([
    getMonographForIngredient(medicine.activeIngredient || medicine.genericName),
    lookupPrice({
      name: medicine.brandName ?? medicine.genericName,
      strength: medicine.strength,
      form: medicine.formulation,
      packSize: medicine.packSize,
    }),
  ]);

  const formMismatch =
    monograph.status === "FOUND"
      ? detectFormMismatch(medicine.formulation, monograph.monograph.howToUse)
      : null;

  return {
    medicine,
    // Product photos verified as THIS product, each with its attribution.
    // Empty means no verified photo: the UI shows a placeholder, never a stand-in.
    images: images.map(toImageView),
    packs: otherPacks.map((pack) => ({ id: pack.id, packSize: pack.packSize, price: toVerifiedPrice(pack) })),
    sources: sources.map((source) => ({
      sourceName: source.sourceName,
      sourceUrl: source.sourceUrl,
      fieldsProvided: source.fieldsProvided,
      retrievedAt: source.retrievedAt,
      permissionBasis: source.permissionBasis,
    })),
    // Information: real, sourced label text — or an explicit absence.
    information: monograph,
    // Non-null when the label's dosing text describes a different dosage
    // form from this product. Surfaced prominently in the UI.
    formMismatch,
    // Price: a verified figure — or an explicit absence with somewhere to look.
    price,
    // Stated once, here, so every surface that renders a medicine says the
    // same thing about what this data is and is not.
    disclaimer:
      "General medicine information, not personal medical advice. It does not replace your doctor's or " +
      "pharmacist's instructions. Always follow the directions on your own prescription.",
  };
}

/** Resolves one verified product photo to its file on disk, or 404s. */
export async function getMedicineImageFile(medicineId: string, imageId: string) {
  const image = await prisma.medicineImage.findFirst({
    where: { id: imageId, medicineReferenceId: medicineId, medicineReference: visibleCatalogue() },
  });
  if (!image) throw AppError.notFound("Image not found.");
  const root = path.resolve(env.medicineImageDir);
  const filePath = path.resolve(root, image.storagePath);
  // storagePath is written only by the importer, but a path is never trusted.
  if (!filePath.startsWith(root + path.sep)) throw AppError.notFound("Image not found.");
  return { filePath, mimeType: image.mimeType };
}

/** Price lookup for a medicine identified by name rather than by id (used by Scripty). */
export async function lookupPriceByName(input: {
  name: string;
  strength?: string | null;
  form?: string | null;
}) {
  return lookupPrice(input);
}

export { manualCheckLinksFor };

// Brands offered as one-click examples on the Medicine Info page. A
// suggestion is returned only when a real (non-synthetic) record for that
// exact brand exists, and it links to that record — never to a search
// that might come back empty.
const SUGGESTED_BRANDS = ["Panadol Extend", "Brufen DS", "Risek"];

export async function getSuggestions() {
  const suggestions: Array<{ id: string; label: string; detail: string }> = [];
  for (const brand of SUGGESTED_BRANDS) {
    const record = await prisma.medicineReference.findFirst({
      where: { ...visibleCatalogue(), isSynthetic: false, brandName: { equals: brand, mode: "insensitive" } },
      orderBy: [{ packSize: "asc" }],
    });
    if (record) {
      suggestions.push({
        id: record.id,
        label: record.brandName ?? record.genericName,
        detail: [record.strength, record.formulation].filter(Boolean).join(" "),
      });
    }
  }
  return suggestions;
}
