import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { articleNumberFromHeading, type NormalizedDocument } from "./normalized-document";
import { officialPublisherUrl, type OfficialCapture } from "./official-capture";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const attr = (node: Node, name: string) => "attrs" in node ? node.attrs.find(item => item.name === name)?.value : undefined;
const classes = (node: Node) => (attr(node, "class") ?? "").split(/\s+/u);
const children = (node: Node): Node[] => "childNodes" in node ? node.childNodes : [];
const tag = (node: Node) => "tagName" in node ? node.tagName : "";
const ignored = (node: Node) => ["script", "style", "template", "button"].includes(tag(node))
  || classes(node).some(value => ["lx_elem2", "lx_elem3", "INDEXES_ON_REF", "COMMENTLEXUZ"].includes(value));
function plain(node: Node): string {
  if (ignored(node)) return "";
  if ("value" in node) return node.value;
  if (["br", "hr"].includes(tag(node))) return "\n";
  if (["img", "video", "audio", "iframe", "object", "embed"].includes(tag(node))) {
    const target = attr(node, "src") ?? attr(node, "data");
    return target ? `[Publisher media: ${target}]` : "";
  }
  const text = children(node).map(plain).join("");
  if (tag(node) === "sup" && /^\d+$/u.test(text)) return [...text].map(char => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(char)]).join("");
  return ["p", "div", "li", "tr"].includes(tag(node)) ? `\n${text}\n` : text;
}
const clean = (value: string) => value.replace(/\s+/gu, " ").trim();
const parsedDocuments = new Map<string, { document: ReturnType<typeof parsePublisherHtml>; bytes: number }>();
let retainedBytes = 0;
const maximumRetainedBytes = 16 * 1024 * 1024;

/** Independently normalizes publisher markup. Edition displays remain observations, not applicability claims. */
export function normalizePublisherHtml(capture: OfficialCapture, locale: NormalizedDocument["source"]["locale"]) {
  if (capture.byteCount > 8 * 1024 * 1024 || capture.bytes.byteLength !== capture.byteCount
    || createHash("sha256").update(capture.bytes).digest("hex") !== capture.sha256) throw new Error("PUBLISHER_CAPTURE_INTEGRITY");
  const documentId = (value: string) => /^\/(?:ru\/|uz\/|uzc\/|en\/)?docs\/(-?\d+)\/?$/u.exec(new URL(officialPublisherUrl(value)).pathname)?.[1];
  const canonicalId = documentId(capture.finalUrl);
  if (!canonicalId || canonicalId !== documentId(capture.requestedUrl)) throw new Error("PUBLISHER_DOCUMENT_IDENTITY");
  if (!["text/html", "application/xhtml+xml"].includes(capture.contentType)) throw new Error("PUBLISHER_HTML_REQUIRED");
  // Only parsing is shared. Every caller supplies and authenticates fresh
  // publisher bytes; edition observations remain request-owned downstream.
  const key = JSON.stringify([capture.sha256, capture.finalUrl, locale]);
  const cached = parsedDocuments.get(key);
  if (cached) {
    parsedDocuments.delete(key); parsedDocuments.set(key, cached);
    return structuredClone(cached.document);
  }
  const document = parsePublisherHtml(capture, locale, canonicalId);
  const bytes = Buffer.byteLength(JSON.stringify(document));
  if (bytes <= 8 * 1024 * 1024) {
    while (parsedDocuments.size >= 16 || retainedBytes + bytes > maximumRetainedBytes) {
      const oldest = parsedDocuments.keys().next().value!;
      retainedBytes -= parsedDocuments.get(oldest)!.bytes;
      parsedDocuments.delete(oldest);
    }
    parsedDocuments.set(key, { document, bytes }); retainedBytes += bytes;
    return structuredClone(document);
  }
  return document;
}

