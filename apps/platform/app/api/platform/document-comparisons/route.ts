import { getDocumentAccess } from "../../../../lib/document-builder/permissions";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import {
  deletePrivateObject,
  getPrivateObject,
  MAX_FILE_SIZE,
  sanitizeFileName,
  sha256Hex,
  validateUploadBytes,
} from "../../../../lib/document-builder/storage/files";
import {
  QuarantinedUploadError,
  quarantineScanAndStorePrivateObject,
} from "../../../../lib/document-builder/storage/quarantined-upload";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { ArchiveInspectionError } from "../../../../lib/document-analysis/archive-inspector";
import type { ComparisonLocale } from "../../../../lib/document-comparison/types";
import { isLocale } from "../../../../lib/platform/routing";
import { workspaceForContentEditor, workspaceForUser } from "../../../../lib/platform/workspace";
import { MULTIPART_OVERHEAD_BYTES, requiredContentLength } from "../../../../lib/request-body";

type ExistingFile = {
  id: string;
  r2Key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
};

type PreparedFile = Omit<ExistingFile, "sha256"> & {
  sha256: string;
  created: boolean;
  bytes: Uint8Array | null;
  sourceFileId: string | null;
  sourceDocumentId: string | null;
};

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

function requestLocale(request: Request): ComparisonLocale {
  const requested = request.headers.get("x-juro-locale")?.trim().toLowerCase() ?? "";
  return isLocale(requested) ? requested : "ru";
}

function localized(locale: ComparisonLocale, ru: string, uz: string, en: string): string {
  return { ru, uz, en }[locale];
}

