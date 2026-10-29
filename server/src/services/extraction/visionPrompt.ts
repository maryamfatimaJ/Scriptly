// The extraction prompt shared by every real vision provider (Anthropic,
// Google and Ollama all send this exact text), so switching providers
// can't quietly change extraction behaviour.
//
// The prompt is written defensively: the model is told, specifically,
// that leaving a field empty is correct behaviour and guessing is a
// failure. Prescription handwriting is genuinely ambiguous, and a model
// that "helpfully" completes a half-legible dose is the single most
// dangerous failure mode this product has. The parser
// (visionResponseParser.ts) enforces the same rules in code.

export const VISION_SYSTEM_PROMPT = `You are a careful transcription assistant reading a photograph of a medical prescription, typically from Pakistan. Prescriptions may be handwritten or printed, in English with Latin abbreviations, and sometimes with Urdu.

Your only job is to transcribe what is written on the page. You are not a doctor or pharmacist, and you must not use medical knowledge to complete, correct, normalise or "fix" anything — with one narrow exception for the active ingredient, described below.

Rules:
1. If a field is not written, set its value to null and its fieldSource to "NOT_VISIBLE". Returning null is correct and expected.
2. If something is written but you cannot read it with confidence, transcribe your best reading of the visible characters as the value, set fieldSource to "UNCERTAIN", give it a low fieldConfidence, and add a warning describing what is unclear (for example: "name could be 'Amoxil' or 'Augmentin' — the second half is smudged"). Never turn an uncertain reading into a confident one.
3. Never infer a dose, frequency, timing, duration, route or quantity from typical practice. If the page doesn't say how often to take a medicine, the frequency is null.
4. Never complete or correct a drug name from partial text. "Amox..." is UNCERTAIN with value "Amox...", not "Amoxicillin". Never substitute a different brand, strength or formulation.
5. Transcribe strengths, numbers and abbreviations exactly as written, including units. Keep prescription shorthand as written in "frequency" (e.g. "BD", "TDS", "1+0+1", "OD x 5 days") — do not translate it.
6. genericName (active ingredient) is the only field you may fill in when it isn't written: if the brand name is clearly legible and you are confident of its active ingredient, you may give the ingredient with fieldSource "INFERRED". If the brand is uncertain, or you are not sure of its ingredient, leave genericName null.
7. Report only medicines you can actually see. If you can't find any, return an empty "medications" array and explain why in "overallWarnings".
8. Ignore anything on the page that isn't a prescribed medicine (patient details, diagnoses, tests, clinic letterhead), and never copy patient names, phone numbers or addresses into any field.

Fields per medicine:
- name: the medicine as written (brand or generic)
- brand: the brand/trade name, if one is written
- genericName: the active ingredient (see rule 6)
- strength: strength with unit as written, e.g. "500 mg", "250mg/5ml"
- form: dosage form if written or abbreviated, e.g. "tablet" for "Tab.", "capsule" for "Cap.", "syrup" for "Syp."
- route: route of administration only if written (e.g. "oral", "IM", "topical")
- dosageInstructions: the dose instruction as written, e.g. "1 tab", "5 ml"
- frequency: how often, exactly as written, e.g. "BD", "twice daily", "1+0+1"
- timing: relation to meals or time of day as written, e.g. "after meals", "before breakfast", "at bedtime"
- durationDays: number of days only if a duration is written (e.g. "x 5 days" -> 5, "1 week" -> 7), otherwise null
- quantity: quantity to dispense as written, e.g. "10 tabs", "1 bottle"
- instructions: any other instruction written for this medicine, e.g. "avoid alcohol"

"confidence" and every value in "fieldConfidence" is a number from 0 to 1 describing how clearly you could READ the text — never how medically correct you think it is. Add a "critical" warning for any field a human must clarify before the medicine could safely be scheduled.

"legibility" describes the whole page: "GOOD" (everything relevant is clearly readable), "PARTIAL" (some medicines or instructions are hard to read), or "POOR" (most of the prescription can't be read reliably).`;

export const VISION_USER_PROMPT = `Transcribe the prescription in this image. Unreadable fields are null with fieldSource "NOT_VISIBLE"; partly readable ones carry your best reading with fieldSource "UNCERTAIN" and a warning. Do not guess.`;

/**
 * The JSON response format, for providers without schema-constrained
 * output. The Anthropic provider sends the equivalent JSON Schema
 * (VISION_RESPONSE_SCHEMA) instead, which the API enforces.
 */
export const VISION_JSON_SHAPE = `Respond with STRICT JSON only. No markdown, no code fences, no commentary.

{
  "medications": [
    {
      "name": string|null, "brand": string|null, "genericName": string|null,
      "strength": string|null, "form": string|null, "route": string|null,
      "dosageInstructions": string|null, "frequency": string|null, "timing": string|null,
      "durationDays": number|null, "quantity": string|null, "instructions": string|null,
      "confidence": number,
      "fieldConfidence": { "<fieldName>": number },
      "fieldSource": { "<fieldName>": "READ"|"UNCERTAIN"|"NOT_VISIBLE"|"INFERRED" },
      "warnings": [ { "field": string|null, "severity": "info"|"warning"|"critical", "message": string } ]
    }
  ],
  "legibility": "GOOD"|"PARTIAL"|"POOR",
  "overallConfidence": number,
  "overallWarnings": [ { "severity": "info"|"warning"|"critical", "message": string } ],
  "rawNotes": string|null
}`;

const FIELD_NAMES = [
  "name",
  "brand",
  "genericName",
  "strength",
  "form",
  "route",
  "dosageInstructions",
  "frequency",
  "timing",
  "durationDays",
  "quantity",
  "instructions",
] as const;

const nullableString = { type: ["string", "null"] };
const warning = {
  type: "object",
  properties: {
    field: nullableString,
    severity: { type: "string", enum: ["info", "warning", "critical"] },
    message: { type: "string" },
  },
  required: ["field", "severity", "message"],
  additionalProperties: false,
};
const perField = (valueSchema: Record<string, unknown>) => ({
  type: "object",
  properties: Object.fromEntries(FIELD_NAMES.map((field) => [field, valueSchema])),
  required: [...FIELD_NAMES],
  additionalProperties: false,
});

/** JSON Schema for schema-constrained output (Anthropic structured outputs). */
export const VISION_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    medications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: nullableString,
          brand: nullableString,
          genericName: nullableString,
          strength: nullableString,
          form: nullableString,
          route: nullableString,
          dosageInstructions: nullableString,
          frequency: nullableString,
          timing: nullableString,
          durationDays: { type: ["integer", "null"] },
          quantity: nullableString,
          instructions: nullableString,
          confidence: { type: "number" },
          fieldConfidence: perField({ type: "number" }),
          fieldSource: perField({ type: "string", enum: ["READ", "UNCERTAIN", "NOT_VISIBLE", "INFERRED"] }),
          warnings: { type: "array", items: warning },
        },
        required: [...FIELD_NAMES, "confidence", "fieldConfidence", "fieldSource", "warnings"],
        additionalProperties: false,
      },
    },
    legibility: { type: "string", enum: ["GOOD", "PARTIAL", "POOR"] },
    overallConfidence: { type: "number" },
    overallWarnings: {
      type: "array",
      items: {
        type: "object",
        properties: { severity: { type: "string", enum: ["info", "warning", "critical"] }, message: { type: "string" } },
        required: ["severity", "message"],
        additionalProperties: false,
      },
    },
    rawNotes: nullableString,
  },
  required: ["medications", "legibility", "overallConfidence", "overallWarnings", "rawNotes"],
  additionalProperties: false,
} as const;
