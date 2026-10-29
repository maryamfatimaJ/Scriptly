import { env } from "@/config/env";

// Live client for openFDA's drug label endpoint.
// https://open.fda.gov/apis/drug/label/
//
// Why this source: it is a documented public API over U.S. FDA structured
// product labels, it is U.S. Government public domain (openFDA's terms
// place no restriction on reuse), and it needs no API key for the volumes
// this application generates. That combination is rare — most consumer
// drug databases are either licensed or scrape-only.
//
// What it is NOT: Pakistani product information. openFDA describes the
// U.S. market. Every record this client returns carries market "US" so
// the UI can say so plainly rather than implying a local leaflet. See
// docs/medicine-data-sources.md.

const OPENFDA_LABEL_ENDPOINT = "https://api.fda.gov/drug/label.json";
const CANDIDATE_LIMIT = 10;

export interface OpenFdaLabel {
  displayName: string;
  uses?: string;
  howToUse?: string;
  sideEffects?: string;
  whenToStop?: string;
  warnings?: string;
  precautions?: string;
  contraindications?: string;
  storage?: string;
  sourceUrl?: string;
  labelUpdatedAt?: Date;
}

interface OpenFdaRawResult {
  id?: string;
  set_id?: string;
  effective_time?: string;
  indications_and_usage?: string[];
  dosage_and_administration?: string[];
  adverse_reactions?: string[];
  warnings?: string[];
  warnings_and_cautions?: string[];
  precautions?: string[];
  contraindications?: string[];
  storage_and_handling?: string[];
  drug_interactions?: string[];
  // Over-the-counter labels use the consumer "Drug Facts" layout and
  // carry no adverse_reactions / precautions sections at all. Their
  // equivalents live in these fields instead — without them, an OTC
  // medicine renders with no side-effect information whatsoever, which
  // reads to a patient as "this drug has no side effects".
  stop_use?: string[];
  when_using?: string[];
  ask_doctor?: string[];
  ask_doctor_or_pharmacist?: string[];
  do_not_use?: string[];
  keep_out_of_reach_of_children?: string[];
  openfda?: { generic_name?: string[]; brand_name?: string[] };
}

export class OpenFdaError extends Error {
  readonly kind: "NOT_FOUND" | "RATE_LIMITED" | "NETWORK" | "TIMEOUT" | "BAD_RESPONSE";
  constructor(kind: OpenFdaError["kind"], message: string) {
    super(message);
    this.name = "OpenFdaError";
    this.kind = kind;
  }
}

// Label sections arrive as arrays of very long strings, often with the
// section heading repeated inside the text. We trim rather than reflow:
// rewriting a drug label's wording is exactly the kind of "helpful"
// transformation that turns sourced information into something we can no
// longer attribute.
function section(values: string[] | undefined, maxChars = 4000): string | undefined {
  if (!values || values.length === 0) return undefined;
  const joined = values.join("\n\n").replace(/\s+/g, " ").trim();
  if (!joined) return undefined;
  if (joined.length <= maxChars) return joined;
  // Cut at a sentence boundary where possible so the text doesn't end mid-word.
  const cut = joined.slice(0, maxChars);
  const lastStop = cut.lastIndexOf(". ");
  return (lastStop > maxChars * 0.6 ? cut.slice(0, lastStop + 1) : cut) + " […]";
}

