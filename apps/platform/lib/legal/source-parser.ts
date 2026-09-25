import { parse, type DefaultTreeAdapterTypes } from "parse5";

/**
 * Article-level structural extraction adapts a concept from
 * toxirerkinov70-commits/huquq-ai@1bce500c69b8213373d8ce0b40d56be7d83f6aec.
 * MIT License, Copyright (c) 2026 Toxir Erkinov. JURO parses live Lex HTML
 * only in request memory and never writes HTML, Markdown or article chunks.
 */
import { z } from "zod";
import {isLegalArticleHeading} from "./article-heading";
import type {
  LegalSourceKind,
  LegalSourceLocale,
  LegalSourceReference,
} from "./source-fetch";

export const LEGAL_SOURCE_PARSER_ERROR_CODES = [
  "LEGAL_SOURCE_PRIMARY_CONTENT_MISSING",
  "LEGAL_SOURCE_CONTENT_INSUFFICIENT",
  "LEGAL_SOURCE_LANGUAGE_TEXT_UNAVAILABLE",
  "LEGAL_SOURCE_PARSE_TOO_COMPLEX",
] as const;

export type LegalSourceParserErrorCode =
  (typeof LEGAL_SOURCE_PARSER_ERROR_CODES)[number];

export class LegalSourceParserError extends Error {
  constructor(readonly code: LegalSourceParserErrorCode) {
    super(code);
    this.name = "LegalSourceParserError";
  }
}

const normalizedBlockSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum([
    "heading",
    "paragraph",
    "list_item",
    "quote",
    "definition",
    "table_cell",
    "preformatted",
  ]),
  headingLevel: z.number().int().min(1).max(6).optional(),
  semanticRole: z.enum([
    "revision",
    "section",
    "chapter",
    "article",
    "paragraph",
  ]).optional(),
  text: z.string().min(1).max(100_000),
  tableRows: z.array(z.array(z.object({
    text:z.string().max(100_000),
    colSpan:z.number().int().min(1).max(64),
    rowSpan:z.number().int().min(1).max(4_000),
  }).strict()).min(1).max(64)).min(1).max(4_000).optional(),
}).strict();

