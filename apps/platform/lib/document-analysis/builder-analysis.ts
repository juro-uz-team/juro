import { z } from "zod";
import { workspaceEntitlements } from "../billing/entitlements";
import { sanitizeFileName } from "../document-builder/storage/file-validation";
import { DOCUMENT_ANALYSIS_INLINE_TEXT_LIMIT } from "./limits";
import { DOCUMENT_ANALYSIS_ABANDONED_AFTER_MS } from "./upload-pipeline";

export const builderAnalysisRequestSchema = z.object({
  mode: z.enum(["quick", "full", "expert"]),
  locale: z.enum(["ru", "uz"]),
}).strict();

export const builderAnalysisIdempotencyKeySchema = z.string().min(16).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u);

export type BuilderAnalysisMode = z.infer<typeof builderAnalysisRequestSchema>["mode"];

export class BuilderAnalysisError extends Error {
  constructor(
    readonly code:
      | "BUILDER_ANALYSIS_NOT_FOUND"
      | "BUILDER_ANALYSIS_INVALID_DOCUMENT"
      | "BUILDER_ANALYSIS_TOO_LARGE"
      | "BUILDER_ANALYSIS_PLAN_LIMIT"
      | "BUILDER_ANALYSIS_CAPACITY_UNAVAILABLE"
      | "BUILDER_ANALYSIS_IDEMPOTENCY_CONFLICT"
      | "BUILDER_ANALYSIS_STORAGE_FAILED"
      | "BUILDER_ANALYSIS_PERSISTENCE_FAILED",
    readonly status: number,
  ) {
    super(code);
    this.name = "BuilderAnalysisError";
  }
}

type BuilderDocumentRow = {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  title: string;
  language: string;
  revision: number;
  caseId: string | null;
  finalContent: string;
};

type HandoffRow = {
  id: string;
  workspaceId: string;
  userId: string;
  documentId: string;
  documentRevision: number;
  documentContentSha256: string;
  fileId: string;
  analysisId: string;
  mode: BuilderAnalysisMode;
  locale: "ru" | "uz";
  status: "pending" | "ready";
  attemptCount: number;
  r2Key: string;
  fileName: string;
  sizeBytes: number;
};

export type BuilderAnalysisResult = {
  analysisId: string;
  fileId: string;
  documentId: string;
  documentRevision: number;
  status: "queued";
  replayed: boolean;
};

