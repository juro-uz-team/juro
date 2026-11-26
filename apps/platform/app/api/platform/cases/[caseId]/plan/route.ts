import { parseJsonRequest } from "../../../../../../lib/auth/input";
import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { confirmedActionPlanPatchSchema } from "../../../../../../lib/platform/action-plan";
import { calculateDeadline } from "../../../../../../lib/platform/deadline-calculator";
import { taskStatusForPlanStep, taskStatusIsTerminal } from "../../../../../../lib/platform/task-status";
import { workspaceForContentEditor } from "../../../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
}

function defaultReminderAt(dueAt: string, now: string): string {
  const due = new Date(`${dueAt.slice(0, 10)}T09:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() - 3);
  return due.getTime() < Date.parse(now) ? now : due.toISOString();
}

/** Applies an explicitly reviewed set of step changes as one optimistic plan revision. */
export const PATCH = withApiErrors(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string }> },
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const { caseId } = await params;
  const parsed = await parseJsonRequest(request, confirmedActionPlanPatchSchema, 16_384);
  if (!parsed.ok) {
    return response({ error: "Некорректное изменение плана.", code: parsed.error.toUpperCase() }, parsed.error === "payload_too_large" ? 413 : 400);
  }

  const db = requireD1();
  const workspace = await workspaceForContentEditor(user);
  const plan = await db.prepare(
    "SELECT p.id,p.current_revision AS currentRevision FROM action_plans p JOIN cases c ON c.id=p.case_id WHERE c.id=? AND c.workspace_id=? AND case_visible_to(c.id,?) AND c.archived_at IS NULL LIMIT 1",
  ).bind(caseId, workspace.id, user.id).first<{ id: string; currentRevision: number }>();
  if (!plan) return response({ error: "Дело или план недоступны.", code: "CASE_PLAN_UNAVAILABLE" }, 404);
  if (plan.currentRevision !== parsed.data.revision) {
    return response({ error: "План изменён в другой сессии.", code: "VERSION_CONFLICT" }, 409);
  }

  const ids = parsed.data.changes.map((change) => change.id);
  const placeholders = ids.map(() => "?").join(",");
  const ownedSteps = await db.prepare(
    `SELECT id,revision,due_at AS dueAt FROM action_plan_steps WHERE plan_id=? AND id IN (${placeholders})`,
  ).bind(plan.id, ...ids).all<{ id: string; revision: number; dueAt: string | null }>();
  if (ownedSteps.results.length !== parsed.data.changes.length
    || parsed.data.changes.some((change) => ownedSteps.results.find((step) => step.id === change.id)?.revision !== change.revision)) {
    return response({ error: "Один из шагов плана изменён или недоступен.", code: "VERSION_CONFLICT" }, 409);
  }

  const calculations = new Map<string, ReturnType<typeof calculateDeadline>>();
  for (const change of parsed.data.changes) {
    if (!change.deadlineCalculation) continue;
    const calculation = calculateDeadline(change.deadlineCalculation);
    if (change.dueAt !== calculation.dueDate) {
      return response({
        error: "Предпросмотр срока изменился. Выполните расчёт ещё раз.",
        code: "DEADLINE_PREVIEW_STALE",
      }, 409);
    }
    calculations.set(change.id, calculation);
  }

  const now = isoNow();
  const nextRevision = plan.currentRevision + 1;
  const changeStatements = parsed.data.changes.flatMap((change) => {
    const taskStatus = taskStatusForPlanStep(change.status);
    const reminderAt = change.dueAt && !taskStatusIsTerminal(taskStatus) ? defaultReminderAt(change.dueAt, now) : null;
    const calculation = calculations.get(change.id);
    const currentDueAt = ownedSteps.results.find((step) => step.id === change.id)?.dueAt ?? null;
    const clearCalculation = change.deadlineCalculation === null
      || (change.deadlineCalculation === undefined && change.dueAt !== currentDueAt);
    const stepUpdate = calculation
      ? db.prepare(
        "UPDATE action_plan_steps SET status=?,due_at=?,deadline_type=?,deadline_source_date=?,deadline_days_count=?,deadline_include_source_date=?,deadline_roll_rule=?,holiday_calendar_version=?,safe_due_at=?,calculation_method=?,deadline_legal_basis=?,deadline_evidence_json=?,deadline_confidence=?,completed_at=?,revision=revision+1,updated_at=? WHERE id=? AND plan_id=? AND revision=?",
      ).bind(
        change.status,
        calculation.dueDate,
        calculation.dayType,
        calculation.sourceDate,
        calculation.daysCount,
        calculation.includeSourceDate ? 1 : 0,
        calculation.rollRule,
        calculation.holidayCalendarVersion,
        calculation.safeEarlierDate,
        calculation.calculationMethod,
        calculation.legalBasis,
        JSON.stringify(calculation),
        calculation.confidence,
        change.status === "completed" ? now : null,
        now,
        change.id,
        plan.id,
        change.revision,
      )
      : clearCalculation
        ? db.prepare(
          "UPDATE action_plan_steps SET status=?,due_at=?,deadline_type='calendar_days',deadline_source_date=NULL,deadline_days_count=NULL,deadline_include_source_date=0,deadline_roll_rule='none',holiday_calendar_version=NULL,safe_due_at=NULL,calculation_method=NULL,deadline_legal_basis=NULL,deadline_evidence_json=NULL,deadline_confidence='unverified',completed_at=?,revision=revision+1,updated_at=? WHERE id=? AND plan_id=? AND revision=?",
        ).bind(change.status, change.dueAt, change.status === "completed" ? now : null, now, change.id, plan.id, change.revision)
        : db.prepare(
          "UPDATE action_plan_steps SET status=?,due_at=?,completed_at=?,revision=revision+1,updated_at=? WHERE id=? AND plan_id=? AND revision=?",
        ).bind(change.status, change.dueAt, change.status === "completed" ? now : null, now, change.id, plan.id, change.revision);
    const taskUpdate = calculation
      ? db.prepare(
        "UPDATE tasks SET status=?,source_date=?,due_at=?,safe_due_at=?,calculation_method=?,deadline_type=?,legal_basis=?,deadline_days_count=?,deadline_include_source_date=?,deadline_roll_rule=?,holiday_calendar_version=?,deadline_evidence_json=?,deadline_confidence=?,completed_at=?,updated_at=? WHERE plan_step_id=? AND case_id=? AND workspace_id=?",
      ).bind(
        taskStatus,
        calculation.sourceDate,
        calculation.dueDate,
        calculation.safeEarlierDate,
        calculation.calculationMethod,
        calculation.dayType,
        calculation.legalBasis,
        calculation.daysCount,
        calculation.includeSourceDate ? 1 : 0,
        calculation.rollRule,
        calculation.holidayCalendarVersion,
        JSON.stringify(calculation),
        calculation.confidence,
        taskStatus === "completed" ? now : null,
        now,
        change.id,
        caseId,
        workspace.id,
      )
      : clearCalculation
        ? db.prepare(
          "UPDATE tasks SET status=?,source_date=NULL,due_at=?,safe_due_at=NULL,calculation_method=NULL,deadline_type='calendar_days',legal_basis=NULL,deadline_days_count=NULL,deadline_include_source_date=0,deadline_roll_rule='none',holiday_calendar_version=NULL,deadline_evidence_json=NULL,deadline_confidence='unverified',completed_at=?,updated_at=? WHERE plan_step_id=? AND case_id=? AND workspace_id=?",
        ).bind(taskStatus, change.dueAt, taskStatus === "completed" ? now : null, now, change.id, caseId, workspace.id)
        : db.prepare(
          "UPDATE tasks SET status=?,due_at=?,completed_at=?,updated_at=? WHERE plan_step_id=? AND case_id=? AND workspace_id=?",
        ).bind(taskStatus, change.dueAt, taskStatus === "completed" ? now : null, now, change.id, caseId, workspace.id);
    return [
      stepUpdate,
      taskUpdate,
      db.prepare(
        "UPDATE task_reminders SET status='cancelled',updated_at=? WHERE task_id=? AND status='pending'",
      ).bind(now, change.id),
      db.prepare(
        "INSERT OR IGNORE INTO task_reminders (id,task_id,channel,reminder_at,status,idempotency_key,created_at,updated_at) SELECT ?,id,'in_app',?,'pending',?,?,? FROM tasks WHERE id=? AND workspace_id=? AND case_id=? AND ? IS NOT NULL",
      ).bind(`${change.id}:in_app:r${change.revision + 1}`, reminderAt, `${change.id}:in_app:r${change.revision + 1}`, now, now, change.id, workspace.id, caseId, reminderAt),
      db.prepare(
        "INSERT OR IGNORE INTO task_reminders (id,task_id,channel,reminder_at,status,idempotency_key,created_at,updated_at) SELECT ?,id,'email',?,'pending',?,?,? FROM tasks WHERE id=? AND workspace_id=? AND case_id=? AND ? IS NOT NULL",
      ).bind(`${change.id}:email:r${change.revision + 1}`, reminderAt, `${change.id}:email:r${change.revision + 1}`, now, now, change.id, workspace.id, caseId, reminderAt),
    ];
  });

  try {
    await db.batch([
      ...changeStatements,
      db.prepare(
        "UPDATE action_plans SET progress_percent=(SELECT CASE WHEN count(*)=0 THEN 0 ELSE round(100.0*sum(CASE WHEN status='completed' THEN 1 ELSE 0 END)/count(*)) END FROM action_plan_steps WHERE plan_id=?),status=CASE WHEN (SELECT count(*) FROM action_plan_steps WHERE plan_id=? AND status<>'completed')=0 THEN 'completed' ELSE 'in_progress' END,current_revision=current_revision+1,updated_at=? WHERE id=? AND current_revision=?",
      ).bind(plan.id, plan.id, now, plan.id, plan.currentRevision),
      db.prepare(
        "INSERT INTO action_plan_versions (id,plan_id,version,created_by_user_id,reason,snapshot_json,created_at) SELECT ?,p.id,?,?,'plan_changes_confirmed',CASE WHEN p.current_revision=? THEN json_object('version',p.current_revision,'title',p.title,'status',p.status,'progressPercent',p.progress_percent,'steps',(SELECT json_group_array(json_object('id',s.id,'ordinal',s.ordinal,'title',s.title,'description',s.description,'status',s.status,'dueAt',s.due_at,'safeDueAt',s.safe_due_at,'sourceDate',s.deadline_source_date,'deadlineType',s.deadline_type,'calculationMethod',s.calculation_method,'deadlineConfidence',s.deadline_confidence,'actionType',s.action_type,'templateCode',s.template_code,'revision',s.revision)) FROM (SELECT id,ordinal,title,description,status,due_at,safe_due_at,deadline_source_date,deadline_type,calculation_method,deadline_confidence,action_type,template_code,revision FROM action_plan_steps WHERE plan_id=p.id ORDER BY ordinal) s)) ELSE NULL END,? FROM action_plans p WHERE p.id=?",
      ).bind(crypto.randomUUID(), nextRevision, user.id, nextRevision, now, plan.id),
      db.prepare(
        "UPDATE cases SET next_deadline_at=(SELECT min(s.due_at) FROM action_plan_steps s JOIN action_plans p ON p.id=s.plan_id WHERE p.case_id=? AND s.due_at IS NOT NULL AND s.status NOT IN ('completed','cancelled')),current_revision=current_revision+1,updated_at=? WHERE id=? AND workspace_id=?",
      ).bind(caseId, now, caseId, workspace.id),
      db.prepare(
        "INSERT INTO case_events (id,case_id,actor_user_id,event_type,metadata_json,created_at) VALUES (?,?,?,'plan_changes_confirmed',?,?)",
      ).bind(crypto.randomUUID(), caseId, user.id, JSON.stringify({
        planId: plan.id,
        planVersion: nextRevision,
        changeCount: parsed.data.changes.length,
        calculatedDeadlineCount: calculations.size,
      }), now),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/action_plan_versions|NOT NULL constraint failed/i.test(message)) {
      return response({ error: "План изменён в другой сессии.", code: "VERSION_CONFLICT" }, 409);
    }
    throw error;
  }

  return response({
    ok: true,
    planVersion: nextRevision,
    changeCount: parsed.data.changes.length,
    calculatedDeadlineCount: calculations.size,
  });
});
