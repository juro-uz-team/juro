import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {buildCandidateMembershipTree, verifyCandidateMembershipProof, candidateMembershipRootSchema} from "../lib/legal-corpus/candidate-membership-proof";
import {customRuntimeLegalIdentitySchema} from "../lib/legal-corpus/custom-bm25-runtime";
import {buildCandidateMembershipProjection, verifyProjectedCandidateMembership, readCandidateMembershipProofs} from "../lib/legal-corpus/candidate-membership-projection";
import {createRuntimeCandidateCatalog} from "../lib/legal-corpus/target-runtime";
import {createProviderCandidateIndex, parseCandidatePacket, parsePinnedCandidateRelease} from "../lib/legal-corpus/legal-candidate-index";

const releaseId = "release:membership-proof";
const sourceInventorySha256 = "a".repeat(64);
const members = Array.from({length: 3}, (_, ordinal) => ({
  itemKey: `retrieval-chunk-v1:${String(ordinal).padStart(64, "0")}`, ordinal,
  legalIdentity: customRuntimeLegalIdentitySchema.parse({legalIdentitySha256: "b".repeat(64),
    legalInstrumentId: "instrument:proof", officialExpressionId: "expression:proof", textRevisionId: "revision:proof",
    provisionConceptId: `concept:${ordinal}`, provisionRenditionId: `rendition:${ordinal}`,
    evidenceProvisionRenditionId: `evidence:${ordinal}`, languageTag: "ru", script: "Cyrl", textualAuthority: "official_translation",
    validFrom: "2020-01-01T00:00:00.000Z", validTo: null,
    evidence: {r2Key: `evidence/${ordinal}`, byteCount: 100, sha256: "c".repeat(64), sourceNormalizedSha256: "d".repeat(64),
      mediaType: "application/json; charset=utf-8"}, citation: {label: "Official provision", url: "https://lex.uz/docs/777"}}),
}));

test("release-bound proofs preserve every accepted identity independently of construction order", async () => {
  const input = {releaseId, sourceInventorySha256, members};
  const tree = await buildCandidateMembershipTree(input);
  const reordered = await buildCandidateMembershipTree({...input, members: [...members].reverse()});
  assert.deepEqual(tree.root, reordered.root);
  for (const member of members) {
    const proof = tree.proofFor(member.itemKey);
    assert.deepEqual(await verifyCandidateMembershipProof({root: tree.root, proof, itemKey: member.itemKey}), member);
  }
  assert.throws(() => tree.proofFor("unknown"), /MEMBERSHIP_PROOF_MEMBER_MISSING/u);
});

test("corrupt or cross-release proofs cannot authenticate any changed legal identity", async () => {
  const tree = await buildCandidateMembershipTree({releaseId, sourceInventorySha256, members});
  const original = tree.proofFor(members[0]!.itemKey);
  for (const root of [{...tree.root, releaseId: "release:other"}, {...tree.root, sourceInventorySha256: "e".repeat(64)},
    {...tree.root, memberCount: 4}, {...tree.root, merkleRoot: "f".repeat(64)}]) {
    await assert.rejects(verifyCandidateMembershipProof({root: candidateMembershipRootSchema.parse(root), proof: original, itemKey: original.member.itemKey}));
  }
  for (const mutate of [
    (proof: typeof original) => {proof.member.legalIdentity.textRevisionId = "revision:other";},
    (proof: typeof original) => {proof.member.legalIdentity.languageTag = "en";},
    (proof: typeof original) => {proof.member.legalIdentity.evidence.sha256 = "e".repeat(64);},
    (proof: typeof original) => {proof.member.legalIdentity.validTo = "2021-01-01T00:00:00.000Z";},
    (proof: typeof original) => {proof.member.ordinal += 1;},
    (proof: typeof original) => {proof.siblings.pop();},
    (proof: typeof original) => {proof.siblings[0] = "e".repeat(64);},
  ]) {
    const proof = structuredClone(original);
    mutate(proof);
    await assert.rejects(verifyCandidateMembershipProof({root: tree.root, proof, itemKey: original.member.itemKey}));
  }
  await assert.rejects(verifyCandidateMembershipProof({root: tree.root, proof: original, itemKey: members[1]!.itemKey}));
  await assert.rejects(verifyCandidateMembershipProof({root: tree.root, proof: null, itemKey: original.member.itemKey}));
});

