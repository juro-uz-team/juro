import {z} from "zod";
import {customRuntimeLegalIdentitySchema} from "./custom-bm25-runtime";
import {customCurrentSha256, serializeCustomCurrentArtifact} from "./custom-current-build";
import {searchReleaseIdSchema, sha256Schema} from "./target-domain-schemas";

const MAX_MEMBERS = 2 ** 24;
export const candidateMembershipMemberSchema = z.object({
  itemKey: z.string().regex(/^retrieval-chunk-v1:[a-f0-9]{64}$/u),
  ordinal: z.number().int().nonnegative().safe(),
  legalIdentity: customRuntimeLegalIdentitySchema,
}).strict();
export type CandidateMembershipMember = z.infer<typeof candidateMembershipMemberSchema>;
export const candidateMembershipRootSchema = z.object({
  schemaVersion: z.literal(1), releaseId: searchReleaseIdSchema, sourceInventorySha256: sha256Schema,
  memberCount: z.number().int().positive().max(MAX_MEMBERS), merkleRoot: sha256Schema,
}).strict();
export const candidateMembershipProofSchema = z.object({
  schemaVersion: z.literal(1), leafIndex: z.number().int().nonnegative().max(MAX_MEMBERS - 1),
  member: candidateMembershipMemberSchema, siblings: z.array(sha256Schema).max(24),
}).strict();
export type CandidateMembershipRoot = z.infer<typeof candidateMembershipRootSchema>;
export type CandidateMembershipProof = z.infer<typeof candidateMembershipProofSchema>;

const hash = (value: unknown) => customCurrentSha256(serializeCustomCurrentArtifact(value));
const leafHash = (root: Pick<CandidateMembershipRoot, "releaseId" | "sourceInventorySha256" | "memberCount">,
  index: number, member: CandidateMembershipMember) =>
  hash(["candidate-membership-leaf-v1", root.releaseId, root.sourceInventorySha256, root.memberCount, index, member]);
const parentHash = (left: string, right: string) => hash(["candidate-membership-node-v1", left, right]);

async function hashes(count: number, operation: (index: number) => Promise<string>): Promise<string[]> {
  const result: string[] = [];
  for (let start = 0; start < count; start += 64) {
    result.push(...await Promise.all(Array.from({length: Math.min(64, count - start)}, (_, offset) => operation(start + offset))));
  }
  return result;
}

/** Construction runs over a previously authenticated complete inventory. The
 * returned root is a projection, not permission to trust arbitrary input. The
 * release publisher must attest inventory parity before activating that root. */
export async function buildCandidateMembershipTree(input: {
  releaseId: string; sourceInventorySha256: string; members: readonly CandidateMembershipMember[];
}) {
  const identity = {releaseId: searchReleaseIdSchema.parse(input.releaseId),
    sourceInventorySha256: sha256Schema.parse(input.sourceInventorySha256), memberCount: input.members.length};
  const members = z.array(candidateMembershipMemberSchema).min(1).max(MAX_MEMBERS).parse(input.members)
    .sort((left, right) => left.itemKey < right.itemKey ? -1 : left.itemKey > right.itemKey ? 1 : 0);
  const indexes = new Map(members.map((member, index) => [member.itemKey, index]));
  if (indexes.size !== members.length || new Set(members.map(member => member.ordinal)).size !== members.length) {
    throw new TypeError("MEMBERSHIP_PROOF_DUPLICATE_IDENTITY");
  }
  const levels = [await hashes(members.length, index => leafHash(identity, index, members[index]!))];
  while (levels.at(-1)!.length > 1) {
    const previous = levels.at(-1)!;
    levels.push(await hashes(Math.ceil(previous.length / 2), index => parentHash(previous[index * 2]!, previous[index * 2 + 1] ?? previous[index * 2]!)));
  }
  const root = candidateMembershipRootSchema.parse({schemaVersion: 1, ...identity,
    memberCount: members.length, merkleRoot: levels.at(-1)![0]});
  return {root, proofFor(itemKey: string): CandidateMembershipProof {
    const leafIndex = indexes.get(itemKey);
    if (leafIndex === undefined) throw new TypeError("MEMBERSHIP_PROOF_MEMBER_MISSING");
    const siblings: string[] = [];
    let position = leafIndex;
    for (const level of levels.slice(0, -1)) {
      siblings.push(level[position ^ 1] ?? level[position]!);
      position = Math.floor(position / 2);
    }
    return candidateMembershipProofSchema.parse({schemaVersion: 1, leafIndex, member: members[leafIndex], siblings});
  }};
}

/** The root comes from the pinned release's accepted projection, never the
 * candidate packet. Invalid proofs cannot fall back to unauthenticated data. */
export async function verifyCandidateMembershipProof(input: {root: CandidateMembershipRoot; proof: unknown; itemKey: string}): Promise<CandidateMembershipMember> {
  const root = candidateMembershipRootSchema.parse(input.root);
  const proof = candidateMembershipProofSchema.parse(input.proof);
  if (proof.member.itemKey !== input.itemKey || proof.leafIndex >= root.memberCount
    || proof.siblings.length !== Math.ceil(Math.log2(root.memberCount))) {
    throw new TypeError("MEMBERSHIP_PROOF_IDENTITY_MISMATCH");
  }
  let current = await leafHash(root, proof.leafIndex, proof.member);
  let position = proof.leafIndex;
  let width = root.memberCount;
  for (const sibling of proof.siblings) {
    if (position % 2 === 0 && position + 1 === width && sibling !== current) {
      throw new TypeError("MEMBERSHIP_PROOF_INVALID");
    }
    current = position % 2 ? await parentHash(sibling, current) : await parentHash(current, sibling);
    position = Math.floor(position / 2);
    width = Math.ceil(width / 2);
  }
  if (current !== root.merkleRoot) throw new TypeError("MEMBERSHIP_PROOF_INVALID");
  return proof.member;
}
