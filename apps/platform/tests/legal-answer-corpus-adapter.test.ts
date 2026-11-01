import assert from "node:assert/strict";
import test from "node:test";
import { createPublisherCorpus } from "../lib/legal-answer-workflow/corpus-adapter";
import { createOfficialDocumentReader } from "../lib/legal-answer-workflow/official-document";
import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";
import { buildCorpusCitations } from "../lib/legal-answer-workflow/corpus-citations";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { openSavedCitation } from "../lib/legal-answer-workflow/citation-storage";

test("operative reference reads require an authenticated parent link and preserve complete provisions and scope", async () => {
  let catalogUrl = "https://lex.uz/docs/123";
  const unit = { ordinal: 1, locator: "11", language: "en", text: "Indexed pointer.", hierarchy: ["Artificial Part", "Artificial Chapter"] };
  const discovery = { search: async () => ({ candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", unitMetadata: unit, source: {
      inventory: { id: "work", kind: "document", state: "done", url: catalogUrl }, prepared: { work: "work", title: "Artificial Act" } } }),
    readSources: async () => ({ work: { inventory: { id: "work", kind: "document", state: "done", url: "https://lex.uz/docs/123" },
      prepared: { work: "work", units: [unit] } } }),
  };
  let captures = 0;
  const objects = new Map<string, Uint8Array>();
  const submittedAt = Date.now();
  const corpus = createPublisherCorpus({ current: discovery, history: discovery,
    objects: { get: async key => objects.get(key) ?? null, put: async (key, bytes) => { objects.set(key, bytes.slice()); } },
    documents: signal => createOfficialDocumentReader({ submittedAt, deadlineMs: 30_000, signal,
      fetchImpl: async url => {
        captures++;
        const text = String(url).includes("/123") ? 'Read <a href="https://lex.uz/docs/456#11">the exception rule</a>.'
          : "Referenced condition. Exception for private events.";
        return new Response(`<div id="lx_var_t"><div class="lx_date_selected">01.01.2020</div></div><div id="divCont">
          <div class="ACT_TITLE">Artificial Act</div><div class="CLAUSE_DEFAULT lx_elem"><div id="10">Article 1. Rule</div></div>
          <div class="ACT_TEXT lx_elem"><div id="11">${text}</div></div></div>`, { headers: { "content-type": "text/html" } });
      } }),
  });
  const signal = AbortSignal.timeout(3000), scope = { kind: "current" as const }, url = "https://lex.uz/docs/456#11";
  await assert.rejects(() => corpus.describeCandidates(["candidate"], scope, signal), /CANDIDATE_NOT_DISCOVERED/);
  await assert.rejects(() => corpus.resolveReference("unknown", url, scope, signal), /REFERENCE_NOT_AUTHENTICATED/);
  await corpus.search("rule", scope, signal);
  assert.deepEqual(await corpus.describeCandidates(["candidate"], scope, signal), [
    { identity: "candidate", sourceUrl: "https://lex.uz/docs/123", text: "Indexed pointer.", truncated: false,
      title: "Artificial Act", hierarchy: ["Artificial Part", "Artificial Chapter"] },
  ]);
  assert.equal(captures, 0, "Discovery previews do not read or authenticate complete publisher provisions");
  for (const invalid of ["https://private.example.test/docs/123", "https://fixture:secret@lex.uz/docs/123"]) {
    catalogUrl = invalid;
    await assert.rejects(() => corpus.describeCandidates(["candidate"], scope, signal), /CORPUS_SOURCE_IDENTITY/);
  }
  catalogUrl = "https://lex.uz/docs/123";
  await assert.rejects(() => corpus.describeCandidates(["candidate"], { kind: "historical", at: "2020-01-01" }, signal), /CANDIDATE_NOT_DISCOVERED/);
  const parent = await corpus.resolve("candidate", scope, signal);
  assert.ok(parent);
  await assert.rejects(() => corpus.resolveReference(parent.identity, "https://lex.uz/docs/789", scope, signal), /REFERENCE_NOT_AUTHENTICATED/);
  await assert.rejects(() => corpus.resolveReference(parent.identity, url, { kind: "historical", at: "2020-01-01" }, signal), /REFERENCE_SCOPE_MISMATCH/);
  assert.equal(captures, 1);
  const reference = await corpus.resolveReference(parent.identity, url, scope, signal);
  assert.ok(reference);
  const evidence = await readOfficialProvision(reference, corpus, scope, signal);
  assert.match(evidence.text, /Exception for private events/);
  assert.equal(reference.articleNumber, "1");
  assert.ok(corpus.receipt(reference.identity));
  await corpus.resolveReference(parent.identity, url, scope, signal);
  assert.equal(captures, 2);
});

