import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { requireTeamManager } from "../../../../../../lib/platform/permissions";
import { requireSelectedWorkspace } from "../../../../../../lib/platform/workspace";

export const DELETE = withApiErrors(async function DELETE(request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  requireTeamManager(workspace.role);
  const { invitationId } = await params;
  const now = isoNow();
  const db = requireD1();
  const [result] = await db.batch([
    db.prepare("UPDATE workspace_invitations SET revoked_at=?,updated_at=? WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL")
      .bind(now, now, invitationId, workspace.id),
    db.prepare(`INSERT INTO workspace_audit_events(id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
      SELECT ?,?,?,'invitation',?,'invitation_revoked','{}',? WHERE changes()=1`)
      .bind(crypto.randomUUID(),workspace.id,user.id,invitationId,now),
  ]);
  if (!result.meta.changes) return Response.json({ error: "Приглашение не найдено." }, { status: 404 });
  return Response.json({ ok: true }, { headers: { "cache-control": "private, no-store" } });
});
