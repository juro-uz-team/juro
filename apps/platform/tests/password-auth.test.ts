import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { env } from "./helpers/runtime-env";
import { POST as passwordLogin } from "../app/api/auth/password-login/route";
import { POST as requestOtp } from "../app/api/auth/request-otp/route";
import { POST as resetPassword } from "../app/api/auth/reset-password/route";
import { GET as dashboard } from "../app/api/platform/dashboard/route";
import { sha256 } from "../lib/auth/crypto";
import {
  passwordLoginInputSchema,
  requestOtpInputSchema,
  resetPasswordInputSchema,
} from "../lib/auth/input";
import {
  clearPasswordLoginFailures,
  clearMfaVerificationFailures,
  completePasswordLoginAttempt,
  failPasswordLoginAttempt,
  hashPassword,
  mfaVerificationRateLimit,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordCredentialForUser,
  passwordCredentialWriteStatement,
  passwordLoginFailureClearStatement,
  passwordLoginRateLimit,
  preparePasswordCredential,
  recordPasswordLoginFailure,
  reservePasswordLoginAttempt,
  recordMfaVerificationFailure,
  validatePassword,
  verifyPassword,
} from "../lib/auth/password";
import { renderJuroAuthEmail } from "../lib/auth/transactional-email";
import {
  createIdentityProtectionContext,
  prepareUserIdentityWrite,
} from "../lib/auth/identity-protection";
import { reserveOtpChallenge } from "../lib/auth/otp-request";
import { localSessionFromCookie } from "../lib/auth/session-management";
import { REMEMBERED_SESSION_TTL_SECONDS } from "../lib/auth/session-persistence";
import { SESSION_COOKIE } from "../lib/auth/session-token";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

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

const PASSWORD_RESET_KEYRING = JSON.stringify({
  active: "v1",
  versions: {
    v1: { aead: encodedKey(7), hmac: encodedKey(39) },
  },
});

function setCookies(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return headers.getSetCookie?.()
    ?? [headers.get("set-cookie") ?? ""];
}

test("password credentials use a salted slow hash and never store plaintext", async () => {
  const password = "correct horse battery staple";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.equal(first.algorithm, "PBKDF2-SHA256");
  assert.equal(first.iterations, 600_000);
  assert.notEqual(first.saltBase64url, second.saltBase64url);
  assert.notEqual(first.hashBase64url, second.hashBase64url);
  assert.equal(first.hashBase64url.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword(password, null), false);
});

test("password policy supports passphrases without silent truncation", () => {
  assert.deepEqual(validatePassword("a".repeat(PASSWORD_MIN_LENGTH - 1)), {
    ok: false,
    code: "PASSWORD_TOO_SHORT",
  });
  assert.deepEqual(validatePassword("a".repeat(PASSWORD_MIN_LENGTH)), {
    ok: true,
  });
  assert.deepEqual(validatePassword("a".repeat(PASSWORD_MAX_LENGTH + 1)), {
    ok: false,
    code: "PASSWORD_TOO_LONG",
  });
});

test("registration is one payload and password login/reset have strict contracts", () => {
  const registration = requestOtpInputSchema.safeParse({
    purpose: "register",
    email: " person@example.com ",
    locale: "en",
    accountType: "individual",
    password: "long passphrase",
    firstName: "Alex",
    lastName: "",
    acceptTerms: true,
    acceptPrivacy: true,
    acceptPersonalData: true,
    marketing: false,
    turnstileToken: "verified-token",
  });
  assert.equal(registration.success, true);
  assert.equal(requestOtpInputSchema.safeParse({
    purpose: "registration_resend",
    email: "person@example.com",
    locale: "en",
    accountType: "individual",
    password: "long passphrase",
    acceptTerms: true,
    acceptPrivacy: true,
    acceptPersonalData: true,
    turnstileToken: "verified-token",
  }).success, true);
  assert.equal(requestOtpInputSchema.safeParse({
    purpose: "registration_resend",
    email: "person@example.com",
    locale: "en",
    accountType: "individual",
    acceptTerms: true,
    acceptPrivacy: true,
    acceptPersonalData: true,
    turnstileToken: "verified-token",
  }).success, false, "confirmation resend must prove knowledge of the password");
  assert.equal(requestOtpInputSchema.safeParse({
    purpose: "register",
    email: "person@example.com",
    locale: "ru",
    accountType: "individual",
    firstName: "Alex",
    acceptTerms: true,
    acceptPrivacy: true,
    acceptPersonalData: true,
    turnstileToken: "verified-token",
  }).success, false);
  assert.equal(passwordLoginInputSchema.safeParse({
    email: "person@example.com",
    password: "long passphrase",
    locale: "uz",
    rememberMe: true,
    turnstileToken: "verified-token",
  }).success, true);
  assert.equal(resetPasswordInputSchema.safeParse({
    challengeId: "04f0c00f-1b99-4c6f-8c3c-707ea6526f22",
    email: "person@example.com",
    code: "123456",
    password: "a new long passphrase",
    locale: "en",
  }).success, true);
  assert.equal(requestOtpInputSchema.safeParse({
    purpose: "login",
    email: "person@example.com",
    locale: "ru",
    accountType: "individual",
    turnstileToken: "verified-token",
  }).success, false, "ordinary login codes must not remain a public auth path");
});

