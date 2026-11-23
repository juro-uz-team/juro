import { encode, isWithinTokenLimit } from "gpt-tokenizer/encoding/cl100k_base";
import { z } from "zod";

import { stableSourceSnapshotJson } from "./source-snapshot";
import { legalLanguageSchema, legalScriptSchema } from "./target-domain-schemas";

export const CUSTOM_RETRIEVAL_CHUNK_POLICY_VERSION = "retrieval-chunk-v1" as const;
export const CUSTOM_EMBEDDING_INPUT_VERSION = "legal-embedding-input-v1" as const;
export const CUSTOM_EMBEDDING_MODEL = "text-embedding-3-large" as const;
export const CUSTOM_EMBEDDING_DIMENSIONS = 1_536 as const;
export const CUSTOM_EMBEDDING_MAX_INPUT_TOKENS = 8_192 as const;
export const CUSTOM_EMBEDDING_TRANSFORM_VERSION = "float32-l2-v1" as const;

const targetTokensSchema = z.union([z.literal(512), z.literal(1_024), z.literal(2_048)]);
const embeddingSourceSchema = z.object({
  snapshotProvisionId: z.string().trim().min(1).max(300),
  sourceDocumentTitle: z.string().trim().min(1).max(2_000),
  documentType: z.string().trim().min(1).max(300),
  articleNumber: z.string().trim().min(1).max(300),
  articleTitle: z.string().trim().min(1).max(16_000).nullable(),
  hierarchy: z.array(z.string().trim().min(1).max(1_000)).max(24),
  language: legalLanguageSchema,
  script: legalScriptSchema,
  officialText: z.string().min(1),
}).strict();
const sourceProvisionSchema = embeddingSourceSchema.extend({
  validFromEpoch: z.number().int(),
  validToEpoch: z.number().int().nullable(),
}).strict().superRefine((value, context) => {
  if (value.validToEpoch !== null && value.validToEpoch <= value.validFromEpoch) {
    context.addIssue({ code: "custom", message: "Applicability interval must be half-open" });
  }
});

export type CustomRetrievalChunkSource = z.input<typeof sourceProvisionSchema>;

export type CustomRetrievalChunk = {
  id: string;
  policyVersion: typeof CUSTOM_RETRIEVAL_CHUNK_POLICY_VERSION;
  snapshotProvisionId: string;
  ordinal: number;
  targetTokens: z.infer<typeof targetTokensSchema>;
  sourceDocumentTitle: string;
  documentType: string;
  articleNumber: string;
  articleTitle: string | null;
  hierarchy: string[];
  language: z.infer<typeof legalLanguageSchema>;
  script: z.infer<typeof legalScriptSchema>;
  officialText: string;
  officialTextSha256: string;
  embeddingTokenCount: number;
  validFromEpoch: number;
  validToEpoch: number | null;
};

const textEncoder = new TextEncoder();

async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const source = typeof bytes === "string" ? textEncoder.encode(bytes) : bytes;
  const owned = new Uint8Array(source.byteLength);
  owned.set(source);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, "0"))
    .join("");
}

export function countCustomEmbeddingTokens(value: string): number {
  return encode(value).length;
}

type EmbeddingInputFields = Pick<CustomRetrievalChunk,
  | "sourceDocumentTitle"
  | "documentType"
  | "articleNumber"
  | "articleTitle"
  | "hierarchy"
  | "language"
  | "script"
  | "officialText">;

export function serializeCustomEmbeddingInput(input: EmbeddingInputFields): string {
  return `${stableSourceSnapshotJson({
    articleNumber: input.articleNumber,
    articleTitle: input.articleTitle,
    documentTitle: input.sourceDocumentTitle,
    documentType: input.documentType,
    hierarchy: input.hierarchy,
    language: input.language,
    officialText: input.officialText,
    schemaVersion: CUSTOM_EMBEDDING_INPUT_VERSION,
    script: input.script,
  })}\n`;
}

function codePointOffsets(value: string): number[] {
  const offsets = [0];
  let offset = 0;
  for (const point of value) {
    offset += point.length;
    offsets.push(offset);
  }
  return offsets;
}

function structuralBoundary(value: string, maximumOffset: number): number {
  const minimumPreferredOffset = Math.floor(maximumOffset * 0.6);
  const prefix = value.slice(0, maximumOffset);
  const paragraph = prefix.lastIndexOf("\n\n") + 2;
  if (paragraph >= minimumPreferredOffset) return paragraph;
  const line = prefix.lastIndexOf("\n") + 1;
  if (line >= minimumPreferredOffset) return line;
  const candidates: number[] = [];
  const sentence = /[.!?;:。！？](?:[ \t]+|$)/gu;
  for (let match = sentence.exec(prefix); match; match = sentence.exec(prefix)) {
    candidates.push(match.index + match[0].length);
  }
  const whitespace = /\s+/gu;
  for (let match = whitespace.exec(prefix); match; match = whitespace.exec(prefix)) {
    candidates.push(match.index + match[0].length);
  }
  const preferred = candidates.filter((offset) => offset >= minimumPreferredOffset);
  return preferred.length > 0 ? Math.max(...preferred) : maximumOffset;
}

