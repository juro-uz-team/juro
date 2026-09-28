import { sendEmailRequest } from "../runtime/email";
import {
  createIdentityProtectionContext,
  userIdentityById,
} from "../auth/identity-protection";

const JOB_PREFIX = "task-reminder-email:";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]+$/;

export type TaskReminderEmailErrorCode =
  | "EMAIL_CONFIGURATION_UNAVAILABLE"
  | "EMAIL_JOB_INVALID"
  | "EMAIL_PROVIDER_REJECTED"
  | "EMAIL_PROVIDER_UNAVAILABLE";

export class TaskReminderEmailError extends Error {
  constructor(
    readonly code: TaskReminderEmailErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "TaskReminderEmailError";
  }
}

export type TaskReminderEmailRuntimeEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  IDENTITY_KEYRING?: string;
  IDENTITY_PROTECTION_MODE?: string;
};

type EmailJobRow = {
  id: string;
  reminderId: string;
  workspaceId: string;
  userId: string;
  reminderUpdatedAt: string;
  status: string;
  providerMessageId: string | null;
  taskTitle: string;
  dueAt: string | null;
  caseTitle: string;
  locale: "ru" | "uz" | "en";
  reminderStatus: string;
  reminderAt: string;
  currentReminderUpdatedAt: string;
  taskStatus: string;
  caseArchivedAt: string | null;
  memberStatus: string | null;
};

export function taskReminderEmailJobId(
  reminderId: string,
  updatedAt: string,
): string {
  if (!IDENTIFIER_PATTERN.test(reminderId) || reminderId.length > 140) {
    throw new TaskReminderEmailError("EMAIL_JOB_INVALID", false);
  }
  const milliseconds = Date.parse(updatedAt);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new TaskReminderEmailError("EMAIL_JOB_INVALID", false);
  }
  const id = `${JOB_PREFIX}${reminderId}:${milliseconds.toString(36)}`;
  if (id.length > 180) {
    throw new TaskReminderEmailError("EMAIL_JOB_INVALID", false);
  }
  return id;
}

export function isTaskReminderEmailJobId(value: string): boolean {
  return value.startsWith(JOB_PREFIX) && value.length <= 180;
}

