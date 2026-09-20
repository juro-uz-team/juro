import { createHash } from "node:crypto";
import { z } from "zod";
import { detectArticleNumbers } from "../legal/legal-language";

import {
  analyzeCustomWordTerms,
  customBm25TermHash,
  scoreCustomBm25Term,
  type CustomBm25Manifest,
} from "./custom-bm25";
import {
  putImmutableCustomArtifact,
  readVerifiedCustomArtifactRange,
  type ImmutableCustomArtifactWrite,
} from "./custom-hybrid-index";
import { customCurrentSha256, serializeCustomCurrentArtifact } from "./custom-current-build";
import {
  legalIdentifierSchema,
  legalLanguageSchema,
  legalScriptSchema,
  sha256Schema,
  utcInstantSchema,
} from "./target-domain-schemas";

const MAGIC = new TextEncoder().encode("JBM25RT1");
const HEADER_SIZE = 16;
const RECORD_SIZE = 32;
const MAX_POSTING_BLOCK_BYTES = 1024 * 1024;
const ORDINAL_MAPPING_PAGE_SIZE = 32_768;
const MEMBERSHIP_PARTITIONS = 64;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);

export const customRuntimeLegalIdentitySchema = z.object({
  legalIdentitySha256: sha256Schema,
  legalInstrumentId: legalIdentifierSchema,
  officialExpressionId: legalIdentifierSchema,
  textRevisionId: legalIdentifierSchema,
  provisionConceptId: legalIdentifierSchema,
  provisionRenditionId: legalIdentifierSchema,
  evidenceProvisionRenditionId: legalIdentifierSchema,
  languageTag: legalLanguageSchema,
  script: legalScriptSchema,
  textualAuthority: z.enum(["controlling", "official_translation", "unknown"]),
  validFrom: utcInstantSchema,
  validTo: utcInstantSchema.nullable(),
  evidence: z.object({
    r2Key: z.string().min(1).max(1_024),
    byteCount: z.number().int().positive(),
    sha256: sha256Schema,
    sourceNormalizedSha256: sha256Schema,
    mediaType: z.enum(["application/json; charset=utf-8", "text/plain;charset=utf-8"]),
  }).strict(),
  citation: z.object({
    label: z.string().min(1).max(2_300),
    url: z.string().url().max(2_048),
  }).strict(),
}).strict();
export type CustomRuntimeLegalIdentity = z.infer<typeof customRuntimeLegalIdentitySchema>;

type RuntimeDocumentReference = { key: string; sizeBytes: number; sha256: string };

async function membershipPartition(itemKey: string): Promise<string> {
  const match = /^retrieval-chunk-v1:([a-f0-9]{64})$/u.exec(itemKey);
  const identity = match?.[1] ?? await customCurrentSha256(itemKey);
  return Math.floor(Number.parseInt(identity.slice(0, 2), 16) / 4)
    .toString(16).padStart(2, "0");
}
const artifactReferenceSchema = z.object({
  key: z.string().min(1).max(1_024),
  sizeBytes: z.number().int().positive(),
  sha256: digest,
}).strict();
const postingLocatorSchema = artifactReferenceSchema.extend({
  offset: z.number().int().nonnegative(),
  length: z.number().int().positive(),
  documentFrequency: z.number().int().positive(),
  blockMaximum: z.number().finite().nonnegative(),
}).strict();
const descriptorSchema = z.object({
  schemaVersion: z.literal("custom-bm25-runtime-v1"),
  releaseId: z.string().min(1).max(300),
  denseMetadataReleaseId: z.string().min(1).max(300).optional(),
  sparseManifestSha256: digest,
  analyzer: z.literal("word-v1"),
  statistics: z.object({
    documentCount: z.number().int().positive(),
    averageFieldLengths: z.object({
      title: z.number().finite().nonnegative(),
      hierarchy: z.number().finite().nonnegative(),
      article: z.number().finite().nonnegative(),
      text: z.number().finite().nonnegative(),
    }).strict(),
  }).strict(),
  documents: artifactReferenceSchema,
  ordinalMappings: z.object({
    pageSize: z.literal(ORDINAL_MAPPING_PAGE_SIZE),
    pages: z.array(artifactReferenceSchema.extend({
      firstOrdinal: z.number().int().nonnegative(),
      lastOrdinal: z.number().int().nonnegative(),
      count: z.number().int().positive(),
    }).strict()),
  }).strict().optional(),
  segments: z.array(z.object({
    id: z.string().min(1).max(300),
    lexicons: z.record(z.string().length(1), artifactReferenceSchema),
  }).strict()).min(1),
}).strict();