function nextChunkBoundary(value: string, targetTokens: number): number {
  if (isWithinTokenLimit(value, targetTokens) !== false) return value.length;
  const offsets = codePointOffsets(value);
  let low = 1;
  let high = offsets.length - 1;
  let best = offsets[1] ?? value.length;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const offset = offsets[middle] ?? value.length;
    if (isWithinTokenLimit(value.slice(0, offset), targetTokens) !== false) {
      best = offset;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return structuralBoundary(value, best);
}

export async function buildRetrievalChunks(
  rawSource: CustomRetrievalChunkSource,
  options: { targetTokens: 512 | 1_024 | 2_048 },
): Promise<CustomRetrievalChunk[]> {
  const source = sourceProvisionSchema.parse(rawSource);
  const { validFromEpoch, validToEpoch, ...content } = source;
  const chunks = await prepareEmbeddingChunks(content, options);
  return chunks.map(chunk => ({ ...chunk, validFromEpoch, validToEpoch }));
}

export async function prepareEmbeddingChunks(
  rawSource: z.input<typeof embeddingSourceSchema>,
  options: { targetTokens: 512 | 1_024 | 2_048 },
): Promise<Array<Omit<CustomRetrievalChunk, "validFromEpoch" | "validToEpoch">>> {
  const source = embeddingSourceSchema.parse(rawSource);
  const targetTokens = targetTokensSchema.parse(options.targetTokens);
  const chunks: Array<Omit<CustomRetrievalChunk, "validFromEpoch" | "validToEpoch">> = [];
  let remaining = source.officialText;
  while (remaining.length > 0) {
    const boundary = nextChunkBoundary(remaining, targetTokens);
    if (boundary <= 0) throw new TypeError("CUSTOM_RETRIEVAL_CHUNK_BOUNDARY_INVALID");
    const officialText = remaining.slice(0, boundary);
    const ordinal = chunks.length;
    const officialTextSha256 = await sha256Hex(officialText);
    const idDigest = await sha256Hex(stableSourceSnapshotJson({
      ordinal,
      policyVersion: CUSTOM_RETRIEVAL_CHUNK_POLICY_VERSION,
      snapshotProvisionId: source.snapshotProvisionId,
      targetTokens,
      officialTextSha256,
    }));
    const chunk = {
      id: `${CUSTOM_RETRIEVAL_CHUNK_POLICY_VERSION}:${idDigest}`,
      policyVersion: CUSTOM_RETRIEVAL_CHUNK_POLICY_VERSION,
      snapshotProvisionId: source.snapshotProvisionId,
      ordinal,
      targetTokens,
      sourceDocumentTitle: source.sourceDocumentTitle,
      documentType: source.documentType,
      articleNumber: source.articleNumber,
      articleTitle: source.articleTitle,
      hierarchy: [...source.hierarchy],
      language: source.language,
      script: source.script,
      officialText,
      officialTextSha256,
      embeddingTokenCount: 0,
    };
    chunk.embeddingTokenCount = countCustomEmbeddingTokens(serializeCustomEmbeddingInput(chunk));
    if (chunk.embeddingTokenCount > CUSTOM_EMBEDDING_MAX_INPUT_TOKENS) {
      throw new TypeError("CUSTOM_EMBEDDING_INPUT_TOKEN_LIMIT_EXCEEDED");
    }
    chunks.push(chunk);
    remaining = remaining.slice(boundary);
  }
  return chunks;
}

export type CustomEmbeddingArtifact = {
  key: string;
  bytes: Uint8Array;
  model: typeof CUSTOM_EMBEDDING_MODEL;
  dimensions: typeof CUSTOM_EMBEDDING_DIMENSIONS;
  inputVersion: typeof CUSTOM_EMBEDDING_INPUT_VERSION;
  transformVersion: typeof CUSTOM_EMBEDDING_TRANSFORM_VERSION;
  inputSha256: string;
  vectorSha256: string;
};

function serializeNormalizedEmbedding(values: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}

export function normalizeCustomEmbedding(values: readonly number[]): number[] {
  if (values.length !== CUSTOM_EMBEDDING_DIMENSIONS) {
    throw new TypeError("CUSTOM_EMBEDDING_DIMENSION_MISMATCH");
  }
  if (!values.every(Number.isFinite)) throw new TypeError("CUSTOM_EMBEDDING_NONFINITE");
  const float32 = values.map((value) => Math.fround(value));
  const squaredNorm = float32.reduce((sum, value) => sum + value * value, 0);
  if (!Number.isFinite(squaredNorm) || squaredNorm <= 0) {
    throw new TypeError("CUSTOM_EMBEDDING_ZERO_NORM");
  }
  const norm = Math.sqrt(squaredNorm);
  return float32.map((value) => Math.fround(value / norm));
}

export function deserializeNormalizedEmbedding(bytes: Uint8Array): Float32Array {
  if (bytes.byteLength !== CUSTOM_EMBEDDING_DIMENSIONS * 4) {
    throw new TypeError("CUSTOM_EMBEDDING_ARTIFACT_SIZE_MISMATCH");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Float32Array.from({ length: CUSTOM_EMBEDDING_DIMENSIONS }, (_, index) =>
    view.getFloat32(index * 4, true)
  );
}

export async function customVectorId(retrievalChunkId: string): Promise<string> {
  return sha256Hex(retrievalChunkId);
}

export async function createCustomEmbeddingArtifact(
  chunk: CustomRetrievalChunk,
  providerVector: readonly number[],
): Promise<CustomEmbeddingArtifact> {
  const normalized = normalizeCustomEmbedding(providerVector);
  const bytes = serializeNormalizedEmbedding(normalized);
  const inputSha256 = await sha256Hex(serializeCustomEmbeddingInput(chunk));
  const vectorSha256 = await sha256Hex(bytes);
  return {
    key: `embeddings/${CUSTOM_EMBEDDING_MODEL}/${CUSTOM_EMBEDDING_DIMENSIONS}`
      + `/${CUSTOM_EMBEDDING_TRANSFORM_VERSION}/${inputSha256}/${vectorSha256}.f32`,
    bytes,
    model: CUSTOM_EMBEDDING_MODEL,
    dimensions: CUSTOM_EMBEDDING_DIMENSIONS,
    inputVersion: CUSTOM_EMBEDDING_INPUT_VERSION,
    transformVersion: CUSTOM_EMBEDDING_TRANSFORM_VERSION,
    inputSha256,
    vectorSha256,
  };
}

export type ImmutableCustomArtifactWrite = {
  status: "created" | "reused";
  key: string;
  sizeBytes: number;
  sha256: string;
};

async function readCustomArtifact(bucket: R2Bucket, key: string): Promise<Uint8Array | null> {
  const object = await bucket.get(key);
  if (!object) return null;
  return new Uint8Array(await object.arrayBuffer());
}

async function requireMatchingCustomArtifact(
  bucket: R2Bucket,
  key: string,
  expectedBytes: Uint8Array,
  expectedSha256: string,
): Promise<void> {
  const stored = await readCustomArtifact(bucket, key);
  if (
    !stored
    || stored.byteLength !== expectedBytes.byteLength
    || await sha256Hex(stored) !== expectedSha256
  ) {
    throw new TypeError("CUSTOM_ARTIFACT_IMMUTABILITY_VIOLATION");
  }
}

export async function putImmutableCustomArtifact(
  bucket: R2Bucket,
  key: string,
  bytes: Uint8Array,
  metadata: { contentType: string; customMetadata?: Record<string, string> },
): Promise<ImmutableCustomArtifactWrite> {
  const sha256 = await sha256Hex(bytes);
  if (await bucket.head(key)) {
    await requireMatchingCustomArtifact(bucket, key, bytes, sha256);
    return { status: "reused", key, sizeBytes: bytes.byteLength, sha256 };
  }
  const created = await bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    sha256,
    httpMetadata: { contentType: metadata.contentType },
    customMetadata: { ...metadata.customMetadata, sha256 },
  });
  if (!created) {
    await requireMatchingCustomArtifact(bucket, key, bytes, sha256);
    return { status: "reused", key, sizeBytes: bytes.byteLength, sha256 };
  }
  await requireMatchingCustomArtifact(bucket, key, bytes, sha256);
  return { status: "created", key, sizeBytes: bytes.byteLength, sha256 };
}

