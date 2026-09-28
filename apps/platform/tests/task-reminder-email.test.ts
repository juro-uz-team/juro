import assert from "node:assert/strict";
import test from "node:test";
import {
  executeTaskReminderEmail,
  taskReminderEmailJobId,
  TaskReminderEmailError,
} from "../lib/notifications/task-reminder-email";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const reminderUpdatedAt = "2020-08-05T23:59:00.000Z";
const dueAt = "2026-08-07T00:00:00.000Z";

test("email reminder resolves protected identity at delivery and is idempotent", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    const jobId = seed(sqlite, "en");
    globalThis.fetch = async (input, init) => {
      calls += 1;
      assert.equal(String(input), "https://api.resend.com/emails");
      assert.equal(new Headers(init?.headers).get("idempotency-key"), `juro_task_reminder_${jobId}`);
      const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; html: string; text: string };
      assert.deepEqual(body.to, ["user-a@example.invalid"]);
      assert.match(body.html, /Task &lt;A&gt;/u);
      assert.equal(body.subject, "JURO: task deadline approaching");
      assert.match(body.text, /Matter: Case A/u);
      assert.doesNotMatch(`${body.subject}\n${body.html}\n${body.text}`, /[\u0400-\u04ff]/u);
      return new Response(JSON.stringify({ id: "resend_message_0098" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const env = {
      DB: d1,
      RESEND_API_KEY: "synthetic-test-key",
      EMAIL_FROM: "JURO <no-reply@juro.uz>",
      IDENTITY_PROTECTION_MODE: "legacy",
    };
    assert.deepEqual(await executeTaskReminderEmail(env, jobId), {
      providerMessageId: "resend_message_0098",
      alreadySent: false,
      cancelled: false,
    });
    assert.deepEqual(await executeTaskReminderEmail(env, jobId), {
      providerMessageId: "resend_message_0098",
      alreadySent: true,
      cancelled: false,
    });
    assert.equal(calls, 1);
    assert.deepEqual(
      { ...(sqlite.prepare("SELECT status,sent_at AS sentAt FROM task_reminders WHERE id='reminder-email-a'").get() as object) },
      { status: "sent", sentAt: (sqlite.prepare("SELECT sent_at AS sentAt FROM task_reminders WHERE id='reminder-email-a'").get() as { sentAt: string }).sentAt },
    );
    const columns = sqlite.prepare("PRAGMA table_info(task_reminder_email_jobs)").all() as Array<{ name: string }>;
    assert.equal(columns.some(({ name }) => /email|recipient|title|body|html/u.test(name.replace("reminder_email", ""))), false);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("retryable provider failure records safe metadata without consuming the reminder", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const originalFetch = globalThis.fetch;
  try {
    const jobId = seed(sqlite);
    globalThis.fetch = async () => new Response(null, { status: 503 });
    await assert.rejects(
      executeTaskReminderEmail({
        DB: d1,
        RESEND_API_KEY: "synthetic-test-key",
        EMAIL_FROM: "JURO <no-reply@juro.uz>",
        IDENTITY_PROTECTION_MODE: "legacy",
      }, jobId),
      (error: unknown) => error instanceof TaskReminderEmailError
        && error.code === "EMAIL_PROVIDER_UNAVAILABLE"
        && error.retryable,
    );
    assert.deepEqual(
      { ...(sqlite.prepare("SELECT status,error_code AS errorCode FROM task_reminder_email_jobs WHERE id=?").get(jobId) as object) },
      { status: "retrying", errorCode: "EMAIL_PROVIDER_UNAVAILABLE" },
    );
    assert.equal(
      (sqlite.prepare("SELECT status FROM task_reminders WHERE id='reminder-email-a'").get() as { status: string }).status,
      "pending",
    );
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("stale source cancels before provider delivery", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    const jobId = seed(sqlite);
    sqlite.prepare("UPDATE tasks SET status='completed',completed_at=?,updated_at=? WHERE id='task-a'").run(reminderUpdatedAt, reminderUpdatedAt);
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("must not call provider");
    };
    assert.deepEqual(await executeTaskReminderEmail({
      DB: d1,
      RESEND_API_KEY: "synthetic-test-key",
      EMAIL_FROM: "JURO <no-reply@juro.uz>",
      IDENTITY_PROTECTION_MODE: "legacy",
    }, jobId), { providerMessageId: null, alreadySent: false, cancelled: true });
    assert.equal(calls, 0);
    assert.equal(
      (sqlite.prepare("SELECT status FROM task_reminder_email_jobs WHERE id=?").get(jobId) as { status: string }).status,
      "cancelled",
    );
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

function seed(
  sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"],
  locale: "ru" | "uz" | "en" = "ru",
): string {
  const createdAt = "2026-08-05T23:58:00.000Z";
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES ('user-a','user-a@example.invalid',?,?)").run(createdAt, createdAt);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES ('workspace-a','individual','A',?,?)").run(createdAt, createdAt);
  sqlite.prepare("INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES ('member-a','workspace-a','user-a','owner','active',?,?,?)").run(createdAt, createdAt, createdAt);
  sqlite.prepare(`INSERT INTO cases
    (id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,current_revision,created_at,updated_at)
    VALUES ('case-a','workspace-a','user-a','individual',?,'Case A','contracts','open',1,?,?)`).run(locale, createdAt, createdAt);
  sqlite.prepare(`INSERT INTO tasks
    (id,workspace_id,case_id,owner_user_id,title,due_at,status,created_at,updated_at)
    VALUES ('task-a','workspace-a','case-a','user-a','Task <A>',?,'planned',?,?)`).run(dueAt, createdAt, createdAt);
  sqlite.prepare(`INSERT INTO task_reminders
    (id,task_id,channel,reminder_at,status,idempotency_key,sent_at,created_at,updated_at)
    VALUES ('reminder-email-a','task-a','email','2020-08-05T23:59:00.000Z','pending','task-a:email:initial',NULL,?,?)`).run(createdAt, reminderUpdatedAt);
  const jobId = taskReminderEmailJobId("reminder-email-a", reminderUpdatedAt);
  sqlite.prepare(`INSERT INTO task_reminder_email_jobs
    (id,reminder_id,workspace_id,user_id,reminder_updated_at,status,attempt_count,
     provider_message_id,error_code,sent_at,created_at,updated_at)
    VALUES (?,'reminder-email-a','workspace-a','user-a',?,'pending',0,NULL,NULL,NULL,?,?)`).run(
    jobId,
    reminderUpdatedAt,
    createdAt,
    createdAt,
  );
  return jobId;
}
