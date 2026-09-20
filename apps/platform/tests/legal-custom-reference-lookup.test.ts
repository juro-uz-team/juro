import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {DatabaseSync} from "node:sqlite";
import {buildCustomReferenceLookup, legalReferenceKey, resolveCustomReferenceKeys} from "../lib/legal-corpus/custom-reference-lookup";
import {createRuntimeReferenceDiscovery} from "../lib/legal-corpus/runtime-reference-discovery";
import {customRuntimeLegalIdentitySchema} from "../lib/legal-corpus/custom-bm25-runtime";
import {parsePinnedCandidateRelease} from "../lib/legal-corpus/legal-candidate-index";
import {parseRevalidatedCandidates, selectionCandidateSchema} from "../lib/legal-corpus/target-retrieval";

test("reference roots are immutable and bind bounded projection counts", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("PRAGMA foreign_keys=ON; CREATE TABLE legal_search_releases(id TEXT PRIMARY KEY); INSERT INTO legal_search_releases VALUES ('release');");
    db.exec(readFileSync("legal-drizzle/0030_custom_reference_lookup.sql", "utf8"));
    const insert = db.prepare("INSERT INTO legal_custom_search_reference_lookups VALUES (?,?,?,?,?,?,?,?)");
    assert.throws(() => insert.run("release", "a".repeat(64), "lookup", "b".repeat(64), 10, 1, 2, "2026-09-11"));
    assert.throws(() => insert.run("release", "invalid", "lookup", "b".repeat(64), 10, 1, 1, "2026-09-11"));
    insert.run("release", "a".repeat(64), "lookup", "b".repeat(64), 10, 1, 1, "2026-09-11");
    assert.throws(() => db.exec("UPDATE legal_custom_search_reference_lookups SET indexed_member_count=0"), /IMMUTABLE/u);
    assert.throws(() => db.exec("DELETE FROM legal_custom_search_reference_lookups"), /IMMUTABLE/u);
  } finally {db.close();}
});

