import fs from "node:fs/promises";
import path from "node:path";

// Shared plumbing for real vision providers: reading the image safely,
// classified errors, timeouts, and retry-with-backoff.
//
// Error classification matters here because the caller
// (prescription.service.ts) turns any throw into "extraction failed →
// NEEDS_CLARIFICATION". A user who hit a 15-second timeout and a user whose
// API key is wrong both deserve to know which it was, and only one of those
// is worth retrying.

export type VisionErrorKind =
  | "NOT_CONFIGURED"
  | "TIMEOUT"
  | "RATE_LIMITED"
  | "AUTH"
  | "MODEL_UNAVAILABLE"
  | "BAD_RESPONSE"
  | "NETWORK"
  | "QUOTA_EXHAUSTED"
  | "UNKNOWN";

export class VisionProviderError extends Error {
  readonly kind: VisionErrorKind;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(kind: VisionErrorKind, message: string, options: { retryable?: boolean; status?: number } = {}) {
    super(message);
    this.name = "VisionProviderError";
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? (kind === "TIMEOUT" || kind === "RATE_LIMITED" || kind === "NETWORK");
  }
}

const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Reads the uploaded prescription image as base64.
 *
 * Note what is deliberately NOT logged anywhere in this module: the image
 * bytes, the base64 payload, and the model's raw transcription. Those are
 * medical content. Only sizes, durations, and error kinds are ever logged.
 */
export async function readImageAsBase64(imagePath: string, mimeType: string): Promise<string> {
  if (!ALLOWED_IMAGE_MIME.has(mimeType)) {
    throw new VisionProviderError(
      "BAD_RESPONSE",
      `Unsupported image type "${mimeType}". Scriptly accepts JPG, PNG, and WebP prescription images.`,
      { retryable: false }
    );
  }

  try {
    const buffer = await fs.readFile(path.resolve(imagePath));
    if (buffer.length === 0) {
      throw new VisionProviderError("BAD_RESPONSE", "The uploaded image file is empty.", { retryable: false });
    }
    return buffer.toString("base64");
  } catch (err) {
    if (err instanceof VisionProviderError) throw err;
    throw new VisionProviderError("BAD_RESPONSE", "The uploaded prescription image could not be read from storage.", {
      retryable: false,
    });
  }
}

export interface FetchJsonOptions {
  url: string;
  body: unknown;
  headers?: Record<string, string>;
  timeoutMs: number;
}

/**
 * Maps a provider's HTTP failure to a classified error with OUR wording.
 *
 * The upstream body is read only to classify the failure and is never put
 * into the message: it reaches the user's screen, and provider error
 * bodies can echo request details and internal identifiers. (An earlier
 * version appended the raw body — live testing showed Google's full
 * "API key not valid" JSON on the review page.)
 */
export function classifyHttpFailure(status: number, body: string): VisionProviderError {
  const text = body.slice(0, 4000);
  // Out of prepaid credit / over a spending limit (xAI answers this with
  // 403 or 429). Not a key problem and not something a retry fixes.
  if ((status === 403 || status === 429) && /credits?|spending limit|insufficient.?balance/i.test(text)) {
    return new VisionProviderError(
      "QUOTA_EXHAUSTED",
      "The AI service's credit or spending limit is used up, so prescriptions can't be read until it is topped up.",
      { status, retryable: false }
    );
  }
  if (status === 401 || status === 403 || /API_KEY_INVALID|API key not valid|Incorrect API key|invalid.api.key|PERMISSION_DENIED/i.test(text)) {
    return new VisionProviderError(
      "AUTH",
      "The AI service rejected this server's credentials. An administrator needs to check the API key in server/.env.",
      { status, retryable: false }
    );
  }
  if (status === 404) {
    return new VisionProviderError(
      "MODEL_UNAVAILABLE",
      "The configured AI model isn't available. An administrator needs to check the model setting in server/.env.",
      { status, retryable: false }
    );
  }
  if (status === 429) {
    // Google signals a DAILY quota with a PerDay quota id; that won't
    // clear in a minute, so don't invite an immediate retry.
    if (/PerDay|per day|billing/i.test(text)) {
      return new VisionProviderError(
        "QUOTA_EXHAUSTED",
        "The AI service's daily quota is used up, so prescriptions can't be read until it resets or the plan is upgraded.",
        { status, retryable: false }
      );
    }
    return new VisionProviderError("RATE_LIMITED", "The AI service is busy right now. Please wait a minute and try again.", {
      status,
      retryable: true,
    });
  }
  if (status >= 500) {
    return new VisionProviderError(
      "MODEL_UNAVAILABLE",
      "The AI service is temporarily overloaded or unavailable. Please try again in a few minutes.",
      { status, retryable: true }
    );
  }
  return new VisionProviderError("BAD_RESPONSE", "The AI service couldn't process this image. Try a clearer, well-lit photo.", {
    status,
    retryable: false,
  });
}

/** POSTs JSON with a hard timeout, mapping transport failures to classified errors. */
export async function postJsonWithTimeout<T>({ url, body, headers = {}, timeoutMs }: FetchJsonOptions): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new VisionProviderError("TIMEOUT", `The vision model did not respond within ${timeoutMs / 1000}s.`);
    }
    throw new VisionProviderError(
      "NETWORK",
      "Could not reach the vision model. Check that the provider is running and reachable."
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw classifyHttpFailure(response.status, await response.text().catch(() => ""));
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new VisionProviderError("BAD_RESPONSE", "The vision provider returned a non-JSON response.", {
      retryable: false,
    });
  }
}

/** Retries only genuinely transient failures, with linear backoff. */
export async function withRetries<T>(
  operation: () => Promise<T>,
  options: { attempts: number; backoffMs: number; label: string }
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      const retryable = err instanceof VisionProviderError && err.retryable;
      if (!retryable || attempt === options.attempts) break;

      const waitMs = options.backoffMs * attempt;
      // Log the KIND only — never the prescription content or payload.
      console.warn(
        `[vision:${options.label}] attempt ${attempt}/${options.attempts} failed (${
          (err as VisionProviderError).kind
        }); retrying in ${waitMs}ms`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }

  throw lastError;
}
