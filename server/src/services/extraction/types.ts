// Shared contract for prescription-extraction providers.
//
// IMPORTANT: extraction is a *drafting* step, not medical verification.
// A provider's job is to propose candidate medication fields and flag
// anything it isn't confident about — never to guess silently. Every
// candidate must flow through the human review step (see
// medication.service.ts) before it can be confirmed or scheduled. A high
// confidence score is a signal about the OCR/model's own certainty, never
// proof that a medical instruction is correct — see
// CONFIDENCE_THRESHOLDS below and docs/extraction-pipeline.md.

export type ExtractableField =
  | "name"
  | "brand"
  | "genericName"
  | "strength"
  | "form"
  | "route"
  | "dosageInstructions"
  | "instructions"
  | "frequency"
  | "timing"
  | "durationDays"
  | "quantity";

/** Per-field confidence, 0..1. Only fields the provider actually assessed need be present. */
export type FieldConfidenceMap = Partial<Record<ExtractableField, number>>;

/**
 * Where a field's value came from. This is deliberately separate from
 * confidence: "I read this clearly" and "I am 90% sure" are different
 * claims, and conflating them is how invented data sneaks into a medical
 * record.
 *
 *  READ        — the value was legibly present on the prescription image.
 *  UNCERTAIN   — something was there but could not be read with confidence
 *                (e.g. ambiguous handwriting). Treat as needing clarification.
 *  NOT_VISIBLE — the field simply was not present/legible on the image. The
 *                value MUST be null; this is never an invitation to infer one.
 *  INFERRED    — not written, but identified from what IS written. Allowed
 *                for exactly one field: genericName (the active ingredient
 *                of a written brand, e.g. Panadol -> paracetamol). For any
 *                other field the parser discards an INFERRED value — a dose,
 *                frequency or duration that isn't on the page doesn't go
 *                in the record.
 */
export type FieldSource = "READ" | "UNCERTAIN" | "NOT_VISIBLE" | "INFERRED";

/** Fields for which an INFERRED value is accepted. See FieldSource. */
export const INFERABLE_FIELDS: readonly ExtractableField[] = ["genericName"];

export type FieldSourceMap = Partial<Record<ExtractableField, FieldSource>>;

export interface MedicationCandidate {
  name?: string;
  /** Brand/trade name, if the prescription names one specifically (e.g. "Panadol"). */
  brand?: string;
  /** Generic/INN name, if distinguishable from the brand at extraction time (e.g. "Paracetamol"). */
  genericName?: string;
  strength?: string;
  form?: string;
  /** Route of administration, e.g. "oral", "topical" — must be left unset, not guessed, if illegible. */
  route?: string;
  /** Full human-readable dosing instruction, e.g. "Take one capsule by mouth three times daily after meals". */
  dosageInstructions?: string;
  /** Special/precautionary instructions distinct from dosing, e.g. "avoid alcohol", "take with food". */
  instructions?: string;
  frequency?: string;
  /** Relation to meals / time of day as written, e.g. "after breakfast and dinner", "at bedtime". */
  timing?: string;
  durationDays?: number;
  /** Quantity to dispense as written, e.g. "10 tablets", "1 bottle". */
  quantity?: string;
  /** 0..1 overall confidence score for this candidate, if the provider supports it. */
  confidence?: number;
  /** Per-field confidence — lets the review UI flag individual uncertain fields, not just the whole candidate. */
  fieldConfidence?: FieldConfidenceMap;
  /** Per-field provenance — was this READ off the image, UNCERTAIN, or NOT_VISIBLE? See FieldSource. */
  fieldSource?: FieldSourceMap;
  /** Warnings specific to THIS medication (ambiguity, illegibility, conflicting values). */
  warnings?: ExtractionWarning[];
}

export type ExtractionWarningSeverity = "info" | "warning" | "critical";

export interface ExtractionWarning {
  /** Which field the warning relates to, if any (e.g. "frequency"). */
  field?: string;
  message: string;
  severity: ExtractionWarningSeverity;
}

export interface ExtractionResult {
  /** Name of the provider that produced this result, e.g. "mock" or "gemma". */
  provider: string;
  medications: MedicationCandidate[];
  /** Overall confidence across the whole prescription (e.g. image quality), separate from any one medication's confidence. */
  confidence?: number;
  /** The model's assessment of how readable the page is. */
  legibility?: "GOOD" | "PARTIAL" | "POOR";
  /** Warnings that apply to the prescription as a whole (e.g. "image partially illegible"), not one specific medication. */
  warnings: ExtractionWarning[];
  /** Free-form notes from the provider, e.g. OCR text it could not parse into fields. */
  rawNotes?: string;
}

export interface ExtractionProvider {
  readonly name: string;
  extractPrescription(input: { imagePath: string; mimeType: string }): Promise<ExtractionResult>;
}

// Configurable confidence thresholds. These decide when the pipeline
// itself (not the provider) adds a "needs review" style warning on top
// of whatever the provider reported — see extractionService.ts
// `applyConfidenceThresholds`. Override via env (see config/env.ts);
// documented here because they directly affect review-status defaults.
//
//   score <  LOW   -> treated as NEEDS_CLARIFICATION-worthy (critical warning)
//   LOW <= score <  HIGH -> flagged for extra scrutiny (warning)
//   score >= HIGH  -> no threshold-driven warning added (the provider's
//                     own warnings, if any, still apply)
export interface ConfidenceThresholds {
  low: number;
  high: number;
}
