import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { env } from "./helpers/runtime-env";
import { POST as requestAccountDeletion } from "../app/api/platform/privacy/deletion-request/route";
import {
  confirmAccountDeletion,
  reserveAccountDeletionChallenge,
} from "../lib/auth/account-deletion";
import {
  RECOVERABLE_DELETION_DELAY_MS,
  accountDeletionSubjectHash,
} from "../lib/auth/account-deletion-lifecycle";
import {
  createIdentityProtectionContext,
  IdentityProtectionError,
} from "../lib/auth/identity-protection";
import { sha256 } from "../lib/auth/crypto";
import { createEmailOtpSession } from "../lib/auth/session-management";
import { renderJuroAuthEmail } from "../lib/auth/transactional-email";
import {
  batchBarrier,
  sqliteD1Fixture,
} from "./helpers/sqlite-d1";

const USER_ID = "deletion-user";
const WORKSPACE_ID = "deletion-workspace";
const CODE = "123456";
const SALT = "deletion-test-salt";

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

const RAW_IDENTITY_KEYRING = JSON.stringify({
  active: "v2",
  versions: {
    v1: { aead: encodedKey(1), hmac: encodedKey(33) },
    v2: { aead: encodedKey(65), hmac: encodedKey(97) },
  },
});

const dualContext = createIdentityProtectionContext(
  "dual_write",
  RAW_IDENTITY_KEYRING,
);

async function fixture() {
  const value = sqliteD1Fixture();
  const authenticatedAt = "2026-07-26T12:00:00.000Z";
  value.sqlite.prepare(
    `INSERT INTO user_profiles (
       id,email,locale,created_at,updated_at
     ) VALUES (?,?,?,?,?)`,
  ).run(
    USER_ID,
    "deletion@example.test",
    "ru",
    authenticatedAt,
    authenticatedAt,
  );
  value.sqlite.prepare(
    `INSERT INTO workspaces (
       id,type,name,locale,created_at,updated_at
     ) VALUES (?,'individual','Deletion workspace','ru',?,?)`,
  ).run(WORKSPACE_ID, authenticatedAt, authenticatedAt);
  value.sqlite.prepare(
    `INSERT INTO workspace_members (
       id,workspace_id,user_id,role,status,joined_at,created_at,updated_at
     ) VALUES (?,?,?,'owner','active',?,?,?)`,
  ).run(
    "deletion-membership",
    WORKSPACE_ID,
    USER_ID,
    authenticatedAt,
    authenticatedAt,
    authenticatedAt,
  );
  value.sqlite.prepare(
    "UPDATE user_profiles SET default_workspace_id=? WHERE id=?",
  ).run(WORKSPACE_ID, USER_ID);
  const session = await createEmailOtpSession(value.d1, {
    userId: USER_ID,
    userAgent: "Deletion browser/1.0",
    now: new Date(authenticatedAt),
  });
  return { ...value, session };
}

async function reserve(
  d1: D1Database,
  sessionId: string,
  options: {
    id?: string;
    now?: string;
    code?: string;
  } = {},
) {
  const now = options.now ?? "2026-07-26T12:01:00.000Z";
  const nowMs = Date.parse(now);
  return reserveAccountDeletionChallenge(d1, {
    identityContext: dualContext,
    id: options.id ?? crypto.randomUUID(),
    userId: USER_ID,
    sessionId,
    email: "deletion@example.test",
    locale: "ru",
    codeSalt: SALT,
    code: options.code ?? CODE,
    expiresAt: new Date(nowMs + 10 * 60 * 1_000).toISOString(),
    now,
    recentSince: new Date(nowMs - 10 * 60 * 1_000).toISOString(),
    cooldownSince: new Date(nowMs - 60 * 1_000).toISOString(),
    hourlySince: new Date(nowMs - 60 * 60 * 1_000).toISOString(),
  });
}

function activeChallengeId(
  sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"],
): string {
  return (
    sqlite.prepare(
      `SELECT id FROM account_deletion_challenges
       WHERE user_id=? AND consumed_at IS NULL AND invalidated_at IS NULL`,
    ).get(USER_ID) as { id: string }
  ).id;
}

