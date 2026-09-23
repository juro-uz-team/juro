import assert from "node:assert/strict";
import test from "node:test";

import {
  customCurrentSha256,
  materializeCustomCurrentItem,
  partitionCustomBm25IntermediateRecords,
  serializeCustomCurrentArtifact,
  ensureCustomCurrentReduction,
} from "../lib/legal-corpus/custom-current-build";
import { buildRetrievalChunks, serializeCustomEmbeddingInput } from "../lib/legal-corpus/custom-hybrid-index";

const releaseId = "release:staging:current:custom-v1:2026-09-03";

test("reduction handoff uses a valid stable instance identity and resumes after an ambiguous creation", async () => {
  const instances = new Map<string, unknown>();
  let creates = 0;
  const workflow = {
    async create(options: { id?: string; params?: unknown } = {}) {
      assert.match(options.id!, /^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,99}$/u);
      creates++;
      if (!instances.has(options.id!)) instances.set(options.id!, options.params);
      throw Error("CREATE_RESPONSE_LOST_OR_ALREADY_EXISTS");
    },
    async get(id: string) {
      if (!instances.has(id)) throw Error("INSTANCE_MISSING");
      return { id, status: async () => ({ status: "running" }) };
    },
  };
  const payload = { releaseId, expectedPageCount: 16098 };
  const first = await ensureCustomCurrentReduction(workflow, payload);
  assert.equal(await ensureCustomCurrentReduction(workflow, payload), first);
  assert.equal(instances.size, 1);
  assert.equal(creates, 2);
  assert.deepEqual(instances.get(first), payload);
  await assert.rejects(() => ensureCustomCurrentReduction({
    create: async () => { throw Error("CREATE_UNAVAILABLE"); },
    get: async () => { throw Error("INSTANCE_MISSING"); },
  }, { releaseId: "release:other" }), /CREATE_UNAVAILABLE/);
});
const provision = {
  schemaVersion: 1,
  provisionRenditionId: "rendition:1",
  publisherInstrumentToken: "123",
  publisherProvisionToken: "article-1",
  languageTag: "ru",
  actTitle: "Трудовой кодекс",
  documentType: "Кодекс",
  articleNumber: "Статья 1",
  articleTitle: "Общие положения",
  provisionSequence: 1,
  provisionText: "Трудовые права защищаются законом.",
  sourceUrl: "https://lex.uz/docs/123",
  capturedAt: "2026-08-31T00:00:00.000Z",
  sourceNormalizedSha256: "b".repeat(64),
};

test("qualified evidence materializes deterministic chunk, dense and sparse inputs", async () => {
  const bytes = serializeCustomCurrentArtifact(provision);
  const planItem = {
    sourceOrdinal: 42,
    snapshotProvisionId: "snapshot-provision:1",
    provisionRenditionId: "rendition:1",
    evidenceR2Key: "corpus/provisions/revision/rendition.json",
    evidenceByteCount: bytes.byteLength,
    evidenceSha256: await customCurrentSha256(bytes),
    language: "ru" as const,
    documentType: "Кодекс",
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
  };
  const first = await materializeCustomCurrentItem({ releaseId, planItem, evidenceBytes: bytes });
  const repeated = await materializeCustomCurrentItem({ releaseId, planItem, evidenceBytes: bytes });
  assert.deepEqual(repeated, first);
  assert.equal(first.chunks.length, 1);
  assert.equal(first.denseItems.length, first.chunks.length);
  assert.equal(first.documentFieldLengths[0]?.itemOrdinal, 42_000);
  assert.ok(first.sparseRecords.length > 0);
  assert.ok(first.sparseRecords.every((record) => !JSON.stringify(record).includes("Труд")));
  assert.deepEqual(Object.keys(first.denseItems[0]!.metadata).sort(), [
    "document_type", "item_key", "language", "release_id", "snapshot_provision_id",
    "valid_from_epoch", "valid_to_epoch",
  ]);
  assert.equal(first.denseItems[0]!.metadata.valid_to_epoch, 253_402_300_799);
  const partitions = partitionCustomBm25IntermediateRecords(first.sparseRecords);
  assert.deepEqual(Object.keys(partitions), "0123456789abcdef".split(""));
  assert.equal(Object.values(partitions).flat().length, first.sparseRecords.length);
  for (const [nibble, records] of Object.entries(partitions)) {
    assert.ok(records.every((record) => record.termHash.startsWith(nibble)));
  }
});

