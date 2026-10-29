import { env } from "@/config/env";
import { MockExtractionProvider } from "./MockExtractionProvider";
import { OllamaVisionProvider } from "./OllamaVisionProvider";
import { GoogleGemmaVisionProvider } from "./GoogleGemmaVisionProvider";
import { AnthropicVisionProvider } from "./AnthropicVisionProvider";
import { XaiVisionProvider } from "./XaiVisionProvider";
import { VisionProviderError } from "./visionTransport";
import type { ExtractionProvider, ExtractionResult, ExtractionWarning, MedicationCandidate } from "./types";

const providers: Record<string, ExtractionProvider> = {
  anthropic: new AnthropicVisionProvider(),
  google: new GoogleGemmaVisionProvider(),
  xai: new XaiVisionProvider(),
  ollama: new OllamaVisionProvider(),
  mock: new MockExtractionProvider(),
};

const REAL_PROVIDERS = ["anthropic", "google", "xai", "ollama"];

// Failures where a different provider may well succeed. An unreadable or
// refused image (BAD_RESPONSE) is not among them: the image is the problem,
// and sending it to a second company would not fix that.
const FALLBACK_KINDS = new Set(["QUOTA_EXHAUSTED", "RATE_LIMITED", "MODEL_UNAVAILABLE", "TIMEOUT", "NETWORK", "AUTH"]);

// The mock provider returns fixed demo medicines and never opens the
// image. Showing that to a person — in production OR in development — is
// handing them invented prescription data with a disclaimer attached. It
// exists only so the automated test suite can run without a network, and
// is refused everywhere else.
function mockAllowed(): boolean {
  return env.nodeEnv === "test";
}

function getProvider(): ExtractionProvider {
  if (env.aiProvider === "mock" && !mockAllowed()) {
    throw new VisionProviderError("NOT_CONFIGURED", "Prescription reading isn't configured on this server yet. An administrator needs to set a real AI provider.", { retryable: false });
  }
  const provider = providers[env.aiProvider];
  if (!provider) {
    throw new VisionProviderError("NOT_CONFIGURED", "Prescription reading isn't configured on this server yet. An administrator needs to set a real AI provider.", { retryable: false });
  }
  return provider;
}

/**
 * Fail-fast configuration check, called at startup (server.ts) so a
 * misconfigured provider surfaces as a clear boot error instead of a
 * confusing failure on the first prescription a user uploads.
 * Returns a human-readable description of the active provider.
 */
export function validateExtractionConfig(): string {
  const primary = describeProvider(env.aiProvider, "AI_PROVIDER");
  const fallback = env.aiFallbackProvider;
  if (!fallback) return primary;
  if (!REAL_PROVIDERS.includes(fallback)) {
    throw new Error(`AI_FALLBACK_PROVIDER="${fallback}" is not recognised. Expected one of: ${REAL_PROVIDERS.join(", ")}, or leave it empty.`);
  }
  if (fallback === env.aiProvider) {
    throw new Error("AI_FALLBACK_PROVIDER is the same as AI_PROVIDER. Choose a different provider or leave it empty.");
  }
  // A fallback that isn't set up yet (e.g. its key not pasted in) doesn't
  // stop the server — the primary still works — but it is never used.
  try {
    return `${primary}
               fallback: ${describeProvider(fallback, "AI_FALLBACK_PROVIDER")} (only when the first is out of quota or unavailable)`;
  } catch (err) {
    return `${primary}
               fallback: NOT ACTIVE — ${(err as Error).message}`;
  }
}

function fallbackProvider(): ExtractionProvider | undefined {
  const name = env.aiFallbackProvider;
  if (!name || name === env.aiProvider || !REAL_PROVIDERS.includes(name)) return undefined;
  try {
    describeProvider(name, "AI_FALLBACK_PROVIDER");
  } catch {
    return undefined;
  }
  return providers[name];
}