async function confirm(
  d1: D1Database,
  sessionId: string,
  challengeId: string,
  options: {
    code?: string;
    email?: string;
    now?: string;
  } = {},
) {
  const now = options.now ?? "2026-07-26T12:02:00.000Z";
  const subject = await accountDeletionSubjectHash(
    RAW_IDENTITY_KEYRING,
    USER_ID,
  );
  return confirmAccountDeletion(d1, {
    identityContext: dualContext,
    challengeId,
    userId: USER_ID,
    sessionId,
    email: options.email ?? "deletion@example.test",
    workspaceId: WORKSPACE_ID,
    code: options.code ?? CODE,
    reason: null,
    deletionMode: "recoverable_30d",
    scheduledPurgeAt: new Date(
      Date.parse(now) + RECOVERABLE_DELETION_DELAY_MS,
    ).toISOString(),
    subjectHash: subject.hash,
    subjectKeyVersion: subject.keyVersion,
    assuranceLevel: "primary",
    now,
    recentSince: new Date(
      Date.parse(now) - 10 * 60 * 1_000,
    ).toISOString(),
  });
}

test("parallel deletion-code reservations leave one active challenge", async () => {
  const { sqlite, d1, session } = await fixture();
  try {
    const synchronized = batchBarrier(d1);
    const results = await Promise.all([
      reserve(synchronized, session.sessionId, {
        id: "11111111-1111-4111-8111-111111111111",
      }),
      reserve(synchronized, session.sessionId, {
        id: "22222222-2222-4222-8222-222222222222",
      }),
    ]);
    assert.equal(
      results.filter(({ status }) => status === "reserved").length,
      1,
    );
    assert.equal(
      results.filter(({ status }) => status === "blocked").length,
      1,
    );
    assert.equal(
      (
        sqlite.prepare(
          `SELECT count(*) AS total FROM account_deletion_challenges
           WHERE user_id=? AND consumed_at IS NULL AND invalidated_at IS NULL`,
        ).get(USER_ID) as { total: number }
      ).total,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("deletion challenge enforces hourly budget and recent active session", async () => {
  const first = await fixture();
  try {
    for (let minute = 1; minute <= 5; minute += 1) {
      assert.equal(
        (
          await reserve(first.d1, first.session.sessionId, {
            now: `2026-07-26T12:0${minute}:00.000Z`,
          })
        ).status,
        "reserved",
      );
    }
    const limited = await reserve(first.d1, first.session.sessionId, {
      now: "2026-07-26T12:06:00.000Z",
    });
    assert.equal(limited.status, "blocked");
    if (limited.status === "blocked") {
      assert.equal(limited.hourlyCount, 5);
    }
  } finally {
    first.sqlite.close();
  }

  const stale = await fixture();
  try {
    assert.equal(
      (
        await reserve(stale.d1, stale.session.sessionId, {
          now: "2026-07-26T12:11:00.001Z",
        })
      ).status,
      "blocked",
    );
    stale.sqlite.prepare(
      "UPDATE auth_sessions SET revoked_at=? WHERE id=?",
    ).run(
      "2026-07-26T12:01:00.000Z",
      stale.session.sessionId,
    );
    assert.equal(
      (
        await reserve(stale.d1, stale.session.sessionId, {
          now: "2026-07-26T12:01:01.000Z",
        })
      ).status,
      "blocked",
    );
  } finally {
    stale.sqlite.close();
  }
});

test("verified deletion request stores exact evidence and revokes sessions", async () => {
  const { sqlite, d1, session } = await fixture();
  try {
    sqlite.prepare(`
      INSERT INTO auth_device_continuities (
        id,user_id,token_hmac,key_version,first_seen_at,last_seen_at
      ) VALUES ('deletion-continuity',?,?,'v2',?,?)
    `).run(
      USER_ID,
      "C".repeat(43),
      "2026-07-26T12:00:00.000Z",
      "2026-07-26T12:00:00.000Z",
    );
    sqlite.prepare(
      "UPDATE auth_devices SET continuity_id=? WHERE id=?",
    ).run("deletion-continuity", session.deviceId);    assert.deepEqual(await reserve(d1, session.sessionId), {
      status: "reserved",
    });
    const challengeId = activeChallengeId(sqlite);
    const result = await confirm(d1, session.sessionId, challengeId);
    assert.equal(result.status, "confirmed");
    if (result.status !== "confirmed") return;
    assert.equal(result.revokedSessions, 1);
    assert.equal((sqlite.prepare(
      "SELECT revoked_at AS revokedAt FROM auth_device_continuities WHERE id=?",
    ).get("deletion-continuity") as { revokedAt: string | null }).revokedAt,
    "2026-07-26T12:02:00.000Z");
    const request = sqlite.prepare(
      `SELECT
         user_id AS userId,verification_challenge_id AS challengeId,
         requested_session_id AS sessionId,status,deletion_mode AS deletionMode,
         subject_hash AS subjectHash,subject_key_version AS subjectKeyVersion,
         scheduled_purge_at AS scheduledPurgeAt,verification_method AS method,
         verified_at AS verifiedAt,requested_at AS requestedAt
       FROM account_deletion_requests WHERE id=?`,
    ).get(result.requestId) as Record<string, unknown>;
    assert.deepEqual({ ...request }, {
      userId: USER_ID,
      challengeId,
      sessionId: session.sessionId,
      status: "scheduled",
      deletionMode: "recoverable_30d",
      subjectHash: result.status === "confirmed"
        ? (await accountDeletionSubjectHash(RAW_IDENTITY_KEYRING, USER_ID)).hash
        : null,
      subjectKeyVersion: "v2",
      scheduledPurgeAt: "2026-08-25T12:02:00.000Z",
      method: "email_otp",
      verifiedAt: "2026-07-26T12:02:00.000Z",
      requestedAt: "2026-07-26T12:02:00.000Z",
    });
    const challenge = sqlite.prepare(
      `SELECT
         consumed_at AS consumedAt,
         consumed_by_operation_id AS operationId,
         email_lookup_hash AS emailLookupHash,
         email_lookup_key_version AS emailLookupKeyVersion,
         code_hmac AS codeHmac,
         code_key_version AS codeKeyVersion
       FROM account_deletion_challenges WHERE id=?`,
    ).get(challengeId) as {
      consumedAt: string;
      operationId: string;
      emailLookupHash: string;
      emailLookupKeyVersion: string;
      codeHmac: string;
      codeKeyVersion: string;
    };
    assert.equal(challenge.consumedAt, "2026-07-26T12:02:00.000Z");
    assert.ok(challenge.operationId);
    assert.match(challenge.emailLookupHash, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge.emailLookupKeyVersion, "v2");
    assert.match(challenge.codeHmac, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(challenge.codeKeyVersion, "v2");
    assert.equal(
      (
        sqlite.prepare(
          `SELECT count(*) AS total FROM auth_sessions
           WHERE user_id=? AND revoked_at IS NULL`,
        ).get(USER_ID) as { total: number }
      ).total,
      0,
    );
    assert.equal(
      (
        sqlite.prepare(
          `SELECT count(*) AS total FROM workspace_audit_events
           WHERE actor_user_id=? AND action='account_deletion_requested'`,
        ).get(USER_ID) as { total: number }
      ).total,
      1,
    );
    const lifecycle = sqlite.prepare(
      `SELECT event_type AS eventType,deletion_mode AS deletionMode,
         subject_hash AS subjectHash,subject_key_version AS subjectKeyVersion
       FROM account_deletion_lifecycle_events WHERE request_id=?`,
    ).get(result.requestId) as {
      eventType: string;
      deletionMode: string;
      subjectHash: string;
      subjectKeyVersion: string;
    };
    assert.equal(lifecycle.eventType, "scheduled");
    assert.equal(lifecycle.deletionMode, "recoverable_30d");
    assert.match(lifecycle.subjectHash, /^[a-f0-9]{64}$/);
    assert.equal(lifecycle.subjectKeyVersion, "v2");
    const outbox = sqlite.prepare(
      `SELECT job_type AS jobType,subject_id AS subjectId,
         available_at AS availableAt,status
       FROM job_outbox WHERE subject_id=?`,
    ).get(result.requestId) as {
      jobType: string;
      subjectId: string;
      availableAt: string;
      status: string;
    };
    assert.deepEqual({ ...outbox }, {
      jobType: "cleanup.run",
      subjectId: result.requestId,
      availableAt: "2026-08-25T12:02:00.000Z",
      status: "pending",
    });    assert.equal(
      (
        sqlite.prepare(
          `SELECT count(*) AS total FROM security_events
           WHERE user_id=? AND event_type='account.deletion_requested'`,
        ).get(USER_ID) as { total: number }
      ).total,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("concurrent correct confirmation has one request winner", async () => {
  const { sqlite, d1, session } = await fixture();
  try {
    await reserve(d1, session.sessionId);
    const challengeId = activeChallengeId(sqlite);
    const synchronized = batchBarrier(d1);
    const results = await Promise.all([
      confirm(synchronized, session.sessionId, challengeId),
      confirm(synchronized, session.sessionId, challengeId),
    ]);
    assert.equal(
      results.filter(({ status }) => status === "confirmed").length,
      1,
    );
    assert.equal(
      results.filter(({ status }) => status === "used").length,
      1,
    );
    assert.equal(
      (
        sqlite.prepare(
          "SELECT count(*) AS total FROM account_deletion_requests WHERE user_id=?",
        ).get(USER_ID) as { total: number }
      ).total,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("wrong, expired, and foreign-session codes fail closed", async () => {
  const { sqlite, d1, session } = await fixture();
  try {
    await reserve(d1, session.sessionId);
    const challengeId = activeChallengeId(sqlite);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await confirm(d1, session.sessionId, challengeId, {
        code: "000000",
      });
      assert.equal(
        result.status,
        attempt === 5 ? "attempts_exceeded" : "incorrect",
      );
    }
    assert.equal(
      (await confirm(d1, session.sessionId, challengeId)).status,
      "attempts_exceeded",
    );

    const second = await createEmailOtpSession(d1, {
      userId: USER_ID,
      userAgent: "Deletion browser/2.0",
      now: new Date("2026-07-26T12:03:00.000Z"),
    });
    assert.equal(
      (await confirm(d1, second.sessionId, challengeId)).status,
      "invalid",
    );
    assert.equal(
      (
        await confirm(d1, session.sessionId, challengeId, {
          email: "different@example.test",
        })
      ).status,
      "invalid",
    );

    sqlite.prepare(
      `UPDATE account_deletion_challenges
       SET attempt_count=0,max_attempts=5,expires_at=?
       WHERE id=?`,
    ).run("2026-07-26T12:01:30.000Z", challengeId);
    assert.equal(
      (
        await confirm(d1, session.sessionId, challengeId, {
          now: "2026-07-26T12:02:00.000Z",
        })
      ).status,
      "expired",
    );
    assert.equal(
      (
        sqlite.prepare(
          "SELECT count(*) AS total FROM account_deletion_requests",
        ).get() as { total: number }
      ).total,
      0,
    );
  } finally {
    sqlite.close();
  }
});

test("keyed deletion keeps email divergence checks without storing an offline code verifier", async () => {
  const emailFixture = await fixture();
  try {
    await reserve(emailFixture.d1, emailFixture.session.sessionId);
    const challengeId = activeChallengeId(emailFixture.sqlite);
    emailFixture.sqlite.prepare(
      `UPDATE account_deletion_challenges
       SET email_hash='divergent' WHERE id=?`,
    ).run(challengeId);
    await assert.rejects(
      confirm(emailFixture.d1, emailFixture.session.sessionId, challengeId),
      (error: unknown) => error instanceof IdentityProtectionError
        && error.code === "IDENTITY_VALUE_DIVERGED",
    );
    assert.equal(
      (
        emailFixture.sqlite.prepare(
          "SELECT count(*) AS total FROM account_deletion_requests",
        ).get() as { total: number }
      ).total,
      0,
    );
  } finally {
    emailFixture.sqlite.close();
  }

  const codeFixture = await fixture();
  try {
    await reserve(codeFixture.d1, codeFixture.session.sessionId);
    const challengeId = activeChallengeId(codeFixture.sqlite);
    const evidence = codeFixture.sqlite.prepare(
      `SELECT code_salt AS salt,code_hash AS hash,code_hmac AS hmac
       FROM account_deletion_challenges WHERE id=?`,
    ).get(challengeId) as { salt: string; hash: string; hmac: string };
    assert.notEqual(evidence.hash, await sha256(`${evidence.salt}:${CODE}`));
    assert.ok(evidence.hmac);
    codeFixture.sqlite.prepare(
      `UPDATE account_deletion_challenges
       SET code_hash='compatibility-sentinel' WHERE id=?`,
    ).run(challengeId);
    assert.equal(
      (
        await confirm(
          codeFixture.d1,
          codeFixture.session.sessionId,
          challengeId,
        )
      ).status,
      "confirmed",
    );
  } finally {
    codeFixture.sqlite.close();
  }
});

test("audit failure rolls back challenge, request, and revocation", async () => {
  const { sqlite, d1, session } = await fixture();
  try {
    await reserve(d1, session.sessionId);
    const challengeId = activeChallengeId(sqlite);
    sqlite.exec(`
      CREATE TRIGGER reject_deletion_audit
      BEFORE INSERT ON workspace_audit_events
      WHEN NEW.action='account_deletion_requested'
      BEGIN
        SELECT RAISE(ABORT, 'forced deletion audit failure');
      END
    `);
    await assert.rejects(
      () => confirm(d1, session.sessionId, challengeId),
      /forced deletion audit failure/,
    );
    assert.deepEqual({
      ...(sqlite.prepare(
        `SELECT consumed_at AS consumedAt,
          consumed_by_operation_id AS operationId
         FROM account_deletion_challenges WHERE id=?`,
      ).get(challengeId) as Record<string, unknown>),
    }, {
      consumedAt: null,
      operationId: null,
    });
    assert.equal(
      (
        sqlite.prepare(
          "SELECT count(*) AS total FROM account_deletion_requests",
        ).get() as { total: number }
      ).total,
      0,
    );
    assert.equal(
      (
        sqlite.prepare(
          `SELECT count(*) AS total FROM auth_sessions
           WHERE id=? AND revoked_at IS NULL`,
        ).get(session.sessionId) as { total: number }
      ).total,
      1,
    );
    assert.equal(
      (
        sqlite.prepare(
          `SELECT count(*) AS total FROM security_events
           WHERE user_id=? AND event_type='account.deletion_requested'`,
        ).get(USER_ID) as { total: number }
      ).total,
      0,
    );
  } finally {
    sqlite.close();
  }
});

test("account-deletion email is branded and fully localized with a plain-text alternative", () => {
  const expected = {
    ru: {
      subject: "Подтвердите удаление аккаунта — JURO",
      title: "Подтверждение удаления аккаунта",
      support: "Нужна помощь?",
      footer: "Ташкент, Республика Узбекистан",
    },
    uz: {
      subject: "Hisobni o‘chirishni tasdiqlang — JURO",
      title: "Hisobni o‘chirishni tasdiqlash",
      support: "Yordam kerakmi?",
      footer: "Toshkent, O‘zbekiston Respublikasi",
    },
    en: {
      subject: "Confirm account deletion — JURO",
      title: "Confirm account deletion",
      support: "Need help?",
      footer: "Tashkent, Republic of Uzbekistan",
    },
  } as const;

  for (const locale of ["ru", "uz", "en"] as const) {
    const message = renderJuroAuthEmail({
      locale,
      purpose: "account_deletion",
      code: CODE,
    });
    assert.equal(message.subject, expected[locale].subject);
    assert.match(message.html, new RegExp(`<html lang="${locale}"`, "u"));
    assert.match(message.html, /role="presentation"/u);
    assert.match(message.html, /background:#062844/u);
    assert.match(message.html, /mailto:admin@juro\.uz/u);
    assert.match(message.html, new RegExp(expected[locale].title, "u"));
    assert.match(message.text, new RegExp(expected[locale].support, "u"));
    assert.match(message.text, new RegExp(expected[locale].footer, "u"));
    assert.match(message.html, new RegExp(CODE, "u"));
    assert.match(message.text, new RegExp(CODE, "u"));
    assert.equal(message.text.includes("<table"), false);
  }
});

test("account-deletion email escapes code content in HTML and removes header injection controls", () => {
  const message = renderJuroAuthEmail({
    locale: "en",
    purpose: "account_deletion",
    code: "12<34&\r\n56",
  });
  assert.match(message.html, /12&lt;34&amp; 56/u);
  assert.equal(message.html.includes("12<34&"), false);
  assert.match(message.text, /12<34& 56/u);
  assert.equal(message.text.includes("\r"), false);
  assert.equal(message.text.includes("\n56"), false);
});

test("account-deletion route delegates delivery to the shared transactional renderer", () => {
  const source = readFileSync(
    new URL(
      "../app/api/platform/privacy/deletion-request/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /renderJuroAuthEmail\(\{/u);
  assert.match(source, /purpose: "account_deletion"/u);
  assert.match(source, /sendJuroAuthEmail\(\{/u);
  assert.doesNotMatch(source, /api\.resend\.com\/emails/u);
  assert.doesNotMatch(source, /<div style=/u);
});

test("account-deletion route sends the branded HTML and text bodies through Resend", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const routeUserId = "deletion-email-route-user";
  const email = "deletion-route@example.test";
  const authenticatedAt = new Date(Date.now() - 1_000);
  sqlite.prepare(
    `INSERT INTO user_profiles (id,email,locale,created_at,updated_at)
     VALUES (?,?,'uz',?,?)`,
  ).run(
    routeUserId,
    email,
    authenticatedAt.toISOString(),
    authenticatedAt.toISOString(),
  );
  const session = await createEmailOtpSession(d1, {
    userId: routeUserId,
    userAgent: "Deletion email route test/1.0",
    now: authenticatedAt,
  });

  const workerEnv = env as unknown as Record<string, unknown>;
  const envKeys = [
    "DB",
    "IDENTITY_PROTECTION_MODE",
    "IDENTITY_KEYRING",
    "RESEND_API_KEY",
    "EMAIL_FROM",
  ];
  const previousEnv = new Map(
    envKeys.map(key => [key, workerEnv[key]]),
  );
  Object.assign(workerEnv, {
    DB: d1,
    IDENTITY_PROTECTION_MODE: "dual_write",
    IDENTITY_KEYRING: RAW_IDENTITY_KEYRING,
    RESEND_API_KEY: "synthetic-resend-key",
    EMAIL_FROM: "JURO <no-reply@juro.uz>",
  });

  type Delivery = {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
  };
  let delivery: Delivery | null = null;
  let providerHeaders = new Headers();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    providerHeaders = new Headers(init?.headers);
    delivery = JSON.parse(String(init?.body)) as Delivery;
    return new Response(JSON.stringify({ id: "resend_deletion_test" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await requestAccountDeletion(new Request(
      "https://app.juro.uz/api/platform/privacy/deletion-request",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `juro_session=${session.token}`,
          origin: "https://app.juro.uz",
          "sec-fetch-site": "same-origin",
          "x-juro-csrf": "1",
        },
        body: JSON.stringify({ action: "request_code", locale: "uz" }),
      },
    ));
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { ok?: boolean }).ok, true);
    assert.ok(delivery);
    const sent = delivery as Delivery;
    assert.equal(sent.from, "JURO <no-reply@juro.uz>");
    assert.deepEqual(sent.to, [email]);
    assert.equal(sent.subject, "Hisobni o‘chirishni tasdiqlang — JURO");
    assert.match(sent.html, /<!doctype html><html lang="uz">/u);
    assert.match(sent.html, /mailto:admin@juro\.uz/u);
    assert.match(sent.text, /Hisobni o‘chirishni tasdiqlash/u);
    assert.match(sent.text, /Yordam kerakmi\?/u);
    assert.equal(sent.text.includes("<table"), false);
    assert.match(
      providerHeaders.get("idempotency-key") ?? "",
      /^juro_account_deletion_[0-9a-f-]{36}$/u,
    );
    assert.deepEqual({ ...sqlite.prepare(
      `SELECT locale,attempt_count AS attemptCount,max_attempts AS maxAttempts
       FROM account_deletion_challenges WHERE user_id=?`,
    ).get(routeUserId) }, { locale: "uz", attemptCount: 0, maxAttempts: 5 });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      const previous = previousEnv.get(key);
      if (previous === undefined) delete workerEnv[key];
      else workerEnv[key] = previous;
    }
    sqlite.close();
  }
});
