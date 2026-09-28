import { randomToken, sha256 } from "./crypto";
import type { SecurityEventGuard } from "./security-events";

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;
export const PASSWORD_PBKDF2_ITERATIONS = 600_000;
const LEGACY_PASSWORD_PBKDF2_ITERATIONS = 100_000;

export type PasswordCredential = {
  userId: string;
  algorithm: "PBKDF2-SHA256";
  iterations: number;
  saltBase64url: string;
  hashBase64url: string;
  passwordChangedAt: string;
};

export type PreparedPasswordCredential = Omit<
  PasswordCredential,
  "userId"
> & { createdAt: string; updatedAt: string };

export type PasswordValidation =
  | { ok: true }
  | { ok: false; code: "PASSWORD_TOO_SHORT" | "PASSWORD_TOO_LONG" };

const encoder = new TextEncoder();

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function base64urlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function base64urlDecode(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) return null;
  try {
    const padded = value.replaceAll("-", "+").replaceAll("_", "/")
      .padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  } catch {
    return null;
  }
}

export function validatePassword(password: string): PasswordValidation {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, code: "PASSWORD_TOO_SHORT" };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, code: "PASSWORD_TOO_LONG" };
  }
  return { ok: true };
}

async function derivePasswordHash(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function constantTimeEqual(
  expected: Uint8Array,
  candidate: Uint8Array,
): Promise<boolean> {
  if (expected.byteLength !== candidate.byteLength) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(crypto.getRandomValues(new Uint8Array(32))),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    toArrayBuffer(expected),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    toArrayBuffer(candidate),
  );
}

export async function hashPassword(password: string): Promise<{
  algorithm: "PBKDF2-SHA256";
  iterations: number;
  saltBase64url: string;
  hashBase64url: string;
}> {
  const validation = validatePassword(password);
  if (!validation.ok) throw new RangeError(validation.code);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(
    password,
    salt,
    PASSWORD_PBKDF2_ITERATIONS,
  );
  return {
    algorithm: "PBKDF2-SHA256",
    iterations: PASSWORD_PBKDF2_ITERATIONS,
    saltBase64url: base64urlEncode(salt),
    hashBase64url: base64urlEncode(hash),
  };
}