export const normalizedLegalSourceSnapshotSchema = z.object({
  schemaVersion: z.literal(1),
  parser: z.object({
    name: z.enum(["parse5", "unpdf"]),
    version: z.enum(["8.0.1", "1.8.0"]),
    profile: z.enum(["juro-legal-blocks-v1", "juro-legal-blocks-v2", "juro-legal-pdf-v1"]),
  }).strict(),
  source: z.object({
    sourceKind: z.enum(["lex", "advice"]),
    // `uzc` is Lex.uz's official Uzbek Cyrillic route. It is represented as
    // `uz-Cyrl` in the new corpus, but retained here to preserve exact source
    // identity and never pass a transliteration off as the official text.
    // English is also an official Lex route and must survive normalization so
    // the multilingual ingestion worker does not dead-letter valid `/en/docs`.
    locale: z.enum(["ru", "uz", "uzc", "en"]),
    canonicalId: z.string().min(1),
    canonicalUrl: z.url(),
    rawContentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict(),
  primarySelector: z.enum([
    "main",
    "article",
    "role-main",
    "lex-document",
    "advice-document",
    "lex-pdf",
  ]),
  documentTitle: z.string().min(1).max(2_000),
  blocks: z.array(normalizedBlockSchema).min(1).max(8_000),
  plainText: z.string().min(200).max(3_000_000),
}).strict();

export type NormalizedLegalSourceSnapshot = z.infer<
  typeof normalizedLegalSourceSnapshotSchema
>;

type Element = DefaultTreeAdapterTypes.Element;
type Node = DefaultTreeAdapterTypes.Node;
type ParentNode = DefaultTreeAdapterTypes.ParentNode;

type MutableBlock = z.infer<typeof normalizedBlockSchema>;

const SKIPPED_TAGS = new Set([
  "aside",
  "button",
  "canvas",
  "dialog",
  "footer",
  "form",
  "header",
  "iframe",
  "nav",
  "noscript",
  "script",
  "style",
  "svg",
  "template",
]);
const NESTED_LIST_TAGS = new Set(["ol", "ul"]);
// Exact reader-control labels emitted by Lex.uz inside otherwise official
// title elements. They are presentation chrome, never part of an act title.
// Keep the plain strings exportable for the bounded corpus-title repair that
// remediates only this known UI artefact in already stored staging records.
export const LEGAL_SOURCE_UI_NOISE_MARKERS = [
  "Предложения по документу",
  "Прослушать аудио",
  "Получить ссылку",
  "Hujjatga taklif yuborish",
  "Audioni tinglash",
  "Hujjat elementidan havola olish",
  "Ҳужжатга таклиф юбориш",
  "Аудиони тинглаш",
  "Ҳужжат элементидан ҳавола олиш",
  "Suggestion to the document",
  "Listen to audio",
  "Get a link from a document element",
] as const;
const LEX_UI_NOISE_PATTERNS = [
  /Предложения по документу/giu,
  /Прослушать аудио/giu,
  /Получить ссылку(?:\s+(?:на|из)\s+элемент(?:а)?\s+документа)?/giu,
  /Hujjatga taklif yuborish/giu,
  /Audioni tinglash/giu,
  /Hujjat elementidan havola olish/giu,
  /Ҳужжатга таклиф юбориш/giu,
  /Аудиони тинглаш/giu,
  /Ҳужжат элементидан ҳавола олиш/giu,
  /Suggestion to the document/giu,
  /Listen to audio/giu,
  /Get a link from a document element/giu,
] as const;
const LEX_LANGUAGE_TEXT_UNAVAILABLE_PATTERNS = [
  /Текст акта приводится на [^.\n]{2,80} языке/iu,
  /Hujjat matni [^.\n]{2,80} tilida (?:berilgan|keltirilgan)/iu,
  /Ҳужжат матни [^.\n]{2,80} тилида (?:берилган|келтирилган)/iu,
  /The text of (?:this|the) act is (?:available|provided) in [^.\n]{2,80}/iu,
] as const;
const LEX_UI_CLASS_PATTERN = /(?:^|[-_])(?:audio|button|comment|control|footer|menu|navigation|proposal|share|toolbar)(?:$|[-_])/iu;
const MAX_NODES = 50_000;
// The current Tax Code contains about 6.8k semantic Lex elements. Keep a hard
// ceiling while allowing that official document to be queried live.
const MAX_BLOCKS = 8_000;
const MAX_PLAIN_TEXT = 3_000_000;

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function isTextNode(node: Node): node is DefaultTreeAdapterTypes.TextNode {
  return !isElement(node) && node.nodeName === "#text" && "value" in node;
}

function attribute(element: Element, name: string): string | null {
  return element.attrs.find((item) => item.name.toLowerCase() === name)
    ?.value ?? null;
}

function classTokens(element: Element): Set<string> {
  return new Set(
    (attribute(element, "class") ?? "")
      .split(/\s+/)
      .filter(Boolean),
  );
}

function isHidden(element: Element): boolean {
  if (attribute(element, "hidden") !== null) return true;
  if (attribute(element, "aria-hidden")?.toLowerCase() === "true") return true;
  const style = attribute(element, "style")?.toLowerCase() ?? "";
  return /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)(?:\s*!important)?\s*(?:;|$)/
    .test(style);
}

function isUiElement(element: Element): boolean {
  if (SKIPPED_TAGS.has(element.tagName) || isHidden(element)) return true;
  if (attribute(element, "role")?.toLowerCase() === "button") return true;
  if (attribute(element, "aria-label") && element.tagName !== "main") return true;
  return [...classTokens(element)].some((token) => LEX_UI_CLASS_PATTERN.test(token));
}

function normalizeText(value: string): string {
  return value
    .replaceAll("\u00a0", " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function removeLegalSourceUiNoise(value: string): string {
  return normalizeText(LEX_UI_NOISE_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, "\n"),
    `\n${value}\n`,
  ));
}

