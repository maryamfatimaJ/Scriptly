import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// Grok (xAI) as a provider in its own right, and as the explicit
// AI_FALLBACK_PROVIDER used only when the first provider is out of quota
// or unavailable. fetch is intercepted; no real request is made.

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

type FakeResponse = { ok: boolean; status: number; json: () => Promise<unknown>; text: () => Promise<string> };
function reply(status: number, body: unknown): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

const GOOGLE_DAILY_QUOTA = { error: { code: 429, status: "RESOURCE_EXHAUSTED", details: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] } };
const XAI_OK = { choices: [{ message: { content: JSON.stringify(VALID_MODEL_RESPONSE) }, finish_reason: "stop" }] };
const XAI_MODEL_INFO = { id: "grok-4", input_modalities: ["text", "image"] };

let imagePath: string;
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "scriptly-fallback-"));
  imagePath = path.join(tempDir, "prescription.png");
  await fs.writeFile(imagePath, PNG_BYTES);
  vi.stubEnv("VISION_MAX_ATTEMPTS", "1");
  vi.stubEnv("GOOGLE_API_KEY", "test-google-key");
  vi.stubEnv("GOOGLE_MODEL", "gemini-3.5-flash");
  vi.stubEnv("XAI_API_KEY", "test-xai-key");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  await fs.rm(tempDir, { recursive: true, force: true });
});

function routeFetch(google: () => FakeResponse) {
  return vi.fn(async (url: string) => {
    if (url.includes("generativelanguage")) return google();
    if (url.includes("/language-models/")) return reply(200, XAI_MODEL_INFO);
    if (url.endsWith("/chat/completions")) return reply(200, XAI_OK);
    throw new Error(`unexpected URL ${url}`);
  });
}

describe("XaiVisionProvider", () => {
  it("sends the real image bytes as a data URL with a bearer key, and parses the reply", async () => {
    vi.resetModules();
    const fetchMock = routeFetch(() => reply(500, ""));
    vi.stubGlobal("fetch", fetchMock);
    const { XaiVisionProvider } = await import("@/services/extraction/XaiVisionProvider");

    const result = await new XaiVisionProvider().extractPrescription({ imagePath, mimeType: "image/png" });

    const chatCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/chat/completions")) as unknown as [string, { body: string; headers: Record<string, string> }];
    const body = JSON.parse(chatCall[1].body);
    expect(chatCall[1].headers.Authorization).toBe("Bearer test-xai-key");
    const imagePart = body.messages[1].content.find((p: { type: string }) => p.type === "image_url");
    const dataUrl: string = imagePart.image_url.url;
    expect(dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(Buffer.from(dataUrl.split(",")[1], "base64").equals(PNG_BYTES)).toBe(true);
    expect(result.provider).toBe("xai");
    expect(result.medications[0].name).toBe("Amoxicillin");
  });

  it("refuses a model that does not accept images, before sending the image", async () => {
    vi.resetModules();
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/language-models/") ? reply(200, { id: "grok-text", input_modalities: ["text"] }) : reply(200, XAI_OK)
    );
    vi.stubGlobal("fetch", fetchMock);
    const { XaiVisionProvider } = await import("@/services/extraction/XaiVisionProvider");

    await expect(new XaiVisionProvider().extractPrescription({ imagePath, mimeType: "image/png" })).rejects.toMatchObject({ kind: "NOT_CONFIGURED" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/chat/completions"))).toBe(false);
  });

  it("classifies an out-of-credit reply as QUOTA_EXHAUSTED, without echoing the provider body", async () => {
    const { classifyHttpFailure } = await import("@/services/extraction/visionTransport");
    const err = classifyHttpFailure(403, '{"error":"Your team has run out of credits. secret-detail-123"}');
    expect(err.kind).toBe("QUOTA_EXHAUSTED");
    expect(err.message).not.toContain("secret-detail-123");
  });
});

describe("xAI error mapping", () => {
  it("treats xAI's 400 'Incorrect API key' as a credentials problem, not a bad image", async () => {
    const { classifyHttpFailure } = await import("@/services/extraction/visionTransport");
    const err = classifyHttpFailure(400, '{"code":"invalid-argument","error":"Incorrect API key provided."}');
    expect(err.kind).toBe("AUTH");
  });
});

describe("AI_FALLBACK_PROVIDER", () => {
  async function loadService(fallback: string) {
    vi.stubEnv("AI_PROVIDER", "google");
    vi.stubEnv("AI_FALLBACK_PROVIDER", fallback);
    vi.resetModules();
    return import("@/services/extraction/extractionService");
  }

  it("uses Grok when Gemini's daily quota is exhausted", async () => {
    const fetchMock = routeFetch(() => reply(429, GOOGLE_DAILY_QUOTA));
    vi.stubGlobal("fetch", fetchMock);
    const { extractPrescription } = await loadService("xai");

    const result = await extractPrescription({ imagePath, mimeType: "image/png" });

    expect(result.provider).toBe("xai");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("generativelanguage"))).toBe(true);
  });

  it("does not send the image to Grok when Gemini succeeds", async () => {
    const fetchMock = routeFetch(() =>
      reply(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(VALID_MODEL_RESPONSE) }] } }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { extractPrescription } = await loadService("xai");

    const result = await extractPrescription({ imagePath, mimeType: "image/png" });

    expect(result.provider).toBe("google");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("x.ai"))).toBe(false);
  });

  it("does not fall back when the image itself is the problem", async () => {
    const fetchMock = routeFetch(() => reply(400, { error: { message: "bad image" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { extractPrescription } = await loadService("xai");

    await expect(extractPrescription({ imagePath, mimeType: "image/png" })).rejects.toMatchObject({ kind: "BAD_RESPONSE" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("x.ai"))).toBe(false);
  });

  it("without a fallback configured, reports the quota error and sends nothing elsewhere", async () => {
    const fetchMock = routeFetch(() => reply(429, GOOGLE_DAILY_QUOTA));
    vi.stubGlobal("fetch", fetchMock);
    const { extractPrescription } = await loadService("");

    await expect(extractPrescription({ imagePath, mimeType: "image/png" })).rejects.toMatchObject({ kind: "QUOTA_EXHAUSTED" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("x.ai"))).toBe(false);
  });

  it("startup check names both providers", async () => {
    const service = await loadService("xai");
    expect(service.validateExtractionConfig()).toMatch(/google .*\n.*fallback: xai/s);
  });

  it("a fallback without its key is reported inactive and never used", async () => {
    vi.stubEnv("XAI_API_KEY", "");
    const fetchMock = routeFetch(() => reply(429, GOOGLE_DAILY_QUOTA));
    vi.stubGlobal("fetch", fetchMock);
    const service = await loadService("xai");

    expect(service.validateExtractionConfig()).toMatch(/fallback: NOT ACTIVE .*XAI_API_KEY/s);
    await expect(service.extractPrescription({ imagePath, mimeType: "image/png" })).rejects.toMatchObject({ kind: "QUOTA_EXHAUSTED" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("x.ai"))).toBe(false);
  });
});