export async function executeTaskReminderEmail(
  env: TaskReminderEmailRuntimeEnv,
  jobId: string,
): Promise<{ providerMessageId: string | null; alreadySent: boolean; cancelled: boolean }> {
  const row = await emailJob(env.DB, jobId);
  if (!row || !isTaskReminderEmailJobId(jobId)) {
    throw new TaskReminderEmailError("EMAIL_JOB_INVALID", false);
  }
  if (row.status === "sent") {
    return { providerMessageId: row.providerMessageId, alreadySent: true, cancelled: false };
  }
  if (["failed", "cancelled"].includes(row.status)) {
    throw new TaskReminderEmailError("EMAIL_JOB_INVALID", false);
  }

  const now = new Date().toISOString();
  if (sourceIsInactiveOrStale(row, now)) {
    await cancelJob(env.DB, row, now);
    return { providerMessageId: null, alreadySent: false, cancelled: true };
  }
  const staleSendingBefore = new Date(Date.parse(now) - 2 * 60 * 1_000).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE task_reminder_email_jobs
     SET status='sending',attempt_count=attempt_count+1,error_code=NULL,updated_at=?
     WHERE id=? AND (
       status IN ('pending','retrying')
       OR (status='sending' AND updated_at<=?)
     )`,
  ).bind(now, row.id, staleSendingBefore).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    const current = await emailJob(env.DB, jobId);
    if (current?.status === "sent") {
      return { providerMessageId: current.providerMessageId, alreadySent: true, cancelled: false };
    }
    throw new TaskReminderEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
  }

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    const error = new TaskReminderEmailError("EMAIL_CONFIGURATION_UNAVAILABLE", false);
    await failJob(env.DB, row.id, error, now);
    throw error;
  }

  let recipient: string;
  try {
    const identity = await userIdentityById(
      env.DB,
      createIdentityProtectionContext(
        env.IDENTITY_PROTECTION_MODE,
        env.IDENTITY_KEYRING,
      ),
      row.userId,
    );
    if (!identity) throw new Error("IDENTITY_NOT_FOUND");
    recipient = identity.email;
  } catch {
    const error = new TaskReminderEmailError("EMAIL_JOB_INVALID", false);
    await failJob(env.DB, row.id, error, new Date().toISOString());
    throw error;
  }

  const copy = emailCopy(row);
  let response: Response | null = null;
  try {
    response = await sendEmailRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": `juro_task_reminder_${row.id}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [recipient],
        subject: copy.subject,
        html: copy.html,
        text: copy.text,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const error = providerFailure(response.status);
      await response.body?.cancel();
      await failJob(env.DB, row.id, error, new Date().toISOString());
      throw error;
    }
    const payload = await response.json().catch(() => null) as { id?: unknown } | null;
    if (typeof payload?.id !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(payload.id)) {
      const error = new TaskReminderEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
      await failJob(env.DB, row.id, error, new Date().toISOString());
      throw error;
    }
    const sentAt = new Date().toISOString();
    const [job, reminder] = await env.DB.batch([
      env.DB.prepare(
        `UPDATE task_reminder_email_jobs
         SET status='sent',provider_message_id=?,error_code=NULL,sent_at=?,updated_at=?
         WHERE id=? AND status='sending'`,
      ).bind(payload.id, sentAt, sentAt, row.id),
      env.DB.prepare(
        `UPDATE task_reminders
         SET status='sent',sent_at=?,updated_at=?
         WHERE id=? AND channel='email' AND status='pending' AND updated_at=?`,
      ).bind(sentAt, sentAt, row.reminderId, row.reminderUpdatedAt),
    ]);
    if (Number(job?.meta.changes ?? 0) !== 1 || Number(reminder?.meta.changes ?? 0) !== 1) {
      throw new TaskReminderEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
    }
    return { providerMessageId: payload.id, alreadySent: false, cancelled: false };
  } catch (error) {
    if (error instanceof TaskReminderEmailError) throw error;
    try { await response?.body?.cancel(); } catch { /* no usable body */ }
    const safe = new TaskReminderEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
    await failJob(env.DB, row.id, safe, new Date().toISOString()).catch(() => undefined);
    throw safe;
  }
}

async function emailJob(db: D1Database, jobId: string): Promise<EmailJobRow | null> {
  return db.prepare(
    `SELECT job.id,job.reminder_id AS reminderId,job.workspace_id AS workspaceId,
       job.user_id AS userId,job.reminder_updated_at AS reminderUpdatedAt,
       job.status,job.provider_message_id AS providerMessageId,
       task.title AS taskTitle,task.due_at AS dueAt,legal_case.title AS caseTitle,
       legal_case.locale,reminder.status AS reminderStatus,
       reminder.reminder_at AS reminderAt,reminder.updated_at AS currentReminderUpdatedAt,
       task.status AS taskStatus,legal_case.archived_at AS caseArchivedAt,
       member.status AS memberStatus
     FROM task_reminder_email_jobs job
     JOIN task_reminders reminder ON reminder.id=job.reminder_id
     JOIN tasks task ON task.id=reminder.task_id
       AND task.workspace_id=job.workspace_id AND task.owner_user_id=job.user_id
     JOIN cases legal_case ON legal_case.id=task.case_id AND legal_case.workspace_id=task.workspace_id
     LEFT JOIN workspace_members member ON member.workspace_id=task.workspace_id AND member.user_id=task.owner_user_id
     WHERE job.id=? LIMIT 1`,
  ).bind(jobId).first<EmailJobRow>();
}

function sourceIsInactiveOrStale(row: EmailJobRow, now: string): boolean {
  return row.currentReminderUpdatedAt !== row.reminderUpdatedAt
    || row.reminderStatus !== "pending"
    || row.reminderAt > now
    || row.memberStatus !== "active"
    || row.caseArchivedAt !== null
    || ["completed", "cancelled"].includes(row.taskStatus);
}