export function containsLegalSourceUiNoise(value: string): boolean {
  const normalized = normalizeText(value);
  return LEX_UI_NOISE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(normalized);
  });
}

function collectText(
  node: Node,
  options: { excludeNestedLists?: boolean; preserveSuperscripts?: boolean } = {},
): string {
  if (isTextNode(node)) return node.value;
  if (!isElement(node) && !("childNodes" in node)) return "";
  if (isElement(node)) {
    if (isUiElement(node)) return "";
    if (options.excludeNestedLists && NESTED_LIST_TAGS.has(node.tagName)) {
      return "";
    }
    if (node.tagName === "br") return "\n";
  }
  const text = node.childNodes.map((child) => collectText(child, options)).join("");
  // Preserve typography, without guessing which numeric superscripts are
  // article suffixes versus units or other official notation.
  return options.preserveSuperscripts && isElement(node) && node.tagName === "sup" && /^[0-9]+\.?$/u.test(text.trim())
    ? text.replace(/[0-9]/gu, digit => "⁰¹²³⁴⁵⁶⁷⁸⁹"[Number(digit)]!) : text;
}

function collectVisiblePageText(node: Node): string {
  if (isTextNode(node)) return node.value;
  if (!isElement(node) && !("childNodes" in node)) return "";
  if (isElement(node)) {
    if (SKIPPED_TAGS.has(node.tagName) || isHidden(node)) return "";
    if (node.tagName === "br") return "\n";
  }
  return node.childNodes.map((child) => collectVisiblePageText(child)).join("");
}

function walkElements(
  root: ParentNode,
  visitor: (element: Element) => void,
  counter: { value: number },
): void {
  for (const child of root.childNodes) {
    counter.value += 1;
    if (counter.value > MAX_NODES) {
      throw new LegalSourceParserError("LEGAL_SOURCE_PARSE_TOO_COMPLEX");
    }
    if (!isElement(child)) continue;
    visitor(child);
    if (!SKIPPED_TAGS.has(child.tagName) && !isHidden(child)) {
      walkElements(child, visitor, counter);
    }
  }
}

function findFirstElement(
  root: ParentNode,
  predicate: (element: Element) => boolean,
  counter: { value: number } = { value: 0 },
): Element | null {
  for (const child of root.childNodes) {
    counter.value += 1;
    if (counter.value > MAX_NODES) {
      throw new LegalSourceParserError("LEGAL_SOURCE_PARSE_TOO_COMPLEX");
    }
    if (!isElement(child)) continue;
    if (predicate(child)) return child;
    if (!SKIPPED_TAGS.has(child.tagName) && !isHidden(child)) {
      const nested = findFirstElement(child, predicate, counter);
      if (nested) return nested;
    }
  }
  return null;
}

function candidates(
  document: DefaultTreeAdapterTypes.Document,
  sourceKind: LegalSourceKind,
): {
  selector: "main" | "article" | "role-main" | "lex-document" | "advice-document";
  elements: Element[];
} {
  if (sourceKind === "lex") {
    // Current Lex pages expose their official body as #divCont/#divBody.
    // Stop at that root instead of walking a multi-megabyte code to the end
    // merely to discover the primary container.
    const lexDocument = findFirstElement(document, (element) => {
      const id = attribute(element, "id");
      return id === "divCont" || id === "divBody";
    });
    if (lexDocument) return { selector: "lex-document", elements: [lexDocument] };
  }
  const adviceDocuments: Element[] = [];
  const lexDocuments: Element[] = [];
  const mains: Element[] = [];
  const articles: Element[] = [];
  const roleMains: Element[] = [];
  walkElements(document, (element) => {
    if (classTokens(element).has("page-document-content")) {
      adviceDocuments.push(element);
    }
    const id = attribute(element, "id");
    if (id === "divCont" || id === "divBody") lexDocuments.push(element);
    if (element.tagName === "main") mains.push(element);
    if (element.tagName === "article") articles.push(element);
    if (attribute(element, "role")?.toLowerCase() === "main") {
      roleMains.push(element);
    }
  }, { value: 0 });
  if (sourceKind === "advice") {
    return { selector: "advice-document", elements: adviceDocuments };
  }
  if (lexDocuments.length > 0) return { selector: "lex-document", elements: lexDocuments };
  if (mains.length > 0) return { selector: "main", elements: mains };
  if (articles.length > 0) return { selector: "article", elements: articles };
  return { selector: "role-main", elements: roleMains };
}

