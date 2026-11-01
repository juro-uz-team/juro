import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { extractImages, extractText } from "unpdf";
import { createPublisherCorpus } from "../lib/legal-answer-workflow/corpus-adapter";
import { createOfficialDocumentReader } from "../lib/legal-answer-workflow/official-document";
import { readOfficialProvision } from "../lib/legal-answer-workflow/evidence";
import { sourceFilesForEvidence } from "../lib/legal-answer-workflow/source-files";
import { buildCorpusCitations } from "../lib/legal-answer-workflow/corpus-citations";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { openSavedCitation } from "../lib/legal-answer-workflow/citation-storage";
import { readNormalizedArticle, readNormalizedDocument } from "../lib/legal-answer-workflow/normalized-document";
import { normalizePublisherHtml } from "../lib/legal-answer-workflow/publisher-html";
import { recoverInlineMedia } from "../lib/legal-answer-workflow/inline-media";
import { PDFDocument, PDFString, StandardFonts } from "pdf-lib";

function documentWithMedia(markup: string) {
  const bytes = Buffer.from(`<div id="divCont"><div class="ACT_TITLE">Artificial Act</div>
    <p id="10" class="CLAUSE_DEFAULT">Article 1. Rule</p><p>Material condition ${markup}</p></div>`);
  return normalizePublisherHtml({ requestedUrl: "https://lex.uz/docs/123", finalUrl: "https://lex.uz/docs/123",
    bytes, byteCount: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
    contentType: "text/html", redirects: [], observedAt: new Date().toISOString() }, "en");
}

test("inline recovery rejects foreign, unresolved and unproven historical media before acquisition", async () => {
  for (const [markup, historical] of [[`<img src="https://foreign.example/file.png">`, false],
    [`<svg><text>Unrendered condition</text></svg>`, false], [`<img src="/files/image.png">`, true]] as const) {
    let reads = 0;
    await assert.rejects(() => recoverInlineMedia({ document: documentWithMedia(markup), position: "10",
      scope: historical ? { kind: "historical", at: "2020-01-01" } : { kind: "current" }, signal: AbortSignal.timeout(3000),
      read: async () => { reads++; throw new Error("Unexpected acquisition"); } }),
    /PUBLISHER_URL_INVALID|PROVISION_MEDIA_BOUND|PROVISION_HISTORICAL_MEDIA_UNVERIFIED/);
    assert.equal(reads, 0);
  }
});

test("inline PDF objects retain every page and do not accept a changed capture", async () => {
  const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const text of ["Artificial governing condition", "Artificial second-page exception"]) {
    pdf.addPage([600, 400]).drawText(text, { x: 20, y: 300, font });
  }
  const field = pdf.getForm().createTextField("exception");
  field.addToPage(pdf.getPage(0), { x: 20, y: 100, width: 480, height: 30, font });
  field.setText("Material exception in filled field");
  field.setFontSize(16);
  pdf.getPage(1).node.addAnnot(pdf.context.register(pdf.context.obj({ Type: "Annot", Subtype: "Text",
    Rect: [20, 20, 40, 40], Contents: PDFString.of("Original publisher note") })));
  const bytes = await pdf.save(), url = "https://lex.uz/files/inline.pdf";
  const capture = { requestedUrl: url, finalUrl: url, bytes, byteCount: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"), contentType: "application/pdf" as const,
    redirects: [], observedAt: new Date().toISOString() };
  const input = { document: documentWithMedia(`<object data="/files/inline.pdf"></object>`), position: "10",
    scope: { kind: "current" as const }, signal: AbortSignal.timeout(10_000), read: async () => capture };
  const recovered = await recoverInlineMedia(input);
  assert.ok(recovered.pdf);
  const rendition = await PDFDocument.load(recovered.pdf.bytes);
  assert.equal(rendition.getPageCount(), 3);
  assert.equal(rendition.getPage(1).node.Annots()?.size() ?? 0, 0);
  assert.equal(rendition.getPage(2).node.Annots()?.size(), 1);
  const text = await extractText(new Uint8Array(recovered.pdf.bytes), { mergePages: true });
  assert.match(text.text, /Material exception in filled field/);
  assert.match(text.text, /Artificial second-page exception/);
  assert.equal(recovered.document.gaps.length, 0);
  assert.deepEqual(recovered.pdf.sourceFile.originals?.map(file => file.sha256), [capture.sha256]);
  await assert.rejects(() => recoverInlineMedia({ ...input, read: async () => ({ ...capture, sha256: "a".repeat(64) }) }), /PROVISION_MEDIA_IDENTITY/);
});

