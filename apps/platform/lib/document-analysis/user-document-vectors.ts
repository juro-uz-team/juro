import { z } from "zod";
import { recordProviderUsage } from "../ai/provider-usage";

const EMBEDDING_DIMENSIONS = 1536;
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large";
const EMBEDDING_BATCH_SIZE = 48;
const VECTOR_BATCH_SIZE = 100;
const MAX_CHUNKS = 300;
const CHUNK_CHAR_LIMIT = 3_200;
const CHUNK_OVERLAP = 400;

export const USER_DOCUMENT_VECTOR_ERROR_CODES = [
  "USER_DOCUMENT_VECTOR_NOT_FOUND",
  "USER_DOCUMENT_VECTOR_STATE_REJECTED",
  "USER_DOCUMENT_VECTOR_CONFIGURATION_UNAVAILABLE",
  "USER_DOCUMENT_VECTOR_OBJECT_INVALID",
  "USER_DOCUMENT_VECTOR_EMBEDDING_FAILED",
  "USER_DOCUMENT_VECTOR_USAGE_PERSISTENCE_FAILED",
  "USER_DOCUMENT_VECTOR_MUTATION_FAILED",
  "USER_DOCUMENT_VECTOR_PERSISTENCE_FAILED",
] as const;

export class UserDocumentVectorError extends Error {
  constructor(
    readonly code: (typeof USER_DOCUMENT_VECTOR_ERROR_CODES)[number],
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "UserDocumentVectorError";
  }
}

export type UserDocumentVectorEnv = Pick<
  Env,
  "APP_ENV" | "DB" | "BUCKET" | "USER_DOCUMENTS_INDEX"
> & {
  OPENAI_API_KEY?: string;
  EMBEDDING_MODEL?: string;
};

type IndexJobRow = {
  id: string;
  analysisId: string;
  documentVersionId: string;
  workspaceId: string;
  ownerUserId: string;
  sourceHash: string;
  language: "ru" | "uz" | "mixed" | "unknown";
  accessScope: "owner" | "workspace";
  status: string;
  attemptCount: number;
  r2Key: string;
  sizeBytes: number;
  version: number;
  fileName: string;
  caseId: string | null;
};

type Chunk = {
  index: number;
  start: number;
  end: number;
  text: string;
};

type SearchLedgerRow = {
  vectorId: string;
  chunkIndex: number;
  charStart: number;
  charEnd: number;
  page: number;
  jobId: string;
  analysisId: string;
  documentVersionId: string;
  workspaceId: string;
  ownerUserId: string;
  sourceHash: string;
  language: string;
  accessScope: string;
  r2Key: string;
  sizeBytes: number;
  fileName: string;
  caseId: string | null;
  uploadedAt: string;
};

export type UserDocumentSearchResult = {
  type: "document-content";
  id: string;
  analysisId: string;
  documentVersionId: string;
  title: string;
  subtitle: string;
  snippet: string;
  score: number;
  caseId: string | null;
  page: number | null;
};

/**
 * Server-only evidence used to ground factual statements from a user's own
 * document. Public search results deliberately omit the authorization and
 * integrity fields below.
 */
export type UserDocumentSearchEvidence = UserDocumentSearchResult & {
  workspaceId: string;
  ownerUserId: string;
  sourceHash: string;
  language: "ru" | "uz" | "mixed" | "unknown";
  accessScope: "owner" | "workspace";
  uploadedAt: string;
};

