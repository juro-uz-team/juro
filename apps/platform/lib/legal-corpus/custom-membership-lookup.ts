import { z } from "zod";
import { customCurrentSha256, serializeCustomCurrentArtifact } from "./custom-current-build";
import { customRuntimeLegalIdentitySchema } from "./custom-bm25-runtime";
import { CustomRuntimeCache } from "./custom-runtime-cache";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const referenceSchema = z.object({key: z.string().min(1).max(1_024),
  sha256: digest, sizeBytes: z.number().int().positive()}).strict();
const partitionReferenceSchema = referenceSchema.extend({partition: z.string(), count: z.number().int().positive()});
const memberSchema = z.object({itemKey: z.string().min(1).max(700), ordinal: z.number().int().nonnegative(),
  legalIdentitySha256: digest.optional(), legalIdentity: customRuntimeLegalIdentitySchema.optional()}).strict();
type Member = z.infer<typeof memberSchema>;
type Reference = z.infer<typeof referenceSchema>;
type PartitionReference = z.infer<typeof partitionReferenceSchema>;
type Bucket = Pick<R2Bucket, "get">;
const ROOT_LIMIT = 256 * 1_024;
const DIRECTORY_LIMIT = 512 * 1_024;
const SOURCE_PAGE_LIMIT = 64 * 1_024 * 1_024;
const LEAF_LIMIT = 512 * 1_024;
const LOOKUP_READERS = 16;
const directoryProjections = new WeakMap<Bucket, CustomRuntimeCache>();

async function forEachLookupPage<T>(items: readonly T[], visit: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  let failed = false;
  // Workers queue excess requests awaiting headers. After headers arrive,
  // small bounded bodies can overlap; a fixed six-item batch unnecessarily
  // holds the whole queue behind its slowest body. At most 8 MiB of leaf
  // response bytes are in flight here, independent of candidate count.
  const workers = await Promise.allSettled(Array.from({length: Math.min(LOOKUP_READERS, items.length)}, async () => {
    try {
      while (!failed && next < items.length) await visit(items[next++]!);
    } catch (error) { failed = true; throw error; }
  }));
  const failure = workers.find((worker): worker is PromiseRejectedResult => worker.status === "rejected");
  if (failure) throw failure.reason;
}

async function readVerifiedBytes(bucket: Bucket, reference: Reference, limit: number): Promise<Uint8Array> {
  if (reference.sizeBytes > limit) throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_SIZE_INVALID");
  const object = await bucket.get(reference.key);
  if (!object || object.size !== reference.sizeBytes) throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_MISSING");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== reference.sizeBytes || await customCurrentSha256(bytes) !== reference.sha256) {
    throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_CORRUPT");
  }
  return bytes;
}

const parseBytes = (bytes: Uint8Array): unknown => JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
async function readVerified(bucket: Bucket, reference: Reference, limit: number): Promise<unknown> {
  return parseBytes(await readVerifiedBytes(bucket, reference, limit));
}

function packDirectory(pages: readonly PartitionReference[], slots: number): Uint8Array {
  // JSON escaping preserves every accepted JS string, including isolated
  // surrogate code units that a direct UTF-8 encoding would replace.
  const keys = pages.map(page => new TextEncoder().encode(JSON.stringify(page.key)));
  const bytes = new Uint8Array(slots * 4 + keys.reduce((sum, key) => sum + 50 + key.length, 0));
  const view = new DataView(bytes.buffer);
  let offset = slots * 4;
  pages.forEach((page, index) => {
    const key = keys[index]!;
    view.setUint32((Number.parseInt(page.partition, 16) % slots) * 4, offset, true);
    view.setUint16(offset, key.length, true);
    for (let index = 0; index < 32; index++) bytes[offset + 2 + index] = Number.parseInt(page.sha256.slice(index * 2, index * 2 + 2), 16);
    view.setFloat64(offset + 34, page.sizeBytes, true);
    view.setFloat64(offset + 42, page.count, true);
    bytes.set(key, offset + 50);
    offset += 50 + key.length;
  });
  return bytes;
}

function directoryPage(bytes: Uint8Array, slots: number, partition: string): PartitionReference | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = view.getUint32((Number.parseInt(partition, 16) % slots) * 4, true);
  if (!offset) return;
  return {partition, key: JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes.subarray(offset + 50, offset + 50 + view.getUint16(offset, true)))) as string,
    sha256: Array.from(bytes.subarray(offset + 2, offset + 34), byte => byte.toString(16).padStart(2, "0")).join(""),
    sizeBytes: view.getFloat64(offset + 34, true), count: view.getFloat64(offset + 42, true)};
}

async function memberPrefix(itemKey: string, length: number): Promise<string> {
  return (/^retrieval-chunk-v1:([a-f0-9]{64})$/u.exec(itemKey)?.[1]
    ?? await customCurrentSha256(itemKey)).slice(0, length);
}

function parentPartition(prefix: string): string {
  return Math.floor(Number.parseInt(prefix.slice(0, 2), 16) / 4).toString(16).padStart(2, "0");
}

