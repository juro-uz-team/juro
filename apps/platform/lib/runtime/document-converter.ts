import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDocumentTool } from "./process";
import { extractDocument } from "../document-comparison/extract";
import { inspectPdfPageCount, DOCUMENT_ANALYSIS_PDF_PAGE_LIMIT } from "../document-analysis/pdf-preflight";

export interface DocumentConversion { name: string; mimeType: string; format: string; tokens: number; data: string }
export interface ConversionInput { name: string; blob: Blob }
export interface DocumentConverter {
  toMarkdown(input: ConversionInput): Promise<DocumentConversion>;
  toMarkdown(input: ConversionInput[]): Promise<DocumentConversion[]>;
}

async function convert(input: ConversionInput): Promise<DocumentConversion> {
  if (input.blob.size > 50 * 1024 * 1024) throw new Error("Document conversion size exceeded");
  const bytes = new Uint8Array(await input.blob.arrayBuffer());
  const directory = await mkdtemp(join(tmpdir(), "juro-ocr-"));
  let text: string;
  const checked = async (program: string, args: string[]) => {
    const result = await runDocumentTool(program, args);
    if (result.code !== 0) throw new Error("Document conversion failed");
    return result.stdout;
  };
  try {
    const source = join(directory, "source");
    await writeFile(source, bytes, { mode: 0o600 });
    if (input.blob.type === "application/pdf") {
      await inspectPdfPageCount(bytes);
      // Render a single bounded page at a time to avoid accumulating full-document images.
      const info = await checked("pdfinfo", [source]);
      const pages = Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]);
      if (!Number.isSafeInteger(pages) || pages < 1 || pages > DOCUMENT_ANALYSIS_PDF_PAGE_LIMIT) throw new Error("PDF page limit exceeded");
      const texts: string[] = [];
      for (let page = 1; page <= pages; page++) {
        const embedded = await checked("pdftotext", ["-f", String(page), "-l", String(page), "-layout", source, "-"]);
        if (embedded.trim().length >= 40) texts.push(embedded);
        else {
          const image = join(directory, "page");
          await checked("pdftoppm", ["-f", String(page), "-l", String(page), "-singlefile", "-scale-to", "3000", "-png", source, image]);
          texts.push(await checked("tesseract", [image + ".png", "stdout", "-l", "rus+uzb+uzb_cyrl+eng"]));
          await rm(image + ".png");
        }
      }
      text = texts.join("\n\n");
    } else if (input.blob.type.startsWith("image/")) {
      text = await checked("tesseract", [source, "stdout", "-l", "rus+uzb+uzb_cyrl+eng"]);
    } else {
      text = (await extractDocument({ fileName: input.name, mimeType: input.blob.type, bytes, sizeBytes: bytes.length })).text;
    }
    if (!text.trim() || text.length > 8 * 1024 * 1024) throw new Error("Invalid extracted text");
    return { name: input.name, mimeType: input.blob.type, format: "text", tokens: Math.ceil(text.length / 3), data: text };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function toMarkdown(input: ConversionInput): Promise<DocumentConversion>;
async function toMarkdown(input: ConversionInput[]): Promise<DocumentConversion[]>;
async function toMarkdown(input: ConversionInput | ConversionInput[]): Promise<DocumentConversion | DocumentConversion[]> {
  if (!Array.isArray(input)) return convert(input);
  const results: DocumentConversion[] = [];
  for (const item of input) results.push(await convert(item));
  return results;
}
export const localDocumentConverter: DocumentConverter = { toMarkdown };
