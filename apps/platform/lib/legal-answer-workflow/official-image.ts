import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { withinSignal } from "./lifetime";

/** Preserve raster pixels in a PDF carrier; this does not turn OCR into legal evidence. */
export async function officialImagePdf(input: { bytes: Uint8Array; sha256: string; signal: AbortSignal }) {
  input.signal.throwIfAborted();
  if (!input.bytes.length || input.bytes.length > 16 * 1024 * 1024
    || createHash("sha256").update(input.bytes).digest("hex") !== input.sha256) throw new Error("SOURCE_FILE_INTEGRITY");
  const options = { limitInputPixels: 16_000_000, failOn: "warning" as const };
  const metadata = await withinSignal(input.signal, () => sharp(input.bytes, options).metadata());
  if (!metadata.format || !["png", "jpeg", "gif", "webp", "tiff", "avif", "heif"].includes(metadata.format)
    || !metadata.width || !metadata.height || metadata.width * metadata.height > 16_000_000
    || !Number.isInteger(metadata.pages ?? 1) || (metadata.pages ?? 1) < 1
    || (metadata.pages ?? 1) > 64) throw new Error("SOURCE_IMAGE_FORMAT_BOUND");
  const pdf = await PDFDocument.create();
  // Conversion metadata is deterministic and does not purport to date the underlying law.
  pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
  let pixels = 0;
  for (let page = 0; page < (metadata.pages ?? 1); page++) {
    const pageOptions = { ...options, page, pages: 1 };
    const pageMetadata = await withinSignal(input.signal, () => sharp(input.bytes, pageOptions).metadata());
    if (!pageMetadata.width || !pageMetadata.height) throw new Error("SOURCE_IMAGE_FORMAT_BOUND");
    pixels += pageMetadata.width * pageMetadata.height;
    if (pixels > 16_000_000) throw new Error("SOURCE_IMAGE_FORMAT_BOUND");
    const imageBytes = await withinSignal(input.signal,
      () => sharp(input.bytes, pageOptions).timeout({ seconds: 5 }).autoOrient().png().toBuffer());
    const image = await withinSignal(input.signal, () => pdf.embedPng(imageBytes));
    const scale = Math.min(1, 14_400 / Math.max(image.width, image.height));
    const width = image.width * scale, height = image.height * scale;
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  const bytes = await withinSignal(input.signal, () => pdf.save());
  if (bytes.length > 16 * 1024 * 1024) throw new Error("SOURCE_FILE_CONTEXT_LIMIT");
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
