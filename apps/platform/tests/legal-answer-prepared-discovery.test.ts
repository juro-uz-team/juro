import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createPreparedDiscovery } from "../lib/legal-answer-workflow/prepared-discovery";
import { createQueryEmbeddings } from "../lib/legal-answer-workflow/embeddings";

const hash = "a".repeat(64);
const artifacts = { packageSha256: hash, vectorCompletionSha256: hash, vectorIdentitySha256: hash,
  membershipSha256: hash, workIndexSha256: hash, navigationSha256: hash, sparseSha256: hash };
const release = { id: "fixture-release", environment: "staging", capability: "current",
  instances: [{ id: "fixture-instance", shardId: "fixture-shard" }],
  configuration: { backend: "prepared-corpus-v1", navigationBackend: "pgvector", identity: "fixture-config",
    embeddingModel: "openai/text-embedding-3-large", dimensions: 3072, artifacts,
    evidenceSemantics: "discovery-only", categoryRanking: { mode: "disabled" },
    gatewayIdentity: "fixture-gateway", providerProjectIdentity: "fixture-project",
    gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false } };

for (const rendered of [false, true]) test(`original asset reads bind discovered work and exact bytes${rendered ? " with pinned office rendition" : ""}`, async () => {
  const bytes = Buffer.from("%PDF-artificial complete source"), work = "b".repeat(64);
  const sha256 = createHash("sha256").update(bytes).digest("hex"), url = "https://lex.uz/files/fixture.pdf";
  const pdf = Buffer.from("%PDF-rendered artificial office file"), pdfSha256 = createHash("sha256").update(pdf).digest("hex");
  let assetCalls = 0, malformed = "";
  const discovery = createPreparedDiscovery({ release, embed: async () => Array(3072).fill(0.01), transport: {
    execute: async request => ({ version: request.version, releaseId: request.releaseId, environment: request.environment,
      configuration: request.configuration, requestSha256: request.requestSha256, lanes: { dense: "complete", sparse: "complete" },
      hits: [{ vectorOrdinal: 7, membershipOrdinal: 9, vectorRank: 1, vectorScore: 0.5,
        keywordRank: 1, keywordScore: 0.5, fusionScore: 0.5 }] }),
    readExact: async () => ({ package_sha256: hash, membership_sha256: hash, work_index_sha256: hash,
      vector_completion_sha256: hash, sources: { [work]: { inventory: { id: work, kind: "asset", state: "done",
        url, bytes: bytes.length, raw_hash: sha256 }, prepared: { work } } },
      units: { [`${work}:1`]: { text: "Discovery text" } },
      records: [{ vector_ordinal: 7, membership_ordinal: 9, work, unit: `${work}:1`, status: "discovery_only" }] }),
    readSources: async () => { throw Error("Full OCR hydration is not required for original bytes"); },
    readAsset: async request => {
      assetCalls++; assert.equal(request.work, work);
      return { package_sha256: malformed === "generation" ? "c".repeat(64) : hash, work_index_sha256: hash,
        asset: { work: malformed === "work" ? "c".repeat(64) : work, source_url: url, sha256,
          byte_count: bytes.length, data_base64: malformed === "bytes" ? Buffer.alloc(bytes.length).toString("base64")
            : bytes.toString("base64"), ...(rendered ? { rendered_pdf: {
              source_sha256: malformed === "render-source" ? "c".repeat(64) : sha256,
              renderer_image: malformed === "render-image" ? "image:latest" : `sha256:${hash}`,
              sha256: pdfSha256, byte_count: pdf.length,
              data_base64: malformed === "render-bytes" ? Buffer.alloc(pdf.length).toString("base64") : pdf.toString("base64"),
            } } : {}) } };
    },
  } });
  const signal = new AbortController().signal;
  await assert.rejects(() => discovery.readAsset(work, signal), /SOURCE_NOT_DISCOVERED/);
  assert.equal(assetCalls, 0);
  const found = await discovery.search("artificial query", { kind: "current" }, signal);
  await discovery.readCandidate(found.candidates[0], signal);
  const invalidCases = ["generation", "work", "bytes", ...(rendered ? ["render-source", "render-image", "render-bytes"] : [])];
  for (const invalid of invalidCases) {
    malformed = invalid;
    await assert.rejects(() => discovery.readAsset(work, signal), /SOURCE_ASSET_IDENTITY/);
  }
  malformed = "";
  const result = await discovery.readAsset(work, signal);
  assert.deepEqual(Buffer.from(result.bytes), bytes);
  if (rendered) {
    assert.deepEqual(Buffer.from(result.renderedPdf!.bytes), pdf);
    assert.equal(result.renderedPdf!.rendererImage, `sha256:${hash}`);
    assert.equal(result.renderedPdf!.sourceSha256, sha256);
  }
  result.bytes.fill(0);
  assert.deepEqual(Buffer.from((await discovery.readAsset(work, signal)).bytes), bytes);
  assert.equal(assetCalls, invalidCases.length + 1, "failed reads are retryable; successful source bytes are reused");
});

