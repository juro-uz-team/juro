import type { DocumentConverter, DocumentConversion } from "../runtime/document-converter";
import {
  detectDocumentLanguage,
  structureDocument,
} from "../document-comparison/extract";
import {
  ComparisonProcessingError,
  type ExtractedDocument,
  type ExtractedSection,
} from "../document-comparison/types";
import { ArchiveInspectionError } from "./archive-inspector";
import {
  buildAnalysisPackageContext,
  isAnalysisPackageContext,
  PackageExtractionError,
  readAnalysisPackageMembers,
} from "./package-extractor";
import { DOCUMENT_ANALYSIS_PDF_PAGE_LIMIT, inspectPdfPageCount, PdfPreflightError } from "./pdf-preflight";

const EXTRACTION_METHOD = "local_document_conversion";
const EXTRACTION_PROVIDER = "juro-local-ocr";
const EXTRACTION_MODEL = "tesseract-poppler-v1";
const ZIP_MIME_TYPE = "application/zip";

type OcrAnalysisRow = {
  analysisId: string;
  workspaceId: string;
  ownerUserId: string;
  analysisStatus: string;
  fileId: string;
  fileKind: string;
  r2Key: string;
  mimeType: string;
  sizeBytes: number;
  sourceSha256: string | null;
  extractionId: string | null;
  extractionStatus: string | null;
  extractionR2Key: string | null;
  extractionTextSha256: string | null;
  extractionSizeBytes: number | null;
};

type StoredExtraction = {
  schemaVersion: 1;
  analysisId: string;
  fileId: string;
  workspaceId: string;
  sourceSha256: string;
  extracted: ExtractedDocument;
  provider: typeof EXTRACTION_PROVIDER;
  model: typeof EXTRACTION_MODEL;
  tokenEstimate: number;
  warnings: string[];
  completedAt: string;
};

export type OcrProcessorEnv = {
  DB: D1Database;
  BUCKET: R2Bucket;
  OCR?: DocumentConverter;
};

export class OcrProcessingError extends Error {
  constructor(
    readonly code:
      | "OCR_ANALYSIS_NOT_FOUND"
      | "OCR_FILE_UNSAFE"
      | "OCR_OBJECT_MISSING"
      | "OCR_INTEGRITY_FAILED"
      | "OCR_PROVIDER_UNAVAILABLE"
      | "OCR_PROVIDER_REJECTED"
      | "OCR_NO_READABLE_TEXT"
      | "OCR_PACKAGE_INVALID"
      | "OCR_PACKAGE_CAPACITY_REQUIRED"
      | "OCR_PAGE_LIMIT_EXCEEDED"
      | "OCR_PDF_PASSWORD_PROTECTED"
      | "OCR_PDF_PREFLIGHT_TIMEOUT"
      | "OCR_PDF_CORRUPT"
      | "OCR_DERIVATIVE_INVALID"
      | "OCR_PERSISTENCE_FAILED",
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "OcrProcessingError";
  }
}