function parseEffectiveTime(value: string | undefined): Date | undefined {
  // openFDA formats this as YYYYMMDD.
  if (!value || !/^\d{8}$/.test(value)) return undefined;
  const parsed = new Date(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Chooses which of several candidate labels actually describes the
 * requested ingredient.
 *
 * openFDA's phrase search matches combination products too, so a query for
 * "amoxicillin" returns labels for "amoxicillin and clavulanate
 * potassium". Those are different medicines with different warnings. We
 * therefore prefer a label whose generic_name IS the ingredient, accept
 * one whose ingredient list is exactly that single substance, and
 * otherwise return nothing rather than the wrong leaflet.
 */
function pickBestLabel(results: OpenFdaRawResult[], ingredient: string): OpenFdaRawResult | null {
  if (results.length === 0) return null;
  const target = ingredient.toLowerCase().trim();

  const names = (result: OpenFdaRawResult) => (result.openfda?.generic_name ?? []).map((n) => n.toLowerCase().trim());

  // 1. A label whose generic name is exactly the ingredient.
  const exact = results.find((result) => names(result).includes(target));
  if (exact) return exact;

  // 2. A single-ingredient label whose name merely differs in salt form
  //    ("omeprazole magnesium" for "omeprazole"). A name containing "and"
  //    or a comma signals a combination product and is rejected.
  const singleIngredient = results.find((result) =>
    names(result).some(
      (name) => !/\band\b|,|\//.test(name) && (name.startsWith(target + " ") || name === target)
    )
  );
  if (singleIngredient) return singleIngredient;

  // 3. Nothing we can stand behind. An honest "no label" beats the wrong one.
  return null;
}

/**
 * Looks up a drug label by active ingredient / generic name.
 *
 * Returns null when openFDA genuinely has no label for the ingredient —
 * which is a normal, expected outcome for many medicines sold in Pakistan
 * and must be surfaced as an honest "not available", never backfilled
 * with invented text.
 */
/**
 * Fetches the single raw openFDA label that describes exactly this
 * ingredient, or null when there is none. Shared by the monograph lookup
 * and the interaction lookup so both apply the same "never the wrong
 * leaflet" selection rules.
 */
async function fetchRawLabel(ingredient: string): Promise<OpenFdaRawResult | null> {
  const term = ingredient.trim();
  if (!term) return null;

  // Exact-phrase match on the indexed generic_name/substance_name fields.
  // An unquoted term would match any label mentioning the word anywhere,
  // which is how you end up showing a patient the wrong drug's leaflet.
  // Strip anything that could break out of the quoted phrase or alter the
  // Lucene query openFDA parses — quotes, backslashes, and its operators.
  const escaped = term.replace(/[^a-zA-Z0-9 .-]/g, " ").replace(/\s+/g, " ").trim();
  if (!escaped) return null;
  const query = `(openfda.generic_name:"${escaped}"+OR+openfda.substance_name:"${escaped}")`;
  // Deliberately fetch several and choose below rather than taking the
  // first. A phrase search for "amoxicillin" also matches the combination
  // product "amoxicillin and clavulanate potassium", whose label is for a
  // DIFFERENT medicine — handing that to a patient is exactly the error
  // this module exists to avoid.
  const url = `${OPENFDA_LABEL_ENDPOINT}?search=${query}&limit=${CANDIDATE_LIMIT}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.medicineInfoTimeoutMs);

  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new OpenFdaError("TIMEOUT", "The medicine information service did not respond in time.");
    }
    throw new OpenFdaError("NETWORK", "Could not reach the medicine information service.");
  } finally {
    clearTimeout(timer);
  }

  // openFDA returns 404 for "no matching records" — a result, not a fault.
  if (response.status === 404) return null;
  if (response.status === 429) {
    throw new OpenFdaError("RATE_LIMITED", "The medicine information service is rate-limiting requests.");
  }
  if (!response.ok) {
    throw new OpenFdaError("NETWORK", `The medicine information service returned HTTP ${response.status}.`);
  }

  let payload: { results?: OpenFdaRawResult[] };
  try {
    payload = (await response.json()) as { results?: OpenFdaRawResult[] };
  } catch {
    throw new OpenFdaError("BAD_RESPONSE", "The medicine information service returned an unreadable response.");
  }

  return pickBestLabel(payload.results ?? [], escaped);
}

function dailyMedUrl(result: OpenFdaRawResult): string | undefined {
  return result.set_id ? `https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=${result.set_id}` : undefined;
}

/**
 * Looks up a drug label by active ingredient / generic name.
 *
 * Returns null when openFDA genuinely has no label for the ingredient —
 * which is a normal, expected outcome for many medicines sold in Pakistan
 * and must be surfaced as an honest "not available", never backfilled
 * with invented text.
 */
export async function fetchLabelByIngredient(ingredient: string): Promise<OpenFdaLabel | null> {
  const term = ingredient.trim();
  const result = await fetchRawLabel(term);
  if (!result) return null;

  return dropRedundantWarnings({
    displayName: result.openfda?.generic_name?.[0] ?? term,
    uses: section(result.indications_and_usage),
    howToUse: section(result.dosage_and_administration),
    // ONLY genuine adverse reactions belong here. The OTC "stop use and
    // ask a doctor if" field is NOT a side-effect list — it is
    // treatment-failure criteria ("your heartburn continues or worsens",
    // "you need this for more than 14 days"). Labelling that as a side
    // effect tells a patient something false, so it gets its own field.
    sideEffects: section(result.adverse_reactions),
    whenToStop: section(result.stop_use ?? result.when_using),
    warnings: section(result.warnings_and_cautions ?? result.warnings),
    // These OTC fields genuinely are precautions / contraindications.
    precautions: section(result.precautions ?? result.ask_doctor_or_pharmacist ?? result.ask_doctor),
    contraindications: section(result.contraindications ?? result.do_not_use),
    storage: section(result.storage_and_handling, 1200),
    // DailyMed is the human-readable home of the same label, which makes
    // it the right thing to put behind "view source" for a patient.
    sourceUrl: dailyMedUrl(result),
    labelUpdatedAt: parseEffectiveTime(result.effective_time),
  });
}

export interface OpenFdaInteractionText {
  displayName: string;
  /** The label's own "Drug Interactions" section (prescription labels). */
  drugInteractions?: string;
  /** Contraindications, or the OTC "Do not use" block. */
  contraindications?: string;
  /** Warnings / "Ask a doctor or pharmacist before use if you are taking…" (OTC). */
  warnings?: string;
  sourceUrl?: string;
  labelUpdatedAt?: Date;
}

/**
 * Returns the interaction-relevant sections of one ingredient's label,
 * unsummarised. Deliberately not cached in the monograph table: the
 * interaction check is comparatively rare, and adding a column would mean
 * a schema migration for what is a live, attributed read.
 */
export async function fetchInteractionTextByIngredient(ingredient: string): Promise<OpenFdaInteractionText | null> {
  const result = await fetchRawLabel(ingredient);
  if (!result) return null;
  return {
    displayName: result.openfda?.generic_name?.[0] ?? ingredient.trim(),
    // Interaction sections can be very long; the cap is generous because
    // the caller searches this text for the other medicine's name.
    drugInteractions: section(result.drug_interactions, 12000),
    contraindications: section(result.contraindications ?? result.do_not_use, 4000),
    warnings: section(result.ask_doctor_or_pharmacist ?? result.warnings_and_cautions ?? result.warnings, 6000),
    sourceUrl: dailyMedUrl(result),
    labelUpdatedAt: parseEffectiveTime(result.effective_time),
  };
}

/**
 * On an OTC "Drug Facts" label, `warnings` is the whole Warnings block and
 * the granular fields ("Do not use", "Ask a doctor before use if", "Stop
 * use and ask a doctor if") are its own sub-sections — openFDA exposes
 * both. Rendering both shows a patient the same sentences two or three
 * times on one page.
 *
 * When every granular section we extracted is already contained in the
 * warnings blob, the blob adds nothing: we keep the structured sections
 * and drop the duplicate. If anything is NOT contained, the blob carries
 * unique content and is kept.
 */
function dropRedundantWarnings(label: OpenFdaLabel): OpenFdaLabel {
  if (!label.warnings) return label;

  const haystack = label.warnings.toLowerCase();
  const granular = [label.whenToStop, label.precautions, label.contraindications].filter(
    (section): section is string => Boolean(section)
  );
  if (granular.length === 0) return label;

  const allContained = granular.every((section) => haystack.includes(section.toLowerCase().replace(/ \[…\]$/, "")));
  return allContained ? { ...label, warnings: undefined } : label;
}