test("large catalog batches split on explicit limits and commit metadata only when every page is valid", async () => {
  const sizes: number[] = [];
  let malformed = true;
  const discovery = createPreparedDiscovery({ release, embed: async () => Array.from({ length: 3072 }, () => 0.01),
    transport: {
      execute: async request => ({ version: request.version, releaseId: request.releaseId, environment: request.environment,
        configuration: request.configuration, requestSha256: request.requestSha256, lanes: { dense: "complete", sparse: "complete" },
        hits: Array.from({ length: 20 }, (_, i) => ({ vectorOrdinal: i, membershipOrdinal: i + 100,
          vectorRank: i + 1, vectorScore: 0.5, keywordRank: i + 1, keywordScore: 0.5, fusionScore: 0.5 })) }),
      readExact: async input => {
        sizes.push(input.references.length);
        if (input.references.length > 12) throw new Error("PREPARED_CATALOG_PAGE_REQUIRED");
        const coordinates = malformed && input.references[0][0] >= 10
          ? input.references.map(() => input.references[0]) : input.references;
        return { package_sha256: hash, membership_sha256: hash, work_index_sha256: hash, vector_completion_sha256: hash,
          sources: { work: { inventory: { id: "work" }, prepared: { work: "work" } } },
          units: { "work:1": { text: "Artificial discovery unit" } },
          records: coordinates.map(([vector, member]) => ({ vector_ordinal: vector, membership_ordinal: member,
            work: "work", unit: "work:1", status: "discovery_only" })) };
      }, readSources: async () => { throw new Error("Unexpected full source read"); },
    },
  });
  const signal = new AbortController().signal;
  const { candidates } = await discovery.search("artificial query", { kind: "current" }, signal);
  await assert.rejects(discovery.prepareCandidates(candidates, signal), /CATALOG_MEMBERSHIP_MISMATCH/);
  malformed = false;
  await discovery.prepareCandidates(candidates, signal);
  for (const [index, identity] of candidates.entries()) assert.equal((await discovery.readCandidate(identity, signal)).vector_ordinal, index);
  assert.deepEqual(sizes, [20, 10, 10, 20, 10, 10]);
});

