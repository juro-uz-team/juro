import {z} from "zod";
import {buildCandidateMembershipTree, candidateMembershipMemberSchema, candidateMembershipRootSchema,
  verifyCandidateMembershipProof, candidateMembershipProofSchema, type CandidateMembershipProof} from "./candidate-membership-proof";
import {customCurrentSha256, serializeCustomCurrentArtifact} from "./custom-current-build";
import {searchReleaseIdSchema, sha256Schema} from "./target-domain-schemas";

const ROOT_LIMIT = 256 * 1_024;
const INVENTORY_PAGE_LIMIT = 16 * 1_024 * 1_024;
const referenceSchema = z.object({key: z.string().min(1).max(1_024), sha256: sha256Schema,
  sizeBytes: z.number().int().positive()}).strict();
type Reference = z.infer<typeof referenceSchema>;
const partitionSchema = z.string().regex(/^[0-3][a-f0-9]$/u);
const inventoryMemberSchema = candidateMembershipMemberSchema.extend({legalIdentitySha256: sha256Schema.optional()})
  .superRefine((member, context) => {
    if (member.legalIdentitySha256 && member.legalIdentitySha256 !== member.legalIdentity.legalIdentitySha256) {
      context.addIssue({code: "custom", message: "Accepted member identity hashes must agree"});
    }
  });
export const candidateMembershipProjectionSchema = z.object({
  schemaVersion: z.literal(1), releaseId: searchReleaseIdSchema, inventoryReleaseId: searchReleaseIdSchema,
  sourceInventorySha256: sha256Schema, memberCount: z.number().int().positive().max(2 ** 24),
  partitions: z.array(z.object({partition: partitionSchema, root: candidateMembershipRootSchema}).strict()).min(1).max(64),
}).strict().superRefine((projection, context) => {
  if (new Set(projection.partitions.map(item => item.partition)).size !== projection.partitions.length
    || projection.partitions.reduce((sum, item) => sum + item.root.memberCount, 0) !== projection.memberCount
    || projection.partitions.some(item => item.root.releaseId !== projection.releaseId
      || item.root.sourceInventorySha256 !== projection.sourceInventorySha256)) {
    context.addIssue({code: "custom", message: "Membership projection must preserve the complete accepted inventory"});
  }
});
export type CandidateMembershipProjection = z.infer<typeof candidateMembershipProjectionSchema>;

function partitionFor(itemKey: string): string {
  const match = /^retrieval-chunk-v1:([a-f0-9]{64})$/u.exec(itemKey);
  if (!match) throw new TypeError("MEMBERSHIP_PROJECTION_ITEM_INVALID");
  return Math.floor(Number.parseInt(match[1]!.slice(0, 2), 16) / 4).toString(16).padStart(2, "0");
}

async function readVerified(bucket: Pick<R2Bucket, "get">, reference: Reference, limit: number): Promise<unknown> {
  if (reference.sizeBytes > limit) throw new TypeError("MEMBERSHIP_PROJECTION_ARTIFACT_INVALID");
  const object = await bucket.get(reference.key);
  if (!object || object.size !== reference.sizeBytes) throw new TypeError("MEMBERSHIP_PROJECTION_ARTIFACT_INVALID");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.length !== reference.sizeBytes || await customCurrentSha256(bytes) !== reference.sha256) {
    throw new TypeError("MEMBERSHIP_PROJECTION_ARTIFACT_INVALID");
  }
  return JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
}

