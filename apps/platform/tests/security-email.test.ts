import assert from "node:assert/strict";
import test from "node:test";
import {
  executeSecurityEmailJob,
  notifyPasswordChangedWithRetry,
  prepareEmailChangedSecurityEmail,
  preparePasswordChangedSecurityEmailRetry,
} from "../lib/auth/security-email";
import {
  prepareDeviceContinuity,
  type PreparedDeviceContinuity,
} from "../lib/auth/device-continuity";
import {
  loginSecurityNotificationEvent,
  prepareLoginSecurityNotification,
} from "../lib/auth/security-notification";
import { parseIdentityKeyring } from "../lib/auth/keyring";
import { createEmailOtpSession } from "../lib/auth/session-management";
import { handleQueue, type JobEnvelope, type PlatformJobEnv } from "../worker/platform-jobs";
import { dispatchOutbox } from "../worker/platform-outbox";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const USER_ID = "security-email-user";
const WORKSPACE_ID = "security-email-workspace";
const CHALLENGE_ID = "22222222-2222-4222-8222-222222222222";
const PREVIOUS_EMAIL = "previous@example.test";
const PASSWORD_RESET_CHALLENGE_ID = "33333333-3333-4333-8333-333333333333";

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from(
    { length: 32 },
    (_, index) => (seed + index) % 256,
  );
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const RAW_KEYRING = JSON.stringify({
  active: "v1",
  versions: {
    v1: { aead: encodedKey(1), hmac: encodedKey(33) },
  },
});

function fixture() {
  const value = sqliteD1Fixture();
  const now = "2026-07-29T10:00:00.000Z";
  value.sqlite.prepare(
    `INSERT INTO user_profiles (
       id,email,locale,created_at,updated_at
     ) VALUES (?,?,'ru',?,?)`,
  ).run(USER_ID, "new@example.test", now, now);
  value.sqlite.prepare(
    `INSERT INTO workspaces (
       id,type,name,locale,created_at,updated_at
     ) VALUES (? ,'individual','Security email','ru',?,?)`,
  ).run(WORKSPACE_ID, now, now);
  value.sqlite.prepare(
    `INSERT INTO email_change_challenges (
       id,user_id,session_id,current_email_hash,new_email,
       current_code_salt,current_code_hash,new_code_salt,new_code_hash,
       locale,attempt_count,max_attempts,expires_at,created_at
     ) VALUES (?,?,NULL,?,?,?,?,?,?,'ru',0,5,?,?)`,
  ).run(
    CHALLENGE_ID,
    USER_ID,
    "legacy-current-hash",
    "new@example.test",
    "current-salt",
    "current-hash",
    "new-salt",
    "new-hash",
    "2026-07-29T10:10:00.000Z",
    now,
  );
  return value;
}

type QueueCapture = { envelope: JobEnvelope | null };

function envFor(
  db: D1Database,
  capture: QueueCapture,
): PlatformJobEnv {
  return {
    DB: db,
    APP_ENV: "staging",
    ASYNC_RUNTIME_ENABLED: "true",
    CRON_ENABLED: "false",
    LEGAL_ADVICE_INGESTION_ENABLED: "false",
    JOB_SCHEMA_VERSION: "1",
    RESEND_API_KEY: "synthetic-resend-key",
    EMAIL_FROM: "JURO <no-reply@juro.uz>",
    IDENTITY_KEYRING: RAW_KEYRING,
    PLATFORM_ANALYTICS: { writeDataPoint() {} },
    EMAIL_NOTIFICATIONS_QUEUE: {
      async send(body: JobEnvelope) {
        capture.envelope = body;
        return {
          metadata: {
            metrics: { backlogCount: 0, backlogBytes: 0 },
          },
        };
      },
    },
  } as unknown as PlatformJobEnv;
}

