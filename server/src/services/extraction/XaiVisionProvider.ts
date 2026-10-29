import { env } from "@/config/env";
import type { ExtractionProvider, ExtractionResult } from "./types";
import { VISION_JSON_SHAPE, VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from "./visionPrompt";
import { parseVisionResponse, VisionResponseParseError } from "./visionResponseParser";
import { classifyHttpFailure, postJsonWithTimeout, withRetries, VisionProviderError } from "./visionTransport";
import { prepareImage } from "./visionImage";

// Hosted vision extraction via xAI's Grok API (https://docs.x.ai), which
// uses the OpenAI-style chat completions format.
//
// PRIVACY NOTE: selecting this provider (as AI_PROVIDER or
// AI_FALLBACK_PROVIDER) sends the user's prescription image to xAI.

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }>;
}

interface LanguageModelInfo {
  input_modalities?: string[];
}

// model -> verified. Checked once per process, like the Anthropic provider.
const imageCapability = new Map<string, boolean>();

function baseUrl(): string {
  return env.xaiApiBaseUrl.replace(/\/$/, "");
}

/**
 * Confirms the configured model accepts images before any image is sent.
 * A transport failure here is not treated as "no" — the real request
 * will surface the actual error.
 */
async function verifyModelAcceptsImages(model: string): Promise<void> {
  if (imageCapability.get(model)) return;

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/language-models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${env.xaiApiKey}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return;
  }
  if (!response.ok) {
    throw classifyHttpFailure(response.status, await response.text().catch(() => ""));
  }
  const info = (await response.json().catch(() => ({}))) as LanguageModelInfo;
  if (Array.isArray(info.input_modalities) && !info.input_modalities.includes("image")) {
    throw new VisionProviderError(
      "NOT_CONFIGURED",
      `XAI_MODEL="${model}" does not accept images. Choose a Grok model with image input in server/.env.`,
      { retryable: false }
    );
  }
  imageCapability.set(model, true);
}

export class XaiVisionProvider implements ExtractionProvider {
  readonly name = "xai";

  async extractPrescription(input: { imagePath: string; mimeType: string }): Promise<ExtractionResult> {
    if (!env.xaiApiKey) {
      throw new VisionProviderError(
        "NOT_CONFIGURED",
        "Grok prescription reading requires XAI_API_KEY in server/.env. Create a key at https://console.x.ai.",
        { retryable: false }
      );
    }

    const model = env.xaiModel;
    await verifyModelAcceptsImages(model);
    const image = await prepareImage(input.imagePath, input.mimeType, { allowWebp: false });

    const requestBody = {
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${VISION_SYSTEM_PROMPT}\n\n${VISION_JSON_SHAPE}` },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}`, detail: "high" } },
            { type: "text", text: VISION_USER_PROMPT },
          ],
        },
      ],
    };

    const response = await withRetries(
      () =>
        postJsonWithTimeout<ChatCompletionResponse>({
          url: `${baseUrl()}/chat/completions`,
          body: requestBody,
          headers: { Authorization: `Bearer ${env.xaiApiKey}` },
          timeoutMs: env.visionTimeoutMs,
        }),
      { attempts: env.visionMaxAttempts, backoffMs: 1500, label: this.name }
    );

    const choice = response.choices?.[0];
    if (choice?.message?.refusal) {
      throw new VisionProviderError("BAD_RESPONSE", "The AI service declined to read this image. Try a clearer photo of the prescription.", {
        retryable: false,
      });
    }
    const content = choice?.message?.content ?? "";
    if (!content.trim()) {
      throw new VisionProviderError("BAD_RESPONSE", "The vision model returned an empty response.", { retryable: false });
    }
    if (choice?.finish_reason === "length") {
      throw new VisionProviderError("BAD_RESPONSE", "The prescription was too long to read in one pass. Try photographing one page at a time.", {
        retryable: false,
      });
    }

    try {
      return parseVisionResponse(content, this.name);
    } catch (err) {
      if (err instanceof VisionResponseParseError) {
        throw new VisionProviderError("BAD_RESPONSE", err.message, { retryable: false });
      }
      throw err;
    }
  }
}
