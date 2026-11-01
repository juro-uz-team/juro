import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { citationStatements, readSavedCitationReceipt, openSavedCitation, type CitationRecord } from "../lib/legal-answer-workflow/citation-storage";
import { createGuestAiSession, reserveGuestAiRun, completeGuestAiRun } from "../lib/ai/guest-session";
import { savedCitationDetails } from "../lib/legal-answer-workflow/citation-details";
import { handleSavedCitationHttp } from "../lib/legal-answer-workflow/citation-http";

const text = "Artificial complete provision.";
const hash = createHash("sha256").update(text).digest("hex");
const citation: CitationRecord = {
  source: { sourceId: "source-1", actTitle: "Artificial act", actIdentifier: null, article: "1", excerpt: null,
    originalUrl: "https://lex.uz/docs/123#456", status: "current", effectiveDate: null, verifiedAt: "2026-10-28T00:00:00Z" },
  evidence: { identity: "source-1", snapshot: "revision", objectKey: "immutable/object", sha256: hash,
    byteCount: Buffer.byteLength(text), sourceUrl: "https://lex.uz/docs/123#456", text,
    privacyClass: "public_official_source", quarantined: false, canonicalizationConflict: false,
    temporalState: "current_supported", currentPointerVerified: true },
  receipt: { version: 1, capability: "current", kind: "provision", r2Key: "immutable/object", byteCount: Buffer.byteLength(text),
    sha256: hash, textSha256: hash, officialUrl: "https://lex.uz/docs/123#456", languageTag: "en", articleNumber: "1" },
  accessMode: "approved_package",
};

test("legacy URL selectors open one exact saved reference and reject ambiguous matches", async () => {
  for (const ambiguous of [false, true]) {
    const fixture = await legalAnswerStorageFixture();
    try {
      const second: CitationRecord = { ...citation, source: { ...citation.source, sourceId: "source-2" },
        evidence: { ...citation.evidence, identity: "source-2" } };
      const citations = ambiguous ? [citation, second] : [citation];
      const saved = await persistSignedInAnswer({ ...fixture.input,
        response: { ...fixture.input.response, sources: citations.map(item => item.source) }, citations });
      if (!ambiguous) fixture.sqlite.prepare("UPDATE legal_source_references SET answer_source_id=NULL WHERE message_id=?")
        .run(saved.responseMessageId);
      const input = { db: fixture.d1, workspaceId: "w", userId: "u", messageId: saved.responseMessageId,
        sourceUrl: citation.source.originalUrl, article: "1", signal: new AbortController().signal,
        objects: { get: async () => Buffer.from(text) } };
      if (ambiguous) await assert.rejects(() => savedCitationDetails(input), /CITATION_SELECTION_AMBIGUOUS/);
      else {
        assert.equal((await savedCitationDetails(input))?.text, text);
        assert.equal((await savedCitationDetails({ ...input, sourceId: citation.source.sourceId }))?.text, text);
        assert.equal(await savedCitationDetails({ ...input, sourceId: "wrong-id" }), null);
      }
    } finally { fixture.sqlite.close(); }
  }
});

test("citation dialog uses verified saved evidence and rejects mismatched selections and archived conversations", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer({ ...fixture.input,
      response: { ...fixture.input.response, sources: [citation.source] }, citations: [citation] });
    const input = { db: fixture.d1, workspaceId: "w", userId: "u", messageId: saved.responseMessageId,
      sourceId: citation.source.sourceId, sourceUrl: citation.source.originalUrl, article: "1",
      signal: new AbortController().signal, objects: { get: async () => Buffer.from(text) } };
    const details = await savedCitationDetails(input);
    assert.equal(details?.text, text);
    assert.equal(details?.documentTitle, citation.source.actTitle);
    assert.equal(details?.fullArticle, true);
    const query = new URLSearchParams({ sourceId: input.sourceId, sourceUrl: input.sourceUrl, article: input.article });
    const request = new Request(`https://juro.example/api/platform/ai/citations/${saved.responseMessageId}?${query}`);
    const configuration = { authenticate: async () => ({ db: fixture.d1, workspaceId: "w", userId: "u" }), objects: input.objects };
    const http = await handleSavedCitationHttp(request, saved.responseMessageId, configuration);
    assert.equal(http.headers.get("cache-control"), "no-store");
    assert.deepEqual(await http.json(), details);
    assert.equal((await handleSavedCitationHttp(request, saved.responseMessageId,
      { ...configuration, authenticate: async () => ({ db: fixture.d1, workspaceId: "w", userId: "foreign" }) })).status, 404);
    await assert.rejects(() => savedCitationDetails({ ...input, sourceUrl: "https://lex.uz/docs/999" }), /CITATION_SELECTION_MISMATCH/);
    await assert.rejects(() => savedCitationDetails({ ...input, article: "2" }), /CITATION_SELECTION_MISMATCH/);
    fixture.sqlite.prepare("UPDATE conversations SET status='archived' WHERE id=?").run(saved.conversationId);
    assert.equal(await savedCitationDetails(input), null);
  } finally { fixture.sqlite.close(); }
});

