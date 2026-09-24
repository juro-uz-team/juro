import { z } from "zod";
import {
  extractDocument,
  structureDocument,
} from "../document-comparison/extract";
import {
  LegalSourceParserError,
  normalizeLegalSourceHtml,
  normalizedLegalSourceSnapshotSchema,
  type NormalizedLegalSourceSnapshot,
} from "./source-parser";
import {
  LegalSourceFetchError,
  classifyLegalSourceUrl,
  fetchLexPdfRepresentation,
} from "./source-fetch";
import { reserveLegalSourceCrawlWindow } from "./crawl-window";

export const LEGAL_SOURCE_NORMALIZATION_ERROR_CODES = [
  "LEGAL_SOURCE_VERSION_NOT_FOUND",
  "LEGAL_SOURCE_VERSION_STATE_REJECTED",
  "LEGAL_SOURCE_NORMALIZATION_CONFLICT",
  "LEGAL_SOURCE_RAW_OBJECT_MISSING",
  "LEGAL_SOURCE_RAW_OBJECT_TOO_LARGE",
  "LEGAL_SOURCE_RAW_HASH_MISMATCH",
  "LEGAL_SOURCE_RAW_ENCODING_REJECTED",
  "LEGAL_SOURCE_NORMALIZATION_FAILED",
  "LEGAL_SOURCE_NORMALIZED_OBJECT_TOO_LARGE",
  "LEGAL_SOURCE_NORMALIZED_HASH_MISMATCH",
  "LEGAL_SOURCE_NORMALIZED_CONTENT_REJECTED",
  "LEGAL_SOURCE_NORMALIZED_STORAGE_FAILED",
  "LEGAL_SOURCE_NORMALIZED_PERSISTENCE_FAILED",
  "LEGAL_SOURCE_PDF_FETCH_FAILED",
  "LEGAL_SOURCE_PDF_EXTRACTION_FAILED",
] as const;

export type LegalSourceNormalizationErrorCode =
  (typeof LEGAL_SOURCE_NORMALIZATION_ERROR_CODES)[number];

export class LegalSourceNormalizationError extends Error {
  constructor(
    readonly code: LegalSourceNormalizationErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "LegalSourceNormalizationError";
  }
}

export type LegalSourceNormalizationEnv = Pick<Env, "APP_ENV" | "BUCKET" | "DB">;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type LegalSourceNormalizationResult = {
  versionId: string;
  parsedObjectKey: string;
  parsedContentSha256: string;
  blockCount: number;
  changed: boolean;
};

type VersionRow = {
  id: string;
  source_id: string;
  language: "ru" | "uz";
  status: string;
  content_sha256: string;
  raw_object_key: string;
  parsed_object_key: string | null;
  metadata_json: string;
  canonical_id: string | null;
  official_url: string;
  source_type: "lex" | "advice";
  verification_state: string;
};

const identifierSchema = z.string().min(1).max(180)
  .regex(/^[A-Za-z0-9:_-]+$/);
const metadataSchema = z.record(z.string(), z.unknown());
const normalizationMetadataSchema = z.object({
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  blockCount: z.number().int().nonnegative(),
}).passthrough();
const MAX_RAW_BYTES = 2 * 1024 * 1024;
const MAX_PARSED_BYTES = 4 * 1024 * 1024;
const MAX_METADATA_BYTES = 64 * 1024;

type PdfRepresentation = {
  contentSha256: string;
  objectKey: string;
  sourceUrl: string;
};

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestBytes = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestBytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_RAW_ENCODING_REJECTED",
      false,
    );
  }
}

function parseMetadata(value: string): Record<string, unknown> {
  if (new TextEncoder().encode(value).byteLength > MAX_METADATA_BYTES) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZATION_CONFLICT",
      false,
    );
  }
  try {
    return metadataSchema.parse(JSON.parse(value));
  } catch (error) {
    if (error instanceof LegalSourceNormalizationError) throw error;
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZATION_CONFLICT",
      false,
    );
  }
}

