import { generateDocx } from "../document-builder/generation/docx";
import { generatePdf } from "../document-builder/generation/pdf";
import { AnalysisExportError } from "../document-analysis/exporter";
import { comparisonReportParagraphs } from "./report";
import { assertComparisonSourceFilesClean } from "./scan-evidence";
import { comparisonChanges, parsedSummary, verifiedSourcesForChanges } from "./storage";
import { ComparisonProcessingError, type ComparisonLocale } from "./types";

export type ComparisonExportFormat = "pdf" | "docx";

export type ComparisonExportRecord = {
  id: string;
  comparisonId: string;
  format: ComparisonExportFormat;
  status: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  sha256: string | null;
  errorCode: string | null;
  completedAt: string | null;
  createdAt: string;
};

type ComparisonExportRow = ComparisonExportRecord & {
  workspaceId: string;
  ownerUserId: string;
  r2Key: string | null;
  comparisonStatus: string;
  stage: string;
  locale: string;
  summaryJson: string | null;
  versionOneFileId: string;
  versionTwoFileId: string;
  caseId: string | null;
  versionOneName: string;
  versionTwoName: string;
  versionOneMimeType: string;
  versionTwoMimeType: string;
  versionOneSizeBytes: number;
  versionTwoSizeBytes: number;
  versionOneSha256: string | null;
  versionTwoSha256: string | null;
  versionOneJsonKey: string | null;
  versionTwoJsonKey: string | null;
  similarityPercent: number | null;
  overallRisk: string | null;
  aiStatus: string | null;
  modelName: string | null;
  modelVersion: string | null;
  comparisonErrorCode: string | null;
  updatedAt: string;
};

type DownloadRow = Pick<ComparisonExportRow,
  "id" | "comparisonId" | "workspaceId" | "ownerUserId" | "format" | "status" | "r2Key" |
  "fileName" | "mimeType" | "sizeBytes" | "sha256"
>;