const embeddingResponseSchema = z.object({
  object: z.literal("list"),
  model: z.string().trim().min(1).max(120),
  data: z.array(z.object({
    object: z.literal("embedding").optional(),
    index: z.number().int().nonnegative(),
    embedding: z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative(),
  }).strict(),
}).strict();

function retryableProviderStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function checksumHex(value: ArrayBuffer | undefined): string | null {
  if (!value) return null;
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function createEmbeddings(
  env: Pick<UserDocumentVectorEnv, "APP_ENV" | "DB" | "OPENAI_API_KEY" | "EMBEDDING_MODEL">,
  inputs: readonly string[],
  fetchImpl: typeof fetch,
  usage: { workspaceId: string; userId: string; feature: "document_indexing" | "document_search" },
  signal?: AbortSignal,
): Promise<number[][]> {
  if (!env.OPENAI_API_KEY) {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_CONFIGURATION_UNAVAILABLE", false);
  }
  const startedAt = new Date().toISOString();
  const requestedModel = env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  const recordFailure = async (errorCode: string): Promise<void> => {
    try {
      await recordProviderUsage({
        db: env.DB,
        environment: env.APP_ENV,
        workspaceId: usage.workspaceId,
        userId: usage.userId,
        feature: usage.feature,
        operation: "embeddings",
        provider: "openai",
        model: requestedModel,
        inputTokens: 0,
        itemCount: inputs.length,
        dimensions: EMBEDDING_DIMENSIONS,
        status: "failed",
        errorCode,
        startedAt,
        completedAt: new Date().toISOString(),
      });
    } catch {
      throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_USAGE_PERSISTENCE_FAILED", true);
    }
  };
  let response: Response;
  try {
    response = await fetchImpl("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: requestedModel,
        input: inputs,
        dimensions: EMBEDDING_DIMENSIONS,
        encoding_format: "float",
      }),
      signal,
    });
  } catch {
    await recordFailure("PROVIDER_NETWORK_ERROR");
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_EMBEDDING_FAILED", true);
  }
  if (!response.ok) {
    const status = response.status;
    await response.body?.cancel().catch(() => undefined);
    await recordFailure(`PROVIDER_HTTP_${status}`);
    throw new UserDocumentVectorError(
      "USER_DOCUMENT_VECTOR_EMBEDDING_FAILED",
      retryableProviderStatus(status),
    );
  }
  let parsed: z.infer<typeof embeddingResponseSchema>;
  try {
    parsed = embeddingResponseSchema.parse(await response.json());
  } catch {
    await recordFailure("PROVIDER_RESPONSE_INVALID");
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_EMBEDDING_FAILED", false);
  }
  if (
    parsed.data.length !== inputs.length
    || parsed.data.some((item, index) => item.index !== index)
    || parsed.usage.total_tokens < parsed.usage.prompt_tokens
  ) {
    await recordFailure("PROVIDER_RESPONSE_INVALID");
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_EMBEDDING_FAILED", false);
  }
  try {
    await recordProviderUsage({
      db: env.DB,
      environment: env.APP_ENV,
      workspaceId: usage.workspaceId,
      userId: usage.userId,
      feature: usage.feature,
      operation: "embeddings",
      provider: "openai",
      model: parsed.model,
      providerRequestId: response.headers.get("x-request-id"),
      inputTokens: parsed.usage.prompt_tokens,
      itemCount: inputs.length,
      dimensions: EMBEDDING_DIMENSIONS,
      status: "succeeded",
      startedAt,
      completedAt: new Date().toISOString(),
    });
  } catch {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_USAGE_PERSISTENCE_FAILED", true);
  }
  return parsed.data.map((item) => item.embedding);
}

export function chunkUserDocument(text: string): Chunk[] {
  const firstContent = text.search(/\S/u);
  if (firstContent < 0) return [];
  let contentEnd = text.length;
  while (contentEnd > firstContent && /\s/u.test(text[contentEnd - 1] ?? "")) contentEnd -= 1;
  const chunks: Chunk[] = [];
  let start = firstContent;
  while (start < contentEnd && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + CHUNK_CHAR_LIMIT, contentEnd);
    if (end < contentEnd) {
      const boundary = Math.max(
        text.lastIndexOf("\n", end),
        text.lastIndexOf(". ", end),
        text.lastIndexOf(" ", end),
      );
      if (boundary > start + Math.floor(CHUNK_CHAR_LIMIT * 0.6)) end = boundary + 1;
    }
    const chunkText = text.slice(start, end).replace(/\r\n?/g, "\n").trim();
    if (chunkText) chunks.push({ index: chunks.length, start, end, text: chunkText });
    if (end >= contentEnd) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  if (start < contentEnd && chunks.length >= MAX_CHUNKS) {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_STATE_REJECTED", false);
  }
  return chunks;
}

