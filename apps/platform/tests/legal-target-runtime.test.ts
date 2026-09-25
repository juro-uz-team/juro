import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createProviderCandidateIndex, parseCandidatePacket, parsePinnedCandidateRelease }
  from "../lib/legal-corpus/legal-candidate-index";

import { createRuntimeCustomSearchProvider, createRuntimeCandidateCatalog, createRuntimePinnedCustomSearchProvider,
  resolveRuntimeTrustedLegalTitles }
  from "../lib/legal-corpus/target-runtime";
import { buildCustomTrustedTitleInventory } from "../lib/legal-corpus/custom-search-trusted-titles";
import { buildCustomMembershipLookup } from "../lib/legal-corpus/custom-membership-lookup";

test("explicitly pinned providers reject another release or environment before transport", async () => {
  let requests=0;
  const provider=createRuntimePinnedCustomSearchProvider({environment:"production",releaseId:"candidate-release",
    configurationIdentity:"candidate-config",capability:"current",gatewayIdentity:"gateway",projectIdentity:"project",
    service:{async fetch(){requests++;throw Error("Unexpected transport");}}});
  await provider.attest("custom-current-production-v1","candidate-release");
  await assert.rejects(provider.attest("custom-current-staging-v1","candidate-release"),/INSTANCE_REJECTED/);
  await assert.rejects(provider.attest("custom-current-production-v1","other-release"),/RELEASE_REJECTED/);
  assert.equal(requests,0);
});

test("independent scopes cross bounded search batches without losing packet provenance", async () => {
  const release = parsePinnedCandidateRelease({id: "scope-release", environment: "development", capability: "current",
    instances: [{id: "scope-instance", shardId: "scope-shard"}], configuration: {identity: "scope-config",
      embeddingModel: "openai/text-embedding-3-large", dimensions: 1536, keywordTokenizer: "porter",
      metadataSchema: ["language", "document_type", "valid_from", "valid_to"], gatewayIdentity: "gateway",
      providerProjectIdentity: "project", gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false}});
  const formulations = Array.from({length: 20}, (_, index) => ({id: `formulation-${index}`, text: `Independent scope ${index}`,
    privateNameSpans: [], readingIds: ["reading"], requirementIds: [`requirement-${index}`]}));
  for (const mode of ["shared", "distinct", "partial"] as const) {
    const batchSizes: number[] = [];
    const index = createProviderCandidateIndex({async attest() { return release.configuration; },
      async search() { throw new Error("Expected batched search"); },
      async searchMany(input) {
        assert.ok(input.queries.length <= 6);
        batchSizes.push(input.queries.length);
        return {searchedInstanceIds: input.instanceIds, errors: [], results: input.queries.flatMap((query, queryIndex) =>
          mode === "partial" && query === "Independent scope 19" ? [] : [{queryIndex,
            hits: Array.from({length: mode === "distinct" ? 50 : 1}, (_, hit) => ({
              itemKey: `search-releases/${release.id}/${mode === "shared" ? "shared" : `${query}-${hit}`}`,
              instanceId: "scope-instance", shardId: "scope-shard", vectorRank: hit + 1, keywordRank: hit + 1,
              vectorScore: 1, keywordScore: 1, fusionScore: 1 / (hit + 1),
            }))}])};
      }}, {});
    const packet = await index.retrieve({id: "scope-plan", formulations}, {kind: "current"}, release);
    assert.deepEqual(batchSizes, [6, 6, 6, 2]);
    assert.equal(packet.availability, mode === "partial" ? "unavailable" : "available");
    if (mode === "shared") {
      assert.equal(packet.candidates.length, 1);
      assert.equal(packet.candidates[0]!.formulationIds.length, 20);
      assert.equal(packet.candidates[0]!.retrievalRequirementIds.length, 20);
    }
    if (mode === "distinct") assert.equal(packet.candidates.length, 1000);
    if (mode === "partial") assert.equal(packet.candidates.length, 0);
  }
});