const formatInfo = {
  pdf: { extension: "pdf", mimeType: "application/pdf" },
  docx: { extension: "docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
} as const;

const exportCopy: Record<ComparisonLocale, {
  title: string;
  footerLabel: string;
  pageLabel: string;
  totalLabel: string;
  documentLanguage: "ru-RU" | "uz-Latn-UZ" | "en-GB";
  templatePath: string;
  subject: string;
  keywords: string;
}> = {
  ru: {
    title: "JURO — отчёт о сравнении документов",
    footerLabel: "Создано в JURO",
    pageLabel: "Страница",
    totalLabel: "из",
    documentLanguage: "ru-RU",
    templatePath: "/document-templates/receipt-ru.docx",
    subject: "Отчёт JURO о сравнении документов",
    keywords: "JURO, сравнение документов, юридический отчёт",
  },
  uz: {
    title: "JURO — hujjatlarni taqqoslash hisoboti",
    footerLabel: "JURO’da yaratildi",
    pageLabel: "Sahifa",
    totalLabel: "/",
    documentLanguage: "uz-Latn-UZ",
    templatePath: "/document-templates/receipt-uz-cyrl.docx",
    subject: "JURO hujjatlarni taqqoslash hisoboti",
    keywords: "JURO, hujjatlarni taqqoslash, yuridik hisobot",
  },
  en: {
    title: "JURO — Document Comparison Report",
    footerLabel: "Created in JURO",
    pageLabel: "Page",
    totalLabel: "of",
    documentLanguage: "en-GB",
    // The generator replaces the body, footer and metadata; this asset supplies only the approved OOXML structure and JURO mark.
    templatePath: "/document-templates/receipt-ru.docx",
    subject: "JURO document comparison report",
    keywords: "JURO, document comparison, legal report",
  },
};

function comparisonExportLocale(value: string): ComparisonLocale {
  if (value === "uz" || value === "en") return value;
  return "ru";
}

export async function requestComparisonExport(input: {
  db: D1Database;
  comparisonId: string;
  workspaceId: string;
  userId: string;
  format: ComparisonExportFormat;
  idempotencyKey: string;
}): Promise<{ record: ComparisonExportRecord; replay: boolean }> {
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(input.idempotencyKey)) {
    throw new AnalysisExportError("ANALYSIS_EXPORT_IDEMPOTENCY_CONFLICT", false, 400);
  }
  const existing = await byIdempotency(input.db, input.idempotencyKey, input.workspaceId, input.userId);
  if (existing) {
    if (existing.comparisonId !== input.comparisonId || existing.format !== input.format) {
      throw new AnalysisExportError("ANALYSIS_EXPORT_IDEMPOTENCY_CONFLICT", false, 409);
    }
    return { record: existing, replay: true };
  }
  const source = await input.db.prepare(
    `SELECT id FROM document_comparisons
     WHERE id=? AND workspace_id=? AND owner_user_id=?
       AND status IN ('completed','completed_partial') AND deleted_at IS NULL LIMIT 1`,
  ).bind(input.comparisonId, input.workspaceId, input.userId).first<{ id: string }>();
  if (!source) throw new AnalysisExportError("ANALYSIS_EXPORT_NOT_READY", false, 409);

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const info = formatInfo[input.format];
  const fileName = `juro-comparison-${input.comparisonId}.${info.extension}`;
  try {
    await input.db.batch([
      input.db.prepare(
        `INSERT INTO comparison_exports
         (id,comparison_id,workspace_id,owner_user_id,format,status,r2_key,file_name,mime_type,size_bytes,
          sha256,idempotency_key,error_code,completed_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'queued',NULL,?,?,NULL,NULL,?,NULL,NULL,?,?)`,
      ).bind(id, input.comparisonId, input.workspaceId, input.userId, input.format, fileName, info.mimeType, input.idempotencyKey, now, now),
      input.db.prepare(
        `INSERT INTO job_outbox
         (id,queue_binding,job_type,schema_version,idempotency_key,subject_id,workspace_id,correlation_id,
          enqueued_at,available_at,status,dispatch_attempts,lease_owner,lease_expires_at,next_attempt_at,
          dispatched_at,error_code,created_at,updated_at)
         VALUES (?,'DOCUMENT_EXPORT_QUEUE','document.export',1,?,?,?, ?,?,?,'pending',0,NULL,NULL,NULL,NULL,NULL,?,?)`,
      ).bind(crypto.randomUUID(), `comparison-export:${id}`, id, input.workspaceId, `comparison-export-${id}`, now, now, now, now),
      input.db.prepare(
        `INSERT INTO workspace_audit_events
         (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'comparison_export',?,'export_requested',?,?)`,
      ).bind(crypto.randomUUID(), input.workspaceId, input.userId, id, JSON.stringify({ comparisonId: input.comparisonId, format: input.format }), now),
    ]);
  } catch (error) {
    const raced = await byIdempotency(input.db, input.idempotencyKey, input.workspaceId, input.userId);
    if (raced?.comparisonId === input.comparisonId && raced.format === input.format) return { record: raced, replay: true };
    if (error instanceof Error && /unique constraint/i.test(error.message)) {
      throw new AnalysisExportError("ANALYSIS_EXPORT_IDEMPOTENCY_CONFLICT", false, 409);
    }
    throw error;
  }
  return { replay: false, record: { id, comparisonId: input.comparisonId, format: input.format, status: "queued", fileName, mimeType: info.mimeType, sizeBytes: null, sha256: null, errorCode: null, completedAt: null, createdAt: now } };
}