export function scheduleUserDocumentIndexStatements(
  db: D1Database,
  input: {
    analysisId: string;
    documentVersionId: string;
    workspaceId: string;
    ownerUserId: string;
    sourceHash: string;
    language: "ru" | "uz" | "mixed" | "unknown";
    now: string;
  },
): D1PreparedStatement[] {
  const jobId = `user-document-index-${input.documentVersionId}`;
  const idempotencyKey = `user-document-index:${input.documentVersionId}:${input.sourceHash.slice(0, 16)}`;
  return [
    db.prepare(
      `INSERT OR IGNORE INTO user_document_index_jobs
       (id,analysis_id,document_version_id,workspace_id,owner_user_id,source_hash,language,
        access_scope,status,chunk_count,attempt_count,mutation_id,error_code,started_at,
        submitted_at,deleted_at,created_at,updated_at)
       VALUES (?,?,?,?,?, ?,?,'owner','queued',0,0,NULL,NULL,NULL,NULL,NULL,?,?)`,
    ).bind(
      jobId,
      input.analysisId,
      input.documentVersionId,
      input.workspaceId,
      input.ownerUserId,
      input.sourceHash,
      input.language,
      input.now,
      input.now,
    ),
    db.prepare(
      `INSERT OR IGNORE INTO job_outbox
       (id,queue_binding,job_type,schema_version,idempotency_key,subject_id,workspace_id,
        correlation_id,enqueued_at,available_at,status,dispatch_attempts,lease_owner,
        lease_expires_at,next_attempt_at,dispatched_at,error_code,created_at,updated_at)
       VALUES (?,'DOCUMENT_ANALYSIS_QUEUE','document.index',1,?,?,?,? ,?,?,'pending',0,NULL,NULL,NULL,NULL,NULL,?,?)`,
    ).bind(
      `${jobId}-outbox`,
      idempotencyKey,
      jobId,
      input.workspaceId,
      `user-document-index-${input.analysisId}`,
      input.now,
      input.now,
      input.now,
      input.now,
    ),
  ];
}

/**
 * Private document indexing is an explicit corpus feature. Keeping the flag
 * check next to statement construction prevents an upload from being queued
 * when a deployment has not approved automatic private-corpus ingestion.
 */
export function scheduleTrustedUserDocumentIndexStatements(
  env: { DB: D1Database; LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST?: string },
  input: Parameters<typeof scheduleUserDocumentIndexStatements>[1],
): D1PreparedStatement[] {
  return env.LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST === "true"
    ? scheduleUserDocumentIndexStatements(env.DB, input)
    : [];
}

async function loadIndexJob(db: D1Database, jobId: string, workspaceId: string): Promise<IndexJobRow | null> {
  return db.prepare(
    `SELECT job.id,job.analysis_id AS analysisId,job.document_version_id AS documentVersionId,
      job.workspace_id AS workspaceId,job.owner_user_id AS ownerUserId,job.source_hash AS sourceHash,
      job.language,job.access_scope AS accessScope,job.status,job.attempt_count AS attemptCount,
      version.r2_key AS r2Key,version.size_bytes AS sizeBytes,version.version,version.file_name AS fileName,
      analysis.case_id AS caseId
     FROM user_document_index_jobs job
     JOIN analysis_document_versions version ON version.id=job.document_version_id
       AND version.analysis_id=job.analysis_id AND version.workspace_id=job.workspace_id
       AND version.owner_user_id=job.owner_user_id AND version.sha256=job.source_hash
     JOIN document_analyses analysis ON analysis.id=job.analysis_id
       AND analysis.workspace_id=job.workspace_id AND analysis.owner_user_id=job.owner_user_id
     WHERE job.id=? AND job.workspace_id=? AND analysis.status='completed' LIMIT 1`,
  ).bind(jobId, workspaceId).first<IndexJobRow>();
}