export type CustomBm25RuntimeDescriptor = z.infer<typeof descriptorSchema>;

export function parseCustomBm25RuntimeDescriptor(value: unknown): CustomBm25RuntimeDescriptor {
  return descriptorSchema.parse(value);
}

function encodeRuntimeDocuments(manifest: CustomBm25Manifest): Uint8Array {
  const documents = [...manifest.documents].sort((left, right) => left.ordinal - right.ordinal);
  if (documents.length !== manifest.statistics.documentCount
    || documents.some((document, index) => !Number.isSafeInteger(document.ordinal)
      || document.ordinal < 0 || document.ordinal > 0xffff_ffff
      || (index > 0 && document.ordinal <= documents[index - 1]!.ordinal))) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_DOCUMENTS_INVALID");
  }
  const bytes = new Uint8Array(HEADER_SIZE + documents.length * RECORD_SIZE);
  bytes.set(MAGIC, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 1, true);
  view.setUint32(12, documents.length, true);
  documents.forEach((document, index) => {
    const offset = HEADER_SIZE + index * RECORD_SIZE;
    const lengths = [document.fieldLengths.title, document.fieldLengths.hierarchy,
      document.fieldLengths.article, document.fieldLengths.text];
    if (![document.validFromEpoch, document.validToEpoch ?? -1].every(Number.isSafeInteger)
      || lengths.some((length) => !Number.isSafeInteger(length) || length < 0 || length > 0xffff)) {
      throw new TypeError("CUSTOM_BM25_RUNTIME_DOCUMENTS_INVALID");
    }
    view.setUint32(offset, document.ordinal, true);
    view.setFloat64(offset + 4, document.validFromEpoch, true);
    view.setFloat64(offset + 12, document.validToEpoch ?? -1, true);
    lengths.forEach((length, field) => view.setUint16(offset + 20 + field * 2, length, true));
  });
  return bytes;
}