export async function preparePasswordCredential(
  password: string,
  now = new Date(),
): Promise<PreparedPasswordCredential> {
  const hashed = await hashPassword(password);
  const timestamp = now.toISOString();
  return {
    ...hashed,
    passwordChangedAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function passwordCredentialWriteStatement(
  db: D1Database,
  userId: string,
  credential: PreparedPasswordCredential,
  guard?: SecurityEventGuard,
): D1PreparedStatement {
  if (
    guard
    && (!/^\s*SELECT\b/iu.test(guard.selectSql) || guard.selectSql.includes(";"))
  ) {
    throw new Error("INVALID_PASSWORD_CREDENTIAL_GUARD");
  }
  const columns = `user_id,algorithm,iterations,salt_base64url,hash_base64url,
       password_changed_at,created_at,updated_at`;
  const values = [
    userId,
    credential.algorithm,
    credential.iterations,
    credential.saltBase64url,
    credential.hashBase64url,
    credential.passwordChangedAt,
    credential.createdAt,
    credential.updatedAt,
  ];
  if (!guard) {
    return db.prepare(
      `INSERT INTO user_password_credentials (
       ${columns}
     ) VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET
       algorithm=excluded.algorithm,
       iterations=excluded.iterations,
       salt_base64url=excluded.salt_base64url,
       hash_base64url=excluded.hash_base64url,
       password_changed_at=excluded.password_changed_at,
       updated_at=excluded.updated_at`,
    ).bind(...values);
  }
  return db.prepare(
    `INSERT INTO user_password_credentials (
       ${columns}
     )
     SELECT ?,?,?,?,?,?,?,?
     WHERE EXISTS (${guard.selectSql})
     ON CONFLICT(user_id) DO UPDATE SET
       algorithm=excluded.algorithm,
       iterations=excluded.iterations,
       salt_base64url=excluded.salt_base64url,
       hash_base64url=excluded.hash_base64url,
       password_changed_at=excluded.password_changed_at,
       updated_at=excluded.updated_at
     WHERE EXISTS (${guard.selectSql})`,
  ).bind(
    ...values,
    ...guard.bindings,
    ...guard.bindings,
  );
}

const DUMMY_PASSWORD_CREDENTIAL = {
  algorithm: "PBKDF2-SHA256",
  iterations: PASSWORD_PBKDF2_ITERATIONS,
  saltBase64url: "AAAAAAAAAAAAAAAAAAAAAA",
  hashBase64url: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
} as const;

export async function verifyPassword(
  password: string,
  credential: Pick<
    PasswordCredential,
    "algorithm" | "iterations" | "saltBase64url" | "hashBase64url"
  > | null,
): Promise<boolean> {
  const selected = credential ?? DUMMY_PASSWORD_CREDENTIAL;
  const salt = base64urlDecode(selected.saltBase64url);
  const expected = base64urlDecode(selected.hashBase64url);
  if (
    selected.algorithm !== "PBKDF2-SHA256"
    || !Number.isSafeInteger(selected.iterations)
    || (selected.iterations !== LEGACY_PASSWORD_PBKDF2_ITERATIONS && selected.iterations < 310_000)
    || selected.iterations > 1_000_000
    || salt?.byteLength !== 16
    || expected?.byteLength !== 32
  ) {
    return false;
  }
  const candidate = await derivePasswordHash(
    password,
    salt,
    selected.iterations,
  );
  return Boolean(credential) && await constantTimeEqual(expected, candidate);
}

export async function passwordCredentialForUser(
  db: D1Database,
  userId: string,
): Promise<PasswordCredential | null> {
  return db.prepare(
    `SELECT user_id AS userId,algorithm,iterations,
       salt_base64url AS saltBase64url,hash_base64url AS hashBase64url,
       password_changed_at AS passwordChangedAt
     FROM user_password_credentials WHERE user_id=? LIMIT 1`,
  ).bind(userId).first<PasswordCredential>();
}

/** Call only after password verification. Compare-and-swap prevents a concurrent
 * reset from being overwritten or used to continue a legacy password login. */
export async function upgradeVerifiedLegacyPassword(
  db: D1Database, password: string, credential: PasswordCredential, now = new Date(),
): Promise<boolean> {
  if (credential.iterations !== LEGACY_PASSWORD_PBKDF2_ITERATIONS) return true;
  const replacement = await hashPassword(password);
  const result = await db.prepare(
    `UPDATE user_password_credentials SET iterations=?,salt_base64url=?,hash_base64url=?,updated_at=?
     WHERE user_id=? AND algorithm=? AND iterations=? AND salt_base64url=? AND hash_base64url=? AND password_changed_at=?`,
  ).bind(replacement.iterations, replacement.saltBase64url, replacement.hashBase64url, now.toISOString(),
    credential.userId, credential.algorithm, credential.iterations, credential.saltBase64url,
    credential.hashBase64url, credential.passwordChangedAt).run();
  return Number(result.meta.changes) === 1;
}

export async function savePasswordCredential(
  db: D1Database,
  input: { userId: string; password: string; now?: Date },
): Promise<void> {
  const credential = await preparePasswordCredential(
    input.password,
    input.now,
  );
  await passwordCredentialWriteStatement(db, input.userId, credential).run();
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const EMAIL_FAILURE_LIMIT = 5;
const IP_FAILURE_LIMIT = 20;
export const MFA_USER_FAILURE_LIMIT = 5;
export const MFA_IP_FAILURE_LIMIT = 20;

async function rateLimitKey(kind: "email" | "ip", value: string): Promise<string> {
  return sha256(`password-login:${kind}:${value}`);
}

async function mfaRateLimitKey(
  kind: "user" | "ip",
  value: string,
): Promise<string> {
  return sha256(`mfa-verification:${kind}:${value}`);
}

async function activeRateLimit(
  db: D1Database,
  scopeKey: string,
  now: Date,
): Promise<number> {
  const row = await db.prepare(
    `SELECT locked_until AS lockedUntil,window_started_at AS windowStartedAt
     FROM auth_password_rate_limits WHERE scope_key=? LIMIT 1`,
  ).bind(scopeKey).first<{
    lockedUntil: string | null;
    windowStartedAt: string;
  }>();
  if (!row) return 0;
  const lockedUntil = row.lockedUntil ? Date.parse(row.lockedUntil) : Number.NaN;
  if (Number.isFinite(lockedUntil) && lockedUntil > now.getTime()) {
    return Math.max(1, Math.ceil((lockedUntil - now.getTime()) / 1_000));
  }
  if (Date.parse(row.windowStartedAt) <= now.getTime() - RATE_LIMIT_WINDOW_MS) {
    return 0;
  }
  return 0;
}

export async function passwordLoginRateLimit(
  db: D1Database,
  input: { email: string; requestIp: string | null; now?: Date },
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const now = input.now ?? new Date();
  const keys = [
    await rateLimitKey("email", input.email),
    ...(input.requestIp ? [await rateLimitKey("ip", input.requestIp)] : []),
  ];
  const delays = await Promise.all(keys.map(key => activeRateLimit(db, key, now)));
  const retryAfterSeconds = Math.max(0, ...delays);
  return retryAfterSeconds > 0
    ? { allowed: false, retryAfterSeconds }
    : { allowed: true };
}

type PasswordLoginScopeReservation = {
  id: string;
  scopeKey: string;
  kind: "email" | "ip";
};

export type PasswordLoginAttemptReservation = {
  email: PasswordLoginScopeReservation;
  ip: PasswordLoginScopeReservation | null;
};

function passwordLoginReservationStatement(
  db: D1Database,
  input: PasswordLoginScopeReservation & {
    limit: number;
    now: Date;
  },
): D1PreparedStatement {
  const timestamp = input.now.toISOString();
  const cutoff = new Date(
    input.now.getTime() - RATE_LIMIT_WINDOW_MS,
  ).toISOString();
  const expiresAt = new Date(input.now.getTime() + 2 * 60 * 1_000)
    .toISOString();
  return db.prepare(
    `INSERT INTO auth_password_attempt_reservations (
       id,scope_key,scope_kind,expires_at,created_at
     )
     SELECT ?,?,?,?,?
     WHERE NOT EXISTS (
       SELECT 1 FROM auth_password_rate_limits
       WHERE scope_key=? AND locked_until>?
     )
       AND (
         coalesce((
           SELECT CASE WHEN window_started_at>? THEN failure_count ELSE 0 END
           FROM auth_password_rate_limits WHERE scope_key=?
         ),0)
         + (
           SELECT count(*) FROM auth_password_attempt_reservations
           WHERE scope_key=? AND expires_at>?
         )
       ) < ?`,
  ).bind(
    input.id,
    input.scopeKey,
    input.kind,
    expiresAt,
    timestamp,
    input.scopeKey,
    timestamp,
    cutoff,
    input.scopeKey,
    input.scopeKey,
    timestamp,
    input.limit,
  );
}

function releasePasswordLoginScopeStatement(
  db: D1Database,
  reservation: PasswordLoginScopeReservation,
): D1PreparedStatement {
  return db.prepare(
    `DELETE FROM auth_password_attempt_reservations
     WHERE id=? AND scope_key=? AND scope_kind=?`,
  ).bind(reservation.id, reservation.scopeKey, reservation.kind);
}

/**
 * Atomically reserves both account and source-IP budgets after Turnstile has
 * succeeded. Each request owns independent short-lived leases, so parallel
 * successes and partial denials can be finalized without aggregate races.
 */
export async function reservePasswordLoginAttempt(
  db: D1Database,
  input: { email: string; requestIp: string | null; now?: Date },
): Promise<
  | { allowed: true; reservation: PasswordLoginAttemptReservation }
  | { allowed: false; retryAfterSeconds: number }
> {
  const now = input.now ?? new Date();
  const reservation: PasswordLoginAttemptReservation = {
    email: {
      id: crypto.randomUUID(),
      scopeKey: await rateLimitKey("email", input.email),
      kind: "email",
    },
    ip: input.requestIp
      ? {
          id: crypto.randomUUID(),
          scopeKey: await rateLimitKey("ip", input.requestIp),
          kind: "ip",
        }
      : null,
  };
  const scopes = [
    {
      ...reservation.email,
      limit: EMAIL_FAILURE_LIMIT,
    },
    ...(reservation.ip
      ? [{
          ...reservation.ip,
          limit: IP_FAILURE_LIMIT,
        }]
      : []),
  ];
  const results = await db.batch([
    db.prepare(
      "DELETE FROM auth_password_attempt_reservations WHERE expires_at<=?",
    ).bind(now.toISOString()),
    ...scopes.map(scope =>
      passwordLoginReservationStatement(db, { ...scope, now })
    ),
  ]);
  const owned = scopes.map((_, index) =>
    Number(results[index + 1]?.meta?.changes ?? 0) === 1
  );
  if (owned.every(Boolean)) return { allowed: true, reservation };

  const releases = scopes.flatMap((scope, index) =>
    owned[index]
      ? [releasePasswordLoginScopeStatement(db, scope)]
      : []
  );
  if (releases.length > 0) await db.batch(releases);
  const active = await passwordLoginRateLimit(db, { ...input, now });
  return {
    allowed: false,
    retryAfterSeconds: active.allowed ? 1 : active.retryAfterSeconds,
  };
}

export async function completePasswordLoginAttempt(
  db: D1Database,
  reservation: PasswordLoginAttemptReservation,
): Promise<void> {
  const statements = [
    db.prepare("DELETE FROM auth_password_rate_limits WHERE scope_key=?")
      .bind(reservation.email.scopeKey),
    releasePasswordLoginScopeStatement(db, reservation.email),
    ...(reservation.ip
      ? [releasePasswordLoginScopeStatement(db, reservation.ip)]
      : []),
  ];
  await db.batch(statements);
}

export async function failPasswordLoginAttempt(
  db: D1Database,
  reservation: PasswordLoginAttemptReservation,
  now = new Date(),
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    failureStatement(db, {
      scopeKey: reservation.email.scopeKey,
      limit: EMAIL_FAILURE_LIMIT,
      progressiveThreshold: 3,
      now,
    }),
  ];
  if (reservation.ip) {
    statements.push(failureStatement(db, {
      scopeKey: reservation.ip.scopeKey,
      limit: IP_FAILURE_LIMIT,
      progressiveThreshold: 10,
      now,
    }));
  }
  statements.push(releasePasswordLoginScopeStatement(db, reservation.email));
  if (reservation.ip) {
    statements.push(releasePasswordLoginScopeStatement(db, reservation.ip));
  }
  await db.batch(statements);
}

function failureStatement(
  db: D1Database,
  input: {
    scopeKey: string;
    limit: number;
    progressiveThreshold: number;
    now: Date;
    guard?: SecurityEventGuard;
  },
): D1PreparedStatement {
  if (
    input.guard
    && (!/^\s*SELECT\b/iu.test(input.guard.selectSql)
      || input.guard.selectSql.includes(";"))
  ) {
    throw new Error("INVALID_RATE_LIMIT_FAILURE_GUARD");
  }
  const now = input.now.toISOString();
  const cutoff = new Date(input.now.getTime() - RATE_LIMIT_WINDOW_MS).toISOString();
  const hardLock = new Date(input.now.getTime() + RATE_LIMIT_WINDOW_MS).toISOString();
  const shortLock = new Date(input.now.getTime() + 5_000).toISOString();
  const insert = input.guard
    ? `SELECT ?,1,?,NULL,? WHERE EXISTS (${input.guard.selectSql})`
    : "VALUES (?,1,?,NULL,?)";
  return db.prepare(
    `INSERT INTO auth_password_rate_limits (
       scope_key,failure_count,window_started_at,locked_until,updated_at
     ) ${insert}
     ON CONFLICT(scope_key) DO UPDATE SET
       failure_count=CASE
         WHEN auth_password_rate_limits.window_started_at<=? THEN 1 ELSE auth_password_rate_limits.failure_count+1 END,
       window_started_at=CASE
         WHEN auth_password_rate_limits.window_started_at<=? THEN ? ELSE auth_password_rate_limits.window_started_at END,
       locked_until=CASE
         WHEN auth_password_rate_limits.window_started_at<=? THEN NULL
         WHEN auth_password_rate_limits.failure_count+1>=? THEN ?
         WHEN auth_password_rate_limits.failure_count+1>=? THEN ?
         ELSE NULL END,
       updated_at=?${
         input.guard ? ` WHERE EXISTS (${input.guard.selectSql})` : ""
       }`,
  ).bind(
    input.scopeKey,
    now,
    now,
    ...(input.guard?.bindings ?? []),
    cutoff,
    cutoff,
    now,
    cutoff,
    input.limit,
    hardLock,
    input.progressiveThreshold,
    shortLock,
    now,
    ...(input.guard?.bindings ?? []),
  );
}

export async function recordPasswordLoginFailure(
  db: D1Database,
  input: { email: string; requestIp: string | null; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const emailKey = await rateLimitKey("email", input.email);
  const statements = [failureStatement(db, {
    scopeKey: emailKey,
    limit: EMAIL_FAILURE_LIMIT,
    progressiveThreshold: 3,
    now,
  })];
  if (input.requestIp) {
    statements.push(failureStatement(db, {
      scopeKey: await rateLimitKey("ip", input.requestIp),
      limit: IP_FAILURE_LIMIT,
      progressiveThreshold: 10,
      now,
    }));
  }
  await db.batch(statements);
}

export async function passwordLoginFailureClearStatement(
  db: D1Database,
  input: {
    email: string;
    guard?: SecurityEventGuard;
  },
): Promise<D1PreparedStatement> {
  if (
    input.guard
    && (!/^\s*SELECT\b/iu.test(input.guard.selectSql)
      || input.guard.selectSql.includes(";"))
  ) {
    throw new Error("INVALID_PASSWORD_RATE_LIMIT_GUARD");
  }
  const key = await rateLimitKey("email", input.email);
  return db.prepare(
    `DELETE FROM auth_password_rate_limits WHERE scope_key=?${
      input.guard ? ` AND EXISTS (${input.guard.selectSql})` : ""
    }`,
  ).bind(key, ...(input.guard?.bindings ?? []));
}

export async function clearPasswordLoginFailures(
  db: D1Database,
  input: { email: string },
): Promise<void> {
  await (await passwordLoginFailureClearStatement(db, input)).run();
}

export async function mfaVerificationRateLimit(
  db: D1Database,
  input: { userId: string; requestIp: string | null; now?: Date },
): Promise<{ allowed: true } | { allowed: false; retryAfterSeconds: number }> {
  const now = input.now ?? new Date();
  const keys = [
    await mfaRateLimitKey("user", input.userId),
    ...(input.requestIp
      ? [await mfaRateLimitKey("ip", input.requestIp)]
      : []),
  ];
  const delays = await Promise.all(
    keys.map(key => activeRateLimit(db, key, now)),
  );
  const retryAfterSeconds = Math.max(0, ...delays);
  return retryAfterSeconds > 0
    ? { allowed: false, retryAfterSeconds }
    : { allowed: true };
}

export async function recordMfaVerificationFailure(
  db: D1Database,
  input: { userId: string; requestIp: string | null; now?: Date },
): Promise<void> {
  await db.batch(await mfaVerificationFailureStatements(db, input));
}

export async function mfaVerificationScopeKeys(input: {
  userId: string;
  requestIp: string | null;
}): Promise<{ user: string; ip: string | null }> {
  return {
    user: await mfaRateLimitKey("user", input.userId),
    ip: input.requestIp ? await mfaRateLimitKey("ip", input.requestIp) : null,
  };
}

export async function mfaVerificationFailureStatements(
  db: D1Database,
  input: {
    userId: string;
    requestIp: string | null;
    now?: Date;
    guard?: SecurityEventGuard;
  },
): Promise<D1PreparedStatement[]> {
  const now = input.now ?? new Date();
  const statements = [failureStatement(db, {
    scopeKey: await mfaRateLimitKey("user", input.userId),
    limit: MFA_USER_FAILURE_LIMIT,
    // The challenge already enforces five attempts; the durable user scope is
    // solely the cross-challenge lock and must not change per-attempt UX.
    progressiveThreshold: MFA_USER_FAILURE_LIMIT,
    now,
    guard: input.guard,
  })];
  if (input.requestIp) {
    statements.push(failureStatement(db, {
      scopeKey: await mfaRateLimitKey("ip", input.requestIp),
      limit: MFA_IP_FAILURE_LIMIT,
      progressiveThreshold: 10,
      now,
      guard: input.guard,
    }));
  }
  return statements;
}

export async function clearMfaVerificationFailures(
  db: D1Database,
  input: { userId: string },
): Promise<void> {
  await (await mfaVerificationFailureClearStatement(db, input)).run();
}

export async function mfaVerificationFailureClearStatement(
  db: D1Database,
  input: { userId: string; guard?: SecurityEventGuard },
): Promise<D1PreparedStatement> {
  if (
    input.guard
    && (!/^\s*SELECT\b/iu.test(input.guard.selectSql)
      || input.guard.selectSql.includes(";"))
  ) {
    throw new Error("INVALID_MFA_RATE_LIMIT_GUARD");
  }
  return db.prepare(
    `DELETE FROM auth_password_rate_limits WHERE scope_key=?${
      input.guard ? ` AND EXISTS (${input.guard.selectSql})` : ""
    }`,
  ).bind(
    await mfaRateLimitKey("user", input.userId),
    ...(input.guard?.bindings ?? []),
  );
}

/**
 * The current MFA schema binds a login challenge to a consumed primary-email
 * proof. Password authentication is a different primary factor, but creating
 * a short-lived, already-consumed bridge record lets existing MFA sessions
 * retain their replay and foreign-key guarantees until the schema can be
 * migrated without invalidating live five-minute challenges.
 */
export async function createPasswordMfaProof(
  db: D1Database,
  input: {
    email: string;
    locale: "ru" | "uz" | "en";
    accountType: "individual" | "entrepreneur" | "lawyer";
    now?: Date;
  },
): Promise<{ challengeId: string; emailHash: string }> {
  const now = input.now ?? new Date();
  const timestamp = now.toISOString();
  const challengeId = crypto.randomUUID();
  const emailHash = await sha256(input.email);
  const codeSalt = randomToken(16);
  const codeHash = await sha256(`${codeSalt}:password-primary`);
  await db.prepare(
    `INSERT INTO auth_otp_challenges (
       id,email,email_hash,purpose,locale,account_type,code_salt,code_hash,
       attempt_count,max_attempts,expires_at,consumed_at,created_at
     ) VALUES (?,?,?,?,?,?,?,?,0,1,?,?,?)`,
  ).bind(
    challengeId,
    input.email,
    emailHash,
    "login",
    input.locale,
    input.accountType,
    codeSalt,
    codeHash,
    new Date(now.getTime() + 5 * 60 * 1_000).toISOString(),
    timestamp,
    timestamp,
  ).run();
  return { challengeId, emailHash };
}
