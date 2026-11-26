import { z } from "zod";
import { sanitizeFileName } from "../document-builder/storage/file-validation";

export const DOCUMENT_ANALYSIS_MAX_FILE_SIZE = 50 * 1024 * 1024;
export const DOCUMENT_ANALYSIS_MAX_FILES = 20;
export const DOCUMENT_ANALYSIS_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const DOCUMENT_ANALYSIS_ABANDONED_AFTER_MS = 24 * 60 * 60 * 1_000;
/**
 * ZIP packages must stay within the bounded in-Worker extraction path until a
 * privacy-approved streaming extractor is actually deployed.  The broader
 * 50 MB upload limit still applies to single documents, which have a real OCR
 * continuation path when they exceed the inline extraction boundary.
 */
export const DOCUMENT_ANALYSIS_INLINE_ZIP_BYTE_LIMIT = 20 * 1024 * 1024;
export const DOCUMENT_ANALYSIS_TEXT_BYTE_LIMIT = 20 * 1024 * 1024;

const textMimeTypes = new Set(["text/plain", "text/html", "application/json"]);

const allowedMimeTypes = new Map<string, readonly string[]>([
  ["application/pdf", ["pdf"]],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", ["docx"]],
  ["image/jpeg", ["jpg", "jpeg"]],
  ["image/png", ["png"]],
  ["application/zip", ["zip"]],
  ["text/plain", ["txt"]],
  ["text/html", ["html", "htm"]],
  ["application/json", ["json"]],
]);

export const documentAnalysisUploadIntentSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().min(1).max(160),
  sizeBytes: z.number().int().min(1).max(DOCUMENT_ANALYSIS_MAX_FILE_SIZE),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).transform((value) => value.toLowerCase()),
  locale: z.enum(["ru", "uz"]),
  mode: z.enum(["quick", "full", "expert"]).default("quick"),
  caseId: z.string().uuid().nullable().optional().default(null),
  consent: z.literal(true),
  sourceDocumentId: z.string().uuid().optional(),
}).strict();

export type DocumentAnalysisUploadIntent = z.infer<typeof documentAnalysisUploadIntentSchema>;

export type DocumentAnalysisUploadRecord = {
  analysisId: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  r2Key: string;
  fileKind: string;
  status: string;
  errorCode: string | null;
  caseId: string | null;
};

export class DocumentAnalysisUploadError extends Error {
  constructor(
    public readonly code:
      | "INVALID_UPLOAD_INTENT"
      | "INVALID_IDEMPOTENCY_KEY"
      | "IDEMPOTENCY_CONFLICT"
      | "UPLOAD_NOT_FOUND"
      | "CASE_UNAVAILABLE"
      | "DOCUMENT_ANALYSIS_CAPACITY_UNAVAILABLE"
      | "UPLOAD_STATE_CONFLICT",
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "DocumentAnalysisUploadError";
  }
}

export function parseDocumentAnalysisUploadIntent(value: unknown): DocumentAnalysisUploadIntent {
  const parsed = documentAnalysisUploadIntentSchema.safeParse(value);
  if (!parsed.success) {
    throw new DocumentAnalysisUploadError(
      "INVALID_UPLOAD_INTENT",
      "Проверьте имя, формат, размер и контрольную сумму файла.",
      400,
    );
  }
  const extension = parsed.data.fileName.split(".").pop()?.toLocaleLowerCase() ?? "";
  const acceptedExtensions = allowedMimeTypes.get(parsed.data.mimeType);
  if (!acceptedExtensions?.includes(extension)) {
    throw new DocumentAnalysisUploadError(
      "INVALID_UPLOAD_INTENT",
      "Формат, MIME-тип или расширение файла не поддерживается.",
      400,
    );
  }
  if (
    parsed.data.mimeType === "application/zip"
    && parsed.data.sizeBytes > DOCUMENT_ANALYSIS_INLINE_ZIP_BYTE_LIMIT
  ) {
    throw new DocumentAnalysisUploadError(
      "DOCUMENT_ANALYSIS_CAPACITY_UNAVAILABLE",
      parsed.data.locale === "ru"
        ? "ZIP-пакеты свыше 20 МБ пока не принимаются: потоковое безопасное извлечение ещё не подключено. Разделите пакет на части до 20 МБ."
        : "20 MB dan katta ZIP-paketlar hozircha qabul qilinmaydi: oqimli xavfsiz ajratish hali ulanmagan. Paketni 20 MB gacha bo‘lgan qismlarga ajrating.",
      422,
    );
  }
  if (textMimeTypes.has(parsed.data.mimeType) && parsed.data.sizeBytes > DOCUMENT_ANALYSIS_TEXT_BYTE_LIMIT) {
    throw new DocumentAnalysisUploadError(
      "DOCUMENT_ANALYSIS_CAPACITY_UNAVAILABLE",
      parsed.data.locale === "ru"
        ? "Текстовые, HTML и JSON-файлы должны быть не больше 20 МБ."
        : "TXT, HTML va JSON fayllari 20 MB dan katta bo‘lmasligi kerak.",
      422,
    );
  }
  return { ...parsed.data, fileName: sanitizeFileName(parsed.data.fileName) };
}

