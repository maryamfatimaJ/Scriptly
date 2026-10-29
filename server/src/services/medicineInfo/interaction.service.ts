import * as medicineService from "@/services/medicine.service";
import * as medicationService from "@/services/medication.service";
import { ingredientKeyFor } from "./monograph.service";
import { fetchInteractionTextByIngredient, OpenFdaError, type OpenFdaInteractionText } from "./openFdaClient";

// Medicine-interaction lookup over the openFDA drug label.
//
// What this IS: a search of each medicine's own published label — its
// "Drug Interactions", contraindications and warnings sections — for a
// mention of the other medicine, returned as verbatim, attributed
// excerpts.
//
// What this is NOT: a clinical interaction database. There is no free,
// openly licensed one with Pakistani coverage. A label that does not name
// the other drug is NOT evidence the combination is safe — labels often
// describe interactions by drug CLASS ("NSAIDs", "MAO inhibitors"), which
// a name search cannot match. Every result says so, and Scripty is told
// to say so, because "no mention found" read as "safe" is the dangerous
// misreading of this tool.

const SOURCE_NAME = "openFDA (U.S. FDA drug label)";
const EXCERPTS_PER_SECTION = 3;
const EXCERPT_RADIUS = 220;

export interface InteractionMedicineInput {
  medicationId?: string;
  name?: string;
}

interface ResolvedMedicine {
  displayName: string;
  ingredient: string;
  /** Terms searched for in the OTHER medicine's label. */
  searchTerms: string[];
}

type LabelStatus =
  | { status: "FOUND"; label: OpenFdaInteractionText }
  | { status: "NOT_AVAILABLE" }
  | { status: "LOOKUP_FAILED"; reason: string };

export interface InteractionExcerpt {
  section: "drugInteractions" | "contraindications" | "warnings";
  text: string;
}

export interface PairResult {
  medicines: [string, string];
  /**
   * MENTIONED     — at least one label names the other medicine; excerpts attached.
   * NOT_MENTIONED — both labels were read and neither names the other. NOT a safety verdict.
   * INCOMPLETE    — at least one label could not be read, so the check is partial.
   */
  status: "MENTIONED" | "NOT_MENTIONED" | "INCOMPLETE";
  findings: Array<{ inLabelOf: string; mentions: string; source: string | null; excerpts: InteractionExcerpt[] }>;
  missingLabels: Array<{ medicine: string; reason: string }>;
}

async function resolveMedicine(userId: string, input: InteractionMedicineInput): Promise<ResolvedMedicine> {
  if (input.medicationId) {
    // Ownership is enforced by the query (userId in the where clause).
    const medication = await medicationService.getMedicationForUser(userId, input.medicationId);
    const displayName = medication.confirmedName ?? medication.extractedName ?? "Unnamed medicine";
    const ingredient = medication.confirmedGenericName ?? medication.extractedGenericName ?? displayName;
    return { displayName, ingredient, searchTerms: termsFor(displayName, ingredient) };
  }

  const name = (input.name ?? "").trim();
  // A brand name is rarely what a label is indexed under. Only trust a
  // reference row that matches strongly — a fuzzy near-miss could swap in
  // a different molecule, which is the one mistake this tool cannot make.
  const hits = await medicineService.searchMedicines(name, 1);
  const hit = hits[0] && hits[0].score >= 0.85 ? hits[0].medicine : null;
  const ingredient = hit?.activeIngredient ?? name;
  return { displayName: name, ingredient, searchTerms: termsFor(name, ingredient, hit?.brandName ?? undefined) };
}

function termsFor(...values: Array<string | null | undefined>): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const key = ingredientKeyFor(value);
    for (const term of [value.toLowerCase().replace(/\(.*?\)/g, " ").trim(), key]) {
      // Skip fragments too short to search for without false hits.
      if (term && term.length >= 4) terms.add(term.replace(/\s+/g, " "));
    }
  }
  return [...terms];
}