test("reference discovery preserves all matching members and isolates revisions and languages", async () => {
  const objects = new Map<string, Uint8Array>();
  const reads: string[] = [];
  const releaseId = "release:reference-test";
  const bytes = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value)}\n`);
  const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const members = Array.from({length: 5}, (_, ordinal) => ({
    itemKey: `retrieval-chunk-v1:00${ordinal.toString(16)}${"a".repeat(61)}`, ordinal,
    legalIdentity: {legalIdentitySha256: "a".repeat(64), legalInstrumentId: "instrument:test",
      officialExpressionId: "expression:test", textRevisionId: ordinal === 2 ? "revision:other" : "revision:test",
      provisionConceptId: `concept:${ordinal}`, provisionRenditionId: `rendition:${ordinal}`,
      evidenceProvisionRenditionId: `evidence:${ordinal}`, languageTag: ordinal === 3 ? "en" : "ru", script: "Cyrl",
      textualAuthority: "controlling", validFrom: "2026-01-01T00:00:00.000Z", validTo: null,
      evidence: {r2Key: `evidence/${ordinal}`, byteCount: 100, sha256: "b".repeat(64),
        sourceNormalizedSha256: "c".repeat(64), mediaType: "application/json; charset=utf-8"},
      citation: {label: "Official provision", url: "https://lex.uz/docs/777"}},
  }));
  const original = bytes({schemaVersion: 1, releaseId, partition: "00", items: members});
  objects.set("original", original);
  const root = bytes({schemaVersion: 1, releaseId, partitions: [{partition: "00", count: members.length,
    key: "original", sha256: hash(original), sizeBytes: original.byteLength}]});
  const sourceInventorySha256 = hash(root);
  objects.set(`search-releases/${releaseId}/runtime/mappings-${sourceInventorySha256}.json`, root);
  const bucket = {async get(key: string) {
    reads.push(key);
    const value = objects.get(key);
    return value ? {size: value.byteLength, async arrayBuffer() {return value.slice().buffer;}} : null;
  }} as unknown as R2Bucket;
  const metadataPage = bytes({schemaVersion: 1, kind: "production-current-body-free-metadata-page",
    sourceRootSha256: "d".repeat(64), acceptedInputManifestSha256: "e".repeat(64), sourcePlanManifestSha256: "f".repeat(64),
    start: 0, items: members.map((member, index) => ({sourceOrdinal: index, sourceId: `source:${index}`,
      snapshotProvisionId: `snapshot:${index}`, provisionRenditionId: member.legalIdentity.evidenceProvisionRenditionId,
      language: member.legalIdentity.languageTag, validFrom: member.legalIdentity.validFrom, validTo: null,
      articleNumber: index === 4 ? "unnumbered-4" : "732", articleTitle: null, hierarchy: []}))});
  objects.set("metadata-page", metadataPage);
  const metadataRoot = bytes({schemaVersion: 1, kind: "production-current-body-free-metadata-manifest",
    sourceRootSha256: "d".repeat(64), acceptedInputManifestSha256: "e".repeat(64), sourcePlan: {manifestSha256: "f".repeat(64)},
    itemCount: members.length, pageCount: 1, pages: [{key: "metadata-page", sha256: hash(metadataPage), sizeBytes: metadataPage.byteLength,
      start: 0, count: members.length}]});
  objects.set("metadata-root", metadataRoot);
  const articleMetadata = {bucket, reference: {key: "metadata-root", sha256: hash(metadataRoot), sizeBytes: metadataRoot.byteLength}};
  const built = await buildCustomReferenceLookup({bucket, releaseId, sourceInventorySha256,
    articleMetadata,
    write: async (reference, value) => {objects.set(reference.key, value);}});
  assert.equal(built.memberCount, 5);
  assert.equal(built.indexedMemberCount, 4);
  const queries = [{textRevisionId: "revision:test", languageTag: "ru" as const, article: "732"},
    {textRevisionId: "revision:other", languageTag: "ru" as const, article: "732"},
    {textRevisionId: "revision:test", languageTag: "en" as const, article: "732"}];
  const input = {bucket, releaseId, sourceInventorySha256, reference: built.reference, memberCount: 5, queries};
  reads.length = 0;
  const found = await resolveCustomReferenceKeys(input);
  assert.deepEqual(found.get(legalReferenceKey(queries[0]!)), members.slice(0, 2).map(member => member.itemKey));
  assert.deepEqual(found.get(legalReferenceKey(queries[1]!)), [members[2]!.itemKey]);
  assert.deepEqual(found.get(legalReferenceKey(queries[2]!)), [members[3]!.itemKey]);
  assert.ok(reads.length <= 4 && !reads.includes("original"));
  const identities = new Map(members.map(member => [member.legalIdentity.provisionRenditionId,
    customRuntimeLegalIdentitySchema.parse(member.legalIdentity)]));
  identities.set("rendition:origin", {...identities.get("rendition:0")!, provisionRenditionId: "rendition:origin",
    citation: {label: "Code — Article 17", url: "https://lex.uz/docs/777"}});
  const referring = selectionCandidateSchema.parse({citationLabel: "Code — Article 17",
    provisionText: "The limited grounds are defined by Article 732 of this Code.",
    candidate: {canonicalChunkId: "chunk:origin", provisionRenditionId: "rendition:origin", textRevisionId: "revision:test",
      provisionConceptId: "concept:origin", languageFamily: "ru", textualAuthority: "controlling",
      candidate: {itemKey: `search-releases/${releaseId}/origin`, instanceId: "instance:test", shardId: "shard:test",
        formulationIds: ["formulation:test"], readingIds: ["reading:test"], retrievalRequirementIds: ["requirement:test"],
        vectorRank: 1, vectorScore: 1, keywordRank: 1, keywordScore: 1, fusionScore: 1}}});
  const release = parsePinnedCandidateRelease({id: releaseId, environment: "production", capability: "current",
    instances: [{id: "instance:test", shardId: "shard:test"}], configuration: {identity: "configuration:test",
      embeddingModel: "openai/text-embedding-3-large", dimensions: 1536, keywordTokenizer: "porter",
      metadataSchema: ["language", "document_type", "valid_from", "valid_to"], gatewayIdentity: "gateway:test",
      providerProjectIdentity: "project:test", gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false}});
  let validations = 0;
  let rejectMembership = false;
  const discover = createRuntimeReferenceDiscovery({bucket, identities,
    db: {prepare() {return {bind(value: string) {assert.equal(value, releaseId); return {async first() {return {
      sourceInventorySha256, memberCount: 5, descriptorKey: `search-releases/${releaseId}/runtime/descriptor-${"a".repeat(64)}.json`,
      lookupKey: built.reference.key, lookupSha256: built.reference.sha256, lookupSizeBytes: built.reference.sizeBytes,
    };}};}};}} as unknown as D1Database,
    revalidate: async (packet, endpoint, pinned) => {
      validations++;
      assert.equal(pinned.id, releaseId);
      assert.deepEqual(endpoint, {kind: "current"});
      if (rejectMembership) throw new Error("Not an accepted member");
      return parseRevalidatedCandidates(packet.candidates.map(candidate => {
        const member = members.find(member => candidate.itemKey.endsWith(`/${member.itemKey}`))!;
        assert.deepEqual(candidate.referenceOrigin, {itemKey: referring.candidate.candidate.itemKey, article: "732"});
        assert.equal(candidate.fusionScore, 0);
        return {candidate, canonicalChunkId: member.itemKey, provisionRenditionId: member.legalIdentity.provisionRenditionId,
          textRevisionId: member.legalIdentity.textRevisionId, provisionConceptId: member.legalIdentity.provisionConceptId,
          languageFamily: "ru", textualAuthority: "controlling"};
      }));
    }});
  const discovered = await discover([referring], {kind: "current"}, release, "2026-09-11T00:00:00.000Z");
  assert.equal(validations, 1);
  assert.equal(discovered.candidates.length, 2);
  assert.deepEqual(discovered.unresolved, []);
  const operative = {...referring, citationLabel: "Code — Article 732", provisionText: "Complete substantive grounds of this provision.", candidate: discovered.candidates[0]!};
  assert.deepEqual(await discover([referring, operative], {kind: "current"}, release, "2026-09-11T00:00:00.000Z"), {candidates:[],unresolved:[]});
  assert.equal(validations, 1, "already supplied operative text needs no lookup or revalidation");
  const otherReferring = (suffix: string, article: string) => {
    const candidate = selectionCandidateSchema.parse({...referring,
      provisionText: `The grounds are defined by Article ${article} of this Code.`,
      candidate: {...referring.candidate, provisionRenditionId: `rendition:origin-${suffix}`,
        provisionConceptId: `concept:origin-${suffix}`, candidate: {...referring.candidate.candidate,
          itemKey: `search-releases/${releaseId}/origin-${suffix}`}}});
    identities.set(candidate.candidate.provisionRenditionId, {...identities.get("rendition:origin")!,
      provisionRenditionId: candidate.candidate.provisionRenditionId,
      provisionConceptId: candidate.candidate.provisionConceptId});
    return candidate;
  };
  const repeatedReference = await discover([
    ...["910", "911", "912"].map(article => otherReferring(article, article)),
    referring, otherReferring("second-rule", "732"),
  ], {kind: "current"}, release, "2026-09-11T00:00:00.000Z");
  assert.equal(repeatedReference.candidates.length, 2, "a reference shared by distinct rules must not lose discovery to three earlier incidental references");
  assert.equal(repeatedReference.unresolved.filter(gap=>gap.reason==="lookup_budget").length,1);
  assert.equal(repeatedReference.unresolved.filter(gap=>gap.reason==="reference_not_found").length,2);
  rejectMembership = true;
  await assert.rejects(discover([referring], {kind: "current"}, release, "2026-09-11T00:00:00.000Z"), /Not an accepted member/u);
  rejectMembership = false;
  const acceptedIdentity = identities.get("rendition:0")!;
  identities.set("rendition:0", {...acceptedIdentity, legalInstrumentId: "instrument:foreign"});
  await assert.rejects(discover([referring], {kind: "current"}, release, "2026-09-11T00:00:00.000Z"), /IDENTITY_MISMATCH/u);
  identities.set("rendition:0", acceptedIdentity);
  await assert.rejects(resolveCustomReferenceKeys({...input, memberCount: 6}), /BINDING_INVALID/u);
  await assert.rejects(resolveCustomReferenceKeys({...input, releaseId: "release:other"}), /BINDING_INVALID/u);
  await assert.rejects(resolveCustomReferenceKeys({...input, sourceInventorySha256: "f".repeat(64)}), /BINDING_INVALID/u);
  await assert.rejects(resolveCustomReferenceKeys({...input, queries: [...queries, queries[0]!]}));
  const pageKey = reads.find(key => key.includes("/page-"))!;
  const corrupted = objects.get(pageKey)!.slice();
  corrupted[corrupted.length - 1] ^= 1;
  objects.set(pageKey, corrupted);
  await assert.rejects(resolveCustomReferenceKeys(input), /CORRUPT/u);
  objects.set("original", new Uint8Array(original.byteLength));
  await assert.rejects(buildCustomReferenceLookup({bucket, releaseId, sourceInventorySha256,
    write: async () => assert.fail("corrupt original must not produce a projection")}), /CORRUPT/u);
});