function pickPrimary(elements: Element[]): Element | null {
  let selected: Element | null = null;
  let selectedLength = -1;
  for (const element of elements) {
    const length = normalizeText(collectText(element)).length;
    if (length > selectedLength) {
      selected = element;
      selectedLength = length;
    }
  }
  return selected;
}

function pushBlock(
  blocks: MutableBlock[],
  kind: MutableBlock["kind"],
  text: string,
  headingLevel?: number,
  semanticRole?: MutableBlock["semanticRole"],
): void {
  const normalized = removeLegalSourceUiNoise(text);
  if (!normalized) return;
  if (blocks.at(-1)?.text === normalized) return;
  if (normalized.length > 100_000 || blocks.length >= MAX_BLOCKS) {
    throw new LegalSourceParserError("LEGAL_SOURCE_PARSE_TOO_COMPLEX");
  }
  blocks.push({
    index: blocks.length,
    kind,
    ...(headingLevel ? { headingLevel } : {}),
    ...(semanticRole ? { semanticRole } : {}),
    text: normalized,
  });
}

function lexSemanticRole(classes: ReadonlySet<string>, text: string): MutableBlock["semanticRole"] | undefined {
  const names = [...classes].join(" ");
  if (/(?:ARTICLE|MODDA)/iu.test(names) || isLegalArticleHeading({text})) return "article";
  if (/(?:CHAPTER|BOB)/iu.test(names) || /^(?:глава|боб|chapter)\s+[\dIVXLCDM]+/iu.test(text)) return "chapter";
  if (/(?:SECTION|BO.LIM)/iu.test(names) || /^(?:раздел|бўлим|bo.lim|section)\s+[\dIVXLCDM]+/iu.test(text)) return "section";
  if (/(?:REVISION|EDITION|TAHRIR|DATE)/iu.test(names) || /^(?:редакция|tahrir|sana)\b/iu.test(text)) return "revision";
  if (/(?:PARAGRAPH|BAND|POINT)/iu.test(names) || /^(?:пункт|band)\s+\d+/iu.test(text)) return "paragraph";
  return undefined;
}

