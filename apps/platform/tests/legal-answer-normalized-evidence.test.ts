import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readOfficialProvision, type ProvisionLocator } from "../lib/legal-answer-workflow/evidence";
import { readNormalizedArticle, readNormalizedDocument, readNormalizedSnapshot, readSavedNormalizedText } from "../lib/legal-answer-workflow/normalized-document";

const snapshot = () => ({ schemaVersion: 1,
  parser: { name: "prepared", version: "1.2.0", profile: "juro-prepared-blocks-v3" },
  source: { sourceKind: "lex", locale: "en", canonicalId: "123", canonicalUrl: "https://lex.uz/docs/123",
    rawContentSha256: "a".repeat(64) }, primarySelector: "lex-document", documentTitle: "Artificial Act",
  blocks: [
    { index: 0, kind: "heading", text: "Article 1. Requirement", semanticRole: "article" },
    { index: 1, kind: "paragraph", text: "A permit is required for public events." },
    { index: 2, kind: "paragraph", text: "Exception: private gatherings need no permit." },
    { index: 3, kind: "table_cell", text: "Fees", tableRows: [[
      { text: "Public event", colSpan: 1, rowSpan: 1 }, { text: "10 units", colSpan: 1, rowSpan: 1 },
    ]] },
  ], plainText: "Artificial Act" });

function fixture(document: unknown) {
  const bytes = Buffer.from(JSON.stringify(document));
  const locator: ProvisionLocator = { identity: "document", snapshot: "revision", objectKey: "normalized.json",
    sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
    sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
    canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true,
    encoding: "normalized-document" };
  return { locator, objects: { get: async () => bytes } };
}

test("in-memory source reads preserve complete rendering and revalidate mutable snapshots", () => {
  const document = snapshot(), url = document.source.canonicalUrl;
  assert.equal(readNormalizedSnapshot(document, url, "1"), readNormalizedArticle(JSON.stringify(document), url, "1"));
  assert.equal(readNormalizedSnapshot(document, url), readNormalizedDocument(JSON.stringify(document), url));
  assert.throws(() => readNormalizedSnapshot(document, "https://lex.uz/docs/999", "1"), /EVIDENCE_DOCUMENT_IDENTITY/);
  document.blocks[2].text = "Changed exception.";
  assert.match(readNormalizedSnapshot(document, url, "1"), /Changed exception/);
  document.blocks[2].index = 0;
  assert.throws(() => readNormalizedSnapshot(document, url, "1"), /EVIDENCE_DOCUMENT_ORDER/);
  assert.throws(() => readNormalizedSnapshot({ ...document, blocks: [] }, url), /./);
});

test("legacy saved article layouts reopen only when the exact recorded text hash matches", () => {
  const document = snapshot();
  const legacyText = document.blocks.map(block => block.text).join("\n\n");
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  const input = { serialized: JSON.stringify(document), expectedUrl: document.source.canonicalUrl,
    kind: "normalized-article" as const, articleNumber: "1", textSha256: digest(legacyText) };
  assert.equal(readSavedNormalizedText(input), legacyText);
  assert.throws(() => readSavedNormalizedText({ ...input, textSha256: digest(document.blocks[2].text) }), /CITATION_SAVED_SELECTION_UNAVAILABLE/);
  assert.throws(() => readSavedNormalizedText({ ...input, expectedUrl: "https://lex.uz/docs/999" }), /EVIDENCE_DOCUMENT_IDENTITY/);
  document.parser.profile = "juro-publisher-blocks-v1";
  assert.throws(() => readSavedNormalizedText({ ...input, serialized: JSON.stringify(document) }), /CITATION_SAVED_SELECTION_UNAVAILABLE/);
});

test("saved section receipts reopen an exact bounded structural section including nested content", () => {
  const document = { ...snapshot(), blocks: [
    { index: 0, kind: "heading", semanticRole: "section", headingLevel: 2, text: "Section A" },
    { index: 1, kind: "paragraph", text: "Artificial section rule." },
    { index: 2, kind: "heading", semanticRole: "subsection", headingLevel: 3, text: "Nested condition" },
    { index: 3, kind: "paragraph", text: "Artificial exception." },
    { index: 4, kind: "heading", semanticRole: "section", headingLevel: 2, text: "Section B" },
    { index: 5, kind: "paragraph", text: "Unrelated rule." },
  ] };
  const text = document.blocks.slice(0, 4).map(block => block.text).join("\n\n");
  const digest = (value: string) => createHash("sha256").update(value).digest("hex");
  const input = { serialized: JSON.stringify(document), expectedUrl: document.source.canonicalUrl,
    kind: "normalized-section" as const, articleNumber: null, textSha256: digest(text) };
  assert.equal(readSavedNormalizedText(input), text);
  assert.throws(() => readSavedNormalizedText({ ...input, textSha256: digest("Artificial section rule.") }), /CITATION_SAVED_SELECTION_UNAVAILABLE/);
});

