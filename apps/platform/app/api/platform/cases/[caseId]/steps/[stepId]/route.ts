import { parseJsonRequest } from "../../../../../../../lib/auth/input";
import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../../lib/document-builder/storage/runtime";
import { actionPlanStepPatchSchema } from "../../../../../../../lib/platform/action-plan";
import { calculateDeadline } from "../../../../../../../lib/platform/deadline-calculator";
import { taskStatusForPlanStep, taskStatusIsTerminal } from "../../../../../../../lib/platform/task-status";
import { workspaceForContentEditor } from "../../../../../../../lib/platform/workspace";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

function defaultReminderAt(dueAt: string, now: string): string {
  const due = new Date(`${dueAt.slice(0, 10)}T09:00:00.000Z`);
  due.setUTCDate(due.getUTCDate() - 3);
  return due.getTime() < Date.parse(now) ? now : due.toISOString();
}

export const PATCH = withApiErrors(async function PATCH(
  request: Request,
  { params }: { params: Promise<{ caseId: string; stepId: string }> },
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const { caseId, stepId } = await params;
  const parsed = await parseJsonRequest(request, actionPlanStepPatchSchema, 2_048);
  if (!parsed.ok) {
    return response({
      error: "Некорректное изменение шага.",
      code: parsed.error.toUpperCase(),
    }, parsed.error === "payload_too_large" ? 413 : 400);
  }

  const db = requireD1();
  const workspace = await workspaceForContentEditor(user);
  const owned = await db.prepare(
    "SELECT s.plan_id AS planId,s.due_at AS dueAt,p.current_revision AS planRevision FROM action_plan_steps s JOIN action_plans p ON p.id=s.plan_id JOIN cases c ON c.id=p.case_id WHERE s.id=? AND c.id=? AND c.workspace_id=? AND case_visible_to(c.id,?) LIMIT 1",
  ).bind(stepId, caseId, workspace.id, user.id).first<{
    planId: string;
    dueAt: string | null;
    planRevision: number;
  }>();
  if (!owned) {
    return response({
      error: "Дело или шаг недоступны.",
      code: "CASE_STEP_UNAVAILABLE",
    }, 404);
  }

  const now = isoNow();
  const version = owned.planRevision + 1;
  const taskStatus = taskStatusForPlanStep(parsed.data.status);
  const calculation = parsed.data.deadlineCalculation
    ? calculateDeadline(parsed.data.deadlineCalculation)
    : null;
  if (calculation && parsed.data.dueAt !== calculation.dueDate) {
    return response({
      error: "Предпросмотр срока изменился. Выполните расчёт ещё раз.",
      code: "DEADLINE_PREVIEW_STALE",
    }, 409);
  }
  const clearCalculation = parsed.data.deadlineCalculation === null
    || (parsed.data.deadlineCalculation === undefined && parsed.data.dueAt !== owned.dueAt);
  const reminderAt = parsed.data.dueAt && !taskStatusIsTerminal(taskStatus)
    ? defaultReminderAt(parsed.data.dueAt, now)
    : null;
  try {
    const stepUpdate = calculation
      ? db.prepare(
        "UPDATE action_plan_steps SET status=?,due_at=?,deadline_type=?,deadline_source_date=?,deadline_days_count=?,deadline_include_source_date=?,deadline_roll_rule=?,holiday_calendar_version=?,safe_due_at=?,calculation_method=?,deadline_legal_basis=?,deadline_evidence_json=?,deadline_confidence=?,completed_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
      ).bind(
        parsed.data.status,
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
        parsed.data.status === "completed" ? now : null,
        now,
        stepId,
        parsed.data.revision,
      )
      : clearCalculation
        ? db.prepare(
          "UPDATE action_plan_steps SET status=?,due_at=?,deadline_type='calendar_days',deadline_source_date=NULL,deadline_days_count=NULL,deadline_include_source_date=0,deadline_roll_rule='none',holiday_calendar_version=NULL,safe_due_at=NULL,calculation_method=NULL,deadline_legal_basis=NULL,deadline_evidence_json=NULL,deadline_confidence='unverified',completed_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
        ).bind(parsed.data.status, parsed.data.dueAt, parsed.data.status === "completed" ? now : null, now, stepId, parsed.data.revision)
        : db.prepare(
          "UPDATE action_plan_steps SET status=?,due_at=?,completed_at=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?",
        ).bind(parsed.data.status, parsed.data.dueAt, parsed.data.status === "completed" ? now : null, now, stepId, parsed.data.revision);
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
        stepId,
        caseId,
        workspace.id,
      )
      : clearCalculation
        ? db.prepare(
          "UPDATE tasks SET status=?,source_date=NULL,due_at=?,safe_due_at=NULL,calculation_method=NULL,deadline_type='calendar_days',legal_basis=NULL,deadline_days_count=NULL,deadline_include_source_date=0,deadline_roll_rule='none',holiday_calendar_version=NULL,deadline_evidence_json=NULL,deadline_confidence='unverified',completed_at=?,updated_at=? WHERE plan_step_id=? AND case_id=? AND workspace_id=?",
        ).bind(taskStatus, parsed.data.dueAt, taskStatus === "completed" ? now : null, now, stepId, caseId, workspace.id)
        : db.prepare(
          "UPDATE tasks SET status=?,due_at=?,completed_at=?,updated_at=? WHERE plan_step_id=? AND case_id=? AND workspace_id=?",
        ).bind(taskStatus, parsed.data.dueAt, taskStatus === "completed" ? now : null, now, stepId, caseId, workspace.id);
    await db.batch([
      stepUpdate,
      db.prepare(
        "UPDATE action_plans SET progress_percent=(SELECT CASE WHEN count(*)=0 THEN 0 ELSE round(100.0*sum(CASE WHEN status='completed' THEN 1 ELSE 0 END)/count(*)) END FROM action_plan_steps WHERE plan_id=?),status=CASE WHEN (SELECT count(*) FROM action_plan_steps WHERE plan_id=? AND status<>'completed')=0 THEN 'completed' ELSE 'in_progress' END,current_revision=current_revision+1,updated_at=? WHERE id=? AND current_revision=?",
      ).bind(owned.planId, owned.planId, now, owned.planId, owned.planRevision),
      taskUpdate,
      db.prepare(
        "UPDATE task_reminders SET status='cancelled',updated_at=? WHERE task_id=? AND status='pending'",
      ).bind(now, stepId),
      db.prepare(
        "INSERT OR IGNORE INTO task_reminders (id,task_id,channel,reminder_at,status,idempotency_key,created_at,updated_at) SELECT ?,id,'in_app',?,'pending',?,?,? FROM tasks WHERE id=? AND workspace_id=? AND case_id=? AND ? IS NOT NULL",
      ).bind(`${stepId}:in_app:r${parsed.data.revision + 1}`, reminderAt, `${stepId}:in_app:r${parsed.data.revision + 1}`, now, now, stepId, workspace.id, caseId, reminderAt),
      db.prepare(
        "INSERT OR IGNORE INTO task_reminders (id,task_id,channel,reminder_at,status,idempotency_key,created_at,updated_at) SELECT ?,id,'email',?,'pending',?,?,? FROM tasks WHERE id=? AND workspace_id=? AND case_id=? AND ? IS NOT NULL",
      ).bind(`${stepId}:email:r${parsed.data.revision + 1}`, reminderAt, `${stepId}:email:r${parsed.data.revision + 1}`, now, now, stepId, workspace.id, caseId, reminderAt),
      db.prepare(
        "INSERT INTO action_plan_versions (id,plan_id,version,created_by_user_id,reason,snapshot_json,created_at) SELECT ?,p.id,?,?,'step_updated',CASE WHEN (SELECT revision FROM action_plan_steps WHERE id=?)=? AND p.current_revision=? THEN json_object('version',p.current_revision,'title',p.title,'status',p.status,'progressPercent',p.progress_percent,'steps',(SELECT json_group_array(json_object('id',s.id,'ordinal',s.ordinal,'title',s.title,'description',s.description,'status',s.status,'dueAt',s.due_at,'safeDueAt',s.safe_due_at,'sourceDate',s.deadline_source_date,'deadlineType',s.deadline_type,'calculationMethod',s.calculation_method,'deadlineConfidence',s.deadline_confidence,'actionType',s.action_type,'templateCode',s.template_code,'revision',s.revision)) FROM (SELECT id,ordinal,title,description,status,due_at,safe_due_at,deadline_source_date,deadline_type,calculation_method,deadline_confidence,action_type,template_code,revision FROM action_plan_steps WHERE plan_id=p.id ORDER BY ordinal) s)) ELSE NULL END,? FROM action_plans p WHERE p.id=?",
      ).bind(
        crypto.randomUUID(),
        version,
        user.id,
        stepId,
        parsed.data.revision + 1,
        version,
        now,
        owned.planId,
      ),
      db.prepare(
        "UPDATE cases SET next_deadline_at=(SELECT min(s.due_at) FROM action_plan_steps s JOIN action_plans p ON p.id=s.plan_id WHERE p.case_id=? AND s.due_at IS NOT NULL AND s.status NOT IN ('completed','cancelled')),current_revision=current_revision+1,updated_at=? WHERE id=? AND workspace_id=?",
      ).bind(caseId, now, caseId, workspace.id),
      db.prepare(
        "INSERT INTO case_events (id,case_id,actor_user_id,event_type,metadata_json,created_at) VALUES (?,?,?,'step_updated',?,?)",
      ).bind(
        crypto.randomUUID(),
        caseId,
        user.id,
        JSON.stringify({
          stepId,
          status: parsed.data.status,
          dueAt: parsed.data.dueAt,
          deadlineConfidence: calculation?.confidence ?? (clearCalculation ? "unverified" : undefined),
          planVersion: version,
        }),
        now,
      ),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/action_plan_versions|NOT NULL constraint failed/i.test(message)) {
      return response({
        error: "Шаг уже изменён в другой сессии.",
        code: "VERSION_CONFLICT",
      }, 409);
    }
    throw error;
  }

  const current = await db.prepare(
    "SELECT p.progress_percent AS progress,c.next_deadline_at AS nextDeadlineAt FROM action_plans p JOIN cases c ON c.id=p.case_id WHERE p.id=? AND c.id=? AND c.workspace_id=? LIMIT 1",
  ).bind(owned.planId, caseId, workspace.id).first<{
    progress: number;
    nextDeadlineAt: string | null;
  }>();
  if (!current) {
    return response({
      error: "Дело или шаг недоступны.",
      code: "CASE_STEP_UNAVAILABLE",
    }, 404);
  }

  return response({
    ok: true,
    progress: current.progress,
    revision: parsed.data.revision + 1,
    planVersion: version,
    nextDeadlineAt: current.nextDeadlineAt,
  });
});