function references(value: PartitionReference[], pattern: RegExp): Map<string, PartitionReference> {
  const result = new Map(value.map(item => [item.partition, item]));
  if (result.size !== value.length || value.some(item => !pattern.test(item.partition))) {
    throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_PARTITIONS_INVALID");
  }
  return result;
}

/** Derive a complete, immutable point-lookup layout from the accepted mapping
 * inventory. Every legacy byte is authenticated before its members are copied;
 * source objects, legal identities, ordinals and embeddings remain untouched. */
export async function buildCustomMembershipLookup(input: {
  bucket: Bucket; releaseId: string; sourceInventorySha256: string;
  write: (reference: Reference, bytes: Uint8Array) => Promise<void>;
  onProgress?: (progress: {partitions: number; members: number}) => void;
}): Promise<{reference: Reference; memberCount: number; sourceInventorySha256: string}> {
  const sourceSha = digest.parse(input.sourceInventorySha256);
  const sourceKey = `search-releases/${input.releaseId}/runtime/mappings-${sourceSha}.json`;
  const rootObject = await input.bucket.get(sourceKey);
  await rootObject?.body?.cancel();
  if (!rootObject || rootObject.size > ROOT_LIMIT) throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_SOURCE_MISSING");
  const root = z.object({schemaVersion: z.literal(1), releaseId: z.literal(input.releaseId),
    partitions: z.array(partitionReferenceSchema).max(64)}).strict().parse(await readVerified(input.bucket,
    {key: sourceKey, sha256: sourceSha, sizeBytes: rootObject.size}, ROOT_LIMIT));
  const sourcePages = references(root.partitions, /^[0-3][a-f0-9]$/u);
  const directories: PartitionReference[] = [];
  let memberCount = 0;
  const ordinals = new Set<number>();
  const write = async (kind: string, value: unknown): Promise<Reference> => {
    const bytes = serializeCustomCurrentArtifact(value);
    const sha256 = await customCurrentSha256(bytes);
    const reference = {key: `search-releases/${input.releaseId}/runtime/membership-lookup/${kind}-${sha256}.json`,
      sha256, sizeBytes: bytes.byteLength};
    const limit = kind.startsWith("leaf-") ? LEAF_LIMIT : kind.startsWith("directory-") ? DIRECTORY_LIMIT : ROOT_LIMIT;
    if (bytes.byteLength > limit) {
      throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_SIZE_INVALID");
    }
    await input.write(reference, bytes);
    return reference;
  };
  for (const [partition, reference] of sourcePages) {
    const page = z.object({schemaVersion: z.literal(1), releaseId: z.literal(input.releaseId),
      partition: z.literal(partition), items: z.array(memberSchema).length(reference.count)}).strict()
      .parse(await readVerified(input.bucket, reference, SOURCE_PAGE_LIMIT));
    const groups = new Map<string, Member[]>();
    const keys = new Set<string>();
    for (const member of page.items) {
      const prefix = await memberPrefix(member.itemKey, 4);
      if (parentPartition(prefix) !== partition || keys.has(member.itemKey) || ordinals.has(member.ordinal)) {
        throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_SOURCE_IDENTITY_INVALID");
      }
      keys.add(member.itemKey);
      ordinals.add(member.ordinal);
      const group = groups.get(prefix) ?? [];
      group.push(member);
      groups.set(prefix, group);
    }
    const leaves: PartitionReference[] = [];
    const groupsList = [...groups].sort(([left], [right]) => left.localeCompare(right));
    for (let offset = 0; offset < groupsList.length; offset += 8) {
      leaves.push(...await Promise.all(groupsList.slice(offset, offset + 8).map(async ([prefix, items]) => ({
        ...await write(`leaf-${prefix}`, {schemaVersion: 3, releaseId: input.releaseId, partition: prefix, items}),
        partition: prefix, count: items.length,
      }))));
    }
    directories.push({...await write(`directory-${partition}`, {schemaVersion: 3, releaseId: input.releaseId,
      partition, pages: leaves}), partition, count: page.items.length});
    memberCount += page.items.length;
    input.onProgress?.({partitions: directories.length, members: memberCount});
  }
  const reference = await write("manifest", {schemaVersion: 3, releaseId: input.releaseId,
    sourceInventorySha256: sourceSha, memberCount, partitions: directories});
  return {reference, memberCount, sourceInventorySha256: sourceSha};
}

/** The accepted catalog lookup root binds this layout to the original inventory.
 * All directory and leaf bytes still require their parent's exact hash. */
type LookupInput = {
  bucket: Bucket; releaseId: string; sourceInventorySha256: string; reference: Reference;
  itemKeys: readonly string[];
};

export function createCustomMembershipLookupReader(bucket: Bucket) {
  const directoryCache = new Map<string, Uint8Array>();
  let cachedBytes = 0;
  const readDirectory: typeof readVerifiedBytes = async (binding, reference, limit) => {
    const identity = `${reference.key}:${reference.sha256}:${reference.sizeBytes}`;
    if (directoryCache.has(identity)) return directoryCache.get(identity)!;
    const value = await readVerifiedBytes(binding, reference, limit);
    if (cachedBytes + reference.sizeBytes <= 2 * 1_024 * 1_024) {
      directoryCache.set(identity, value);
      cachedBytes += reference.sizeBytes;
    }
    return value;
  };
  return (input: Omit<LookupInput, "bucket">) => resolveMembershipLookup({...input, bucket}, readDirectory);
}