test("new registration persists its pending account and sends one confirmation email", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const workerEnv = env as unknown as Record<string, unknown>;
  const envKeys = [
    "DB",
    "APP_ENV",
    "IDENTITY_PROTECTION_MODE",
    "IDENTITY_KEYRING",
    "TURNSTILE_SECRET_KEY",
    "RESEND_API_KEY",
    "EMAIL_FROM",
  ];
  const previousEnv = new Map(envKeys.map(key => [key, workerEnv[key]]));
  const originalFetch = globalThis.fetch;
  const email = "new-registration@example.test";
  const password = "a durable new registration passphrase";
  const requestIp = "203.0.113.91";

  Object.assign(workerEnv, {
    DB: d1,
    APP_ENV: "production",
    IDENTITY_PROTECTION_MODE: "dual_write",
    IDENTITY_KEYRING: PASSWORD_RESET_KEYRING,
    TURNSTILE_SECRET_KEY: "private-local",
    RESEND_API_KEY: "resend-api-key",
    EMAIL_FROM: "JURO <no-reply@juro.uz>",
  });
  let emailRequests = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    emailRequests += 1;
    const payload = JSON.parse(String(init?.body)) as {
      from?: string;
      to?: string[];
      subject?: string;
    };
    assert.equal(payload.from, "JURO <no-reply@juro.uz>");
    assert.deepEqual(payload.to, [email]);
    assert.match(payload.subject ?? "", /JURO/u);
    return Response.json({ id: "resend_new_registration" });
  };

  try {
    const response = await requestOtp(new Request(
      "http://localhost:3000/api/auth/request-otp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
          "x-juro-csrf": "1",
          "x-juro-client-ip": requestIp,
        },
        body: JSON.stringify({
          purpose: "register",
          email,
          password,
          firstName: "New",
          lastName: "Registration",
          locale: "en",
          accountType: "individual",
          acceptTerms: true,
          acceptPrivacy: true,
          acceptPersonalData: true,
          turnstileToken: "private-local",
        }),
      },
    ));
    assert.equal(response.status, 200);
    const body = await response.json() as {
      ok?: boolean;
      challengeId?: string;
      expiresInSeconds?: number;
      resendAfterSeconds?: number;
    };
    assert.equal(body.ok, true);
    assert.ok(body.challengeId);
    const challengeId = body.challengeId;
    assert.match(challengeId, /^[0-9a-f-]{36}$/u);
    assert.equal(body.expiresInSeconds, 600);
    assert.equal(body.resendAfterSeconds, 60);
    assert.equal(emailRequests, 1);

    const profile = sqlite.prepare(`
      SELECT id,email,full_name AS fullName,email_verified_at AS emailVerifiedAt
      FROM user_profiles WHERE email=?
    `).get(email) as {
      id: string;
      email: string;
      fullName: string;
      emailVerifiedAt: string | null;
    };
    assert.equal(profile.email, email);
    assert.equal(profile.fullName, "New Registration");
    assert.equal(profile.emailVerifiedAt, null);
    assert.ok(await passwordCredentialForUser(d1, profile.id));
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM auth_pending_registrations WHERE user_id=?",
      ).get(profile.id) as { total: number }).total,
      1,
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM auth_otp_challenges WHERE id=? AND purpose='register' AND invalidated_at IS NULL",
      ).get(challengeId) as { total: number }).total,
      1,
    );
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

test("registration persists its password only after OTP reservation succeeds", () => {
  const route = readFileSync(
    new URL("../app/api/auth/request-otp/route.ts", import.meta.url),
    "utf8",
  );
  const reservation = route.indexOf(
    "const reservation = await reserveOtpChallenge",
  );
  const credentialWrite = route.indexOf(
    "statements.push(passwordCredentialWriteStatement",
    reservation,
  );
  const retentionMarker = route.indexOf(
    "statements.push(pendingRegistrationUpsertStatement",
    credentialWrite,
  );
  const atomicBatch = route.indexOf("await db.batch(statements)", retentionMarker);
  assert.ok(reservation >= 0);
  assert.ok(credentialWrite > reservation);
  assert.ok(retentionMarker > credentialWrite);
  assert.ok(atomicBatch > retentionMarker);
  assert.match(route, /if \(reservation\.status === "blocked"\)/u);
});

test("registration acceptance evidence and email verification share one atomic finalizer", () => {
  const route = readFileSync(
    new URL("../app/api/auth/verify-otp/route.ts", import.meta.url),
    "utf8",
  );
  const acceptance = route.indexOf("await prepareRegistrationAcceptanceWrite");
  const verification = route.indexOf("await finalizePendingRegistration");
  assert.ok(acceptance >= 0);
  assert.ok(verification > acceptance);
});

