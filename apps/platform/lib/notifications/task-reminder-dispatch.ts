const SUBJECT_PREFIX = "task-reminder:";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9:_-]+$/;

export type NotificationDispatchErrorCode =
  | "NOTIFICATION_INTEGRITY_FAILED"
  | "NOTIFICATION_PERSISTENCE_FAILED"
  | "NOTIFICATION_SOURCE_NOT_FOUND";

export class NotificationDispatchError extends Error {
  constructor(
    readonly code: NotificationDispatchErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "NotificationDispatchError";
  }
}

type ReminderRow = {
  reminderId: string;
  taskId: string;
  workspaceId: string;
  userId: string;
  taskTitle: string;
  locale: "ru" | "uz" | "en";
  reminderAt: string;
  reminderStatus: string;
  reminderUpdatedAt: string;
  taskStatus: string;
  caseArchivedAt: string | null;
  memberStatus: string | null;
};

type DispatchResult = {
  notificationId: string | null;
  outcome: "cancelled" | "delivered" | "duplicate" | "stale";
};

function versionFor(updatedAt: string): string {
  const milliseconds = Date.parse(updatedAt);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new NotificationDispatchError(
      "NOTIFICATION_INTEGRITY_FAILED",
      false,
    );
  }
  return milliseconds.toString(36);
}

export function taskReminderSubjectId(
  reminderId: string,
  updatedAt: string,
): string {
  if (
    reminderId.length < 1
    || reminderId.length > 140
    || !IDENTIFIER_PATTERN.test(reminderId)
  ) {
    throw new NotificationDispatchError(
      "NOTIFICATION_INTEGRITY_FAILED",
      false,
    );
  }
  const subjectId = `${SUBJECT_PREFIX}${reminderId}:${versionFor(updatedAt)}`;
  if (subjectId.length > 180) {
    throw new NotificationDispatchError(
      "NOTIFICATION_INTEGRITY_FAILED",
      false,
    );
  }
  return subjectId;
}

function parseSubjectId(subjectId: string): {
  reminderId: string;
  version: string;
} {
  if (!subjectId.startsWith(SUBJECT_PREFIX) || subjectId.length > 180) {
    throw new NotificationDispatchError(
      "NOTIFICATION_SOURCE_NOT_FOUND",
      false,
    );
  }
  const separator = subjectId.lastIndexOf(":");
  const reminderId = subjectId.slice(SUBJECT_PREFIX.length, separator);
  const version = subjectId.slice(separator + 1);
  if (
    separator <= SUBJECT_PREFIX.length
    || !IDENTIFIER_PATTERN.test(reminderId)
    || !/^[0-9a-z]+$/.test(version)
  ) {
    throw new NotificationDispatchError(
      "NOTIFICATION_SOURCE_NOT_FOUND",
      false,
    );
  }
  return { reminderId, version };
}

export function taskReminderNotificationCopy(
  reminder: Pick<ReminderRow, "locale" | "taskTitle">,
): { title: string; body: string } {
  if (reminder.locale === "en") {
    return {
      title: "Task deadline",
      body: `Task deadline approaching: ${reminder.taskTitle}.`,
    };
  }
  if (reminder.locale === "uz") {
    return {
      title: "Vazifa muddati",
      body: `Vazifa muddati yaqinlashmoqda: ${reminder.taskTitle}.`,
    };
  }
  return {
    title: "Срок по задаче",
    body: `Приближается срок по задаче: ${reminder.taskTitle}.`,
  };
}