export async function executeComparisonExportJob(
  env: { DB: D1Database; BUCKET: R2Bucket; ASSETS: Fetcher },
  exportId: string,
  workspaceId: string,
): Promise<{ status: "completed" | "already_completed"; exportId: string }> {
  const row = await sourceRow(env.DB, exportId, workspaceId);
  if (!row) throw new AnalysisExportError("ANALYSIS_EXPORT_NOT_FOUND", false, 404);
  try {
    await assertComparisonSourceFilesClean(env.DB, {
      versionOneFileId: row.versionOneFileId,
      versionTwoFileId: row.versionTwoFileId,
      workspaceId: row.workspaceId,
      ownerUserId: row.ownerUserId,
    }, env.BUCKET);
  } catch (error) {
    if (error instanceof ComparisonProcessingError) {
      throw new AnalysisExportError("ANALYSIS_EXPORT_INVALID_SOURCE", false, 422);
    }
    throw error;
  }
  if (row.status === "completed") {
    await verifyCompleted(env.BUCKET, row);
    return { status: "already_completed", exportId };
  }
  if (!["queued", "processing", "retrying"].includes(row.status) || !["completed", "completed_partial"].includes(row.comparisonStatus)) {
    throw new AnalysisExportError("ANALYSIS_EXPORT_NOT_READY", false, 409);
  }
  const claimed = await env.DB.prepare(
    `UPDATE comparison_exports SET status='processing',error_code=NULL,updated_at=?
     WHERE id=? AND workspace_id=? AND status IN ('queued','retrying')`,
  ).bind(new Date().toISOString(), exportId, workspaceId).run();
  if (Number(claimed.meta.changes ?? 0) === 0 && row.status !== "processing") {
    throw new AnalysisExportError("ANALYSIS_EXPORT_NOT_READY", true, 409);
  }

  const changes = await comparisonChanges(env.DB, row.comparisonId);
  const sources = await verifiedSourcesForChanges(env.DB, changes, parsedSummary(row.summaryJson)?.sources);
  const paragraphs = comparisonReportParagraphs({ comparison: row, summary: parsedSummary(row.summaryJson), changes, sources });
  const locale = comparisonExportLocale(row.locale);
  const copy = exportCopy[locale];
  const bytes = row.format === "pdf"
    ? await generatePdf(
      paragraphs,
      await asset(env.ASSETS, "/document-templates/DejaVuSans-JURO.ttf"),
      await asset(env.ASSETS, "/document-templates/DejaVuSans-Bold-JURO.ttf"),
      await asset(env.ASSETS, "/document-templates/juro-mark-footer.png"),
      { title: copy.title, producer: "JURO Document Comparison", footerLabel: copy.footerLabel, pageLabel: copy.pageLabel },
    )
    : generateDocx(
      await asset(env.ASSETS, copy.templatePath),
      paragraphs,
      {
        documentLanguage: copy.documentLanguage,
        title: copy.title,
        subject: copy.subject,
        keywords: copy.keywords,
        footer: { createdLabel: copy.footerLabel, pageLabel: copy.pageLabel, totalLabel: copy.totalLabel },
      },
    );
  const sha256 = await sha256Hex(bytes);
  const r2Key = `comparison-exports/${row.workspaceId}/${row.comparisonId}/${row.id}.${row.format}`;
  const existing = await env.BUCKET.head(r2Key);
  if (existing) {
    if (existing.size !== bytes.byteLength || hex(existing.checksums.sha256) !== sha256) throw new AnalysisExportError("ANALYSIS_EXPORT_OBJECT_FAILED", false);
  } else {
    const stored = await env.BUCKET.put(r2Key, bytes, {
      onlyIf: new Headers({ "if-none-match": "*" }), sha256,
      httpMetadata: { contentType: row.mimeType, cacheControl: "private, no-store" },
      customMetadata: { workspaceId: row.workspaceId, ownerUserId: row.ownerUserId, comparisonId: row.comparisonId, exportId: row.id, format: row.format },
    });
    if (!stored || stored.size !== bytes.byteLength || hex(stored.checksums.sha256) !== sha256) throw new AnalysisExportError("ANALYSIS_EXPORT_OBJECT_FAILED", true);
  }
  const now = new Date().toISOString();
  const completed = await env.DB.batch([
    env.DB.prepare(
      `UPDATE comparison_exports SET status='completed',r2_key=?,size_bytes=?,sha256=?,error_code=NULL,
       completed_at=?,updated_at=? WHERE id=? AND workspace_id=? AND status='processing'`,
    ).bind(r2Key, bytes.byteLength, sha256, now, now, row.id, row.workspaceId),
    env.DB.prepare(
      `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       VALUES (?,?,?,'comparison_export',?,'export_completed',?,?)`,
    ).bind(crypto.randomUUID(), row.workspaceId, row.ownerUserId, row.id, JSON.stringify({ comparisonId: row.comparisonId, format: row.format, sizeBytes: bytes.byteLength, sha256 }), now),
  ]);
  if (Number(completed[0]?.meta?.changes ?? 0) !== 1) throw new AnalysisExportError("ANALYSIS_EXPORT_OBJECT_FAILED", true);
  return { status: "completed", exportId };
}

