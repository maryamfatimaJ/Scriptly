import { env } from "@/config/env";
import type { ExtractionProvider, ExtractionResult } from "./types";
import { VISION_JSON_SHAPE, VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from "./visionPrompt";
import { parseVisionResponse, VisionResponseParseError } from "./visionResponseParser";
import { postJsonWithTimeout, withRetries, VisionProviderError } from "./visionTransport";
import { prepareImage } from "./visionImage";

// Hosted vision extraction via Google AI Studio's Gemini API, which also
// serves the open Gemma models (https://ai.google.dev/gemini-api/docs).
//
// PRIVACY NOTE, deliberately stated in code: selecting this provider sends
// the user's prescription image to Google. That is a real decision with
// real consequences for medical data, which is why it is opt-in via
// AI_PROVIDER and never a silent fallback from the local provider.
//
// Model support: per the Gemma 3 model card
// (https://ai.google.dev/gemma/docs/core/model_card_3), 4B/12B/27B accept
// image input; 1B and 270M are text-only and are rejected below.

const TEXT_ONLY_MODELS = [/gemma-3-1b/i, /gemma-3-270m/i, /gemma-2/i];

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

export class GoogleGemmaVisionProvider implements ExtractionProvider {
  readonly name = "google";

  async extractPrescription(input: { imagePath: string; mimeType: string }): Promise<ExtractionResult> {
    if (!env.googleApiKey) {
      throw new VisionProviderError(
        "NOT_CONFIGURED",
        'AI_PROVIDER="google" requires GOOGLE_API_KEY. Get a free key at https://aistudio.google.com/apikey and add it to server/.env.',
        { retryable: false }
      );
    }

    const model = env.googleModel;
    if (TEXT_ONLY_MODELS.some((pattern) => pattern.test(model))) {
      throw new VisionProviderError(
        "NOT_CONFIGURED",
        `GOOGLE_MODEL="${model}" is a text-only model and cannot read prescription images. ` +
          `Use a multimodal variant such as "gemma-3-4b-it" (only Gemma 3 4B/12B/27B accept images).`,
        { retryable: false }
      );
    }

    const image = await prepareImage(input.imagePath, input.mimeType);

    const requestBody = {
      // Gemma models on the Gemini API don't accept a separate system role,
      // so the system prompt is prepended to the user turn instead.
      contents: [
        {
          role: "user",
          parts: [
            { text: `${VISION_SYSTEM_PROMPT}\n\n${VISION_JSON_SHAPE}\n\n${VISION_USER_PROMPT}` },
            { inline_data: { mime_type: image.mediaType, data: image.data } },
          ],
        },
      ],
      // Gemini models support a JSON response mode; Gemma models don't.
      generationConfig: /^gemini/i.test(model)
        ? { temperature: 0.1, responseMimeType: "application/json" }
        : { temperature: 0.1 },
    };

    const response = await withRetries(
      () =>
        postJsonWithTimeout<GeminiResponse>({
          // The key goes in a header, never the URL — URLs leak into logs,
          // proxies, and error messages.
          url: `${env.googleApiBaseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent`,
          body: requestBody,
          headers: { "x-goog-api-key": env.googleApiKey as string },
          timeoutMs: env.visionTimeoutMs,
        }),
      { attempts: env.visionMaxAttempts, backoffMs: 1500, label: this.name }
    );

    if (response.promptFeedback?.blockReason) {
      throw new VisionProviderError(
        "BAD_RESPONSE",
        `The provider blocked this image (${response.promptFeedback.blockReason}). Try a clearer photo of the prescription.`,
        { retryable: false }
      );
    }

    const content = response.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    if (!content.trim()) {
      throw new VisionProviderError("BAD_RESPONSE", "The vision model returned an empty response.", {
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