test("single-member inventories work while duplicate keys or ordinals cannot publish a root", async () => {
  const tree = await buildCandidateMembershipTree({releaseId, sourceInventorySha256, members: [members[0]!]});
  const proof = tree.proofFor(members[0]!.itemKey);
  assert.deepEqual(proof.siblings, []);
  assert.deepEqual(await verifyCandidateMembershipProof({root: tree.root, proof, itemKey: proof.member.itemKey}), members[0]);
  for (const invalid of [[], [members[0]!, members[0]!], [members[0]!, {...members[1]!, ordinal: members[0]!.ordinal}]]) {
    await assert.rejects(buildCandidateMembershipTree({releaseId, sourceInventorySha256, members: invalid}));
  }
});

test("proof projection authenticates the accepted source inventory before publishing its manifest", async () => {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const digest = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const page = bytes({schemaVersion: 1, releaseId, partition: "00", items: members.map(member => ({...member,
    legalIdentitySha256: member.legalIdentity.legalIdentitySha256}))});
  const inventory = bytes({schemaVersion: 1, releaseId, partitions: [{partition: "00", count: 3,
    key: "accepted-page", sha256: digest(page), sizeBytes: page.length}]});
  const inventoryHash = digest(inventory);
  const inventoryKey = `search-releases/${releaseId}/runtime/mappings-${inventoryHash}.json`;
  const objects = new Map<string, Uint8Array>([["accepted-page", page], [inventoryKey, inventory]]);
  const writes: string[] = [];
  const bucket = {async get(key: string) {
    const value = objects.get(key);
    return value ? {size: value.length, async arrayBuffer() {return value.slice().buffer;}} : null;
  }} as unknown as R2Bucket;
  const built = await buildCandidateMembershipProjection({bucket, releaseId, inventoryReleaseId: releaseId,
    sourceInventorySha256: inventoryHash, expectedMemberCount: 3,
    write: async (reference, value) => {writes.push(reference.key); objects.set(reference.key, value);}});
  assert.equal(built.projection.memberCount, 3);
  assert.equal(writes.at(-1), built.reference.key, "The manifest is published only after complete parity");
  for (const member of members) {
    const proof = JSON.parse(new TextDecoder().decode(objects.get(built.proofKey(member.itemKey))!));
    assert.deepEqual(await verifyProjectedCandidateMembership({projection: built.projection, itemKey: member.itemKey, proof}), member);
  }
  const proofs = await readCandidateMembershipProofs({bucket, projection: built.projection, itemKeys: members.map(member => member.itemKey)});
  assert.equal(proofs.size, members.length);
  const corruptKey = built.proofKey(members[0]!.itemKey);
  const originalProofBytes = objects.get(corruptKey)!;
  objects.set(corruptKey, objects.get(built.proofKey(members[1]!.itemKey))!);
  await assert.rejects(readCandidateMembershipProofs({bucket, projection: built.projection, itemKeys: [members[0]!.itemKey]}));
  objects.delete(corruptKey);
  await assert.rejects(readCandidateMembershipProofs({bucket, projection: built.projection, itemKeys: [members[0]!.itemKey]}));
  objects.set(corruptKey, originalProofBytes);
  const proofCount = writes.length;
  objects.set("accepted-page", bytes({schemaVersion: 1, releaseId, partition: "00", items: [members[0]]}));
  await assert.rejects(buildCandidateMembershipProjection({bucket, releaseId, inventoryReleaseId: releaseId,
    sourceInventorySha256: inventoryHash, expectedMemberCount: 3,
    write: async reference => {writes.push(reference.key);}}), /MEMBERSHIP_PROJECTION_ARTIFACT_INVALID/u);
  assert.equal(writes.length, proofCount);
});