export function resolveCustomMembershipLookup(input: LookupInput) {
  return resolveMembershipLookup(input, readVerifiedBytes);
}

async function resolveMembershipLookup(input: LookupInput, readDirectory: typeof readVerifiedBytes): Promise<Map<string, {ordinal: number; legalIdentitySha256: string | null;
  legalIdentity?: z.infer<typeof customRuntimeLegalIdentitySchema>}>> {
  const root = z.object({schemaVersion: z.union([z.literal(2), z.literal(3)]), releaseId: z.literal(input.releaseId),
    sourceInventorySha256: z.literal(input.sourceInventorySha256), memberCount: z.number().int().positive(),
    partitions: z.array(partitionReferenceSchema).max(64)}).strict()
    .parse(parseBytes(await readDirectory(input.bucket, input.reference, ROOT_LIMIT)));
  const roots = references(root.partitions, /^[0-3][a-f0-9]$/u);
  if (root.partitions.reduce((sum, page) => sum + page.count, 0) !== root.memberCount) {
    throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_COUNT_INVALID");
  }
  const requested = new Map<string, string[]>();
  for (const key of new Set(input.itemKeys)) {
    const prefix = await memberPrefix(key, root.schemaVersion === 2 ? 3 : 4);
    const group = requested.get(prefix) ?? [];
    group.push(key);
    requested.set(prefix, group);
  }
  const parentIds = [...new Set([...requested.keys()].map(parentPartition))];
  const leaves = new Map<string, PartitionReference>();
  let projections = directoryProjections.get(input.bucket);
  if (!projections) {
    projections = new CustomRuntimeCache(32 * 1024 * 1024);
    directoryProjections.set(input.bucket, projections);
  }
  await forEachLookupPage(parentIds, async partition => {
      const reference = roots.get(partition);
      if (!reference) return;
      // A new request must authenticate the physical bytes even on a projection
      // hit. The shared cache avoids parsing only; it cannot hide corruption.
      const bytes = await readDirectory(input.bucket, reference, root.schemaVersion === 2 ? ROOT_LIMIT : DIRECTORY_LIMIT);
      const cacheKey = JSON.stringify([reference.key, reference.sha256, reference.sizeBytes,
        input.releaseId, root.schemaVersion, partition, reference.count]);
      const slots = root.schemaVersion === 2 ? 64 : 1024;
      let projection = projections!.get(cacheKey);
      if (!projection) {
      const directory = z.object({schemaVersion: z.literal(root.schemaVersion), releaseId: z.literal(input.releaseId),
        partition: z.literal(partition), pages: z.array(partitionReferenceSchema).max(root.schemaVersion === 2 ? 64 : 1024)}).strict()
        .parse(parseBytes(bytes));
      references(directory.pages, root.schemaVersion === 2 ? /^[a-f0-9]{3}$/u : /^[a-f0-9]{4}$/u);
      if (directory.pages.some(page => parentPartition(page.partition) !== partition)
        || directory.pages.reduce((sum, page) => sum + page.count, 0) !== reference.count) {
        throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_COUNT_INVALID");
      }
      projection = packDirectory(directory.pages, slots);
      projections!.put(cacheKey, projection);
      }
      for (const prefix of requested.keys()) if (parentPartition(prefix) === partition) {
        const page = directoryPage(projection, slots, prefix);
        if (page) leaves.set(prefix, page);
      }
  });
  const result = new Map<string, {ordinal: number; legalIdentitySha256: string | null;
    legalIdentity?: z.infer<typeof customRuntimeLegalIdentitySchema>}>();
  const groups = [...requested];
  await forEachLookupPage(groups, async ([partition, keys]) => {
      const reference = leaves.get(partition);
      if (!reference) return;
      const page = z.object({schemaVersion: z.literal(root.schemaVersion), releaseId: z.literal(input.releaseId),
        partition: z.literal(partition), items: z.array(memberSchema).length(reference.count)}).strict()
        .parse(await readVerified(input.bucket, reference, LEAF_LIMIT));
      const members = new Map(page.items.map(member => [member.itemKey, member]));
      if (members.size !== page.items.length) throw new TypeError("CUSTOM_MEMBERSHIP_LOOKUP_DUPLICATE");
      for (const key of keys) {
        const member = members.get(key);
        if (member) result.set(key, {ordinal: member.ordinal,
          legalIdentitySha256: member.legalIdentitySha256 ?? member.legalIdentity?.legalIdentitySha256 ?? null,
          ...(member.legalIdentity ? {legalIdentity: member.legalIdentity} : {})});
      }
  });
  console.info(JSON.stringify({event: "legal_membership_lookup_resolved", requestedItems: input.itemKeys.length,
    directories: parentIds.length, leaves: leaves.size,
    leafBytes: [...leaves.values()].reduce((sum, page) => sum + page.sizeBytes, 0)}));
  return result;
}
