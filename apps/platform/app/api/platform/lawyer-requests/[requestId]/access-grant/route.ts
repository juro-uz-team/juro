import { parseJsonRequest } from "../../../../../../lib/auth/input";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../../lib/document-builder/storage/db";
import { requireD1, runtimeEnv } from "../../../../../../lib/document-builder/storage/runtime";
import { workspaceEntitlements } from "../../../../../../lib/billing/entitlements";
import { lawyerAccessGrantSchema, localizedHandoffError } from "../../../../../../lib/platform/lawyer-request";
import { workspaceForContentEditor, requireSelectedWorkspace } from "../../../../../../lib/platform/workspace";
import { recordLawyerAccessGrantCompletionEvidence } from "../../../../../../worker/dependency-health-evidence";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

type Context = { params: Promise<{ requestId: string }> };

export const GET = withApiErrors(async function GET(request: Request, context: Context) {
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const { requestId } = await context.params;
  const db = requireD1();
  const intake = await db.prepare(`SELECT r.case_id AS caseId,p.display_name AS lawyer
    FROM lawyer_requests r JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id
    JOIN conflict_checks c ON c.lawyer_request_id=r.id AND c.lawyer_profile_id=p.id AND c.status='clear'
    WHERE r.id=? AND r.workspace_id=? AND r.requester_user_id=? AND r.status='awaiting_user_consent'
      AND case_visible_to(r.case_id,?)`).bind(requestId,workspace.id,user.id,user.id)
    .first<{ caseId: string; lawyer: string }>();
  if (!intake) return response({ code: "REQUEST_UNAVAILABLE" }, 404);
  const documents = await db.prepare(`SELECT id,title FROM documents
    WHERE case_id=? AND workspace_id=? AND owner_user_id=? AND archived_at IS NULL ORDER BY title,id`)
    .bind(intake.caseId,workspace.id,user.id).all<{ id: string; title: string }>();
  return response({ lawyer: intake.lawyer, documents: documents.results, checkoutAvailable: false });
});