export async function recordComparisonExportFailure(db: D1Database, exportId: string, workspaceId: string, error: AnalysisExportError) {
  const status = error.retryable ? "retrying" : "failed";
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(
      `UPDATE comparison_exports SET status=?,error_code=?,r2_key=NULL,size_bytes=NULL,sha256=NULL,completed_at=NULL,updated_at=?
       WHERE id=? AND workspace_id=? AND status IN ('queued','processing','retrying')`,
    ).bind(status, error.code, now, exportId, workspaceId),
    db.prepare(
      `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       SELECT ?,workspace_id,owner_user_id,'comparison_export',id,'export_failed',?,?
       FROM comparison_exports WHERE id=? AND workspace_id=? AND status=? AND error_code=? AND updated_at=?`,
    ).bind(crypto.randomUUID(), JSON.stringify({ errorCode: error.code, retryable: error.retryable }), now, exportId, workspaceId, status, error.code, now),
  ]);
}

export async function comparisonExportForDownload(db: D1Database, input: { exportId: string; workspaceId: string; userId: string }): Promise<DownloadRow> {
  const row = await db.prepare(
    `SELECT id,comparison_id AS comparisonId,workspace_id AS workspaceId,owner_user_id AS ownerUserId,format,status,
      r2_key AS r2Key,file_name AS fileName,mime_type AS mimeType,size_bytes AS sizeBytes,sha256
     FROM comparison_exports WHERE id=? AND workspace_id=? AND owner_user_id=? LIMIT 1`,
  ).bind(input.exportId, input.workspaceId, input.userId).first<DownloadRow>();
  if (!row) throw new AnalysisExportError("ANALYSIS_EXPORT_NOT_FOUND", false, 404);
  if (row.status !== "completed" || !row.r2Key || !row.sha256 || row.sizeBytes === null) throw new AnalysisExportError("ANALYSIS_EXPORT_NOT_READY", false, 409);
  return row;
}

export async function verifyComparisonExportObject(bucket: R2Bucket, row: DownloadRow): Promise<R2ObjectBody> {
  const object = await bucket.get(row.r2Key!);
  if (!object || object.size !== row.sizeBytes || hex(object.checksums.sha256) !== row.sha256) throw new AnalysisExportError("ANALYSIS_EXPORT_OBJECT_FAILED", false, 422);
  return object;
}

export async function recordComparisonExportDownload(db: D1Database, row: DownloadRow, userId: string) {
  await db.prepare(
    `INSERT INTO workspace_audit_events
     (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
     VALUES (?,?,?,'comparison_export',?,'export_downloaded',?,?)`,
  ).bind(crypto.randomUUID(), row.workspaceId, userId, row.id, JSON.stringify({ comparisonId: row.comparisonId, format: row.format, sizeBytes: row.sizeBytes, sha256: row.sha256 }), new Date().toISOString()).run();
}

export async function deleteComparisonExport(env: { DB: D1Database; BUCKET: R2Bucket }, input: { exportId: string; workspaceId: string; userId: string }): Promise<{ status: "deleted" | "already_deleted"; exportId: string }> {
  const auditId = `comparison-export-deleted:${input.exportId}`;
  const row = await env.DB.prepare(
    `SELECT id,comparison_id AS comparisonId,workspace_id AS workspaceId,owner_user_id AS ownerUserId,format,status,r2_key AS r2Key,
      file_name AS fileName,mime_type AS mimeType,size_bytes AS sizeBytes,sha256
     FROM comparison_exports WHERE id=? AND workspace_id=? AND owner_user_id=? LIMIT 1`,
  ).bind(input.exportId, input.workspaceId, input.userId).first<DownloadRow>();
  if (!row) {
    const audit = await env.DB.prepare(
      `SELECT 1 AS found FROM workspace_audit_events WHERE id=? AND workspace_id=? AND actor_user_id=?
       AND entity_type='comparison_export' AND entity_id=? AND action='export_deleted' LIMIT 1`,
    ).bind(auditId, input.workspaceId, input.userId, input.exportId).first();
    if (audit) return { status: "already_deleted", exportId: input.exportId };
    throw new AnalysisExportError("ANALYSIS_EXPORT_NOT_FOUND", false, 404);
  }
  if (!["completed", "failed"].includes(row.status)) throw new AnalysisExportError("ANALYSIS_EXPORT_NOT_TERMINAL", false, 409);
  if (row.r2Key) {
    try {
      await env.BUCKET.delete(row.r2Key);
      if (await env.BUCKET.head(row.r2Key)) throw new Error("R2_DELETE_NOT_VISIBLE");
    } catch {
      throw new AnalysisExportError("ANALYSIS_EXPORT_DELETE_FAILED", true, 503);
    }
  }
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(`DELETE FROM comparison_exports WHERE id=? AND workspace_id=? AND owner_user_id=? AND status=?`).bind(row.id, row.workspaceId, row.ownerUserId, row.status),
    env.DB.prepare(
      `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       VALUES (?,?,?,'comparison_export',?,'export_deleted',?,?)`,
    ).bind(auditId, row.workspaceId, row.ownerUserId, row.id, JSON.stringify({ comparisonId: row.comparisonId, format: row.format, priorStatus: row.status }), now),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) throw new AnalysisExportError("ANALYSIS_EXPORT_DELETE_FAILED", true, 503);
  return { status: "deleted", exportId: row.id };
}