test("named instruments remain searchable with custom-only release mappings", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE legal_search_releases (id TEXT PRIMARY KEY);
    INSERT INTO legal_search_releases VALUES ('custom-release'),('legacy-release');
    CREATE TABLE legal_search_release_items (search_release_id TEXT,provision_rendition_id TEXT);
    CREATE TABLE legal_provision_renditions (id TEXT,provision_concept_id TEXT);
    CREATE TABLE legal_provision_concepts (id TEXT,legal_instrument_id TEXT);
    CREATE TABLE legal_instruments (id TEXT,canonical_title TEXT);
    CREATE TABLE legal_custom_search_runtime_items (search_release_id TEXT,legal_identity_sha256 TEXT);
    CREATE TABLE legal_custom_search_runtime_components (search_release_id TEXT,complete_corpus_run_id TEXT);
    CREATE TABLE legal_complete_corpus_records (run_id TEXT,legal_identity_sha256 TEXT,
      instrument_id TEXT,current_eligible INTEGER,quarantined INTEGER);
    INSERT INTO legal_search_release_items VALUES ('legacy-release','legacy-rendition');
    INSERT INTO legal_provision_renditions VALUES ('legacy-rendition','legacy-concept');
    INSERT INTO legal_provision_concepts VALUES ('legacy-concept','other');
    INSERT INTO legal_custom_search_runtime_items VALUES ('custom-release','identity');
    INSERT INTO legal_custom_search_runtime_components VALUES ('custom-release','accepted-run');
    INSERT INTO legal_complete_corpus_records VALUES ('accepted-run','identity','labor',1,0),
      ('unrelated-run','identity','other',1,0);`);
  sqlite.exec(readFileSync(new URL("../legal-drizzle/0026_custom_search_trusted_titles.sql", import.meta.url), "utf8"));
  const inventory = await buildCustomTrustedTitleInventory("custom-release", ["Labor Code"]);
  sqlite.prepare("INSERT INTO legal_custom_search_trusted_titles VALUES (?,?)")
    .run(inventory.releaseId, inventory.titles[0]!);
  sqlite.prepare("INSERT INTO legal_custom_search_title_inventories VALUES (?,?,?,?)")
    .run(inventory.releaseId, inventory.titleCount, inventory.sha256, "2026-09-06T00:00:00.000Z");
  const db = { prepare(sql: string) { return { bind(...values: string[]) {
    return { async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
  } }; } } as unknown as D1Database;
  const release = parsePinnedCandidateRelease({ id: "custom-release", environment: "development",
    capability: "current", instances: [{ id: "custom-current-development-v1", shardId: "base" }],
    configuration: { identity: "custom-v1", embeddingModel: "openai/text-embedding-3-large",
      dimensions: 1536, keywordTokenizer: "porter",
      metadataSchema: ["language", "document_type", "valid_from", "valid_to"],
      gatewayIdentity: "gateway", providerProjectIdentity: "project", gatewayPayloadLogging: false,
      gatewayCaching: false, similarityCaching: false } });
  const searched: string[] = [];
  const index = createProviderCandidateIndex({
    async attest() { return release.configuration; },
    async search() { throw new Error("expected batched formulation search"); },
    async searchMany(input) {
      searched.push(...input.queries);
      return {
        results: input.queries.map((query, queryIndex) => {
          const suffix = query.startsWith("Labor Code") ? "labor" : "maternity";
          return { queryIndex, hits: [{
            itemKey: `search-releases/${release.id}/retrieval-chunk-v1:shared`,
            instanceId: "custom-current-development-v1",
            shardId: "base",
            vectorRank: 1,
            vectorScore: suffix === "labor" ? 0.95 : 0.8,
            keywordRank: 1,
            keywordScore: suffix === "labor" ? 0.95 : 0.8,
            fusionScore: suffix === "labor" ? 0.95 : 0.8,
          }, {
            itemKey: `search-releases/${release.id}/retrieval-chunk-v1:${suffix}`,
            instanceId: "custom-current-development-v1",
            shardId: "base",
            vectorRank: 2,
            vectorScore: 0.9,
            keywordRank: 2,
            keywordScore: 0.9,
            fusionScore: 0.9,
          }] };
        }),
        errors: [],
        searchedInstanceIds: input.instanceIds,
      };
    },
  }, {
    async attestPrivateNames(input) { return { classifierVersion: "juro-local-pii-v1",
      formulationSha256: input.formulationSha256, status: "complete", privateNameSpans: [] }; },
    resolveTrustedLegalTitles: (pinned) => resolveRuntimeTrustedLegalTitles(db, pinned.id),
  });
  try {
    const packet = await index.retrieve({ id: "interpretation", formulations: [{
      id: "formulation", text: "Labor Code termination rules", legalTitleSpans: ["Labor Code"],
      privateNameSpans: [], readingIds: ["reading"], requirementIds: ["requirement"],
    }, {
      id: "maternity", text: "protection during maternity leave", legalTitleSpans: [],
      privateNameSpans: [], readingIds: ["reading"], requirementIds: ["protection"],
    }] }, { kind: "current" }, release);
    assert.equal(packet.availability, "available");
    assert.deepEqual(searched, [
      "Labor Code termination rules",
      "protection during maternity leave",
    ]);
    assert.deepEqual(packet.candidates.map((candidate) => ({
      itemKey: candidate.itemKey,
      formulationIds: candidate.formulationIds,
      formulationMatches: candidate.formulationMatches,
      retrievalRequirementIds: candidate.retrievalRequirementIds,
    })), [{
      itemKey: `search-releases/${release.id}/retrieval-chunk-v1:shared`,
      formulationIds: ["formulation", "maternity"],
      formulationMatches: [{ formulationId: "formulation", rank: 1, fusionScore: 0.95 },
        { formulationId: "maternity", rank: 1, fusionScore: 0.8 }],
      retrievalRequirementIds: ["protection", "requirement"],
    }, {
      itemKey: `search-releases/${release.id}/retrieval-chunk-v1:labor`,
      formulationIds: ["formulation"],
      formulationMatches: [{ formulationId: "formulation", rank: 2, fusionScore: 0.9 }],
      retrievalRequirementIds: ["requirement"],
    }, {
      itemKey: `search-releases/${release.id}/retrieval-chunk-v1:maternity`,
      formulationIds: ["maternity"],
      formulationMatches: [{ formulationId: "maternity", rank: 2, fusionScore: 0.9 }],
      retrievalRequirementIds: ["protection"],
    }]);
    assert.deepEqual(await resolveRuntimeTrustedLegalTitles(db, release.id), ["Labor Code"]);
    sqlite.prepare("INSERT INTO legal_instruments VALUES (?,?)").run("other", "Other Code");
    assert.deepEqual(await resolveRuntimeTrustedLegalTitles(db, "legacy-release"), ["Other Code"]);
  } finally { sqlite.close(); }
});

test("runtime custom provider keeps its pinned release after activation changes, including empty results", async () => {
  const requests: Request[] = [];
  const releaseId = "release:staging:current:custom-v2:2026-09-05";
  const currentAt = "2026-09-06T00:00:00.000Z";
  let activeReleaseId = releaseId;
  const provider = createRuntimeCustomSearchProvider({
    capability: "current",
    environment: "staging",
    gatewayIdentity: "juro-ai-search-staging",
    projectIdentity: "juro-openai-staging",
    db: { prepare(sql: string) { return { bind(_environment: string, pinnedId?: string) {
      return { async first() { return {
      id: sql.includes("legal_active_activation_sets") ? activeReleaseId : pinnedId,
      configurationIdentity: "custom-hybrid-staging-v1",
    }; } }; } }; } } as unknown as D1Database,
    service: { async fetch(input, init) {
      const request = new Request(input, init);
      requests.push(request);
      const body = await request.clone().json() as { queries?: string[] };
      return Response.json(body.queries ? {
        results: body.queries.map((_, queryIndex) => ({ queryIndex, hits: [] })),
        errors: [], searchedInstanceIds: ["custom-current-staging-v1"], tokenUsage: 2,
      } : { hits: [], errors: [],
        searchedInstanceIds: ["custom-current-staging-v1"], tokenUsage: 2 });
    } } as Fetcher,
  });
  assert.equal((await provider.attest("custom-current-staging-v1", releaseId)).identity,
    "custom-hybrid-staging-v1");
  activeReleaseId = "release:staging:current:replacement";
  const result = await provider.search({ releaseId, currentAt, instanceIds: ["custom-current-staging-v1"],
    query: "Article 1", endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0 });
  assert.equal(result.tokenUsage, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.headers.get("x-juro-service-binding"), "custom-search-runtime-v1");
  assert.deepEqual(await requests[0]?.json(), {
    releaseId: "release:staging:current:custom-v2:2026-09-05",
    currentAt,
    instanceIds: ["custom-current-staging-v1"], query: "Article 1",
    endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0,
  });
  assert.equal((await provider.searchMany!({ releaseId, currentAt,
    instanceIds: ["custom-current-staging-v1"], queries: ["Article 1", "Article 2"],
    endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0 })).results.length, 2);
  assert.equal(requests.length, 2);
  assert.deepEqual(await requests[1]?.json(), {
    releaseId: "release:staging:current:custom-v2:2026-09-05",
    currentAt, instanceIds: ["custom-current-staging-v1"], queries: ["Article 1", "Article 2"],
    endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0,
  });
  await assert.rejects(() => provider.search({ instanceIds: ["custom-current-staging-v1"],
    query: "Article 1", endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0 }),
  /CUSTOM_SEARCH_PINNED_RELEASE_REQUIRED/u);

  const historyRequests: Request[] = [];
  const history = createRuntimeCustomSearchProvider({
    capability: "history",
    environment: "staging",
    gatewayIdentity: "juro-ai-search-staging",
    projectIdentity: "juro-openai-staging",
    db: { prepare() { return { bind(_environment: string, pinnedId: string) {
      return { async first() { return { id: pinnedId,
        configurationIdentity: "custom-hybrid-staging-v1" }; } };
    } }; } } as unknown as D1Database,
    service: { async fetch(input, init) {
      const request = new Request(input, init);
      historyRequests.push(request);
      return Response.json({ hits: [], errors: [],
        searchedInstanceIds: ["custom-history-staging-v1"], tokenUsage: 2 });
    } } as Fetcher,
  });
  assert.equal((await history.attest("custom-history-staging-v1",
    "release:staging:history:custom-v1:2026-09-06")).identity,
  "custom-hybrid-staging-v1");
  const instant = "2020-01-01T00:00:00.000Z";
  await history.search({ releaseId: "release:staging:history:custom-v1:2026-09-06",
    currentAt, instanceIds: ["custom-history-staging-v1"], query: "Article 1",
    endpoint: { kind: "timestamp", instant }, maxResults: 50, vectorThreshold: 0 });
  assert.equal(historyRequests.length, 1);
  assert.deepEqual(await historyRequests[0]?.json(), {
    releaseId: "release:staging:history:custom-v1:2026-09-06", currentAt,
    instanceIds: ["custom-history-staging-v1"], query: "Article 1",
    endpoint: { kind: "timestamp", instant }, maxResults: 50, vectorThreshold: 0,
  });
  await assert.rejects(() => history.search({
    releaseId: "release:staging:history:custom-v1:2026-09-06", currentAt,
    instanceIds: ["custom-history-staging-v1"], query: "Article 1",
    endpoint: { kind: "current" }, maxResults: 50, vectorThreshold: 0,
  }), /CUSTOM_SEARCH_REQUEST_REJECTED/u);
});

test("custom catalog rejects future and expired records even when candidate lanes returned them", async () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE legal_custom_search_runtime_items
    (search_release_id TEXT,item_key TEXT,retrieval_chunk_id TEXT,legal_identity_sha256 TEXT);
    CREATE TABLE legal_custom_search_runtime_components (search_release_id TEXT,complete_corpus_run_id TEXT);
    CREATE TABLE legal_complete_corpus_records (run_id TEXT,legal_identity_sha256 TEXT,
      provision_rendition_id TEXT,text_revision_id TEXT,provision_concept_id TEXT,
      language TEXT,textual_authority TEXT,valid_from TEXT,valid_to TEXT,current_eligible INTEGER,
      historical_eligible INTEGER,quarantined INTEGER);`);
  const release = parsePinnedCandidateRelease({ id: "release-custom", environment: "staging",
    capability: "current", instances: [{ id: "custom-current-staging-v1", shardId: "current-base-v1" }],
    configuration: { identity: "custom-v1", embeddingModel: "openai/text-embedding-3-large",
      dimensions: 1536, keywordTokenizer: "porter", metadataSchema: ["language", "document_type", "valid_from", "valid_to"],
      gatewayIdentity: "gateway", providerProjectIdentity: "project", gatewayPayloadLogging: false,
      gatewayCaching: false, similarityCaching: false } });
  const key = `search-releases/${release.id}/retrieval-chunk-v1:one`;
  sqlite.prepare("INSERT INTO legal_custom_search_runtime_items VALUES (?,?,?,?)")
    .run(release.id, key, "retrieval-chunk-v1:one", "identity");
  sqlite.prepare("INSERT INTO legal_custom_search_runtime_components VALUES (?,?)").run(release.id, "run");
  const packet = parseCandidatePacket({ availability: "available", releaseId: release.id,
    endpoint: { kind: "current" }, requiredInstanceIds: ["custom-current-staging-v1"], partialErrors: [],
    candidates: [{ itemKey: key, instanceId: "custom-current-staging-v1", shardId: "current-base-v1",
      formulationIds: ["formulation"], readingIds: ["reading"], retrievalRequirementIds: ["requirement"],
      vectorRank: 1, vectorScore: 1, keywordRank: 1, keywordScore: 1, fusionScore: 1 }] });
  const db = { prepare(sql: string) { return { bind(...values: string[]) {
    return { async all() { return { results: sqlite.prepare(sql).all(...values) }; } };
  } }; } } as unknown as D1Database;
  const catalog = createRuntimeCandidateCatalog(db);
  const at = "2026-09-06T00:00:00.000Z";
  try {
    for (const [from, to, valid] of [
      [at, null, true], ["2026-09-07T00:00:00.000Z", null, false],
      ["2026-01-01T00:00:00.000Z", at, false], [null, null, false],
    ] as const) {
      sqlite.exec("DELETE FROM legal_complete_corpus_records");
      sqlite.prepare("INSERT INTO legal_complete_corpus_records VALUES (?,?,?,?,?,?,?,?,?,1,1,0)")
        .run("run", "identity", "rendition", "revision", "concept", "ru", "unknown", from, to);
      const result = catalog.revalidate(packet, { kind: "current" }, release, at);
      if (valid) assert.equal((await result).length, 1);
      else await assert.rejects(() => result, /SOURCE_UNAVAILABILITY/u);
    }
    const historyRelease = parsePinnedCandidateRelease({ ...release,
      id: "release-custom-history", capability: "history",
      instances: [{ id: "custom-history-staging-v1", shardId: "history-base-v1" }] });
    const historyKey = `search-releases/${historyRelease.id}/retrieval-chunk-v1:one`;
    sqlite.prepare("INSERT INTO legal_custom_search_runtime_items VALUES (?,?,?,?)")
      .run(historyRelease.id, historyKey, "retrieval-chunk-v1:one", "identity");
    sqlite.prepare("INSERT INTO legal_custom_search_runtime_components VALUES (?,?)")
      .run(historyRelease.id, "run");
    const historicalAt = "2020-01-01T00:00:00.000Z";
    const historyPacket = parseCandidatePacket({ ...packet, releaseId: historyRelease.id,
      endpoint: { kind: "timestamp", instant: historicalAt },
      requiredInstanceIds: ["custom-history-staging-v1"],
      candidates: packet.candidates.map((candidate) => ({ ...candidate, itemKey: historyKey,
        instanceId: "custom-history-staging-v1", shardId: "history-base-v1" })) });
    sqlite.exec("DELETE FROM legal_complete_corpus_records");
    sqlite.prepare("INSERT INTO legal_complete_corpus_records VALUES (?,?,?,?,?,?,?,?,?,0,1,0)")
      .run("run", "identity", "rendition", "revision", "concept", "ru", "unknown",
        "2019-01-01T00:00:00.000Z", "2021-01-01T00:00:00.000Z");
    assert.equal((await catalog.revalidate(historyPacket,
      { kind: "timestamp", instant: historicalAt }, historyRelease,
      "2026-09-09T00:00:00.000Z")).length, 1);
  } finally { sqlite.close(); }
});

