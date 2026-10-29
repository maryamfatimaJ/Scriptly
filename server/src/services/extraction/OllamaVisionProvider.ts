import { env } from "@/config/env";
import type { ExtractionProvider, ExtractionResult } from "./types";
import { VISION_JSON_SHAPE, VISION_SYSTEM_PROMPT, VISION_USER_PROMPT } from "./visionPrompt";
import { parseVisionResponse, VisionResponseParseError } from "./visionResponseParser";
import { postJsonWithTimeout, readImageAsBase64, withRetries, VisionProviderError } from "./visionTransport";

// Local vision extraction via Ollama (https://ollama.com).
//
// Chosen as the privacy-preserving option: the prescription image never
// leaves the machine, which matters more than usual here because these are
// medical documents belonging to someone else.
//
// Requires a MULTIMODAL model. Per Google's Gemma 3 model card
// (https://ai.google.dev/gemma/docs/core/model_card_3), only the 4B, 12B
// and 27B variants accept image input — gemma3:1b and gemma3:270m are
// TEXT-ONLY and will fail or ignore the image. OLLAMA_MODEL therefore
// defaults to "gemma3:4b" and is validated below.

const TEXT_ONLY_MODELS = [/^gemma3:1b/i, /^gemma3:270m/i, /^gemma2/i, /^llama3(\.\d+)?:[^v]*$/i];

export class OllamaVisionProvider implements ExtractionProvider {
  readonly name = "ollama";

  async extractPrescription(input: { imagePath: string; mimeType: string }): Promise<ExtractionResult> {
    const model = env.ollamaModel;

    if (TEXT_ONLY_MODELS.some((pattern) => pattern.test(model))) {
      throw new VisionProviderError(
        "NOT_CONFIGURED",
        `OLLAMA_MODEL="${model}" is a text-only model and cannot read prescription images. ` +
          `Use a multimodal Gemma 3 variant such as "gemma3:4b" (see Google's Gemma 3 model card: only 4B/12B/27B accept images).`,
        { retryable: false }
      );
    }

    const imageBase64 = await readImageAsBase64(input.imagePath, input.mimeType);

    const requestBody = {
      model,
      stream: false,
      // Ollama's /api/chat accepts images as base64 strings on the message.
      messages: [
        { role: "system", content: `${VISION_SYSTEM_PROMPT}\n\n${VISION_JSON_SHAPE}` },
        { role: "user", content: VISION_USER_PROMPT, images: [imageBase64] },
      ],
      // Low temperature: transcription should be deterministic, not creative.
      options: { temperature: 0.1 },
      format: "json",
    };

    const response = await withRetries(
      () =>
        postJsonWithTimeout<{ message?: { content?: string } }>({
          url: `${env.ollamaBaseUrl.replace(/\/$/, "")}/api/chat`,
          body: requestBody,
          timeoutMs: env.visionTimeoutMs,
        }),
      { attempts: env.visionMaxAttempts, backoffMs: 1000, label: this.name }
    );

    const content = response.message?.content;
    if (!content || !content.trim()) {
      throw new VisionProviderError("BAD_RESPONSE", "Ollama returned an empty response.", { retryable: false });
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