test("selected metadata is fetched in one batch and a malformed packet cannot partially populate its cache", async () => {
  let reads = 0, malformed = true;
  const discovery = createPreparedDiscovery({ release, embed: async () => Array.from({ length: 3072 }, () => 0.01),
    transport: {
      execute: async request => ({ version: request.version, releaseId: request.releaseId, environment: request.environment,
        configuration: request.configuration, requestSha256: request.requestSha256, lanes: { dense: "complete", sparse: "complete" },
        hits: [7, 8].map((ordinal, index) => ({ vectorOrdinal: ordinal, membershipOrdinal: ordinal + 2,
          vectorRank: index + 1, vectorScore: 0.5 - index * 0.1, keywordRank: index + 1, keywordScore: 0.5 - index * 0.1,
          fusionScore: 0.5 - index * 0.1 })) }),
      readExact: async input => {
        reads++;
        const coordinates = malformed ? [input.references[0], input.references[0]] : [...input.references].reverse();
        return { package_sha256: hash, membership_sha256: hash, work_index_sha256: hash, vector_completion_sha256: hash,
          sources: { work: { inventory: { id: "work" }, prepared: { work: "work" } } },
          units: { "work:1": { text: "Artificial discovery unit" } },
          records: coordinates.map(([vector, member]) => ({ vector_ordinal: vector, membership_ordinal: member,
            work: "work", unit: "work:1", status: "discovery_only" })) };
      }, readSources: async () => { throw new Error("Unexpected full source read"); },
    },
  });
  const signal = new AbortController().signal;
  const { candidates } = await discovery.search("artificial query", { kind: "current" }, signal);
  await assert.rejects(() => discovery.prepareCandidates(candidates, signal), /CATALOG_MEMBERSHIP_MISMATCH/);
  malformed = false;
  await discovery.prepareCandidates(candidates, signal);
  assert.equal(reads, 2);
  const first = await discovery.readCandidate(candidates[0], signal);
  assert.equal(first.vector_ordinal, 7);
  first.unitMetadata.text = "Caller mutation";
  assert.equal((await discovery.readCandidate(candidates[0], signal)).unitMetadata.text, "Artificial discovery unit");
  assert.equal((await discovery.readCandidate(candidates[1], signal)).vector_ordinal, 8);
  assert.equal(reads, 2);
});

test("prepared discovery uses both retained lanes and binds exact source membership", async () => {
  let querySeen = "";
  let embeddingCalls = 0;
  const embeddings = createQueryEmbeddings({ apiKey: "fixture", dimensions: 3072, inputRate: 130_000,
    deadlineAt: Date.now() + 30_000, phase: "final",
    ledger: { reserve: input => { assert.equal(input.category, "embedding"); return "fixture"; },
      dispatch: () => {}, settle: () => {}, cancel: () => {} }, receipt: async () => {},
    fetchImpl: async (_url, init) => {
      embeddingCalls++;
      const request = JSON.parse(String(init?.body));
      querySeen = request.input;
      return Response.json({ object: "list", model: request.model, usage: { prompt_tokens: 8, total_tokens: 8 },
        data: [{ object: "embedding", index: 0, embedding: Array.from({ length: request.dimensions }, () => 0.01) }] });
    },
  });
  const discovery = createPreparedDiscovery({ release,
    embed: embeddings.embed,
    transport: {
      execute: async request => ({ version: request.version, releaseId: request.releaseId, environment: request.environment,
        configuration: request.configuration, requestSha256: request.requestSha256,
        lanes: { dense: "complete", sparse: "complete" }, hits: [{ vectorOrdinal: 7, membershipOrdinal: 9,
          vectorRank: 1, vectorScore: 0.5, keywordRank: 1, keywordScore: 0.5, fusionScore: 0.5 }] }),
      readExact: async () => ({ package_sha256: hash, membership_sha256: hash, work_index_sha256: hash,
        vector_completion_sha256: hash, sources: { work: { inventory: { id: "work" }, prepared: { work: "work" } } },
        units: { "work:1": { text: "Artificial discovery text, not legal evidence." } },
        records: [{ vector_ordinal: 7, membership_ordinal: 9, work: "work", unit: "work:1", status: "discovery_only" }] }),
      readSources: async () => ({ package_sha256: hash, work_index_sha256: hash,
        sources: { work: { inventory: { id: "work" }, prepared: { work: "work", units: [] } } } }),
    },
  });
  const signal = new AbortController().signal;
  const packet = await discovery.search("artificial permit query", { kind: "current" }, signal);
  assert.equal(querySeen, "artificial permit query");
  assert.equal(packet.sparseAvailable && packet.denseAvailable, true);
  const candidate = await discovery.readCandidate(packet.candidates[0], signal);
  assert.equal(candidate.work, "work");
  assert.equal(candidate.status, "discovery_only");
  assert.equal((await discovery.readSources(["work"], signal)).work.inventory.id, "work");
  await discovery.search("artificial permit query", { kind: "current" }, signal);
  assert.equal(embeddingCalls, 1);
});