export async function buildCustomBm25RuntimeArtifacts(input: {
  releaseId: string;
  denseMetadataReleaseId?: string;
  sparseManifestSha256: string;
  manifest: CustomBm25Manifest;
  resolveLegalIdentitySha256?: (
    itemKeys: readonly string[],
  ) => Promise<ReadonlyMap<string, string>>;
  resolveRuntimeLegalIdentities?: (
    itemKeys: readonly string[],
  ) => Promise<ReadonlyMap<string, CustomRuntimeLegalIdentity>>;
}): Promise<{
  descriptor: CustomBm25RuntimeDescriptor;
  descriptorBytes: Uint8Array;
  documentsBytes: Uint8Array;
  descriptorReference: { key: string; sizeBytes: number; sha256: string };
  documentsReference: { key: string; sizeBytes: number; sha256: string };
  ordinalMappingPages: Array<{
    reference: { key: string; sizeBytes: number; sha256: string;
      firstOrdinal: number; lastOrdinal: number; count: number };
    bytes: Uint8Array;
  }>;
  membership: {
    reference: { key: string; sizeBytes: number; sha256: string };
    bytes: Uint8Array;
    pages: Array<{ reference: { key: string; sizeBytes: number; sha256: string;
      partition: string; count: number }; bytes: Uint8Array }>;
  };
}> {
  const sparseManifestSha256 = digest.parse(input.sparseManifestSha256);
  const documentsBytes = encodeRuntimeDocuments(input.manifest);
  const documentsSha256 = await customCurrentSha256(documentsBytes);
  const documentsReference = {
    key: `search-releases/${input.releaseId}/runtime/documents-${documentsSha256}.bin`,
    sizeBytes: documentsBytes.byteLength,
    sha256: documentsSha256,
  };
  const sortedDocuments = [...input.manifest.documents]
    .sort((left, right) => left.ordinal - right.ordinal);
  const ordinalMappingPages = [] as Array<{
    reference: { key: string; sizeBytes: number; sha256: string;
      firstOrdinal: number; lastOrdinal: number; count: number };
    bytes: Uint8Array;
  }>;
  for (let offset = 0; offset < sortedDocuments.length; offset += ORDINAL_MAPPING_PAGE_SIZE) {
    const documents = sortedDocuments.slice(offset, offset + ORDINAL_MAPPING_PAGE_SIZE);
    const bytes = serializeCustomCurrentArtifact({ schemaVersion: 1,
      releaseId: input.releaseId,
      items: documents.map(({ ordinal, itemKey }) => ({ ordinal, itemKey })) });
    const sha256 = await customCurrentSha256(bytes);
    ordinalMappingPages.push({ bytes, reference: {
      key: `search-releases/${input.releaseId}/runtime/ordinal-mappings/${String(offset)
        .padStart(10, "0")}-${sha256}.json`,
      sizeBytes: bytes.byteLength, sha256, firstOrdinal: documents[0]!.ordinal,
      lastOrdinal: documents.at(-1)!.ordinal, count: documents.length,
    } });
  }
  const membership = new Map<string, Array<{ itemKey: string; ordinal: number }>>();
  for (const document of sortedDocuments) {
    const partition = await membershipPartition(document.itemKey);
    const entries = membership.get(partition) ?? [];
    entries.push({ itemKey: document.itemKey, ordinal: document.ordinal });
    membership.set(partition, entries);
  }
  const membershipPages = [] as Array<{ reference: { key: string; sizeBytes: number;
    sha256: string; partition: string; count: number }; bytes: Uint8Array }>;
  for (const partition of [...membership.keys()].sort()) {
    const items = membership.get(partition)!.sort((left, right) =>
      left.itemKey.localeCompare(right.itemKey));
    const legalIdentities = input.resolveLegalIdentitySha256
      ? await input.resolveLegalIdentitySha256(items.map(({ itemKey }) => itemKey)) : null;
    const runtimeIdentities = input.resolveRuntimeLegalIdentities
      ? await input.resolveRuntimeLegalIdentities(items.map(({ itemKey }) => itemKey)) : null;
    if (legalIdentities && (legalIdentities.size !== items.length
      || items.some(({ itemKey }) => !digest.safeParse(legalIdentities.get(itemKey)).success))) {
      throw new TypeError("CUSTOM_BM25_RUNTIME_MEMBERSHIP_INVALID");
    }
    if (runtimeIdentities && (runtimeIdentities.size !== items.length
      || items.some(({ itemKey }) => !customRuntimeLegalIdentitySchema
        .safeParse(runtimeIdentities.get(itemKey)).success))) {
      throw new TypeError("CUSTOM_BM25_RUNTIME_MEMBERSHIP_INVALID");
    }
    const bytes = serializeCustomCurrentArtifact({ schemaVersion: 1,
      releaseId: input.releaseId, partition,
      items: items.map((item) => ({ ...item,
        ...(legalIdentities
          ? { legalIdentitySha256: legalIdentities.get(item.itemKey)! } : {}),
        ...(runtimeIdentities
          ? { legalIdentity: runtimeIdentities.get(item.itemKey)! } : {}) })) });
    const sha256 = await customCurrentSha256(bytes);
    membershipPages.push({ bytes, reference: {
      key: `search-releases/${input.releaseId}/runtime/membership/${partition}-${sha256}.json`,
      sizeBytes: bytes.byteLength, sha256, partition, count: items.length,
    } });
  }
  if (membershipPages.length > MEMBERSHIP_PARTITIONS) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_MEMBERSHIP_INVALID");
  }
  const membershipBytes = serializeCustomCurrentArtifact({ schemaVersion: 1,
    releaseId: input.releaseId,
    partitions: membershipPages.map(({ reference }) => reference) });
  const membershipSha256 = await customCurrentSha256(membershipBytes);
  const membershipReference = {
    key: `search-releases/${input.releaseId}/runtime/mappings-${membershipSha256}.json`,
    sizeBytes: membershipBytes.byteLength, sha256: membershipSha256,
  };
  const descriptor = descriptorSchema.parse({
    schemaVersion: "custom-bm25-runtime-v1",
    releaseId: input.releaseId,
    ...(input.denseMetadataReleaseId
      ? { denseMetadataReleaseId: input.denseMetadataReleaseId } : {}),
    sparseManifestSha256,
    analyzer: input.manifest.analyzer,
    statistics: input.manifest.statistics,
    documents: documentsReference,
    ordinalMappings: { pageSize: ORDINAL_MAPPING_PAGE_SIZE,
      pages: ordinalMappingPages.map(({ reference }) => reference) },
    segments: input.manifest.segments.map((segment) => ({
      id: segment.id,
      lexicons: segment.lexicons,
    })),
  });
  const descriptorBytes = serializeCustomCurrentArtifact(descriptor);
  const descriptorSha256 = await customCurrentSha256(descriptorBytes);
  return {
    descriptor,
    descriptorBytes,
    documentsBytes,
    ordinalMappingPages,
    membership: { reference: membershipReference, bytes: membershipBytes,
      pages: membershipPages },
    descriptorReference: {
      key: `search-releases/${input.releaseId}/runtime/descriptor-${descriptorSha256}.json`,
      sizeBytes: descriptorBytes.byteLength,
      sha256: descriptorSha256,
    },
    documentsReference,
  };
}