/** Trust the accepted publication ledger, never a root supplied by a search hit. */
export async function loadCandidateMembershipProjection(input: {
  db: D1Database; bucket: Pick<R2Bucket, "get">; releaseId: string;
}): Promise<CandidateMembershipProjection | null> {
  const releaseId = searchReleaseIdSchema.parse(input.releaseId);
  const row = await input.db.prepare(`
    SELECT publication.projection_r2_key AS key, publication.projection_sha256 AS sha256,
      publication.projection_size_bytes AS sizeBytes,
      publication.source_inventory_sha256 AS sourceInventorySha256,
      publication.member_count AS memberCount
    FROM legal_candidate_membership_projections publication
    JOIN legal_custom_search_r2_runtime_roots accepted
      ON accepted.search_release_id = publication.search_release_id
      AND accepted.mapping_inventory_sha256 = publication.source_inventory_sha256
      AND accepted.mapping_count = publication.member_count
    WHERE publication.search_release_id = ? AND publication.proof_version = 1
  `).bind(releaseId).first();
  if (!row) return null;
  const publication = referenceSchema.extend({sourceInventorySha256: sha256Schema,
    memberCount: z.number().int().positive().max(2 ** 24)}).parse(row);
  const projection = candidateMembershipProjectionSchema.parse(
    await readVerified(input.bucket, publication, ROOT_LIMIT));
  if (projection.releaseId !== releaseId || projection.sourceInventorySha256 !== publication.sourceInventorySha256
    || projection.memberCount !== publication.memberCount) {
    throw new TypeError("MEMBERSHIP_PROJECTION_ARTIFACT_INVALID");
  }
  return projection;
}

export function candidateMembershipProofKey(projection: CandidateMembershipProjection, itemKey: string): string {
  const partition = projection.partitions.find(item => item.partition === partitionFor(itemKey));
  if (!partition) throw new TypeError("MEMBERSHIP_PROJECTION_MEMBER_MISSING");
  return `search-releases/${projection.releaseId}/runtime/membership-proofs/${partition.root.merkleRoot}/${itemKey}.json`;
}

export async function verifyProjectedCandidateMembership(input: {
  projection: CandidateMembershipProjection; itemKey: string; proof: unknown;
}) {
  const projection = candidateMembershipProjectionSchema.parse(input.projection);
  const partition = projection.partitions.find(item => item.partition === partitionFor(input.itemKey));
  if (!partition) throw new TypeError("MEMBERSHIP_PROJECTION_MEMBER_MISSING");
  return verifyCandidateMembershipProof({root: partition.root, itemKey: input.itemKey, proof: input.proof});
}

export async function readCandidateMembershipProofs(input: {
  bucket: Pick<R2Bucket, "get">; projection: CandidateMembershipProjection; itemKeys: readonly string[];
}): Promise<Map<string, CandidateMembershipProof>> {
  const proofs = new Map<string, CandidateMembershipProof>();
  const keys = [...new Set(input.itemKeys)];
  for (let offset = 0; offset < keys.length; offset += 16) {
    const entries = await Promise.all(keys.slice(offset, offset + 16).map(async itemKey => {
      const object = await input.bucket.get(candidateMembershipProofKey(input.projection, itemKey));
      if (!object || object.size > 64 * 1_024) throw new TypeError("MEMBERSHIP_PROJECTION_ARTIFACT_INVALID");
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.length !== object.size) throw new TypeError("MEMBERSHIP_PROJECTION_ARTIFACT_INVALID");
      const proof = candidateMembershipProofSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
      await verifyProjectedCandidateMembership({projection: input.projection, itemKey, proof});
      return [itemKey, proof] as const;
    }));
    for (const [key, proof] of entries) proofs.set(key, proof);
  }
  return proofs;
}

/** Authenticate one source partition at a time. Partial construction never
 * publishes a manifest; only a fully checked projection can be activated. */
