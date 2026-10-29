import { z } from "zod";
import { INFERABLE_FIELDS, type ExtractionResult, type MedicationCandidate, type ExtractionWarning } from "./types";

// Validates and normalises whatever a vision model returns.
//
// The prompt asks for strict JSON, but models still wrap output in code
// fences, prepend prose, or return a bare object instead of the expected
// envelope. Rather than trusting any of that, every response goes through
// Zod here, and anything that doesn't fit is rejected loudly — a malformed
// response becomes an extraction FAILURE (prescription -> NEEDS_CLARIFICATION),
// never a half-parsed set of medication fields.
//
// This module is also where the "never invent data" rule is actually
// enforced in code rather than merely requested in the prompt: a field
// whose source is NOT_VISIBLE has its value stripped, even if the model
// supplied one anyway.

const warningSchema = z.object({
  field: z.string().nullish(),
  severity: z.enum(["info", "warning", "critical"]).catch("warning"),
  message: z.string().min(1),
});

const fieldSourceSchema = z.enum(["READ", "UNCERTAIN", "NOT_VISIBLE", "INFERRED"]);

/** Coerces "", "null", "N/A", "unknown" and friends to null — models love these. */
const nullableText = z
  .union([z.string(), z.number(), z.null(), z.undefined()])
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const text = String(v).trim();
    if (!text) return null;
    if (/^(null|n\/?a|unknown|not\s*(visible|legible|specified|stated)|none|-{1,})$/i.test(text)) return null;
    return text;
  });

const medicationSchema = z.object({
  name: nullableText,
  brand: nullableText,
  genericName: nullableText,
  strength: nullableText,
  form: nullableText,
  route: nullableText,
  dosageInstructions: nullableText,
  instructions: nullableText,
  frequency: nullableText,
  timing: nullableText,
  quantity: nullableText,
  durationDays: z
    .union([z.number(), z.string(), z.null(), z.undefined()])
    .transform((v) => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
      return Number.isFinite(n) && n > 0 && n <= 3650 ? Math.round(n) : null;
    }),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  fieldConfidence: z.record(z.coerce.number().min(0).max(1)).optional().default({}),
  fieldSource: z.record(fieldSourceSchema).optional().default({}),
  warnings: z.array(warningSchema).optional().default([]),
});

const responseSchema = z.object({
  medications: z.array(medicationSchema).default([]),
  legibility: z.enum(["GOOD", "PARTIAL", "POOR"]).optional().catch(undefined),
  overallConfidence: z.coerce.number().min(0).max(1).optional(),
  overallWarnings: z.array(warningSchema).optional().default([]),
  rawNotes: z.string().nullish(),
});

export class VisionResponseParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VisionResponseParseError";
  }
}

/**
 * Pulls a JSON object out of raw model text. Handles the three things
 * models actually do: clean JSON, ```json fenced blocks, and JSON with
 * leading/trailing prose.
 */
function extractJsonObject(raw: string): unknown {
  const text = raw.trim();

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  try {
    return JSON.parse(candidate);
  } catch {
    // Fall back to the outermost {...} span.
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      throw new VisionResponseParseError("Model response contained no JSON object.");
    }
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (err) {
      throw new VisionResponseParseError(
        `Model response was not valid JSON: ${err instanceof Error ? err.message : "unknown parse error"}`
      );
    }
  }
}

const EXTRACTABLE_FIELDS = [
  "name",
  "brand",
  "genericName",
  "strength",
  "form",
  "route",
  "dosageInstructions",
  "instructions",
  "frequency",
  "timing",
  "durationDays",
  "quantity",
] as const;

export function parseVisionResponse(rawText: string, providerName: string): ExtractionResult {
  const json = extractJsonObject(rawText);
  const parsed = responseSchema.safeParse(json);

  if (!parsed.success) {
    throw new VisionResponseParseError(
      `Model response did not match the required shape: ${parsed.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`
    );
  }

  const medications: MedicationCandidate[] = parsed.data.medications.map((med) => {
    const warnings: ExtractionWarning[] = med.warnings.map((w) => ({
      field: w.field ?? undefined,
      severity: w.severity,
      message: w.message,
    }));

    const fieldSource = med.fieldSource as Record<string, "READ" | "UNCERTAIN" | "NOT_VISIBLE" | "INFERRED">;
    const candidate: Record<string, unknown> = {};

    for (const field of EXTRACTABLE_FIELDS) {
      const value = (med as Record<string, unknown>)[field];
      const source = fieldSource[field];

      // Enforcement, not trust: if the model said a field isn't visible but
      // still filled it in, the value is discarded and flagged. This is the
      // exact failure mode (a "helpfully" completed dose) that must never
      // reach a medication record.
      if (source === "NOT_VISIBLE" && value !== null && value !== undefined) {
        warnings.push({
          field,
          severity: "critical",
          message: `Model supplied a value for "${field}" while marking it as not visible on the image — the value was discarded. This field must be entered by a human.`,
        });
        candidate[field] = undefined;
        continue;
      }

      // INFERRED is accepted only where inference is legitimate (the
      // active ingredient of a written brand). An inferred dose, frequency
      // or duration is exactly the invented data this pipeline exists to
      // keep out of a medication record.
      if (source === "INFERRED" && value !== null && value !== undefined && !INFERABLE_FIELDS.includes(field)) {
        warnings.push({
          field,
          severity: "critical",
          message: `The model inferred "${field}" rather than reading it, so the value was discarded. If it isn't written on the prescription, ask your prescriber or pharmacist.`,
        });
        candidate[field] = undefined;
        delete fieldSource[field];
        continue;
      }

      candidate[field] = value === null ? undefined : value;
    }

    // A field that's present but marked UNCERTAIN always earns a critical
    // warning, so it cannot be silently confirmed in the review UI.
    for (const [field, source] of Object.entries(fieldSource)) {
      if (source === "UNCERTAIN" && !warnings.some((w) => w.field === field)) {
        warnings.push({
          field,
          severity: "critical",
          message: `"${field}" could not be read with confidence. Verify it against the original prescription before confirming.`,
        });
      }
    }

    return {
      ...(candidate as MedicationCandidate),
      confidence: med.confidence,
      fieldConfidence: med.fieldConfidence as MedicationCandidate["fieldConfidence"],
      fieldSource: med.fieldSource as MedicationCandidate["fieldSource"],
      warnings,
    };
  });

  const overallWarnings: ExtractionWarning[] = parsed.data.overallWarnings.map((w) => ({
    field: w.field ?? undefined,
    severity: w.severity,
    message: w.message,
  }));

  if (medications.length === 0) {
    overallWarnings.push({
      severity: "critical",
      message: "No medicines could be read from this image. Try a sharper, well-lit photo, or enter the details manually.",
    });
  }

  return {
    provider: providerName,
    medications,
    confidence: parsed.data.overallConfidence,
    legibility: parsed.data.legibility,
    warnings: overallWarnings,
    rawNotes: parsed.data.rawNotes ?? undefined,
  };
}