async function readVerifiedText(env: Pick<UserDocumentVectorEnv, "BUCKET">, row: IndexJobRow): Promise<string> {
  const object = await env.BUCKET.get(row.r2Key);
  if (!object || object.size !== Number(row.sizeBytes) || checksumHex(object.checksums.sha256) !== row.sourceHash) {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_OBJECT_INVALID", false);
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await object.arrayBuffer());
  } catch {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_OBJECT_INVALID", false);
  }
  if (await sha256(text) !== row.sourceHash) {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_OBJECT_INVALID", false);
  }
  return text;
}

async function vectorId(env: UserDocumentVectorEnv, row: IndexJobRow, chunkIndex: number): Promise<string> {
  const digest = await sha256([
    env.APP_ENV,
    row.workspaceId,
    row.documentVersionId,
    String(chunkIndex),
    row.sourceHash,
  ].join("\n"));
  return `ud_${digest.slice(0, 61)}`;
}

function mutationId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as { mutationId?: unknown }).mutationId;
  return typeof candidate === "string" && candidate.length <= 180 ? candidate : null;
}

export async function executeUserDocumentIndexJob(
  env: UserDocumentVectorEnv,
  jobId: string,
  workspaceId: string,
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<{ status: "submitted" | "already_submitted"; jobId: string; chunks: number }> {
  const row = await loadIndexJob(env.DB, jobId, workspaceId);
  if (!row) throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_NOT_FOUND", false);
  if (row.status === "submitted") {
    return { status: "already_submitted", jobId, chunks: Number(await env.DB.prepare(
      "SELECT count(*) AS count FROM user_document_vector_chunks WHERE job_id=? AND status='submitted'",
    ).bind(jobId).first<{ count: number }>().then((item) => item?.count ?? 0)) };
  }
  if (!['queued', 'failed'].includes(row.status)) {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_STATE_REJECTED", false);
  }
  const now = (options.now ?? new Date()).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE user_document_index_jobs SET status='processing',attempt_count=attempt_count+1,
      error_code=NULL,started_at=?,updated_at=? WHERE id=? AND workspace_id=? AND status IN ('queued','failed')`,
  ).bind(now, now, jobId, workspaceId).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_STATE_REJECTED", true);
  }

  try {
    const text = await readVerifiedText(env, row);
    const chunks = chunkUserDocument(text);
    if (chunks.length === 0) throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_OBJECT_INVALID", false);
    const vectorIds = await Promise.all(chunks.map((chunk) => vectorId(env, row, chunk.index)));
    // Persist every deterministic vector ID before the first external write.
    // A failed/aborted upsert therefore remains discoverable by account and
    // analysis retention instead of becoming an untracked Vectorize orphan.
    await env.DB.batch(chunks.map((chunk, index) => env.DB.prepare(
      `INSERT OR IGNORE INTO user_document_vector_chunks
       (id,job_id,vector_id,chunk_index,char_start,char_end,page,status,mutation_id,submitted_at,deleted_at)
       VALUES (?,?,?,?,?,?,0,'submitted',NULL,?,NULL)`,
    ).bind(
      `${jobId}:${chunk.index}`,
      jobId,
      vectorIds[index],
      chunk.index,
      chunk.start,
      chunk.end,
      now,
    )));
    let latestMutationId: string | null = null;
    for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
      const batch = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
      const embeddings = await createEmbeddings(
        env,
        batch.map((chunk) => chunk.text),
        options.fetchImpl ?? fetch,
        { workspaceId: row.workspaceId, userId: row.ownerUserId, feature: "document_indexing" },
      );
      try {
        const mutation = await env.USER_DOCUMENTS_INDEX.upsert(batch.map((chunk, offset) => ({
          id: vectorIds[start + offset]!,
          namespace: row.workspaceId,
          values: embeddings[offset]!,
          metadata: {
            environment: env.APP_ENV,
            userId: row.ownerUserId,
            workspaceId: row.workspaceId,
            caseId: row.caseId ?? "",
            documentId: row.analysisId,
            documentVersionId: row.documentVersionId,
            accessScope: row.accessScope,
            language: row.language,
            page: 0,
            sourceHash: row.sourceHash,
          },
        })));
        latestMutationId = mutationId(mutation) ?? latestMutationId;
      } catch {
        throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_MUTATION_FAILED", true);
      }
    }

    const statements: D1PreparedStatement[] = chunks.map((chunk, index) => env.DB.prepare(
      `UPDATE user_document_vector_chunks
       SET mutation_id=?,submitted_at=?,deleted_at=NULL
       WHERE id=? AND job_id=? AND vector_id=? AND chunk_index=? AND status='submitted'`,
    ).bind(
      latestMutationId,
      now,
      `${jobId}:${chunk.index}`,
      jobId,
      vectorIds[index],
      chunk.index,
    ));
    statements.push(env.DB.prepare(
      `UPDATE user_document_index_jobs SET status='submitted',chunk_count=?,mutation_id=?,
       submitted_at=?,error_code=NULL,updated_at=? WHERE id=? AND workspace_id=? AND status='processing'`,
    ).bind(chunks.length, latestMutationId, now, now, jobId, workspaceId));
    statements.push(env.DB.prepare(
      `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       VALUES (?,?,?,'analysis_document_version',?,'user_document_vectors_submitted',?,?)`,
    ).bind(
      crypto.randomUUID(),
      row.workspaceId,
      row.ownerUserId,
      row.documentVersionId,
      JSON.stringify({ analysisId: row.analysisId, chunkCount: chunks.length, mutationId: latestMutationId }),
      now,
    ));
    await env.DB.batch(statements);
    await deleteSupersededVectors(env, row, now);
    return { status: "submitted", jobId, chunks: chunks.length };
  } catch (error) {
    const normalized = error instanceof UserDocumentVectorError
      ? error
      : new UserDocumentVectorError("USER_DOCUMENT_VECTOR_PERSISTENCE_FAILED", true);
    await env.DB.prepare(
      `UPDATE user_document_index_jobs SET status='failed',error_code=?,updated_at=?
       WHERE id=? AND workspace_id=? AND status='processing'`,
    ).bind(normalized.code, now, jobId, workspaceId).run().catch(() => undefined);
    throw normalized;
  }
}

async function deleteSupersededVectors(env: UserDocumentVectorEnv, current: IndexJobRow, now: string): Promise<void> {
  const rows = await env.DB.prepare(
    `SELECT chunk.vector_id AS vectorId,job.id AS jobId
     FROM user_document_index_jobs job
     JOIN analysis_document_versions version ON version.id=job.document_version_id
     JOIN user_document_vector_chunks chunk ON chunk.job_id=job.id AND chunk.status='submitted'
     WHERE job.analysis_id=? AND job.workspace_id=? AND job.id<>? AND job.status='submitted'
       AND version.version<? ORDER BY version.version,chunk.chunk_index`,
  ).bind(current.analysisId, current.workspaceId, current.id, current.version).all<{ vectorId: string; jobId: string }>();
  if (rows.results.length === 0) return;
  let latestMutationId: string | null = null;
  for (let start = 0; start < rows.results.length; start += VECTOR_BATCH_SIZE) {
    try {
      const mutation = await env.USER_DOCUMENTS_INDEX.deleteByIds(
        rows.results.slice(start, start + VECTOR_BATCH_SIZE).map((item) => item.vectorId),
      );
      latestMutationId = mutationId(mutation) ?? latestMutationId;
    } catch {
      return;
    }
  }
  const jobIds = [...new Set(rows.results.map((item) => item.jobId))];
  await env.DB.batch([
    ...rows.results.map((item) => env.DB.prepare(
      "UPDATE user_document_vector_chunks SET status='delete_submitted',mutation_id=?,deleted_at=? WHERE vector_id=? AND status='submitted'",
    ).bind(latestMutationId, now, item.vectorId)),
    ...jobIds.map((oldJobId) => env.DB.prepare(
      "UPDATE user_document_index_jobs SET status='delete_submitted',mutation_id=?,deleted_at=?,updated_at=? WHERE id=? AND status='submitted'",
    ).bind(latestMutationId, now, now, oldJobId)),
  ]);
}

function metadataString(metadata: Record<string, VectorizeVectorMetadata> | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" ? value : null;
}

function metadataNumber(metadata: Record<string, VectorizeVectorMetadata> | undefined, key: string): number | null {
  const value = metadata?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function searchUserDocumentEvidence(
  env: UserDocumentVectorEnv,
  input: { workspaceId: string; userId: string; query: string; limit?: number; caseId?: string | null },
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<UserDocumentSearchEvidence[]> {
  const query = input.query.normalize("NFKC").trim().slice(0, 500);
  if (query.length < 2) return [];
  const membership = await env.DB.prepare(
    "SELECT 1 AS found FROM workspace_members WHERE workspace_id=? AND user_id=? AND status='active' LIMIT 1",
  ).bind(input.workspaceId, input.userId).first<{ found: number }>();
  if (!membership?.found) return [];
  const [embedding] = await createEmbeddings(
    env,
    [query],
    options.fetchImpl ?? fetch,
    { workspaceId: input.workspaceId, userId: input.userId, feature: "document_search" },
    options.signal,
  );
  let matches: VectorizeMatches;
  try {
    matches = await env.USER_DOCUMENTS_INDEX.query(embedding!, {
      namespace: input.workspaceId,
      topK: Math.min(Math.max((input.limit ?? 6) * 4, 8), 40),
      returnMetadata: "all",
      returnValues: false,
    });
  } catch {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_MUTATION_FAILED", true);
  }
  if (matches.matches.length === 0) return [];
  const ids = matches.matches.map((match) => match.id);
  const placeholders = ids.map(() => "?").join(",");
  const ledger = await env.DB.prepare(
    `SELECT chunk.vector_id AS vectorId,chunk.chunk_index AS chunkIndex,chunk.char_start AS charStart,
      chunk.char_end AS charEnd,chunk.page,job.id AS jobId,job.analysis_id AS analysisId,
      job.document_version_id AS documentVersionId,job.workspace_id AS workspaceId,
      job.owner_user_id AS ownerUserId,job.source_hash AS sourceHash,job.language,
      job.access_scope AS accessScope,version.r2_key AS r2Key,version.size_bytes AS sizeBytes,
      version.file_name AS fileName,version.created_at AS uploadedAt,analysis.case_id AS caseId
     FROM user_document_vector_chunks chunk
     JOIN user_document_index_jobs job ON job.id=chunk.job_id AND job.status='submitted'
     JOIN analysis_document_versions version ON version.id=job.document_version_id
       AND version.analysis_id=job.analysis_id AND version.workspace_id=job.workspace_id
       AND version.owner_user_id=job.owner_user_id AND version.sha256=job.source_hash
     JOIN document_analyses analysis ON analysis.id=job.analysis_id
       AND analysis.workspace_id=job.workspace_id AND analysis.owner_user_id=job.owner_user_id
     WHERE chunk.vector_id IN (${placeholders}) AND chunk.status='submitted'
       AND job.workspace_id=? AND analysis.status='completed'
       AND (job.access_scope='workspace' OR (job.access_scope='owner' AND job.owner_user_id=?))
       AND (? IS NULL OR analysis.case_id=?)
       AND version.version=(SELECT max(latest.version) FROM analysis_document_versions latest
         WHERE latest.analysis_id=job.analysis_id AND latest.workspace_id=job.workspace_id)
     LIMIT 80`,
  ).bind(...ids, input.workspaceId, input.userId, input.caseId ?? null, input.caseId ?? null).all<SearchLedgerRow>();
  const byVector = new Map(ledger.results.map((row) => [row.vectorId, row]));
  const textCache = new Map<string, string>();
  const results: UserDocumentSearchEvidence[] = [];
  for (const match of matches.matches) {
    const row = byVector.get(match.id);
    if (!row) continue;
    const metadata = match.metadata;
    if (
      metadataString(metadata, "environment") !== env.APP_ENV
      || metadataString(metadata, "userId") !== row.ownerUserId
      || metadataString(metadata, "workspaceId") !== row.workspaceId
      || metadataString(metadata, "documentId") !== row.analysisId
      || metadataString(metadata, "documentVersionId") !== row.documentVersionId
      || metadataString(metadata, "accessScope") !== row.accessScope
      || metadataString(metadata, "language") !== row.language
      || metadataString(metadata, "sourceHash") !== row.sourceHash
      || metadataNumber(metadata, "page") !== Number(row.page)
    ) continue;
    let text = textCache.get(row.r2Key);
    if (text === undefined) {
      const object = await env.BUCKET.get(row.r2Key);
      if (!object || object.size !== Number(row.sizeBytes) || checksumHex(object.checksums.sha256) !== row.sourceHash) continue;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(await object.arrayBuffer());
      } catch {
        continue;
      }
      if (await sha256(text) !== row.sourceHash) continue;
      textCache.set(row.r2Key, text);
    }
    const snippet = text.slice(Number(row.charStart), Number(row.charEnd)).trim();
    if (!snippet) continue;
    results.push({
      type: "document-content",
      id: row.vectorId,
      analysisId: row.analysisId,
      documentVersionId: row.documentVersionId,
      title: row.fileName,
      subtitle: row.caseId ? "Содержимое документа · связано с делом" : "Содержимое документа",
      snippet: snippet.slice(0, CHUNK_CHAR_LIMIT),
      score: Number(match.score),
      caseId: row.caseId,
      page: Number(row.page) > 0 ? Number(row.page) : null,
      workspaceId: row.workspaceId,
      ownerUserId: row.ownerUserId,
      sourceHash: row.sourceHash,
      language: row.language === "ru" || row.language === "uz" || row.language === "mixed"
        ? row.language
        : "unknown",
      accessScope: row.accessScope === "workspace" ? "workspace" : "owner",
      uploadedAt: row.uploadedAt,
    });
    if (results.length >= Math.min(Math.max(input.limit ?? 6, 1), 10)) break;
  }
  return results;
}

export async function searchUserDocuments(
  env: UserDocumentVectorEnv,
  input: { workspaceId: string; userId: string; query: string; limit?: number },
  options: { fetchImpl?: typeof fetch; signal?: AbortSignal } = {},
): Promise<UserDocumentSearchResult[]> {
  const evidence = await searchUserDocumentEvidence(env, input, options);
  return evidence.map((result) => ({
    type: result.type,
    id: result.id,
    analysisId: result.analysisId,
    documentVersionId: result.documentVersionId,
    title: result.title,
    subtitle: result.subtitle,
    snippet: result.snippet.slice(0, 420),
    score: result.score,
    caseId: result.caseId,
    page: result.page,
  }));
}

export async function deleteUserDocumentVectorsForOwner(
  env: { DB: D1Database; USER_DOCUMENTS_INDEX?: VectorizeIndex },
  userId: string,
  now = new Date().toISOString(),
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT chunk.vector_id AS vectorId,job.id AS jobId
     FROM user_document_index_jobs job
     JOIN user_document_vector_chunks chunk ON chunk.job_id=job.id
     WHERE job.owner_user_id=? AND chunk.status IN ('submitted','delete_submitted')`,
  ).bind(userId).all<{ vectorId: string; jobId: string }>();
  if (rows.results.length === 0) return 0;
  if (!env.USER_DOCUMENTS_INDEX) {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_CONFIGURATION_UNAVAILABLE", true);
  }
  let latestMutationId: string | null = null;
  for (let start = 0; start < rows.results.length; start += VECTOR_BATCH_SIZE) {
    try {
      const mutation = await env.USER_DOCUMENTS_INDEX.deleteByIds(
        rows.results.slice(start, start + VECTOR_BATCH_SIZE).map((item) => item.vectorId),
      );
      latestMutationId = mutationId(mutation) ?? latestMutationId;
    } catch {
      throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_MUTATION_FAILED", true);
    }
  }
  const jobIds = [...new Set(rows.results.map((item) => item.jobId))];
  await env.DB.batch([
    ...rows.results.map((item) => env.DB.prepare(
      "UPDATE user_document_vector_chunks SET status='delete_submitted',mutation_id=?,deleted_at=? WHERE vector_id=?",
    ).bind(latestMutationId, now, item.vectorId)),
    ...jobIds.map((jobId) => env.DB.prepare(
      "UPDATE user_document_index_jobs SET status='delete_submitted',mutation_id=?,deleted_at=?,updated_at=? WHERE id=?",
    ).bind(latestMutationId, now, now, jobId)),
  ]);
  return rows.results.length;
}

