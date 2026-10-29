import { prisma } from "@/db/prisma";
import { env } from "@/config/env";
import { fetchLabelByIngredient, OpenFdaError } from "./openFdaClient";
import type { MedicineMonograph } from "@prisma/client";

// Monograph lookup with a read-through cache.
//
// The cache exists for two reasons beyond speed: it keeps our request rate
// to a free public API low, and it means a brief upstream outage degrades
// to "slightly stale information" rather than "no information".
//
// Every path through this module returns either sourced text or an
// explicit, attributed absence. There is no branch that invents content.

const SOURCE_NAME = "openFDA (U.S. FDA drug label)";

// Pakistan prescribes in INN/BAN names; openFDA indexes US labels under
// USAN. Without this map the most commonly dispensed medicine in the
// country — Paracetamol — returns "no information available", because
// its US label is published as Acetaminophen. The application's own seed
// data already records "Paracetamol (Acetaminophen)", so the knowledge
// was present but unused at lookup time.
//
// These are name synonyms for the SAME molecule, not therapeutic
// substitutions. Nothing may be added here that changes which drug is
// being described.
const INGREDIENT_SYNONYMS: Record<string, string> = {
  paracetamol: "acetaminophen",
  salbutamol: "albuterol",
  adrenaline: "epinephrine",
  noradrenaline: "norepinephrine",
  lignocaine: "lidocaine",
  frusemide: "furosemide",
  rifampicin: "rifampin",
  ciclosporin: "cyclosporine",
  glibenclamide: "glyburide",
  amoxycillin: "amoxicillin",
  cephalexin: "cefalexin",
  oestradiol: "estradiol",
  pethidine: "meperidine",
  trimethoprimsulfamethoxazole: "sulfamethoxazole and trimethoprim",
  "co-trimoxazole": "sulfamethoxazole and trimethoprim",
  thyroxine: "levothyroxine",
  phenobarbitone: "phenobarbital",
  dicyclomine: "dicycloverine",
  beclomethasone: "beclometasone",
};

export type MonographLookup =
  | { status: "FOUND"; monograph: MedicineMonograph; stale: boolean }
  | { status: "NOT_AVAILABLE"; ingredient: string; reason: string }
  | { status: "LOOKUP_FAILED"; ingredient: string; reason: string };

/**
 * Normalizes an ingredient into the cache key, resolving INN/BAN names
 * to the USAN spelling openFDA indexes under.
 */
export function ingredientKeyFor(ingredient: string): string {
  const normalized = ingredient
    .toLowerCase()
    .replace(/\(.*?\)/g, " ") // drop parenthetical synonyms, e.g. "Paracetamol (Acetaminophen)"
    .replace(/\b(hydrochloride|hcl|sodium|potassium|calcium|besylate|maleate|sulfate|sulphate|tartrate|citrate|acetate|phosphate|succinate|fumarate|mesylate|dihydrate|monohydrate|anhydrous)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return INGREDIENT_SYNONYMS[normalized] ?? normalized;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/**
 * Resolves label information for an active ingredient, consulting the
 * cache first and openFDA second.
 *
 * On an upstream failure with a cached copy available, the cached copy is
 * returned marked `stale: true` — the caller decides whether to say so.
 * On an upstream failure with nothing cached, the result is
 * LOOKUP_FAILED, which is deliberately distinct from NOT_AVAILABLE:
 * "we could not check" and "there is no label" are different claims and
 * the user is entitled to know which one applies.
 */
export async function getMonographForIngredient(ingredient: string): Promise<MonographLookup> {
  const key = ingredientKeyFor(ingredient);
  if (!key) {
    return { status: "NOT_AVAILABLE", ingredient, reason: "No active ingredient is recorded for this medicine." };
  }

  const cached = await prisma.medicineMonograph.findUnique({ where: { ingredientKey: key } });
  if (cached && cached.retrievedAt > daysAgo(env.monographCacheDays)) {
    return { status: "FOUND", monograph: cached, stale: false };
  }

  const cachedMiss = await prisma.monographLookupMiss.findUnique({ where: { ingredientKey: key } });
  if (!cached && cachedMiss && cachedMiss.checkedAt > daysAgo(env.monographMissCacheDays)) {
    return {
      status: "NOT_AVAILABLE",
      ingredient,
      reason: cachedMiss.reason ?? `No published ${SOURCE_NAME} was found for "${ingredient}".`,
    };
  }

  let label;
  try {
    label = await fetchLabelByIngredient(key);
  } catch (err) {
    // Never log the ingredient alongside a user — this is health data.
    const kind = err instanceof OpenFdaError ? err.kind : "UNKNOWN";
    console.warn(`[monograph] openFDA lookup failed (${kind})`);

    if (cached) return { status: "FOUND", monograph: cached, stale: true };
    return {
      status: "LOOKUP_FAILED",
      ingredient,
      reason:
        err instanceof OpenFdaError
          ? err.message
          : "Medicine information could not be retrieved right now. Please try again shortly.",
    };
  }

  if (!label) {
    const reason =
      `No published ${SOURCE_NAME} was found for "${ingredient}". This is common for medicines ` +
      `marketed in Pakistan but not in the United States.`;
    await prisma.monographLookupMiss.upsert({
      where: { ingredientKey: key },
      update: { checkedAt: new Date(), sourceName: SOURCE_NAME, reason },
      create: { ingredientKey: key, checkedAt: new Date(), sourceName: SOURCE_NAME, reason },
    });
    return { status: "NOT_AVAILABLE", ingredient, reason };
  }

  const data = {
    displayName: label.displayName,
    market: "US" as const,
    uses: label.uses ?? null,
    howToUse: label.howToUse ?? null,
    sideEffects: label.sideEffects ?? null,
    whenToStop: label.whenToStop ?? null,
    warnings: label.warnings ?? null,
    precautions: label.precautions ?? null,
    contraindications: label.contraindications ?? null,
    storage: label.storage ?? null,
    sourceName: SOURCE_NAME,
    sourceUrl: label.sourceUrl ?? null,
    labelUpdatedAt: label.labelUpdatedAt ?? null,
    retrievedAt: new Date(),
  };

  const monograph = await prisma.medicineMonograph.upsert({
    where: { ingredientKey: key },
    update: data,
    create: { ingredientKey: key, ...data },
  });

  // A previously-cached miss is now resolved.
  await prisma.monographLookupMiss.deleteMany({ where: { ingredientKey: key } });

  return { status: "FOUND", monograph, stale: false };
}
