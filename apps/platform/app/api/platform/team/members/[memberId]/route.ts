import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { isWorkspaceRole, requireTeamManager } from "../../../../../../lib/platform/permissions";
import { requireSelectedWorkspace } from "../../../../../../lib/platform/workspace";
import { workspaceEntitlements } from "../../../../../../lib/billing/entitlements";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

export const PATCH = withApiErrors(async function PATCH(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  requireTeamManager(workspace.role);
  const { memberId } = await params;
  const body = await request.json().catch(() => null) as { role?: string } | null;
  if (!isWorkspaceRole(body?.role) || body.role === "owner") return response({ error: "Выберите допустимую роль." }, 400);
  const db = requireD1();
  if ((await workspaceEntitlements(db, workspace.id)).readOnly) return response({ code: "WORKSPACE_TERM_EXPIRED" }, 403);
  const member = await db.prepare("SELECT id,user_id AS userId,role FROM workspace_members WHERE id=? AND workspace_id=? AND status='active' LIMIT 1").bind(memberId, workspace.id).first<{ id: string; userId: string; role: string }>();
  if (!member) return response({ error: "Участник не найден." }, 404);
  if (member.role === "owner" || member.userId === user.id
    || (workspace.role !== "owner" && (member.role === "admin" || body.role === "admin"))) {
    return response({ code: "ROLE_CHANGE_FORBIDDEN" }, 403);
  }
  const now = isoNow();
  await db.batch([
    db.prepare("UPDATE workspace_members SET role=?,updated_at=? WHERE id=? AND workspace_id=?").bind(body.role, now, memberId, workspace.id),
    db.prepare("INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES (?,?,?,'member',?,'member_role_changed',?,?)").bind(crypto.randomUUID(), workspace.id, user.id, memberId, JSON.stringify({ from: member.role, to: body.role }), now),
  ]);
  return response({ ok: true });
});

export const DELETE = withApiErrors(async function DELETE(request: Request, { params }: { params: Promise<{ memberId: string }> }) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  requireTeamManager(workspace.role);
  const { memberId } = await params;
  const db = requireD1();
  const member = await db.prepare("SELECT id,user_id AS userId,role FROM workspace_members WHERE id=? AND workspace_id=? AND status='active' LIMIT 1").bind(memberId, workspace.id).first<{ userId: string; role: string }>();
  if (!member) return response({ error: "Участник не найден." }, 404);
  if (member.role === "owner" || member.userId === user.id || (member.role === "admin" && workspace.role !== "owner")) {
    return response({ code: "MEMBERSHIP_REMOVAL_FORBIDDEN" }, 403);
  }
  const now = isoNow();
  await db.batch([
    db.prepare("UPDATE workspace_members SET status='removed',updated_at=? WHERE id=? AND workspace_id=?").bind(now, memberId, workspace.id),
    db.prepare(
      `UPDATE lawyer_access_grants SET revoked_at=?,revoke_reason='requester_removed'
       WHERE revoked_at IS NULL AND lawyer_request_id IN (
         SELECT id FROM lawyer_requests WHERE workspace_id=? AND requester_user_id=?
       )`,
    ).bind(now, workspace.id, member.userId),
    db.prepare(
      `UPDATE lawyer_requests SET status='access_revoked',updated_at=?
       WHERE workspace_id=? AND requester_user_id=? AND status='access_granted'`,
    ).bind(now, workspace.id, member.userId),
    db.prepare("INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,created_at) VALUES (?,?,?,'member',?,'member_removed',?)").bind(crypto.randomUUID(), workspace.id, user.id, memberId, now),
  ]);
  return response({ ok: true });
});