async function cancelJob(db: D1Database, row: EmailJobRow, now: string): Promise<void> {
  await db.batch([
    db.prepare(
      `UPDATE task_reminder_email_jobs SET status='cancelled',error_code='SOURCE_STALE',updated_at=?
       WHERE id=? AND status IN ('pending','sending','retrying')`,
    ).bind(now, row.id),
    db.prepare(
      `UPDATE task_reminders SET status='cancelled',updated_at=?
       WHERE id=? AND channel='email' AND status='pending' AND updated_at=?`,
    ).bind(now, row.reminderId, row.reminderUpdatedAt),
  ]);
}

async function failJob(
  db: D1Database,
  jobId: string,
  error: TaskReminderEmailError,
  now: string,
): Promise<void> {
  const status = error.retryable ? "retrying" : "failed";
  await db.batch([
    db.prepare(
      `UPDATE task_reminder_email_jobs SET status=?,error_code=?,updated_at=?
       WHERE id=? AND status='sending'`,
    ).bind(status, error.code, now, jobId),
    db.prepare(
      `UPDATE task_reminders SET status='failed',updated_at=?
       WHERE id=(SELECT reminder_id FROM task_reminder_email_jobs WHERE id=?)
         AND channel='email' AND status='pending' AND ?='failed'`,
    ).bind(now, jobId, status),
  ]);
}

function providerFailure(status: number): TaskReminderEmailError {
  return status === 408 || status === 425 || status === 429 || status >= 500
    ? new TaskReminderEmailError("EMAIL_PROVIDER_UNAVAILABLE", true)
    : new TaskReminderEmailError("EMAIL_PROVIDER_REJECTED", false);
}

function emailCopy(row: EmailJobRow): { subject: string; html: string; text: string } {
  const task = escapeHtml(row.taskTitle);
  const legalCase = escapeHtml(row.caseTitle);
  const due = escapeHtml(formatDueDate(row.dueAt, row.locale));
  if (row.locale === "en") {
    return {
      subject: "JURO: task deadline approaching",
      html: `<div style="font-family:Arial,sans-serif;color:#111d36"><h2>Task deadline approaching</h2><p><strong>${task}</strong></p><p>Matter: ${legalCase}<br>Due: ${due}</p><p>Review the plan and deadline in your JURO account.</p></div>`,
      text: `Task deadline approaching\n\n${row.taskTitle}\nMatter: ${row.caseTitle}\nDue: ${formatDueDate(row.dueAt, row.locale)}\n\nReview the plan and deadline in your JURO account.`,
    };
  }
  if (row.locale === "uz") {
    return {
      subject: "JURO: vazifa muddati yaqinlashmoqda",
      html: `<div style="font-family:Arial,sans-serif;color:#111d36"><h2>Vazifa muddati yaqinlashmoqda</h2><p><strong>${task}</strong></p><p>Ish: ${legalCase}<br>Muddat: ${due}</p><p>Reja va muddatni JURO hisobingizda tekshiring.</p></div>`,
      text: `Vazifa muddati yaqinlashmoqda\n\n${row.taskTitle}\nIsh: ${row.caseTitle}\nMuddat: ${formatDueDate(row.dueAt, row.locale)}\n\nReja va muddatni JURO hisobingizda tekshiring.`,
    };
  }
  return {
    subject: "JURO: приближается срок по задаче",
    html: `<div style="font-family:Arial,sans-serif;color:#111d36"><h2>Приближается срок по задаче</h2><p><strong>${task}</strong></p><p>Дело: ${legalCase}<br>Срок: ${due}</p><p>Проверьте план и срок в своём аккаунте JURO.</p></div>`,
    text: `Приближается срок по задаче\n\n${row.taskTitle}\nДело: ${row.caseTitle}\nСрок: ${formatDueDate(row.dueAt, row.locale)}\n\nПроверьте план и срок в своём аккаунте JURO.`,
  };
}

function formatDueDate(value: string | null, locale: "ru" | "uz" | "en"): string {
  const missing = { ru: "не назначен", uz: "belgilanmagan", en: "not set" }[locale];
  if (!value) return missing;
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) return missing;
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], {
    dateStyle: "long",
    timeZone: "Asia/Tashkent",
  }).format(parsed);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
}