export async function putCustomBm25RuntimeArtifacts(
  bucket: R2Bucket,
  artifacts: Awaited<ReturnType<typeof buildCustomBm25RuntimeArtifacts>>,
): Promise<{ descriptor: ImmutableCustomArtifactWrite; documents: ImmutableCustomArtifactWrite;
  ordinalMappings: ImmutableCustomArtifactWrite[]; membership: ImmutableCustomArtifactWrite;
  membershipPages: ImmutableCustomArtifactWrite[] }> {
  const documents = await putImmutableCustomArtifact(bucket, artifacts.documentsReference.key,
    artifacts.documentsBytes, { contentType: "application/octet-stream",
      customMetadata: { kind: "custom-bm25-runtime-documents" } });
  const ordinalMappings: ImmutableCustomArtifactWrite[] = [];
  for (const page of artifacts.ordinalMappingPages) {
    ordinalMappings.push(await putImmutableCustomArtifact(bucket, page.reference.key,
      page.bytes, { contentType: "application/json",
        customMetadata: { kind: "custom-bm25-runtime-ordinal-mapping" } }));
  }
  const membershipPages: ImmutableCustomArtifactWrite[] = [];
  for (const page of artifacts.membership.pages) {
    membershipPages.push(await putImmutableCustomArtifact(bucket, page.reference.key,
      page.bytes, { contentType: "application/json",
        customMetadata: { kind: "custom-bm25-runtime-membership-page" } }));
  }
  const membership = await putImmutableCustomArtifact(bucket, artifacts.membership.reference.key,
    artifacts.membership.bytes, { contentType: "application/json",
      customMetadata: { kind: "custom-bm25-runtime-membership" } });
  const descriptor = await putImmutableCustomArtifact(bucket, artifacts.descriptorReference.key,
    artifacts.descriptorBytes, { contentType: "application/json",
      customMetadata: { kind: "custom-bm25-runtime-descriptor" } });
  return { descriptor, documents, ordinalMappings, membership, membershipPages };
}

export async function resolveCustomBm25RuntimeMembership(
  bucket: R2Bucket,
  releaseId: string,
  mappingInventorySha256: string,
  itemKeys: readonly string[],
): Promise<boolean | null> {
  const entries = await resolveCustomBm25RuntimeMembershipEntries(
    bucket,
    releaseId,
    mappingInventorySha256,
    itemKeys,
  );
  return entries === null ? null : [...new Set(itemKeys)].every((itemKey) => entries.has(itemKey));
}