export async function startBuilderDocumentAnalysis(input: {
  db: D1Database;
  bucket: R2Bucket;
  workspaceId: string;
  userId: string;
  documentId: string;
  mode: BuilderAnalysisMode;
  locale: "ru" | "uz";
  idempotencyKey: string;
}): Promise<BuilderAnalysisResult> {
  await assertEntitled(input.db, input.workspaceId, input.mode);
  const document = await loadDocument(input.db, input.documentId, input.workspaceId, input.userId);
  if (!document) throw new BuilderAnalysisError("BUILDER_ANALYSIS_NOT_FOUND", 404);
  const text = document.finalContent.normalize("NFKC").replace(/\r\n?/gu, "\n").trim();
  if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 24) {
    throw new BuilderAnalysisError("BUILDER_ANALYSIS_INVALID_DOCUMENT", 422);
  }
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > DOCUMENT_ANALYSIS_INLINE_TEXT_LIMIT) {
    throw new BuilderAnalysisError("BUILDER_ANALYSIS_TOO_LARGE", 413);
  }
  const [contentSha256, idempotencyKeySha256] = await Promise.all([
    sha256Hex(bytes),
    sha256Hex(new TextEncoder().encode(input.idempotencyKey)),
  ]);
  const expected = {
    documentId: document.id,
    documentRevision: Number(document.revision),
    documentContentSha256: contentSha256,
    mode: input.mode,
    locale: input.locale,
  };
  const existing = await loadHandoff(input.db, input.workspaceId, input.userId, idempotencyKeySha256);
  if (existing) {
    assertReplayMatches(existing, expected);
    if (existing.status === "ready") return publicResult(existing, true);
    return finalizeSnapshot(input.db, input.bucket, existing, bytes, true);
  }

  const analysisId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const handoffId = crypto.randomUUID();
  const now = new Date().toISOString();
  const abandonedAfter = new Date(Date.parse(now) + DOCUMENT_ANALYSIS_ABANDONED_AFTER_MS).toISOString();
  const r2Key = `builder-analysis-snapshots/${input.workspaceId}/${document.id}/${analysisId}/${fileId}-r${document.revision}-${contentSha256}.md`;
  const fileName = snapshotFileName(document.title, Number(document.revision));
  const summaryJson = JSON.stringify({
    mode: input.mode,
    locale: input.locale,
    source: "document_builder",
    subscriptionAccounting: true,
    builderDocumentId: document.id,
    builderDocumentRevision: Number(document.revision),
  });
  const handoff: HandoffRow = {
    id: handoffId,
    workspaceId: input.workspaceId,
    userId: input.userId,
    documentId: document.id,
    documentRevision: Number(document.revision),
    documentContentSha256: contentSha256,
    fileId,
    analysisId,
    mode: input.mode,
    locale: input.locale,
    status: "pending",
    attemptCount: 0,
    r2Key,
    fileName,
    sizeBytes: bytes.byteLength,
  };
  const statements: D1PreparedStatement[] = [
    input.db.prepare(
      `INSERT INTO document_files
       (id,workspace_id,document_id,owner_user_id,kind,r2_key,file_name,mime_type,size_bytes,sha256,archived_at,created_at,updated_at)
       VALUES (?,?,?,?,'analysis_snapshot_pending',?,?,'text/markdown; charset=utf-8',?,?,NULL,?,?)`,
    ).bind(fileId, input.workspaceId, document.id, input.userId, r2Key, fileName, bytes.byteLength, contentSha256, now, now),
    input.db.prepare(
      `INSERT INTO document_analyses
       (id,workspace_id,owner_user_id,uploaded_file_id,status,summary_json,error_code,consent_version,resource_scope,abandoned_after,created_at,updated_at)
       VALUES (?,?,?,?,'initiated',?,NULL,'2026-08-05','interactive_analysis',?,?,?)`,
    ).bind(analysisId, input.workspaceId, input.userId, fileId, summaryJson, abandonedAfter, now, now),
    input.db.prepare(
      `INSERT INTO builder_document_analysis_handoffs
       (id,workspace_id,user_id,document_id,document_revision,document_content_sha256,file_id,analysis_id,
        mode,locale,idempotency_key_sha256,status,attempt_count,last_error_code,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'pending',0,NULL,?,?)`,
    ).bind(
      handoffId, input.workspaceId, input.userId, document.id, document.revision,
      contentSha256, fileId, analysisId, input.mode, input.locale, idempotencyKeySha256, now, now,
    ),
    input.db.prepare(
      `INSERT INTO consents (id,user_id,workspace_id,type,version,scope_json,granted_at)
       VALUES (?,?,?,'document_analysis','2026-08-05',?,?)`,
    ).bind(crypto.randomUUID(), input.userId, input.workspaceId, JSON.stringify({
      analysisId, documentId: document.id, documentRevision: Number(document.revision), mode: input.mode, source: "document_builder",
    }), now),
    input.db.prepare(
      `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       VALUES (?,?,?,'document_analysis',?,'builder_analysis_requested',?,?)`,
    ).bind(crypto.randomUUID(), input.workspaceId, input.userId, analysisId, JSON.stringify({
      documentId: document.id, documentRevision: Number(document.revision), mode: input.mode, locale: input.locale,
      contentSha256, sizeBytes: bytes.byteLength,
    }), now),
  ];
  if (document.caseId) {
    statements.push(input.db.prepare(
      `INSERT INTO analysis_case_link_events
       (id,analysis_id,workspace_id,owner_user_id,actor_user_id,from_case_id,to_case_id,mutation_version,idempotency_key,request_hash,created_at)
       VALUES (?,?,?,?,?,NULL,?,1,?,?,?)`,
    ).bind(
      crypto.randomUUID(), analysisId, input.workspaceId, input.userId, input.userId,
      document.caseId, `builder-analysis-case:${analysisId}`, contentSha256, now,
    ));
  }
  try {
    await input.db.batch(statements);
  } catch (error) {
    const concurrent = await loadHandoff(input.db, input.workspaceId, input.userId, idempotencyKeySha256);
    if (concurrent) {
      assertReplayMatches(concurrent, expected);
      if (concurrent.status === "ready") return publicResult(concurrent, true);
      return finalizeSnapshot(input.db, input.bucket, concurrent, bytes, true);
    }
    if (isDocumentAnalysisQuotaError(error)) {
      throw withCause(new BuilderAnalysisError("BUILDER_ANALYSIS_CAPACITY_UNAVAILABLE", 429), error);
    }
    throw withCause(new BuilderAnalysisError("BUILDER_ANALYSIS_PERSISTENCE_FAILED", 503), error);
  }
  return finalizeSnapshot(input.db, input.bucket, handoff, bytes, false);
}

function isDocumentAnalysisQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("DOCUMENT_ANALYSIS_COUNT_QUOTA_EXCEEDED")
    || message.includes("DOCUMENT_ANALYSIS_BYTE_QUOTA_EXCEEDED")
    || message.includes("DOCUMENT_ANALYSIS_RETENTION_REQUIRED");
}