for (const useLookup of [false, true]) for (const currentProofsEnabled of [false, true])
for (const logicalMembership of [false, true])
test(`custom catalog revalidates history membership (fine lookup: ${useLookup}, current proofs: ${currentProofsEnabled}, logical inventory: ${logicalMembership})`, async () => {
  const release = parsePinnedCandidateRelease({ id: "release-custom-history-r2", environment: "staging",
    capability: "history", instances: [{ id: "custom-history-staging-v1", shardId: "history-base-v1" }],
    configuration: { identity: "custom-v1", embeddingModel: "openai/text-embedding-3-large",
      dimensions: 1536, keywordTokenizer: "porter", metadataSchema: ["language", "document_type", "valid_from", "valid_to"],
      gatewayIdentity: "gateway", providerProjectIdentity: "project", gatewayPayloadLogging: false,
      gatewayCaching: false, similarityCaching: false } });
  const canonicalChunkId = `retrieval-chunk-v1:${"b".repeat(64)}`;
  const itemKey = `search-releases/${release.id}/${canonicalChunkId}`;
  const physicalReleaseId = "release:staging:history:custom-v1:2026-09-06";
  const membershipReleaseId = logicalMembership ? release.id : physicalReleaseId;
  const identity = "a".repeat(64);
  const pageBytes = new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1,
    releaseId: membershipReleaseId, partition: "2e",
    items: [{ itemKey: canonicalChunkId, ordinal: 0, legalIdentitySha256: identity }] })}\n`);
  const pageSha256 = createHash("sha256").update(pageBytes).digest("hex");
  const pageKey = `search-releases/${physicalReleaseId}/runtime/membership/2e-${pageSha256}.json`;
  const membershipBytes = new TextEncoder().encode(`${JSON.stringify({ schemaVersion: 1,
    releaseId: membershipReleaseId, partitions: [{ key: pageKey, sizeBytes: pageBytes.byteLength,
      sha256: pageSha256, partition: "2e", count: 1 }] })}\n`);
  const mappingInventorySha256 = createHash("sha256").update(membershipBytes).digest("hex");
  const objects = new Map([
    [pageKey, { bytes: pageBytes, customMetadata: {} }],
    [`search-releases/${membershipReleaseId}/runtime/mappings-${mappingInventorySha256}.json`,
      { bytes: membershipBytes, customMetadata: {} }],
  ]);
  const reads: string[] = [];
  const bucket = { async get(key: string, options?: { range?: { offset: number; length: number } }) {
    reads.push(key);
    const stored = objects.get(key);
    if (!stored) return null;
    const value = options?.range ? stored.bytes.slice(options.range.offset,
      options.range.offset + options.range.length) : stored.bytes;
    return { size: value.byteLength, customMetadata: stored.customMetadata,
      async bytes() { return value.slice(); },
      async arrayBuffer() { return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength); } };
  } };
  const lookup = useLookup ? await buildCustomMembershipLookup({bucket: bucket as unknown as R2Bucket,
    releaseId: membershipReleaseId, sourceInventorySha256: mappingInventorySha256,
    write: async (reference, bytes) => { objects.set(reference.key, {bytes: new Uint8Array(bytes), customMetadata: {}}); }}) : null;
  const db = { prepare(sql: string) {
    return { bind(...values: string[]) {
      if (sql.includes("mapping_inventory_sha256")) {
        assert.deepEqual(values, [release.id, release.id, release.id]);
        return { async first() { return { mappingInventorySha256,memberCount:1,
          ...(lookup ? {lookupKey: lookup.reference.key, lookupSha256: lookup.reference.sha256,
            lookupSizeBytes: lookup.reference.sizeBytes} : {}),
          descriptorKey: `search-releases/${physicalReleaseId}/runtime/descriptor-${"c".repeat(64)}.json` }; } };
      }
      assert.doesNotMatch(sql, /legal_custom_search_runtime_items/u);
      assert.deepEqual(values, [release.id, identity]);
      return { async all() { return { results: [{ itemKey: identity, canonicalChunkId: "",
        provisionRenditionId: "rendition", textRevisionId: "revision",
        provisionConceptId: "concept", languageTag: "ru", textualAuthority: "controlling",
        validFrom: "2019-01-01T00:00:00.000Z", validTo: "2021-01-01T00:00:00.000Z" }] }; } };
    } };
  } } as unknown as D1Database;
  const packet = parseCandidatePacket({ availability: "available", releaseId: release.id,
    endpoint: { kind: "timestamp", instant: "2020-01-01T00:00:00.000Z" },
    requiredInstanceIds: ["custom-history-staging-v1"], partialErrors: [], candidates: [{ itemKey,
      instanceId: "custom-history-staging-v1", shardId: "history-base-v1", formulationIds: ["formulation"],
      readingIds: ["reading"], retrievalRequirementIds: ["requirement"], vectorRank: 1, vectorScore: 1,
      keywordRank: 1, keywordScore: 1, fusionScore: 1 }] });
  const catalog = createRuntimeCandidateCatalog(db, bucket as never, undefined,
    {membershipProofsEnabled: currentProofsEnabled});
  assert.equal(await catalog.prepareReferencePacket(packet, release), packet,
    "current-only activation must preserve historical reference membership");
  const result = await catalog.revalidate(packet,
    { kind: "timestamp", instant: "2020-01-01T00:00:00.000Z" }, release,
    "2026-09-06T00:00:00.000Z");
  assert.equal(result[0]?.canonicalChunkId, canonicalChunkId);
  const firstReads = reads.length;
  await catalog.revalidate(packet, packet.endpoint, release, "2026-09-06T00:00:00.000Z");
  assert.equal(reads.length, firstReads, "repair reuses authenticated membership within this request");
  const beforePrepared=reads.length;
  const prepared=createRuntimeCandidateCatalog(db,bucket as never,undefined,{preparedMembership:async input=>{
    assert.deepEqual(input,{releaseId:release.id,sourceInventorySha256:mappingInventorySha256,memberCount:1,itemKeys:[canonicalChunkId]});
    return new Map([[canonicalChunkId,{ordinal:0,legalIdentitySha256:identity}]]);
  }});
  assert.deepEqual(await prepared.revalidate(packet,packet.endpoint,release,"2026-09-06T00:00:00.000Z"),result);
  assert.equal(reads.length,beforePrepared,"Verified prepared membership avoids object-directory traversal");
  await assert.rejects(createRuntimeCandidateCatalog(db,bucket as never,undefined,{preparedMembership:async()=>new Map()})
    .revalidate(packet,packet.endpoint,release,"2026-09-06T00:00:00.000Z"),/NOT_IN_PINNED_RELEASE/);
  const corruptKey = useLookup ? [...objects.keys()].find(key => key.includes("/leaf-"))! : pageKey;
  objects.set(corruptKey, {bytes: new TextEncoder().encode("corrupt"), customMetadata: {}});
  await assert.rejects(createRuntimeCandidateCatalog(db, bucket as never, undefined,
    {membershipProofsEnabled: currentProofsEnabled}).revalidate(packet,
    packet.endpoint, release, "2026-09-06T00:00:00.000Z"), /CORRUPT|MISMATCH|MISSING/u);
});
