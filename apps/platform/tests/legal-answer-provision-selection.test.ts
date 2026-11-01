import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { normalizePublisherHtml } from "../lib/legal-answer-workflow/publisher-html";
import { selectPublisherDocument, selectPublisherProvision } from "../lib/legal-answer-workflow/provision-selection";

function document(extra = "") {
  const bytes = Buffer.from(`<div id="divCont"><div class="ACT_TITLE">Artificial Act</div>
    <div class="CLAUSE_DEFAULT lx_elem"><div id="10">Article 1. Rule</div></div>
    <div class="ACT_TEXT lx_elem"><div id="11">A permit is required.</div></div>
    <div class="ACT_TEXT lx_elem"><div id="12">Exception: private gatherings.</div></div>${extra}
    <div class="CLAUSE_DEFAULT lx_elem"><div id="20">Article 2. Other rule</div></div>
    <div class="ACT_TEXT lx_elem"><div id="21">Other conditions.</div></div></div>`);
  return normalizePublisherHtml({ bytes, byteCount: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "text/html", requestedUrl: "https://lex.uz/docs/123", finalUrl: "https://lex.uz/docs/123",
    observedAt: new Date().toISOString(), redirects: [] }, "en");
}

test("a discovered paragraph position opens its complete enclosing article", () => {
  const selected = selectPublisherProvision(document(), "11");
  assert.equal(selected.articleNumber, "1");
  assert.match(selected.text, /Exception: private gatherings/);
  assert.doesNotMatch(selected.text, /Other conditions/);
  assert.equal(selected.kind, "normalized-article");
});

test("unknown and ambiguous publisher positions cannot be converted into guessed articles", () => {
  assert.throws(() => selectPublisherProvision(document(), "unknown"), /POSITION_MISSING/);
  assert.throws(() => selectPublisherProvision(document('<p id="11">A second position.</p>'), "11"), /POSITION_AMBIGUOUS/);
});

test("a missing media condition prevents the article from being admitted as complete", () => {
  assert.throws(() => selectPublisherProvision(document('<img src="/files/condition.png">'), "11"), /PROVISION_EXTRACTION_GAP/);
});

test("an unanchored reference includes every article and rejects any extraction gap", () => {
  const selected = selectPublisherDocument(document());
  assert.equal(selected.kind, "normalized-document");
  assert.match(selected.text, /Exception: private gatherings/);
  assert.match(selected.text, /Other conditions/);
  assert.throws(() => selectPublisherDocument(document('<img src="/files/condition.png">')), /PROVISION_EXTRACTION_GAP/);
});