async function loadVersion(
  db: D1Database,
  versionId: string,
): Promise<VersionRow | null> {
  return db.prepare(`
    SELECT
      version.id, version.source_id, version.language, version.status,
      version.content_sha256, version.raw_object_key,
      version.parsed_object_key, version.metadata_json,
      source.canonical_id, source.official_url, source.source_type,
      source.verification_state
    FROM legal_source_versions AS version
    INNER JOIN legal_sources AS source ON source.id = version.source_id
    WHERE version.id = ?
    LIMIT 1
  `).bind(versionId).first<VersionRow>();
}

async function requireStoredSnapshot(
  bucket: R2Bucket,
  key: string,
  expected: {
    contentSha256: string;
    row: VersionRow;
  },
): Promise<NormalizedLegalSourceSnapshot> {
  let object: R2ObjectBody | null;
  try {
    object = await bucket.get(key);
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_STORAGE_FAILED",
      true,
    );
  }
  if (!object) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_STORAGE_FAILED",
      true,
    );
  }
  if (object.size === 0 || object.size > MAX_PARSED_BYTES) {
    try {
      await object.body.cancel();
    } catch {
      // Cancellation is best effort after a size rejection.
    }
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_OBJECT_TOO_LARGE",
      false,
    );
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await object.arrayBuffer());
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_STORAGE_FAILED",
      true,
    );
  }
  if (
    bytes.byteLength === 0
    || bytes.byteLength > MAX_PARSED_BYTES
    || await sha256(bytes) !== expected.contentSha256
  ) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_HASH_MISMATCH",
      false,
    );
  }
  try {
    const snapshot = normalizedLegalSourceSnapshotSchema.parse(
      JSON.parse(decodeUtf8(bytes)),
    );
    if (
      snapshot.source.rawContentSha256 !== expected.row.content_sha256
      || snapshot.source.sourceKind !== expected.row.source_type
      || snapshot.source.locale !== expected.row.language
      || snapshot.source.canonicalId !== expected.row.canonical_id
      || snapshot.source.canonicalUrl !== expected.row.official_url
    ) {
      throw new TypeError("Normalized source identity does not match D1.");
    }
    return snapshot;
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_CONTENT_REJECTED",
      false,
    );
  }
}

export type StoredNormalizedLegalSource = {
  versionId: string;
  sourceId: string;
  sourceKind: "lex" | "advice";
  locale: "ru" | "uz";
  canonicalId: string;
  canonicalUrl: string;
  rawContentSha256: string;
  parsedContentSha256: string;
  snapshot: NormalizedLegalSourceSnapshot;
};

export async function loadStoredNormalizedLegalSource(
  env: LegalSourceNormalizationEnv,
  versionId: string,
): Promise<StoredNormalizedLegalSource> {
  identifierSchema.parse(versionId);
  const row = await loadVersion(env.DB, versionId);
  if (!row) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_VERSION_NOT_FOUND",
      false,
    );
  }
  if (!row.parsed_object_key || row.canonical_id === null) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_VERSION_STATE_REJECTED",
      false,
    );
  }
  const metadata = parseMetadata(row.metadata_json);
  const normalization = normalizationMetadataSchema.safeParse(
    metadata.normalization,
  );
  if (!normalization.success) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZATION_CONFLICT",
      false,
    );
  }
  const snapshot = await requireStoredSnapshot(
    env.BUCKET,
    row.parsed_object_key,
    {
      contentSha256: normalization.data.contentSha256,
      row,
    },
  );
  return {
    versionId: row.id,
    sourceId: row.source_id,
    sourceKind: row.source_type,
    locale: row.language,
    canonicalId: row.canonical_id,
    canonicalUrl: row.official_url,
    rawContentSha256: row.content_sha256,
    parsedContentSha256: normalization.data.contentSha256,
    snapshot,
  };
}