export async function resolveCustomBm25RuntimeMembershipEntries(
  bucket: R2Bucket,
  releaseId: string,
  mappingInventorySha256: string,
  itemKeys: readonly string[],
): Promise<Map<string, { ordinal: number; legalIdentitySha256: string | null;
  legalIdentity?: CustomRuntimeLegalIdentity }> | null> {
  const sha256 = digest.parse(mappingInventorySha256);
  const key = `search-releases/${releaseId}/runtime/mappings-${sha256}.json`;
  const object = await bucket.get(key);
  if (!object) return null;
  if (object.size > 256 * 1024) throw new TypeError("CUSTOM_BM25_RUNTIME_MEMBERSHIP_CORRUPT");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== object.size || await customCurrentSha256(bytes) !== sha256) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_MEMBERSHIP_CORRUPT");
  }
  const manifest = z.object({ schemaVersion: z.literal(1), releaseId: z.literal(releaseId),
    partitions: z.array(artifactReferenceSchema.extend({ partition: z.string().regex(/^[a-f0-9]{2}$/u),
      count: z.number().int().positive() }).strict()).max(MEMBERSHIP_PARTITIONS) }).strict()
    .parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
  const partitions = new Map(manifest.partitions.map((page) => [page.partition, page]));
  if (partitions.size !== manifest.partitions.length) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_MEMBERSHIP_CORRUPT");
  }
  const requested = new Map<string, string[]>();
  for (const itemKey of [...new Set(itemKeys)]) {
    const partition = await membershipPartition(itemKey);
    const group = requested.get(partition) ?? [];
    group.push(itemKey);
    requested.set(partition, group);
  }
  const resolved = new Map<string, { ordinal: number; legalIdentitySha256: string | null;
    legalIdentity?: CustomRuntimeLegalIdentity }>();
  const groups = [...requested.entries()];
  const membershipStarted = Date.now();
  for (let offset = 0; offset < groups.length; offset += 6) {
    await Promise.all(groups.slice(offset, offset + 6).map(async ([partition, keys]) => {
      const reference = partitions.get(partition);
      if (!reference) return false;
      const page = z.object({ schemaVersion: z.literal(1), releaseId: z.literal(releaseId),
        partition: z.literal(partition), items: z.array(z.object({ itemKey: z.string().min(1).max(700),
          ordinal: z.number().int().nonnegative(), legalIdentitySha256: digest.optional(),
          legalIdentity: customRuntimeLegalIdentitySchema.optional() }).strict())
          .length(reference.count) }).strict()
        .parse(await readJson<unknown>(bucket, reference));
      const members = new Map(page.items.map((item) => [item.itemKey, item]));
      if (members.size !== page.items.length) {
        throw new TypeError("CUSTOM_BM25_RUNTIME_MEMBERSHIP_CORRUPT");
      }
      for (const itemKey of keys) {
        const item = members.get(itemKey);
        if (item) resolved.set(itemKey, { ordinal: item.ordinal,
          legalIdentitySha256: item.legalIdentitySha256 ?? item.legalIdentity?.legalIdentitySha256 ?? null,
          ...(item.legalIdentity ? { legalIdentity: item.legalIdentity } : {}) });
      }
    }));
  }
  console.info(JSON.stringify({event: "legal_membership_resolved", requestedItems: itemKeys.length,
    partitions: groups.length, bytes: groups.reduce((sum, [partition]) => sum + (partitions.get(partition)?.sizeBytes ?? 0), 0),
    elapsedMs: Date.now() - membershipStarted}));
  return resolved;
}

export async function resolveCustomBm25RuntimeItemKeys(
  bucket: R2Bucket,
  rawDescriptor: CustomBm25RuntimeDescriptor,
  ordinals: readonly number[],
): Promise<string[] | null> {
  const descriptor = descriptorSchema.parse(rawDescriptor);
  if (!descriptor.ordinalMappings) return null;
  const requested = [...new Set(ordinals)];
  if (requested.some((ordinal) => !Number.isSafeInteger(ordinal) || ordinal < 0)) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_ORDINAL_INVALID");
  }
  const selected = new Map<number, string>();
  const neededPages = new Map<string, typeof descriptor.ordinalMappings.pages[number]>();
  for (const ordinal of requested) {
    const page = descriptor.ordinalMappings.pages.find((candidate) =>
      candidate.firstOrdinal <= ordinal && ordinal <= candidate.lastOrdinal);
    if (!page) throw new TypeError("CUSTOM_BM25_RUNTIME_ORDINAL_MISSING");
    neededPages.set(page.key, page);
  }
  const pages = [...neededPages.values()];
  for (let offset = 0; offset < pages.length; offset += 6) {
    const values = await Promise.all(pages.slice(offset, offset + 6).map(async (page) =>
      z.object({ schemaVersion: z.literal(1), releaseId: z.literal(descriptor.releaseId),
        items: z.array(z.object({ ordinal: z.number().int().nonnegative(),
          itemKey: z.string().min(1).max(700) }).strict()).length(page.count) }).strict()
        .parse(await readJson<unknown>(bucket, page))));
    for (const value of values) for (const item of value.items) {
        if (selected.has(item.ordinal)) throw new TypeError("CUSTOM_BM25_RUNTIME_ORDINAL_DUPLICATE");
        selected.set(item.ordinal, item.itemKey);
      }
  }
  if (requested.some((ordinal) => !selected.has(ordinal))) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_ORDINAL_MISSING");
  }
  return ordinals.map((ordinal) => selected.get(ordinal)!);
}

