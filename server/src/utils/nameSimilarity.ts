// Shared lightweight fuzzy name matching.
//
// Extracted from medicineMatching.service.ts so that medicine SEARCH and
// prescription-to-reference MATCHING score names the same way. Two places
// disagreeing about whether "Amoxicilin" is "Amoxicillin" would be a
// genuinely confusing bug for a user who searches for a medicine, finds
// it, and then sees their prescription fail to match the same row.

/** Lowercase, trim, strip punctuation, collapse whitespace. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
}

function bigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < value.length - 1; i++) {
    set.add(value.slice(i, i + 2));
  }
  return set;
}

/**
 * Dice coefficient over character bigrams — a dependency-free fuzzy match.
 *
 * Good enough to separate "clearly the same name" from "clearly
 * different", and to absorb ordinary misspellings ("amoxicilin"). It is
 * NOT a clinical name-normalization service; see
 * docs/medicine-data-sources.md on RxNorm for that.
 */
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ba = bigrams(na);
  const bb = bigrams(nb);
  if (ba.size === 0 || bb.size === 0) return 0;

  let intersection = 0;
  for (const gram of ba) {
    if (bb.has(gram)) intersection++;
  }
  return (2 * intersection) / (ba.size + bb.size);
}