function parsePublisherHtml(capture: OfficialCapture, locale: NormalizedDocument["source"]["locale"], canonicalId: string) {
  const document = parse(new TextDecoder("utf-8", { fatal: true }).decode(capture.bytes));
  const roots: Element[] = [], selectedEditions: string[] = [], editionDates: string[] = [];
  const editionNavigation: { label: string; url: string }[] = [];
  let count = 0;
  function scan(node: Node, depth = 0, editionMenu = false) {
    if (++count > 250_000 || depth > 256) throw new Error("PUBLISHER_STRUCTURE_BOUND");
    if (attr(node, "id") === "divCont" && "tagName" in node) roots.push(node);
    editionMenu ||= ["lx_var_t", "lx_var_b"].includes(attr(node, "id") ?? "");
    if (editionMenu && classes(node).includes("lx_date_selected")) selectedEditions.push(clean(plain(node)));
    if (editionMenu && classes(node).some(value => ["lx_date_selected", "lx_date_link"].includes(value))) {
      const label = clean(plain(node));
      const target = /^lxOpenUrl\('([^']+)'\);?$/u.exec(attr(node, "onclick") ?? "")?.[1];
      let currentNavigation = false;
      if (target) {
        const url = new URL(target, capture.finalUrl);
        const base = new URL(capture.finalUrl); base.search = ""; base.hash = "";
        currentNavigation = url.href === base.href && !/^\d{2}\.\d{2}\.\d{4}(?: \d{2})?$/u.test(label);
        editionNavigation.push({ label, url: url.href });
      }
      if (!currentNavigation) editionDates.push(label);
    }
    children(node).forEach(child => scan(child, depth + 1, editionMenu));
  }
  scan(document);
  if (roots.length !== 1) throw new Error("PUBLISHER_DOCUMENT_ROOT");
  const blocks: NormalizedDocument["blocks"] = [], referenceNotes: string[] = [];
  const links: { url: string; text: string; blockIndex: number; role: "operative" | "reference" }[] = [];
  const media: { url: string; blockIndex: number }[] = [];
  const gaps: { kind: string; detail: string; blockIndex: number | null }[] = [];
  const positions: Record<string, number[]> = Object.create(null);
  function remember(node: Node) {
    const id = attr(node, "id");
    if (id && /^-?\d+$/u.test(id)) {
      const indices = positions[id] ??= [];
      if (!indices.includes(blocks.length)) indices.push(blocks.length);
    }
  }
  let title = "";
  function observe(node: Node, reference = false) {
    if (ignored(node)) return;
    reference ||= classes(node).includes("COMMENT");
    if (!reference) remember(node);
    if (tag(node) === "a" && attr(node, "href")) {
      try {
        const url = new URL(attr(node, "href")!, capture.finalUrl);
        if (["https:", "http:"].includes(url.protocol)) links.push({ url: url.href, text: clean(plain(node)), blockIndex: blocks.length,
          role: reference ? "reference" : "operative" });
      } catch { gaps.push({ kind: "unread_link", detail: "Publisher link could not be resolved.", blockIndex: blocks.length }); }
    }
    if (!reference && ["img", "video", "audio", "iframe", "object", "embed", "canvas", "svg"].includes(tag(node))) {
      gaps.push({ kind: "unread_media", detail: attr(node, "src") ?? attr(node, "data") ?? tag(node), blockIndex: blocks.length });
      const target = attr(node, "src") ?? attr(node, "data");
      if (target) {
        try { media.push({ url: new URL(target, capture.finalUrl).href, blockIndex: blocks.length }); }
        catch { /* The existing unread-media gap remains unresolved. */ }
      }
    }
    children(node).forEach(child => observe(child, reference));
  }
  function emit(text: string, node: Node) {
    text = clean(text);
    if (!text) return;
    const block: NormalizedDocument["blocks"][number] = { index: blocks.length, kind: "paragraph", text };
    const css = classes(node);
    if (css.includes("CLAUSE_DEFAULT") && articleNumberFromHeading(text)) {
      Object.assign(block, { kind: "heading", semanticRole: "article", headingLevel: 3 });
    } else if (css.includes("ACT_TITLE_APPL")) {
      Object.assign(block, { kind: "heading", semanticRole: "section", headingLevel: 1 });
    } else if (css.includes("TEXT_HEADER_DEFAULT")) {
      Object.assign(block, { kind: "heading", semanticRole: "section", headingLevel: 2 });
    } else if (css.includes("CHANGES_ORIGINS")) block.semanticRole = "revision";
    if (css.includes("ACT_TITLE")) title ||= text;
    blocks.push(block);
  }
  function table(node: Node) {
    const rows: NonNullable<NormalizedDocument["blocks"][number]["tableRows"]> = [];
    function visitRow(element: Node) {
      if (element !== node && tag(element) === "table") { gaps.push({ kind: "nested_table", detail: "Nested table requires structural review.", blockIndex: blocks.length }); return; }
      if (tag(element) === "tr") {
        const cells = children(element).filter(child => ["td", "th"].includes(tag(child)));
        rows.push(cells.map(cell => {
          const span = (name: string) => {
            const value = Number(attr(cell, name) ?? 1);
            if (!Number.isInteger(value) || value < 1 || value > 1000) throw new Error("PUBLISHER_TABLE_SPAN");
            return value;
          };
          return { text: clean(plain(cell)), colSpan: span("colspan"), rowSpan: span("rowspan") };
        }));
      }
      children(element).forEach(visitRow);
    }
    visitRow(node);
    const caption = children(node).filter(child => tag(child) === "caption").map(child => clean(plain(child))).join("\n");
    if (rows.length) blocks.push({ index: blocks.length, kind: "table_cell", text: caption, tableRows: rows });
    else gaps.push({ kind: "empty_table", detail: "Table has no readable rows.", blockIndex: blocks.length });
  }
  function visit(node: Node) {
    if (ignored(node)) return;
    if (classes(node).includes("COMMENT")) { referenceNotes.push(clean(plain(node))); observe(node, true); return; }
    remember(node);
    if (tag(node) === "table") { observe(node); table(node); return; }
    const descendants = children(node);
    const nestedTable = (item: Node): boolean => tag(item) === "table" || children(item).some(nestedTable);
    if ((classes(node).includes("lx_elem") || ["p", "li", "pre", "blockquote"].includes(tag(node))) && !nestedTable(node)) {
      observe(node); emit(plain(node), node); return;
    }
    if (!descendants.length) { observe(node); if ("value" in node) emit(node.value, node); return; }
    if (!descendants.some(child => ["div", "p", "table", "ul", "ol", "li"].includes(tag(child)))) {
      observe(node); emit(plain(node), node); return;
    }
    descendants.forEach(visit);
  }
  children(roots[0]).forEach(visit);
  if (!blocks.length) throw new Error("PUBLISHER_DOCUMENT_EMPTY");
  if (!title) gaps.push({ kind: "missing_title", detail: "Publisher document title was not identified.", blockIndex: null });
  const snapshot: NormalizedDocument = { schemaVersion: 1, parser: { name: "parse5", version: "8.0.1", profile: "juro-publisher-blocks-v1" },
    source: { sourceKind: "lex", locale, canonicalId, canonicalUrl: capture.finalUrl, rawContentSha256: capture.sha256 },
    primarySelector: "lex-document", documentTitle: title, blocks,
    plainText: blocks.map(block => block.tableRows
      ? [block.text, ...block.tableRows.map(row => row.map(cell => cell.text).join(" | "))].join("\n") : block.text).join("\n\n") };
  return { snapshot, links, media, referenceNotes, gaps, positions, selectedEditions: [...new Set(selectedEditions)], editionDates: [...new Set(editionDates)], editionNavigation };
}
