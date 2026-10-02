import {assertTemplatePlan} from "../../../../../../lib/control-center/template-access";
import { resolvedDocument } from "../../../../../../lib/document-builder/registry/published";
import { assertSafeWrite, requireApiUser } from "../../../../../../lib/document-builder/auth/api";
import { apiError, badRequest, forbidden, jsonResponse, notFound } from "../../../../../../lib/document-builder/auth/responses";
import { loadDocxTemplate, loadFooterMark, loadPdfFont } from "../../../../../../lib/document-builder/generation/assets";
import { generateDocx } from "../../../../../../lib/document-builder/generation/docx";
import { paragraphsFromFinalText } from "../../../../../../lib/document-builder/generation/paragraphs";
import { generatePdf } from "../../../../../../lib/document-builder/generation/pdf";
import { generateZip } from "../../../../../../lib/document-builder/generation/zip";
import { requireOwner } from "../../../../../../lib/document-builder/permissions";
import { getDocumentByCode } from "../../../../../../lib/document-builder/registry";
import { renderConfiguredDocument } from "../../../../../../lib/document-builder/registry/engine";
import { loadConfiguredDocument } from "../../../../../../lib/document-builder/storage/configured-documents";
import { addActivity, isoNow } from "../../../../../../lib/document-builder/storage/db";
import { putPrivateObject, sanitizeFileName } from "../../../../../../lib/document-builder/storage/files";
import { requireD1, requireR2, runtimeEnv } from "../../../../../../lib/document-builder/storage/runtime";
import { createDocumentVersion } from "../../../../../../lib/document-builder/document-versions";
import { recordDocumentBuilderCompletionEvidence } from "../../../../../../worker/dependency-health-evidence";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const startedAt = Date.now();
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const access = await requireOwner(id, user.id);
    if (!access?.workspaceId) return forbidden();
    if (access.document.status === "Архив") return badRequest("Сначала восстановите документ из архива.");
    const document = await loadConfiguredDocument(id, user.id);
    if (!document) return notFound();
    if (document.answers["confirmation.accepted"] !== true) return badRequest("Подтвердите достоверность данных и условия использования шаблона.", "CONFIRMATION_REQUIRED");
    const definition = await resolvedDocument(document.templateCode,document.templateVersion);
    if (!definition || definition.status !== "published") return badRequest("Шаблон недоступен.", "TEMPLATE_UNAVAILABLE");
    await assertTemplatePlan(definition,user.id);
    const rendered = renderConfiguredDocument(definition, document.answers, document.language === "uz" ? "uz" : "ru");
    const paragraphs = document.manuallyEdited ? paragraphsFromFinalText(document.finalContent) : rendered.paragraphs;
    const [template, regularFont, boldFont, footerMark] = await Promise.all([
      loadDocxTemplate("ru", request), loadPdfFont(false, request), loadPdfFont(true, request), loadFooterMark(request),
    ]);
    const docx = generateDocx(template, paragraphs);
    const pdf = await generatePdf(paragraphs, regularFont, boldFont, footerMark);
    const baseName = sanitizeFileName(document.title).replace(/\.(?:docx|pdf|zip)$/i, "");
    const zip = generateZip([{ name: `${baseName}.docx`, bytes: docx }, { name: `${baseName}.pdf`, bytes: pdf }]);
    const db = requireD1();
    const old = await db.prepare("SELECT r2_key AS r2Key FROM document_files WHERE document_id = ? AND kind IN ('docx', 'pdf', 'zip')").bind(id).all<{ r2Key: string }>();
    const now = isoNow();
    const files = { docx: crypto.randomUUID(), pdf: crypto.randomUUID(), zip: crypto.randomUUID() };
    const prefix = `users/${user.id}/documents/${id}/generated`;
    const keys = { docx: `${prefix}/${files.docx}.docx`, pdf: `${prefix}/${files.pdf}.pdf`, zip: `${prefix}/${files.zip}.zip` };
    const bucket = requireR2();
    await createDocumentVersion({
      db, bucket, documentId: id, workspaceId: access.workspaceId,
      ownerUserId: user.id, revision: document.revision, source: "finalize",
      idempotencyKey: `builder-auto-finalize-${id}-${document.revision}-${user.id}`,
    });
    await Promise.all([
      putPrivateObject(keys.docx, docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", { documentId: id, kind: "docx", templateCode: definition.code }),
      putPrivateObject(keys.pdf, pdf, "application/pdf", { documentId: id, kind: "pdf", templateCode: definition.code }),
      putPrivateObject(keys.zip, zip, "application/zip", { documentId: id, kind: "zip", templateCode: definition.code }),
    ]);
    await db.batch([
      db.prepare("DELETE FROM document_files WHERE document_id = ? AND kind IN ('docx', 'pdf', 'zip')").bind(id),
      db.prepare("INSERT INTO document_files (id, workspace_id, document_id, owner_user_id, kind, r2_key, file_name, mime_type, size_bytes, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'docx', ?, ?, ?, ?, NULL, ?, ?)")
        .bind(files.docx, access.workspaceId, id, user.id, keys.docx, `${baseName}.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx.byteLength, now, now),
      db.prepare("INSERT INTO document_files (id, workspace_id, document_id, owner_user_id, kind, r2_key, file_name, mime_type, size_bytes, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'pdf', ?, ?, 'application/pdf', ?, NULL, ?, ?)")
        .bind(files.pdf, access.workspaceId, id, user.id, keys.pdf, `${baseName}.pdf`, pdf.byteLength, now, now),
      db.prepare("INSERT INTO document_files (id, workspace_id, document_id, owner_user_id, kind, r2_key, file_name, mime_type, size_bytes, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'zip', ?, ?, 'application/zip', ?, NULL, ?, ?)")
        .bind(files.zip, access.workspaceId, id, user.id, keys.zip, `${baseName}.zip`, zip.byteLength, now, now),
      db.prepare("UPDATE documents SET status = 'Готов', generated_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(now, now, id),
    ]);
    await recordDocumentBuilderCompletionEvidence({
      APP_ENV: runtimeEnv().APP_ENV ?? "development",
      DB: db,
    }, startedAt);
    if (old.results.length) await bucket.delete(old.results.map((file) => file.r2Key));
    await addActivity(id, user.id, "document_generated", { templateCode: definition.code, templateVersion: definition.version });
    const url = (fileId: string) => `/api/document-builder/documents/${id}/files/${fileId}`;
    return jsonResponse({ status: "Готов", files: {
      docx: { id: files.docx, name: `${baseName}.docx`, url: url(files.docx), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: docx.byteLength },
      pdf: { id: files.pdf, name: `${baseName}.pdf`, url: url(files.pdf), mimeType: "application/pdf", size: pdf.byteLength },
      zip: { id: files.zip, name: `${baseName}.zip`, url: url(files.zip), mimeType: "application/zip", size: zip.byteLength },
    } });
  } catch (error) {
    return apiError(error);
  }
}
