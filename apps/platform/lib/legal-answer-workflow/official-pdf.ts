import { createHash } from "node:crypto";
import { getDocumentProxy } from "unpdf";
import type { NormalizedDocument } from "./normalized-document";
import { withinSignal } from "./lifetime";

/** Native text is navigation only; every page of the original remains mandatory model evidence. */
export async function normalizeOfficialPdf(input: { bytes: Uint8Array; sha256: string; sourceUrl: string;
  title: string; locale: NormalizedDocument["source"]["locale"]; signal: AbortSignal }) {
  input.signal.throwIfAborted();
  if (input.bytes.length > 16 * 1024 * 1024 || Buffer.from(input.bytes.subarray(0, 5)).toString("ascii") !== "%PDF-"
    || createHash("sha256").update(input.bytes).digest("hex") !== input.sha256) throw new Error("SOURCE_FILE_INTEGRITY");
  const loading = getDocumentProxy(new Uint8Array(input.bytes), { useSystemFonts: false });
  // Dispose even if the caller expires while PDF.js is still opening the document.
  void loading.then(pdf => { if (input.signal.aborted) void pdf.loadingTask.destroy().catch(() => {}); }, () => {});
  const pdf = await withinSignal(input.signal, () => loading);
  const abort = () => { void pdf.loadingTask.destroy().catch(() => {}); };
  input.signal.addEventListener("abort", abort, { once: true });
  try {
    if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1 || pdf.numPages > 64) throw new Error("SOURCE_FILE_PAGE_LIMIT");
    const blocks: NormalizedDocument["blocks"] = [];
    let characters = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await withinSignal(input.signal, () => pdf.getPage(pageNumber));
      const content = await withinSignal(input.signal, () => page.getTextContent());
      const text = content.items.map(item => "str" in item ? item.str : "").join(" ").trim();
      const navigation = `Page ${pageNumber}. ${text || "No native text; read the original page image."}`;
      characters += navigation.length;
      if (characters > 60_000) throw new Error("PROVISION_CONTEXT_BOUND");
      blocks.push({ index: pageNumber - 1, kind: "paragraph", text: navigation });
      page.cleanup();
    }
    input.signal.throwIfAborted();
    const snapshot: NormalizedDocument = { schemaVersion: 1,
      parser: { name: "unpdf", version: "1.8.0", profile: "juro-legal-pdf-v1" },
      source: { sourceKind: "lex", locale: input.locale, canonicalId: input.sha256,
        canonicalUrl: input.sourceUrl, rawContentSha256: input.sha256 },
      primarySelector: "lex-pdf", documentTitle: input.title, blocks,
      plainText: blocks.map(block => block.text).join("\n\n") };
    return snapshot;
  } finally {
    input.signal.removeEventListener("abort", abort);
    await pdf.loadingTask.destroy();
  }
}