async function recordNormalizationReview(
  db: D1Database,
  row: VersionRow,
  now: string,
): Promise<void> {
  const digest = await sha256(new TextEncoder().encode(
    `${row.id}\nnormalization_failed`,
  ));
  await db.prepare(`
    INSERT INTO legal_review_queue (
      id, source_id, version_id, reason_code, confidence,
      status, assigned_to_user_id, decision, decided_at,
      created_at, updated_at
    ) VALUES (?, ?, ?, 'normalization_failed', 'low',
      'pending', NULL, NULL, NULL, ?, ?)
    ON CONFLICT(version_id, reason_code) DO NOTHING
  `).bind(
    `lsreview_${digest.slice(0, 32)}`,
    row.source_id,
    row.id,
    now,
    now,
  ).run();
}

async function storeLexPdfRepresentation(
  bucket: R2Bucket,
  input: {
    bytes: Uint8Array;
    contentSha256: string;
    locale: "ru" | "uz";
    canonicalId: string;
    sourceUrl: string;
    fetchedAt: string;
  },
): Promise<string> {
  const objectKey = [
    "legal-sources",
    "representations",
    "lex-pdf",
    input.locale,
    input.contentSha256.slice(0, 2),
    `${input.contentSha256}.pdf`,
  ].join("/");
  try {
    if (!await bucket.head(objectKey)) {
      const stored = await bucket.put(objectKey, input.bytes, {
        httpMetadata: {
          contentType: "application/pdf",
          cacheControl: "private, no-store",
        },
        customMetadata: {
          sourceKind: "lex",
          locale: input.locale,
          canonicalId: input.canonicalId,
          contentSha256: input.contentSha256,
          sourceUrl: input.sourceUrl,
          fetchedAt: input.fetchedAt,
        },
      });
      if (!stored) throw new TypeError("R2 did not persist Lex PDF.");
    }
    return objectKey;
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_STORAGE_FAILED",
      true,
    );
  }
}

const PDF_ANTI_COPY_WATERMARK = /Protected\s+by\s+PDF\s+Anti-Copy\s+Free\s*\(Upgrade\s+to\s+Pro\s+Version\s+to\s+Remove\s+the\s+Watermark\)/giu;