export async function scheduleOcrProcessing(
  db: D1Database,
  input: {
    analysisId: string;
    fileId: string;
    workspaceId: string;
    ownerUserId: string;
    sourceSha256: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const extractionId = `ocr-${input.analysisId}`;
  const outboxId = crypto.randomUUID();
  const idempotencyKey = `ocr:${input.analysisId}:${input.sourceSha256.slice(0, 16)}`;
  try {
    await db.batch([
      db.prepare(
        `UPDATE document_analyses
         SET status='awaiting_ocr',error_code='DOCUMENT_ANALYSIS_OCR_REQUIRED',updated_at=?
         WHERE id=? AND workspace_id=? AND uploaded_file_id=?
           AND status IN ('processing','ready','awaiting_ocr')`,
      ).bind(now, input.analysisId, input.workspaceId, input.fileId),
      db.prepare(
        `INSERT INTO file_extractions
         (id,analysis_id,file_id,workspace_id,owner_user_id,status,method,provider,model,
          source_sha256,r2_key,text_sha256,size_bytes,token_estimate,detected_mime_type,
          detected_language,text_quality,warnings_json,error_code,completed_at,created_at,updated_at)
         VALUES (?,?,?,?,?,'queued',?,?,?, ?,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'[]',NULL,NULL,?,?)
         ON CONFLICT(analysis_id) DO UPDATE SET
           status=CASE WHEN file_extractions.status='completed' THEN 'completed' ELSE 'queued' END,
           source_sha256=excluded.source_sha256,
           error_code=CASE WHEN file_extractions.status='completed' THEN file_extractions.error_code ELSE NULL END,
           updated_at=excluded.updated_at
         WHERE file_extractions.file_id=excluded.file_id
           AND file_extractions.workspace_id=excluded.workspace_id
           AND file_extractions.owner_user_id=excluded.owner_user_id`,
      ).bind(
        extractionId,
        input.analysisId,
        input.fileId,
        input.workspaceId,
        input.ownerUserId,
        EXTRACTION_METHOD,
        EXTRACTION_PROVIDER,
        EXTRACTION_MODEL,
        input.sourceSha256,
        now,
        now,
      ),
      db.prepare(
        `INSERT OR IGNORE INTO job_outbox
         (id,queue_binding,job_type,schema_version,idempotency_key,subject_id,workspace_id,
          correlation_id,enqueued_at,available_at,status,dispatch_attempts,lease_owner,
          lease_expires_at,next_attempt_at,dispatched_at,error_code,created_at,updated_at)
         VALUES (?,'OCR_PROCESSING_QUEUE','ocr.process',1,?,?,?,? ,?,?,'pending',0,NULL,NULL,NULL,NULL,NULL,?,?)`,
      ).bind(
        outboxId,
        idempotencyKey,
        input.analysisId,
        input.workspaceId,
        `ocr-${input.analysisId}`,
        now,
        now,
        now,
        now,
      ),
      db.prepare(
        `INSERT INTO workspace_audit_events
         (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'file_extraction',?,'ocr_queued',?,?)`,
      ).bind(
        crypto.randomUUID(),
        input.workspaceId,
        input.ownerUserId,
        extractionId,
        JSON.stringify({ analysisId: input.analysisId, method: EXTRACTION_METHOD }),
        now,
      ),
    ]);
  } catch {
    throw new OcrProcessingError("OCR_PERSISTENCE_FAILED", true);
  }
}

export async function executeOcrProcessingJob(
  env: OcrProcessorEnv,
  analysisId: string,
  workspaceId: string,
): Promise<{ status: "completed" | "already_completed"; analysisId: string }> {
  const row = await loadOcrAnalysis(env.DB, analysisId, workspaceId);
  if (!row) throw new OcrProcessingError("OCR_ANALYSIS_NOT_FOUND", false);
  if (row.fileKind !== "analysis_safe") {
    throw new OcrProcessingError("OCR_FILE_UNSAFE", false);
  }
  if (row.extractionStatus === "completed") {
    await loadCompletedOcrExtraction(env, {
      analysisId,
      workspaceId,
      fileId: row.fileId,
      sourceSha256: requiredSourceSha(row),
    });
    return { status: "already_completed", analysisId };
  }
  if (!row.extractionId || !["queued", "retrying", "processing"].includes(row.extractionStatus ?? "")) {
    throw new OcrProcessingError("OCR_ANALYSIS_NOT_FOUND", false);
  }

  const now = new Date().toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE file_extractions SET status='processing',error_code=NULL,updated_at=?
     WHERE id=? AND analysis_id=? AND workspace_id=? AND status IN ('queued','retrying')`,
  ).bind(now, row.extractionId, analysisId, workspaceId).run();
  if (Number(claimed.meta.changes ?? 0) === 0 && row.extractionStatus !== "processing") {
    throw new OcrProcessingError("OCR_PERSISTENCE_FAILED", true);
  }
  await env.DB.prepare(
    `UPDATE document_analyses SET status='ocr_processing',error_code=NULL,updated_at=?
     WHERE id=? AND workspace_id=? AND status IN ('awaiting_ocr','ocr_processing')`,
  ).bind(now, analysisId, workspaceId).run();

  try {
    const stored = await convertAndStore(env, row);
    const completedAt = new Date().toISOString();
    const analysisOutboxId = crypto.randomUUID();
    const analyzeIdempotency = `document-analysis-after-ocr:${analysisId}:${stored.textSha256.slice(0, 16)}`;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE file_extractions SET status='completed',r2_key=?,text_sha256=?,size_bytes=?,
         token_estimate=?,detected_mime_type=?,detected_language=?,text_quality=?,warnings_json=?,
         error_code=NULL,completed_at=?,updated_at=?
         WHERE id=? AND analysis_id=? AND workspace_id=? AND status='processing'`,
      ).bind(
        stored.r2Key,
        stored.textSha256,
        stored.sizeBytes,
        stored.tokenEstimate,
        row.mimeType,
        stored.extracted.detectedLanguage,
        stored.extracted.textQuality,
        JSON.stringify(stored.warnings),
        completedAt,
        completedAt,
        row.extractionId,
        analysisId,
        workspaceId,
      ),
      env.DB.prepare(
        `UPDATE document_analyses SET status='ready',error_code=NULL,updated_at=?
         WHERE id=? AND workspace_id=? AND status='ocr_processing'`,
      ).bind(completedAt, analysisId, workspaceId),
      env.DB.prepare(
        `INSERT OR IGNORE INTO job_outbox
         (id,queue_binding,job_type,schema_version,idempotency_key,subject_id,workspace_id,
          correlation_id,enqueued_at,available_at,status,dispatch_attempts,lease_owner,
          lease_expires_at,next_attempt_at,dispatched_at,error_code,created_at,updated_at)
         VALUES (?,'DOCUMENT_ANALYSIS_QUEUE','document.analyze',1,?,?,?,? ,?,?,'pending',0,NULL,NULL,NULL,NULL,NULL,?,?)`,
      ).bind(
        analysisOutboxId,
        analyzeIdempotency,
        analysisId,
        workspaceId,
        `document-analysis-${analysisId}`,
        completedAt,
        completedAt,
        completedAt,
        completedAt,
      ),
      env.DB.prepare(
        `INSERT INTO workspace_audit_events
         (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'file_extraction',?,'ocr_completed',?,?)`,
      ).bind(
        crypto.randomUUID(),
        workspaceId,
        row.ownerUserId,
        row.extractionId,
        JSON.stringify({
          analysisId,
          method: EXTRACTION_METHOD,
          provider: EXTRACTION_PROVIDER,
          tokenEstimate: stored.tokenEstimate,
          warnings: stored.warnings,
        }),
        completedAt,
      ),
    ]);
    return { status: "completed", analysisId };
  } catch (error) {
    const normalized = error instanceof OcrProcessingError
      ? error
      : new OcrProcessingError("OCR_PROVIDER_UNAVAILABLE", true);
    await recordOcrFailure(env.DB, row, normalized);
    throw normalized;
  }
}

