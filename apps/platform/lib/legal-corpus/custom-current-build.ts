import { z } from "zod";

import {
  buildCustomBm25IntermediateRecords,
  type CustomBm25IntermediateRecord,
} from "./custom-bm25";
import {
  buildRetrievalChunks,
  customVectorId,
  serializeCustomEmbeddingInput,
  type CustomRetrievalChunk,
} from "./custom-hybrid-index";
import { customItemOrdinal } from "./custom-release-manifest";
import { stableSourceSnapshotJson } from "./source-snapshot";
import { legalLanguageSchema } from "./target-domain-schemas";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const instantSchema = z.string().datetime({ offset: true });
export const acceptedCurrentSourceSchema = z.object({
  legacyRenditionId: z.string().min(1), sourceId: z.string().min(1),
  legalIdentitySha256: sha256Schema, contentSha256: sha256Schema,
  provision: z.object({ key: z.string().min(1), sha256: sha256Schema,
    sizeBytes: z.number().int().positive(), envelope: z.boolean() }).strict(),
  normalized: z.object({ key: z.string().min(1), sha256: sha256Schema,
    sizeBytes: z.number().int().positive() }).strict(),
  chunks: z.array(z.object({ ordinal: z.number().int().nonnegative(),
    officialTextSha256: sha256Schema, inputSha256: sha256Schema,
    inputTokens: z.number().int().min(1).max(8192) }).strict()).min(1).max(999),
}).strict();
export type AcceptedCurrentSource = z.infer<typeof acceptedCurrentSourceSchema>;
const provisionObjectSchema = z.object({
  schemaVersion: z.literal(1),
  provisionRenditionId: z.string(),
  publisherInstrumentToken: z.string(),
  publisherProvisionToken: z.string(),
  languageTag: z.enum(["uz-Latn", "uz-Cyrl", "ru", "en"]),
  actTitle: z.string(),
  documentType: z.string(),
  articleNumber: z.string(),
  articleTitle: z.string().nullable(),
  provisionSequence: z.number().int().nonnegative(),
  provisionText: z.string().min(1),
  sourceUrl: z.string().url(),
  capturedAt: z.string(),
  sourceNormalizedSha256: sha256Schema,
}).passthrough();
const sourcePlanItemSchema = z.object({
  sourceOrdinal: z.number().int().nonnegative(),
  snapshotProvisionId: z.string().min(1).max(300),
  provisionRenditionId: z.string().min(1).max(300),
  evidenceR2Key: z.string().min(1).max(1_024),
  evidenceByteCount: z.number().int().positive(),
  evidenceSha256: sha256Schema,
  language: legalLanguageSchema,
  documentType: z.string().min(1).max(300),
  validFrom: instantSchema,
  validTo: instantSchema.nullable(),
  accepted: acceptedCurrentSourceSchema.optional(),
}).strict();

export type CustomCurrentSourcePlanItem = z.infer<typeof sourcePlanItemSchema>;

export type CustomCurrentDenseItem = {
  chunk: CustomRetrievalChunk;
  vectorId: string;
  metadata: {
    item_key: string;
    release_id: string;
    snapshot_provision_id: string;
    language: z.infer<typeof legalLanguageSchema>;
    document_type: string;
    valid_from_epoch: number;
    valid_to_epoch: number;
  };
  metadataSha256: string;
  structuredInputSha256: string;
  inputTokens: number;
};

export type CustomCurrentMaterializedItem = {
  source: CustomCurrentSourcePlanItem;
  chunks: CustomRetrievalChunk[];
  denseItems: CustomCurrentDenseItem[];
  sparseRecords: CustomBm25IntermediateRecord[];
  documentFieldLengths: Array<{
    itemOrdinal: number;
    itemKey: string;
    segmentId: string;
    title: number;
    hierarchy: number;
    article: number;
    text: number;
  }>;
};

const sparsePartitions = "0123456789abcdef".split("");