export async function normalizeLexPdfRepresentation(input: {
  bytes: Uint8Array;
  reference: ReturnType<typeof classifyLegalSourceUrl>;
  rawContentSha256: string;
  signal?:AbortSignal;
}): Promise<NormalizedLegalSourceSnapshot> {
  let extracted: Awaited<ReturnType<typeof extractDocument>>;
  try {
    extracted = await extractDocument({
      bytes: input.bytes,
      fileName: `lex-${input.reference.canonicalId.replace(/^-/, "")}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: input.bytes.byteLength,
      signal:input.signal,
    });
  } catch {
    input.signal?.throwIfAborted();
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_PDF_EXTRACTION_FAILED",
      false,
    );
  }
  // Some official court PDFs expose only a repeated anti-copy watermark to
  // text extraction while the legal content remains rendered as inaccessible
  // glyphs or images.  Such a file must never enter retrieval as if the
  // watermark were a legal provision.  If useful text remains, rebuild the
  // sections without the known non-legal overlay.
  const plainText = extracted.text
    .replace(PDF_ANTI_COPY_WATERMARK, " ")
    .replace(/\u00a0/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .replace(/[ \t]*\n[ \t]*/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
  const meaningfulCharacters = plainText.replace(/[^\p{L}\p{N}]/gu, "").length;
  const sections = structureDocument(plainText);
  const blocks = sections.map((section, index) => ({
    index,
    kind: section.heading === section.text ? "heading" as const : "paragraph" as const,
    ...(section.heading === section.text ? { headingLevel: 1 } : {}),
    text: section.text,
  }));
  if (
    blocks.length === 0
    || meaningfulCharacters < 24
    || plainText.length < 200
    || plainText.length > 1_000_000
  ) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_PDF_EXTRACTION_FAILED",
      false,
    );
  }
  const title = blocks.find((block) => block.kind === "heading")?.text
    ?? blocks[0]?.text.slice(0, 2_000)
    ?? `Lex.uz — document ${input.reference.canonicalId}`;
  return normalizedLegalSourceSnapshotSchema.parse({
    schemaVersion: 1,
    parser: {
      name: "unpdf",
      version: "1.8.0",
      profile: "juro-legal-pdf-v1",
    },
    source: {
      sourceKind: "lex",
      locale: input.reference.locale,
      canonicalId: input.reference.canonicalId,
      canonicalUrl: input.reference.canonicalUrl,
      rawContentSha256: input.rawContentSha256,
    },
    primarySelector: "lex-pdf",
    documentTitle: title.slice(0, 2_000),
    blocks,
    plainText,
  });
}

async function persistAdviceScenario(
  db: D1Database,
  row: VersionRow,
  snapshot: NormalizedLegalSourceSnapshot,
  parsedContentSha256: string,
  now: string,
): Promise<void> {
  if (row.source_type !== "advice" || row.canonical_id === null) return;
  const scenarioDigest = await sha256(new TextEncoder().encode(
    `${row.source_id}\nadvice-scenario`,
  ));
  const scenarioId = `advice_${scenarioDigest.slice(0, 32)}`;
  const versionDigest = await sha256(new TextEncoder().encode(
    `${scenarioId}\n${row.id}\n${parsedContentSha256}`,
  ));
  const scenarioVersionId = `advicever_${versionDigest.slice(0, 32)}`;
  const summary = snapshot.plainText.slice(0, 8_000);
  const writes: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO advice_scenarios (
        id,source_id,canonical_id,locale,source_url,title,status,current_version_id,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,'pending_review',NULL,?,?)
      ON CONFLICT(source_id) DO UPDATE SET
        canonical_id=excluded.canonical_id,locale=excluded.locale,source_url=excluded.source_url,
        title=excluded.title,updated_at=excluded.updated_at
      WHERE advice_scenarios.status='pending_review'
    `).bind(
      scenarioId,row.source_id,row.canonical_id,row.language,row.official_url,
      snapshot.documentTitle,now,now,
    ),
    db.prepare(`
      INSERT INTO scenario_versions (
        id,scenario_id,legal_source_version_id,title,summary_text,content_sha256,status,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,'pending_review',?,?)
      ON CONFLICT(legal_source_version_id) DO NOTHING
    `).bind(
      scenarioVersionId,scenarioId,row.id,snapshot.documentTitle,summary,
      parsedContentSha256,now,now,
    ),
  ];
  try {
    await db.batch(writes);
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_PERSISTENCE_FAILED",
      true,
    );
  }
}
export async function executeLegalSourceNormalization(
  env: LegalSourceNormalizationEnv,
  versionId: string,
  dependencies: { now?: () => Date; fetchImpl?: FetchLike } = {},
): Promise<LegalSourceNormalizationResult> {
  identifierSchema.parse(versionId);
  const row = await loadVersion(env.DB, versionId);
  if (!row) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_VERSION_NOT_FOUND",
      false,
    );
  }
  if (row.parsed_object_key) {
    const metadata = parseMetadata(row.metadata_json);
    const normalization = normalizationMetadataSchema.safeParse(
      metadata.normalization,
    );
    if (!normalization.success) {
      throw new LegalSourceNormalizationError(
        "LEGAL_SOURCE_NORMALIZATION_CONFLICT",
        false,
      );
    }
    const replaySnapshot = await requireStoredSnapshot(env.BUCKET, row.parsed_object_key, {
      contentSha256: normalization.data.contentSha256,
      row,
    });
    await persistAdviceScenario(
      env.DB,
      row,
      replaySnapshot,
      normalization.data.contentSha256,
      (dependencies.now ?? (() => new Date()))().toISOString(),
    );
    return {
      versionId: row.id,
      parsedObjectKey: row.parsed_object_key,
      parsedContentSha256: normalization.data.contentSha256,
      blockCount: normalization.data.blockCount,
      changed: false,
    };
  }
  if (row.status !== "pending_review" || row.verification_state === "rejected") {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_VERSION_STATE_REJECTED",
      false,
    );
  }

  let rawObject: R2ObjectBody | null;
  try {
    const candidate = await env.BUCKET.get(row.raw_object_key);
    rawObject = candidate && "body" in candidate ? candidate : null;
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_RAW_OBJECT_MISSING",
      true,
    );
  }
  if (!rawObject) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_RAW_OBJECT_MISSING",
      true,
    );
  }
  if (rawObject.size > MAX_RAW_BYTES) {
    try {
      await rawObject.body.cancel();
    } catch {
      // Cancellation is best effort after a size rejection.
    }
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_RAW_OBJECT_TOO_LARGE",
      false,
    );
  }

  let rawBytes: Uint8Array;
  try {
    rawBytes = new Uint8Array(await rawObject.arrayBuffer());
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_RAW_OBJECT_MISSING",
      true,
    );
  }
  if (rawBytes.byteLength === 0 || rawBytes.byteLength > MAX_RAW_BYTES) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_RAW_OBJECT_TOO_LARGE",
      false,
    );
  }
  if (await sha256(rawBytes) !== row.content_sha256) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_RAW_HASH_MISMATCH",
      false,
    );
  }

  let reference;
  try {
    reference = classifyLegalSourceUrl(row.official_url);
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZATION_CONFLICT",
      false,
    );
  }
  if (
    reference.sourceKind !== row.source_type
    || reference.locale !== row.language
    || reference.canonicalId !== row.canonical_id
  ) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZATION_CONFLICT",
      false,
    );
  }

  let snapshot: NormalizedLegalSourceSnapshot;
  const representationState: { pdf: PdfRepresentation | null } = { pdf: null };
  const now = (dependencies.now ?? (() => new Date()))().toISOString();
  const rawHtml = decodeUtf8(rawBytes);
  try {
    snapshot = normalizeLegalSourceHtml({
      html: rawHtml,
      reference,
      rawContentSha256: row.content_sha256,
    });
  } catch (error) {
    const expectedPdfPath = `/pdffile/${reference.canonicalId.replace(/^-/, "")}`;
    const canUseOfficialPdfRepresentation = row.source_type === "lex"
      && rawHtml.includes(expectedPdfPath);
    if (canUseOfficialPdfRepresentation) {
      try {
        const fetched = await fetchLexPdfRepresentation(row.official_url, {
          fetchImpl: dependencies.fetchImpl,
          now: () => new Date(now),
          wait: async (delayMs) => {
            const reserved = await reserveLegalSourceCrawlWindow({
              db: env.DB,
              environment: env.APP_ENV,
              host: reference.host,
              delayMs,
              now,
            });
            if (!reserved) {
              throw new LegalSourceFetchError(
                "LEGAL_SOURCE_CRAWL_WINDOW_BUSY",
                true,
              );
            }
          },
        });
        const objectKey = await storeLexPdfRepresentation(env.BUCKET, {
          bytes: fetched.bytes,
          contentSha256: fetched.contentSha256,
          locale: reference.locale,
          canonicalId: reference.canonicalId,
          sourceUrl: fetched.representationUrl,
          fetchedAt: fetched.fetchedAt,
        });
        snapshot = await normalizeLexPdfRepresentation({
          bytes: fetched.bytes,
          reference,
          rawContentSha256: row.content_sha256,
        });
        representationState.pdf = {
          contentSha256: fetched.contentSha256,
          objectKey,
          sourceUrl: fetched.representationUrl,
        };
      } catch (fallbackError) {
        if (
          fallbackError instanceof LegalSourceFetchError
          && fallbackError.retryable
        ) {
          throw new LegalSourceNormalizationError(
            "LEGAL_SOURCE_PDF_FETCH_FAILED",
            true,
          );
        }
        if (
          fallbackError instanceof LegalSourceNormalizationError
          && fallbackError.retryable
        ) {
          throw fallbackError;
        }
        try {
          await recordNormalizationReview(env.DB, row, now);
        } catch {
          throw new LegalSourceNormalizationError(
            "LEGAL_SOURCE_NORMALIZED_PERSISTENCE_FAILED",
            true,
          );
        }
        if (fallbackError instanceof LegalSourceNormalizationError) {
          throw fallbackError;
        }
        throw new LegalSourceNormalizationError(
          "LEGAL_SOURCE_PDF_FETCH_FAILED",
          false,
        );
      }
    } else if (error instanceof LegalSourceParserError) {
      try {
        await recordNormalizationReview(env.DB, row, now);
      } catch {
        throw new LegalSourceNormalizationError(
          "LEGAL_SOURCE_NORMALIZED_PERSISTENCE_FAILED",
          true,
        );
      }
      throw new LegalSourceNormalizationError(
        "LEGAL_SOURCE_NORMALIZATION_FAILED",
        false,
      );
    } else {
      throw error;
    }
  }

  const serialized = JSON.stringify(snapshot);
  const parsedBytes = new TextEncoder().encode(serialized);
  const parsedContentSha256 = await sha256(parsedBytes);
  const parsedObjectKey = [
    "legal-sources",
    "parsed",
    reference.sourceKind,
    reference.locale,
    row.content_sha256.slice(0, 2),
    row.content_sha256,
    `${snapshot.parser.name}-v1-${parsedContentSha256}.json`,
  ].join("/");

  try {
    if (!await env.BUCKET.head(parsedObjectKey)) {
      const stored = await env.BUCKET.put(parsedObjectKey, parsedBytes, {
        httpMetadata: {
          contentType: "application/json; charset=utf-8",
          cacheControl: "private, no-store",
        },
        customMetadata: {
          sourceKind: reference.sourceKind,
          locale: reference.locale,
          canonicalId: reference.canonicalId,
          rawContentSha256: row.content_sha256,
          parsedContentSha256,
          parserProfile: snapshot.parser.profile,
          parsedAt: now,
        },
      });
      if (!stored) throw new TypeError("R2 put did not persist parsed source.");
    }
  } catch {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZED_STORAGE_FAILED",
      true,
    );
  }
  await requireStoredSnapshot(env.BUCKET, parsedObjectKey, {
    contentSha256: parsedContentSha256,
    row,
  });

  const metadata = parseMetadata(row.metadata_json);
  const nextMetadata = JSON.stringify({
    ...metadata,
    normalization: {
      parser: snapshot.parser.name,
      parserVersion: snapshot.parser.version,
      profile: snapshot.parser.profile,
      contentSha256: parsedContentSha256,
      blockCount: snapshot.blocks.length,
      parsedAt: now,
      ...(representationState.pdf === null ? {} : {
        representation: {
          kind: "lex-pdf",
          contentSha256: representationState.pdf.contentSha256,
          objectKey: representationState.pdf.objectKey,
          sourceUrl: representationState.pdf.sourceUrl,
        },
      }),
    },
  });
  if (new TextEncoder().encode(nextMetadata).byteLength > MAX_METADATA_BYTES) {
    throw new LegalSourceNormalizationError(
      "LEGAL_SOURCE_NORMALIZATION_CONFLICT",
      false,
    );
  }

  const result = await env.DB.prepare(`
    UPDATE legal_source_versions
    SET parsed_object_key = ?, metadata_json = ?, updated_at = ?
    WHERE id = ? AND source_id = ? AND status = 'pending_review'
      AND parsed_object_key IS NULL AND content_sha256 = ?
  `).bind(
    parsedObjectKey,
    nextMetadata,
    now,
    row.id,
    row.source_id,
    row.content_sha256,
  ).run();
  if (Number(result.meta.changes ?? 0) !== 1) {
    const replay = await loadVersion(env.DB, row.id);
    if (replay?.parsed_object_key !== parsedObjectKey) {
      throw new LegalSourceNormalizationError(
        "LEGAL_SOURCE_NORMALIZED_PERSISTENCE_FAILED",
        true,
      );
    }
  }

  await persistAdviceScenario(env.DB, row, snapshot, parsedContentSha256, now);
  return {
    versionId: row.id,
    parsedObjectKey,
    parsedContentSha256,
    blockCount: snapshot.blocks.length,
    changed: Number(result.meta.changes ?? 0) === 1,
  };
}
