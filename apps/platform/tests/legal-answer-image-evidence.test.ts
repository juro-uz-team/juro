import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import { extractImages } from "unpdf";
import { createPublisherCorpus } from "../lib/legal-answer-workflow/corpus-adapter";
import { createOfficialDocumentReader } from "../lib/legal-answer-workflow/official-document";
import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";
import { sourceFilesForEvidence } from "../lib/legal-answer-workflow/source-files";
import { officialImagePdf } from "../lib/legal-answer-workflow/official-image";
import { buildCorpusCitations } from "../lib/legal-answer-workflow/corpus-citations";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { openSavedCitation } from "../lib/legal-answer-workflow/citation-storage";

test("multipage images retain every frame without reducing raster resolution", async () => {
  const raw = Buffer.concat([Buffer.alloc(24 * 12 * 3, 255), Buffer.alloc(24 * 12 * 3, 0)]);
  const bytes = await sharp(raw, { raw: { width: 24, height: 24, channels: 3, pageHeight: 12 } }).gif().toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const rendered = await officialImagePdf({ bytes, sha256, signal: AbortSignal.timeout(3000) });
  const pdf = await PDFDocument.load(rendered.bytes);
  assert.equal(pdf.getPageCount(), 2);
  assert.deepEqual(pdf.getPages().map(page => page.getSize()), [{ width: 24, height: 12 }, { width: 24, height: 12 }]);
  const first = await extractImages(new Uint8Array(rendered.bytes), 1);
  const second = await extractImages(new Uint8Array(rendered.bytes), 2);
  assert.equal(first.length, 1); assert.equal(second.length, 1);
  assert.deepEqual([first[0].width, first[0].height, first[0].data[0]], [24, 12, 255]);
  assert.deepEqual([second[0].width, second[0].height, second[0].data[0]], [24, 12, 0]);
});

test("an official image retains its original and supplies a full-resolution PDF page as visual evidence", async () => {
  const bytes = await sharp({ create: { width: 240, height: 120, channels: 3, background: "white" } }).png().toBuffer();
  const sha256 = createHash("sha256").update(bytes).digest("hex"), sourceUrl = "https://lex.uz/files/456.png";
  const discovery = {
    search: async () => ({ candidates: ["image"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", unitMetadata: { ordinal: 0, locator: "page:1", language: "en", text: "Unverified OCR preview" },
      source: { inventory: { id: "work", kind: "asset", state: "done", url: sourceUrl, raw_hash: sha256, bytes: bytes.length,
        context: { source: "123", language: "en", edition: "01.01.2019" } }, prepared: { work: "work" } } }),
    readAsset: async () => ({ work: "work", sourceUrl, sha256, bytes }),
  };
  const objects = new Map<string, Uint8Array>(), signal = AbortSignal.timeout(10_000), submittedAt = Date.now();
  const corpus = createPublisherCorpus({ current: discovery, history: discovery,
    documents: signal => createOfficialDocumentReader({ signal, submittedAt, deadlineMs: 30_000,
      fetchImpl: async () => new Response(`<div id="lx_var_t"><div class="lx_date_selected">01.01.2020</div></div>
        <div id="divCont"><div class="ACT_TITLE">Artificial Act</div><p><img src="${sourceUrl}" alt="Complete image annex"></p></div>`,
      { headers: { "content-type": "text/html" } }) }),
    objects: { get: async key => objects.get(key) ?? null, put: async (key, value) => { objects.set(key, value.slice()); } } });
  const scope = { kind: "current" as const };
  await corpus.search("image annex", scope, signal);
  const locator = await corpus.resolve("image", scope, signal);
  assert.ok(locator?.sourceFile);
  assert.equal(locator.editionObservation?.selectedEdition, "01.01.2020");
  const evidence = await readOfficialProvision(locator, corpus, scope, signal);
  assert.doesNotMatch(evidence.text, /Unverified OCR preview/);
  const files = await sourceFilesForEvidence([evidence], corpus, signal);
  const pdf = await PDFDocument.load(files[0].bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.deepEqual(pdf.getPage(0).getSize(), { width: 240, height: 120 });
  assert.deepEqual(objects.get(`legal-evidence/raw/${sha256}`), bytes);
  const generationSha256 = "a".repeat(64), store = { namespace: `legal-prepared-${generationSha256}`, generationSha256 };
  const citations = buildCorpusCitations([evidence], corpus, store), fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer({ ...fixture.input,
      response: { ...fixture.input.response, sources: citations.map(item => item.source) }, citations });
    const reopen = () => openSavedCitation({ db: fixture.d1, workspaceId: "w", userId: "u",
      messageId: saved.responseMessageId, sourceId: evidence.identity, signal,
      objects: { get: async key => objects.get(key) ?? null }, includePdf: true });
    assert.deepEqual((await reopen())?.pdfBytes, files[0].bytes);
    objects.delete(`legal-evidence/raw/${sha256}`);
    assert.deepEqual((await reopen())?.pdfBytes, files[0].bytes);
  } finally { fixture.sqlite.close(); }
  assert.deepEqual((await sourceFilesForEvidence([evidence], corpus, signal))[0].bytes, files[0].bytes);
});
