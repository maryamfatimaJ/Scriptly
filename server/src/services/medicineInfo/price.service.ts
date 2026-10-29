import { prisma } from "@/db/prisma";
import type { MedicineReference, PriceType } from "@prisma/client";
import { visibleCatalogue } from "./catalogueVisibility";

// Pakistan medicine price lookup.
//
// READ THIS BEFORE ADDING A DATA SOURCE.
//
// Pakistani retail prices are set by DRAP (the Drug Regulatory Authority
// of Pakistan), which publishes them as notified maximum retail prices.
// Two public sites — medira.pk and dawacheck.pk — republish that list in a
// convenient form. Neither offers an API, a dataset download, or a data
// licence; both state plainly that their price data is transcribed from
// DRAP. dawacheck.pk's terms additionally forbid "copying the whole
// database", and its robots.txt disallows Anthropic's crawlers by name.
//
// The project owner has not authorised a DRAP import, and the licensing
// position for republishing that data inside this application is
// unresolved. So this service imports NOTHING. It reads only prices that
// are already in medicine_reference, and when it has no verified match it
// says so and hands the user a link to check the price at the source.
// That is the honest behaviour, and it is also the behaviour that stays
// correct if the licensing question is never resolved.
//
// To enable real prices later: obtain written permission (or an official
// DRAP dataset), then write an importer that populates referencePrice,
// currency, packSize, priceType, priceSource, priceSourceUrl and
// priceEffectiveFrom together. This service then starts returning hits
// with no change required here.

export interface PriceQuery {
  name: string;
  /** Strength as written, e.g. "500 mg". A different strength is a different product. */
  strength?: string | null;
  /** Dosage form, e.g. "tablet", "syrup". */
  form?: string | null;
  packSize?: string | null;
}

export interface NearMiss {
  name: string;
  strength: string | null;
  formulation: string | null;
  packSize: string | null;
}

export interface VerifiedPrice {
  medicineId: string;
  brandName: string | null;
  genericName: string;
  activeIngredient: string;
  strength: string | null;
  formulation: string | null;
  packSize: string | null;
  amount: string;
  currency: string;
  priceType: PriceType;
  /** Human-readable explanation of exactly what the amount buys. */
  priceBasis: string;
  sourceName: string | null;
  sourceUrl: string | null;
  effectiveFrom: Date | null;
  lastVerifiedAt: Date | null;
}

export interface ManualCheckLink {
  label: string;
  url: string;
  note: string;
}

export type PriceLookupResult =
  | { status: "VERIFIED"; price: VerifiedPrice; alternatives: VerifiedPrice[] }
  | {
      status: "UNAVAILABLE";
      query: PriceQuery;
      reason: string;
      /** Rows matching the name but NOT the strength/form/pack. Never presented as the price. */
      nearMisses: NearMiss[];
      manualCheck: ManualCheckLink[];
    };

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Compares two strengths by VALUE AND UNIT rather than string equality, so
 * "500mg" and "500 mg" agree while "500 mg" and "250 mg" do not.
 *
 * Returns null when either side cannot be parsed. Callers must treat null
 * as "cannot confirm a match" — never as a match. Quoting the wrong
 * strength's price is worse than quoting no price at all.
 */
export function strengthsMatch(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const parse = (value: string | null | undefined) => {
    if (!value) return null;
    const match = value.toLowerCase().replace(/\s+/g, "").match(/^([\d.]+)(mcg|ug|mg|g|ml|iu|%)/);
    if (!match) return null;
    let amount = Number(match[1]);
    let unit = match[2];
    if (Number.isNaN(amount)) return null;
    // Normalize mass units to micrograms so 1 g and 1000 mg compare equal.
    if (unit === "g") {
      amount *= 1_000_000;
      unit = "mcg";
    } else if (unit === "mg") {
      amount *= 1_000;
      unit = "mcg";
    } else if (unit === "ug") {
      unit = "mcg";
    }
    return { amount, unit };
  };

  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;
  return left.amount === right.amount && left.unit === right.unit;
}

// Prescription abbreviations for the same dosage form.
const FORM_SYNONYMS: Record<string, string> = {
  tab: "tablet",
  tabs: "tablet",
  tablets: "tablet",
  cap: "capsule",
  caps: "capsule",
  capsules: "capsule",
  syp: "syrup",
  syr: "syrup",
  susp: "suspension",
  inj: "injection",
};

function canonicalForm(value: string | null | undefined): string {
  const key = normalize(value);
  return FORM_SYNONYMS[key] ?? key;
}

/** "Tab." and "tablet" agree; "tablet" and "syrup" never do. */
export function formsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = canonicalForm(a);
  return Boolean(left) && left === canonicalForm(b);
}

function toNearMiss(row: MedicineReference): NearMiss {
  return {
    name: row.brandName ?? row.genericName,
    strength: row.strength,
    formulation: row.formulation,
    packSize: row.packSize,
  };
}

export function toVerifiedPrice(row: MedicineReference): VerifiedPrice | null {
  // A price is only usable if we know the amount, the currency, and
  // whether it is an official ceiling or a retailer's listing. A row
  // missing any of those is not a price we are willing to quote.
  if (!row.referencePrice || !row.currency || !row.priceType) return null;

  const amount = row.referencePrice.toString();
  // Never let a pack price be mistaken for a per-unit price.
  const priceBasis = row.packSize
    ? `${row.currency} ${amount} for the full pack (${row.packSize}) — this is not a per-unit price.`
    : `${row.currency} ${amount}. The pack size for this price is not recorded, so it cannot be assumed to be a per-unit price.`;

  return {
    medicineId: row.id,
    brandName: row.brandName,
    genericName: row.genericName,
    activeIngredient: row.activeIngredient,
    strength: row.strength,
    formulation: row.formulation,
    packSize: row.packSize,
    amount,
    currency: row.currency,
    priceType: row.priceType,
    priceBasis,
    sourceName: row.priceSource,
    sourceUrl: row.priceSourceUrl,
    effectiveFrom: row.priceEffectiveFrom,
    lastVerifiedAt: row.priceLastVerifiedAt,
  };
}