export async function buildCandidateMembershipProjection(input: {
  bucket: Pick<R2Bucket, "get">; releaseId: string; inventoryReleaseId: string;
  sourceInventorySha256: string; expectedMemberCount: number;
  write: (reference: Reference, bytes: Uint8Array) => Promise<void>;
  onProgress?: (progress: {partitions: number; members: number}) => void;
}) {
  const releaseId = searchReleaseIdSchema.parse(input.releaseId);
  const inventoryReleaseId = searchReleaseIdSchema.parse(input.inventoryReleaseId);
  const sourceInventorySha256 = sha256Schema.parse(input.sourceInventorySha256);
  const expectedCount = z.number().int().positive().max(2 ** 24).parse(input.expectedMemberCount);
  const sourceKey = `search-releases/${inventoryReleaseId}/runtime/mappings-${sourceInventorySha256}.json`;
  const source = await input.bucket.get(sourceKey);
  if (!source) throw new TypeError("MEMBERSHIP_PROJECTION_ARTIFACT_INVALID");
  const inventory = z.object({schemaVersion: z.literal(1), releaseId: z.literal(inventoryReleaseId),
    partitions: z.array(referenceSchema.extend({partition: partitionSchema, count: z.number().int().positive()})).min(1).max(64),
  }).strict().parse(await readVerified(input.bucket, {key: sourceKey, sha256: sourceInventorySha256, sizeBytes: source.size}, ROOT_LIMIT));
  if (new Set(inventory.partitions.map(item => item.partition)).size !== inventory.partitions.length
    || inventory.partitions.reduce((sum, item) => sum + item.count, 0) !== expectedCount) {
    throw new TypeError("MEMBERSHIP_PROJECTION_PARITY_INVALID");
  }
  const partitions: CandidateMembershipProjection["partitions"] = [];
  const ordinals = new Set<number>();
  const write = async (key: string, value: unknown) => {
    const bytes = serializeCustomCurrentArtifact(value);
    const reference = {key, sha256: await customCurrentSha256(bytes), sizeBytes: bytes.length};
    await input.write(reference, bytes);
    return reference;
  };
  for (const reference of [...inventory.partitions].sort((left, right) => left.partition.localeCompare(right.partition))) {
    const page = z.object({schemaVersion: z.literal(1), releaseId: z.literal(inventoryReleaseId), partition: z.literal(reference.partition),
      items: z.array(inventoryMemberSchema).length(reference.count),
    }).strict().parse(await readVerified(input.bucket, reference, INVENTORY_PAGE_LIMIT));
    for (const member of page.items) {
      if (partitionFor(member.itemKey) !== reference.partition || ordinals.has(member.ordinal)) {
        throw new TypeError("MEMBERSHIP_PROJECTION_PARITY_INVALID");
      }
      ordinals.add(member.ordinal);
    }
    const members = page.items.map(({itemKey, ordinal, legalIdentity}) => ({itemKey, ordinal, legalIdentity}));
    const tree = await buildCandidateMembershipTree({releaseId, sourceInventorySha256, members});
    partitions.push({partition: reference.partition, root: tree.root});
    for (let offset = 0; offset < page.items.length; offset += 16) {
      await Promise.all(page.items.slice(offset, offset + 16).map(member =>
        write(`search-releases/${releaseId}/runtime/membership-proofs/${tree.root.merkleRoot}/${member.itemKey}.json`, tree.proofFor(member.itemKey))));
    }
    input.onProgress?.({partitions: partitions.length, members: ordinals.size});
  }
  const projection = candidateMembershipProjectionSchema.parse({schemaVersion: 1, releaseId, inventoryReleaseId,
    sourceInventorySha256, memberCount: expectedCount, partitions});
  if (ordinals.size !== expectedCount) throw new TypeError("MEMBERSHIP_PROJECTION_PARITY_INVALID");
  const bytes = serializeCustomCurrentArtifact(projection);
  if (bytes.length > ROOT_LIMIT) throw new TypeError("MEMBERSHIP_PROJECTION_ARTIFACT_INVALID");
  const sha256 = await customCurrentSha256(bytes);
  const reference = await write(`search-releases/${releaseId}/runtime/membership-proofs/manifest-${sha256}.json`, projection);
  return {projection, reference, proofKey: (itemKey: string) => candidateMembershipProofKey(projection, itemKey)};
}