async function sourceRow(db: D1Database, exportId: string, workspaceId: string): Promise<ComparisonExportRow | null> {
  return db.prepare(
    `SELECT e.id,e.comparison_id AS comparisonId,e.workspace_id AS workspaceId,e.owner_user_id AS ownerUserId,e.format,e.status,
      e.r2_key AS r2Key,e.file_name AS fileName,e.mime_type AS mimeType,e.size_bytes AS sizeBytes,e.sha256,e.error_code AS errorCode,
      e.completed_at AS completedAt,e.created_at AS createdAt,c.status AS comparisonStatus,c.stage,c.locale,c.summary_json AS summaryJson,
      c.version_one_file_id AS versionOneFileId,c.version_two_file_id AS versionTwoFileId,c.case_id AS caseId,
      c.version_one_json_key AS versionOneJsonKey,c.version_two_json_key AS versionTwoJsonKey,c.similarity_percent AS similarityPercent,
      c.overall_risk AS overallRisk,c.ai_status AS aiStatus,c.model_name AS modelName,c.model_version AS modelVersion,
      c.error_code AS comparisonErrorCode,c.updated_at AS updatedAt,
      one.file_name AS versionOneName,one.mime_type AS versionOneMimeType,one.size_bytes AS versionOneSizeBytes,one.sha256 AS versionOneSha256,
      two.file_name AS versionTwoName,two.mime_type AS versionTwoMimeType,two.size_bytes AS versionTwoSizeBytes,two.sha256 AS versionTwoSha256
     FROM comparison_exports e JOIN document_comparisons c ON c.id=e.comparison_id
     JOIN document_files one ON one.id=c.version_one_file_id JOIN document_files two ON two.id=c.version_two_file_id
     WHERE e.id=? AND e.workspace_id=? AND c.workspace_id=e.workspace_id AND c.owner_user_id=e.owner_user_id AND c.deleted_at IS NULL LIMIT 1`,
  ).bind(exportId, workspaceId).first<ComparisonExportRow>();
}

async function byIdempotency(db: D1Database, key: string, workspaceId: string, userId: string): Promise<ComparisonExportRecord | null> {
  return db.prepare(
    `SELECT id,comparison_id AS comparisonId,format,status,file_name AS fileName,mime_type AS mimeType,size_bytes AS sizeBytes,
      sha256,error_code AS errorCode,completed_at AS completedAt,created_at AS createdAt
     FROM comparison_exports WHERE idempotency_key=? AND workspace_id=? AND owner_user_id=? LIMIT 1`,
  ).bind(key, workspaceId, userId).first<ComparisonExportRecord>();
}

async function asset(fetcher: Fetcher, path: string): Promise<ArrayBuffer> {
  const response = await fetcher.fetch(new Request(new URL(path, "https://juro-assets.invalid")));
  if (!response.ok) throw new AnalysisExportError("ANALYSIS_EXPORT_OBJECT_FAILED", true, 503);
  return response.arrayBuffer();
}

async function verifyCompleted(bucket: R2Bucket, row: ComparisonExportRow) {
  if (!row.r2Key || !row.sha256 || row.sizeBytes === null) throw new AnalysisExportError("ANALYSIS_EXPORT_OBJECT_FAILED", false);
  const object = await bucket.head(row.r2Key);
  if (!object || object.size !== row.sizeBytes || hex(object.checksums.sha256) !== row.sha256) throw new AnalysisExportError("ANALYSIS_EXPORT_OBJECT_FAILED", false);
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hex(value: ArrayBuffer | undefined): string | null {
  return value ? Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("") : null;
}
