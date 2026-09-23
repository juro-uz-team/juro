import { captureEmailRequest } from "../runtime/email";
import { normalizeEmail } from "./crypto";
import {
  parseIdentityKeyring,
  protectIdentityValue,
  revealIdentityValue,
  type IdentityKeyring,
} from "./keyring";
import type { SecurityEventGuard } from "./security-events";
import { SECURITY_NOTIFICATION_RECIPIENT_PURPOSE } from "./security-notification";
import {
  renderJuroAuthEmail,
  type AuthEmailLocale,
} from "./transactional-email";

const RECIPIENT_PURPOSE = "security-email-recipient";

export type SecurityEmailErrorCode =
  | "EMAIL_CONFIGURATION_UNAVAILABLE"
  | "EMAIL_JOB_INVALID"
  | "EMAIL_PROVIDER_REJECTED"
  | "EMAIL_PROVIDER_UNAVAILABLE";

export class SecurityEmailError extends Error {
  constructor(
    readonly code: SecurityEmailErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "SecurityEmailError";
  }
}

export type SecurityEmailRuntimeEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  IDENTITY_KEYRING?: string;
};

export type PreparedSecurityEmailJob = {
  jobId: string;
  outboxId: string;
  statements: D1PreparedStatement[];
};

type SecurityEmailJobRow = {
  source: "legacy" | "notification";
  id: string;
  userId: string;
  eventType: string;
  deliveryChannel: string;
  locale: string;
  recipientCiphertext: string;
  recipientIv: string;
  recipientKeyVersion: string;
  deviceName: string | null;
  countryCode: string | null;
  regionCode: string | null;
  occurredAt: string;
  status: string;
  providerMessageId: string | null;
  authOtpChallengeId: string | null;
};

function jobTable(row: SecurityEmailJobRow): string {
  return row.source === "notification"
    ? "security_notification_jobs"
    : "security_email_jobs";
}

async function securityEmailJob(
  db: D1Database,
  jobId: string,
): Promise<SecurityEmailJobRow | null> {
  const notification = await db.prepare(
    `SELECT 'notification' AS source,id,user_id AS userId,
       event_type AS eventType,delivery_channel AS deliveryChannel,locale,
       recipient_ciphertext AS recipientCiphertext,
       recipient_iv AS recipientIv,
       recipient_key_version AS recipientKeyVersion,
       device_name AS deviceName,country_code AS countryCode,
       region_code AS regionCode,occurred_at AS occurredAt,status,
       provider_message_id AS providerMessageId,
       NULL AS authOtpChallengeId
     FROM security_notification_jobs WHERE id=? LIMIT 1`,
  ).bind(jobId).first<SecurityEmailJobRow>();
  if (notification) return notification;
  return db.prepare(
    `SELECT 'legacy' AS source,id,user_id AS userId,event_type AS eventType,
       'email' AS deliveryChannel,locale,
       recipient_ciphertext AS recipientCiphertext,
       recipient_iv AS recipientIv,
       recipient_key_version AS recipientKeyVersion,
       NULL AS deviceName,NULL AS countryCode,NULL AS regionCode,
       created_at AS occurredAt,status,
       provider_message_id AS providerMessageId,
       auth_otp_challenge_id AS authOtpChallengeId
     FROM security_email_jobs WHERE id=? LIMIT 1`,
  ).bind(jobId).first<SecurityEmailJobRow>();
}

function assertGuard(guard: SecurityEventGuard): void {
  if (!/^\s*SELECT\b/i.test(guard.selectSql) || guard.selectSql.includes(";")) {
    throw new Error("INVALID_SECURITY_EMAIL_GUARD");
  }
}

