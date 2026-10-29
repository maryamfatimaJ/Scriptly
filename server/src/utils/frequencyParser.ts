// Parses a CONFIRMED frequency string into a *structural* suggestion —
// how many reminder slots a day this kind of phrasing usually implies —
// never into actual clock times. The user always types the real times
// themselves; this only saves them from staring at a blank form when the
// phrasing is unambiguous ("twice daily" -> 2 slots), and explicitly
// refuses to guess for anything else ("as needed", unrecognized phrasing).
//
// This is pattern-matching on common English phrasing, not a clinical
// dosing calculator — it must never be treated as, or presented as,
// medical guidance. It only ever proposes a *count* and generic labels
// ("Morning", "Evening"); the exact times remain entirely up to the user.

export interface FrequencySuggestion {
  /** Suggested number of daily reminder slots, or null if this phrasing shouldn't be auto-structured at all. */
  suggestedSlotCount: number | null;
  /** Generic, non-clinical labels for each suggested slot (e.g. ["Morning", "Evening"]). */
  suggestedLabels: string[];
  /** True when the instruction has no fixed daily cadence (e.g. "as needed") — scheduling needs the user's own judgment, not a derived count. */
  requiresManualTiming: boolean;
  /** Human-readable explanation shown in the schedule-preview UI. */
  note: string;
}

const PRN_PATTERNS = [/\bas\s*needed\b/i, /\bprn\b/i, /\bwhen\s+required\b/i, /\bif\s+needed\b/i];

// `(?:day|daily)` so phrasing like "3x day", "3x a day", AND "3x daily"
// (the form MockExtractionProvider actually uses) are all recognized.
// NOTE: "daily" is NOT "day" + "ly" (it's spelled d-a-i-l-y) — an earlier
// version of this wrongly assumed it was and used `day(ly)?`, which never
// matched "daily" at all. Covered by frequencyParser.test.ts so this
// doesn't silently regress again.
const COUNT_PATTERNS: Array<{ pattern: RegExp; count: number }> = [
  { pattern: /\bonce\s*(a|per)?\s*(?:day|daily)\b/i, count: 1 },
  { pattern: /\b1\s*x\s*(a|per)?\s*(?:day|daily)\b/i, count: 1 },
  { pattern: /\btwice\s*(a|per)?\s*(?:day|daily)\b/i, count: 2 },
  { pattern: /\b2\s*x\s*(a|per)?\s*(?:day|daily)\b/i, count: 2 },
  { pattern: /\bthree\s*times\s*(a|per)?\s*(?:day|daily)\b/i, count: 3 },
  { pattern: /\b3\s*x\s*(a|per)?\s*(?:day|daily)\b/i, count: 3 },
  { pattern: /\bthrice\s*daily\b/i, count: 3 },
  { pattern: /\bfour\s*times\s*(a|per)?\s*(?:day|daily)\b/i, count: 4 },
  { pattern: /\b4\s*x\s*(a|per)?\s*(?:day|daily)\b/i, count: 4 },
  // Latin abbreviations as written on prescriptions in Pakistan (and
  // most of the Commonwealth). Dots and case vary: "BD", "b.d.", "B.I.D".
  { pattern: /(?:^|[^a-z])(?:o\.?\s?d|q\.?\s?d)\.?(?![a-z])/i, count: 1 },
  { pattern: /(?:^|[^a-z])(?:b\.?\s?d|b\.?\s?i\.?\s?d)\.?(?![a-z])/i, count: 2 },
  { pattern: /(?:^|[^a-z])(?:t\.?\s?d\.?\s?s|t\.?\s?i\.?\s?d)\.?(?![a-z])/i, count: 3 },
  { pattern: /(?:^|[^a-z])(?:q\.?\s?i\.?\s?d|q\.?\s?d\.?\s?s)\.?(?![a-z])/i, count: 4 },
];

/**
 * The dose-position notation common on South Asian prescriptions:
 * "1+0+1" / "1-0-1" / "1-1-1" means morning + afternoon + night, each
 * digit being the dose at that time (0 = none). Two positions ("1+1")
 * mean morning + night. The positions ARE written, so the times of day are
 * read, not inferred — only the exact clock time is left to the user.
 */