function queueMessage(envelope: JobEnvelope, attempts = 1) {
  const state = { acknowledgements: 0, retries: [] as number[] };
  const message = {
    id: `message-${attempts}`,
    timestamp: new Date(),
    body: envelope,
    attempts,
    ack() { state.acknowledgements += 1; },
    retry(options?: { delaySeconds?: number }) {
      state.retries.push(options?.delaySeconds ?? 0);
    },
  } as Message<unknown>;
  const batch = {
    queue: "staging-email-notifications",
    messages: [message],
    metadata: {
      metrics: { backlogCount: 1, backlogBytes: 0 },
    },
    retryAll() {},
    ackAll() { message.ack(); },
  } as MessageBatch<unknown>;
  return { batch, state };
}

async function preparedFixture() {
  const value = fixture();
  const prepared = await prepareEmailChangedSecurityEmail(value.d1, {
    keyring: parseIdentityKeyring(RAW_KEYRING),
    userId: USER_ID,
    workspaceId: WORKSPACE_ID,
    challengeId: CHALLENGE_ID,
    previousEmail: PREVIOUS_EMAIL,
    locale: "ru",
    requiredGuard: { selectSql: "SELECT 1", bindings: [] },
    now: "2026-07-29T10:00:00.000Z",
  });
  await value.d1.batch(prepared.statements);
  return { ...value, prepared };
}

function passwordChangedFixture() {
  const value = fixture();
  const now = "2026-09-04T14:00:00.000Z";
  value.sqlite.prepare(
    `INSERT INTO auth_otp_challenges (
       id,email,email_hash,purpose,locale,account_type,code_salt,code_hash,
       attempt_count,max_attempts,expires_at,consumed_at,created_at
     ) VALUES (?,?,?,?,?,?,?,?,1,5,?,?,?)`,
  ).run(
    PASSWORD_RESET_CHALLENGE_ID,
    "new@example.test",
    "password-reset-email-hash",
    "password_reset",
    "en",
    "individual",
    "password-reset-salt",
    "password-reset-code-hash",
    "2026-09-04T14:10:00.000Z",
    now,
    now,
  );
  return value;
}