async function finalizeSnapshot(
  db: D1Database,
  bucket: R2Bucket,
  handoff: HandoffRow,
  bytes: Uint8Array,
  replayed: boolean,
): Promise<BuilderAnalysisResult> {
  try {
    await putVerifiedSnapshot(bucket, handoff, bytes);
  } catch (error) {
    await recordFailure(db, handoff, "R2_SNAPSHOT_WRITE_FAILED").catch(() => undefined);
    throw withCause(new BuilderAnalysisError("BUILDER_ANALYSIS_STORAGE_FAILED", 503), error);
  }
  const now = new Date().toISOString();
  const jobId = `builder-analysis:${handoff.analysisId}`;
  try {
    await db.batch([
      db.prepare(
        `UPDATE document_files SET kind='analysis_safe',updated_at=?
         WHERE id=? AND workspace_id=? AND owner_user_id=? AND document_id=?
           AND kind='analysis_snapshot_pending' AND sha256=?`,
      ).bind(now, handoff.fileId, handoff.workspaceId, handoff.userId, handoff.documentId, handoff.documentContentSha256),
      db.prepare(
        `UPDATE document_analyses SET status='ready',error_code=NULL,updated_at=?
         WHERE id=? AND workspace_id=? AND owner_user_id=? AND uploaded_file_id=? AND status='initiated'`,
      ).bind(now, handoff.analysisId, handoff.workspaceId, handoff.userId, handoff.fileId),
      db.prepare(
        `INSERT OR IGNORE INTO job_outbox
         (id,queue_binding,job_type,schema_version,idempotency_key,subject_id,workspace_id,
          correlation_id,enqueued_at,available_at,status,dispatch_attempts,created_at,updated_at)
         VALUES (?,'DOCUMENT_ANALYSIS_QUEUE','document.analyze',1,?,?,?, ?,?,?,'pending',0,?,?)`,
      ).bind(
        jobId, `${jobId}:${handoff.documentContentSha256.slice(0, 16)}`, handoff.analysisId,
        handoff.workspaceId, `builder:${handoff.documentId}:r${handoff.documentRevision}`, now, now, now, now,
      ),
      db.prepare(
        `UPDATE builder_document_analysis_handoffs
         SET status='ready',last_error_code=NULL,updated_at=?
         WHERE id=? AND status='pending'`,
      ).bind(now, handoff.id),
      db.prepare(
        `INSERT INTO workspace_audit_events
         (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'document_analysis',?,'builder_snapshot_queued',?,?)`,
      ).bind(crypto.randomUUID(), handoff.workspaceId, handoff.userId, handoff.analysisId, JSON.stringify({
        documentId: handoff.documentId, documentRevision: handoff.documentRevision,
        fileId: handoff.fileId, contentSha256: handoff.documentContentSha256,
      }), now),
    ]);
  } catch (error) {
    const concurrent = await loadHandoffById(db, handoff.id);
    if (concurrent?.status === "ready") return publicResult(concurrent, true);
    await recordFailure(db, handoff, "D1_SNAPSHOT_ATTACH_FAILED").catch(() => undefined);
    throw withCause(new BuilderAnalysisError("BUILDER_ANALYSIS_PERSISTENCE_FAILED", 503), error);
  }
  const ready = await loadHandoffById(db, handoff.id);
  if (!ready || ready.status !== "ready") {
    throw new BuilderAnalysisError("BUILDER_ANALYSIS_PERSISTENCE_FAILED", 503);
  }
  return publicResult(ready, replayed);
}

async function assertEntitled(db: D1Database, workspaceId: string, mode: BuilderAnalysisMode): Promise<void> {
  const entitlements = await workspaceEntitlements(db, workspaceId);
  if ((mode === "full" && !entitlements.fullDocumentAnalysis)
    || (mode === "expert" && !entitlements.expertDocumentAnalysis)) {
    throw new BuilderAnalysisError("BUILDER_ANALYSIS_PLAN_LIMIT", 403);
  }
}

async function loadDocument(
  db: D1Database,
  documentId: string,
  workspaceId: string,
  userId: string,
): Promise<BuilderDocumentRow | null> {
  return db.prepare(
    `SELECT document.id,document.workspace_id AS workspaceId,document.owner_user_id AS ownerUserId,
      document.title,document.language,document.revision,document.case_id AS caseId,
      content.final_content AS finalContent
     FROM documents document
     JOIN document_current_content content ON content.document_id=document.id
     JOIN workspace_members member ON member.workspace_id=document.workspace_id
       AND member.user_id=document.owner_user_id AND member.status='active'
     WHERE document.id=? AND document.workspace_id=? AND document.owner_user_id=?
       AND document.archived_at IS NULL LIMIT 1`,
  ).bind(documentId, workspaceId, userId).first<BuilderDocumentRow>();
}