export async function prepareEmailChangedSecurityEmail(
  db: D1Database,
  input: {
    keyring: IdentityKeyring;
    userId: string;
    workspaceId: string;
    challengeId: string;
    previousEmail: string;
    locale: AuthEmailLocale;
    requiredGuard: SecurityEventGuard;
    now: string;
  },
): Promise<PreparedSecurityEmailJob> {
  assertGuard(input.requiredGuard);
  const jobId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  const recipient = await protectIdentityValue(
    input.keyring,
    normalizeEmail(input.previousEmail),
    {
      purpose: RECIPIENT_PURPOSE,
      subjectId: input.userId,
      recordId: jobId,
    },
  );
  const idempotencyKey = `security_email_${jobId}`;
  const correlationId = `email_change_${input.challengeId}`;
  const guardSql = input.requiredGuard.selectSql;
  const guardBindings = input.requiredGuard.bindings;

  return {
    jobId,
    outboxId,
    statements: [
      db.prepare(
        `INSERT INTO security_email_jobs (
           id,user_id,workspace_id,challenge_id,event_type,locale,
           recipient_ciphertext,recipient_iv,recipient_key_version,
           status,attempt_count,created_at,updated_at
         )
         SELECT ?,?,?,?,'email_changed_previous_address',?,?,?,?,
           'pending',0,?,?
         WHERE EXISTS (${guardSql})`,
      ).bind(
        jobId,
        input.userId,
        input.workspaceId,
        input.challengeId,
        input.locale,
        recipient.ciphertext,
        recipient.iv,
        recipient.keyVersion,
        input.now,
        input.now,
        ...guardBindings,
      ),
      db.prepare(
        `INSERT INTO job_outbox (
           id,queue_binding,job_type,schema_version,idempotency_key,
           subject_id,workspace_id,correlation_id,enqueued_at,available_at,
           status,dispatch_attempts,created_at,updated_at
         )
         SELECT ?,'EMAIL_NOTIFICATIONS_QUEUE','email.send',1,?,?,?,?,?,?,
           'pending',0,?,?
         WHERE EXISTS (
           SELECT 1 FROM security_email_jobs
           WHERE id=? AND status='pending'
         )
           AND EXISTS (${guardSql})`,
      ).bind(
        outboxId,
        idempotencyKey,
        jobId,
        input.workspaceId,
        correlationId,
        input.now,
        input.now,
        input.now,
        input.now,
        jobId,
        ...guardBindings,
      ),
    ],
  };
}

export async function preparePasswordChangedSecurityEmailRetry(
  db: D1Database,
  input: {
    keyring: IdentityKeyring;
    userId: string;
    authOtpChallengeId: string;
    email: string;
    locale: AuthEmailLocale;
    requiredGuard: SecurityEventGuard;
    now: string;
  },
): Promise<PreparedSecurityEmailJob> {
  assertGuard(input.requiredGuard);
  const jobId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  const recipient = await protectIdentityValue(
    input.keyring,
    normalizeEmail(input.email),
    {
      purpose: RECIPIENT_PURPOSE,
      subjectId: input.userId,
      recordId: jobId,
    },
  );
  const guardSql = input.requiredGuard.selectSql;
  const guardBindings = input.requiredGuard.bindings;

  return {
    jobId,
    outboxId,
    statements: [
      db.prepare(
        `INSERT INTO security_email_jobs (
           id,user_id,workspace_id,challenge_id,auth_otp_challenge_id,
           event_type,locale,recipient_ciphertext,recipient_iv,
           recipient_key_version,status,attempt_count,created_at,updated_at
         )
         SELECT ?,?,NULL,NULL,?,'password_changed',?,?,?,?,'pending',0,?,?
         WHERE EXISTS (${guardSql})`,
      ).bind(
        jobId,
        input.userId,
        input.authOtpChallengeId,
        input.locale,
        recipient.ciphertext,
        recipient.iv,
        recipient.keyVersion,
        input.now,
        input.now,
        ...guardBindings,
      ),
      db.prepare(
        `INSERT INTO job_outbox (
           id,queue_binding,job_type,schema_version,idempotency_key,
           subject_id,workspace_id,correlation_id,enqueued_at,available_at,
           status,dispatch_attempts,created_at,updated_at
         )
         SELECT ?,'EMAIL_NOTIFICATIONS_QUEUE','email.send',1,?,?,NULL,?,?,?,
           'pending',0,?,?
         WHERE EXISTS (
           SELECT 1 FROM security_email_jobs
           WHERE id=? AND status='pending'
         )
           AND EXISTS (${guardSql})`,
      ).bind(
        outboxId,
        `security_email_password_changed_${input.authOtpChallengeId}`,
        jobId,
        `password_reset_${input.authOtpChallengeId}`,
        input.now,
        input.now,
        input.now,
        input.now,
        jobId,
        ...guardBindings,
      ),
    ],
  };
}

export async function notifyPasswordChangedWithRetry(
  db: D1Database,
  input: {
    jobId: string;
    authOtpChallengeId: string;
    email: string;
    locale: AuthEmailLocale;
    now: string;
    apiKey?: string;
    from?: string;
  },
): Promise<
  | { status: "sent"; jobId: null }
  | { status: "queued"; jobId: string }
  | { status: "unavailable"; jobId: null }