type RuntimeDocument = {
  validFromEpoch: number;
  validToEpoch: number | null;
  fieldLengths: { title: number; hierarchy: number; article: number; text: number };
};

async function readRuntimeDocuments(bucket: R2Bucket, reference: RuntimeDocumentReference,
  requested: ReadonlySet<number>): Promise<Map<number, RuntimeDocument>> {
  const object = await bucket.get(reference.key);
  if (!object || object.size !== reference.sizeBytes || !object.body) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_DOCUMENTS_CORRUPT");
  }
  const hash = createHash("sha256");
  const reader = object.body.getReader();
  const selected = new Map<number, RuntimeDocument>();
  let pending = new Uint8Array();
  let totalBytes = 0;
  let expectedRecords: number | undefined;
  let records = 0;
  let previousOrdinal = -1;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    hash.update(value);
    totalBytes += value.byteLength;
    const bytes = pending.byteLength === 0 ? value : (() => {
      const joined = new Uint8Array(pending.byteLength + value.byteLength);
      joined.set(pending); joined.set(value, pending.byteLength);
      return joined;
    })();
    let offset = 0;
    if (expectedRecords === undefined) {
      if (bytes.byteLength < HEADER_SIZE) { pending = bytes.slice(); continue; }
      if (!MAGIC.every((byte, index) => bytes[index] === byte)) {
        throw new TypeError("CUSTOM_BM25_RUNTIME_DOCUMENTS_CORRUPT");
      }
      const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
      if (header.getUint32(8, true) !== 1) {
        throw new TypeError("CUSTOM_BM25_RUNTIME_DOCUMENTS_CORRUPT");
      }
      expectedRecords = header.getUint32(12, true);
      offset = HEADER_SIZE;
    }
    while (bytes.byteLength - offset >= RECORD_SIZE) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + offset, RECORD_SIZE);
      const ordinal = view.getUint32(0, true);
      if (ordinal <= previousOrdinal) throw new TypeError("CUSTOM_BM25_RUNTIME_DOCUMENTS_CORRUPT");
      previousOrdinal = ordinal;
      if (requested.has(ordinal)) {
        const validTo = view.getFloat64(12, true);
        selected.set(ordinal, {
          validFromEpoch: view.getFloat64(4, true),
          validToEpoch: validTo === -1 ? null : validTo,
          fieldLengths: { title: view.getUint16(20, true), hierarchy: view.getUint16(22, true),
            article: view.getUint16(24, true), text: view.getUint16(26, true) },
        });
      }
      records++;
      offset += RECORD_SIZE;
    }
    pending = bytes.slice(offset);
  }
  if (pending.byteLength !== 0 || expectedRecords === undefined || records !== expectedRecords
    || totalBytes !== reference.sizeBytes || hash.digest("hex") !== reference.sha256
    || selected.size !== requested.size) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_DOCUMENTS_CORRUPT");
  }
  return selected;
}

const postingBlockSchema = z.object({
  termHash: digest,
  documentFrequency: z.number().int().positive(),
  blockMaximum: z.number().finite().nonnegative(),
  skip: z.array(z.object({ postingIndex: z.number().int().nonnegative(),
    ordinal: z.number().int().nonnegative() }).strict()),
  postings: z.array(z.object({
    ordinal: z.number().int().nonnegative(),
    termFrequencies: z.object({ title: z.number().int().nonnegative(),
      hierarchy: z.number().int().nonnegative(), article: z.number().int().nonnegative(),
      text: z.number().int().nonnegative() }).strict(),
  }).strict()),
}).strict();

async function readJson<T>(bucket: R2Bucket, reference: {
  key: string; sizeBytes: number; sha256: string;
}): Promise<T> {
  const bytes = await readVerifiedCustomArtifactRange(bucket, {
    key: reference.key, offset: 0, length: reference.sizeBytes, sha256: reference.sha256,
  });
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T;
}

