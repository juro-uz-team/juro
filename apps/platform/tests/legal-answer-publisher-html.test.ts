import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizePublisherHtml } from "../lib/legal-answer-workflow/publisher-html";
import { readNormalizedArticle, readNormalizedDocument } from "../lib/legal-answer-workflow/normalized-document";
import type { OfficialCapture } from "../lib/legal-answer-workflow/official-capture";

function capture(html: string): OfficialCapture {
  const bytes = Buffer.from(html);
  return { requestedUrl: "https://lex.uz/docs/123", finalUrl: "https://lex.uz/docs/123", redirects: [],
    observedAt: new Date().toISOString(), contentType: "text/html", bytes, byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex") };
}

test("shared public parsing reauthenticates captures and isolates returned documents", () => {
  const source = capture('<div id="divCont"><div class="ACT_TITLE">Cached artificial Act</div><p id="10">Complete rule.</p><img src="/files/condition.png"></div>');
  const first = normalizePublisherHtml(source, "en");
  const expected = structuredClone(first);
  first.snapshot.blocks[0].text = "Mutated title";
  first.positions["10"].push(999);
  first.gaps.length = 0;
  assert.deepEqual(normalizePublisherHtml({ ...source, observedAt: new Date().toISOString() }, "en"), expected);
  assert.throws(() => normalizePublisherHtml({ ...source, bytes: Buffer.alloc(source.byteCount) }, "en"), /PUBLISHER_CAPTURE_INTEGRITY/);
  assert.throws(() => normalizePublisherHtml({ ...source, requestedUrl: "https://lex.uz/docs/999" }, "en"), /PUBLISHER_DOCUMENT_IDENTITY/);
  assert.throws(() => normalizePublisherHtml({ ...source, contentType: "application/pdf" }, "en"), /PUBLISHER_HTML_REQUIRED/);
  assert.equal(normalizePublisherHtml(source, "ru").snapshot.source.locale, "ru");
  const historicalUrl = source.finalUrl + "?ONDATE=01.01.2020";
  assert.equal(normalizePublisherHtml({ ...source, finalUrl: historicalUrl }, "en").snapshot.source.canonicalUrl, historicalUrl);
  const changed = capture('<div id="divCont"><div class="ACT_TITLE">Cached artificial Act</div><p>Changed complete rule.</p></div>');
  assert.match(normalizePublisherHtml(changed, "en").snapshot.plainText, /Changed complete rule/);
});

test("fresh publisher normalization retains complete articles, tables and operative links", () => {
  const result = normalizePublisherHtml(capture(`<div id="lx_var_t"><div class="lx_date_selected">01.02.2020</div></div>
    <div id="divCont"><div class="ACT_TITLE lx_elem">Artificial Act</div>
    <div class="CLAUSE_DEFAULT lx_elem"><div class="lx_elem2">Toolbar</div><div id="10">Article 1. Conditions</div></div>
    <div class="ACT_TEXT lx_elem">A permit is required.</div><div class="ACT_TEXT lx_elem">Exception: private events.</div>
    <table><tr><th rowspan="2">Category</th><td>Fee</td></tr><tr><td>10 units</td></tr></table>
    <div class="ACT_TEXT lx_elem">Apply <a href="/docs/456#7">the complementary rule</a>.</div>
    <div class="CLAUSE_DEFAULT lx_elem">Article 2. Other matters</div><div class="ACT_TEXT lx_elem">Other rule.</div></div>`), "en");
  const text = readNormalizedArticle(JSON.stringify(result.snapshot), "https://lex.uz/docs/123", "1");
  assert.match(text, /Exception: private events/);
  assert.match(text, /Category \[row span 2; column span 1\]/);
  assert.match(text, /10 units/);
  assert.doesNotMatch(text, /Toolbar|Other rule/);
  assert.ok(result.links.some(link => link.url === "https://lex.uz/docs/456#7"));
  assert.deepEqual(result.selectedEditions, ["01.02.2020"]);
  assert.deepEqual(result.gaps, []);
});

test("unreadable media and missing document roots remain explicit gaps or failures", () => {
  assert.throws(() => normalizePublisherHtml(capture("<main>A search result</main>"), "en"), /PUBLISHER_DOCUMENT_ROOT/);
  const result = normalizePublisherHtml(capture('<div id="divCont"><div class="ACT_TITLE">Act</div><p>See the diagram.</p><img src="/files/diagram.png" alt="important condition"></div>'), "en");
  assert.equal(result.gaps[0].kind, "unread_media");
  assert.doesNotMatch(readNormalizedDocument(JSON.stringify(result.snapshot), "https://lex.uz/docs/123"), /important condition/);
});

test("publisher comments remain separate reference notes and superscript articles retain their identity", () => {
  const result = normalizePublisherHtml(capture(`<div id="divCont"><div class="ACT_TITLE">Act</div>
    <div class="CLAUSE_DEFAULT lx_elem">Статья 12<sup>1</sup>. Условия</div><p>Full rule.</p>
    <div class="COMMENT"><span>Editorial reference</span><a href="/docs/456">another act</a></div>
    <div class="CHANGES_ORIGINS">Amended on a specified date.</div></div>`), "ru");
  const text = readNormalizedArticle(JSON.stringify(result.snapshot), "https://lex.uz/docs/123", "12-1");
  assert.match(text, /Full rule/);
  assert.match(text, /Amended on/);
  assert.doesNotMatch(text, /Editorial reference/);
  assert.match(result.referenceNotes[0], /Editorial reference/);
});

test("capture integrity and document identity are checked before interpreting markup", () => {
  const input = capture('<div id="divCont"><p>Rule.</p></div>');
  assert.throws(() => normalizePublisherHtml({ ...input, finalUrl: "https://lex.uz/docs/999" }, "en"), /PUBLISHER_DOCUMENT_IDENTITY/);
  input.bytes[0] = 0;
  assert.throws(() => normalizePublisherHtml(input, "en"), /PUBLISHER_CAPTURE_INTEGRITY/);
});

test("table captions and paragraph boundaries survive and an annex does not merge into the preceding article", () => {
  const result = normalizePublisherHtml(capture(`<div id="divCont"><div class="ACT_TITLE">Act</div>
    <div class="CLAUSE_DEFAULT lx_elem">Article 1. Rule</div><p>Main rule.</p>
    <table><caption>Mandatory fee conditions</caption><tr><td><p>First condition.</p><p>Second condition.</p></td></tr></table>
    <div class="ACT_TITLE_APPL lx_elem">Annex: separate form</div><p>Form instructions.</p></div>`), "en");
  const text = readNormalizedArticle(JSON.stringify(result.snapshot), "https://lex.uz/docs/123", "1");
  assert.match(text, /Mandatory fee conditions/);
  assert.match(text, /First condition\. Second condition\./);
  assert.doesNotMatch(text, /Form instructions/);
});

test("the current-version menu link stays navigation rather than becoming an invalid date", () => {
  const input = capture(`<div id="lx_var_t"><div class="lx_date_link" onclick="lxOpenUrl('/docs/123')">Current version</div>
    <div class="lx_date_selected">01.01.2020</div></div><div id="divCont"><div class="ACT_TITLE">Act</div><p>Rule.</p></div>`);
  input.requestedUrl = input.finalUrl = "https://lex.uz/docs/123?ONDATE=01.01.2020";
  const result = normalizePublisherHtml(input, "en");
  assert.deepEqual(result.editionDates, ["01.01.2020"]);
  assert.equal(result.editionNavigation[0].url, "https://lex.uz/docs/123");
});