test("password reset binds mutation to the unchanged email identity and retires sibling OTPs", () => {
  const route = readFileSync(
    new URL("../app/api/auth/reset-password/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /const unchangedIdentity =/u);
  assert.match(route, /email_ciphertext IS \?/u);
  assert.match(route, /email_lookup_hash IS \?/u);
  assert.match(
    route,
    /UPDATE auth_otp_challenges SET invalidated_at=\?/u,
  );
  assert.match(
    route,
    /passwordCredentialWriteStatement\([\s\S]*unchangedIdentity/u,
  );
  assert.ok(
    route.indexOf("const passwordChangedEmail = await preparePasswordChangedSecurityEmailRetry")
      < route.indexOf("const results = await batchWithSecurityEvent"),
  );
  assert.match(route, /\.\.\.passwordChangedEmail\.statements/u);
  assert.match(route, /await notifyPasswordChangedWithRetry\(db,/u);
  assert.match(route, /authOtpChallengeId: challengeId/u);
  assert.match(route, /catch \{[\s\S]*Notification delivery must not disclose account existence/u);
});

test("a committed password reset keeps an encrypted durable email job when the follow-up D1 write fails", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
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
  const originalFetch = globalThis.fetch;
  const userId = "password-reset-durable-user";
  const email = "durable-reset@example.test";
  const challengeId = "48484848-4848-4484-8484-484848484848";
  const code = "714205";
  const password = "a new durable password phrase";
  const now = new Date();
  const identityContext = createIdentityProtectionContext(
    "dual_write",
    PASSWORD_RESET_KEYRING,
  );
  const identity = await prepareUserIdentityWrite(identityContext, {
    userId,
    email,
    phone: null,
  });
  sqlite.prepare(
    `INSERT INTO user_profiles (
       id,email,email_ciphertext,email_iv,email_key_version,
       email_lookup_hash,email_lookup_key_version,locale,email_verified_at,
       created_at,updated_at
     ) VALUES (?,?,?,?,?,?,?,'en',?,?,?)`,
  ).run(
    userId,
    identity.email,
    identity.emailCiphertext,
    identity.emailIv,
    identity.emailKeyVersion,
    identity.emailLookupHash,
    identity.emailLookupKeyVersion,
    now.toISOString(),
    now.toISOString(),
    now.toISOString(),
  );
  await reserveOtpChallenge(d1, {
    identityContext,
    id: challengeId,
    email,
    requestIp: null,
    purpose: "password_reset",
    locale: "en",
    accountType: "individual",
    codeSalt: "durable-reset-salt",
    code,
    expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    now: now.toISOString(),
    cooldownSince: new Date(now.getTime() - 90_000).toISOString(),
    hourlySince: new Date(now.getTime() - 60 * 60_000).toISOString(),
  });

  let passwordBatchCommitted = false;
  const failAfterPasswordCommit = {
    prepare(sql: string) {
      if (passwordBatchCommitted) throw new Error("FOLLOWUP_D1_FAILPOINT");
      return d1.prepare(sql);
    },
    async batch(statements: D1PreparedStatement[]) {
      const results = await d1.batch(statements);
      passwordBatchCommitted = true;
      return results;
    },
  } as unknown as D1Database;
  Object.assign(workerEnv, {
    DB: failAfterPasswordCommit,
    IDENTITY_PROTECTION_MODE: "dual_write",
    IDENTITY_KEYRING: PASSWORD_RESET_KEYRING,
    RESEND_API_KEY: "synthetic-resend-key",
    EMAIL_FROM: "JURO <no-reply@juro.uz>",
  });
  const providerCalls: Headers[] = [];
  globalThis.fetch = async (_input, init) => {
    providerCalls.push(new Headers(init?.headers));
    return new Response(JSON.stringify({ id: "resend_durable_reset" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await resetPassword(new Request(
      "http://localhost:3000/api/auth/reset-password",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
          "x-juro-csrf": "1",
        },
        body: JSON.stringify({ challengeId, email, code, password, locale: "en" }),
      },
    ));
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { ok?: boolean }).ok, true);
    assert.equal(passwordBatchCommitted, true);
    assert.equal(await verifyPassword(
      password,
      await passwordCredentialForUser(d1, userId),
    ), true);
    assert.equal(providerCalls.length, 1);
    assert.equal(
      providerCalls[0]?.get("idempotency-key"),
      `juro_password_changed_${challengeId}`,
    );
    const durable = sqlite.prepare(
      `SELECT job.status,job.event_type AS eventType,
         job.recipient_ciphertext AS recipientCiphertext,
         outbox.status AS outboxStatus
       FROM security_email_jobs job
       JOIN job_outbox outbox ON outbox.subject_id=job.id
       WHERE job.auth_otp_challenge_id=?`,
    ).get(challengeId) as {
      status: string;
      eventType: string;
      recipientCiphertext: string;
      outboxStatus: string;
    };
    assert.deepEqual({
      status: durable.status,
      eventType: durable.eventType,
      outboxStatus: durable.outboxStatus,
    }, {
      status: "pending",
      eventType: "password_changed",
      outboxStatus: "pending",
    });
    assert.notEqual(durable.recipientCiphertext, email);
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

test("password reset provisions a password for a legacy identity during dual-write migration", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const workerEnv = env as unknown as Record<string, unknown>;
  const envKeys = ["DB", "IDENTITY_PROTECTION_MODE", "IDENTITY_KEYRING"];
  const previousEnv = new Map(envKeys.map(key => [key, workerEnv[key]]));
  const userId = "password-reset-legacy-user";
  const email = "legacy-reset@example.test";
  const challengeId = "58585858-5858-4585-8585-585858585858";
  const code = "914205";
  const password = "a new legacy migration password";
  const now = new Date();
  const identityContext = createIdentityProtectionContext(
    "dual_write",
    PASSWORD_RESET_KEYRING,
  );

  try {
    // Production accounts created before identity encryption contain a verified
    // plaintext email and null protected columns. They must still be able to
    // establish a password through the recovery flow.
    sqlite.prepare(
      `INSERT INTO user_profiles (
         id,email,email_ciphertext,email_iv,email_key_version,
         email_lookup_hash,email_lookup_key_version,locale,email_verified_at,
         created_at,updated_at
       ) VALUES (?, ?, NULL, NULL, NULL, NULL, NULL, 'en', ?, ?, ?)`,
    ).run(userId, email, now.toISOString(), now.toISOString(), now.toISOString());
    await reserveOtpChallenge(d1, {
      identityContext,
      id: challengeId,
      email,
      requestIp: null,
      purpose: "password_reset",
      locale: "en",
      accountType: "individual",
      codeSalt: "legacy-reset-salt",
      code,
      expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
      now: now.toISOString(),
      cooldownSince: new Date(now.getTime() - 90_000).toISOString(),
      hourlySince: new Date(now.getTime() - 60 * 60_000).toISOString(),
    });
    Object.assign(workerEnv, {
      DB: d1,
      IDENTITY_PROTECTION_MODE: "dual_write",
      IDENTITY_KEYRING: PASSWORD_RESET_KEYRING,
    });

    const response = await resetPassword(new Request(
      "http://localhost:3000/api/auth/reset-password",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
          "x-juro-csrf": "1",
        },
        body: JSON.stringify({
          challengeId,
          email,
          code,
          password,
          locale: "en",
        }),
      },
    ));

    assert.equal(response.status, 200);
    assert.equal(await verifyPassword(
      password,
      await passwordCredentialForUser(d1, userId),
    ), true);
    assert.equal((sqlite.prepare(
      "SELECT count(*) AS total FROM security_events WHERE user_id=? AND event_type='password.changed'",
    ).get(userId) as { total: number }).total, 1);
  } finally {
    for (const key of envKeys) {
      const previous = previousEnv.get(key);
      if (previous === undefined) delete workerEnv[key];
      else workerEnv[key] = previous;
    }
    sqlite.close();
  }
});

test("auth email renderer produces separate responsive HTML and plain text in every locale", () => {
  for (const locale of ["ru", "uz", "en"] as const) {
    const message = renderJuroAuthEmail({
      locale,
      purpose: "password_reset",
      code: "123456",
    });
    assert.match(message.subject, /JURO/u);
    assert.match(message.html, new RegExp(`<html lang="${locale}"`, "u"));
    assert.match(message.html, /role="presentation"/u);
    assert.match(message.html, /mailto:admin@juro\.uz/u);
    assert.match(message.html, /123456/u);
    assert.match(message.text, /123456/u);
    assert.equal(message.text.includes("<table"), false);
  }
});

test("auth email renderer escapes notification details and preserves plain text", () => {
  const message = renderJuroAuthEmail({
    locale: "en",
    purpose: "new_device",
    details: [
      { label: "Device <name>", value: "Chrome <unsafe>\r\nspoofed" },
      { label: "Region", value: "Tashkent & area" },
    ],
  });
  assert.match(message.html, /Device &lt;name&gt;/u);
  assert.match(message.html, /Chrome &lt;unsafe&gt; spoofed/u);
  assert.equal(message.html.includes("<unsafe>"), false);
  assert.match(message.text, /Device <name>: Chrome <unsafe> spoofed/u);
  assert.equal(message.text.includes("\r"), false);
  assert.equal(message.text.includes("\nspoofed"), false);
});

test("email-change destinations and security notifications retain distinct purposes", () => {
  for (const locale of ["ru", "uz", "en"] as const) {
    const current = renderJuroAuthEmail({
      locale,
      purpose: "email_change_current",
      code: "123456",
    });
    const next = renderJuroAuthEmail({
      locale,
      purpose: "email_change",
      code: "654321",
    });
    const changed = renderJuroAuthEmail({
      locale,
      purpose: "password_changed",
    });
    assert.notEqual(current.subject, next.subject);
    assert.match(current.text, /123456/u);
    assert.match(next.text, /654321/u);
    assert.equal(changed.text.includes("undefined"), false);
    assert.equal(changed.html.includes("undefined"), false);
  }
});

test("email-change API batches branded HTML and plain-text alternatives", () => {
  const route = readFileSync(
    new URL(
      "../app/api/platform/security/email-change/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(route, /purpose: "email_change_current"/u);
  assert.match(route, /purpose: "email_change"/u);
  assert.match(route, /text: current\.text/u);
  assert.match(route, /text: next\.text/u);
});

test("guarded password writes cannot overwrite a newly verified profile", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const userId = "registration-password-race";
  const createdAt = "2026-09-04T10:00:00.000Z";
  try {
    sqlite.prepare(
      `INSERT INTO user_profiles (id,email,locale,created_at,updated_at)
       VALUES (?,?,'ru',?,?)`,
    ).run(userId, "race@example.test", createdAt, createdAt);
    const original = await preparePasswordCredential(
      "original passphrase",
      new Date(createdAt),
    );
    await passwordCredentialWriteStatement(d1, userId, original).run();
    sqlite.prepare(
      "UPDATE user_profiles SET email_verified_at=? WHERE id=?",
    ).run("2026-09-04T10:01:00.000Z", userId);
    const replacement = await preparePasswordCredential(
      "attacker passphrase",
      new Date("2026-09-04T10:02:00.000Z"),
    );
    const guarded = await passwordCredentialWriteStatement(
      d1,
      userId,
      replacement,
      {
        selectSql: `SELECT 1 FROM user_profiles
          WHERE id=? AND email_verified_at IS NULL`,
        bindings: [userId],
      },
    ).run();
    assert.equal(Number(guarded.meta.changes ?? 0), 0);
    const stored = await passwordCredentialForUser(d1, userId);
    assert.equal(await verifyPassword("original passphrase", stored), true);
    assert.equal(await verifyPassword("attacker passphrase", stored), false);
  } finally {
    sqlite.close();
  }
});

test("password lock survives the original counting window", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const email = "locked@example.test";
  const started = new Date("2026-09-04T10:00:00.000Z");
  try {
    for (let count = 0; count < 4; count += 1) {
      await recordPasswordLoginFailure(d1, {
        email,
        requestIp: null,
        now: started,
      });
    }
    await recordPasswordLoginFailure(d1, {
      email,
      requestIp: null,
      now: new Date("2026-09-04T10:14:00.000Z"),
    });
    const limit = await passwordLoginRateLimit(d1, {
      email,
      requestIp: null,
      now: new Date("2026-09-04T10:16:00.000Z"),
    });
    assert.equal(limit.allowed, false);
    if (!limit.allowed) assert.equal(limit.retryAfterSeconds, 13 * 60);
  } finally {
    sqlite.close();
  }
});

test("concurrent password attempts cannot outrun email or shared-IP limits", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const email = "concurrent@example.test";
  const now = new Date("2026-09-04T10:30:00.000Z");
  try {
    const reservations = await Promise.all(
      Array.from({ length: 12 }, () =>
        reservePasswordLoginAttempt(d1, { email, requestIp: null, now })
      ),
    );
    assert.ok(
      reservations.filter(({ allowed }) => allowed).length <= 5,
      "parallel requests must not exceed the hard email budget",
    );
    assert.ok(reservations.some(({ allowed }) => !allowed));

    const requestIp = "203.0.113.77";
    const spray = await Promise.all(
      Array.from({ length: 30 }, (_, index) =>
        reservePasswordLoginAttempt(d1, {
          email: `spray-${index}@example.test`,
          requestIp,
          now: new Date("2026-09-04T10:31:00.000Z"),
        })
      ),
    );
    assert.ok(
      spray.filter(({ allowed }) => allowed).length <= 20,
      "parallel password spray must not exceed the shared-IP budget",
    );
    assert.ok(spray.some(({ allowed }) => !allowed));

    for (const reservation of spray) {
      if (reservation.allowed) {
        await completePasswordLoginAttempt(d1, reservation.reservation);
      }
    }
    const phantomIpFailures = sqlite.prepare(
      `SELECT failure_count AS failureCount
       FROM auth_password_rate_limits
       WHERE scope_key NOT IN (
         SELECT scope_key FROM auth_password_attempt_reservations
       )`,
    ).all() as Array<{ failureCount: number }>;
    assert.ok(phantomIpFailures.every(({ failureCount }) => failureCount === 0));
  } finally {
    sqlite.close();
  }
});

test("successful password login releases only its owned IP reservation", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const email = "reservation-success@example.test";
  const requestIp = "203.0.113.88";
  const now = new Date("2026-09-04T10:40:00.000Z");
  try {
    const attempt = await reservePasswordLoginAttempt(d1, {
      email,
      requestIp,
      now,
    });
    assert.equal(attempt.allowed, true);
    if (!attempt.allowed) return;
    await completePasswordLoginAttempt(d1, attempt.reservation);
    const remaining = sqlite.prepare(
      "SELECT failure_count AS failureCount FROM auth_password_rate_limits",
    ).all() as Array<{ failureCount: number }>;
    assert.ok(remaining.every(({ failureCount }) => failureCount === 0));
  } finally {
    sqlite.close();
  }
});

test("failed password login converts owned leases into durable failure counters", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const now = new Date("2026-09-04T10:42:00.000Z");
  try {
    const attempt = await reservePasswordLoginAttempt(d1, {
      email: "reservation-failure@example.test",
      requestIp: "203.0.113.89",
      now,
    });
    assert.equal(attempt.allowed, true);
    if (!attempt.allowed) return;
    await failPasswordLoginAttempt(d1, attempt.reservation, now);
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM auth_password_attempt_reservations",
      ).get() as { total: number }).total,
      0,
    );
    const counters = sqlite.prepare(
      "SELECT failure_count AS failureCount FROM auth_password_rate_limits",
    ).all() as Array<{ failureCount: number }>;
    assert.deepEqual(counters.map(({ failureCount }) => failureCount).sort(), [1, 1]);
  } finally {
    sqlite.close();
  }
});