test("authenticated normalized documents retain exceptions and every table cell", async () => {
  const { locator, objects } = fixture(snapshot());
  const result = await readOfficialProvision(locator, objects);
  assert.equal(result.text, ["Artificial Act", "Article 1. Requirement",
    "A permit is required for public events.", "Exception: private gatherings need no permit.",
    "Fees\nPublic event | 10 units"].join("\n\n"));
  assert.equal(result.sha256, locator.sha256);
});

test("normalized object hashes cannot authorize a different publisher document", async () => {
  const document = snapshot();
  document.source.canonicalUrl = "https://lex.uz/docs/999";
  const { locator, objects } = fixture(document);
  await assert.rejects(() => readOfficialProvision(locator, objects), /EVIDENCE_DOCUMENT_IDENTITY/);
});

test("duplicate or unordered normalized block positions cannot silently drop text", async () => {
  const document = snapshot();
  document.blocks[2].index = 1;
  const { locator, objects } = fixture(document);
  await assert.rejects(() => readOfficialProvision(locator, objects), /EVIDENCE_DOCUMENT_ORDER/);
});

test("article selection keeps the complete rule, exception and table without adjacent articles", () => {
  const document = snapshot();
  document.blocks.push({ index: 4, kind: "heading", text: "Article 2. Other rule", semanticRole: "article" },
    { index: 5, kind: "paragraph", text: "A different rule." });
  const text = readNormalizedArticle(JSON.stringify(document), document.source.canonicalUrl, "1");
  assert.match(text, /Exception: private gatherings/);
  assert.match(text, /Public event \| 10 units/);
  assert.doesNotMatch(text, /Article 2|different rule/);
});

test("article selection rejects missing and ambiguous boundaries and preserves language headings", () => {
  for (const heading of ["Статья 12. Условия", "12-modda. Shartlar", "12-модда. Шартлар", "Article 12. Conditions"]) {
    const document = snapshot();
    document.blocks[0].text = heading;
    assert.match(readNormalizedArticle(JSON.stringify(document), document.source.canonicalUrl, "12"), /Exception:/);
    assert.throws(() => readNormalizedArticle(JSON.stringify(document), document.source.canonicalUrl, "1"), /EVIDENCE_ARTICLE_MISSING/);
    document.blocks.push({ index: 4, kind: "heading", text: heading, semanticRole: "article" });
    assert.throws(() => readNormalizedArticle(JSON.stringify(document), document.source.canonicalUrl, "12"), /EVIDENCE_ARTICLE_AMBIGUOUS/);
  }
});

test("selected article reads preserve qualifications and require an explicit article selector", async () => {
  const { locator, objects } = fixture(snapshot());
  const result = await readOfficialProvision({ ...locator, encoding: "normalized-article", articleNumber: "1" }, objects);
  assert.match(result.text, /Exception:/);
  await assert.rejects(() => readOfficialProvision({ ...locator, encoding: "normalized-article" }, objects), /EVIDENCE_INELIGIBLE/);
});

test("an article's nested sections are retained and unknown structural levels are rejected", () => {
  const document = { ...snapshot(), blocks: [
    { index: 0, kind: "heading", semanticRole: "article", headingLevel: 2, text: "Article 1. Rule" },
    { index: 1, kind: "paragraph", text: "Requirement." },
    { index: 2, kind: "heading", semanticRole: "subsection", headingLevel: 3, text: "Exceptions" },
    { index: 3, kind: "paragraph", text: "The requirement does not apply to private events." },
    { index: 4, kind: "heading", semanticRole: "chapter", headingLevel: 1, text: "Next chapter" },
  ] };
  const text = readNormalizedArticle(JSON.stringify(document), document.source.canonicalUrl, "1");
  assert.match(text, /does not apply/);
  assert.doesNotMatch(text, /Next chapter/);
  delete document.blocks[2].headingLevel;
  assert.throws(() => readNormalizedArticle(JSON.stringify(document), document.source.canonicalUrl, "1"), /BOUNDARY_AMBIGUOUS/);
});