export async function executeTaskReminderNotification(
  env: { DB: D1Database },
  subjectId: string,
  workspaceId: string,
  now = new Date().toISOString(),
): Promise<DispatchResult> {
  const parsed = parseSubjectId(subjectId);
  let reminder: ReminderRow | null;
  try {
    reminder = await env.DB.prepare(
      `SELECT
         tr.id AS reminderId,
         tr.task_id AS taskId,
         tr.reminder_at AS reminderAt,
         tr.status AS reminderStatus,
         tr.updated_at AS reminderUpdatedAt,
         t.workspace_id AS workspaceId,
         t.owner_user_id AS userId,
         t.title AS taskTitle,
         t.status AS taskStatus,
         c.locale AS locale,
         c.archived_at AS caseArchivedAt,
         CASE WHEN case_visible_to(c.id,t.owner_user_id) THEN wm.status END AS memberStatus
       FROM task_reminders tr
       JOIN tasks t ON t.id=tr.task_id
       JOIN cases c ON c.id=t.case_id AND c.workspace_id=t.workspace_id
       LEFT JOIN workspace_members wm
         ON wm.workspace_id=t.workspace_id AND wm.user_id=t.owner_user_id
       WHERE tr.id=? AND t.workspace_id=?
       LIMIT 1`,
    ).bind(parsed.reminderId, workspaceId).first<ReminderRow>();
  } catch {
    throw new NotificationDispatchError(
      "NOTIFICATION_PERSISTENCE_FAILED",
      true,
    );
  }

  if (!reminder) {
    throw new NotificationDispatchError(
      "NOTIFICATION_SOURCE_NOT_FOUND",
      false,
    );
  }
  if (versionFor(reminder.reminderUpdatedAt) !== parsed.version) {
    return { notificationId: null, outcome: "stale" };
  }
  const notificationId = `${SUBJECT_PREFIX}${reminder.reminderId}`;
  if (reminder.reminderStatus === "sent") {
    return { notificationId, outcome: "duplicate" };
  }
  if (reminder.reminderStatus !== "pending") {
    return { notificationId: null, outcome: "cancelled" };
  }

  const inactive = reminder.memberStatus !== "active"
    || reminder.caseArchivedAt !== null
    || ["completed", "cancelled"].includes(reminder.taskStatus);
  try {
    if (inactive) {
      await env.DB.prepare(
        `UPDATE task_reminders
         SET status='cancelled',updated_at=?
         WHERE id=? AND status='pending' AND updated_at=?
           AND EXISTS (
             SELECT 1 FROM tasks t
             WHERE t.id=task_reminders.task_id AND t.workspace_id=?
           )`,
      ).bind(
        now,
        reminder.reminderId,
        reminder.reminderUpdatedAt,
        workspaceId,
      ).run();
      return { notificationId: null, outcome: "cancelled" };
    }
    if (reminder.reminderAt > now) {
      return { notificationId: null, outcome: "stale" };
    }

    const copy = taskReminderNotificationCopy(reminder);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT OR IGNORE INTO notifications (
           id,workspace_id,user_id,document_id,type,title,body,read_at,created_at
         )
         SELECT ?,?,?,?,?,?,?,NULL,?
         WHERE EXISTS (
           SELECT 1
           FROM task_reminders tr
           JOIN tasks t ON t.id=tr.task_id
           JOIN cases c ON c.id=t.case_id AND c.workspace_id=t.workspace_id
           JOIN workspace_members wm
             ON wm.workspace_id=t.workspace_id
            AND wm.user_id=t.owner_user_id
            AND wm.status='active'
           WHERE tr.id=?
             AND tr.status='pending'
             AND tr.channel='in_app'
             AND tr.updated_at=?
             AND tr.reminder_at<=?
             AND t.id=?
             AND t.workspace_id=?
             AND t.owner_user_id=?
             AND t.status NOT IN ('completed','cancelled')
             AND c.archived_at IS NULL
         )`,
      ).bind(
        notificationId,
        workspaceId,
        reminder.userId,
        null,
        "deadline_reminder",
        copy.title,
        copy.body,
        now,
        reminder.reminderId,
        reminder.reminderUpdatedAt,
        now,
        reminder.taskId,
        workspaceId,
        reminder.userId,
      ),
      env.DB.prepare(
        `UPDATE task_reminders
         SET status='sent',sent_at=?,updated_at=?
         WHERE id=?
           AND status='pending'
           AND channel='in_app'
           AND updated_at=?
           AND reminder_at<=?
           AND EXISTS (
             SELECT 1 FROM notifications n
             WHERE n.id=? AND n.workspace_id=? AND n.user_id=?
           )`,
      ).bind(
        now,
        now,
        reminder.reminderId,
        reminder.reminderUpdatedAt,
        now,
        notificationId,
        workspaceId,
        reminder.userId,
      ),
    ]);
    const verified = await env.DB.prepare(
      `SELECT tr.status AS reminderStatus,n.workspace_id AS workspaceId,
              n.user_id AS userId
       FROM task_reminders tr
       JOIN notifications n ON n.id=?
       WHERE tr.id=? AND n.workspace_id=? AND n.user_id=?`,
    ).bind(
      notificationId,
      reminder.reminderId,
      workspaceId,
      reminder.userId,
    ).first<{
      reminderStatus: string;
      userId: string;
      workspaceId: string;
    }>();
    if (!verified || verified.reminderStatus !== "sent") {
      throw new NotificationDispatchError(
        "NOTIFICATION_INTEGRITY_FAILED",
        false,
      );
    }
  } catch (error) {
    if (error instanceof NotificationDispatchError) throw error;
    throw new NotificationDispatchError(
      "NOTIFICATION_PERSISTENCE_FAILED",
      true,
    );
  }
  return { notificationId, outcome: "delivered" };
}
