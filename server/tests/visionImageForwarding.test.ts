import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// These tests answer the question the whole project turned on: does the
// REAL uploaded image actually get sent to the model?
//
// The old GemmaExtractionProvider never opened the file at all, and no
// test would have caught that, because nothing asserted on the request
// body. So these tests intercept fetch and inspect what was transmitted —
// specifically, that the bytes on the wire are the bytes on disk.

// A 1x1 PNG. Small, but its exact bytes are what we assert travelled.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const VALID_MODEL_RESPONSE = {
  medications: [
    {
      name: "Amoxicillin",
      strength: "500 mg",
      frequency: "3x daily",
      confidence: 0.9,
      fieldSource: { name: "READ", strength: "READ", frequency: "READ" },
    },
  ],
  overallConfidence: 0.9,
};

let imagePath: string;
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scriptly-vision-"));
  imagePath = path.join(tempDir, "prescription.png");
  await fs.writeFile(imagePath, PNG_BYTES);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("GoogleGemmaVisionProvider — real image transmission", () => {
  it("sends the actual image bytes from disk, base64-encoded, to the model", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "test-key-not-a-real-credential");
    vi.resetModules();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_MODEL_RESPONSE) }] } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { GoogleGemmaVisionProvider } = await import("@/services/extraction/GoogleGemmaVisionProvider");
    const result = await new GoogleGemmaVisionProvider().extractPrescription({
      imagePath,
      mimeType: "image/png",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string; headers: Record<string, string> }];
    const body = JSON.parse(init.body);

    const inlineData = body.contents[0].parts.find((p: Record<string, unknown>) => "inline_data" in p);
    expect(inlineData).toBeTruthy();
    expect(inlineData.inline_data.mime_type).toBe("image/png");
    // The decisive assertion: what was transmitted is byte-identical to
    // the file that was uploaded.
    expect(Buffer.from(inlineData.inline_data.data, "base64").equals(PNG_BYTES)).toBe(true);

    expect(result.provider).toBe("google");
    expect(result.medications[0].name).toBe("Amoxicillin");
  });

  it("puts the API key in a header and never in the URL", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "super-secret-value");
    vi.resetModules();

    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_MODEL_RESPONSE) }] } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { GoogleGemmaVisionProvider } = await import("@/services/extraction/GoogleGemmaVisionProvider");
    await new GoogleGemmaVisionProvider().extractPrescription({ imagePath, mimeType: "image/png" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    // URLs end up in logs, proxies and error messages; keys must not.
    expect(url).not.toContain("super-secret-value");
    expect(init.headers["x-goog-api-key"]).toBe("super-secret-value");
  });

  it("surfaces an auth failure as a clear error instead of returning invented data", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "wrong-key");
    vi.resetModules();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 401, text: async () => "invalid key" }))
    );

    const { GoogleGemmaVisionProvider } = await import("@/services/extraction/GoogleGemmaVisionProvider");
    await expect(
      new GoogleGemmaVisionProvider().extractPrescription({ imagePath, mimeType: "image/png" })
    ).rejects.toThrow(/rejected this server's credentials/i);
  });

  it("fails loudly on an unreadable model response rather than guessing at the prescription", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "test-key");
    vi.resetModules();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: "Sorry, I can't read this prescription." }] } }],
        }),
      }))
    );

    const { GoogleGemmaVisionProvider } = await import("@/services/extraction/GoogleGemmaVisionProvider");
    await expect(
      new GoogleGemmaVisionProvider().extractPrescription({ imagePath, mimeType: "image/png" })
    ).rejects.toThrow();
  });

  it("refuses an unsupported file type before any image is transmitted", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "test-key");
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { GoogleGemmaVisionProvider } = await import("@/services/extraction/GoogleGemmaVisionProvider");
    await expect(
      new GoogleGemmaVisionProvider().extractPrescription({ imagePath, mimeType: "application/pdf" })
    ).rejects.toThrow(/JPG, PNG, and WebP/i);

    // Nothing left the machine.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a blocked image honestly rather than as an empty extraction", async () => {
    vi.stubEnv("GOOGLE_API_KEY", "test-key");
    vi.resetModules();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ promptFeedback: { blockReason: "SAFETY" } }),
      }))
    );

    const { GoogleGemmaVisionProvider } = await import("@/services/extraction/GoogleGemmaVisionProvider");
    await expect(
      new GoogleGemmaVisionProvider().extractPrescription({ imagePath, mimeType: "image/png" })
    ).rejects.toThrow(/blocked this image/i);
  });
});

describe("OllamaVisionProvider — real image transmission", () => {
  it("sends the actual image bytes in the images array", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ message: { content: JSON.stringify(VALID_MODEL_RESPONSE) } }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const { OllamaVisionProvider } = await import("@/services/extraction/OllamaVisionProvider");
    await new OllamaVisionProvider().extractPrescription({ imagePath, mimeType: "image/png" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);
    const userTurn = body.messages.find((m: { role: string }) => m.role === "user");
    expect(Buffer.from(userTurn.images[0], "base64").equals(PNG_BYTES)).toBe(true);
  });
});
