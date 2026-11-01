import { sourceFileSchema } from "./source-file-contract";
import { z } from "zod";
import { createHash } from "node:crypto";

// Serialized storage contract only. This reader does not invoke the retired parser or article selectors.
const documentSchema = z.object({
  schemaVersion: z.literal(1),
  parser: z.object({ name: z.enum(["parse5", "unpdf", "prepared"]),
    version: z.enum(["8.0.1", "1.8.0", "1.0.0", "1.1.0", "1.2.0"]),
    profile: z.enum(["juro-legal-blocks-v1", "juro-legal-blocks-v2", "juro-legal-pdf-v1",
      "juro-prepared-blocks-v1", "juro-prepared-blocks-v2", "juro-prepared-blocks-v3", "juro-publisher-blocks-v1"]),
  }),
  source: z.object({ sourceKind: z.literal("lex"), locale: z.enum(["ru", "uz", "uzc", "en"]),
    canonicalId: z.string().min(1), canonicalUrl: z.url(), rawContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  primarySelector: z.enum(["main", "article", "role-main", "lex-document", "lex-pdf"]),
  documentTitle: z.string(),
  blocks: z.array(z.object({ index: z.number().int().nonnegative(),
    kind: z.enum(["heading", "paragraph", "list_item", "quote", "definition", "table_cell", "preformatted"]),
    text: z.string(), headingLevel: z.number().int().min(1).max(6).optional(),
    semanticRole: z.enum(["article", "paragraph", "revision", "section", "chapter", "subsection"]).optional(),
    tableRows: z.array(z.array(z.object({ text: z.string(), colSpan: z.number().int().positive(),
      rowSpan: z.number().int().positive() }))).optional(),
  })).min(1).max(100_000),
  plainText: z.string(),
  sourceFile: sourceFileSchema.optional(),
});
export type NormalizedDocument = z.infer<typeof documentSchema>;

export function articleNumberFromHeading(text: string): string | undefined {
  const superscripts = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  const heading = text.trim().replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu, value => `-${[...value].map(char => superscripts.indexOf(char)).join("")}`);
  return /^(?:Article|Статья)\s+([1-9]\d{0,5}(?:-\d{1,4})?)(?=[.\s:]|$)/iu.exec(heading)?.[1]
    ?? /^([1-9]\d{0,5}(?:-\d{1,4})?)[-‐‑–]\s*(?:modda|модда)(?=[.\s:]|$)/iu.exec(heading)?.[1];
}

function documentUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(url.hostname)
    || url.username || url.password || url.port) throw new Error("EVIDENCE_DOCUMENT_IDENTITY");
  url.hostname = "lex.uz";
  url.hash = "";
  return url.href;
}

function parseDocument(serialized: string, expectedUrl: string) {
  return validateDocument(JSON.parse(serialized), expectedUrl);
}

function validateDocument(value: unknown, expectedUrl: string) {
  const document = documentSchema.parse(value);
  if (documentUrl(document.source.canonicalUrl) !== documentUrl(expectedUrl)
    || (document.sourceFile && document.primarySelector === "lex-pdf"
      && new URL(document.source.canonicalUrl).href !== new URL(expectedUrl).href)) {
    throw new Error("EVIDENCE_DOCUMENT_IDENTITY");
  }
  let previous = -1;
  for (const block of document.blocks) {
    if (block.index <= previous) throw new Error("EVIDENCE_DOCUMENT_ORDER");
    previous = block.index;
  }
  return document;
}

function renderBlocks(title: string, blocks: z.infer<typeof documentSchema>["blocks"]) {
  const parts = [title];
  for (const block of blocks) {
    const rows = block.tableRows?.map(row => row.map(cell => {
      const spans = cell.rowSpan === 1 && cell.colSpan === 1 ? ""
        : ` [row span ${cell.rowSpan}; column span ${cell.colSpan}]`;
      return cell.text + spans;
    }).join(" | ")).join("\n");
    parts.push(rows ? `${block.text}\n${rows}` : block.text);
  }
  const text = parts.join("\n\n");
  if (!text.trim()) throw new Error("EVIDENCE_DOCUMENT_EMPTY");
  return text;
}

/** Returns all retained blocks. No search-hit selection or length truncation. */
export function readNormalizedDocument(serialized: string, expectedUrl: string): string {
  const document = parseDocument(serialized, expectedUrl);
  return renderDocument(document);
}

function renderDocument(document: NormalizedDocument) {
  if (document.sourceFile?.articleNumber) throw new Error("EVIDENCE_MEDIA_SCOPE");
  return renderBlocks(document.documentTitle, document.blocks);
}

/** Optional additive metadata binds visual evidence without changing legacy receipt formats. */
export function readNormalizedSourceFile(serialized: string, expectedUrl: string) {
  return parseDocument(serialized, expectedUrl).sourceFile;
}