async function loadHandoff(
  db: D1Database,
  workspaceId: string,
  userId: string,
  idempotencyKeySha256: string,
): Promise<HandoffRow | null> {
  return db.prepare(
    `SELECT handoff.id,handoff.workspace_id AS workspaceId,handoff.user_id AS userId,
      handoff.document_id AS documentId,handoff.document_revision AS documentRevision,
      handoff.document_content_sha256 AS documentContentSha256,handoff.file_id AS fileId,
      handoff.analysis_id AS analysisId,handoff.mode,handoff.locale,handoff.status,
      handoff.attempt_count AS attemptCount,file.r2_key AS r2Key,file.file_name AS fileName,
      file.size_bytes AS sizeBytes
     FROM builder_document_analysis_handoffs handoff
     JOIN document_files file ON file.id=handoff.file_id
     WHERE handoff.workspace_id=? AND handoff.user_id=? AND handoff.idempotency_key_sha256=? LIMIT 1`,
  ).bind(workspaceId, userId, idempotencyKeySha256).first<HandoffRow>();
}

async function loadHandoffById(db: D1Database, id: string): Promise<HandoffRow | null> {
  return db.prepare(
    `SELECT handoff.id,handoff.workspace_id AS workspaceId,handoff.user_id AS userId,
      handoff.document_id AS documentId,handoff.document_revision AS documentRevision,
      handoff.document_content_sha256 AS documentContentSha256,handoff.file_id AS fileId,
      handoff.analysis_id AS analysisId,handoff.mode,handoff.locale,handoff.status,
      handoff.attempt_count AS attemptCount,file.r2_key AS r2Key,file.file_name AS fileName,
      file.size_bytes AS sizeBytes
     FROM builder_document_analysis_handoffs handoff
     JOIN document_files file ON file.id=handoff.file_id WHERE handoff.id=? LIMIT 1`,
  ).bind(id).first<HandoffRow>();
}

function assertReplayMatches(
  row: HandoffRow,
  expected: Pick<HandoffRow, "documentId" | "documentRevision" | "documentContentSha256" | "mode" | "locale">,
): void {
  if (row.documentId !== expected.documentId
    || Number(row.documentRevision) !== expected.documentRevision
    || row.documentContentSha256 !== expected.documentContentSha256
    || row.mode !== expected.mode
    || row.locale !== expected.locale) {
    throw new BuilderAnalysisError("BUILDER_ANALYSIS_IDEMPOTENCY_CONFLICT", 409);
  }
}

async function putVerifiedSnapshot(bucket: R2Bucket, row: HandoffRow, bytes: Uint8Array): Promise<void> {
  let object = await bucket.head(row.r2Key);
  if (!object) {
    object = await bucket.put(row.r2Key, bytes, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      sha256: row.documentContentSha256,
      httpMetadata: { contentType: "text/markdown; charset=utf-8", cacheControl: "private, no-store" },
      customMetadata: {
        workspaceId: row.workspaceId,
        ownerUserId: row.userId,
        documentId: row.documentId,
        documentRevision: String(row.documentRevision),
        analysisId: row.analysisId,
        fileId: row.fileId,
        source: "document_builder",
      },
    }) ?? await bucket.head(row.r2Key);
  }
  if (!object || object.size !== bytes.byteLength || checksumHex(object.checksums.sha256) !== row.documentContentSha256) {
    throw new BuilderAnalysisError("BUILDER_ANALYSIS_STORAGE_FAILED", 503);
  }
}

async function recordFailure(db: D1Database, row: HandoffRow, code: string): Promise<void> {
  await db.prepare(
    `UPDATE builder_document_analysis_handoffs
     SET attempt_count=attempt_count+1,last_error_code=?,updated_at=?
     WHERE id=? AND status='pending'`,
  ).bind(code, new Date().toISOString(), row.id).run();
}

function publicResult(row: HandoffRow, replayed: boolean): BuilderAnalysisResult {
  return {
    analysisId: row.analysisId,
    fileId: row.fileId,
    documentId: row.documentId,
    documentRevision: Number(row.documentRevision),
    status: "queued",
    replayed,
  };
}

function snapshotFileName(title: string, revision: number): string {
  const safe = sanitizeFileName(title).replace(/\.[^.]+$/u, "").slice(0, 100) || "document";
  return `${safe}.snapshot-r${revision}.md`;
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  return checksumHex(await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer));
}

function checksumHex(value: ArrayBuffer | null | undefined): string {
  if (!value) return "";
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function withCause<T extends Error>(error: T, cause: unknown): T {
  (error as T & { cause?: unknown }).cause = cause;
  return error;
}