function collectBlocks(
  root: Element,
  sourceKind: LegalSourceKind,
  preserveSuperscripts = false,
): MutableBlock[] {
  const blocks: MutableBlock[] = [];
  let usesLexBlockAdapter = false;
  if (sourceKind === "lex") {
    usesLexBlockAdapter = Boolean(findFirstElement(
      root,
      (element) => classTokens(element).has("lx_elem"),
    ));
  }
  const visit = (element: Element): void => {
    if (isUiElement(element)) return;
    const classes = classTokens(element);
    if (usesLexBlockAdapter && !classes.has("lx_elem")) {
      for (const child of element.childNodes) {
        if (isElement(child)) visit(child);
      }
      return;
    }
    if (sourceKind === "lex" && classes.has("lx_elem")) {
      const text = collectText(element, {preserveSuperscripts});
      const semanticRole = lexSemanticRole(classes, text);
      const isHeading = classes.has("ACT_TITLE") || semanticRole === "section"
        || semanticRole === "chapter" || semanticRole === "article";
      pushBlock(
        blocks,
        isHeading ? "heading" : "paragraph",
        text,
        classes.has("ACT_TITLE") ? 1 : semanticRole === "section" ? 2 : semanticRole === "chapter" ? 3 : semanticRole === "article" ? 4 : undefined,
        semanticRole,
      );
      if(preserveSuperscripts&&blocks.at(-1)?.text===normalizeText(removeLegalSourceUiNoise(text))){
        const table=element.tagName==="table"?element:findFirstElement(element,node=>node.tagName==="table");
        if(table&&removeLegalSourceUiNoise(collectText(table,{preserveSuperscripts}))===removeLegalSourceUiNoise(text)
          &&!findFirstElement(table,node=>node.tagName==="table")){
          const rows:NonNullable<MutableBlock["tableRows"]>=[];
          let supported=true;
          walkElements(table,row=>{
            if(row.tagName!=="tr"||isUiElement(row))return;
            const cells=row.childNodes.filter(isElement).filter(cell=>cell.tagName==="td"||cell.tagName==="th");
            const parsed=cells.map(cell=>({text:normalizeText(removeLegalSourceUiNoise(collectText(cell,{preserveSuperscripts}))),
              colSpan:Number(attribute(cell,"colspan")??1),rowSpan:Number(attribute(cell,"rowspan")??1)}));
            if(!parsed.length||parsed.length>64||parsed.some(cell=>!Number.isInteger(cell.colSpan)||cell.colSpan<1||cell.colSpan>64
              ||!Number.isInteger(cell.rowSpan)||cell.rowSpan<1||cell.rowSpan>4_000))supported=false;
            rows.push(parsed);
          },{value:0});
          const represented=rows.flat().map(cell=>cell.text).join("").replace(/\s/gu,"");
          if(supported&&rows.length&&rows.length<=4_000&&represented===removeLegalSourceUiNoise(text).replace(/\s/gu,""))blocks.at(-1)!.tableRows=rows;
        }
      }
      return;
    }
    const heading = /^h([1-6])$/.exec(element.tagName);
    if (heading) {
      const text = collectText(element, {preserveSuperscripts});
      pushBlock(
        blocks,
        "heading",
        text,
        Number(heading[1]),
        sourceKind === "lex" ? lexSemanticRole(classes, text) : undefined,
      );
      return;
    }
    if (element.tagName === "p") {
      pushBlock(blocks, "paragraph", collectText(element, {preserveSuperscripts}));
      return;
    }
    if (element.tagName === "li") {
      pushBlock(
        blocks,
        "list_item",
        collectText(element, { excludeNestedLists: true, preserveSuperscripts }),
      );
      for (const child of element.childNodes) {
        if (isElement(child) && NESTED_LIST_TAGS.has(child.tagName)) {
          for (const nested of child.childNodes) {
            if (isElement(nested)) visit(nested);
          }
        }
      }
      return;
    }
    if (element.tagName === "blockquote") {
      pushBlock(blocks, "quote", collectText(element, {preserveSuperscripts}));
      return;
    }
    if (element.tagName === "dt" || element.tagName === "dd") {
      pushBlock(blocks, "definition", collectText(element, {preserveSuperscripts}));
      return;
    }
    if (element.tagName === "th" || element.tagName === "td") {
      pushBlock(blocks, "table_cell", collectText(element, {preserveSuperscripts}));
      return;
    }
    if (element.tagName === "pre") {
      pushBlock(blocks, "preformatted", collectText(element, {preserveSuperscripts}));
      return;
    }
    for (const child of element.childNodes) {
      if (isElement(child)) visit(child);
    }
  };
  visit(root);
  return blocks;
}

function documentTitle(
  document: DefaultTreeAdapterTypes.Document,
  primary: Element,
  blocks: MutableBlock[],
  sourceKind: LegalSourceKind,
  preserveSuperscripts = false,
): string {
  if (sourceKind === "lex") {
    const titleElement = findFirstElement(primary, (element) => {
      const classes = classTokens(element);
      return classes.has("lx_elem") && classes.has("ACT_TITLE");
    });
    const officialTitle = titleElement
      ? removeLegalSourceUiNoise(collectText(titleElement, {preserveSuperscripts}))
      : "";
    if (officialTitle) return officialTitle.slice(0, 2_000);
  }
  const heading = blocks.find((block) => block.kind === "heading")?.text;
  if (heading) return heading.slice(0, 2_000);
  let title = "";
  walkElements(document, (element) => {
    if (!title && element.tagName === "title") {
      title = normalizeText(collectText(element, {preserveSuperscripts}));
    }
  }, { value: 0 });
  if (!title) {
    throw new LegalSourceParserError("LEGAL_SOURCE_CONTENT_INSUFFICIENT");
  }
  return removeLegalSourceUiNoise(title).slice(0, 2_000);
}