async function prepareFile(input: {
  form: FormData;
  fileField: string;
  existingField: string;
  comparisonId: string;
  version: "one" | "two";
  workspaceId: string;
  userId: string;
}): Promise<PreparedFile> {
  const db = requireD1();
  const existingId = String(input.form.get(input.existingField) || "").trim();
  if (existingId) {
    const existing = await db.prepare(
      `SELECT id,r2_key AS r2Key,file_name AS fileName,mime_type AS mimeType,
        size_bytes AS sizeBytes,sha256
       FROM document_files
       WHERE id=? AND workspace_id=? AND owner_user_id=? AND archived_at IS NULL LIMIT 1`,
    ).bind(existingId, input.workspaceId, input.userId).first<ExistingFile>();
    if (!existing) throw new Error("COMPARISON_FILE_ACCESS_DENIED");
    if (!["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"].includes(existing.mimeType)) {
      throw new Error("UNSUPPORTED_FILE");
    }
    const object = await getPrivateObject(existing.r2Key);
    if (!object) throw new Error("COMPARISON_FILE_ACCESS_DENIED");
    const bytes = new Uint8Array(await object.arrayBuffer());
    const inspection = await validateUploadBytes(
      new File([Uint8Array.from(bytes).buffer], existing.fileName, { type: existing.mimeType }),
      bytes,
    );
    if (inspection) throw new Error(`${inspection.code}:${inspection.message}`);
    const sha256 = await sha256Hex(bytes);
    if (!existing.sha256) {
      await db.prepare(
        "UPDATE document_files SET sha256=?,updated_at=? WHERE id=? AND workspace_id=? AND owner_user_id=?",
      ).bind(sha256, isoNow(), existing.id, input.workspaceId, input.userId).run();
    }
    const id = crypto.randomUUID();
    const fileName = sanitizeFileName(existing.fileName);
    const extension = fileName.split(".").pop()?.toLocaleLowerCase() || "bin";
    return {
      ...existing,
      id,
      r2Key: `workspaces/${input.workspaceId}/comparisons/${input.comparisonId}/version-${input.version}-${id}.${extension}`,
      fileName,
      sizeBytes: bytes.byteLength,
      sha256,
      created: true,
      bytes,
      sourceFileId: existing.id,
      sourceDocumentId: null,
    };
  }

  const sourceDocumentId = input.form.get(input.fileField + "DocumentId");
  if (sourceDocumentId !== null && (typeof sourceDocumentId !== "string" || sourceDocumentId.length > 128
    || !(await getDocumentAccess(sourceDocumentId, input.userId))?.canDownload)) throw new Error("COMPARISON_FILE_ACCESS_DENIED");
  const file = input.form.get(input.fileField);
  if (!(file instanceof File)) throw new Error(`COMPARISON_${input.version.toLocaleUpperCase()}_FILE_REQUIRED`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const inspection = await validateUploadBytes(file, bytes);
  if (inspection) throw new Error(`${inspection.code}:${inspection.message}`);
  const id = crypto.randomUUID();
  const fileName = sanitizeFileName(file.name);
  const extension = fileName.split(".").pop()?.toLocaleLowerCase() || "bin";
  const r2Key = `workspaces/${input.workspaceId}/comparisons/${input.comparisonId}/version-${input.version}-${id}.${extension}`;
  return {
    id,
    r2Key,
    fileName,
    mimeType: file.type,
    sizeBytes: file.size,
    sha256: await sha256Hex(bytes),
    created: true,
    bytes,
    sourceFileId: null,
    sourceDocumentId,
  };
}

export const GET = withApiErrors(async function GET() {
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  const db = requireD1();
  const [comparisons, reusableFiles] = await db.batch([
    db.prepare(
      `SELECT c.id,c.status,c.stage,c.summary_json AS summaryJson,c.error_code AS errorCode,
        c.similarity_percent AS similarityPercent,c.overall_risk AS overallRisk,
        c.created_at AS createdAt,c.updated_at AS updatedAt,
        one.file_name AS versionOneName,two.file_name AS versionTwoName
       FROM document_comparisons c
       JOIN document_files one ON one.id=c.version_one_file_id
       JOIN document_files two ON two.id=c.version_two_file_id
       WHERE c.workspace_id=? AND c.owner_user_id=? AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC LIMIT 50`,
    ).bind(workspace.id, user.id),
    db.prepare(
      `SELECT id,file_name AS fileName,mime_type AS mimeType,size_bytes AS sizeBytes,sha256,created_at AS createdAt
       FROM document_files
       WHERE workspace_id=? AND owner_user_id=? AND archived_at IS NULL
         AND mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document')
       ORDER BY created_at DESC LIMIT 30`,
    ).bind(workspace.id, user.id),
  ]);
  return response({ comparisons: comparisons.results, reusableFiles: reusableFiles.results });
});

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  let locale = requestLocale(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user);
  const bodyLength = requiredContentLength(request, (2 * MAX_FILE_SIZE) + MULTIPART_OVERHEAD_BYTES);
  if (!bodyLength.ok) {
    return response({
      error: bodyLength.reason === "too_large"
        ? localized(locale, "Общий размер двух файлов превышает допустимый предел.", "Ikki faylning umumiy hajmi ruxsat etilgan chegaradan oshadi.", "The combined size of the two files exceeds the allowed limit.")
        : localized(locale, "Для загрузки требуется точный размер запроса.", "Yuklash uchun so‘rovning aniq hajmi talab qilinadi.", "An exact request size is required for this upload."),
      code: bodyLength.reason === "too_large" ? "PAYLOAD_TOO_LARGE" : "CONTENT_LENGTH_REQUIRED",
    }, bodyLength.reason === "too_large" ? 413 : 411);
  }
  const form = await request.formData();
  const formLocale = String(form.get("locale") || "").trim().toLowerCase();
  if (isLocale(formLocale)) locale = formLocale;
  if (form.get("consent") !== "true") {
    return response({
      error: localized(locale, "Подтвердите согласие на приватное сохранение и сравнение двух файлов.", "Ikki faylni maxfiy saqlash va taqqoslashga rozilikni tasdiqlang.", "Confirm your consent to the private storage and automated comparison of both files."),
    }, 400);
  }

  const comparisonId = crypto.randomUUID();
  const prepared: PreparedFile[] = [];
  try {
    const versionOne = await prepareFile({
      form, fileField: "versionOne", existingField: "versionOneFileId",
      comparisonId, version: "one", workspaceId: workspace.id, userId: user.id,
    });
    prepared.push(versionOne);
    const versionTwo = await prepareFile({
      form, fileField: "versionTwo", existingField: "versionTwoFileId",
      comparisonId, version: "two", workspaceId: workspace.id, userId: user.id,
    });
    prepared.push(versionTwo);
    if (
      versionOne.id === versionTwo.id
      || (
        versionOne.sourceFileId
        && versionOne.sourceFileId === versionTwo.sourceFileId
      )
    ) {
      return response({
        error: localized(locale, "Выберите два независимых файла или версии.", "Ikki mustaqil fayl yoki versiyani tanlang.", "Select two separate files or document versions."),
        code: "SAME_FILE_REFERENCE",
      }, 400);
    }

    for (const file of prepared) {
      if (file.created && file.bytes) {
        const evidence = await quarantineScanAndStorePrivateObject({
          key: file.r2Key,
          bytes: file.bytes,
          mimeType: file.mimeType,
          metadata: {
            workspaceId: workspace.id,
            ownerUserId: user.id,
            comparisonId,
            kind: "comparison_version",
          },
        });
        file.sha256 = evidence.sha256;
      }
    }

    const db = requireD1();
    const now = isoNow();
    const statements: D1PreparedStatement[] = [];
    for (const file of prepared) {
      if (!file.created) continue;
      statements.push(db.prepare(
        `INSERT INTO document_files
         (id,workspace_id,document_id,owner_user_id,kind,r2_key,file_name,mime_type,size_bytes,sha256,archived_at,created_at,updated_at)
         VALUES (?,?,NULL,?,'comparison_version',?,?,?,?,?,NULL,?,?)`,
      ).bind(
        file.id, workspace.id, user.id, file.r2Key, file.fileName, file.mimeType,
        file.sizeBytes, file.sha256, now, now,
      ));
      if (file.sourceDocumentId) statements.push(db.prepare("UPDATE document_files SET tool_source_document_id=? WHERE id=?").bind(file.sourceDocumentId, file.id));
    }
    statements.push(
      db.prepare(
        `INSERT INTO document_comparisons
         (id,workspace_id,owner_user_id,version_one_file_id,version_two_file_id,status,stage,locale,created_at,updated_at)
         VALUES (?,?,?,?,?,'queued','uploaded',?,?,?)`,
      ).bind(comparisonId, workspace.id, user.id, versionOne.id, versionTwo.id, locale, now, now),
      db.prepare(
        `INSERT INTO consents (id,user_id,workspace_id,type,version,scope_json,granted_at)
         VALUES (?,?,?,'document_comparison','2026-07-26',?,?)`,
      ).bind(crypto.randomUUID(), user.id, workspace.id, JSON.stringify({
        comparisonId,
        versionOneFileId: versionOne.id,
        versionTwoFileId: versionTwo.id,
      }), now),
      db.prepare(
        `INSERT INTO workspace_audit_events
         (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'document_comparison',?,'comparison_created',?,?)`,
      ).bind(crypto.randomUUID(), workspace.id, user.id, comparisonId, JSON.stringify({
        versionOneSha256: versionOne.sha256,
        versionTwoSha256: versionTwo.sha256,
      }), now),
    );
    await db.batch(statements);
    return response({
      comparison: {
        id: comparisonId,
        status: "queued",
        stage: "uploaded",
        versionOneName: versionOne.fileName,
        versionTwoName: versionTwo.fileName,
      },
      warning: versionOne.sha256 && versionOne.sha256 === versionTwo.sha256
        ? localized(locale, "Файлы идентичны по SHA-256. Сравнение всё равно будет выполнено.", "Fayllar SHA-256 bo‘yicha bir xil. Taqqoslash baribir bajariladi.", "The files have identical SHA-256 hashes. JURO will still run the comparison.")
        : null,
    }, 201);
  } catch (error) {
    await Promise.all(prepared
      .filter((file) => file.created)
      .map((file) => deletePrivateObject(file.r2Key).catch(() => undefined)));
    if (error instanceof ArchiveInspectionError) {
      return response({
        error: localized(locale, "DOCX не прошёл безопасную проверку структуры и распаковки.", "DOCX tuzilma va ochish xavfsizligi tekshiruvidan o‘tmadi.", "The DOCX file failed secure structure and extraction validation."),
        code: error.code,
      }, 400);
    }
    if (error instanceof QuarantinedUploadError) {
      const unsafe = error.code === "FILE_UNSAFE";
      return response({
        code: error.code,
        error: unsafe
          ? localized(locale, "Файл не прошёл проверку безопасности.", "Fayl xavfsizlik tekshiruvidan o‘tmadi.", "The file failed security validation.")
          : localized(locale, "Проверка безопасности файла временно недоступна.", "Fayl xavfsizligini tekshirish vaqtincha mavjud emas.", "File security validation is temporarily unavailable."),
      }, unsafe ? 422 : 503);
    }
    const message = error instanceof Error ? error.message : String(error);
    const [code, detail] = message.includes(":") ? message.split(/:(.*)/s, 2) : [message, ""];
    if ([
      "EMPTY_FILE", "FILE_TOO_LARGE", "UNSUPPORTED_FILE", "CONTENT_TYPE_MISMATCH",
      "CORRUPT_DOCX", "COMPARISON_ONE_FILE_REQUIRED", "COMPARISON_TWO_FILE_REQUIRED",
      "COMPARISON_FILE_ACCESS_DENIED",
    ].includes(code)) {
      const fallback = localized(locale, "Проверьте выбранные файлы.", "Tanlangan fayllarni tekshiring.", "Check the selected files and try again.");
      return response({ error: locale === "en" ? fallback : detail || fallback, code }, 400);
    }
    throw error;
  }
});