function describeProvider(name: string, setting: string): string {
  if (!name) {
    throw new Error(
      "AI_PROVIDER is not set. Choose which service reads prescription images in server/.env: " +
        '"anthropic" (needs ANTHROPIC_API_KEY), "google" (needs GOOGLE_API_KEY) or "ollama" (local). ' +
        "anthropic and google send the image to that company."
    );
  }
  if (name === "mock" && !mockAllowed()) {
    throw new Error(
      'AI_PROVIDER="mock" returns demo medicines without reading the image and is only allowed in automated tests. ' +
        'Set AI_PROVIDER to "anthropic", "google" or "ollama" in server/.env.'
    );
  }
  if (!providers[name]) {
    throw new Error(`${setting}="${name}" is not recognised. Expected one of: ${REAL_PROVIDERS.join(", ")}.`);
  }

  switch (name) {
    case "anthropic":
      if (!env.anthropicApiKey) {
        throw new Error(
          `${setting}="anthropic" requires ANTHROPIC_API_KEY in server/.env. Create a key at https://console.anthropic.com/settings/keys.`
        );
      }
      return `anthropic (${env.anthropicVisionModel}) — prescription images are sent to Anthropic`;
    case "google":
      if (!env.googleApiKey) {
        throw new Error(
          `${setting}="google" requires GOOGLE_API_KEY. Get a free key at https://aistudio.google.com/apikey and add it to server/.env.`
        );
      }
      return `google (${env.googleModel}) — prescription images are sent to Google`;
    case "xai":
      if (!env.xaiApiKey) {
        throw new Error(`${setting}="xai" requires XAI_API_KEY in server/.env. Create a key at https://console.x.ai.`);
      }
      return `xai (${env.xaiModel}) — prescription images are sent to xAI`;
    case "ollama":
      return `ollama (${env.ollamaModel}) at ${env.ollamaBaseUrl} — images stay on this machine`;
    default:
      return "mock (automated tests only — images are never read)";
  }
}

// Applies the configurable confidence thresholds (CONFIDENCE_THRESHOLD_LOW/
// HIGH, see config/env.ts) uniformly across whichever provider ran, so the
// "needs extra scrutiny" / "needs clarification" signal doesn't depend on
// each provider remembering to compute it itself. This only ever ADDS
// warnings — it never removes or edits a field the provider returned, and
// it never invents a value for a field the provider left unset.
function applyConfidenceThresholds(candidate: MedicationCandidate): MedicationCandidate {
  const warnings: ExtractionWarning[] = [...(candidate.warnings ?? [])];
  const alreadyWarnedFields = new Set(warnings.map((w) => w.field).filter(Boolean));

  const fieldScores = candidate.fieldConfidence ?? {};
  for (const [field, score] of Object.entries(fieldScores)) {
    if (typeof score !== "number" || alreadyWarnedFields.has(field)) continue;
    // Confidence describes how well a value was READ. A field with no
    // value (correctly reported as not written) has nothing to doubt —
    // flagging it as a "low-confidence read" buried the real warnings
    // under a critical alarm for every empty field (seen in live testing).
    const value = (candidate as Record<string, unknown>)[field];
    if (value === undefined || value === null || candidate.fieldSource?.[field as keyof typeof candidate.fieldSource] === "NOT_VISIBLE") {
      continue;
    }

    if (score < env.confidenceThresholdLow) {
      warnings.push({
        field,
        severity: "critical",
        message: `Low-confidence read (${Math.round(score * 100)}%) — this field needs professional clarification, not just a quick check.`,
      });
    } else if (score < env.confidenceThresholdHigh) {
      warnings.push({
        field,
        severity: "warning",
        message: `Moderate-confidence read (${Math.round(score * 100)}%) — verify against the original before confirming.`,
      });
    }
  }

  return { ...candidate, warnings };
}

/**
 * Single entry point the rest of the backend should call for prescription
 * extraction — callers should never import a specific provider directly.
 * Swapping AI_PROVIDER in the environment is the only thing needed to
 * change which implementation runs. Confidence-threshold warnings are
 * applied here, after the provider runs, so they're consistent regardless
 * of provider.
 */
export async function extractPrescription(input: { imagePath: string; mimeType: string }): Promise<ExtractionResult> {
  const provider = getProvider();
  let result: ExtractionResult;
  try {
    result = await provider.extractPrescription(input);
  } catch (err) {
    const fallback = fallbackProvider();
    if (!fallback || !(err instanceof VisionProviderError) || !FALLBACK_KINDS.has(err.kind)) {
      throw err;
    }
    // Log the kind and provider names only — never prescription content.
    console.warn(`[vision] ${provider.name} failed (${err.kind}); trying fallback provider ${fallback.name}`);
    result = await fallback.extractPrescription(input);
  }
  return {
    ...result,
    medications: result.medications.map(applyConfidenceThresholds),
  };
}

export type { ExtractionResult, MedicationCandidate, ExtractionWarning } from "./types";