test("pinned discovery metadata opens complete publisher evidence without a redundant full corpus read", async () => {
  const unit = { ordinal: 1, locator: "11", language: "en", text: "Old indexed discovery passage." };
  let fullReads = 0;
  const discovery = {
    search: async () => ({ candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", unitMetadata: unit, source: {
      inventory: { id: "work", kind: "document", state: "done", url: "https://lex.uz/docs/123" }, prepared: { work: "work" } } }),
    readSources: async () => { fullReads++; return { work: { inventory: { id: "work", kind: "document", state: "done", url: "https://lex.uz/docs/123" },
      prepared: { work: "work", units: [unit] } } }; },
  };
  const documents = createOfficialDocumentReader({ submittedAt: Date.now(), deadlineMs: 30_000, signal: AbortSignal.timeout(3000),
    fetchImpl: async () => new Response(`<div id="lx_var_t"><div class="lx_date_selected">01.01.2020</div></div>
      <div id="divCont"><div class="ACT_TITLE">Artificial Act</div><div class="CLAUSE_DEFAULT lx_elem"><div id="10">Article 1. Rule</div></div>
      <div class="ACT_TEXT lx_elem"><div id="11">Current rule.</div></div><p>Exception: private events.</p></div>`,
      { headers: { "Content-Type": "text/html" } }) });
  const objects = new Map<string, Uint8Array>();
  const corpus = createPublisherCorpus({ current: discovery, history: discovery, documents: () => documents,
    objects: { get: async key => objects.get(key) ?? null, put: async (key, bytes) => { objects.set(key, bytes.slice()); } } });
  const signal = AbortSignal.timeout(30_000), scope = { kind: "current" as const };
  await assert.rejects(() => corpus.resolve("candidate", scope, signal), /CANDIDATE_NOT_DISCOVERED/);
  const hits = await corpus.search("artificial rule", scope, signal);
  const locator = await corpus.resolve(hits.candidates[0], scope, signal);
  assert.ok(locator);
  const evidence = await readOfficialProvision(locator, corpus, scope, signal);
  assert.match(evidence.text, /Current rule/);
  assert.match(evidence.text, /Exception: private events/);
  assert.doesNotMatch(evidence.text, /Old indexed/);
  assert.equal(locator.articleNumber, "1");
  assert.equal(objects.size, 3);
  assert.ok(corpus.receipt(locator.identity));
  const generationSha256 = "a".repeat(64);
  const store = { namespace: `legal-prepared-${generationSha256}`, generationSha256 };
  const citations = buildCorpusCitations([evidence], corpus, store);
  assert.equal(citations[0].source.status, "unconfirmed");
  assert.equal(citations[0].source.effectiveDate, null);
  assert.throws(() => buildCorpusCitations([{ ...evidence, sourceUrl: "https://lex.uz/docs/other" }], corpus, store), /CITATION_EVIDENCE_MISMATCH/);
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer({ ...fixture.input,
      response: { ...fixture.input.response, sources: citations.map(citation => citation.source) }, citations });
    const reopened = await openSavedCitation({ db: fixture.d1, workspaceId: "w", userId: "u",
      messageId: saved.responseMessageId, sourceId: evidence.identity, signal,
      objects: { get: async (key, savedStore) => { assert.deepEqual(savedStore, store); return objects.get(key) ?? null; } } });
    assert.equal(reopened?.text, evidence.text);
  } finally { fixture.sqlite.close(); }
  await corpus.resolve(hits.candidates[0], scope, signal);
  assert.equal(fullReads, 0);
  await assert.rejects(() => corpus.resolve(hits.candidates[0], { kind: "historical", at: "2019-01-01" }, signal), /CANDIDATE_NOT_DISCOVERED/);
});

test("mismatched catalog source identity is rejected before publisher access or evidence writes", async () => {
  const unit = { ordinal: 1, locator: "11", language: "en", text: "Indexed passage." };
  const discovery = {
    search: async () => ({ candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", unitMetadata: unit, source: {
      inventory: { id: "different-work", kind: "document", state: "done", url: "https://lex.uz/docs/123" }, prepared: { work: "work" } } }),
    readSources: async () => ({ work: { inventory: { id: "work", kind: "document", state: "done", url: "https://lex.uz/docs/123" },
      prepared: { work: "work", units: [{ ...unit, text: "Different source unit." }] } } }),
  };
  const corpus = createPublisherCorpus({ current: discovery, history: discovery,
    documents: () => { throw Error("unexpected publisher access"); },
    objects: { get: async () => null, put: async () => { throw Error("unexpected write"); } } });
  const signal = AbortSignal.timeout(3000), scope = { kind: "current" as const };
  await corpus.search("query", scope, signal);
  await assert.rejects(() => corpus.resolve("candidate", scope, signal), /CORPUS_SOURCE_IDENTITY/);
});