export async function loadCompletedOcrExtraction(
  env: Pick<OcrProcessorEnv, "DB" | "BUCKET">,
  input: {
    analysisId: string;
    workspaceId: string;
    fileId: string;
    sourceSha256: string;
  },
): Promise<ExtractedDocument | null> {
  const row = await env.DB.prepare(
    `SELECT r2_key AS r2Key,text_sha256 AS textSha256,size_bytes AS sizeBytes
     FROM file_extractions
     WHERE analysis_id=? AND workspace_id=? AND file_id=? AND source_sha256=? AND status='completed'
     LIMIT 1`,
  ).bind(input.analysisId, input.workspaceId, input.fileId, input.sourceSha256).first<{
    r2Key: string | null;
    textSha256: string | null;
    sizeBytes: number | null;
  }>();
  if (!row) return null;
  if (!row.r2Key || !row.textSha256 || row.sizeBytes === null) {
    throw new OcrProcessingError("OCR_DERIVATIVE_INVALID", false);
  }
  const object = await env.BUCKET.get(row.r2Key);
  if (!object) throw new OcrProcessingError("OCR_DERIVATIVE_INVALID", false);
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== row.sizeBytes || await sha256Hex(bytes) !== row.textSha256) {
    throw new OcrProcessingError("OCR_DERIVATIVE_INVALID", false);
  }
  const stored = parseStoredExtraction(bytes, input);
  return stored.extracted;
}