export function parseDosePositions(text: string): { morning?: string; afternoon?: string; night?: string } | null {
  const three = text.match(/(?:^|[^\d.])(\d(?:\.\d|\/\d)?)\s*[+-]\s*(\d(?:\.\d|\/\d)?)\s*[+-]\s*(\d(?:\.\d|\/\d)?)(?![\d.])/);
  if (three) {
    const [, morning, afternoon, night] = three;
    return { morning: morning !== "0" ? morning : undefined, afternoon: afternoon !== "0" ? afternoon : undefined, night: night !== "0" ? night : undefined };
  }
  const two = text.match(/(?:^|[^\d.])(\d(?:\.\d|\/\d)?)\s*\+\s*(\d(?:\.\d|\/\d)?)(?![\d.+])/);
  if (two) {
    const [, morning, night] = two;
    return { morning: morning !== "0" ? morning : undefined, night: night !== "0" ? night : undefined };
  }
  return null;
}

const EVERY_N_HOURS_PATTERN = /\bevery\s*(\d{1,2})\s*hours?\b/i;

const LABELS_BY_COUNT: Record<number, string[]> = {
  1: ["Once daily"],
  2: ["Morning", "Evening"],
  3: ["Morning", "Afternoon", "Evening"],
  4: ["Morning", "Midday", "Evening", "Night"],
};

function labelsFor(count: number): string[] {
  if (LABELS_BY_COUNT[count]) return LABELS_BY_COUNT[count];
  return Array.from({ length: count }, (_, i) => `Dose ${i + 1}`);
}

export function suggestScheduleFromFrequency(frequency: string | null | undefined): FrequencySuggestion {
  const text = (frequency ?? "").trim();

  if (!text) {
    return {
      suggestedSlotCount: null,
      suggestedLabels: [],
      requiresManualTiming: true,
      note: "No confirmed frequency on record — set reminder times yourself based on the confirmed instructions.",
    };
  }

  if (PRN_PATTERNS.some((p) => p.test(text))) {
    return {
      suggestedSlotCount: null,
      suggestedLabels: [],
      requiresManualTiming: true,
      note: `"${text}" doesn't define a fixed daily timing — this medication is taken as needed, not on a schedule. You can still set reminder times if that helps you track doses, but we won't invent a routine for an as-needed instruction.`,
    };
  }

  const everyNHours = text.match(EVERY_N_HOURS_PATTERN);
  if (everyNHours) {
    const hours = Number(everyNHours[1]);
    if (hours > 0 && hours <= 24) {
      const count = Math.max(1, Math.round(24 / hours));
      return {
        suggestedSlotCount: count,
        suggestedLabels: labelsFor(count),
        requiresManualTiming: false,
        note: `"${text}" suggests about ${count} evenly-spaced dose${count === 1 ? "" : "s"} per day — confirm the exact clock times that fit your own routine.`,
      };
    }
  }

  const positions = parseDosePositions(text);
  if (positions) {
    const count = [positions.morning, positions.afternoon, positions.night].filter(Boolean).length;
    if (count > 0) {
      const labels = [
        positions.morning && "Morning",
        positions.afternoon && "Afternoon",
        positions.night && "Night",
      ].filter((label): label is string => Boolean(label));
      return {
        suggestedSlotCount: count,
        suggestedLabels: labels,
        requiresManualTiming: false,
        note: `"${text}" means ${labels.join(", ").toLowerCase()} — confirm the exact clock times that fit your own routine.`,
      };
    }
  }

  const matched = COUNT_PATTERNS.find(({ pattern }) => pattern.test(text));
  if (matched) {
    return {
      suggestedSlotCount: matched.count,
      suggestedLabels: labelsFor(matched.count),
      requiresManualTiming: false,
      note: `"${text}" suggests ${matched.count} dose${matched.count === 1 ? "" : "s"} per day — confirm the exact clock times that fit your own routine.`,
    };
  }

  return {
    suggestedSlotCount: null,
    suggestedLabels: [],
    requiresManualTiming: true,
    note: `"${text}" doesn't match a recognized daily pattern — set reminder times yourself based on the confirmed instructions, or ask your pharmacist if the timing is unclear.`,
  };
}
