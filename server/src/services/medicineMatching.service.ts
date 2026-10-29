import { prisma } from "@/db/prisma";
import { visibleCatalogue } from "@/services/medicineInfo/catalogueVisibility";
import { env } from "@/config/env";
import { nameSimilarity, normalizeName as normalize } from "@/utils/nameSimilarity";
import type { MedicineReference } from "@prisma/client";

// Matches an extracted medication candidate against medicine_reference.
//
// Safety rules this module enforces (do not relax these without updating
// the brief this was built against):
//   - A name match alone is NEVER enough for VERIFIED_MATCH — strength and
//     formulation must also agree.
//   - An uncertain match is never auto-selected. Only VERIFIED_MATCH
//     populates `selectedId`; POSSIBLE_MATCH and MULTIPLE_MATCHES leave
///    the choice to the user, who picks from `candidates`.
//   - No match above the minimum score -> NO_VERIFIED_RECORD, never a
//     best-effort guess.

export type MedicineMatchStatus = "VERIFIED_MATCH" | "POSSIBLE_MATCH" | "MULTIPLE_MATCHES" | "NO_VERIFIED_RECORD";

export interface MedicineMatchCandidate {
  id: string;
  genericName: string;
  brandName: string | null;
  strength: string | null;
  formulation: string | null;
  manufacturer: string | null;
  score: number; // 0..1, name+strength+form composite
}

export interface MedicineMatchResult {
  status: MedicineMatchStatus;
  candidates: MedicineMatchCandidate[];
  /** Only set when status is VERIFIED_MATCH — the one reference row to link automatically. */
  selectedId?: string;
}

export interface MatchInput {
  name?: string | null;
  genericName?: string | null;
  brand?: string | null;
  strength?: string | null;
  form?: string | null;
}

const MAX_CANDIDATES_RETURNED = 5;

function bestNameScore(input: MatchInput, row: MedicineReference): number {
  const inputNames = [input.name, input.genericName, input.brand].filter((v): v is string => Boolean(v?.trim()));
  const rowNames = [row.genericName, row.brandName].filter((v): v is string => Boolean(v?.trim()));
  if (inputNames.length === 0 || rowNames.length === 0) return 0;

  let best = 0;
  for (const a of inputNames) {
    for (const b of rowNames) {
      best = Math.max(best, nameSimilarity(a, b));
    }
  }
  return best;
}

function strengthsMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normalize(a) === normalize(b);
}

function formsMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return normalize(a) === normalize(b);
}

function compositeScore(input: MatchInput, row: MedicineReference): number {
  const nameScore = bestNameScore(input, row);
  const strengthScore = strengthsMatch(input.strength, row.strength) ? 1 : 0;
  const formScore = formsMatch(input.form, row.formulation) ? 1 : 0;
  // Name carries most of the weight (it's what we can search by), but
  // strength/formulation agreement is what separates "same drug, same
  // product" from "same drug, different product" — never ignored.
  return nameScore * 0.6 + strengthScore * 0.25 + formScore * 0.15;
}

export async function matchMedicineReference(input: MatchInput): Promise<MedicineMatchResult> {
  const searchTerms = [input.name, input.genericName, input.brand]
    .map((v) => v?.trim())
    .filter((v): v is string => Boolean(v && v.length >= 2));

  if (searchTerms.length === 0) {
    return { status: "NO_VERIFIED_RECORD", candidates: [] };
  }

  // Coarse DB-side filter (ILIKE) to keep the candidate set small, then
  // score precisely in memory — the reference table is not expected to be
  // large enough for this to be a performance problem at this stage (see
  // docs/medicine-data-sources.md on current data volume).
  const rows = await prisma.medicineReference.findMany({
    where: {
      ...visibleCatalogue(),
      OR: searchTerms.flatMap((term) => [
        { genericName: { contains: term, mode: "insensitive" as const } },
        { brandName: { contains: term, mode: "insensitive" as const } },
      ]),
    },
    take: 200,
  });

  const scored = rows
    .map((row) => ({ row, score: compositeScore(input, row) }))
    .filter(({ score }) => score >= env.medicineMatchMinScore)
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0) {
    return { status: "NO_VERIFIED_RECORD", candidates: [] };
  }

  const candidates: MedicineMatchCandidate[] = scored.slice(0, MAX_CANDIDATES_RETURNED).map(({ row, score }) => ({
    id: row.id,
    genericName: row.genericName,
    brandName: row.brandName,
    strength: row.strength,
    formulation: row.formulation,
    manufacturer: row.manufacturer,
    score: Math.round(score * 100) / 100,
  }));

  const top = scored[0];
  const isStrongSingleMatch =
    scored.length === 1 &&
    top.score >= 0.85 &&
    strengthsMatch(input.strength, top.row.strength) &&
    formsMatch(input.form, top.row.formulation);

  if (isStrongSingleMatch) {
    return { status: "VERIFIED_MATCH", candidates, selectedId: top.row.id };
  }

  if (scored.length === 1) {
    return { status: "POSSIBLE_MATCH", candidates };
  }

  return { status: "MULTIPLE_MATCHES", candidates };
}
