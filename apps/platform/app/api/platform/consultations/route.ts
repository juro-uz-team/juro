import { parseJsonRequest } from "../../../../lib/auth/input";
import { localizedRequestFormatError } from "../../../../lib/auth/request-locale";
import { workspaceEntitlements } from "../../../../lib/billing/entitlements";
import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { comparisonForUser } from "../../../../lib/document-comparison/storage";
import { consultationBookingSchema } from "../../../../lib/platform/consultation";
import { requireSelectedWorkspace, workspaceForContentEditor } from "../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const db = requireD1();
  const [slots, bookings, entitlements] = await Promise.all([
    db.prepare(
      "SELECT s.id,s.specialist_type AS specialistType,s.starts_at AS startsAt,s.ends_at AS endsAt,s.timezone FROM consultation_slots s LEFT JOIN consultation_bookings b ON b.slot_id=s.id AND b.status NOT IN ('cancelled','completed') WHERE s.status='available' AND s.starts_at>? AND b.id IS NULL ORDER BY s.starts_at LIMIT 60",
    ).bind(new Date().toISOString()).all(),
    db.prepare(
      "SELECT b.id,b.status,s.specialist_type AS specialistType,s.starts_at AS startsAt,s.ends_at AS endsAt,b.case_id AS caseId,b.plan_step_id AS planStepId FROM consultation_bookings b JOIN consultation_slots s ON s.id=b.slot_id WHERE b.workspace_id=? ORDER BY s.starts_at",
    ).bind(workspace.id).all(),
    workspaceEntitlements(db, workspace.id),
  ]);
  return response({
    slots: slots.results,
    bookings: bookings.results,
    entitlements,
  });
});

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await workspaceForContentEditor(user, request.headers.get("x-juro-workspace-id"));
  const parsed = await parseJsonRequest(request, consultationBookingSchema, 4_096);
  if (!parsed.ok) {
    return response({
      code: parsed.error.toUpperCase(),
      error: localizedRequestFormatError(request),
    }, parsed.error === "payload_too_large" ? 413 : 400);
  }

  const locale = parsed.data.locale;
  const message = (ru: string, uz: string, en: string) =>
    locale === "ru" ? ru : locale === "uz" ? uz : en;
  const db = requireD1();
  const entitlements = await workspaceEntitlements(db, workspace.id);
  if (!entitlements.lawyerHandoff) {
    return response({
      code: "PLAN_LIMIT",
      error: message(
        "Передача специалисту недоступна на бесплатном плане.",
        "Mutaxassisga topshirish bepul rejada mavjud emas.",
        "Specialist handoff is not available on the free plan.",
      ),
    }, 403);
  }

  if (parsed.data.caseId) {
    const accessible = parsed.data.planStepId
      ? await db.prepare(
        "SELECT c.id FROM cases c JOIN action_plans p ON p.case_id=c.id JOIN action_plan_steps s ON s.plan_id=p.id WHERE c.id=? AND c.workspace_id=? AND s.id=? LIMIT 1",
      ).bind(parsed.data.caseId, workspace.id, parsed.data.planStepId).first()
      : await db.prepare(
        "SELECT id FROM cases WHERE id=? AND workspace_id=? LIMIT 1",
      ).bind(parsed.data.caseId, workspace.id).first();
    if (!accessible) {
      return response({
        code: "CONTEXT_UNAVAILABLE",
        error: message(
          "Выбранный контекст недоступен.",
          "Tanlangan kontekst mavjud emas.",
          "The selected context is unavailable.",
        ),
      }, 404);
    }
  }

  if (parsed.data.comparisonId) {
    const comparison = await comparisonForUser(
      db,
      parsed.data.comparisonId,
      workspace.id,
      user.id,
    );
    if (!comparison) {
      return response({
        code: "CONTEXT_UNAVAILABLE",
        error: message(
          "Выбранный контекст недоступен.",
          "Tanlangan kontekst mavjud emas.",
          "The selected context is unavailable.",
        ),
      }, 404);
    }
  }

  const slot = await db.prepare(
    "SELECT id FROM consultation_slots WHERE id=? AND status='available' AND starts_at>? LIMIT 1",
  ).bind(parsed.data.slotId, new Date().toISOString()).first();
  if (!slot) {
    return response({
      code: "SLOT_UNAVAILABLE",
      error: message(
        "Этот слот больше недоступен.",
        "Bu vaqt endi mavjud emas.",
        "This time slot is no longer available.",
      ),
    }, 409);
  }

  const now = isoNow();
  const bookingId = crypto.randomUUID();
  const scope = {
    caseId: parsed.data.caseId ?? null,
    planStepId: parsed.data.planStepId ?? null,
    comparisonId: parsed.data.comparisonId ?? null,
  };
  try {
    await db.batch([
      db.prepare(
        "INSERT INTO consultation_bookings (id,slot_id,requester_user_id,workspace_id,case_id,plan_step_id,status,context_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'request_created',?,?,?)",
      ).bind(
        bookingId,
        parsed.data.slotId,
        user.id,
        workspace.id,
        parsed.data.caseId ?? null,
        parsed.data.planStepId ?? null,
        JSON.stringify({ ...scope, consentVersion: "2026-07-30" }),
        now,
        now,
      ),
      db.prepare(
        "UPDATE consultation_slots SET status='booked',updated_at=? WHERE id=? AND status='available'",
      ).bind(now, parsed.data.slotId),
      db.prepare(
        "INSERT INTO consents (id,user_id,workspace_id,type,version,scope_json,granted_at) VALUES (?,?,?,'lawyer_handoff','2026-07-30',?,?)",
      ).bind(
        crypto.randomUUID(),
        user.id,
        workspace.id,
        JSON.stringify(scope),
        now,
      ),
      db.prepare(
        "INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES (?,?,?,'consultation_booking',?,'consultation_requested',?,?)",
      ).bind(
        crypto.randomUUID(),
        workspace.id,
        user.id,
        bookingId,
        JSON.stringify({
          caseId: scope.caseId,
          comparisonId: scope.comparisonId,
          planCode: entitlements.planCode,
        }),
        now,
      ),
    ]);
  } catch (error) {
    const unavailable = await db.prepare(
      "SELECT s.status,(SELECT count(*) FROM consultation_bookings b WHERE b.slot_id=s.id AND b.status NOT IN ('cancelled','completed')) AS activeBookings FROM consultation_slots s WHERE s.id=? LIMIT 1",
    ).bind(parsed.data.slotId).first<{ status: string; activeBookings: number }>();
    if (!unavailable || unavailable.status !== "available" || unavailable.activeBookings > 0) {
      return response({
        code: "SLOT_UNAVAILABLE",
        error: message(
          "Этот слот уже занят. Выберите другое время.",
          "Bu vaqt band. Boshqa vaqtni tanlang.",
          "This time slot has already been booked. Choose another time.",
        ),
      }, 409);
    }
    throw error;
  }

  return response({ ok: true, bookingId, status: "request_created" }, 201);
});