export async function deleteUserDocumentVectorsForAnalysis(
  env: { DB: D1Database; USER_DOCUMENTS_INDEX?: VectorizeIndex },
  input: { analysisId: string; workspaceId: string; userId: string },
  now = new Date().toISOString(),
): Promise<number> {
  const rows = await env.DB.prepare(
    `SELECT chunk.vector_id AS vectorId,job.id AS jobId
     FROM user_document_index_jobs job
     JOIN user_document_vector_chunks chunk ON chunk.job_id=job.id
     WHERE job.analysis_id=? AND job.workspace_id=? AND job.owner_user_id=?
       AND chunk.status IN ('submitted','delete_submitted')
     ORDER BY job.id,chunk.chunk_index`,
  ).bind(input.analysisId, input.workspaceId, input.userId).all<{ vectorId: string; jobId: string }>();
  if (rows.results.length === 0) return 0;
  if (!env.USER_DOCUMENTS_INDEX) {
    throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_CONFIGURATION_UNAVAILABLE", true);
  }
  let latestMutationId: string | null = null;
  for (let start = 0; start < rows.results.length; start += VECTOR_BATCH_SIZE) {
    const batchIds = rows.results.slice(start, start + VECTOR_BATCH_SIZE).map((item) => item.vectorId);
    try {
      const mutation = await env.USER_DOCUMENTS_INDEX.deleteByIds(batchIds);
      latestMutationId = mutationId(mutation) ?? latestMutationId;
      const remaining = await env.USER_DOCUMENTS_INDEX.getByIds(batchIds);
      if (remaining.length > 0) {
        throw new Error("VECTOR_DELETE_NOT_VISIBLE");
      }
    } catch {
      throw new UserDocumentVectorError("USER_DOCUMENT_VECTOR_MUTATION_FAILED", true);
    }
  }
  const jobIds = [...new Set(rows.results.map((item) => item.jobId))];
  await env.DB.batch([
    ...rows.results.map((item) => env.DB.prepare(
      "UPDATE user_document_vector_chunks SET status='delete_submitted',mutation_id=?,deleted_at=? WHERE vector_id=?",
    ).bind(latestMutationId, now, item.vectorId)),
    ...jobIds.map((jobId) => env.DB.prepare(
      "UPDATE user_document_index_jobs SET status='delete_submitted',mutation_id=?,deleted_at=?,updated_at=? WHERE id=?",
    ).bind(latestMutationId, now, now, jobId)),
  ]);
  return rows.results.length;
}