async function readLabel(ingredient: string): Promise<LabelStatus> {
  try {
    const label = await fetchInteractionTextByIngredient(ingredientKeyFor(ingredient));
    return label ? { status: "FOUND", label } : { status: "NOT_AVAILABLE" };
  } catch (err) {
    console.warn(`[interactions] openFDA lookup failed (${err instanceof OpenFdaError ? err.kind : "UNKNOWN"})`);
    return {
      status: "LOOKUP_FAILED",
      reason: err instanceof OpenFdaError ? err.message : "The label could not be retrieved right now.",
    };
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Verbatim windows of label text around each mention of any term. */
function findExcerpts(label: OpenFdaInteractionText, terms: string[]): InteractionExcerpt[] {
  const excerpts: InteractionExcerpt[] = [];
  const sections: Array<InteractionExcerpt["section"]> = ["drugInteractions", "contraindications", "warnings"];
  const pattern = new RegExp(`\\b(${terms.map(escapeRegExp).join("|")})`, "gi");

  for (const section of sections) {
    const text = label[section];
    if (!text) continue;
    let count = 0;
    let lastEnd = -1;
    for (const match of text.matchAll(pattern)) {
      if (count >= EXCERPTS_PER_SECTION) break;
      const index = match.index ?? 0;
      if (index < lastEnd) continue; // already inside the previous excerpt
      const start = Math.max(0, index - EXCERPT_RADIUS);
      const end = Math.min(text.length, index + match[0].length + EXCERPT_RADIUS);
      excerpts.push({
        section,
        text: `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`,
      });
      lastEnd = end;
      count += 1;
    }
  }
  return excerpts;
}

export async function checkInteractions(userId: string, inputs: InteractionMedicineInput[]) {
  const medicines = await Promise.all(inputs.map((input) => resolveMedicine(userId, input)));

  // One label read per distinct ingredient, however many pairs use it.
  const labels = new Map<string, Promise<LabelStatus>>();
  const labelFor = (medicine: ResolvedMedicine) => {
    const key = ingredientKeyFor(medicine.ingredient);
    if (!labels.has(key)) labels.set(key, readLabel(medicine.ingredient));
    return labels.get(key)!;
  };

  const pairs: PairResult[] = [];
  for (let i = 0; i < medicines.length; i += 1) {
    for (let j = i + 1; j < medicines.length; j += 1) {
      const a = medicines[i];
      const b = medicines[j];
      const [labelA, labelB] = await Promise.all([labelFor(a), labelFor(b)]);

      const findings: PairResult["findings"] = [];
      const missingLabels: PairResult["missingLabels"] = [];

      for (const [owner, other, label] of [
        [a, b, labelA],
        [b, a, labelB],
      ] as const) {
        if (label.status === "FOUND") {
          const excerpts = findExcerpts(label.label, other.searchTerms);
          if (excerpts.length > 0) {
            findings.push({
              inLabelOf: label.label.displayName,
              mentions: other.displayName,
              source: label.label.sourceUrl ?? null,
              excerpts,
            });
          }
        } else {
          missingLabels.push({
            medicine: owner.displayName,
            reason:
              label.status === "NOT_AVAILABLE"
                ? `No ${SOURCE_NAME} was found for ${owner.displayName} (common for medicines sold in Pakistan but not the US).`
                : label.reason,
          });
        }
      }

      pairs.push({
        medicines: [a.displayName, b.displayName],
        status: findings.length > 0 ? "MENTIONED" : missingLabels.length > 0 ? "INCOMPLETE" : "NOT_MENTIONED",
        findings,
        missingLabels,
      });
    }
  }

  return {
    sourceName: SOURCE_NAME,
    market: "US",
    pairs,
    limitation:
      "This searches each medicine's US FDA label for the other medicine's name. Labels often describe interactions " +
      "by drug class (for example 'NSAIDs' or 'anticoagulants'), which a name search cannot detect, so NOT_MENTIONED " +
      "does not mean the combination is safe. A pharmacist should confirm any combination.",
  };
}