async function convertAndStore(
  env: OcrProcessorEnv,
  row: OcrAnalysisRow,
): Promise<{
  extracted: ExtractedDocument;
  r2Key: string;
  textSha256: string;
  sizeBytes: number;
  tokenEstimate: number;
  warnings: string[];
}> {
  if (!env.OCR) throw new OcrProcessingError("OCR_PROVIDER_UNAVAILABLE", true);
  const sourceSha256 = requiredSourceSha(row);
  const object = await env.BUCKET.get(row.r2Key);
  if (!object) throw new OcrProcessingError("OCR_OBJECT_MISSING", false);
  const sourceBytes = new Uint8Array(await object.arrayBuffer());
  if (sourceBytes.byteLength !== row.sizeBytes || await sha256Hex(sourceBytes) !== sourceSha256) {
    throw new OcrProcessingError("OCR_INTEGRITY_FAILED", false);
  }

  const converted = await convertSourceLocally(env.OCR, row, sourceBytes);
  const { extracted, tokenEstimate, warnings } = converted;
  const completedAt = new Date().toISOString();
  const stored: StoredExtraction = {
    schemaVersion: 1,
    analysisId: row.analysisId,
    fileId: row.fileId,
    workspaceId: row.workspaceId,
    sourceSha256,
    extracted,
    provider: EXTRACTION_PROVIDER,
    model: EXTRACTION_MODEL,
    tokenEstimate,
    warnings,
    completedAt,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(stored));
  const textSha256 = await sha256Hex(bytes);
  const r2Key = `derivatives/${row.workspaceId}/${row.analysisId}/${row.fileId}-${sourceSha256.slice(0, 16)}.json`;
  const existing = await env.BUCKET.head(r2Key);
  if (existing) {
    if (existing.size !== bytes.byteLength || arrayBufferHex(existing.checksums.sha256) !== textSha256) {
      throw new OcrProcessingError("OCR_DERIVATIVE_INVALID", false);
    }
  } else {
    const result = await env.BUCKET.put(r2Key, bytes, {
      onlyIf: new Headers({ "if-none-match": "*" }),
      sha256: textSha256,
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "private, no-store",
      },
      customMetadata: {
        workspaceId: row.workspaceId,
        analysisId: row.analysisId,
        fileId: row.fileId,
        sourceSha256,
        kind: "ocr-extraction",
      },
    });
    if (!result || result.size !== bytes.byteLength || arrayBufferHex(result.checksums.sha256) !== textSha256) {
      throw new OcrProcessingError("OCR_PERSISTENCE_FAILED", true);
    }
  }
  return {
    extracted,
    r2Key,
    textSha256,
    sizeBytes: bytes.byteLength,
    tokenEstimate,
    warnings,
  };
}

type ConvertedSource = {
  extracted: ExtractedDocument;
  tokenEstimate: number;
  warnings: string[];
};

async function convertSourceLocally(
  ai: DocumentConverter,
  row: OcrAnalysisRow,
  sourceBytes: Uint8Array,
): Promise<ConvertedSource> {
  if (row.mimeType === ZIP_MIME_TYPE) return convertPackageLocally(ai, row, sourceBytes);

  const name = opaqueFileName(row.mimeType);
  const pageCount = row.mimeType === "application/pdf"
    ? await preflightPdf(sourceBytes)
    : row.mimeType.startsWith("image/") ? 1 : null;
  let response: DocumentConversion;
  try {
    response = await ai.toMarkdown({
      name,
      blob: new Blob([ownedArrayBuffer(sourceBytes)], { type: row.mimeType }),
    });
  } catch {
    throw new OcrProcessingError("OCR_PROVIDER_UNAVAILABLE", true);
  }
  const converted = normalizeDocumentConversion(response, name, row.mimeType);
  const imageInput = row.mimeType.startsWith("image/");
  const warnings = ["LOCAL_DOCUMENT_CONVERSION_USED"];
  if (imageInput) warnings.push("AI_OCR_REVIEW_REQUIRED");
  return {
    tokenEstimate: converted.tokens,
    warnings,
    extracted: {
      fileName: name,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      pageCount,
      detectedLanguage: detectDocumentLanguage(converted.text),
      textQuality: imageInput ? "limited" : "good",
      warningCode: warnings.join(","),
      text: converted.text,
      sections: structureDocument(converted.text),
    },
  };
}