function bytesIndexOf(haystack: Uint8Array, needle: Uint8Array, start = 0): number {
  for (let offset = haystack.indexOf(needle[0]!, start); offset >= 0;
    offset = haystack.indexOf(needle[0]!, offset + 1)) {
    if (needle.every((byte, index) => haystack[offset + index] === byte)) return offset;
  }
  return -1;
}

async function resolvePostingLocators(bucket: R2Bucket, reference: RuntimeDocumentReference,
  termHashes: readonly string[]) {
  const bytes = await readVerifiedCustomArtifactRange(bucket, {
    key: reference.key, offset: 0, length: reference.sizeBytes, sha256: reference.sha256,
  });
  let final = bytes.length - 1;
  while (final > 0 && (bytes[final] === 0x0a || bytes[final] === 0x0d
    || bytes[final] === 0x20 || bytes[final] === 0x09)) final--;
  if (bytes[0] !== 0x7b || bytes[final] !== 0x7d) {
    throw new TypeError("CUSTOM_BM25_RUNTIME_LEXICON_CORRUPT");
  }
  const result = new Map<string, z.infer<typeof postingLocatorSchema>>();
  for (const termHash of termHashes) {
    const marker = new TextEncoder().encode(`"${termHash}":`);
    const markerOffset = bytesIndexOf(bytes, marker);
    if (markerOffset < 0) continue;
    if (bytesIndexOf(bytes, marker, markerOffset + marker.length) >= 0) {
      throw new TypeError("CUSTOM_BM25_RUNTIME_LEXICON_CORRUPT");
    }
    const valueOffset = markerOffset + marker.length;
    if (bytes[valueOffset] !== 0x7b) throw new TypeError("CUSTOM_BM25_RUNTIME_LEXICON_CORRUPT");
    const valueEnd = bytes.indexOf(0x7d, valueOffset + 1);
    if (valueEnd < 0) throw new TypeError("CUSTOM_BM25_RUNTIME_LEXICON_CORRUPT");
    result.set(termHash, postingLocatorSchema.parse(JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(valueOffset, valueEnd + 1)),
    ) as unknown));
  }
  return result;
}