test("search proofs survive fusion and authenticate the packet without membership leaf reads", async () => {
  const tree = await buildCandidateMembershipTree({releaseId, sourceInventorySha256, members});
  const projection = {schemaVersion: 1, releaseId, inventoryReleaseId: releaseId, sourceInventorySha256,
    memberCount: members.length, partitions: [{partition: "00", root: tree.root}]};
  const bytes = new TextEncoder().encode(JSON.stringify(projection));
  let reads = 0;
  const bucket = {async get(key: string) {
    const member = members.find(item => key === `search-releases/${releaseId}/runtime/membership-proofs/${tree.root.merkleRoot}/${item.itemKey}.json`);
    const body = member ? new TextEncoder().encode(JSON.stringify(tree.proofFor(member.itemKey))) : bytes;
    if (!member) {assert.equal(key, "trusted-projection"); reads++;}
    return {size: body.length, async arrayBuffer() {return body.slice().buffer;}};
  }} as unknown as R2Bucket;
  const db = {prepare(sql: string) {assert.match(sql, /FROM legal_candidate_membership_projections/u);
    return {bind(id: string) {assert.equal(id, releaseId); return {async first() {return {
      key: "trusted-projection", sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length,
      sourceInventorySha256, memberCount: members.length,
    };}};}};}} as unknown as D1Database;
  const release = parsePinnedCandidateRelease({id: releaseId, environment: "development", capability: "current",
    instances: [{id: "instance", shardId: "shard"}], configuration: {identity: "config",
      embeddingModel: "openai/text-embedding-3-large", dimensions: 1536, keywordTokenizer: "porter",
      metadataSchema: ["language", "document_type", "valid_from", "valid_to"], gatewayIdentity: "gateway",
      providerProjectIdentity: "project", gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false}});
  let corruptDuplicate = false;
  let searchCount = 0;
  const index = createProviderCandidateIndex({async attest() {return release.configuration;}, async search() {
    searchCount++;
    return {searchedInstanceIds: ["instance"], errors: [], hits: members.map(member => ({
      itemKey: `search-releases/${releaseId}/${member.itemKey}`, instanceId: "instance", shardId: "shard",
      vectorRank: 1, keywordRank: 1, vectorScore: 1, keywordScore: 1, fusionScore: 1,
      membershipProof: corruptDuplicate && searchCount % 2 === 0
        ? {...tree.proofFor(member.itemKey), leafIndex: 100} : tree.proofFor(member.itemKey),
    }))};
  }}, {});
  const packet = await index.retrieve({id: "plan", formulations: ["first", "second"].map(id => ({id, text: id,
    readingIds: ["reading"], requirementIds: [id], privateNameSpans: []}))}, {kind: "current"}, release);
  assert.equal(packet.availability, "available");
  assert.deepEqual(packet.candidates[0]!.membershipProof, tree.proofFor(members[0]!.itemKey));
  const catalog = createRuntimeCandidateCatalog(db, bucket, undefined, {membershipProofsEnabled: true});
  for (let run = 0; run < 2; run++) {
    const validated = await catalog.revalidate(packet, {kind: "current"}, release, "2026-09-11T00:00:00.000Z");
    assert.deepEqual(validated.map(item => item.provisionRenditionId), members.map(member => member.legalIdentity.provisionRenditionId));
  }
  assert.equal(reads, 1, "Only the trusted manifest is read, once per answer catalog");
  for (const mutate of [
    (value: typeof packet) => {value.candidates[0]!.membershipProof = undefined;},
    (value: typeof packet) => {value.candidates[0]!.membershipProof!.member.legalIdentity.textRevisionId = "wrong-revision";},
    (value: typeof packet) => {value.partialErrors = [{code: "CANDIDATE_PARTIAL_RESPONSE"}];},
    (value: typeof packet) => {value.requiredInstanceIds = [];},
  ]) {
    const corrupted = structuredClone(packet); mutate(corrupted);
    await assert.rejects(catalog.revalidate(corrupted, {kind: "current"}, release, "2026-09-11T00:00:00.000Z"));
  }
  assert.equal(reads, 1, "Invalid proofs cannot fall back to old membership or evidence reads");
  assert.equal(parseCandidatePacket(packet).candidates.length, members.length);
  const referencePacket = structuredClone(packet);
  referencePacket.candidates = [{...packet.candidates[0]!, itemKey: packet.candidates[1]!.itemKey,
    referenceOrigin: {itemKey: packet.candidates[0]!.itemKey, article: "2"}}];
  const provenReference = await catalog.prepareReferencePacket(referencePacket, release);
  assert.deepEqual(provenReference.candidates[0]!.membershipProof, tree.proofFor(members[1]!.itemKey));
  const reference = await catalog.revalidate(provenReference, {kind: "current"}, release, "2026-09-11T00:00:00.000Z");
  assert.equal(reference[0]!.provisionRenditionId, members[1]!.legalIdentity.provisionRenditionId);
  assert.equal(reads, 1, "Reference proofs share the answer's trusted root");
  corruptDuplicate = true;
  const conflicting = await index.retrieve({id: "plan", formulations: ["first", "second"].map(id => ({id, text: id,
    readingIds: ["reading"], requirementIds: [id], privateNameSpans: []}))}, {kind: "current"}, release);
  assert.equal(conflicting.availability, "unavailable", "Fusion cannot hide a conflicting proof behind a duplicate hit");
});
