import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/config/env";
import type { ExtractionProvider, ExtractionResult } from "./types";
import { VISION_RESPONSE_SCHEMA, VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from "./visionPrompt";
import { parseVisionResponse, VisionResponseParseError } from "./visionResponseParser";
import { VisionProviderError } from "./visionTransport";
import { prepareImage } from "./visionImage";

// Prescription reading with Claude's vision, through the official
// Anthropic SDK.
//
// PRIVACY NOTE, deliberately stated in code: selecting this provider
// (AI_PROVIDER=anthropic) sends the user's prescription image to
// Anthropic. That is an operator decision, which is why the provider is
// chosen explicitly in server/.env and is never a silent fallback.
//
// What is enforced here rather than assumed:
//   - The configured model must accept images. Checked once against the
//     Models API (capabilities.image_input) before the first image is
//     sent; a text-only model is refused with a clear configuration error.
//   - The response must match a JSON Schema (structured outputs), and is
//     then validated again by the shared parser, which also strips any
//     value the model marked as not visible or illegitimately inferred.
//   - Errors are classified (auth, quota, rate limit, outage, timeout) so
//     the user is told the truth and offered a retry when one can help.
//
// Never logged: the image, its base64, or the model's transcription.

let client: Anthropic | null = null;
let testClient: Anthropic | null = null;
let verifiedModel: string | null = null;

function getClient(): Anthropic {
  if (testClient) return testClient;
  if (!env.anthropicApiKey) {
    throw new VisionProviderError(
      "NOT_CONFIGURED",
      'AI_PROVIDER="anthropic" requires ANTHROPIC_API_KEY in server/.env. Create a key at https://console.anthropic.com/settings/keys.',
      { retryable: false }
    );
  }
  client ??= new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 2, timeout: env.visionTimeoutMs });
  return client;
}

/** Test seam for the MOCKED-model tests. */
export function setVisionClientForTests(fake: Anthropic | null) {
  testClient = fake;
  verifiedModel = null;
}

async function verifyModelAcceptsImages(anthropic: Anthropic, model: string) {
  if (verifiedModel === model) return;
  let info;
  try {
    info = await anthropic.models.retrieve(model);
  } catch (err) {
    throw classify(err);
  }
  if (info.capabilities && !info.capabilities.image_input.supported) {
    throw new VisionProviderError(
      "NOT_CONFIGURED",
      `ANTHROPIC_VISION_MODEL="${model}" does not accept image input, so it cannot read prescriptions. Choose a Claude model with vision.`,
      { retryable: false }
    );
  }
  verifiedModel = model;
}

/** Maps SDK errors to classified, user-presentable errors. Never forwards upstream text. */
function classify(err: unknown): VisionProviderError {
  if (err instanceof VisionProviderError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new VisionProviderError(
      "AUTH",
      "The AI service rejected this server's credentials. An administrator needs to check ANTHROPIC_API_KEY.",
      { retryable: false, status: err.status }
    );
  }
  if (err instanceof Anthropic.APIError && err.type === "billing_error") {
    return new VisionProviderError(
      "QUOTA_EXHAUSTED",
      "The AI service's usage quota or credit is exhausted, so the prescription can't be read right now. An administrator needs to check the Anthropic account. You can retry once that's resolved.",
      { retryable: false, status: err.status }
    );
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new VisionProviderError("RATE_LIMITED", "The AI service is busy right now. Please wait a minute and try again.", {
      retryable: true,
      status: 429,
    });
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new VisionProviderError(
      "MODEL_UNAVAILABLE",
      `The configured vision model "${env.anthropicVisionModel}" isn't available. An administrator needs to check ANTHROPIC_VISION_MODEL.`,
      { retryable: false, status: 404 }
    );
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new VisionProviderError("TIMEOUT", "The AI service took too long to read the prescription. Please try again.", { retryable: true });
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new VisionProviderError("NETWORK", "The AI service couldn't be reached. Please check the connection and try again.", {
      retryable: true,
    });
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new VisionProviderError("BAD_RESPONSE", "The AI service couldn't process this image. Try a clearer, well-lit photo.", {
      retryable: false,
      status: 400,
    });
  }
  if (err instanceof Anthropic.APIError) {
    return new VisionProviderError(
      "MODEL_UNAVAILABLE",
      "The AI service is temporarily unavailable. Please try again in a few minutes.",
      { retryable: true, status: err.status }
    );
  }
  return new VisionProviderError("UNKNOWN", "Something went wrong while reading the prescription. Please try again.", { retryable: true });
}

export class AnthropicVisionProvider implements ExtractionProvider {
  readonly name = "anthropic";

  async extractPrescription(input: { imagePath: string; mimeType: string }): Promise<ExtractionResult> {
    const anthropic = getClient();
    const model = env.anthropicVisionModel;
    await verifyModelAcceptsImages(anthropic, model);

    const image = await prepareImage(input.imagePath, input.mimeType);

    let response: Anthropic.Message;
    try {
      response = await anthropic.messages.create({
        model,
        max_tokens: 16000,
        system: VISION_SYSTEM_PROMPT,
        // Transcription accuracy matters more than speed here.
        output_config: { effort: "high", format: { type: "json_schema", schema: VISION_RESPONSE_SCHEMA as unknown as Record<string, unknown> } },
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } },
              { type: "text", text: VISION_USER_PROMPT },
            ],
          },
        ],
      });
    } catch (err) {
      const classified = classify(err);
      console.warn(`[vision:anthropic] request failed (${classified.kind}${classified.status ? ` ${classified.status}` : ""})`);
      throw classified;
    }

    if (response.stop_reason === "refusal") {
      throw new VisionProviderError(
        "BAD_RESPONSE",
        "The AI service declined to read this image. If it is a prescription, try a clearer photo that shows only the prescription.",
        { retryable: false }
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new VisionProviderError("BAD_RESPONSE", "The prescription reading was cut short. Please try again.", { retryable: true });
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!text.trim()) {
      throw new VisionProviderError("BAD_RESPONSE", "The AI service returned an empty reading. Please try again.", { retryable: true });
    }

    try {
      return parseVisionResponse(text, this.name);
    } catch (err) {
      if (err instanceof VisionResponseParseError) {
        throw new VisionProviderError("BAD_RESPONSE", "The AI service's reading couldn't be understood. Please try again.", {
          retryable: true,
        });
      }
      throw err;
    }
  }
}