> {
  // The encrypted job and its outbox row already exist transactionally with
  // the credential mutation. Keep the row pending until the provider has
  // accepted the message: a Worker interruption or a failed follow-up D1
  // write therefore still leaves a durable retry target.
  if (!input.apiKey || !input.from) {
    return { status: "queued", jobId: input.jobId };
  }
  const message = renderJuroAuthEmail({
    locale: input.locale,
    purpose: "password_changed",
  });
  let response: Response | null = null;
  let providerMessageId: string | null = null;
  try {
    response = await captureEmailRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": `juro_password_changed_${input.authOtpChallengeId}`,
      },
      body: JSON.stringify({
        from: input.from,
        to: [normalizeEmail(input.email)],
        subject: message.subject,
        html: message.html,
        text: message.text,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      const payload = await response.json().catch(() => null) as {
        id?: unknown;
      } | null;
      if (
        typeof payload?.id === "string"
        && /^[A-Za-z0-9_-]{1,180}$/.test(payload.id)
      ) {
        providerMessageId = payload.id;
      }
    } else {
      await response.body?.cancel();
    }
  } catch {
    try {
      await response?.body?.cancel();
    } catch {
      // The failed provider response has no usable body.
    }
  }

  if (providerMessageId) {
    try {
      const sent = await db.prepare(
        `UPDATE security_email_jobs
         SET status='sent',attempt_count=attempt_count+1,
           provider_message_id=?,sent_at=?,error_code=NULL,updated_at=?
         WHERE id=? AND event_type='password_changed'
           AND status IN ('pending','retrying')`,
      ).bind(
        providerMessageId,
        input.now,
        input.now,
        input.jobId,
      ).run();
      if (Number(sent.meta.changes ?? 0) === 1) {
        return { status: "sent", jobId: null };
      }
    } catch {
      // The pre-created pending row remains safe to retry with the same
      // provider idempotency key.
    }
    return { status: "queued", jobId: input.jobId };
  }

  try {
    await db.prepare(
      `UPDATE security_email_jobs
       SET status='retrying',attempt_count=attempt_count+1,
         error_code='EMAIL_PROVIDER_UNAVAILABLE',updated_at=?
       WHERE id=? AND event_type='password_changed'
         AND status IN ('pending','retrying')`,
    ).bind(input.now, input.jobId).run();
  } catch {
    // A failed follow-up write intentionally leaves the row pending.
  }
  return { status: "queued", jobId: input.jobId };
}

function loginLocation(row: SecurityEmailJobRow, locale: AuthEmailLocale): string {
  const location = [row.regionCode, row.countryCode].filter(Boolean).join(", ");
  if (location) return location;
  if (locale === "uz") return "aniqlanmadi";
  return locale === "en" ? "Not determined" : "не определён";
}

function emailCopy(
  row: SecurityEmailJobRow,
): { subject: string; html: string; text: string } {
  const locale: AuthEmailLocale = row.locale === "en"
    ? "en"
    : row.locale === "uz"
      ? "uz"
      : "ru";
  if (row.eventType === "email_changed_previous_address") {
    return renderJuroAuthEmail({ locale, purpose: "email_changed" });
  }
  if (row.eventType === "password_changed") {
    return renderJuroAuthEmail({ locale, purpose: "password_changed" });
  }

  const newRegion = row.eventType === "login_new_region";
  return renderJuroAuthEmail({
    locale,
    purpose: newRegion ? "new_region" : "new_device",
    details: locale === "uz"
      ? [
          { label: "Qurilma", value: row.deviceName ?? "Aniqlanmadi" },
          { label: "Hudud", value: loginLocation(row, locale) },
          { label: "Vaqt", value: row.occurredAt },
        ]
      : locale === "en"
        ? [
            { label: "Device", value: row.deviceName ?? "Not determined" },
            { label: "Region", value: loginLocation(row, locale) },
            { label: "Time", value: row.occurredAt },
          ]
        : [
          { label: "Устройство", value: row.deviceName ?? "Не определено" },
          { label: "Регион", value: loginLocation(row, locale) },
          { label: "Время", value: row.occurredAt },
        ],
  });
}

async function updateFailure(
  db: D1Database,
  input: {
    row: SecurityEmailJobRow;
    error: SecurityEmailError;
    now: string;
  },
): Promise<void> {
  const table = jobTable(input.row);
  await db.prepare(
    `UPDATE ${table}
     SET status=?,error_code=?,updated_at=?
     WHERE id=? AND status<>'sent'`,
  ).bind(
    input.error.retryable ? "retrying" : "failed",
    input.error.code,
    input.now,
    input.row.id,
  ).run();
}

