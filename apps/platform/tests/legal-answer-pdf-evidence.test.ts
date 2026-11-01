import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { createPublisherCorpus } from "../lib/legal-answer-workflow/corpus-adapter";
import { createOfficialDocumentReader } from "../lib/legal-answer-workflow/official-document";
import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";
import { sourceFilesForEvidence } from "../lib/legal-answer-workflow/source-files";
import { buildCorpusCitations } from "../lib/legal-answer-workflow/corpus-citations";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { openSavedCitation } from "../lib/legal-answer-workflow/citation-storage";
import { handleSavedCitationHttp } from "../lib/legal-answer-workflow/citation-http";

for (const kind of ["direct", "member", "office-member"]) test(`a discovered ${kind} source retains every page and its exact original`, async () => {
  const member = kind !== "direct", office = kind === "office-member";
  const pdf = await PDFDocument.create();
  pdf.addPage().drawText("Artificial rule: give written notice.");
  pdf.addPage().drawText("Exception: oral notice with consent.");
  const bytes = await pdf.save(), pdfSha256 = createHash("sha256").update(bytes).digest("hex");
  const original = office ? Buffer.from("Artificial original office fixture") : bytes;
  const sha256 = createHash("sha256").update(original).digest("hex"), filename = office ? "annex.doc" : "annex.pdf";
  const sourceUrl = member ? "https://lex.uz/files/456.zip#member:0" : "https://lex.uz/files/456.pdf";
  const publisherUrl = sourceUrl.split("#")[0];
  const discovery = {
    search: async () => ({ candidates: ["pdf"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", unitMetadata: { ordinal: 0, locator: "page:1", language: "en", text: "Discovery preview only" },
      source: { inventory: { id: "work", kind: member ? "member" : "asset", state: "done", url: sourceUrl, raw_hash: sha256, bytes: original.length,
        ...(member ? { receipt: { member: filename, archive_work: "a".repeat(64) } } : {}),
        context: { source: "123", language: "en", edition: "01.01.2020", ...(member ? { member: filename } : {}) } }, prepared: { work: "work" } } }),
    readAsset: async () => ({ work: "work", sourceUrl, sha256, bytes: original,
      ...(office ? { renderedPdf: { sourceSha256: sha256, rendererImage: `sha256:${"a".repeat(64)}`, sha256: pdfSha256, bytes } } : {}) }),
  };
  const objects = new Map<string, Uint8Array>(), signal = AbortSignal.timeout(10_000), submittedAt = Date.now();
  const corpus = createPublisherCorpus({ current: discovery, history: discovery,
    documents: signal => createOfficialDocumentReader({ signal, submittedAt, deadlineMs: 30_000,
      fetchImpl: async () => new Response(`<div id="lx_var_t"><div class="lx_date_selected">01.01.2020</div></div>
        <div id="divCont"><div class="ACT_TITLE">Artificial Act</div><p><a href="${publisherUrl}">Complete annex</a></p></div>`,
      { headers: { "content-type": "text/html" } }) }),
    objects: { get: async key => objects.get(key) ?? null, put: async (key, value) => { objects.set(key, value.slice()); } } });
  const scope = { kind: "current" as const };
  await corpus.search("artificial notice", scope, signal);
  const locator = await corpus.resolve("pdf", scope, signal);
  assert.ok(locator?.sourceFile);
  const evidence = await readOfficialProvision(locator, corpus, scope, signal);
  if (member) await assert.rejects(() => readOfficialProvision({ ...locator, sourceUrl: sourceUrl.replace("member:0", "member:1") },
    corpus, scope, signal), /EVIDENCE_DOCUMENT_IDENTITY/);
  const withoutOriginal = { ...locator };
  delete withoutOriginal.sourceFile;
  await assert.rejects(() => readOfficialProvision(withoutOriginal, corpus, scope, signal), /EVIDENCE_SOURCE_FILE_MISMATCH/);
  assert.match(evidence.text, /written notice/);
  assert.match(evidence.text, /oral notice with consent/);
  assert.doesNotMatch(evidence.text, /Discovery preview only/);
  const files = await sourceFilesForEvidence([evidence], corpus, signal);
  assert.deepEqual(files[0].bytes, bytes);
  const generationSha256 = "a".repeat(64), store = { namespace: `legal-prepared-${generationSha256}`, generationSha256 };
  const citations = buildCorpusCitations([evidence], corpus, store);
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer({ ...fixture.input,
      response: { ...fixture.input.response, sources: citations.map(citation => citation.source) }, citations });
    const reopen = () => openSavedCitation({ db: fixture.d1, workspaceId: "w", userId: "u",
      messageId: saved.responseMessageId, sourceId: evidence.identity, signal,
      objects: { get: async key => objects.get(key) ?? null } });
    assert.equal((await reopen())?.text, evidence.text);
    const query = new URLSearchParams({ sourceId: evidence.identity, sourceUrl: evidence.sourceUrl, format: "pdf" });
    const request = new Request(`https://juro.example/api/platform/ai/citations/${saved.responseMessageId}?${query}`);
    const configuration = { authenticate: async () => ({ db: fixture.d1, workspaceId: "w", userId: "u" }),
      objects: { get: async (key: string) => objects.get(key) ?? null } };
    const download = await handleSavedCitationHttp(request, saved.responseMessageId, configuration);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "application/pdf");
    assert.equal(download.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await download.arrayBuffer()), bytes);
    assert.equal((await handleSavedCitationHttp(request, saved.responseMessageId,
      { ...configuration, authenticate: async () => ({ db: fixture.d1, workspaceId: "w", userId: "foreign" }) })).status, 404);
    objects.delete(locator.sourceFile.objectKey);
    await assert.rejects(reopen, /CITATION_SOURCE_FILE_UNAVAILABLE/);
    assert.equal((await handleSavedCitationHttp(request, saved.responseMessageId, configuration)).status, 404);
  } finally { fixture.sqlite.close(); }
  objects.delete(locator.sourceFile.objectKey);
  await assert.rejects(() => sourceFilesForEvidence([evidence], corpus, signal), /SOURCE_FILE_UNAVAILABLE/);
});

test("retained asset metadata cannot authorize an attachment missing from the verified publisher edition", async () => {
  const signal = AbortSignal.timeout(3000), submittedAt = Date.now();
  const discovery = {
    search: async () => ({ candidates: ["pdf"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", unitMetadata: { ordinal: 0, locator: "page:1", language: "en", text: "Preview" },
      source: { inventory: { id: "work", kind: "asset", state: "done", url: "https://lex.uz/files/456.pdf",
        context: { source: "123", language: "en", edition: "01.01.2020" } }, prepared: { work: "work" } } }),
    readAsset: async (): Promise<never> => { throw Error("Unexpected original read"); },
  };
  const corpus = createPublisherCorpus({ current: discovery, history: discovery,
    documents: signal => createOfficialDocumentReader({ signal, submittedAt, deadlineMs: 30_000,
      fetchImpl: async () => new Response(`<div id="lx_var_t"><div class="lx_date_selected">01.01.2020</div></div>
        <div id="divCont"><div class="ACT_TITLE">Artificial Act</div><p><a href="https://lex.uz/files/789.pdf">Different annex</a></p></div>`,
      { headers: { "content-type": "text/html" } }) }),
    objects: { get: async () => null, put: async () => { throw Error("Unexpected evidence write"); } } });
  await corpus.search("annex", { kind: "current" }, signal);
  await assert.rejects(() => corpus.resolve("pdf", { kind: "current" }, signal), /SOURCE_ASSET_EDITION_MISMATCH/);
});