/** Bound artifact I/O, preserve input order, and settle started writes before propagating a failure. */
export async function mapCustomArtifactOperations<T, R>(
  items: readonly T[],
  operation: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const output: R[] = [];
  for (let offset = 0; offset < items.length; offset += 6) {
    const results = await Promise.allSettled(items.slice(offset, offset + 6)
      .map(async (item, index) => operation(item, offset + index)));
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      output.push(result.value);
    }
  }
  return output;
}

export async function readVerifiedCustomArtifactRange(
  bucket: R2Bucket,
  locator: { key: string; offset: number; length: number; sha256: string },
): Promise<Uint8Array> {
  if (
    !Number.isSafeInteger(locator.offset)
    || locator.offset < 0
    || !Number.isSafeInteger(locator.length)
    || locator.length <= 0
    || !/^[a-f0-9]{64}$/u.test(locator.sha256)
  ) {
    throw new TypeError("CUSTOM_ARTIFACT_RANGE_LOCATOR_INVALID");
  }
  const object = await bucket.get(locator.key, {
    range: { offset: locator.offset, length: locator.length },
  });
  if (!object) throw new TypeError("CUSTOM_ARTIFACT_RANGE_MISSING");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== locator.length) {
    throw new TypeError("CUSTOM_ARTIFACT_RANGE_LENGTH_MISMATCH");
  }
  if (await sha256Hex(bytes) !== locator.sha256) {
    throw new TypeError("CUSTOM_ARTIFACT_RANGE_HASH_MISMATCH");
  }
  return bytes;
}
