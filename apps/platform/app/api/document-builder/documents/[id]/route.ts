import { assertSafeWrite, requireApiUser } from "../../../../../lib/document-builder/auth/api";
import { apiError, badRequest, forbidden, jsonResponse, notFound } from "../../../../../lib/document-builder/auth/responses";
import { addActivity, addNotification, isoNow } from "../../../../../lib/document-builder/storage/db";
import { requireR2 } from "../../../../../lib/document-builder/storage/runtime";
import { getDocumentAccess, loadStoredDocument, requireOwner } from "../../../../../lib/document-builder/permissions";
import { ACCEPTED_COLLABORATOR_JOIN_SQL } from "../../../../../lib/document-builder/permissions/collaboration-policy";
import { workspaceForContentEditor } from "../../../../../lib/platform/workspace";
import { requireD1 } from "../../../../../lib/document-builder/storage/runtime";
import { saveDocumentSchema } from "../../../../../lib/document-builder/validation/schema";
import { createDocumentVersion } from "../../../../../lib/document-builder/document-versions";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    if (new URL(request.url).searchParams.has("revisionOnly")) {
      const access = await getDocumentAccess(id, user.id);
      return access?.canView ? jsonResponse({ revision: access.document.revision }) : notFound();
    }
    const document = await loadStoredDocument(id, user.id);
    if (!document) return notFound();
    const db = requireD1();
    if (document.accessRole === "collaborator") {
      const collaboration = await db.prepare(
        "SELECT id, opened_at AS openedAt FROM document_collaborators WHERE document_id = ? AND user_id = ? LIMIT 1",
      ).bind(id, user.id).first<{ id: string; openedAt: string | null }>();
      if (collaboration && !collaboration.openedAt) {
        const now = isoNow();
        const opened = await db.prepare(`UPDATE document_collaborators AS c SET opened_at = ?, status = 'opened', updated_at = ?
          WHERE id = ? AND opened_at IS NULL AND ${ACCEPTED_COLLABORATOR_JOIN_SQL}`)
          .bind(now, now, collaboration.id).run();
        if (opened.meta.changes) {
          await addActivity(id, user.id, "invitation_opened");
          await addActivity(id, user.id, "document_viewed");
          await addNotification(document.ownerUserId, id, "invitation_opened", "Приглашение открыто", `${user.fullName || user.email} открыл(а) документ.`);
        }
      }
    }
    const files = document.accessRole === "owner"
      ? await db.prepare(
        "SELECT id, document_id AS documentId, kind, file_name AS fileName, mime_type AS mimeType, size_bytes AS sizeBytes, archived_at AS archivedAt, created_at AS createdAt FROM document_files WHERE document_id = ? ORDER BY created_at DESC",
      ).bind(id).all()
      : { results: [] };
    const attachmentVisibility = document.accessRole === "collaborator" ? "AND a.visible_to_collaborator = 1" : "";
    const attachments = await db.prepare(
      `SELECT a.id, a.visible_to_collaborator AS visibleToCollaborator, f.id AS fileId, f.file_name AS fileName,
       f.mime_type AS mimeType, f.size_bytes AS sizeBytes, f.created_at AS createdAt
       FROM document_attachments a JOIN document_files f ON f.id = a.file_id
       WHERE a.document_id = ? ${attachmentVisibility} ORDER BY f.created_at DESC`,
    ).bind(id).all();
    return jsonResponse({ document, files: files.results, attachments: attachments.results });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request, context: Context): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const access = await requireOwner(id, user.id);
    if (!access) return forbidden();
    if (access.document.status === "Архив") return badRequest("Сначала восстановите документ из архива.", "ARCHIVED");
    if (access.workspaceId) await workspaceForContentEditor(user, access.workspaceId);
    const parsed = saveDocumentSchema.safeParse(await request.json());
    if (!parsed.success) return badRequest("Не удалось проверить данные документа.", "INVALID_DOCUMENT");
    const db = requireD1();
    if (parsed.data.revision && parsed.data.revision !== access.document.revision) {
      return jsonResponse({ error: "Документ был изменён в другой вкладке. Обновите страницу перед сохранением.", code: "REVISION_CONFLICT", currentRevision: access.document.revision }, { status: 409 });
    }
    const now = isoNow();
    const nextRevision = access.document.revision + 1;
    const nextStatus = access.document.status === "Согласован" ? "Готов" : access.document.status;
    const [updated] = await db.batch([
      db.prepare(
        "UPDATE documents SET title = ?, language = ?, participant_mode = ?, acting_side = ?, lender_name = ?, borrower_name = ?, status = ?, revision = ?, updated_at = ? WHERE id = ? AND owner_user_id = ? AND revision = ?",
      ).bind(parsed.data.title, parsed.data.answers.language, parsed.data.answers.participantMode, parsed.data.answers.actingSide, parsed.data.answers.lender.fullName || null, parsed.data.answers.borrower.fullName || null, nextStatus, nextRevision, now, id, user.id, access.document.revision),
      db.prepare("UPDATE document_answers SET answers_json = ?, updated_at = ? WHERE document_id = ? AND changes() = 1")
        .bind(JSON.stringify(parsed.data.answers), now, id),
      db.prepare("UPDATE document_current_content SET auto_content = ?, final_content = ?, manually_edited = ?, updated_at = ? WHERE document_id = ? AND changes() = 1")
        .bind(parsed.data.autoContent, parsed.data.finalContent, parsed.data.manuallyEdited ? 1 : 0, now, id),
      ...(access.document.status === "Согласован"
        ? [db.prepare("UPDATE document_collaborators SET confirmed_at = NULL, status = 'opened', updated_at = ? WHERE document_id = ? AND status = 'confirmed' AND changes() = 1").bind(now, id)]
        : []),
    ]);
    if (!updated.meta.changes) return jsonResponse({ error: "Документ был изменён. Загрузите последнюю версию.", code: "REVISION_CONFLICT" }, { status: 409 });
    return jsonResponse({ saved: true, revision: nextRevision, status: nextStatus, updatedAt: now });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const access = await requireOwner(id, user.id);
    if (!access) return forbidden();
    const body = await request.json() as { action?: string; title?: string; value?: boolean };
    const db = requireD1();
    const now = isoNow();
    if (body.action === "rename") {
      const title = body.title?.trim();
      if (!title || title.length > 300) return badRequest("Введите корректное название.");
      await db.prepare("UPDATE documents SET title = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(title, now, id).run();
      return jsonResponse({ title });
    }
    if (body.action === "favorite") {
      await db.prepare("UPDATE documents SET is_favorite = ?, updated_at = ? WHERE id = ?").bind(body.value ? 1 : 0, now, id).run();
      return jsonResponse({ isFavorite: Boolean(body.value) });
    }
    if (body.action === "archive") {
      await db.batch([
        db.prepare("UPDATE documents SET status = 'Архив', archived_at = ?, revision = revision + 1, updated_at = ? WHERE id = ?").bind(now, now, id),
        db.prepare("UPDATE signed_document_access SET view_allowed = 0, download_allowed = 0, updated_at = ? WHERE document_id = ?").bind(now, id),
        db.prepare("UPDATE document_share_links SET revoked_at = COALESCE(revoked_at, ?) WHERE document_id = ?").bind(now, id),
      ]);
      await addActivity(id, user.id, "document_archived");
      return jsonResponse({ status: "Архив" });
    }
    if (body.action === "restore") {
      await db.batch([
        db.prepare("UPDATE documents SET status = 'Готов', archived_at = NULL, revision = revision + 1, updated_at = ? WHERE id = ?").bind(now, id),
        db.prepare("UPDATE signed_document_access SET view_allowed = 1, download_allowed = 0, restored_view_only = 1, updated_at = ? WHERE document_id = ?").bind(now, id),
      ]);
      await addActivity(id, user.id, "document_restored");
      return jsonResponse({ status: "Готов" });
    }
    if (body.action === "confirm_agreement") {
      if (access.document.status !== "Готов") return badRequest("Подтвердить можно документ со статусом «Готов».");
      if (!access.workspaceId) return forbidden();
      await createDocumentVersion({
        db, bucket: requireR2(), documentId: id, workspaceId: access.workspaceId,
        ownerUserId: user.id, revision: access.document.revision, source: "approval",
        idempotencyKey: `builder-auto-approval-${id}-${access.document.revision}-${user.id}`,
      });
      await db.prepare("UPDATE documents SET status = 'Согласован', revision = revision + 1, updated_at = ? WHERE id = ?").bind(now, id).run();
      await addActivity(id, user.id, "creator_confirmed");
      return jsonResponse({ status: "Согласован" });
    }
    if (body.action === "internal_sign") {
      if (access.document.status !== "Готов" && access.document.status !== "Согласован") {
        return badRequest("Внутренне подтвердить можно готовый или согласованный документ.");
      }
      if (!access.workspaceId) return forbidden();
      await createDocumentVersion({
        db, bucket: requireR2(), documentId: id, workspaceId: access.workspaceId,
        ownerUserId: user.id, revision: access.document.revision, source: "signature",
        idempotencyKey: `builder-auto-signature-${id}-${access.document.revision}-${user.id}`,
      });
      await db.prepare("UPDATE documents SET status = 'Подписан', revision = revision + 1, updated_at = ? WHERE id = ?").bind(now, id).run();
      await addActivity(id, user.id, "internally_confirmed", { documentId: id, confirmedAt: now });
      return jsonResponse({ status: "Подписан", confirmation: { userId: user.id, documentId: id, confirmedAt: now, qualifiedSignature: false } });
    }
    return badRequest("Неизвестное действие.");
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const access = await requireOwner(id, user.id);
    if (!access) return forbidden();
    const db = requireD1();
    const url = new URL(request.url);
    const signedPolicy = url.searchParams.get("signed");
    const signed = access.document.signedFileId
      ? await db.prepare("SELECT id, r2_key AS r2Key, file_name AS fileName FROM document_files WHERE id = ? AND document_id = ? LIMIT 1")
        .bind(access.document.signedFileId, id).first<{ id: string; r2Key: string; fileName: string }>()
      : null;
    if (signed && signedPolicy !== "keep" && signedPolicy !== "delete") {
      return jsonResponse({ error: "Выберите, что сделать с подписанным PDF.", code: "SIGNED_FILE_DECISION_REQUIRED" }, { status: 409 });
    }
    const files = await db.prepare("SELECT id, r2_key AS r2Key FROM document_files WHERE document_id = ?").bind(id).all<{ id: string; r2Key: string }>();
    const keysToDelete = files.results.filter((file) => !(signedPolicy === "keep" && signed?.id === file.id)).map((file) => file.r2Key);
    if (signedPolicy === "keep" && signed) {
      const standaloneName = `Подписанная версия — ${access.document.title}.pdf`;
      await db.prepare("UPDATE document_files SET document_id = NULL, kind = 'standalone_signed_pdf', file_name = ?, updated_at = ? WHERE id = ?")
        .bind(standaloneName, isoNow(), signed.id).run();
    }
    await db.prepare("DELETE FROM documents WHERE id = ? AND owner_user_id = ?").bind(id, user.id).run();
    if (keysToDelete.length) await requireR2().delete(keysToDelete);
    return jsonResponse({ deleted: true, preservedSignedFileId: signedPolicy === "keep" ? signed?.id ?? null : null });
  } catch (error) {
    return apiError(error);
  }
}