test("materialization rejects evidence byte, identity and metadata drift", async () => {
  const bytes = serializeCustomCurrentArtifact(provision);
  const base = {
    sourceOrdinal: 0,
    snapshotProvisionId: "snapshot-provision:1",
    provisionRenditionId: "rendition:1",
    evidenceR2Key: "corpus/provisions/revision/rendition.json",
    evidenceByteCount: bytes.byteLength,
    evidenceSha256: await customCurrentSha256(bytes),
    language: "ru" as const,
    documentType: "Кодекс",
    validFrom: "2020-01-01T00:00:00.000Z",
    validTo: null,
  };
  await assert.rejects(materializeCustomCurrentItem({
    releaseId, planItem: { ...base, evidenceSha256: "0".repeat(64) }, evidenceBytes: bytes,
  }), /CUSTOM_CURRENT_EVIDENCE_INTEGRITY_FAILED/u);
  await assert.rejects(materializeCustomCurrentItem({
    releaseId, planItem: { ...base, language: "en" }, evidenceBytes: bytes,
  }), /CUSTOM_CURRENT_EVIDENCE_IDENTITY_FAILED/u);
});

test("accepted complete-corpus locators preserve audited metadata and stop input drift before embedding", async () => {
  const acceptedMetadata = { documentTitle: "Accepted title", articleNumber: "1",
    articleTitle: null, hierarchy: ["Part one", "Chapter two"] };
  const chunks = await buildRetrievalChunks({ snapshotProvisionId: "audit:fixture",
    sourceDocumentTitle: acceptedMetadata.documentTitle, documentType: "unknown",
    articleNumber: "1", articleTitle: null, hierarchy: acceptedMetadata.hierarchy,
    language: "en", script: "Latn", officialText: "Audited official provision.", validFromEpoch: 0, validToEpoch: null },
  { targetTokens: 512 });
  const expected = await Promise.all(chunks.map(async chunk => ({ ordinal: chunk.ordinal,
    officialTextSha256: await customCurrentSha256(chunk.officialText),
    inputSha256: await customCurrentSha256(serializeCustomEmbeddingInput(chunk)), inputTokens: chunk.embeddingTokenCount })));
  for (const envelope of [false, true]) {
    const bytes = new TextEncoder().encode(envelope
      ? JSON.stringify({ provisionText: "Audited official provision.", actTitle: "Old title is not used" })
      : "Audited official provision.");
    const digest = await customCurrentSha256(bytes);
    const key = "legal-corpus/complete-v2/provision/fixture";
    const planItem = { sourceOrdinal: 0, snapshotProvisionId: "snapshot-provision:fixture", provisionRenditionId: "rendition:fixture",
      evidenceR2Key: key, evidenceByteCount: bytes.length, evidenceSha256: digest, language: "en" as const,
      documentType: "unknown", validFrom: "1970-01-01T00:00:00.000Z", validTo: null,
      accepted: { legacyRenditionId: "rendition:fixture", sourceId: "source:fixture", legalIdentitySha256: "a".repeat(64),
        contentSha256: await customCurrentSha256("Audited official provision."),
        provision: { key, sha256: digest, sizeBytes: bytes.length, envelope },
        normalized: { key: "normalized", sha256: "b".repeat(64), sizeBytes: 100 }, chunks: expected } };
    const materialize = (metadata = acceptedMetadata) => materializeCustomCurrentItem({ releaseId, planItem,
      evidenceBytes: bytes, acceptedMetadata: metadata, segmentId: "history-base-v1" });
    const result = await materialize();
    assert.ok(result.documentFieldLengths.every(record => record.segmentId === "history-base-v1"));
    assert.deepEqual(result.chunks[0]?.hierarchy, acceptedMetadata.hierarchy);
    assert.equal(result.denseItems[0]?.structuredInputSha256, expected[0]?.inputSha256);
    assert.equal(result.denseItems[0]?.inputTokens, expected[0]?.inputTokens);
    await assert.rejects(materialize({ ...acceptedMetadata, documentTitle: "Changed title" }), /ACCEPTED_CHUNK_MISMATCH/);
    await assert.rejects(materialize({ ...acceptedMetadata, hierarchy: [] }), /ACCEPTED_CHUNK_MISMATCH/);
  }
});