export function partitionCustomBm25IntermediateRecords(
  records: readonly CustomBm25IntermediateRecord[],
): Record<string, CustomBm25IntermediateRecord[]> {
  const partitions = Object.fromEntries(sparsePartitions.map((partition) => [partition, []])) as
    Record<string, CustomBm25IntermediateRecord[]>;
  for (const record of records) {
    if (!/^[a-f0-9]{64}$/u.test(record.termHash)) {
      throw new TypeError("CUSTOM_CURRENT_SPARSE_TERM_HASH_INVALID");
    }
    partitions[record.termHash[0]!]!.push(record);
  }
  for (const recordsInPartition of Object.values(partitions)) {
    recordsInPartition.sort((left, right) => left.termHash.localeCompare(right.termHash)
      || left.itemOrdinal - right.itemOrdinal || left.field.localeCompare(right.field));
  }
  return partitions;
}

const encoder = new TextEncoder();

/** A lost creation response must reuse the immutable release's existing reduction. */
export async function ensureCustomCurrentReduction<T extends { releaseId: string }>(
  workflow: { create(input: { id: string; params: T }): Promise<unknown>;
    get(id: string): Promise<{ status(): Promise<unknown> }> }, payload: T,
): Promise<string> {
  const id = `reduce-${await customCurrentSha256(payload.releaseId)}`;
  try { await workflow.create({ id, params: payload }); }
  catch (error) {
    try { await (await workflow.get(id)).status(); }
    catch { throw error; }
  }
  return id;
}

export async function customCurrentSha256(value: Uint8Array | string): Promise<string> {
  const source = typeof value === "string" ? encoder.encode(value) : value;
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function epoch(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) throw new TypeError("CUSTOM_CURRENT_APPLICABILITY_INVALID");
  return Math.floor(milliseconds / 1_000);
}