test("inline table images stay bound to their complete article, originals and saved citation", async () => {
  const image = await sharp({ create: { width: 240, height: 120, channels: 3, background: "white" } }).png().toBuffer();
  const imageHash = createHash("sha256").update(image).digest("hex");
  const html = `<div id="lx_var_t"><div class="lx_date_selected">01.01.2020</div></div><div id="divCont">
    <div class="ACT_TITLE">Artificial Act</div><p id="10" class="CLAUSE_DEFAULT">Article 1. Conditions</p>
    <table><tr><td>Material exception</td><td><img src="/files/table.png" alt="Do not use this invented answer"></td></tr></table>
    <p>Read the condition and exception together.</p><p id="20" class="CLAUSE_DEFAULT">Article 2. Other rule</p>
    <p><iframe src="https://foreign.example/unrelated"></iframe></p></div>`;
  const discovery = { search: async () => ({ candidates: ["article"], sparseAvailable: true, denseAvailable: true }),
    readCandidate: async () => ({ work: "work", unitMetadata: { ordinal: 0, locator: "10", language: "en", text: "Preview only" },
      source: { inventory: { id: "work", kind: "document", state: "done", url: "https://lex.uz/docs/123" }, prepared: { work: "work" } } }) };
  const objects = new Map<string, Uint8Array>(), calls: string[] = [];
  const signal = AbortSignal.timeout(20_000), submittedAt = Date.now();
  const corpus = createPublisherCorpus({ current: discovery, history: discovery,
    documents: signal => createOfficialDocumentReader({ signal, submittedAt, deadlineMs: 30_000,
      fetchImpl: async url => { calls.push(String(url)); return String(url).endsWith("/files/table.png")
        ? new Response(image, { headers: { "content-type": "image/png" } })
        : new Response(html, { headers: { "content-type": "text/html" } }); } }),
    objects: { get: async key => objects.get(key) ?? null, put: async (key, bytes) => { objects.set(key, bytes.slice()); } } });
  const scope = { kind: "current" as const };
  await corpus.search("condition", scope, signal);
  const locator = await corpus.resolve("article", scope, signal);
  assert.ok(locator?.sourceFile);
  assert.equal(locator.articleNumber, "1");
  const evidence = await readOfficialProvision(locator, corpus, scope, signal);
  assert.match(evidence.text, /Material exception/);
  assert.match(evidence.text, /Publisher media: \/files\/table.png/);
  assert.doesNotMatch(evidence.text, /invented answer|Preview only|Other rule/);
  assert.ok(!calls.some(url => url.includes("foreign.example")));
  const files = await sourceFilesForEvidence([evidence], corpus, signal);
  const images = await extractImages(new Uint8Array(files[0].bytes), 1);
  assert.deepEqual([images[0].width, images[0].height], [240, 120]);
  const serialized = Buffer.from(objects.get(locator.objectKey)!).toString("utf8");
  assert.throws(() => readNormalizedArticle(serialized, locator.sourceUrl, "2"), /EVIDENCE_MEDIA_SCOPE/);
  assert.throws(() => readNormalizedDocument(serialized, locator.sourceUrl), /EVIDENCE_MEDIA_SCOPE/);
  const generationSha256 = "a".repeat(64);
  const citations = buildCorpusCitations([evidence], corpus, { generationSha256, namespace: `legal-prepared-${generationSha256}` });
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer({ ...fixture.input, response: { ...fixture.input.response,
      sources: citations.map(item => item.source) }, citations });
    const reopen = () => openSavedCitation({ db: fixture.d1, workspaceId: "w", userId: "u",
      messageId: saved.responseMessageId, sourceId: evidence.identity, signal, includePdf: true,
      objects: { get: async key => objects.get(key) ?? null } });
    assert.deepEqual((await reopen())?.pdfBytes, files[0].bytes);
    objects.delete(`legal-evidence/raw/${imageHash}`);
    assert.deepEqual((await sourceFilesForEvidence([evidence], corpus, signal))[0].bytes, files[0].bytes);
    assert.deepEqual((await reopen())?.pdfBytes, files[0].bytes);
  } finally { fixture.sqlite.close(); }
});
