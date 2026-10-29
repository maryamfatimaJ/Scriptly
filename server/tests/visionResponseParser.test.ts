import { describe, expect, it } from "vitest";
import { parseVisionResponse, VisionResponseParseError } from "@/services/extraction/visionResponseParser";

// These tests cover the layer that decides what a vision model is ALLOWED
// to put into a medication record. The prompt asks the model to behave;
// this parser is what enforces it when the model doesn't.

const validResponse = {
  medications: [
    {
      name: "Amoxicillin",
      brand: null,
      genericName: "Amoxicillin",
      strength: "500 mg",
      form: "capsule",
      route: "oral",
      dosageInstructions: "Take one capsule three times daily after meals",
      instructions: null,
      frequency: "3x daily",
      durationDays: 7,
      confidence: 0.92,
      fieldConfidence: { name: 0.97, strength: 0.95 },
      fieldSource: { name: "READ", strength: "READ", frequency: "READ" },
      warnings: [],
    },
  ],
  overallConfidence: 0.9,
  overallWarnings: [],
  rawNotes: null,
};

describe("parseVisionResponse", () => {
  it("parses a well-formed response", () => {
    const result = parseVisionResponse(JSON.stringify(validResponse), "ollama");
    expect(result.provider).toBe("ollama");
    expect(result.medications).toHaveLength(1);
    expect(result.medications[0].name).toBe("Amoxicillin");
    expect(result.medications[0].durationDays).toBe(7);
  });

  it("handles markdown-fenced JSON, which models emit constantly", () => {
    const fenced = "Here you go:\n```json\n" + JSON.stringify(validResponse) + "\n```";
    const result = parseVisionResponse(fenced, "ollama");
    expect(result.medications[0].strength).toBe("500 mg");
  });

  it("DISCARDS a value the model supplied for a field it marked NOT_VISIBLE", () => {
    // The central safety rule: if the model admits it couldn't see the
    // frequency but fills one in anyway, that invented value must never
    // reach the record.
    const sneaky = {
      ...validResponse,
      medications: [
        {
          ...validResponse.medications[0],
          frequency: "twice daily",
          fieldSource: { name: "READ", frequency: "NOT_VISIBLE" },
        },
      ],
    };
    const result = parseVisionResponse(JSON.stringify(sneaky), "ollama");
    expect(result.medications[0].frequency).toBeUndefined();
    expect(
      result.medications[0].warnings?.some((w) => w.field === "frequency" && w.severity === "critical")
    ).toBe(true);
  });

  it("raises a critical warning for any UNCERTAIN field so it can't be silently confirmed", () => {
    const uncertain = {
      ...validResponse,
      medications: [
        { ...validResponse.medications[0], fieldSource: { name: "READ", strength: "UNCERTAIN" } },
      ],
    };
    const result = parseVisionResponse(JSON.stringify(uncertain), "ollama");
    expect(result.medications[0].warnings?.some((w) => w.field === "strength" && w.severity === "critical")).toBe(true);
  });

  it("normalises model filler values ('N/A', 'unknown', '') to undefined rather than storing them", () => {
    const filler = {
      ...validResponse,
      medications: [
        { ...validResponse.medications[0], brand: "N/A", instructions: "unknown", route: "   " },
      ],
    };
    const result = parseVisionResponse(JSON.stringify(filler), "ollama");
    expect(result.medications[0].brand).toBeUndefined();
    expect(result.medications[0].instructions).toBeUndefined();
    expect(result.medications[0].route).toBeUndefined();
  });

  it("flags an empty medication list instead of returning a silently empty result", () => {
    const empty = { medications: [], overallWarnings: [] };
    const result = parseVisionResponse(JSON.stringify(empty), "ollama");
    expect(result.medications).toHaveLength(0);
    expect(result.warnings.some((w) => w.severity === "critical")).toBe(true);
  });

  it("rejects non-JSON output rather than guessing at it", () => {
    expect(() => parseVisionResponse("I'm sorry, I can't read this image.", "ollama")).toThrow(
      VisionResponseParseError
    );
  });

  it("rejects structurally wrong JSON rather than partially accepting it", () => {
    expect(() => parseVisionResponse(JSON.stringify({ medications: "not-an-array" }), "ollama")).toThrow(
      VisionResponseParseError
    );
  });

  it("drops an out-of-range durationDays rather than storing nonsense", () => {
    const bad = {
      ...validResponse,
      medications: [{ ...validResponse.medications[0], durationDays: 99999 }],
    };
    const result = parseVisionResponse(JSON.stringify(bad), "ollama");
    expect(result.medications[0].durationDays).toBeUndefined();
  });
});