async function convertPackageLocally(
  ai: DocumentConverter,
  row: OcrAnalysisRow,
  sourceBytes: Uint8Array,
): Promise<ConvertedSource> {
  let members: Awaited<ReturnType<typeof readAnalysisPackageMembers>>;
  try {
    members = await readAnalysisPackageMembers({ bytes: sourceBytes, mimeType: row.mimeType });
  } catch (error) {
    if (error instanceof PackageExtractionError) {
      throw new OcrProcessingError("OCR_PACKAGE_CAPACITY_REQUIRED", false);
    }
    if (error instanceof ArchiveInspectionError || error instanceof ComparisonProcessingError) {
      throw new OcrProcessingError("OCR_PACKAGE_INVALID", false);
    }
    throw error;
  }

  const requests = members.map((member, index) => ({
    name: opaquePackageMemberName(index, member.mimeType),
    blob: new Blob([ownedArrayBuffer(member.bytes)], { type: member.mimeType }),
  }));
  const memberPageCounts: Array<number | null> = [];
  let knownPages = 0;
  for (const member of members) {
    const pageCount = member.mimeType === "application/pdf"
      ? await preflightPdf(member.bytes, DOCUMENT_ANALYSIS_PDF_PAGE_LIMIT - knownPages)
      : member.mimeType.startsWith("image/") ? 1 : null;
    knownPages += pageCount ?? 0;
    if (knownPages > DOCUMENT_ANALYSIS_PDF_PAGE_LIMIT) {
      throw new OcrProcessingError("OCR_PAGE_LIMIT_EXCEEDED", false);
    }
    memberPageCounts.push(pageCount);
  }
  let responses: DocumentConversion[];
  try {
    responses = await ai.toMarkdown(requests);
  } catch {
    throw new OcrProcessingError("OCR_PROVIDER_UNAVAILABLE", true);
  }
  if (responses.length !== members.length) {
    throw new OcrProcessingError("OCR_PROVIDER_REJECTED", false);
  }
  const expectedNames = new Set(requests.map((request) => request.name));
  const responsesByName = new Map<string, DocumentConversion>();
  for (const response of responses) {
    if (!expectedNames.has(response.name) || responsesByName.has(response.name)) {
      throw new OcrProcessingError("OCR_PROVIDER_REJECTED", false);
    }
    responsesByName.set(response.name, response);
  }

  const texts: string[] = [];
  const sections: ExtractedSection[] = [];
  const memberDocuments: ExtractedDocument[] = [];
  let tokenEstimate = 0;
  let limited = false;
  for (const [index, member] of members.entries()) {
    const converted = normalizeDocumentConversion(
      responsesByName.get(requests[index]!.name),
      requests[index]!.name,
      member.mimeType,
    );
    tokenEstimate += converted.tokens;
    if (!Number.isSafeInteger(tokenEstimate)) {
      throw new OcrProcessingError("OCR_PROVIDER_REJECTED", false);
    }
    texts.push(`===== ФАЙЛ: ${JSON.stringify(member.name)} =====\n\n${converted.text}`);
    const memberSections = structureDocument(converted.text);
    const memberWarnings = ["LOCAL_DOCUMENT_CONVERSION_USED"];
    if (member.mimeType.startsWith("image/")) memberWarnings.push("AI_OCR_REVIEW_REQUIRED");
    memberDocuments.push({
      fileName: member.name,
      mimeType: member.mimeType,
      sizeBytes: member.bytes.byteLength,
      pageCount: memberPageCounts[index] ?? null,
      detectedLanguage: detectDocumentLanguage(converted.text),
      textQuality: member.mimeType.startsWith("image/") ? "limited" : "good",
      warningCode: memberWarnings.join(","),
      text: converted.text,
      sections: memberSections,
    });
    for (const section of memberSections) {
      sections.push({
        ...section,
        id: `package-${index + 1}-${section.id}`,
        index: sections.length,
        heading: section.heading ? `${member.name} — ${section.heading}` : member.name,
      });
    }
    if (member.mimeType.startsWith("image/")) limited = true;
  }

  const text = texts.join("\n\n");
  const warnings = ["PACKAGE_MULTI_DOCUMENT", "LOCAL_DOCUMENT_CONVERSION_USED"];
  if (limited) warnings.push("AI_OCR_REVIEW_REQUIRED");
  return {
    tokenEstimate,
    warnings,
    extracted: {
      fileName: "document-package.zip",
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      pageCount: knownPages || null,
      detectedLanguage: detectDocumentLanguage(text),
      textQuality: limited ? "limited" : "good",
      warningCode: warnings.join(","),
      text,
      sections,
      packageContext: buildAnalysisPackageContext(memberDocuments),
    },
  };
}