export async function materializeCustomCurrentItem(input: {
  releaseId: string;
  segmentId?: string;
  planItem: CustomCurrentSourcePlanItem;
  evidenceBytes: Uint8Array;
  acceptedMetadata?: { documentTitle: string; articleNumber: string;
    articleTitle: string | null; hierarchy: string[] };
}): Promise<CustomCurrentMaterializedItem> {
  const source = sourcePlanItemSchema.parse(input.planItem);
  const segmentId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/u)
    .parse(input.segmentId ?? "current-base-v1");
  if (input.evidenceBytes.byteLength !== source.evidenceByteCount
    || await customCurrentSha256(input.evidenceBytes) !== source.evidenceSha256) {
    throw new TypeError("CUSTOM_CURRENT_EVIDENCE_INTEGRITY_FAILED");
  }
  let object: Pick<z.infer<typeof provisionObjectSchema>, "provisionRenditionId" | "languageTag"
    | "documentType" | "actTitle" | "articleNumber" | "articleTitle" | "provisionText">;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(input.evidenceBytes);
    if (source.accepted) {
      const accepted = source.accepted;
      if (!input.acceptedMetadata || accepted.legacyRenditionId !== source.provisionRenditionId
        || source.evidenceR2Key !== accepted.provision.key || source.evidenceSha256 !== accepted.provision.sha256
        || source.evidenceByteCount !== accepted.provision.sizeBytes || source.documentType !== "unknown") {
        throw new TypeError("CUSTOM_CURRENT_ACCEPTED_IDENTITY_FAILED");
      }
      const provisionText = accepted.provision.envelope
        ? z.object({ provisionText: z.string().min(1) }).parse(JSON.parse(text)).provisionText : text;
      if (await customCurrentSha256(provisionText) !== accepted.contentSha256) {
        throw new TypeError("CUSTOM_CURRENT_ACCEPTED_CONTENT_FAILED");
      }
      object = { provisionRenditionId: source.provisionRenditionId, languageTag: source.language,
        documentType: "unknown", actTitle: input.acceptedMetadata.documentTitle,
        articleNumber: input.acceptedMetadata.articleNumber, articleTitle: input.acceptedMetadata.articleTitle,
        provisionText };
    } else {
      object = provisionObjectSchema.parse(JSON.parse(text) as unknown);
    }
  } catch {
    throw new TypeError("CUSTOM_CURRENT_EVIDENCE_SCHEMA_FAILED");
  }
  if (object.provisionRenditionId !== source.provisionRenditionId
    || object.languageTag !== source.language
    || object.documentType !== source.documentType) {
    throw new TypeError("CUSTOM_CURRENT_EVIDENCE_IDENTITY_FAILED");
  }
  const validFromEpoch = epoch(source.validFrom);
  const validToEpoch = source.validTo === null ? null : epoch(source.validTo);
  const chunks = await buildRetrievalChunks({
    snapshotProvisionId: source.snapshotProvisionId,
    sourceDocumentTitle: object.actTitle,
    documentType: object.documentType,
    articleNumber: object.articleNumber,
    articleTitle: object.articleTitle,
    hierarchy: input.acceptedMetadata?.hierarchy ?? [],
    language: object.languageTag,
    script: object.languageTag === "uz-Latn" || object.languageTag === "en" ? "Latn" : "Cyrl",
    officialText: object.provisionText,
    validFromEpoch,
    validToEpoch,
  }, { targetTokens: 512 });
  if (chunks.length >= 1_000) throw new TypeError("CUSTOM_CURRENT_PROVISION_CHUNK_LIMIT");
  if (source.accepted) {
    if (chunks.length !== source.accepted.chunks.length) throw new TypeError("CUSTOM_CURRENT_ACCEPTED_CHUNK_MISMATCH");
    for (const [index, chunk] of chunks.entries()) {
      const expected = source.accepted.chunks[index]!;
      if (chunk.ordinal !== expected.ordinal || await customCurrentSha256(chunk.officialText) !== expected.officialTextSha256
        || await customCurrentSha256(serializeCustomEmbeddingInput(chunk)) !== expected.inputSha256
        || chunk.embeddingTokenCount !== expected.inputTokens) throw new TypeError("CUSTOM_CURRENT_ACCEPTED_CHUNK_MISMATCH");
    }
  }

  const denseItems: CustomCurrentDenseItem[] = [];
  const sparseRecords: CustomBm25IntermediateRecord[] = [];
  const documentFieldLengths: CustomCurrentMaterializedItem["documentFieldLengths"] = [];
  for (const chunk of chunks) {
    const itemOrdinal = customItemOrdinal(source.sourceOrdinal, chunk.ordinal);
    const metadata = {
      item_key: chunk.id,
      release_id: input.releaseId,
      snapshot_provision_id: source.snapshotProvisionId,
      language: chunk.language,
      document_type: chunk.documentType,
      valid_from_epoch: chunk.validFromEpoch,
      valid_to_epoch: chunk.validToEpoch ?? 253_402_300_799,
    };
    const serializedInput = serializeCustomEmbeddingInput(chunk);
    denseItems.push({
      chunk,
      vectorId: await customVectorId(chunk.id),
      metadata,
      metadataSha256: await customCurrentSha256(stableSourceSnapshotJson(metadata)),
      structuredInputSha256: await customCurrentSha256(serializedInput),
      inputTokens: chunk.embeddingTokenCount,
    });
    const sparse = await buildCustomBm25IntermediateRecords({
      segmentId,
      itemKey: chunk.id,
      language: chunk.language,
      documentType: chunk.documentType,
      validFromEpoch: chunk.validFromEpoch,
      validToEpoch: chunk.validToEpoch,
      fields: {
        title: chunk.sourceDocumentTitle,
        hierarchy: chunk.hierarchy.join("\n"),
        article: [chunk.articleNumber, chunk.articleTitle].filter(Boolean).join(" "),
        text: chunk.officialText,
      },
    }, itemOrdinal);
    sparseRecords.push(...sparse.records);
    documentFieldLengths.push({ itemOrdinal, itemKey: chunk.id, segmentId, ...sparse.fieldLengths });
  }
  return { source, chunks, denseItems, sparseRecords, documentFieldLengths };
}

export function serializeCustomCurrentArtifact(value: unknown): Uint8Array {
  return encoder.encode(`${stableSourceSnapshotJson(value)}\n`);
}
