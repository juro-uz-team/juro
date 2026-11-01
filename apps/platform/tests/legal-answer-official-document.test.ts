import assert from "node:assert/strict";
import test from "node:test";
import { createOfficialDocumentReader } from "../lib/legal-answer-workflow/official-document";

test("shared parsing never replaces a new request's publisher capture", async () => {
  let captures = 0;
  const fetchImpl: typeof fetch = async () => {
    captures++;
    return new Response(`<div id="lx_var_t"><div class="lx_date_selected">01.01.2020</div></div>
      <div id="divCont"><div class="ACT_TITLE">Fresh capture Act</div><p>Rule ${captures < 3 ? "unchanged" : "amended"}.</p></div>`,
      { headers: { "Content-Type": "text/html" } });
  };
  for (let count = 1; count <= 3; count++) {
    const reader = createOfficialDocumentReader({ submittedAt: Date.now(), deadlineMs: 30_000,
      signal: AbortSignal.timeout(3000), fetchImpl });
    const result = await reader.read("https://lex.uz/docs/987", "en", { kind: "current" });
    assert.equal(captures, count);
    assert.match(result.document.snapshot.plainText, count < 3 ? /unchanged/ : /amended/);
    assert.equal(result.edition.requestedDate, null);
  }
});

test("historical reading resolves an exact publisher edition and preserves the requested date", async () => {
  const calls: string[] = [];
  const reader = createOfficialDocumentReader({ submittedAt: Date.now(), deadlineMs: 30_000,
    signal: AbortSignal.timeout(3000), fetchImpl: async url => {
      const value = String(url); calls.push(value);
      const historical = value.includes("ONDATE=01.01.2018");
      return new Response(`<div id="lx_var_t"><div class="lx_date_selected">${historical ? "01.01.2018" : "01.01.2020"}</div>
        <div class="lx_date_link" onclick="lxOpenUrl('/docs/123?ONDATE=${historical ? "01.01.2020" : "01.01.2018"}')">${historical ? "01.01.2020" : "01.01.2018"}</div></div>
        <div id="divCont"><div class="ACT_TITLE">Artificial Act</div><div class="CLAUSE_DEFAULT lx_elem">Article 1. Rule</div>
        <p>${historical ? "Historical complete rule and exception." : "Current complete rule and exception."}</p></div>`,
        { headers: { "Content-Type": "text/html" } });
    } });
  const result = await reader.read("https://lex.uz/docs/123", "en", { kind: "historical", at: "2019-06-15" });
  assert.equal(result.edition.requestedDate, "2019-06-15");
  assert.equal(result.edition.selectedEdition, "2018-01-01");
  assert.match(result.document.snapshot.plainText, /Historical complete/);
  assert.deepEqual(calls, ["https://lex.uz/docs/123", "https://lex.uz/docs/123?ONDATE=01.01.2018"]);
  await reader.read("https://lex.uz/docs/123", "en", { kind: "historical", at: "2019-06-15" });
  assert.equal(calls.length, 2);
});