/** Deep-links to a letter index when we can, the hub otherwise. */
function medicineIndexUrl(base: string, name: string): string {
  const letter = name.trim().charAt(0).toLowerCase();
  return /[a-z]/.test(letter) ? `${base}/${letter}/` : `${base}/`;
}

/**
 * Where a user can check a Pakistani price by hand.
 * These are outbound links only — no data from these sites is copied,
 * stored, or re-served by this application.
 */
export function manualCheckLinksFor(name: string): ManualCheckLink[] {
  return [
    {
      label: "DRAP — official regulator",
      url: "https://www.dra.gov.pk/",
      note: "The authority that notifies maximum retail prices in Pakistan.",
    },
    {
      // Deliberately the A-Z index, not a search URL. /search?q= returns
      // 404 — medira.pk publishes no documented search endpoint, and
      // guessing one produced a dead link in the UI.
      label: "Browse medira.pk",
      url: medicineIndexUrl("https://www.medira.pk/medicines/letter", name),
      note: "Third-party site republishing DRAP prices. Check against DRAP before relying on it.",
    },
    {
      label: "Browse dawacheck.pk",
      url: medicineIndexUrl("https://dawacheck.pk/medicines", name),
      note: "Third-party DRAP price index. Check against DRAP before relying on it.",
    },
  ];
}

/**
 * Looks up a verified Pakistan-market price.
 *
 * Matching is deliberately strict: a brand name alone is never enough,
 * because "Panadol 500 mg tablet" and "Panadol 120 mg/5 ml syrup" are
 * different products at different prices. A row whose strength, form or
 * pack size disagrees comes back as a near miss, so the UI can say "we
 * have this brand, but not in that strength" — useful information —
 * without ever presenting it as the answer.
 */
export async function lookupPrice(query: PriceQuery): Promise<PriceLookupResult> {
  const name = query.name.trim();
  if (!name) {
    return {
      status: "UNAVAILABLE",
      query,
      reason: "No medicine name was provided.",
      nearMisses: [],
      manualCheck: [],
    };
  }

  const candidates = await prisma.medicineReference.findMany({
    where: {
      ...visibleCatalogue(),
      countryOrMarket: { equals: "Pakistan", mode: "insensitive" },
      OR: [
        { brandName: { equals: name, mode: "insensitive" } },
        { genericName: { equals: name, mode: "insensitive" } },
        { brandName: { contains: name, mode: "insensitive" } },
        { genericName: { contains: name, mode: "insensitive" } },
      ],
    },
    take: 50,
  });

  const priced = candidates.filter((row) => row.referencePrice !== null);

  const exact: VerifiedPrice[] = [];
  const misses: NearMiss[] = [];

  // Without a strength and a dosage form there is no single product to
  // price: "Panadol" alone covers 500 mg tablets, 120 mg/5 ml syrup and
  // more. Report what exists as near misses instead of picking one.
  if (!query.strength || !query.form) {
    return {
      status: "UNAVAILABLE",
      query,
      reason: `The ${!query.strength ? "strength" : "dosage form"} isn't recorded for this medicine, so Scriptly can't tell which product to price. Confirm it on the prescription to look up an exact price.`,
      nearMisses: priced.slice(0, 5).map(toNearMiss),
      manualCheck: manualCheckLinksFor(name),
    };
  }

  const target = normalize(name);
  for (const row of priced) {
    // The NAME must match exactly (brand or generic). A partial match is
    // a different product: "Panadol" is not "Panadol Extra", which adds
    // caffeine. Such rows are shown only as near misses.
    if (normalize(row.brandName) !== target && normalize(row.genericName) !== target) {
      misses.push(toNearMiss(row));
      continue;
    }
    // Strength must positively agree. strengthsMatch returning null means
    // "couldn't parse" — not a match.
    if (strengthsMatch(query.strength, row.strength) !== true) {
      misses.push(toNearMiss(row));
      continue;
    }
    if (!formsMatch(query.form, row.formulation)) {
      misses.push(toNearMiss(row));
      continue;
    }
    if (query.packSize && normalize(query.packSize) !== normalize(row.packSize)) {
      misses.push(toNearMiss(row));
      continue;
    }

    const verified = toVerifiedPrice(row);
    if (verified) exact.push(verified);
    else misses.push(toNearMiss(row));
  }

  if (exact.length > 0) {
    // Prefer an official notified price over a retailer listing.
    const rank = (p: VerifiedPrice) => (p.priceType === "OFFICIAL_MRP" ? 0 : 1);
    exact.sort((a, b) => rank(a) - rank(b));
    return { status: "VERIFIED", price: exact[0], alternatives: exact.slice(1, 6) };
  }

  const reason =
    candidates.length === 0
      ? `No Pakistan-market record for "${name}" exists in Scriptly's reference database yet.`
      : misses.length > 0
        ? `Scriptly has a record for "${name}", but no verified price for this exact strength, form and pack size.`
        : `Scriptly has a record for "${name}", but no verified price is attached to it.`;

  return {
    status: "UNAVAILABLE",
    query,
    reason,
    nearMisses: misses.slice(0, 5),
    manualCheck: manualCheckLinksFor(name),
  };
}