async function preflightPdf(bytes: Uint8Array, limit = DOCUMENT_ANALYSIS_PDF_PAGE_LIMIT): Promise<number> {
  if (limit < 1) throw new OcrProcessingError("OCR_PAGE_LIMIT_EXCEEDED", false);
  try {
    return await inspectPdfPageCount(bytes, limit);
  } catch (error) {
    if (!(error instanceof PdfPreflightError)) throw error;
    if (error.code === "PDF_PAGE_LIMIT_EXCEEDED") throw new OcrProcessingError("OCR_PAGE_LIMIT_EXCEEDED", false);
    if (error.code === "PDF_PASSWORD_PROTECTED") throw new OcrProcessingError("OCR_PDF_PASSWORD_PROTECTED", false);
    if (error.code === "PDF_PREFLIGHT_TIMEOUT") throw new OcrProcessingError("OCR_PDF_PREFLIGHT_TIMEOUT", true);
    throw new OcrProcessingError("OCR_PDF_CORRUPT", false);
  }
}

function normalizeDocumentConversion(
  response: DocumentConversion | undefined,
  expectedName: string,
  expectedMimeType: string,
): { text: string; tokens: number } {
  if (
    !response || response.format === "error" || response.name !== expectedName ||
    response.mimeType !== expectedMimeType || !Number.isSafeInteger(response.tokens) || response.tokens < 0
  ) {
    throw new OcrProcessingError("OCR_PROVIDER_REJECTED", false);
  }
  const text = normalizeExtractedText(response.data);
  if (!text) throw new OcrProcessingError("OCR_NO_READABLE_TEXT", false);
  return { text, tokens: response.tokens };
}

function opaquePackageMemberName(index: number, mimeType: string): string {
  const extension = opaqueFileName(mimeType).split(".").at(-1) ?? "bin";
  return `document-${String(index + 1).padStart(2, "0")}.${extension}`;
}

function ownedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function loadOcrAnalysis(
  db: D1Database,
  analysisId: string,
  workspaceId: string,
): Promise<OcrAnalysisRow | null> {
  return db.prepare(
    `SELECT a.id AS analysisId,a.workspace_id AS workspaceId,a.owner_user_id AS ownerUserId,
      a.status AS analysisStatus,f.id AS fileId,f.kind AS fileKind,f.r2_key AS r2Key,
      f.mime_type AS mimeType,f.size_bytes AS sizeBytes,f.sha256 AS sourceSha256,
      x.id AS extractionId,x.status AS extractionStatus,x.r2_key AS extractionR2Key,
      x.text_sha256 AS extractionTextSha256,x.size_bytes AS extractionSizeBytes
     FROM document_analyses a
     JOIN document_files f ON f.id=a.uploaded_file_id
     LEFT JOIN file_extractions x ON x.analysis_id=a.id AND x.file_id=f.id AND x.workspace_id=a.workspace_id
     WHERE a.id=? AND a.workspace_id=? AND f.workspace_id=? AND f.archived_at IS NULL LIMIT 1`,
  ).bind(analysisId, workspaceId, workspaceId).first<OcrAnalysisRow>();
}