test("failed immediate password-change email creates an encrypted durable English retry", async () => {
  const { sqlite, d1 } = passwordChangedFixture();
  const capture: QueueCapture = { envelope: null };
  const env = envFor(d1, capture);
  const calls: Array<{
    headers: Headers;
    body: { to: string[]; subject: string; html: string; text: string };
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    calls.push({
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    if (calls.length === 1) return new Response(null, { status: 503 });
    return new Response(JSON.stringify({ id: "resend_password_changed_retry" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const prepared = await preparePasswordChangedSecurityEmailRetry(d1, {
      keyring: parseIdentityKeyring(RAW_KEYRING),
      userId: USER_ID,
      authOtpChallengeId: PASSWORD_RESET_CHALLENGE_ID,
      email: "new@example.test",
      locale: "en",
      requiredGuard: {
        selectSql: `SELECT 1 FROM auth_otp_challenges
          WHERE id=? AND purpose='password_reset' AND consumed_at IS NOT NULL`,
        bindings: [PASSWORD_RESET_CHALLENGE_ID],
      },
      now: "2026-09-04T14:00:00.000Z",
    });
    await d1.batch(prepared.statements);
    const result = await notifyPasswordChangedWithRetry(d1, {
      jobId: prepared.jobId,
      authOtpChallengeId: PASSWORD_RESET_CHALLENGE_ID,
      email: "new@example.test",
      locale: "en",
      now: "2026-09-04T14:00:00.000Z",
      apiKey: "synthetic-resend-key",
      from: "JURO <no-reply@juro.uz>",
    });
    assert.equal(result.status, "queued");
    assert.ok(result.jobId);
    assert.equal(calls.length, 1);

    const stored = sqlite.prepare(
      `SELECT challenge_id AS challengeId,
         auth_otp_challenge_id AS authOtpChallengeId,event_type AS eventType,
         locale,recipient_ciphertext AS recipientCiphertext,status
       FROM security_email_jobs WHERE id=?`,
    ).get(result.jobId) as {
      challengeId: string | null;
      authOtpChallengeId: string;
      eventType: string;
      locale: string;
      recipientCiphertext: string;
      status: string;
    };
    assert.deepEqual({
      challengeId: stored.challengeId,
      authOtpChallengeId: stored.authOtpChallengeId,
      eventType: stored.eventType,
      locale: stored.locale,
      status: stored.status,
    }, {
      challengeId: null,
      authOtpChallengeId: PASSWORD_RESET_CHALLENGE_ID,
      eventType: "password_changed",
      locale: "en",
      status: "retrying",
    });
    assert.notEqual(stored.recipientCiphertext, "new@example.test");

    assert.deepEqual(await dispatchOutbox(env, 1, result.jobId), {
      claimed: 1,
      dispatched: 1,
      rejected: 0,
      retrying: 0,
    });
    assert.ok(capture.envelope);
    assert.equal(JSON.stringify(capture.envelope).includes("new@example.test"), false);
    const retry = queueMessage(capture.envelope);
    await handleQueue(retry.batch, env);
    assert.equal(retry.state.acknowledgements, 1);
    assert.deepEqual(retry.state.retries, []);
    assert.equal(calls.length, 2);
    const providerKey = `juro_password_changed_${PASSWORD_RESET_CHALLENGE_ID}`;
    assert.equal(calls[0]?.headers.get("idempotency-key"), providerKey);
    assert.equal(calls[1]?.headers.get("idempotency-key"), providerKey);
    assert.deepEqual(calls[1]?.body.to, ["new@example.test"]);
    assert.equal(calls[1]?.body.subject, "Your JURO password was changed");
    assert.match(calls[1]?.body.html ?? "", /<!doctype html><html lang="en">/u);
    assert.match(calls[1]?.body.text ?? "", /Password changed/u);
    assert.deepEqual({ ...sqlite.prepare(
      `SELECT status,attempt_count AS attemptCount
       FROM security_email_jobs WHERE id=?`,
    ).get(result.jobId) }, { status: "sent", attemptCount: 2 });
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("successful immediate password-change email marks the pre-created durable job sent", async () => {
  const { sqlite, d1 } = passwordChangedFixture();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ id: "resend_password_changed_immediate" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
  try {
    const prepared = await preparePasswordChangedSecurityEmailRetry(d1, {
      keyring: parseIdentityKeyring(RAW_KEYRING),
      userId: USER_ID,
      authOtpChallengeId: PASSWORD_RESET_CHALLENGE_ID,
      email: "new@example.test",
      locale: "en",
      requiredGuard: { selectSql: "SELECT 1", bindings: [] },
      now: "2026-09-04T14:00:00.000Z",
    });
    await d1.batch(prepared.statements);
    assert.deepEqual(await notifyPasswordChangedWithRetry(d1, {
      jobId: prepared.jobId,
      authOtpChallengeId: PASSWORD_RESET_CHALLENGE_ID,
      email: "new@example.test",
      locale: "en",
      now: "2026-09-04T14:00:00.000Z",
      apiKey: "synthetic-resend-key",
      from: "JURO <no-reply@juro.uz>",
    }), { status: "sent", jobId: null });
    assert.deepEqual({ ...sqlite.prepare(
      `SELECT
         (SELECT count(*) FROM security_email_jobs) AS jobs,
         (SELECT count(*) FROM job_outbox WHERE job_type='email.send') AS outbox,
         (SELECT status FROM security_email_jobs WHERE id=?) AS status`,
    ).get(prepared.jobId) }, { jobs: 1, outbox: 1, status: "sent" });
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("encrypted security email outbox dispatches identifiers only and sends once", async () => {
  const { sqlite, d1, prepared } = await preparedFixture();
  const capture: QueueCapture = { envelope: null };
  const env = envFor(d1, capture);
  const calls: Array<{ url: string; headers: Headers; body: unknown }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify({ id: "resend_message_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const stored = sqlite.prepare(
      `SELECT recipient_ciphertext AS ciphertext,recipient_iv AS iv,
         recipient_key_version AS keyVersion,status
       FROM security_email_jobs WHERE id=?`,
    ).get(prepared.jobId) as {
      ciphertext: string;
      iv: string;
      keyVersion: string;
      status: string;
    };
    assert.notEqual(stored.ciphertext, PREVIOUS_EMAIL);
    assert.equal(stored.iv.length, 16);
    assert.equal(stored.keyVersion, "v1");
    assert.equal(stored.status, "pending");
    assert.throws(
      () => sqlite.prepare(
        "UPDATE security_email_jobs SET recipient_ciphertext=? WHERE id=?",
      ).run("changed", prepared.jobId),
      /security email recipient is immutable/,
    );

    assert.deepEqual(
      await dispatchOutbox(env, 1, prepared.jobId),
      { claimed: 1, dispatched: 1, rejected: 0, retrying: 0 },
    );
    assert.ok(capture.envelope);
    assert.equal(capture.envelope.subjectId, prepared.jobId);
    assert.equal(JSON.stringify(capture.envelope).includes(PREVIOUS_EMAIL), false);

    const first = queueMessage(capture.envelope);
    await handleQueue(first.batch, env);
    assert.equal(first.state.acknowledgements, 1);
    assert.deepEqual(first.state.retries, []);
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://api.resend.com/emails");
    assert.equal(
      calls[0]?.headers.get("idempotency-key"),
      `juro_security_email_${prepared.jobId}`,
    );
    assert.deepEqual(
      (calls[0]?.body as { to: string[] }).to,
      [PREVIOUS_EMAIL],
    );
    const delivered = calls[0]?.body as {
      subject: string;
      html: string;
      text: string;
    };
    assert.equal(delivered.subject, "Email для входа в JURO изменён");
    assert.match(delivered.html, /<!doctype html><html lang="ru">/u);
    assert.match(delivered.text, /Email для входа изменён/u);

    const sent = sqlite.prepare(
      `SELECT status,attempt_count AS attemptCount,
         provider_message_id AS providerMessageId,sent_at AS sentAt
       FROM security_email_jobs WHERE id=?`,
    ).get(prepared.jobId) as {
      status: string;
      attemptCount: number;
      providerMessageId: string;
      sentAt: string;
    };
    assert.equal(sent.status, "sent");
    assert.equal(sent.attemptCount, 1);
    assert.equal(sent.providerMessageId, "resend_message_1");
    assert.ok(sent.sentAt);

    const duplicate = queueMessage(capture.envelope, 2);
    await handleQueue(duplicate.batch, env);
    assert.equal(duplicate.state.acknowledgements, 1);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("concurrent security email delivery has one provider winner", async () => {
  const { sqlite, d1, prepared } = await preparedFixture();
  const capture: QueueCapture = { envelope: null };
  const env = envFor(d1, capture);
  let calls = 0;
  let releaseProvider: (() => void) | undefined;
  let providerStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    providerStarted = resolve;
  });
  const released = new Promise<void>((resolve) => {
    releaseProvider = resolve;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    providerStarted?.();
    await released;
    return new Response(JSON.stringify({ id: "resend_concurrent_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const winner = executeSecurityEmailJob(env, prepared.jobId);
    await started;
    await assert.rejects(
      executeSecurityEmailJob(env, prepared.jobId),
      /EMAIL_PROVIDER_UNAVAILABLE/,
    );
    assert.equal(calls, 1);
    releaseProvider?.();
    assert.deepEqual(await winner, {
      providerMessageId: "resend_concurrent_1",
      alreadySent: false,
    });
    assert.equal(calls, 1);
    const state = sqlite.prepare(
      "SELECT status,attempt_count AS attemptCount FROM security_email_jobs WHERE id=?",
    ).get(prepared.jobId) as { status: string; attemptCount: number };
    assert.equal(state.status, "sent");
    assert.equal(state.attemptCount, 1);
  } finally {
    releaseProvider?.();
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("stale sending state is reclaimed without losing provider idempotency", async () => {
  const { sqlite, d1, prepared } = await preparedFixture();
  const capture: QueueCapture = { envelope: null };
  const env = envFor(d1, capture);
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ id: "resend_stale_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    sqlite.prepare(
      `UPDATE security_email_jobs
       SET status='sending',attempt_count=1,updated_at=?
       WHERE id=?`,
    ).run("2000-01-01T00:00:00.000Z", prepared.jobId);
    assert.deepEqual(await executeSecurityEmailJob(env, prepared.jobId), {
      providerMessageId: "resend_stale_1",
      alreadySent: false,
    });
    assert.equal(calls, 1);
    const state = sqlite.prepare(
      "SELECT status,attempt_count AS attemptCount FROM security_email_jobs WHERE id=?",
    ).get(prepared.jobId) as { status: string; attemptCount: number };
    assert.equal(state.status, "sent");
    assert.equal(state.attemptCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("retryable provider failure persists safe state and retries queue message", async () => {
  const { sqlite, d1, prepared } = await preparedFixture();
  const capture: QueueCapture = { envelope: null };
  const env = envFor(d1, capture);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(null, { status: 503 });
  try {
    await dispatchOutbox(env, 1, prepared.jobId);
    assert.ok(capture.envelope);
    const attempt = queueMessage(capture.envelope);
    await handleQueue(attempt.batch, env);
    assert.equal(attempt.state.acknowledgements, 0);
    assert.deepEqual(attempt.state.retries, [15]);
    const state = sqlite.prepare(
      `SELECT status,error_code AS errorCode,attempt_count AS attemptCount
       FROM security_email_jobs WHERE id=?`,
    ).get(prepared.jobId) as {
      status: string;
      errorCode: string;
      attemptCount: number;
    };
    assert.equal(state.status, "retrying");
    assert.equal(state.errorCode, "EMAIL_PROVIDER_UNAVAILABLE");
    assert.equal(state.attemptCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("missing provider configuration fails closed without issuing a request", async () => {
  const { sqlite, d1, prepared } = await preparedFixture();
  let called = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    called = true;
    return new Response(null, { status: 200 });
  };
  try {
    await assert.rejects(
      executeSecurityEmailJob({ DB: d1 }, prepared.jobId),
      /EMAIL_CONFIGURATION_UNAVAILABLE/,
    );
    assert.equal(called, false);
    const state = sqlite.prepare(
      "SELECT status,error_code AS errorCode FROM security_email_jobs WHERE id=?",
    ).get(prepared.jobId);
    assert.equal(
      (state as { status: string }).status,
      "failed",
    );
    assert.equal(
      (state as { errorCode: string }).errorCode,
      "EMAIL_CONFIGURATION_UNAVAILABLE",
    );
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
function continuity(
  values: Partial<PreparedDeviceContinuity> = {},
): PreparedDeviceContinuity {
  return {
    id: "device-continuity-security-email",
    userId: USER_ID,
    token: "A".repeat(43),
    tokenHmac: "B".repeat(43),
    keyVersion: "v1",
    recognized: false,
    previousCountryCode: null,
    previousRegionCode: null,
    countryCode: "UZ",
    regionCode: "TK",
    timestamp: "2026-07-29T12:00:00.000Z",
    ...values,
  };
}

test("login novelty policy is conservative and continuity-backed", () => {
  assert.equal(loginSecurityNotificationEvent(null), null);
  assert.equal(
    loginSecurityNotificationEvent(continuity()),
    "login_new_device",
  );
  assert.equal(
    loginSecurityNotificationEvent(continuity({
      recognized: true,
      previousCountryCode: "UZ",
      previousRegionCode: "TK",
    })),
    null,
  );
  assert.equal(
    loginSecurityNotificationEvent(continuity({
      recognized: true,
      previousCountryCode: "UZ",
      previousRegionCode: "TK",
      regionCode: "AN",
    })),
    "login_new_region",
  );
  assert.equal(
    loginSecurityNotificationEvent(continuity({
      recognized: true,
      previousCountryCode: null,
      previousRegionCode: null,
      countryCode: "KZ",
      regionCode: "ALA",
    })),
    null,
  );
});

test("generic login-security outbox encrypts recipient and sends new-device email once", async () => {
  const { sqlite, d1 } = fixture();
  const prepared = await prepareLoginSecurityNotification(d1, {
    config: {
      keyring: parseIdentityKeyring(RAW_KEYRING),
      recipientEmail: "new@example.test",
      locale: "ru",
      workspaceId: WORKSPACE_ID,
    },
    userId: USER_ID,
    sessionId: "new-device-session",
    deviceName: "Chrome · Windows <unsafe>",
    continuity: continuity(),
    occurredAt: "2026-07-29T12:00:00.000Z",
  });
  assert.ok(prepared);
  await d1.batch(prepared.statements({ selectSql: "SELECT 1", bindings: [] }));
  const stored = sqlite.prepare(`
    SELECT event_type AS eventType,recipient_ciphertext AS ciphertext,
      country_code AS countryCode,region_code AS regionCode,status
    FROM security_notification_jobs WHERE id=?
  `).get(prepared.jobId) as {
    eventType: string;
    ciphertext: string;
    countryCode: string;
    regionCode: string;
    status: string;
  };
  assert.equal(stored.eventType, "login_new_device");
  assert.notEqual(stored.ciphertext, "new@example.test");
  assert.equal(stored.countryCode, "UZ");
  assert.equal(stored.regionCode, "TK");
  assert.equal(stored.status, "pending");
  assert.throws(
    () => sqlite.prepare(`
      UPDATE security_notification_jobs SET device_name='Changed'
      WHERE id=?
    `).run(prepared.jobId),
    /security notification content is immutable/,
  );
  const outbox = sqlite.prepare(`
    SELECT subject_id AS subjectId,idempotency_key AS idempotencyKey
    FROM job_outbox WHERE id=?
  `).get(prepared.outboxId) as { subjectId: string; idempotencyKey: string };
  assert.equal(outbox.subjectId, prepared.jobId);
  assert.equal(outbox.idempotencyKey.includes("new@example.test"), false);

  const capture: QueueCapture = { envelope: null };
  const env = envFor(d1, capture);
  const calls: Array<{
    body: { to: string[]; subject: string; html: string; text: string };
  }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    calls.push({ body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ id: "resend_new_device" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    assert.deepEqual(await executeSecurityEmailJob(env, prepared.jobId), {
      providerMessageId: "resend_new_device",
      alreadySent: false,
    });
    assert.deepEqual(await executeSecurityEmailJob(env, prepared.jobId), {
      providerMessageId: "resend_new_device",
      alreadySent: true,
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.body.to, ["new@example.test"]);
    assert.equal(calls[0]?.body.subject, "Вход в JURO с нового устройства");
    assert.match(calls[0]?.body.html ?? "", /<!doctype html><html lang="ru">/u);
    assert.match(calls[0]?.body.html ?? "", /Chrome · Windows &lt;unsafe&gt;/);
    assert.equal((calls[0]?.body.html ?? "").includes("<unsafe>"), false);
    assert.match(calls[0]?.body.text ?? "", /Chrome · Windows <unsafe>/u);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("recognized device with comparable region change gets Uzbek region copy", async () => {
  const { sqlite, d1 } = fixture();
  const prepared = await prepareLoginSecurityNotification(d1, {
    config: {
      keyring: parseIdentityKeyring(RAW_KEYRING),
      recipientEmail: "new@example.test",
      locale: "uz",
      workspaceId: WORKSPACE_ID,
    },
    userId: USER_ID,
    sessionId: "new-region-session",
    deviceName: "Safari · iOS",
    continuity: continuity({
      recognized: true,
      previousCountryCode: "UZ",
      previousRegionCode: "TK",
      regionCode: "AN",
    }),
    occurredAt: "2026-07-29T13:00:00.000Z",
  });
  assert.ok(prepared);
  assert.equal(prepared.eventType, "login_new_region");
  await d1.batch(prepared.statements({ selectSql: "SELECT 1", bindings: [] }));
  const capture: QueueCapture = { envelope: null };
  const env = envFor(d1, capture);
  let body: { subject: string; html: string; text: string } | null = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ id: "resend_new_region" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await executeSecurityEmailJob(env, prepared.jobId);
    const sentBody = body as {
      subject: string;
      html: string;
      text: string;
    } | null;
    assert.ok(sentBody);
    assert.equal(sentBody.subject, "JURO hisobiga yangi hududdan kirish");
    assert.match(sentBody.html, /AN, UZ/);
    assert.match(sentBody.text, /Hudud: AN, UZ/u);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});
test("new-device notification is committed atomically with its session", async () => {
  const { sqlite, d1 } = fixture();
  const keyring = parseIdentityKeyring(RAW_KEYRING);
  const preparedContinuity = await prepareDeviceContinuity(d1, keyring, {
    userId: USER_ID,
    deviceToken: null,
    now: new Date("2026-07-29T14:00:00.000Z"),
  });
  assert.ok(preparedContinuity);
  try {
    const session = await createEmailOtpSession(d1, {
      userId: USER_ID,
      userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/126.0",
      deviceContinuity: preparedContinuity,
      loginSecurityNotification: {
        keyring,
        recipientEmail: "new@example.test",
        locale: "ru",
        workspaceId: WORKSPACE_ID,
      },
      now: new Date("2026-07-29T14:00:00.000Z"),
    });
    const job = sqlite.prepare(`
      SELECT session_id AS sessionId,event_type AS eventType,status
      FROM security_notification_jobs WHERE user_id=?
    `).get(USER_ID) as { sessionId: string; eventType: string; status: string };
    assert.equal(job.sessionId, session.sessionId);
    assert.equal(job.eventType, "login_new_device");
    assert.equal(job.status, "pending");
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM job_outbox").get() as { total: number }).total,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("notification insert failure rolls back session, continuity, audit, and outbox", async () => {
  const { sqlite, d1 } = fixture();
  const keyring = parseIdentityKeyring(RAW_KEYRING);
  const preparedContinuity = await prepareDeviceContinuity(d1, keyring, {
    userId: USER_ID,
    deviceToken: null,
    now: new Date("2026-07-29T15:00:00.000Z"),
  });
  assert.ok(preparedContinuity);
  sqlite.exec(`
    CREATE TRIGGER fail_login_security_notification
    BEFORE INSERT ON security_notification_jobs
    BEGIN
      SELECT RAISE(ABORT, 'forced login security notification failure');
    END
  `);
  try {
    await assert.rejects(
      createEmailOtpSession(d1, {
        userId: USER_ID,
        userAgent: "Mozilla/5.0 (Linux) Firefox/127.0",
        deviceContinuity: preparedContinuity,
        loginSecurityNotification: {
          keyring,
          recipientEmail: "new@example.test",
          locale: "ru",
          workspaceId: WORKSPACE_ID,
        },
        now: new Date("2026-07-29T15:00:00.000Z"),
      }),
      /forced login security notification failure/,
    );
    for (const table of [
      "auth_sessions",
      "auth_devices",
      "auth_device_continuities",
      "security_events",
      "security_notification_jobs",
      "job_outbox",
    ]) {
      const count = sqlite.prepare(`SELECT count(*) AS total FROM ${table}`).get() as {
        total: number;
      };
      assert.equal(count.total, 0, `${table} must roll back`);
    }
  } finally {
    sqlite.close();
  }
});
