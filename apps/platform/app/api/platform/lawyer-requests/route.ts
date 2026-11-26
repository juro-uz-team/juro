import { parseJsonRequest } from "../../../../lib/auth/input";
import { workspaceEntitlements } from "../../../../lib/billing/entitlements";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import { requireD1, runtimeEnv } from "../../../../lib/document-builder/storage/runtime";
import { lawyerRequestSchema, localizedHandoffError } from "../../../../lib/platform/lawyer-request";
import { workspaceForContentEditor, requireSelectedWorkspace } from "../../../../lib/platform/workspace";
import { assertOperationalFeatureEnabled, operationalEnvironment, OperationalFeatureError, operationalFeatureMessage } from "../../../../lib/operations/operational-feature-flags";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const db = requireD1();
  const results = await db.prepare(
    `SELECT r.id,r.case_id AS caseId,r.lawyer_profile_id AS lawyerProfileId,r.status,r.anonymized_summary AS anonymizedSummary,
      r.created_at AS createdAt,r.updated_at AS updatedAt,p.display_name AS lawyerName,
      json_extract(r.requested_scope_json,'$.serviceCode') AS serviceCode,
      json_extract(r.requested_scope_json,'$.paidTransfer') AS paidTransfer,
      json_extract(r.requested_scope_json,'$.preferredFormat') AS preferredFormat,
      json_extract(r.requested_scope_json,'$.proposedStartsAt') AS proposedStartsAt,
      c.status AS conflictStatus,g.id AS activeGrantId,g.created_at AS grantedAt,
      (SELECT o.id FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) AS offerId,
      (SELECT o.status FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) AS offerStatus,
      (SELECT o.scope_description FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) AS offerScopeDescription,
      (SELECT o.price_description FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) AS offerPriceDescription,
      (SELECT o.duration_description FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) AS offerDurationDescription
     FROM lawyer_requests r
     LEFT JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id
     LEFT JOIN conflict_checks c ON c.lawyer_request_id=r.id
     LEFT JOIN lawyer_access_grants g ON g.lawyer_request_id=r.id AND g.revoked_at IS NULL
     WHERE r.workspace_id=? AND r.requester_user_id=?
     ORDER BY r.updated_at DESC LIMIT 100`,
  ).bind(workspace.id, user.id).all();
  return response({ requests: results.results });
});

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user, request.headers.get("x-juro-workspace-id"));
  const parsed = await parseJsonRequest(request, lawyerRequestSchema, 4_096);
  const locale = parsed.ok ? parsed.data.locale : "ru";
  if (!parsed.ok) {
    return response({ code: "INVALID_INPUT", error: localizedHandoffError(locale, "INVALID_INPUT") }, parsed.error === "payload_too_large" ? 413 : 400);
  }

  const db = requireD1();
  try {
    await assertOperationalFeatureEnabled({ db, environment: operationalEnvironment(runtimeEnv().APP_ENV), key: "lawyer_handoff" });
  } catch (error) {
    if (!(error instanceof OperationalFeatureError)) throw error;
    return response({ code: error.code, error: operationalFeatureMessage(locale) }, 503);
  }
  const entitlements = await workspaceEntitlements(db, workspace.id);
  if (!entitlements.lawyerHandoff) {
    return response({ code: "PLAN_LIMIT", error: localizedHandoffError(locale, "PLAN_LIMIT") }, 403);
  }

  const caseRow = await db.prepare(
    "SELECT id FROM cases WHERE id=? AND workspace_id=? AND case_visible_to(id,?) AND archived_at IS NULL LIMIT 1",
  ).bind(parsed.data.caseId, workspace.id, user.id).first();
  if (!caseRow) {
    return response({ code: "CASE_UNAVAILABLE", error: localizedHandoffError(locale, "CASE_UNAVAILABLE") }, 404);
  }

  const lawyer = parsed.data.lawyerProfileId
    ? await db.prepare(
      "SELECT id,user_id AS userId FROM lawyer_profiles WHERE id=? AND status='public_approved' AND marketplace_status='public_approved' LIMIT 1",
    ).bind(parsed.data.lawyerProfileId).first<{ id: string; userId: string }>()
    : null;
  if (parsed.data.lawyerProfileId && !lawyer) {
    return response({ code: "LAWYER_UNAVAILABLE", error: localizedHandoffError(locale, "LAWYER_UNAVAILABLE") }, 404);
  }

  const now = isoNow();
  const requestId = crypto.randomUUID();
  const conflictCheckId = lawyer ? crypto.randomUUID() : null;
  const status = lawyer ? "conflict_check_pending" : "unassigned";
  const scope = { caseId: parsed.data.caseId, stage: "anonymized_conflict_check", lawyerProfileId: lawyer?.id ?? null };
  await db.batch([
    db.prepare(
      "INSERT INTO lawyer_requests (id,workspace_id,case_id,requester_user_id,lawyer_profile_id,status,anonymized_summary,requested_scope_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).bind(requestId, workspace.id, parsed.data.caseId, user.id, lawyer?.id ?? null, status, parsed.data.anonymizedSummary, JSON.stringify({
      scope: "case",
      consentVersion: "2026-07-31",
      paidTransfer: "required",
      serviceCode: parsed.data.serviceCode ?? null,
      preferredFormat: parsed.data.preferredFormat ?? null,
      proposedStartsAt: parsed.data.proposedStartsAt ?? null,
    }), now, now),
    ...(lawyer && conflictCheckId ? [db.prepare(
      "INSERT INTO conflict_checks (id,lawyer_request_id,lawyer_profile_id,status,created_at) VALUES (?,?,?,'pending',?)",
    ).bind(conflictCheckId, requestId, lawyer.id, now)] : []),
    db.prepare(
      "INSERT INTO consents (id,user_id,workspace_id,type,version,scope_json,granted_at) VALUES (?,?,?,'lawyer_handoff','2026-07-31',?,?)",
    ).bind(crypto.randomUUID(), user.id, workspace.id, JSON.stringify(scope), now),
    db.prepare(
      "INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES (?,?,?,'lawyer_request',?,'lawyer_request_created',?,?)",
    ).bind(crypto.randomUUID(), workspace.id, user.id, requestId, JSON.stringify({
      caseId: parsed.data.caseId,
      lawyerProfileId: lawyer?.id ?? null,
      planCode: entitlements.planCode,
      serviceCode: parsed.data.serviceCode ?? null,
      preferredFormat: parsed.data.preferredFormat ?? null,
      hasProposedStart: Boolean(parsed.data.proposedStartsAt),
    }), now),
  ]);

  return response({ ok: true, requestId, status, conflictCheckRequired: Boolean(lawyer) }, 201);
});