export async function queryCustomBm25RuntimeBatch(
  bucket: R2Bucket,
  rawDescriptor: CustomBm25RuntimeDescriptor,
  inputs: Array<{ text: string; atEpoch: number; topK: number }>,
): Promise<Array<Array<{ ordinal: number; score: number; explicitArticleMatch?: true }>>> {
  const descriptor = descriptorSchema.parse(rawDescriptor);
  if (inputs.length < 1 || inputs.length > 6 || inputs.some(input =>
    !Number.isSafeInteger(input.atEpoch) || !Number.isSafeInteger(input.topK)
    || input.topK < 1 || input.topK > 50)) throw new TypeError("CUSTOM_BM25_RUNTIME_QUERY_INVALID");
  const groups = new Map<string, { reference: RuntimeDocumentReference; termHashes: string[] }>();
  const formulations = await Promise.all(inputs.map(async input => ({
    ...input,
    termHashes: new Set(await Promise.all([...new Set(analyzeCustomWordTerms(input.text))]
      .sort().map(customBm25TermHash))),
    // Restrict this priority to unambiguous whole-number references. Compound
    // identifiers require positional evidence that a bag-of-words index lacks.
    articleHashes: new Set(await Promise.all(detectArticleNumbers(input.text)
      .filter(number => /^\d+$/u.test(number)).map(customBm25TermHash))),
  })));
  const termHashes = new Set(formulations.flatMap(input => [...input.termHashes]));
  for (const termHash of termHashes) for (const segment of descriptor.segments) {
    const reference = segment.lexicons[termHash[0]!];
    if (!reference) continue;
    const identity = `${reference.key}\n${reference.sha256}\n${reference.sizeBytes}`;
    const group = groups.get(identity) ?? { reference, termHashes: [] };
    group.termHashes.push(termHash);
    groups.set(identity, group);
  }
  const located: Array<{ termHash: string; locator: z.infer<typeof postingLocatorSchema> }> = [];
  const locatedGroups = await mapArtifactReads([...groups.values()], async group => {
    const entries: typeof located = [];
    const locators = await resolvePostingLocators(bucket, group.reference, group.termHashes);
    for (const termHash of group.termHashes) {
      const locator = locators.get(termHash);
      if (!locator) continue;
      if (locator.length > MAX_POSTING_BLOCK_BYTES) {
        // High-frequency terms can exceed the bounded read size. Treat them as
        // sparse stop words so rarer terms and the independent dense lane stay usable.
        continue;
      }
      entries.push({ termHash, locator });
    }
    return entries;
  });
  located.push(...locatedGroups.flat());
  if (located.length === 0) return inputs.map(() => []);
  // Posting ranges are independently hash-verified and capped at one MiB.
  // Allow six to overlap without increasing the two-reader limit for the
  // much larger lexicons or overlapping sparse traversals across requests.
  const blocks = await mapArtifactReads(located, async ({ termHash, locator }) => {
    const blockBytes = await readVerifiedCustomArtifactRange(bucket, locator);
    const block = postingBlockSchema.parse(JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(blockBytes),
    ) as unknown);
    if (block.termHash !== termHash || block.documentFrequency !== locator.documentFrequency
      || block.blockMaximum !== locator.blockMaximum) {
      throw new TypeError("CUSTOM_BM25_RUNTIME_POSTING_LOCATOR_MISMATCH");
    }
    return block;
  }, 6);
  // Verify the immutable table as a stream and retain only records referenced by
  // bounded posting blocks; the full historical table is larger than the Worker heap budget.
  const requestedOrdinals = new Set(blocks.flatMap((block) =>
    block.postings.map((posting) => posting.ordinal)));
  const documents = await readRuntimeDocuments(bucket, descriptor.documents, requestedOrdinals);
  return formulations.map(input => {
    const scores = new Map<number, number>();
    const explicitArticles = new Set<number>();
    // A formulation's reduction order must not depend on other batch members.
    for (const block of blocks.filter(block => input.termHashes.has(block.termHash))
      .sort((left, right) => left.termHash.localeCompare(right.termHash))) {
      for (const posting of block.postings) {
          const document = documents.get(posting.ordinal);
          if (!document) throw new TypeError("CUSTOM_BM25_RUNTIME_ORDINAL_MISSING");
          if (document.validFromEpoch > input.atEpoch
            || (document.validToEpoch !== null && input.atEpoch >= document.validToEpoch)) continue;
          if (input.articleHashes.has(block.termHash) && posting.termFrequencies.article > 0) {
            explicitArticles.add(posting.ordinal);
          }
          const fields = ["title", "hierarchy", "article", "text"] as const;
          const score = fields.reduce((sum, field) => sum + scoreCustomBm25Term({
            termFrequency: posting.termFrequencies[field],
            documentFrequency: block.documentFrequency,
            documentCount: descriptor.statistics.documentCount,
            fieldLength: document.fieldLengths[field],
            averageFieldLength: descriptor.statistics.averageFieldLengths[field],
            field,
          }), 0);
          scores.set(posting.ordinal, (scores.get(posting.ordinal) ?? 0) + score);
      }
    }
    return [...scores].map(([ordinal, score]) => ({ ordinal, score,
      ...(explicitArticles.has(ordinal) ? {explicitArticleMatch: true as const} : {}) }))
      .sort((left, right) => right.score - left.score
        || Number(!!right.explicitArticleMatch) - Number(!!left.explicitArticleMatch) || left.ordinal - right.ordinal)
      .slice(0, input.topK);
  });
}

// Bound simultaneous artifact buffers independently of formulation count. Wait
// for every reader on failure so no request-scoped I/O escapes its lifetime.
async function mapArtifactReads<T, R>(items: readonly T[], read: (item: T) => Promise<R>, concurrency = 2): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await read(items[index]!); }
      catch (error) { failed = true; throw error; }
    }
  }));
  for (const worker of workers) if (worker.status === "rejected") throw worker.reason;
  return results;
}

export async function queryCustomBm25Runtime(
  bucket: R2Bucket,
  descriptor: CustomBm25RuntimeDescriptor,
  input: { text: string; atEpoch: number; topK: number },
): Promise<Array<{ ordinal: number; score: number; explicitArticleMatch?: true }>> {
  return (await queryCustomBm25RuntimeBatch(bucket, descriptor, [input]))[0]!;
}