async function recordOcrFailure(
  db: D1Database,
  row: OcrAnalysisRow,
  error: OcrProcessingError,
): Promise<void> {
  if (!row.extractionId) return;
  const now = new Date().toISOString();
  const extractionStatus = error.retryable ? "retrying" : "failed";
  const analysisStatus = error.retryable ? "awaiting_ocr" : "failed";
  try {
    await db.batch([
      db.prepare(
        `UPDATE file_extractions SET status=?,error_code=?,completed_at=NULL,updated_at=?
         WHERE id=? AND analysis_id=? AND workspace_id=? AND status='processing'`,
      ).bind(extractionStatus, error.code, now, row.extractionId, row.analysisId, row.workspaceId),
      db.prepare(
        `UPDATE document_analyses SET status=?,error_code=?,updated_at=?
         WHERE id=? AND workspace_id=? AND status='ocr_processing'`,
      ).bind(analysisStatus, error.code, now, row.analysisId, row.workspaceId),
      db.prepare(
        `INSERT INTO workspace_audit_events
         (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'file_extraction',?,'ocr_failed',?,?)`,
      ).bind(
        crypto.randomUUID(),
        row.workspaceId,
        row.ownerUserId,
        row.extractionId,
        JSON.stringify({ analysisId: row.analysisId, errorCode: error.code, retryable: error.retryable }),
        now,
      ),
    ]);
  } catch {
    throw new OcrProcessingError("OCR_PERSISTENCE_FAILED", true);
  }
}

function parseStoredExtraction(
  bytes: Uint8Array,
  expected: { analysisId: string; workspaceId: string; fileId: string; sourceSha256: string },
): StoredExtraction {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new OcrProcessingError("OCR_DERIVATIVE_INVALID", false);
  }
  if (!value || typeof value !== "object") {
    throw new OcrProcessingError("OCR_DERIVATIVE_INVALID", false);
  }
  const stored = value as Partial<StoredExtraction>;
  if (
    stored.schemaVersion !== 1 || stored.analysisId !== expected.analysisId ||
    stored.workspaceId !== expected.workspaceId || stored.fileId !== expected.fileId ||
    stored.sourceSha256 !== expected.sourceSha256 || stored.provider !== EXTRACTION_PROVIDER ||
    stored.model !== EXTRACTION_MODEL || !stored.extracted || typeof stored.extracted.text !== "string" ||
    !Array.isArray(stored.extracted.sections) ||
    (stored.extracted.packageContext !== undefined && stored.extracted.packageContext !== null
      && !isAnalysisPackageContext(stored.extracted.packageContext))
  ) {
    throw new OcrProcessingError("OCR_DERIVATIVE_INVALID", false);
  }
  return stored as StoredExtraction;
}

function requiredSourceSha(row: OcrAnalysisRow): string {
  if (!row.sourceSha256 || !/^[a-f0-9]{64}$/i.test(row.sourceSha256)) {
    throw new OcrProcessingError("OCR_INTEGRITY_FAILED", false);
  }
  return row.sourceSha256.toLowerCase();
}

function opaqueFileName(mimeType: string): string {
  if (mimeType === "application/pdf") return "document.pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "document.docx";
  if (mimeType === "image/png") return "document.png";
  if (mimeType === "image/jpeg") return "document.jpg";
  return "document.bin";
}

function normalizeExtractedText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[\t ]+\n/g, "\n").trim();
}

function arrayBufferHex(value: ArrayBuffer | undefined): string {
  if (!value) return "";
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  return arrayBufferHex(await crypto.subtle.digest("SHA-256", new Uint8Array(value).buffer));
}
