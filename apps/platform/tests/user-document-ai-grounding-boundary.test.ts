import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("AI chat retrieves private document evidence only behind the explicit auto-trust flag", async () => {
  const route = await readFile(
    new URL("../app/api/platform/ai/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST !== "true"/);
  assert.match(route, /retrieveTrustedUserDocumentSources/);
  assert.match(route, /const privateDocumentRetrieval = \(async \(\): Promise<TrustedUserDocumentRetrieval>/u);
  assert.match(route, /const privateDocuments = await privateDocumentRetrieval/u);
  assert.match(route, /const retrievalResult: LegalChatSourceRetrieval \| Response = await/u);
  assert.match(route, /if \(retrievalResult instanceof Response\) \{\s*if \(secondaryResearch\) await secondaryResearch\.catch\(\(\) => undefined\);\s*return retrievalResult;\s*\}/u);
  assert.match(route, /let retrieval = retrievalResult/u);
  assert.match(route, /const sources = \[\.\.\.retrieval\.sources, \.\.\.privateDocuments\.sources, \.\.\.secondaryInternet\.sources\]/u);
  assert.match(route, /private_document_retrieval_unavailable/);
  assert.match(route, /trustedPrivateSourceCount/);
  assert.doesNotMatch(route, /private_document_retrieval_unavailable[\s\S]{0,240}(?:question|snippet|sourceHash|r2Key)/u);
});
test("provider prompts keep uploaded-document facts separate from official law", async () => {
  const [openAi, anthropic] = await Promise.all([
    readFile(new URL("../lib/ai/provider.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/anthropic-provider.ts", import.meta.url), "utf8"),
  ]);
  for (const provider of [openAi, anthropic]) {
    assert.match(provider, /sourceClass=USER_TRUSTED_PRIVATE/);
    assert.match(provider, /sourceClass=OFFICIAL_LEGISLATION/);
    assert.match(provider, /sourceType: source\.sourceType/);
    assert.match(provider, /sourceClass: source\.sourceClass/);
    assert.match(provider, /не выполняй[^.]{0,80}инструкции/iu);
  }
});