function providerFailure(status: number): SecurityEmailError {
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return new SecurityEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
  }
  return new SecurityEmailError("EMAIL_PROVIDER_REJECTED", false);
}

export async function executeSecurityEmailJob(
  env: SecurityEmailRuntimeEnv,
  jobId: string,
): Promise<{ providerMessageId: string | null; alreadySent: boolean }> {
  const row = await securityEmailJob(env.DB, jobId);
  if (
    !row
    || row.deliveryChannel !== "email"
    || ![
      "email_changed_previous_address",
      "password_changed",
      "login_new_device",
      "login_new_region",
    ].includes(row.eventType)
  ) {
    throw new SecurityEmailError("EMAIL_JOB_INVALID", false);
  }
  if (row.status === "sent") {
    return { providerMessageId: row.providerMessageId, alreadySent: true };
  }
  if (row.status === "failed") {
    throw new SecurityEmailError("EMAIL_JOB_INVALID", false);
  }

  const now = new Date().toISOString();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.IDENTITY_KEYRING) {
    const error = new SecurityEmailError(
      "EMAIL_CONFIGURATION_UNAVAILABLE",
      false,
    );
    await updateFailure(env.DB, { row, error, now });
    throw error;
  }

  let recipient: string;
  try {
    const keyring = parseIdentityKeyring(env.IDENTITY_KEYRING);
    recipient = normalizeEmail(await revealIdentityValue(
      keyring,
      {
        ciphertext: row.recipientCiphertext,
        iv: row.recipientIv,
        keyVersion: row.recipientKeyVersion,
      },
      {
        purpose: row.source === "notification"
          ? SECURITY_NOTIFICATION_RECIPIENT_PURPOSE
          : RECIPIENT_PURPOSE,
        subjectId: row.userId,
        recordId: row.id,
      },
    ));
  } catch {
    const error = new SecurityEmailError("EMAIL_JOB_INVALID", false);
    await updateFailure(env.DB, { row, error, now });
    throw error;
  }

  const staleSendingBefore = new Date(
    Date.parse(now) - 2 * 60 * 1_000,
  ).toISOString();
  const table = jobTable(row);
  const claimed = await env.DB.prepare(
    `UPDATE ${table}
     SET status='sending',attempt_count=attempt_count+1,error_code=NULL,
         updated_at=?
     WHERE id=?
       AND (
         status IN ('pending','retrying')
         OR (status='sending' AND updated_at<=?)
       )`,
  ).bind(now, jobId, staleSendingBefore).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    const current = await env.DB.prepare(
      `SELECT status,provider_message_id AS providerMessageId
       FROM ${table} WHERE id=? LIMIT 1`,
    ).bind(jobId).first<{
      status: string;
      providerMessageId: string | null;
    }>();
    if (current?.status === "sent") {
      return {
        providerMessageId: current.providerMessageId,
        alreadySent: true,
      };
    }
    throw new SecurityEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
  }

  const copy = emailCopy(row);
  let response: Response | null = null;
  try {
    response = await captureEmailRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": row.eventType === "password_changed"
          ? `juro_password_changed_${row.authOtpChallengeId}`
          : `juro_security_email_${jobId}`,
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
      await updateFailure(env.DB, {
        row,
        error,
        now: new Date().toISOString(),
      });
      throw error;
    }
    const payload = await response.json().catch(() => null) as { id?: unknown } | null;
    if (typeof payload?.id !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(payload.id)) {
      const error = new SecurityEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
      await updateFailure(env.DB, {
        row,
        error,
        now: new Date().toISOString(),
      });
      throw error;
    }
    const sentAt = new Date().toISOString();
    const sent = await env.DB.prepare(
      `UPDATE ${table}
       SET status='sent',provider_message_id=?,sent_at=?,error_code=NULL,
           updated_at=?
       WHERE id=? AND status='sending'`,
    ).bind(payload.id, sentAt, sentAt, jobId).run();
    if (Number(sent.meta.changes ?? 0) !== 1) {
      throw new SecurityEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
    }
    return { providerMessageId: payload.id, alreadySent: false };
  } catch (error) {
    if (error instanceof SecurityEmailError) throw error;
    const safe = new SecurityEmailError("EMAIL_PROVIDER_UNAVAILABLE", true);
    try {
      await response?.body?.cancel();
    } catch {
      // The failed provider response has no usable body.
    }
    await updateFailure(env.DB, {
      row,
      error: safe,
      now: new Date().toISOString(),
    });
    throw safe;
  }
}