type LegalSourceHtmlInput = {
  html: string;
  reference: Pick<
    LegalSourceReference,
    "sourceKind" | "locale" | "canonicalId" | "canonicalUrl"
  >;
  rawContentSha256: string;
  /** Opt in only for newly captured snapshots; retained profiles stay stable. */
  profile?: "juro-legal-blocks-v1" | "juro-legal-blocks-v2";
};

export function normalizeLegalSourceHtml(input: LegalSourceHtmlInput): NormalizedLegalSourceSnapshot {
  return normalizeParsedLegalSource(input, parse(input.html));
}

/** Two fingerprints share one parsed publisher document, never two fetches. */
export function normalizeLegalSourceHtmlProfiles(input: Omit<LegalSourceHtmlInput, "profile">) {
  const document = parse(input.html);
  return {
    snapshot: normalizeParsedLegalSource({...input, profile:"juro-legal-blocks-v1"}, document),
    structuredSnapshot: normalizeParsedLegalSource({...input, profile:"juro-legal-blocks-v2"}, document),
  };
}

function normalizeParsedLegalSource(input: LegalSourceHtmlInput, document: DefaultTreeAdapterTypes.Document): NormalizedLegalSourceSnapshot {
  const primaryCandidates = candidates(
    document,
    input.reference.sourceKind,
  );
  const primary = pickPrimary(primaryCandidates.elements);
  if (!primary) {
    throw new LegalSourceParserError(
      "LEGAL_SOURCE_PRIMARY_CONTENT_MISSING",
    );
  }
  const blocks = collectBlocks(primary, input.reference.sourceKind, input.profile === "juro-legal-blocks-v2");
  const plainText = blocks.map((block) => block.text).join("\n\n");
  if (blocks.length === 0 || plainText.length < 200) {
    // Lex places the authoritative "text is in another language" warning in
    // a sibling of #divBody on some legacy acts. Inspect the parsed document
    // only for this fixed notice after the selected legal body is proven too
    // short; no surrounding page chrome is admitted to the normalized text.
    const sourceText = normalizeText(collectVisiblePageText(document));
    if (input.reference.sourceKind === "lex"
      && LEX_LANGUAGE_TEXT_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(sourceText))) {
      throw new LegalSourceParserError("LEGAL_SOURCE_LANGUAGE_TEXT_UNAVAILABLE");
    }
    throw new LegalSourceParserError("LEGAL_SOURCE_CONTENT_INSUFFICIENT");
  }
  if (plainText.length > MAX_PLAIN_TEXT) {
    throw new LegalSourceParserError("LEGAL_SOURCE_PARSE_TOO_COMPLEX");
  }
  return normalizedLegalSourceSnapshotSchema.parse({
    schemaVersion: 1,
    parser: {
      name: "parse5",
      version: "8.0.1",
      profile: input.profile ?? "juro-legal-blocks-v1",
    },
    source: {
      sourceKind: input.reference.sourceKind as LegalSourceKind,
      locale: input.reference.locale as LegalSourceLocale,
      canonicalId: input.reference.canonicalId,
      canonicalUrl: input.reference.canonicalUrl,
      rawContentSha256: input.rawContentSha256,
    },
    primarySelector: primaryCandidates.selector,
    documentTitle: documentTitle(document, primary, blocks, input.reference.sourceKind, input.profile === "juro-legal-blocks-v2"),
    blocks,
    plainText,
  });
}
