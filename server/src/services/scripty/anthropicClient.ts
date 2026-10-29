import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import { AppError } from "@/utils/AppError";

// The one place the Anthropic client is constructed. The API key comes
// from the server environment and is handed straight to the SDK; it is
// never echoed, logged, or included in an error message.

let client: Anthropic | null = null;
let testClient: Anthropic | null = null;

export function isScriptyConfigured(): boolean {
  return Boolean(testClient || env.anthropicApiKey);
}

export const SETUP_INSTRUCTIONS =
  "Scripty's AI is not configured on this server. To enable it, create an API key in the Anthropic Console " +
  "(https://console.anthropic.com/settings/keys), add it to server/.env as ANTHROPIC_API_KEY=<your key>, and " +
  "restart the backend. Keep the key in server/.env only — never in client code or chat.";

export function getAnthropicClient(): Anthropic {
  if (testClient) return testClient;
  if (!env.anthropicApiKey) {
    throw new AppError(503, "SCRIPTY_NOT_CONFIGURED", SETUP_INSTRUCTIONS);
  }
  client ??= new Anthropic({
    apiKey: env.anthropicApiKey,
    // The SDK retries 408/409/429/5xx and connection errors with backoff.
    maxRetries: 2,
    timeout: env.scriptyTimeoutMs,
  });
  return client;
}

/**
 * Test seam: substitute a fake client so the conversation loop, tool
 * execution and authorization can be tested without network access.
 * Tests that use it are labelled as MOCKED model tests.
 */
export function setAnthropicClientForTests(fake: Anthropic | null) {
  testClient = fake;
}

/**
 * Maps an SDK error to an application error the user can act on. Typed
 * classes, most specific first; never string-matches messages, and never
 * forwards the upstream message (which can quote request content).
 */
export function toScriptyError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AppError(
      503,
      "SCRIPTY_AUTH_FAILED",
      "Scripty's AI service rejected this server's credentials. An administrator needs to check ANTHROPIC_API_KEY in server/.env."
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    const retryAfter = Number(err.headers?.get("retry-after")) || undefined;
    return new AppError(
      429,
      "SCRIPTY_RATE_LIMITED",
      "Scripty is getting a lot of requests right now. Please wait a moment and try again.",
      retryAfter ? { retryAfterSeconds: retryAfter } : undefined
    );
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AppError(
      502,
      "SCRIPTY_MODEL_UNAVAILABLE",
      "The AI model Scripty is configured to use is not available. An administrator needs to check ANTHROPIC_MODEL."
    );
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AppError(502, "SCRIPTY_REQUEST_REJECTED", "Scripty could not process that message. Please try rephrasing it.");
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AppError(504, "SCRIPTY_TIMEOUT", "Scripty took too long to answer. Please try again.");
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AppError(503, "SCRIPTY_UNREACHABLE", "Scripty could not reach its AI service. Please try again shortly.");
  }
  if (err instanceof Anthropic.APIError) {
    // 5xx, including 529 "overloaded".
    return new AppError(503, "SCRIPTY_UNAVAILABLE", "Scripty's AI service is temporarily unavailable. Please try again shortly.");
  }
  return AppError.internal("Something went wrong while Scripty was answering. Please try again.");
}

/** A short, content-free description of an error for server logs. */
export function describeForLog(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    const requestId = err.headers?.get("request-id");
    return `${err.constructor.name} status=${err.status ?? "n/a"}${requestId ? ` request-id=${requestId}` : ""}`;
  }
  if (err instanceof AppError) return `AppError ${err.code}`;
  return err instanceof Error ? err.name : "unknown";
}