test("guest citation receipts persist atomically with encrypted guest delivery", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const keyring = { activeVersion: "test", versions: new Map([["test", {
      aead: new Uint8Array(32).fill(7), hmac: new Uint8Array(32).fill(8),
    }]]) };
    const { session } = await createGuestAiSession({ db: fixture.d1, keyring, connectingIp: "192.0.2.5", locale: "en" });
    const reservation = await reserveGuestAiRun({ db: fixture.d1, keyring, session, idempotencyKey: "guest-citation",
      requestHash: "b".repeat(64), provider: "openai", model: "gpt-6-luna", legalDatabaseAsOf: "2026-10-28",
      instructionHash: "c".repeat(64), sourceVersionHash: "d".repeat(64), question: "Artificial question" });
    assert.equal(reservation.kind, "created");
    await completeGuestAiRun({ db: fixture.d1, keyring, run: reservation.run,
      resultJson: JSON.stringify({ ...fixture.input.response, sources: [citation.source] }),
      responseKind: "clarification_required", provider: "openai", model: "gpt-6-luna", ...fixture.input.usage,
      additionalStatements: citationStatements({ db: fixture.d1, guestRunId: reservation.run.id,
        now: new Date().toISOString(), citations: [citation] }) });
    const row = fixture.sqlite.prepare(`SELECT guest_run_id,ai_run_id,message_id,evidence_receipt_json
      FROM legal_source_references WHERE guest_run_id=?`).get(reservation.run.id);
    assert.equal(row?.ai_run_id, null);
    assert.equal(row?.message_id, null);
    assert.deepEqual(JSON.parse(String(row?.evidence_receipt_json)), citation.receipt);
  } finally { fixture.sqlite.close(); }
});

test("saved prepared sections display their exact section extent rather than a whole act or article", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const key = `legal-evidence/prepared-section-v1/${"a".repeat(64)}/${Buffer.from(JSON.stringify(["work", "100", "en", hash])).toString("base64url")}`;
    const section: CitationRecord = { ...citation, source: { ...citation.source, article: "Chapter A" },
      evidence: { ...citation.evidence, objectKey: key }, receipt: { ...citation.receipt, r2Key: key, articleNumber: null } };
    const saved = await persistSignedInAnswer({ ...fixture.input,
      response: { ...fixture.input.response, sources: [section.source] }, citations: [section] });
    const details = await savedCitationDetails({ db: fixture.d1, workspaceId: "w", userId: "u", messageId: saved.responseMessageId,
      sourceId: section.source.sourceId, sourceUrl: section.source.originalUrl, article: "Chapter A",
      signal: new AbortController().signal, objects: { get: async () => Buffer.from(text) } });
    assert.equal(details?.section, "Chapter A");
    assert.equal(details?.articleTitle, null);
    assert.equal(details?.fullSection, true);
    assert.equal(details?.fullDocument, false);
    assert.equal(details?.fullArticle, false);
    assert.equal(details?.text, text);
  } finally { fixture.sqlite.close(); }
});

test("saved citations retain their exact receipt and are only readable by the conversation owner", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer({ ...fixture.input,
      response: { ...fixture.input.response, sources: [citation.source] }, citations: [citation] });
    const access = { db: fixture.d1, workspaceId: "w", userId: "u", messageId: saved.responseMessageId, sourceId: "source-1" };
    const retained = await readSavedCitationReceipt(access);
    assert.deepEqual(retained?.receipt, citation.receipt);
    assert.equal(await readSavedCitationReceipt({ ...access, userId: "other-user" }), null);
    assert.equal(await readSavedCitationReceipt({ ...access, workspaceId: "other-workspace" }), null);
  } finally { fixture.sqlite.close(); }
});

test("a receipt for different evidence cannot be published and the reservation remains usable", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const publication = { ...fixture.input, response: { ...fixture.input.response, sources: [citation.source] } };
    await assert.rejects(() => persistSignedInAnswer({ ...publication,
      citations: [{ ...citation, receipt: { ...citation.receipt, textSha256: "0".repeat(64) } }] }), /CITATION_EVIDENCE_MISMATCH/);
    const saved = await persistSignedInAnswer({ ...publication, citations: [citation] });
    assert.ok(await readSavedCitationReceipt({ db: fixture.d1, workspaceId: "w", userId: "u",
      messageId: saved.responseMessageId, sourceId: citation.source.sourceId }));
  } finally { fixture.sqlite.close(); }
});

test("the saved answer cannot describe a different source than its receipt record", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    await assert.rejects(() => persistSignedInAnswer({ ...fixture.input,
      response: { ...fixture.input.response, sources: [{ ...citation.source, originalUrl: "https://lex.uz/docs/999" }] },
      citations: [citation] }), /CITATION_PRESENTATION_MISMATCH/);
  } finally { fixture.sqlite.close(); }
});

test("opening a saved citation checks ownership and availability and preserves historical text", async () => {
  const fixture = await legalAnswerStorageFixture();
  try {
    const saved = await persistSignedInAnswer({ ...fixture.input,
      response: { ...fixture.input.response, sources: [citation.source] }, citations: [citation] });
    let reads = 0;
    const access = { db: fixture.d1, workspaceId: "w", userId: "u", messageId: saved.responseMessageId,
      sourceId: "source-1", signal: new AbortController().signal,
      objects: { get: async () => { reads++; return Buffer.from(text); } } };
    assert.equal(await openSavedCitation({ ...access, userId: "other" }), null);
    assert.equal(reads, 0);
    assert.equal((await openSavedCitation(access))?.text, text);
    await assert.rejects(() => openSavedCitation({ ...access,
      objects: { get: async () => null } }), /CITATION_OBJECT_UNAVAILABLE/);
    assert.equal(await openSavedCitation({ ...access, objects: { get: async () => {
      fixture.sqlite.prepare("UPDATE workspace_members SET status='suspended' WHERE id='member'").run();
      return Buffer.from(text);
    } } }), null);
    assert.equal(await readSavedCitationReceipt(access), null);
  } finally { fixture.sqlite.close(); }
});
