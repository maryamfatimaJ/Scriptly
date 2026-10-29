import type { ExtractionProvider, ExtractionResult } from "./types";

// Deterministic, clearly-labeled demo provider. It does NOT look at the
// uploaded image content at all — it exists so the rest of the product
// (review screen, confirmation flow, medicine matching, scheduling,
// reminders) can be built and demoed end-to-end before a real vision
// model is wired up.
//
// Every result it returns is tagged provider: "mock" and carries an
// explicit warning so the UI can (and must) make clear this is sample
// data, not a real extraction. The three candidates below are chosen to
// exercise the review UI's different states: a clean high-confidence
// read, a low-confidence/ambiguous field, and a field left deliberately
// unset (never guessed) because "illegible" is simulated.
export class MockExtractionProvider implements ExtractionProvider {
  readonly name = "mock";

  async extractPrescription(): Promise<ExtractionResult> {
    // Simulate realistic latency so loading states can be built/tested.
    await new Promise((resolve) => setTimeout(resolve, 600));

    return {
      provider: this.name,
      confidence: 0.74,
      medications: [
        {
          // Clean, high-confidence read across every field.
          name: "Amoxicillin",
          genericName: "Amoxicillin",
          strength: "500 mg",
          form: "capsule",
          route: "oral",
          dosageInstructions: "Take one capsule by mouth three times daily after meals",
          instructions: "Complete the full course even if symptoms improve",
          frequency: "3x daily",
          durationDays: 7,
          confidence: 0.91,
          fieldConfidence: {
            name: 0.97,
            strength: 0.95,
            form: 0.93,
            route: 0.9,
            dosageInstructions: 0.88,
            frequency: 0.9,
            durationDays: 0.85,
          },
          warnings: [],
        },
        {
          // Ambiguous handwriting on the brand name; frequency is a
          // low-confidence read that genuinely needs a human to verify
          // against the original rather than being trusted as-is.
          name: "Paracetamol",
          brand: "Panadol?", // the "?" simulates genuine OCR uncertainty, not a guess being hidden
          genericName: "Paracetamol",
          strength: "500 mg",
          form: "tablet",
          dosageInstructions: "Take 1-2 tablets as needed for pain, not more than 4 times a day",
          frequency: "as needed",
          confidence: 0.58,
          fieldConfidence: {
            name: 0.89,
            brand: 0.42,
            strength: 0.8,
            form: 0.8,
            frequency: 0.46,
          },
          warnings: [
            {
              field: "brand",
              severity: "warning",
              message: "Brand name is partially illegible in the source image — verify against the original before confirming.",
            },
            {
              field: "frequency",
              severity: "warning",
              message: "Low-confidence field — please verify against the original prescription before confirming.",
            },
          ],
        },
        {
          // Simulates a third line on the prescription where the dose
          // amount/frequency genuinely could not be read — left unset
          // rather than guessed, with a critical warning so the review
          // UI must route this to "needs professional clarification"
          // instead of silently defaulting anything.
          name: "Cetirizine",
          genericName: "Cetirizine",
          strength: "10 mg",
          form: "tablet",
          // frequency / dosageInstructions intentionally omitted: illegible
          confidence: 0.33,
          fieldConfidence: {
            name: 0.7,
            strength: 0.6,
          },
          warnings: [
            {
              field: "frequency",
              severity: "critical",
              message: "Dosing frequency could not be read from the image. Do not guess — this needs professional clarification.",
            },
          ],
        },
      ],
      warnings: [
        {
          severity: "critical",
          message:
            "DEMO DATA: this result was produced by the mock extraction provider, not a real AI model. Do not treat it as read from an actual prescription.",
        },
      ],
      rawNotes: "Mock provider: no OCR/vision model was invoked.",
    };
  }
}
