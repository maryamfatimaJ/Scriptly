import { describe, expect, it, vi } from "vitest";
import { MockExtractionProvider } from "@/services/extraction/MockExtractionProvider";
import { GoogleGemmaVisionProvider } from "@/services/extraction/GoogleGemmaVisionProvider";
import { OllamaVisionProvider } from "@/services/extraction/OllamaVisionProvider";
import { extractPrescription } from "@/services/extractionService";

describe("MockExtractionProvider", () => {
  it("clearly labels its output as demonstration data", async () => {
    const provider = new MockExtractionProvider();
    const result = await provider.extractPrescription({ imagePath: "/tmp/does-not-matter.jpg", mimeType: "image/jpeg" });

    expect(result.provider).toBe("mock");
    expect(result.warnings.some((w) => w.message.includes("DEMO DATA"))).toBe(true);
  });

  it("never guesses a field it marks as unreadable — low/no confidence fields are left unset", async () => {
    const provider = new MockExtractionProvider();
    const result = await provider.extractPrescription({ imagePath: "x", mimeType: "image/jpeg" });
    const unreadable = result.medications.find((m) => m.name === "Cetirizine");

    expect(unreadable).toBeTruthy();
    expect(unreadable?.frequency).toBeUndefined();
    expect(unreadable?.dosageInstructions).toBeUndefined();
    expect(unreadable?.warnings?.some((w) => w.severity === "critical")).toBe(true);
  });
});

describe("GoogleGemmaVisionProvider", () => {
  it("refuses to run (does not fabricate a response) when GOOGLE_API_KEY is absent", async () => {
    const provider = new GoogleGemmaVisionProvider();
    await expect(provider.extractPrescription({ imagePath: "x", mimeType: "image/jpeg" })).rejects.toThrow(
      /GOOGLE_API_KEY/i
    );
  });
});

describe("OllamaVisionProvider", () => {
  it("rejects a text-only model rather than silently returning nothing useful", async () => {
    // gemma3:1b has no vision encoder (Gemma 3 model card: only 4B/12B/27B
    // accept images), so it must be refused before an image is ever sent.
    vi.stubEnv("OLLAMA_MODEL", "gemma3:1b");
    vi.resetModules();
    const { OllamaVisionProvider: FreshProvider } = await import("@/services/extraction/OllamaVisionProvider");
    const provider = new FreshProvider();
    await expect(provider.extractPrescription({ imagePath: "x", mimeType: "image/jpeg" })).rejects.toThrow(
      /text-only/i
    );
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("rejects an unsupported image type before contacting the model", async () => {
    const provider = new OllamaVisionProvider();
    await expect(provider.extractPrescription({ imagePath: "x", mimeType: "application/pdf" })).rejects.toThrow(
      /JPG, PNG, and WebP/i
    );
  });
});

describe("extractionService confidence-threshold pipeline", () => {
  it("adds its own warning for fields below the configured low threshold, on top of the provider's own warnings", async () => {
    const result = await extractPrescription({ imagePath: "x", mimeType: "image/jpeg" });
    const unreadable = result.medications.find((m) => m.name === "Cetirizine");
    // Cetirizine's "name"/"strength" field-confidence scores (0.7, 0.6 in
    // the mock) sit in the "moderate" band by default thresholds (0.5/0.8)
    // — the pipeline should have appended its own advisory warning.
    expect(unreadable?.warnings?.some((w) => w.field === "name" || w.field === "strength")).toBe(true);
  });
});
