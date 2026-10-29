import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { VisionProviderError } from "./visionTransport";

// Image preparation shared by the hosted vision providers.
//
// Phone photos of prescriptions usually carry an EXIF orientation flag
// rather than rotated pixels; a model given the raw pixels may see the
// page sideways. Large photos are also downsized: well above what the
// model needs for legible text, and over some providers' per-image limits.
// The image is re-encoded only when it actually needs changing.

// Long edge, in pixels. Large enough for small handwriting.
const MAX_LONG_EDGE_PX = 2400;
const MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;

export type PreparedMediaType = "image/jpeg" | "image/png" | "image/webp";

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function prepareImage(
  imagePath: string,
  mimeType: string,
  // xAI accepts only JPG and PNG; a WebP upload is re-encoded for it.
  options: { allowWebp?: boolean } = {}
): Promise<{ data: string; mediaType: PreparedMediaType }> {
  // Checked again here, not only at upload: nothing but an accepted image
  // type is ever sent to a provider, whatever path a file arrived by.
  if (!ALLOWED_MIME.has(mimeType)) {
    throw new VisionProviderError(
      "BAD_RESPONSE",
      `Unsupported image type "${mimeType}". Scriptly accepts JPG, PNG, and WebP prescription images.`,
      { retryable: false }
    );
  }

  let original: Buffer;
  try {
    original = await fs.readFile(path.resolve(imagePath));
  } catch {
    throw new VisionProviderError("BAD_RESPONSE", "The uploaded prescription image could not be read from storage.", { retryable: false });
  }

  let metadata: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    metadata = await sharp(original).metadata();
  } catch {
    throw new VisionProviderError(
      "BAD_RESPONSE",
      "This file couldn't be opened as an image. Please upload a JPG, PNG or WebP photo of the prescription.",
      { retryable: false }
    );
  }

  const longEdge = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  const rotated = (metadata.orientation ?? 1) !== 1;
  const formatOk = options.allowWebp !== false || mimeType !== "image/webp";
  if (formatOk && !rotated && longEdge <= MAX_LONG_EDGE_PX && original.length <= MAX_IMAGE_BYTES) {
    return { data: original.toString("base64"), mediaType: mimeType as PreparedMediaType };
  }

  const processed = await sharp(original)
    .rotate() // applies the EXIF orientation
    .resize({ width: MAX_LONG_EDGE_PX, height: MAX_LONG_EDGE_PX, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { data: processed.toString("base64"), mediaType: "image/jpeg" };
}