export function parseUploadIdempotencyKey(value: string | null): string {
  const key = value?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new DocumentAnalysisUploadError(
      "INVALID_IDEMPOTENCY_KEY",
      "Для загрузки требуется корректный Idempotency-Key.",
      400,
    );
  }
  return key;
}

export async function hashUploadIntent(intent: DocumentAnalysisUploadIntent): Promise<string> {
  const canonical = JSON.stringify({
    fileName: intent.fileName,
    mimeType: intent.mimeType,
    sizeBytes: intent.sizeBytes,
    sha256: intent.sha256,
    locale: intent.locale,
    mode: intent.mode,
    sourceDocumentId: intent.sourceDocumentId,
    caseId: intent.caseId,
    consent: intent.consent,
  });
  return sha256Hex(new TextEncoder().encode(canonical));
}

export async function initializeDocumentAnalysisUpload(input: {
  db: D1Database;
  workspaceId: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  intent: DocumentAnalysisUploadIntent;
  storageZone?: "quarantine" | "primary";
}): Promise<{ record: DocumentAnalysisUploadRecord; replay: boolean }> {
  const registryKey = uploadRegistryKey(input.workspaceId, input.userId, input.idempotencyKey);
  const analysisId = crypto.randomUUID();
  const fileId = crypto.randomUUID();
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const abandonedAfter = new Date(Date.parse(now) + DOCUMENT_ANALYSIS_ABANDONED_AFTER_MS).toISOString();
  const inserted = await input.db.prepare(
    `INSERT OR IGNORE INTO idempotency_keys
      (key,scope,request_hash,status,result_ref,expires_at,completed_at,created_at,updated_at)
     VALUES (?,?,?,'started',?,?,NULL,?,?)`,
  ).bind(
    registryKey,
    `document-analysis-upload:${input.workspaceId}:${input.userId}`,
    input.requestHash,
    analysisId,
    expiresAt,
    now,
    now,
  ).run();

  if ((inserted.meta.changes ?? 0) === 0) {
    const existing = await input.db.prepare(
      "SELECT request_hash AS requestHash,result_ref AS resultRef FROM idempotency_keys WHERE key=? LIMIT 1",
    ).bind(registryKey).first<{ requestHash: string; resultRef: string | null }>();
    if (!existing || existing.requestHash !== input.requestHash) {
      throw new DocumentAnalysisUploadError(
        "IDEMPOTENCY_CONFLICT",
        "Этот Idempotency-Key уже использован для другого файла.",
        409,
      );
    }
    if (!existing.resultRef) {
      throw new DocumentAnalysisUploadError(
        "UPLOAD_STATE_CONFLICT",
        "Инициализация загрузки ещё выполняется.",
        409,
      );
    }
    return { record: await documentAnalysisUploadForUser(input.db, existing.resultRef, input.workspaceId, input.userId), replay: true };
  }

  // Browser uploads start in the isolated quarantine bucket. The public-URL
  // importer performs its own bounded archive/magic-byte validation and writes
  // directly to the primary private bucket, so its key must identify that
  // binding unambiguously for later retention cleanup.
  const r2Key = input.storageZone === "primary"
    ? `analysis-inputs-v1/${input.workspaceId}/${analysisId}/${fileId}`
    : `quarantine-v2/${input.workspaceId}/${analysisId}/${fileId}`;
  try {
    await input.db.batch([
      input.db.prepare(
        `INSERT INTO document_files
         (id,workspace_id,document_id,owner_user_id,kind,r2_key,file_name,mime_type,size_bytes,sha256,archived_at,created_at,updated_at)
         VALUES (?,?,NULL,?,'analysis_upload_pending',?,?,?,?,?,NULL,?,?)`,
      ).bind(
        fileId,
        input.workspaceId,
        input.userId,
        r2Key,
        input.intent.fileName,
        input.intent.mimeType,
        input.intent.sizeBytes,
        input.intent.sha256,
        now,
        now,
      ),
      ...(input.intent.sourceDocumentId ? [input.db.prepare("UPDATE document_files SET tool_source_document_id=? WHERE id=?")
        .bind(input.intent.sourceDocumentId, fileId)] : []),
      input.db.prepare(
        `INSERT INTO document_analyses
         (id,workspace_id,owner_user_id,uploaded_file_id,status,summary_json,error_code,consent_version,resource_scope,abandoned_after,created_at,updated_at)
         VALUES (?,?,?,?,'initiated',?,NULL,'2026-07-30','interactive_analysis',?,?,?)`,
       ).bind(
         analysisId,
         input.workspaceId,
         input.userId,
         fileId,
         JSON.stringify({ mode: input.intent.mode, locale: input.intent.locale }),
         abandonedAfter,
         now,
         now,
       ),
      ...(input.intent.caseId ? [input.db.prepare(
        `INSERT INTO analysis_case_link_events
         (id,analysis_id,workspace_id,owner_user_id,actor_user_id,from_case_id,to_case_id,mutation_version,idempotency_key,request_hash,created_at)
         VALUES (?,?,?,?,?,NULL,?,1,?,?,?)`,
      ).bind(
        crypto.randomUUID(),
        analysisId,
        input.workspaceId,
        input.userId,
        input.userId,
        input.intent.caseId,
        `upload:${input.idempotencyKey}`,
        input.requestHash,
        now,
      )] : []),
      input.db.prepare(
        `INSERT INTO consents (id,user_id,workspace_id,type,version,scope_json,granted_at)
         VALUES (?,?,?,'document_analysis','2026-07-30',?,?)`,
      ).bind(
        crypto.randomUUID(),
        input.userId,
        input.workspaceId,
        JSON.stringify({ analysisId, fileId, fileName: input.intent.fileName, mode: input.intent.mode, caseId: input.intent.caseId }),
        now,
      ),
      input.db.prepare(
        `INSERT INTO workspace_audit_events
         (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'document_analysis',?,'upload_initiated',?,?)`,
      ).bind(
        crypto.randomUUID(),
        input.workspaceId,
        input.userId,
        analysisId,
        JSON.stringify({ mimeType: input.intent.mimeType, sizeBytes: input.intent.sizeBytes, mode: input.intent.mode, caseId: input.intent.caseId }),
        now,
      ),
      input.db.prepare(
        "UPDATE idempotency_keys SET status='completed',completed_at=?,updated_at=? WHERE key=? AND request_hash=?",
      ).bind(now, now, registryKey, input.requestHash),
    ]);
  } catch (error) {
    await input.db.prepare(
      "DELETE FROM idempotency_keys WHERE key=? AND request_hash=? AND status='started'",
    ).bind(registryKey, input.requestHash).run();
    if (isDocumentAnalysisQuotaError(error)) {
      throw new DocumentAnalysisUploadError(
        "DOCUMENT_ANALYSIS_CAPACITY_UNAVAILABLE",
        input.intent.locale === "ru"
          ? `Можно хранить не более ${DOCUMENT_ANALYSIS_MAX_FILES} анализов общим объёмом до 1 ГБ. Удалите ненужный анализ и повторите загрузку.`
          : `${DOCUMENT_ANALYSIS_MAX_FILES} tagacha, jami 1 GB hajmdagi tahlilni saqlash mumkin. Keraksiz tahlilni o‘chirib, yuklashni takrorlang.`,
        429,
      );
    }
    throw error;
  }
  return {
    replay: false,
    record: {
      analysisId,
      fileId,
      fileName: input.intent.fileName,
      mimeType: input.intent.mimeType,
      sizeBytes: input.intent.sizeBytes,
      sha256: input.intent.sha256,
      r2Key,
      fileKind: "analysis_upload_pending",
      status: "initiated",
      errorCode: null,
      caseId: input.intent.caseId,
    },
  };
}

function isDocumentAnalysisQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("DOCUMENT_ANALYSIS_COUNT_QUOTA_EXCEEDED")
    || message.includes("DOCUMENT_ANALYSIS_BYTE_QUOTA_EXCEEDED")
    || message.includes("DOCUMENT_ANALYSIS_RETENTION_REQUIRED");
}

export async function documentAnalysisUploadForUser(
  db: D1Database,
  analysisId: string,
  workspaceId: string,
  userId: string,
): Promise<DocumentAnalysisUploadRecord> {
  const record = await db.prepare(
    `SELECT a.id AS analysisId,a.status,a.error_code AS errorCode,a.case_id AS caseId,
      f.id AS fileId,f.file_name AS fileName,f.mime_type AS mimeType,f.size_bytes AS sizeBytes,
      f.sha256,f.r2_key AS r2Key,f.kind AS fileKind
     FROM document_analyses a
     JOIN document_files f ON f.id=a.uploaded_file_id
     WHERE a.id=? AND a.workspace_id=? AND a.owner_user_id=?
       AND a.deletion_requested_at IS NULL
       AND f.workspace_id=? AND f.owner_user_id=? AND f.archived_at IS NULL
     LIMIT 1`,
  ).bind(analysisId, workspaceId, userId, workspaceId, userId).first<DocumentAnalysisUploadRecord>();
  if (!record) {
    throw new DocumentAnalysisUploadError("UPLOAD_NOT_FOUND", "Загрузка не найдена.", 404);
  }
  return record;
}