test("a guarded password reset clears the account lock only while identity is unchanged", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const email = "reset-locked@example.test";
  try {
    await recordPasswordLoginFailure(d1, {
      email,
      requestIp: null,
      now: new Date("2026-09-04T10:45:00.000Z"),
    });
    const clear = await passwordLoginFailureClearStatement(d1, {
      email,
      guard: { selectSql: "SELECT 1 WHERE ? = ?", bindings: ["same", "same"] },
    });
    await clear.run();
    assert.deepEqual(await passwordLoginRateLimit(d1, {
      email,
      requestIp: null,
      now: new Date("2026-09-04T10:45:01.000Z"),
    }), { allowed: true });
  } finally {
    sqlite.close();
  }
});

test("successful account login clears only its email failures, not shared IP failures", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const email = "success@example.test";
  const requestIp = "203.0.113.9";
  const now = new Date("2026-09-04T11:00:00.000Z");
  try {
    for (let count = 0; count < 20; count += 1) {
      await recordPasswordLoginFailure(d1, { email, requestIp, now });
    }
    await clearPasswordLoginFailures(d1, { email });
    assert.deepEqual(await passwordLoginRateLimit(d1, {
      email,
      requestIp: null,
      now: new Date("2026-09-04T11:00:01.000Z"),
    }), { allowed: true });
    const sharedIp = await passwordLoginRateLimit(d1, {
      email,
      requestIp,
      now: new Date("2026-09-04T11:00:01.000Z"),
    });
    assert.equal(sharedIp.allowed, false);
  } finally {
    sqlite.close();
  }
});

