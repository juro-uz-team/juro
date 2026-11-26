import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { documentVisibilityScope } from "../../../../lib/document-builder/permissions/document-visibility";
import { parseJsonRequest } from "../../../../lib/auth/input";
import { z } from "zod";
import { CaseLifecycleError, caseLifecycleIdempotencyKeySchema, executeCaseLifecycle } from "../../../../lib/platform/case-lifecycle";
import { workspaceForContentEditor, workspaceForUser } from "../../../../lib/platform/workspace";

const archiveRestoreSchema = z.object({ type: z.enum(["document", "case"]), id: z.string().min(1).max(180) }).strict();

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

export const GET = withApiErrors(async function GET() {
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  const db = requireD1();
  const documentVisibility = documentVisibilityScope(user.id, workspace.id);
  const [documents, cases] = await db.batch([
    db.prepare(
      `SELECT DISTINCT d.id,d.title,d.category,d.status,d.archived_at AS archivedAt,d.updated_at AS updatedAt,
        CASE WHEN d.owner_user_id=? THEN 1 ELSE 0 END AS canRestore
       FROM documents d
       WHERE ${documentVisibility.sql} AND d.status='Архив'
       ORDER BY d.archived_at DESC`,
    ).bind(user.id, ...documentVisibility.bindings),
    db.prepare("SELECT id,title,legal_area AS legalArea,status,archived_at AS archivedAt,updated_at AS updatedAt FROM cases WHERE workspace_id=? AND case_visible_to(id,?) AND archived_at IS NOT NULL ORDER BY archived_at DESC").bind(workspace.id,user.id),
  ]);
  return response({ documents: documents.results, cases: cases.results });
});

export const PATCH = withApiErrors(async function PATCH(request: Request) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  const parsed = await parseJsonRequest(request, archiveRestoreSchema, 1_024);
  if (!parsed.ok) return response({ error: "Некорректный объект архива.", code: "INVALID_ARCHIVE_INPUT" }, parsed.error === "payload_too_large" ? 413 : 400);
  const body = parsed.data;
  const now = isoNow();
  const db = requireD1();
  if (body.type === "document") {
    const result = await db.prepare(
      "UPDATE documents SET status='Готов',archived_at=NULL,revision=revision+1,updated_at=? WHERE id=? AND workspace_id=? AND owner_user_id=? AND status='Архив'",
    ).bind(now, body.id, workspace.id, user.id).run();
    if (!result.meta.changes) return response({ error: "Документ не найден или нет права восстановления." }, 403);
    await db.prepare("INSERT INTO activity_events (id,document_id,actor_user_id,type,metadata_json,created_at) VALUES (?,?,?,'document_restored',?,?)")
      .bind(crypto.randomUUID(), body.id, user.id, JSON.stringify({ shareLinksReactivated: false }), now).run();
  } else {
    const editableWorkspace = await workspaceForContentEditor(user);
    const idempotency = caseLifecycleIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key")?.trim() ?? "");
    if (!idempotency.success) return response({ error: "Некорректный ключ операции.", code: "INVALID_IDEMPOTENCY_KEY" }, 400);
    try {
      await executeCaseLifecycle({
        db, caseId: body.id, workspaceId: editableWorkspace.id, actorUserId: user.id,
        action: "restore", idempotencyKey: idempotency.data, now,
      });
    } catch (error) {
      if (error instanceof CaseLifecycleError) {
        return response({ error: error.message, code: error.code }, error.code === "CASE_UNAVAILABLE" ? 404 : error.code === "CASE_LIFECYCLE_INVALID" ? 400 : 409);
      }
      throw error;
    }
  }
  return response({ ok: true });
});