/** Select only explicit article headings; mentions and search-unit ordinals are not boundaries. */
export function normalizedArticleRange(document: NormalizedDocument, articleNumber: string) {
  if (!/^[1-9]\d{0,5}(?:-\d{1,4})?$/u.test(articleNumber)) throw new Error("EVIDENCE_ARTICLE_NUMBER");
  const matches: number[] = [];
  document.blocks.forEach((block, index) => {
    if (block.kind !== "heading" || block.semanticRole !== "article") return;
    const number = articleNumberFromHeading(block.text);
    if (number === articleNumber) matches.push(index);
  });
  if (!matches.length) throw new Error("EVIDENCE_ARTICLE_MISSING");
  if (matches.length !== 1) throw new Error("EVIDENCE_ARTICLE_AMBIGUOUS");
  const start = matches[0];
  let end = start + 1;
  while (end < document.blocks.length) {
    const block = document.blocks[end];
    if (block.kind === "heading" && block.semanticRole === "article") break;
    if (block.kind === "heading" && block.semanticRole
      && ["section", "chapter", "subsection"].includes(block.semanticRole)) {
      const articleLevel = document.blocks[start].headingLevel;
      if (articleLevel === undefined || block.headingLevel === undefined) throw new Error("EVIDENCE_ARTICLE_BOUNDARY_AMBIGUOUS");
      if (block.headingLevel <= articleLevel) break;
    }
    end++;
  }
  if (!document.blocks.slice(start + 1, end).some(block => block.text.trim() || block.tableRows?.length)) {
    throw new Error("EVIDENCE_ARTICLE_EMPTY");
  }
  return { start, end };
}

export function readNormalizedArticle(serialized: string, expectedUrl: string, articleNumber: string): string {
  const document = parseDocument(serialized, expectedUrl);
  return renderArticle(document, articleNumber);
}

function renderArticle(document: NormalizedDocument, articleNumber: string) {
  if (document.sourceFile?.articleNumber && document.sourceFile.articleNumber !== articleNumber) throw new Error("EVIDENCE_MEDIA_SCOPE");
  const { start, end } = normalizedArticleRange(document, articleNumber);
  return renderBlocks(document.documentTitle, document.blocks.slice(start, end));
}

/** Authenticate the document once for both its complete text and visual-evidence binding. */
export function readNormalizedEvidence(serialized: string, expectedUrl: string,
  selection: { kind: "normalized-document" } | { kind: "normalized-article"; articleNumber: string }) {
  const document = parseDocument(serialized, expectedUrl);
  return { sourceFile: document.sourceFile, text: selection.kind === "normalized-article"
    ? renderArticle(document, selection.articleNumber) : renderDocument(document) };
}

/** In-memory publisher snapshots use the same checks without a whole-document JSON round trip. */
export function readNormalizedSnapshot(value: unknown, expectedUrl: string, articleNumber?: string) {
  const document = validateDocument(value, expectedUrl);
  return articleNumber === undefined ? renderDocument(document) : renderArticle(document, articleNumber);
}

/** Saved-format compatibility only. Never use these historical layouts to admit new legal evidence. */
export function readSavedNormalizedText(input: { serialized: string; expectedUrl: string;
  kind: "normalized-article" | "normalized-document" | "normalized-section"; articleNumber: string | null; textSha256: string }) {
  if (Buffer.byteLength(input.serialized) > 8 * 1024 * 1024) throw new Error("CITATION_OBJECT_BOUND");
  const document = parseDocument(input.serialized, input.expectedUrl);
  if (document.sourceFile?.articleNumber && (input.kind !== "normalized-article"
    || document.sourceFile.articleNumber !== input.articleNumber)) throw new Error("EVIDENCE_MEDIA_SCOPE");
  const ranges: Array<{ start: number; end: number }> = [];
  if (input.kind === "normalized-article") {
    if (!input.articleNumber) throw new Error("CITATION_ARTICLE_MISSING");
    ranges.push(normalizedArticleRange(document, input.articleNumber));
  } else if (input.kind === "normalized-section") {
    for (let start = 0; start < document.blocks.length; start++) {
      const heading = document.blocks[start];
      if (heading.kind !== "heading" || !heading.semanticRole || !heading.headingLevel
        || !["section", "chapter", "subsection"].includes(heading.semanticRole)) continue;
      if (ranges.length >= 1000) throw new Error("CITATION_SECTION_BOUND");
      let end = start + 1;
      while (end < document.blocks.length) {
        const next = document.blocks[end];
        if (next.kind === "heading" && (!next.headingLevel || next.headingLevel <= heading.headingLevel)) break;
        end++;
      }
      if (end > start + 1) ranges.push({ start, end });
    }
  } else ranges.push({ start: 0, end: document.blocks.length });
  let processed = 0;
  for (const { start, end } of ranges) {
    const blocks = document.blocks.slice(start, end);
    const candidates = new Set([renderBlocks(document.documentTitle, blocks)]);
    if (document.parser.profile !== "juro-publisher-blocks-v1") {
      // The immutable receipt chooses the layout; never search arbitrary substrings or substitute current law.
      for (const separator of ["\n", "\n\n"]) {
        const body = blocks.map(block => block.text).join(separator);
        candidates.add(body);
        candidates.add([document.documentTitle, body].join(separator));
      }
      if (input.kind === "normalized-document") candidates.add(document.plainText);
    }
    for (const candidate of candidates) {
      processed += Buffer.byteLength(candidate);
      if (processed > 64 * 1024 * 1024) throw new Error("CITATION_SECTION_BOUND");
      // Older receipts retained only a text identity for their section/layout.
      // Use it to select that saved view, never to certify corpus authenticity.
      if (candidate.trim() && createHash("sha256").update(candidate).digest("hex") === input.textSha256) return candidate;
    }
  }
  throw new Error("CITATION_SAVED_SELECTION_UNAVAILABLE");
}