export const POST = withApiErrors(async function POST(request: Request, context: Context) {
  const startedAt = Date.now();
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user, request.headers.get("x-juro-workspace-id"));
  const { requestId } = await context.params;
  const parsed = await parseJsonRequest(request, lawyerAccessGrantSchema, 1_024);
  const locale = parsed.ok ? parsed.data.locale : "ru";
  if (!parsed.ok) return response({ code: "INVALID_INPUT", error: localizedHandoffError(locale, "INVALID_INPUT") }, 400);

  const db = requireD1();
  const entitlements = await workspaceEntitlements(db, workspace.id);
  if (!entitlements.lawyerHandoff) return response({ code: "PLAN_LIMIT", error: localizedHandoffError(locale, "PLAN_LIMIT") }, 403);

  const handoff = await db.prepare(
    `SELECT r.id,r.case_id AS caseId,p.user_id AS lawyerUserId,
      json_extract(r.requested_scope_json,'$.paidTransfer') AS paidTransfer
     FROM lawyer_requests r
     JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id AND p.status='public_approved' AND p.marketplace_status='public_approved'
     JOIN conflict_checks c ON c.lawyer_request_id=r.id AND c.lawyer_profile_id=p.id AND c.status='clear'
     WHERE r.id=? AND r.workspace_id=? AND r.requester_user_id=? AND r.status='awaiting_user_consent'
       AND case_visible_to(r.case_id,?) LIMIT 1`,
  ).bind(requestId, workspace.id, user.id, user.id).first<{ id: string; caseId: string; lawyerUserId: string; paidTransfer: string | null }>();
  if (!handoff) return response({ code: "CONFLICT_REQUIRED", error: localizedHandoffError(locale, "CONFLICT_REQUIRED") }, 409);

  if (handoff.paidTransfer === "required") {
    return response({ code: "HANDOFF_PAYMENT_UNAVAILABLE", error: localizedHandoffError(locale, "HANDOFF_PAYMENT_UNAVAILABLE") }, 503);
  }

  const existing = await db.prepare(
    "SELECT id FROM lawyer_access_grants WHERE lawyer_request_id=? LIMIT 1",
  ).bind(handoff.id).first();
  if (existing) return response({ code: "GRANT_EXISTS", error: localizedHandoffError(locale, "GRANT_EXISTS") }, 409);

  const now = isoNow();
  const grantId = crypto.randomUUID();
  const results = await db.batch([
    db.prepare(
      `INSERT INTO lawyer_access_grants
        (id,lawyer_request_id,case_id,lawyer_user_id,granted_by_user_id,created_at)
       SELECT ?,r.id,r.case_id,p.user_id,?,?
       FROM lawyer_requests r
       JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id
        AND p.status='public_approved' AND p.marketplace_status='public_approved'
       JOIN conflict_checks c ON c.lawyer_request_id=r.id
        AND c.lawyer_profile_id=p.id AND c.status='clear'
       WHERE r.id=? AND r.workspace_id=? AND r.requester_user_id=?
        AND r.case_id=? AND p.user_id=? AND r.status='awaiting_user_consent'
        AND NOT EXISTS (
          SELECT 1 FROM lawyer_access_grants existing
          WHERE existing.lawyer_request_id=r.id
        )`,
    ).bind(
      grantId, user.id, now, handoff.id, workspace.id, user.id,
      handoff.caseId, handoff.lawyerUserId,
    ),
    db.prepare(
      `UPDATE lawyer_requests SET status='access_granted',updated_at=?
       WHERE id=? AND status='awaiting_user_consent'
        AND EXISTS (SELECT 1 FROM lawyer_access_grants WHERE id=? AND lawyer_request_id=?)`,
    ).bind(now, handoff.id, grantId, handoff.id),
    db.prepare(
      `INSERT INTO consents (id,user_id,workspace_id,type,version,scope_json,granted_at)
       SELECT ?,?,?,'lawyer_case_access','2026-08-06',?,?
       WHERE EXISTS (SELECT 1 FROM lawyer_access_grants WHERE id=? AND lawyer_request_id=?)`,
    ).bind(
      crypto.randomUUID(), user.id, workspace.id,
      JSON.stringify({ requestId: handoff.id, caseId: handoff.caseId, lawyerUserId: handoff.lawyerUserId, phoneContact: true, reciprocalPhoneDisclosure: true }),
      now, grantId, handoff.id,
    ),
    db.prepare(
      `INSERT INTO workspace_audit_events
        (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       SELECT ?,?,?,'lawyer_access_grant',?,'lawyer_case_access_granted',?,?
       WHERE EXISTS (SELECT 1 FROM lawyer_access_grants WHERE id=? AND lawyer_request_id=?)`,
    ).bind(
      crypto.randomUUID(), workspace.id, user.id, grantId,
      JSON.stringify({ requestId: handoff.id, caseId: handoff.caseId, lawyerUserId: handoff.lawyerUserId, phoneContact: true, reciprocalPhoneDisclosure: true }),
      now, grantId, handoff.id,
    ),
  ]);
  if (Number(results[0]?.meta.changes ?? 0) !== 1) {
    return response({ code: "CONFLICT_REQUIRED", error: localizedHandoffError(locale, "CONFLICT_REQUIRED") }, 409);
  }
  await recordLawyerAccessGrantCompletionEvidence({
    APP_ENV: runtimeEnv().APP_ENV ?? "development",
    DB: db,
  }, startedAt);
  return response({ ok: true, grantId, status: "access_granted" }, 201);
});

export const DELETE = withApiErrors(async function DELETE(request: Request, context: Context) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const { requestId } = await context.params;
  const db = requireD1();
  const grant = await db.prepare(
    `SELECT g.id,r.case_id AS caseId
     FROM lawyer_access_grants g JOIN lawyer_requests r ON r.id=g.lawyer_request_id
     WHERE g.lawyer_request_id=? AND r.workspace_id=? AND r.requester_user_id=? AND g.revoked_at IS NULL LIMIT 1`,
  ).bind(requestId, workspace.id, user.id).first<{ id: string; caseId: string }>();
  if (!grant) return response({ code: "REQUEST_UNAVAILABLE" }, 404);

  const now = isoNow();
  await db.batch([
    db.prepare("UPDATE lawyer_access_grants SET revoked_at=?,revoke_reason='user_revoked' WHERE id=? AND revoked_at IS NULL")
      .bind(now, grant.id),
    db.prepare("UPDATE lawyer_requests SET status='access_revoked',updated_at=? WHERE id=? AND status='access_granted'")
      .bind(now, requestId),
    db.prepare(
      "INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES (?,?,?,'lawyer_access_grant',?,'lawyer_case_access_revoked',?,?)",
    ).bind(crypto.randomUUID(), workspace.id, user.id, grant.id, JSON.stringify({ requestId, caseId: grant.caseId, reason: "user_revoked" }), now),
  ]);
  return response({ ok: true, status: "access_revoked" });
});