export function validateUploadMagicBytes(
  mimeType: string,
  prefix: Uint8Array,
  suffix: Uint8Array,
): boolean {
  if (mimeType === "application/pdf") {
    return new TextDecoder().decode(prefix.slice(0, 5)) === "%PDF-";
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => prefix[index] === byte);
  }
  if (mimeType === "image/jpeg") {
    return prefix[0] === 0xff && prefix[1] === 0xd8 && suffix.at(-2) === 0xff && suffix.at(-1) === 0xd9;
  }
  if (mimeType === "application/zip" || mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    return prefix[0] === 0x50 && prefix[1] === 0x4b && [0x03, 0x05, 0x07].includes(prefix[2]) && [0x04, 0x06, 0x08].includes(prefix[3]);
  }
  if (textMimeTypes.has(mimeType)) {
    if (prefix.some((byte) => byte === 0)) return false;
    return !prefix.some((byte) => byte < 0x09 || (byte > 0x0d && byte < 0x20));
  }
  return false;
}

export function validateTextUploadBytes(mimeType: string, bytes: Uint8Array): boolean {
  if (!textMimeTypes.has(mimeType) || bytes.byteLength === 0 || bytes.byteLength > DOCUMENT_ANALYSIS_TEXT_BYTE_LIMIT) return false;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  if (text.includes("\0")) return false;
  const controls = [...text].filter((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code < 0x20 && character !== "\n" && character !== "\r" && character !== "\t";
  }).length;
  if (controls > Math.max(2, Math.floor(text.length / 1_000))) return false;
  if (mimeType === "application/json") {
    try {
      JSON.parse(text);
    } catch {
      return false;
    }
  }
  if (mimeType === "text/html") {
    // HTML is accepted only as untrusted source data. Active constructs are
    // rejected before malware scanning; the extractor never executes markup.
    if (/<\s*(?:script|iframe|object|embed|applet|meta\b[^>]*http-equiv)\b/iu.test(text)
      || /\bon[a-z]+\s*=/iu.test(text)
      || /(?:javascript|data)\s*:/iu.test(text)) return false;
  }
  return true;
}

export function arrayBufferHex(value: ArrayBuffer | undefined): string | null {
  if (!value) return null;
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uploadRegistryKey(workspaceId: string, userId: string, idempotencyKey: string): string {
  return `document-analysis-upload:${workspaceId}:${userId}:${idempotencyKey}`;
}
