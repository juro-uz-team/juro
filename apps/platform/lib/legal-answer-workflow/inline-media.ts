import { createHash } from "node:crypto";
import { PDFDict, PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import type { OfficialCapture } from "./official-capture";
import { officialPublisherUrl } from "./official-capture";
import type { normalizePublisherHtml } from "./publisher-html";
import { selectPublisherDocument, selectPublisherProvision } from "./provision-selection";
import { officialImagePdf } from "./official-image";
import { normalizeOfficialPdf } from "./official-pdf";
import type { SourceFile } from "./source-file-contract";
import type { EvidenceScope } from "./evidence";
import { withinSignal } from "./lifetime";

/** Recover only authenticated media belonging to the complete selected provision. */
export async function recoverInlineMedia(input: {
  document: ReturnType<typeof normalizePublisherHtml>; position: string | null; scope: EvidenceScope;
  read(url: string): Promise<OfficialCapture>; signal: AbortSignal;
}) {
  const select = (document: typeof input.document) => input.position === null
    ? selectPublisherDocument(document) : selectPublisherProvision(document, input.position);
  try { return { document: input.document, selected: select(input.document), artifacts: [] as OfficialCapture[] }; }
  catch (error) { if (!(error instanceof Error) || error.message !== "PROVISION_EXTRACTION_GAP") throw error; }
  // Current publisher bytes cannot establish the historical contents of a mutable image URL.
  if (input.scope.kind !== "current") throw new Error("PROVISION_HISTORICAL_MEDIA_UNVERIFIED");
  const proposed = select({ ...input.document, gaps: input.document.gaps.filter(gap => gap.kind !== "unread_media") });
  const media = input.document.media.filter(item => item.blockIndex >= proposed.start && item.blockIndex <= proposed.end);
  const urls = [...new Set(media.map(item => officialPublisherUrl(item.url)))];
  if (!urls.length || urls.length > 8 || media.length > 32 || urls.some(url => url.length > 2048)) throw new Error("PROVISION_MEDIA_BOUND");
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.setCreationDate(new Date(0)); pdf.setModificationDate(new Date(0));
  const artifacts: OfficialCapture[] = [];
  let total = 0;
  for (const url of urls) {
    const capture = await withinSignal(input.signal, () => input.read(url));
    if (officialPublisherUrl(capture.requestedUrl) !== url || capture.bytes.length !== capture.byteCount
      || createHash("sha256").update(capture.bytes).digest("hex") !== capture.sha256) throw new Error("PROVISION_MEDIA_IDENTITY");
    total += capture.byteCount;
    if (total > 16 * 1024 * 1024) throw new Error("PROVISION_MEDIA_BOUND");
    let rendered: Uint8Array;
    if (capture.contentType === "application/pdf") {
      await normalizeOfficialPdf({ ...capture, sourceUrl: url, title: input.document.snapshot.documentTitle,
        locale: input.document.snapshot.source.locale, signal: input.signal });
      rendered = capture.bytes;
    } else {
      if (!capture.contentType.startsWith("image/")) throw new Error("PROVISION_MEDIA_FORMAT");
      rendered = (await officialImagePdf({ ...capture, signal: input.signal })).bytes;
    }
    const source = await withinSignal(input.signal, () => PDFDocument.load(rendered));
    const separateLabel = capture.contentType === "application/pdf";
    if (pdf.getPageCount() + source.getPageCount() + Number(separateLabel) > 64) throw new Error("PROVISION_MEDIA_BOUND");
    const label = `Publisher media: ${url}\nBlocks: ${media.filter(item => officialPublisherUrl(item.url) === url).map(item => item.blockIndex).join(", ")}`;
    const lines = label.split("\n").flatMap(line => line.match(/.{1,80}/gu) ?? []);
    if (separateLabel) {
      // Embedding a page as graphics loses annotations and form appearances.
      // Flatten existing field appearances, then copy complete page dictionaries.
      if (source.catalog.lookupMaybe(PDFName.of("AcroForm"), PDFDict)?.has(PDFName.of("XFA"))
        || source.catalog.has(PDFName.of("OCProperties"))) throw new Error("PROVISION_MEDIA_PDF_UNSUPPORTED");
      const form = source.getForm();
      const widgets = new Set(form.getFields().flatMap(field => field.acroField.getWidgets().map(widget => widget.dict)));
      const flattened = new Set(source.getPages().flatMap(page => page.node.Annots()?.asArray() ?? []).filter(annotation => {
        const dictionary = source.context.lookup(annotation);
        if (!(dictionary instanceof PDFDict)) throw new Error("PROVISION_MEDIA_PDF_UNSUPPORTED");
        if (dictionary.get(PDFName.of("Subtype")) !== PDFName.of("Widget")) return false;
        if (!widgets.has(dictionary)) throw new Error("PROVISION_MEDIA_PDF_UNSUPPORTED");
        return true;
      }));
      form.flatten({ updateFieldAppearances: false });
      // pdf-lib can leave references to deleted widget objects after flattening.
      // Remove only widgets whose appearances were just written into page content.
      for (const page of source.getPages()) {
        const annotations = page.node.Annots();
        if (annotations) for (let index = annotations.size() - 1; index >= 0; index--) {
          if (flattened.has(annotations.get(index))) annotations.remove(index);
        }
      }
      const height = Math.max(120, lines.length * 12 + 30);
      const labelPage = pdf.addPage([600, height]);
      lines.forEach((line, index) => labelPage.drawText(line, { x: 8, y: height - 12 * (index + 1), size: 9, font }));
      const pages = await withinSignal(input.signal, () => pdf.copyPages(source, source.getPageIndices()));
      for (const [index, page] of pages.entries()) {
        if ((page.node.Annots()?.size() ?? 0) !== (source.getPage(index).node.Annots()?.size() ?? 0)) {
          throw new Error("PROVISION_MEDIA_PDF_UNSUPPORTED");
        }
        pdf.addPage(page);
      }
      artifacts.push(capture);
      continue;
    }
    for (const page of source.getPages()) {
      const embedded = await withinSignal(input.signal, () => pdf.embedPage(page));
      const scale = Math.min(1, 14_400 / Math.max(embedded.width, embedded.height));
      const width = embedded.width * scale, height = embedded.height * scale, header = lines.length * 12 + 16;
      const target = pdf.addPage([Math.max(600, width), height + header]);
      target.drawPage(embedded, { x: 0, y: 0, width, height });
      lines.forEach((line, index) => target.drawText(line, { x: 8, y: height + header - 12 * (index + 1), size: 9, font }));
    }
    artifacts.push(capture);
  }
  const bytes = await withinSignal(input.signal, () => pdf.save());
  if (bytes.length > 16 * 1024 * 1024) throw new Error("PROVISION_MEDIA_BOUND");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const sourceFile: SourceFile = { objectKey: `legal-evidence/raw/${sha256}`, sha256, byteCount: bytes.length,
    ...(proposed.articleNumber ? { articleNumber: proposed.articleNumber } : {}),
    originals: artifacts.map(item => ({ objectKey: `legal-evidence/raw/${item.sha256}`, sha256: item.sha256, byteCount: item.byteCount })) };
  const resolved = new Set(urls);
  const document = { ...input.document, snapshot: { ...input.document.snapshot, sourceFile },
    gaps: input.document.gaps.filter(gap => {
      if (gap.kind !== "unread_media" || gap.blockIndex === null || gap.blockIndex < proposed.start || gap.blockIndex > proposed.end) return true;
      try { return !resolved.has(officialPublisherUrl(new URL(gap.detail, input.document.snapshot.source.canonicalUrl).href)); }
      catch { return true; }
    }) };
  return { document, selected: select(document), artifacts, pdf: { bytes, sourceFile } };
}