test("MFA failures persist across replacement challenges while a success clears only the account scope", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const userId = "mfa-rate-user";
  const requestIp = "203.0.113.19";
  const now = new Date("2026-09-04T11:30:00.000Z");
  try {
    for (let count = 0; count < 5; count += 1) {
      await recordMfaVerificationFailure(d1, { userId, requestIp, now });
    }
    const accountLock = await mfaVerificationRateLimit(d1, {
      userId,
      requestIp: null,
      now: new Date("2026-09-04T11:30:01.000Z"),
    });
    assert.equal(accountLock.allowed, false);
    await clearMfaVerificationFailures(d1, { userId });
    assert.deepEqual(await mfaVerificationRateLimit(d1, {
      userId,
      requestIp: null,
      now: new Date("2026-09-04T11:30:02.000Z"),
    }), { allowed: true });
    const sharedIp = await mfaVerificationRateLimit(d1, {
      userId,
      requestIp,
      now: new Date("2026-09-04T11:30:02.000Z"),
    });
    assert.equal(sharedIp.allowed, true, "five attempts stay below the shared-IP cap");
  } finally {
    sqlite.close();
  }
});

test("password-login route issues a remembered opaque session accepted by protected routes", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const workerEnv = env as unknown as Record<string, unknown>;
  const envKeys = [
    "DB",
    "APP_ENV",
    "ALLOW_PLATFORM_AUTH_HEADERS",
    "IDENTITY_PROTECTION_MODE",
    "IDENTITY_KEYRING",
    "TURNSTILE_SECRET_KEY",
  ];
  const previousEnv = new Map(
    envKeys.map(key => [key, workerEnv[key]]),
  );
  const originalFetch = globalThis.fetch;
  const userId = "password-route-user";
  const email = "password-route@example.test";
  const password = "a real remembered password phrase";
  const requestIp = "203.0.113.41";
  const now = new Date();
  const identityContext = createIdentityProtectionContext(
    "dual_write",
    PASSWORD_RESET_KEYRING,
  );
  const identity = await prepareUserIdentityWrite(identityContext, {
    userId,
    email,
    phone: null,
  });
  sqlite.prepare(
    `INSERT INTO user_profiles (
       id,email,email_ciphertext,email_iv,email_key_version,
       email_lookup_hash,email_lookup_key_version,full_name,locale,
       account_type,theme_preference,email_verified_at,
       onboarding_completed_at,created_at,updated_at
     ) VALUES (?,?,?,?,?,?,?,?,'ru','individual','dark',?,?,?,?)`,
  ).run(
    userId,
    identity.email,
    identity.emailCiphertext,
    identity.emailIv,
    identity.emailKeyVersion,
    identity.emailLookupHash,
    identity.emailLookupKeyVersion,
    "Password Route User",
    now.toISOString(),
    now.toISOString(),
    now.toISOString(),
    now.toISOString(),
  );
  const credential = await preparePasswordCredential(password, now);
  await passwordCredentialWriteStatement(d1, userId, credential).run();

  Object.assign(workerEnv, {
    DB: d1,
    APP_ENV: "production",
    ALLOW_PLATFORM_AUTH_HEADERS: "false",
    IDENTITY_PROTECTION_MODE: "dual_write",
    IDENTITY_KEYRING: PASSWORD_RESET_KEYRING,
    TURNSTILE_SECRET_KEY: "private-local",
  });
  globalThis.fetch = async () => { throw new Error("Private password login must not call a challenge provider"); };

  const request = (
    requestEmail: string,
    requestPassword: string,
    token: string,
    locale: "ru" | "uz" | "en" = "ru",
  ) =>
    passwordLogin(new Request(
      "http://localhost:3000/api/auth/password-login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "sec-fetch-site": "same-origin",
          "x-juro-csrf": "1",
          "x-juro-client-ip": requestIp,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0",
        },
        body: JSON.stringify({
          email: requestEmail,
          password: requestPassword,
          locale,
          rememberMe: true,
          turnstileToken: token,
        }),
      },
    ));

  try {
    const wrongPassword = await request(
      email,
      "definitely wrong passphrase",
      "private-local",
    );
    const missingAccount = await request(
      "missing-password-route@example.test",
      "definitely wrong passphrase",
      "private-local",
    );
    assert.equal(wrongPassword.status, 401);
    assert.equal(missingAccount.status, 401);
    const wrongBody = await wrongPassword.json();
    const missingBody = await missingAccount.json();
    assert.deepEqual(wrongBody, {
      code: "AUTH_FAILED",
      error: "Не удалось войти. Проверьте электронную почту и пароль.",
    });
    assert.deepEqual(missingBody, wrongBody);
    assert.equal(
      setCookies(wrongPassword).some(cookie =>
        cookie.startsWith(`${SESSION_COOKIE}=`)
        && !/(?:^|;)\s*Max-Age=0(?:;|$)/u.test(cookie)
      ),
      false,
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM auth_sessions",
      ).get() as { total: number }).total,
      0,
    );

    const response = await request(
      `  ${email.toUpperCase()}  `,
      password,
      "private-local",
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      redirectTo: "/ru/individual/dashboard",
      handoff: null,
      themePreference: "dark",
    });

    const activeSessionCookie = setCookies(response).find(cookie =>
      cookie.startsWith(`${SESSION_COOKIE}=`)
      && !/(?:^|;)\s*Max-Age=0(?:;|$)/u.test(cookie)
    );
    assert.ok(activeSessionCookie, "successful login must set an active bearer");
    assert.match(activeSessionCookie, /; Path=\/; HttpOnly; Secure; SameSite=Lax;/u);
    assert.match(
      activeSessionCookie,
      new RegExp(`Max-Age=${REMEMBERED_SESSION_TTL_SECONDS}(?:;|$)`, "u"),
    );
    assert.doesNotMatch(activeSessionCookie, /;\s*Domain=/iu);
    const cookiePair = activeSessionCookie.split(";", 1)[0];
    const token = decodeURIComponent(
      cookiePair.slice(`${SESSION_COOKIE}=`.length),
    );
    assert.match(token, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(token.includes(userId), false);
    assert.equal(token.includes(email), false);
    assert.equal(token.includes(password), false);

    const persisted = sqlite.prepare(
      `SELECT token_hash AS tokenHash,auth_method AS authMethod,
         assurance_level AS assuranceLevel,created_at AS createdAt,
         expires_at AS expiresAt,revoked_at AS revokedAt
       FROM auth_sessions WHERE user_id=?`,
    ).get(userId) as {
      tokenHash: string;
      authMethod: string;
      assuranceLevel: string;
      createdAt: string;
      expiresAt: string;
      revokedAt: string | null;
    };
    assert.equal(persisted.tokenHash, await sha256(token));
    assert.notEqual(persisted.tokenHash, token);
    assert.equal(persisted.authMethod, "password");
    assert.equal(persisted.assuranceLevel, "primary");
    assert.equal(persisted.revokedAt, null);
    assert.equal(
      (Date.parse(persisted.expiresAt) - Date.parse(persisted.createdAt)) / 1_000,
      REMEMBERED_SESSION_TTL_SECONDS,
    );

    const cookieHeader = `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
    const session = await localSessionFromCookie(d1, cookieHeader, {
      identity: identityContext,
      touch: false,
    });
    assert.ok(session);
    assert.equal(session.userId, userId);
    assert.equal(session.email, email);
    assert.equal(session.authMethod, "password");
    assert.equal(session.expiresAt, persisted.expiresAt);

    const protectedResponse = await dashboard(new Request(
      "http://localhost:3000/api/platform/dashboard",
      { headers: { cookie: cookieHeader } },
    ));
    assert.equal(protectedResponse.status, 200);
    const protectedBody = await protectedResponse.json() as {
      counts?: { activeCases?: number; documents?: number };
    };
    assert.deepEqual(protectedBody.counts, {
      activeCases: 0,
      documents: 0,
      consultations: 0,
      unreadNotifications: 0,
    });

    const englishResponse = await request(
      email,
      password,
      "private-local",
      "en",
    );
    assert.equal(englishResponse.status, 200);
    assert.deepEqual(await englishResponse.json(), {
      ok: true,
      redirectTo: "/en/individual/dashboard",
      handoff: null,
      themePreference: "dark",
    });
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

test("migration 0150 preserves existing accounts and adds password/MFA controls", () => {
  const migration = readFileSync(
    new URL("../drizzle/0150_password_authentication.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /user_password_credentials/u);
  assert.match(migration, /PBKDF2-SHA256/u);
  assert.match(migration, /auth_password_rate_limits/u);
  assert.match(migration, /auth_password_attempt_reservations/u);
  assert.match(migration, /auth_mfa_attempt_reservations/u);
  assert.match(migration, /failure_claim_nonce/u);
  assert.match(migration, /primary_auth_method/u);
  assert.match(migration, /email_verified_at/u);
  assert.match(migration, /UPDATE `user_profiles`/u);
  assert.doesNotMatch(
    migration,
    /INSERT\s+INTO\s+`?user_password_credentials`?\s+SELECT/iu,
  );
});

test("registration confirmation resend verifies the password without recreating or enumerating accounts", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const workerEnv = env as unknown as Record<string, unknown>;
  const envKeys = [
    "DB",
    "APP_ENV",
    "IDENTITY_PROTECTION_MODE",
    "IDENTITY_KEYRING",
    "TURNSTILE_SECRET_KEY",
    "RESEND_API_KEY",
    "EMAIL_FROM",
  ];
  const previousEnv = new Map(envKeys.map(key => [key, workerEnv[key]]));
  const originalFetch = globalThis.fetch;
  const userId = "registration-resend-user";
  const email = "registration-resend@example.test";
  const password = "a durable registration passphrase";
  const now = new Date();
  const identityContext = createIdentityProtectionContext(
    "dual_write",
    PASSWORD_RESET_KEYRING,
  );
  const identity = await prepareUserIdentityWrite(identityContext, {
    userId,
    email,
    phone: null,
  });
  sqlite.prepare(
    `INSERT INTO user_profiles (
       id,email,email_ciphertext,email_iv,email_key_version,
       email_lookup_hash,email_lookup_key_version,full_name,locale,
       account_type,theme_preference,email_verified_at,
       onboarding_completed_at,created_at,updated_at
     ) VALUES (?,?,?,?,?,?,?,?,'ru','lawyer','light',NULL,NULL,?,?)`,
  ).run(
    userId,
    identity.email,
    identity.emailCiphertext,
    identity.emailIv,
    identity.emailKeyVersion,
    identity.emailLookupHash,
    identity.emailLookupKeyVersion,
    "Original Name",
    now.toISOString(),
    now.toISOString(),
  );
  await passwordCredentialWriteStatement(
    d1,
    userId,
    await preparePasswordCredential(password, now),
  ).run();
  sqlite.prepare(
    `INSERT INTO auth_pending_registrations (
       user_id,expires_at,created_at,updated_at
     ) VALUES (?,?,?,?)`,
  ).run(
    userId,
    new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
    now.toISOString(),
    now.toISOString(),
  );

  Object.assign(workerEnv, {
    DB: d1,
    APP_ENV: "production",
    IDENTITY_PROTECTION_MODE: "dual_write",
    IDENTITY_KEYRING: PASSWORD_RESET_KEYRING,
    TURNSTILE_SECRET_KEY: "private-local",
    RESEND_API_KEY: "resend-server-secret",
    EMAIL_FROM: "JURO <security@juro.uz>",
  });
  const providerRecipients: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.resend.com/emails");
    const payload = JSON.parse(String(init?.body)) as { to?: string[] };
    providerRecipients.push(payload.to?.[0] ?? "");
    return Response.json({ id: "resend_registration_confirmation" });
  };

  const send = (requestEmail: string, requestPassword: string, ip: string) =>
    requestOtp(new Request("http://localhost:3000/api/auth/request-otp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "sec-fetch-site": "same-origin",
        "x-juro-csrf": "1",
        "x-juro-client-ip": ip,
      },
      body: JSON.stringify({
        purpose: "registration_resend",
        email: requestEmail,
        locale: "en",
        accountType: "individual",
        password: requestPassword,
        acceptTerms: true,
        acceptPrivacy: true,
        acceptPersonalData: true,
        turnstileToken: "private-local",
      }),
    }));

  try {
    const delivered = await send(email, password, "203.0.113.81");
    assert.equal(delivered.status, 200);
    const deliveredBody = await delivered.json() as Record<string, unknown>;
    assert.equal(deliveredBody.ok, true);
    assert.match(String(deliveredBody.challengeId), /^[0-9a-f-]{36}$/u);
    assert.deepEqual(providerRecipients, [email]);
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT purpose,account_type AS accountType FROM auth_otp_challenges WHERE id=?",
      ).get(String(deliveredBody.challengeId)) },
      { purpose: "register", accountType: "lawyer" },
    );
    assert.equal(
      (sqlite.prepare("SELECT full_name AS fullName FROM user_profiles WHERE id=?").get(userId) as { fullName: string }).fullName,
      "Original Name",
      "resend must not overwrite an existing profile",
    );

    sqlite.prepare(
      `UPDATE auth_pending_registrations
       SET created_at=?,updated_at=?,expires_at=? WHERE user_id=?`,
    ).run(
      new Date(now.getTime() - 48 * 60 * 60 * 1_000).toISOString(),
      new Date(now.getTime() - 48 * 60 * 60 * 1_000).toISOString(),
      new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString(),
      userId,
    );
    const expiredPending = await send(
      email,
      password,
      "203.0.113.84",
    );
    assert.equal(expiredPending.status, 409);
    assert.deepEqual(await expiredPending.json(), {
      code: "REGISTRATION_RESTART_REQUIRED",
      accountType: "lawyer",
      error: "Your registration session expired. Continue registration again and your existing account will be updated safely.",
    });
    assert.deepEqual(
      providerRecipients,
      [email],
      "an expired pending-registration marker must not emit a false-success email",
    );

    const wrongPassword = await send(
      email,
      "definitely the wrong passphrase",
      "203.0.113.82",
    );
    const missingAccount = await send(
      "missing-registration-resend@example.test",
      "definitely the wrong passphrase",
      "203.0.113.83",
    );
    assert.equal(wrongPassword.status, 200);
    assert.equal(missingAccount.status, 200);
    const wrongBody = await wrongPassword.json() as Record<string, unknown>;
    const missingBody = await missingAccount.json() as Record<string, unknown>;
    assert.deepEqual(Object.keys(wrongBody).sort(), Object.keys(missingBody).sort());
    assert.equal(wrongBody.ok, true);
    assert.equal(missingBody.ok, true);
    assert.match(String(wrongBody.challengeId), /^[0-9a-f-]{36}$/u);
    assert.match(String(missingBody.challengeId), /^[0-9a-f-]{36}$/u);
    assert.deepEqual(providerRecipients, [email]);
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM user_profiles").get() as { total: number }).total,
      1,
      "resend must never create a second account",
    );
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
