import {
  generateBackupCodes,
  hashBackupCode,
  normalizeBackupCode,
} from "./backup-codes";
import { randomToken, sha256 } from "./crypto";
import {
  identityLookupHmac,
  type IdentityKeyring,
  protectIdentityValue,
  revealIdentityValue,
} from "./keyring";
import {
  createIdentityProtectionContext,
  resolveUserIdentity,
  USER_IDENTITY_SELECT,
  userIdByEmail,
  type IdentityProtectionContext,
  type UserIdentityRow,
} from "./identity-protection";
import { batchWithSecurityEvent } from "./security-events";
import {
  deviceContinuityEventMetadata,
  prepareDeviceContinuity,
} from "./device-continuity";
import {
  prepareAuthRequestSecurityEvidence,
  requestSecurityEventMetadata,
  type AuthRequestSecurityContext,
} from "./request-security-evidence";
import {
  guardedSessionInsertStatements,
  prepareLocalSessionCreation,
  type CreatedSession,
  type LocalSession,
  type SessionInsertGuard,
} from "./session-management";
import { prepareSessionTokenRotation } from "./session-rotation";
import { generateTotpSecret, verifyTotpCode } from "./totp";
import {
  MFA_IP_FAILURE_LIMIT,
  MFA_USER_FAILURE_LIMIT,
  mfaVerificationFailureStatements,
  mfaVerificationFailureClearStatement,
  mfaVerificationRateLimit,
  mfaVerificationScopeKeys,
} from "./password";

const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const MFA_ATTEMPT_RESERVATION_TTL_MS = 15 * 60 * 1_000;
const ENROLLMENT_TTL_MS = 10 * 60 * 1_000;
const BACKUP_CODE_COUNT = 10;
const USER_AGENT_MAX_CHARACTERS = 512;

export type MfaErrorCode =
  | "MFA_ALREADY_ENABLED"
  | "MFA_NOT_ENABLED"
  | "MFA_ENROLLMENT_NOT_FOUND"
  | "MFA_ENROLLMENT_EXPIRED"
  | "MFA_ENROLLMENT_LOCKED"
  | "MFA_CHALLENGE_INVALID"
  | "MFA_CHALLENGE_EXPIRED"
  | "MFA_CHALLENGE_USED"
  | "MFA_ATTEMPTS_EXCEEDED"
  | "MFA_RATE_LIMITED"
  | "MFA_CODE_INCORRECT"
  | "MFA_CODE_REPLAYED"
  | "LOCAL_SESSION_REQUIRED"
  | "SESSION_NOT_RECENT"
  | "MFA_STATE_CONFLICT";

export class MfaError extends Error {
  constructor(public readonly code: MfaErrorCode) {
    super(code);
    this.name = "MfaError";
  }
}

type TotpCredential = {
  id: string;
  userId: string;
  status: string;
  secretCiphertext: string;
  secretIv: string;
  keyVersion: string;
  algorithm: string;
  digits: number;
  periodSeconds: number;
  verificationAttemptCount: number;
  verificationMaxAttempts: number;
  lastUsedStep: number | null;
  backupBatchId: string | null;
  backupKeyVersion: string | null;
  enrollmentExpiresAt: string;
  verifiedAt: string | null;
};

type LoginChallenge = TotpCredential & {
  challengeId: string;
  tokenHash: string;
  emailOtpChallengeId: string;
  primaryAuthMethod: string;
  challengeAttemptCount: number;
  challengeMaxAttempts: number;
  challengeExpiresAt: string;
  challengeConsumedAt: string | null;
  challengeInvalidatedAt: string | null;
  requestUserAgentHmac: string | null;
  evidenceKeyVersion: string | null;
  locale: string;
  accountType: string;
  themePreference: string;
  onboardingCompletedAt: string | null;
};

type VerifiedFactor =
  | { factorType: "totp"; factorKey: string; matchedCounter: number }
  | { factorType: "backup_code"; factorKey: string; backupCodeId: string };

type MfaAttemptReservation = {
  id: string;
  challengeId: string;
  userId: string;
  userScopeKey: string;
  ipScopeKey: string | null;
  expiresAt: string;
};

function nowIso(now: Date): string {
  return now.toISOString();
}

function activeCredentialQuery(): string {
  return `SELECT
      id,user_id AS userId,status,
      secret_ciphertext AS secretCiphertext,secret_iv AS secretIv,
      key_version AS keyVersion,algorithm,digits,
      period_seconds AS periodSeconds,
      verification_attempt_count AS verificationAttemptCount,
      verification_max_attempts AS verificationMaxAttempts,
      last_used_step AS lastUsedStep,backup_batch_id AS backupBatchId,
      backup_key_version AS backupKeyVersion,
      enrollment_expires_at AS enrollmentExpiresAt,
      verified_at AS verifiedAt
    FROM auth_totp_credentials
    WHERE user_id=? AND status='active'
    LIMIT 1`;
}

async function activeCredential(
  db: D1Database,
  userId: string,
): Promise<TotpCredential | null> {
  return db.prepare(activeCredentialQuery())
    .bind(userId)
    .first<TotpCredential>();
}

export async function hasActiveMfa(
  db: D1Database,
  userId: string,
): Promise<boolean> {
  return Boolean(await db.prepare(
    `SELECT 1 FROM auth_totp_credentials
     WHERE user_id=? AND status='active' LIMIT 1`,
  ).bind(userId).first());
}

export async function userEmailHasActiveMfa(
  db: D1Database,
  email: string,
  identity: IdentityProtectionContext =
    createIdentityProtectionContext("legacy", null),
): Promise<boolean> {
  const userId = await userIdByEmail(db, identity, email);
  return userId ? hasActiveMfa(db, userId) : false;
}

export function requireRecentLocalSession(
  session: LocalSession | null,
  options: {
    now?: Date;
    maxAgeMs?: number;
    minimumAssurance?: "primary" | "mfa";
  } = {},
): LocalSession {
  if (!session) throw new MfaError("LOCAL_SESSION_REQUIRED");
  const authenticatedAt = session.authenticatedAt
    ? Date.parse(session.authenticatedAt)
    : Number.NaN;
  const now = (options.now ?? new Date()).getTime();
  const maxAgeMs = options.maxAgeMs ?? 10 * 60 * 1_000;
  if (
    !Number.isFinite(authenticatedAt)
    || authenticatedAt > now
    || now - authenticatedAt > maxAgeMs
  ) {
    throw new MfaError("SESSION_NOT_RECENT");
  }
  if (
    options.minimumAssurance === "mfa"
    && session.assuranceLevel !== "mfa"
  ) {
    throw new MfaError("SESSION_NOT_RECENT");
  }
  return session;
}

function normalizedUserAgent(userAgent: string | null): string | null {
  const normalized = userAgent?.trim().slice(0, USER_AGENT_MAX_CHARACTERS);
  return normalized || null;
}

async function userAgentEvidence(
  keyring: IdentityKeyring,
  userId: string,
  userAgent: string | null,
  keyVersion?: string,
): Promise<{ digest: string; keyVersion: string } | null> {
  const normalized = normalizedUserAgent(userAgent);
  if (!normalized) return null;
  return identityLookupHmac(
    keyring,
    normalized,
    `mfa-challenge-user-agent:${userId}`,
    keyVersion,
  );
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function secureDigestEqual(
  expected: string,
  candidate: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const candidateBytes = encoder.encode(candidate);
  if (expectedBytes.byteLength !== 43 || candidateBytes.byteLength !== 43) {
    return false;
  }
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
    toArrayBuffer(expectedBytes),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    toArrayBuffer(candidateBytes),
  );
}

function credentialProtection(credential: TotpCredential) {
  return {
    ciphertext: credential.secretCiphertext,
    iv: credential.secretIv,
    keyVersion: credential.keyVersion,
  };
}

function otpauthUri(email: string, secret: string): string {
  const issuer = "JURO";
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: "6",
    period: "30",
  });
  return `otpauth://totp/${encodeURIComponent(`${issuer}:${email}`)}?${query}`;
}

export async function mfaStatus(
  db: D1Database,
  userId: string,
): Promise<{
  enabled: boolean;
  verifiedAt: string | null;
  backupCodesRemaining: number;
}> {
  const row = await db.prepare(
    `SELECT t.verified_at AS verifiedAt,count(b.id) AS backupCodesRemaining
     FROM auth_totp_credentials t
     LEFT JOIN auth_backup_codes b
       ON b.credential_id=t.id AND b.batch_id=t.backup_batch_id
      AND b.used_at IS NULL AND b.revoked_at IS NULL
     WHERE t.user_id=? AND t.status='active'
     GROUP BY t.id,t.verified_at LIMIT 1`,
  ).bind(userId).first<{
    verifiedAt: string | null;
    backupCodesRemaining: number;
  }>();
  return row
    ? {
      enabled: true,
      verifiedAt: row.verifiedAt,
      backupCodesRemaining: Number(row.backupCodesRemaining),
    }
    : { enabled: false, verifiedAt: null, backupCodesRemaining: 0 };
}

export async function beginTotpEnrollment(
  db: D1Database,
  keyring: IdentityKeyring,
  input: {
    userId: string;
    sessionId: string;
    email: string;
    now?: Date;
  },
): Promise<{
  credentialId: string;
  secret: string;
  otpauthUri: string;
  expiresAt: string;
}> {
  if (await hasActiveMfa(db, input.userId)) {
    throw new MfaError("MFA_ALREADY_ENABLED");
  }
  const now = input.now ?? new Date();
  const createdAt = nowIso(now);
  const expiresAt = nowIso(new Date(now.getTime() + ENROLLMENT_TTL_MS));
  const credentialId = crypto.randomUUID();
  const secret = generateTotpSecret();
  const protectedSecret = await protectIdentityValue(keyring, secret, {
    purpose: "totp-secret",
    subjectId: input.userId,
    recordId: credentialId,
  });
  const results = await batchWithSecurityEvent(
    db,
    {
      userId: input.userId,
      sessionId: input.sessionId,
      eventType: "mfa.enrollment.started",
      authSource: "local_session",
      assuranceLevel: "primary",
      metadata: { credentialId, expiresAt },
      createdAt,
    },
    () => [
      db.prepare(
        `UPDATE auth_totp_credentials
         SET status='disabled',disabled_at=?,updated_at=?
         WHERE user_id=? AND status='pending'`,
      ).bind(createdAt, createdAt, input.userId),
      db.prepare(
        `INSERT INTO auth_totp_credentials (
           id,user_id,status,secret_ciphertext,secret_iv,key_version,
           algorithm,digits,period_seconds,verification_attempt_count,
           verification_max_attempts,enrollment_expires_at,created_at,updated_at
         )
         SELECT ?,?,'pending',?,?,?,'SHA1',6,30,0,5,?,?,?
         WHERE NOT EXISTS (
           SELECT 1 FROM auth_totp_credentials
           WHERE user_id=? AND status='active'
         )`,
      ).bind(
        credentialId,
        input.userId,
        protectedSecret.ciphertext,
        protectedSecret.iv,
        protectedSecret.keyVersion,
        expiresAt,
        createdAt,
        createdAt,
        input.userId,
      ),
    ],
    {
      selectSql: `SELECT 1 FROM auth_totp_credentials
        WHERE id=? AND user_id=? AND status='pending'`,
      bindings: [credentialId, input.userId],
    },
  );
  if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
    throw new MfaError("MFA_STATE_CONFLICT");
  }
  return {
    credentialId,
    secret,
    otpauthUri: otpauthUri(input.email, secret),
    expiresAt,
  };
}

async function pendingCredential(
  db: D1Database,
  userId: string,
  credentialId: string,
): Promise<TotpCredential | null> {
  return db.prepare(
    `SELECT
       id,user_id AS userId,status,
       secret_ciphertext AS secretCiphertext,secret_iv AS secretIv,
       key_version AS keyVersion,algorithm,digits,
       period_seconds AS periodSeconds,
       verification_attempt_count AS verificationAttemptCount,
       verification_max_attempts AS verificationMaxAttempts,
       last_used_step AS lastUsedStep,backup_batch_id AS backupBatchId,
       backup_key_version AS backupKeyVersion,
       enrollment_expires_at AS enrollmentExpiresAt,verified_at AS verifiedAt
     FROM auth_totp_credentials
     WHERE user_id=? AND id=? AND status='pending' LIMIT 1`,
  ).bind(userId, credentialId).first<TotpCredential>();
}

async function protectedSecretValue(
  keyring: IdentityKeyring,
  credential: TotpCredential,
): Promise<string> {
  return revealIdentityValue(
    keyring,
    credentialProtection(credential),
    {
      purpose: "totp-secret",
      subjectId: credential.userId,
      recordId: credential.id,
    },
  );
}

async function recordEnrollmentFailure(
  db: D1Database,
  credential: TotpCredential,
  sessionId: string,
  now: Date,
): Promise<void> {
  const timestamp = nowIso(now);
  await batchWithSecurityEvent(
    db,
    {
      userId: credential.userId,
      sessionId,
      eventType: "mfa.enrollment.failed",
      severity: "warning",
      authSource: "local_session",
      assuranceLevel: "primary",
      metadata: { credentialId: credential.id },
      createdAt: timestamp,
    },
    () => [
      db.prepare(
        `UPDATE auth_totp_credentials
         SET verification_attempt_count=verification_attempt_count+1,
             status=CASE
               WHEN verification_attempt_count+1>=verification_max_attempts
                 THEN 'disabled' ELSE status END,
             disabled_at=CASE
               WHEN verification_attempt_count+1>=verification_max_attempts
                 THEN ? ELSE disabled_at END,
             updated_at=?
         WHERE id=? AND user_id=? AND status='pending'
           AND verification_attempt_count<verification_max_attempts`,
      ).bind(timestamp, timestamp, credential.id, credential.userId),
    ],
    {
      selectSql: `SELECT 1 FROM auth_totp_credentials
        WHERE id=? AND user_id=? AND verification_attempt_count>?`,
      bindings: [
        credential.id,
        credential.userId,
        credential.verificationAttemptCount,
      ],
    },
  );
}

async function backupCodeRecords(
  keyring: IdentityKeyring,
  input: { userId: string; batchId: string },
): Promise<{
  displayCodes: string[];
  records: Array<{ id: string; digest: string; keyVersion: string }>;
}> {
  const displayCodes = generateBackupCodes(BACKUP_CODE_COUNT);
  const records = await Promise.all(displayCodes.map(async code => {
    const hashed = await hashBackupCode(keyring, { ...input, code });
    return {
      id: crypto.randomUUID(),
      digest: hashed.digest,
      keyVersion: hashed.keyVersion,
    };
  }));
  return { displayCodes, records };
}

function isFactorClaimConflict(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("auth_mfa_claims_operation_uidx")
    || message.includes("auth_mfa_claims_factor_uidx")
    || message.includes("UNIQUE constraint failed: auth_mfa_factor_claims");
}

export async function confirmTotpEnrollment(
  db: D1Database,
  keyring: IdentityKeyring,
  input: {
    userId: string;
    sessionId: string;
    currentToken: string;
    credentialId: string;
    code: string;
    now?: Date;
  },
): Promise<{
  backupCodes: string[];
  session: { token: string; expiresAt: string };
}> {
  const now = input.now ?? new Date();
  const timestamp = nowIso(now);
  const credential = await pendingCredential(
    db,
    input.userId,
    input.credentialId,
  );
  if (!credential) throw new MfaError("MFA_ENROLLMENT_NOT_FOUND");
  if (credential.verificationAttemptCount >= credential.verificationMaxAttempts) {
    throw new MfaError("MFA_ENROLLMENT_LOCKED");
  }
  if (credential.enrollmentExpiresAt <= timestamp) {
    await db.prepare(
      `UPDATE auth_totp_credentials SET status='disabled',
       disabled_at=?,updated_at=?
       WHERE id=? AND user_id=? AND status='pending'`,
    ).bind(timestamp, timestamp, credential.id, input.userId).run();
    throw new MfaError("MFA_ENROLLMENT_EXPIRED");
  }
  const match = await verifyTotpCode(
    await protectedSecretValue(keyring, credential),
    input.code,
    now,
  );
  if (!match) {
    await recordEnrollmentFailure(db, credential, input.sessionId, now);
    throw new MfaError(
      credential.verificationAttemptCount + 1
          >= credential.verificationMaxAttempts
        ? "MFA_ENROLLMENT_LOCKED"
        : "MFA_CODE_INCORRECT",
    );
  }

  const operationId = `enroll:${credential.id}`;
  const claimId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const backup = await backupCodeRecords(keyring, {
    userId: input.userId,
    batchId,
  });
  const rotation = await prepareSessionTokenRotation(db, {
    userId: input.userId,
    sessionId: input.sessionId,
    currentToken: input.currentToken,
    reason: "mfa_elevation",
    now,
  });
  if (!rotation) throw new MfaError("MFA_STATE_CONFLICT");
  const backupKeyVersion = backup.records[0].keyVersion;
  const statements: D1PreparedStatement[] = [
    db.prepare(
      `INSERT INTO auth_mfa_factor_claims (
         id,operation_id,credential_id,factor_type,factor_key,created_at
       )
       SELECT ?,?,id,'totp',?,?
       FROM auth_totp_credentials
       WHERE id=? AND user_id=? AND status='pending'
         AND enrollment_expires_at>?
         AND verification_attempt_count<verification_max_attempts
         AND EXISTS (
           SELECT 1 FROM auth_sessions
           WHERE id=? AND user_id=? AND token_hash=? AND revoked_at IS NULL
             AND expires_at>? AND coalesce(idle_expires_at,expires_at)>?
         )`,
    ).bind(
      claimId,
      operationId,
      String(match.matchedCounter),
      timestamp,
      credential.id,
      input.userId,
      timestamp,
      input.sessionId,
      input.userId,
      rotation.previousTokenHash,
      timestamp,
      timestamp,
    ),
    db.prepare(
      `UPDATE auth_totp_credentials
       SET status='active',verified_at=?,updated_at=?,
           last_used_step=?,backup_batch_id=?,backup_key_version=?
       WHERE id=? AND user_id=? AND status='pending'
         AND EXISTS (
           SELECT 1 FROM auth_mfa_factor_claims
           WHERE id=? AND operation_id=? AND credential_id=?
         )`,
    ).bind(
      timestamp,
      timestamp,
      match.matchedCounter,
      batchId,
      backupKeyVersion,
      credential.id,
      input.userId,
      claimId,
      operationId,
      credential.id,
    ),
  ];
  for (const record of backup.records) {
    statements.push(db.prepare(
      `INSERT INTO auth_backup_codes (
         id,credential_id,user_id,batch_id,code_hmac,key_version,created_at
       )
       SELECT ?,?,?,?,?,?,?
       WHERE EXISTS (
         SELECT 1 FROM auth_totp_credentials
         WHERE id=? AND user_id=? AND status='active' AND backup_batch_id=?
       )`,
    ).bind(
      record.id,
      credential.id,
      input.userId,
      batchId,
      record.digest,
      record.keyVersion,
      timestamp,
      credential.id,
      input.userId,
      batchId,
    ));
  }
  statements.push(
    db.prepare(
      `UPDATE auth_sessions SET revoked_at=?
       WHERE user_id=? AND id<>? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM auth_totp_credentials t
           JOIN auth_mfa_factor_claims c ON c.credential_id=t.id
           WHERE t.id=? AND t.user_id=? AND t.status='active'
             AND t.backup_batch_id=? AND c.id=? AND c.operation_id=?
         )`,
    ).bind(
      timestamp,
      input.userId,
      input.sessionId,
      credential.id,
      input.userId,
      batchId,
      claimId,
      operationId,
    ),
    rotation.historyStatement,
    rotation.rotationStatement,
    db.prepare(
      `UPDATE auth_sessions
       SET auth_method='email_otp+totp',assurance_level='mfa',
           mfa_verified_at=?
       WHERE id=? AND user_id=? AND token_hash=? AND revoked_at IS NULL
         AND EXISTS (
           SELECT 1 FROM auth_totp_credentials
           WHERE id=? AND status='active' AND backup_batch_id=?
         )`,
    ).bind(
      timestamp,
      input.sessionId,
      input.userId,
      rotation.tokenHash,
      credential.id,
      batchId,
    ),
  );
  let results: D1Result[];
  try {
    results = await batchWithSecurityEvent(
      db,
      {
        userId: input.userId,
        sessionId: input.sessionId,
        eventType: "mfa.enabled",
        authSource: "local_session",
        assuranceLevel: "mfa",
        metadata: {
          credentialId: credential.id,
          backupCodeCount: backup.records.length,
          sessionTokenRotated: true,
          tokenHistoryId: rotation.historyId,
        },
        createdAt: timestamp,
      },
      () => statements,
      {
        selectSql: `SELECT 1 FROM auth_totp_credentials
          WHERE id=? AND user_id=? AND status='active'
            AND backup_batch_id=?
            AND EXISTS (
              SELECT 1 FROM auth_sessions
              WHERE id=? AND user_id=? AND token_hash=?
                AND assurance_level='mfa' AND revoked_at IS NULL
            )`,
        bindings: [
          credential.id,
          input.userId,
          batchId,
          input.sessionId,
          input.userId,
          rotation.tokenHash,
        ],
      },
    );
  } catch (error) {
    if (isFactorClaimConflict(error)) {
      throw new MfaError("MFA_CODE_REPLAYED");
    }
    throw error;
  }
  const historyResult = results[2 + backup.records.length + 1];
  const rotationResult = results[2 + backup.records.length + 2];
  const currentSessionResult = results[2 + backup.records.length + 3];
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1
    || Number(results[1]?.meta?.changes ?? 0) !== 1
    || Number(historyResult?.meta?.changes ?? 0) !== 1
    || Number(rotationResult?.meta?.changes ?? 0) !== 1
    || Number(currentSessionResult?.meta?.changes ?? 0) !== 1
  ) {
    throw new MfaError("MFA_STATE_CONFLICT");
  }
  return {
    backupCodes: backup.displayCodes,
    session: { token: rotation.token, expiresAt: rotation.expiresAt },
  };
}

export async function createLoginMfaChallenge(
  db: D1Database,
  keyring: IdentityKeyring,
  input: {
    userId: string;
    emailHash: string;
    emailOtpChallengeId: string;
    primaryAuthMethod?: "email_otp" | "password" | "google";
    userAgent: string | null;
    now?: Date;
  },
): Promise<{ token: string; expiresAt: string }> {
  const credential = await activeCredential(db, input.userId);
  if (!credential) throw new MfaError("MFA_NOT_ENABLED");
  const now = input.now ?? new Date();
  const createdAt = nowIso(now);
  const expiresAt = nowIso(new Date(now.getTime() + MFA_CHALLENGE_TTL_MS));
  const challengeId = crypto.randomUUID();
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const evidence = await userAgentEvidence(
    keyring,
    input.userId,
    input.userAgent,
  );
  const results = await batchWithSecurityEvent(
    db,
    {
      userId: input.userId,
      eventType: "mfa.challenge.created",
      authSource: "local_session",
      assuranceLevel: "primary",
      metadata: { challengeId, purpose: "login" },
      createdAt,
    },
    () => [
      db.prepare(
        `UPDATE auth_mfa_challenges SET invalidated_at=?
         WHERE user_id=? AND purpose='login'
           AND consumed_at IS NULL AND invalidated_at IS NULL`,
      ).bind(createdAt, input.userId),
      db.prepare(
        `INSERT INTO auth_mfa_challenges (
           id,token_hash,user_id,credential_id,email_otp_challenge_id,
           primary_auth_method,purpose,attempt_count,max_attempts,request_user_agent_hmac,
           evidence_key_version,expires_at,created_at
         )
         SELECT ?,?,?,id,?,?,'login',0,5,?,?,?,?
         FROM auth_totp_credentials
         WHERE id=? AND user_id=? AND status='active'
           AND EXISTS (
             SELECT 1 FROM auth_otp_challenges
             WHERE id=? AND email_hash=? AND consumed_at IS NOT NULL
               AND invalidated_at IS NULL
           )`,
      ).bind(
        challengeId,
        tokenHash,
        input.userId,
        input.emailOtpChallengeId,
        input.primaryAuthMethod ?? "email_otp",
        evidence?.digest ?? null,
        evidence?.keyVersion ?? null,
        expiresAt,
        createdAt,
        credential.id,
        input.userId,
        input.emailOtpChallengeId,
        input.emailHash,
      ),
    ],
    {
      selectSql: `SELECT 1 FROM auth_mfa_challenges
        WHERE id=? AND user_id=? AND invalidated_at IS NULL`,
      bindings: [challengeId, input.userId],
    },
  );
  if (Number(results[1]?.meta?.changes ?? 0) !== 1) {
    throw new MfaError("MFA_STATE_CONFLICT");
  }
  return { token, expiresAt };
}

async function challengeFromToken(
  db: D1Database,
  token: string,
): Promise<LoginChallenge | null> {
  return db.prepare(
    `SELECT
       c.id AS challengeId,c.token_hash AS tokenHash,
       c.email_otp_challenge_id AS emailOtpChallengeId,
       c.primary_auth_method AS primaryAuthMethod,
       c.attempt_count AS challengeAttemptCount,
       c.max_attempts AS challengeMaxAttempts,
       c.expires_at AS challengeExpiresAt,
       c.consumed_at AS challengeConsumedAt,
       c.invalidated_at AS challengeInvalidatedAt,
       c.request_user_agent_hmac AS requestUserAgentHmac,
       c.evidence_key_version AS evidenceKeyVersion,
       t.id,t.user_id AS userId,t.status,
       t.secret_ciphertext AS secretCiphertext,t.secret_iv AS secretIv,
       t.key_version AS keyVersion,t.algorithm,t.digits,
       t.period_seconds AS periodSeconds,
       t.verification_attempt_count AS verificationAttemptCount,
       t.verification_max_attempts AS verificationMaxAttempts,
       t.last_used_step AS lastUsedStep,
       t.backup_batch_id AS backupBatchId,
       t.backup_key_version AS backupKeyVersion,
       t.enrollment_expires_at AS enrollmentExpiresAt,
       t.verified_at AS verifiedAt,
       otp.locale,u.account_type AS accountType,
       u.theme_preference AS themePreference,
       u.onboarding_completed_at AS onboardingCompletedAt
     FROM auth_mfa_challenges c
     JOIN auth_totp_credentials t ON t.id=c.credential_id
     JOIN auth_otp_challenges otp ON otp.id=c.email_otp_challenge_id
     JOIN user_profiles u ON u.id=c.user_id
     WHERE c.token_hash=? LIMIT 1`,
  ).bind(await sha256(token)).first<LoginChallenge>();
}

async function reserveMfaAttempt(
  db: D1Database,
  challenge: LoginChallenge,
  requestIp: string | null,
  now: Date,
): Promise<MfaAttemptReservation | null> {
  const timestamp = nowIso(now);
  const cutoff = new Date(
    now.getTime() - MFA_ATTEMPT_RESERVATION_TTL_MS,
  ).toISOString();
  const scopes = await mfaVerificationScopeKeys({
    userId: challenge.userId,
    requestIp,
  });
  const reservation = {
    id: crypto.randomUUID(),
    challengeId: challenge.challengeId,
    userId: challenge.userId,
    userScopeKey: scopes.user,
    ipScopeKey: scopes.ip,
    expiresAt: new Date(
      now.getTime() + MFA_ATTEMPT_RESERVATION_TTL_MS,
    ).toISOString(),
  } satisfies MfaAttemptReservation;
  const results = await db.batch([
    db.prepare(
      "DELETE FROM auth_mfa_attempt_reservations WHERE expires_at<=?",
    ).bind(timestamp),
    db.prepare(
      `INSERT INTO auth_mfa_attempt_reservations (
         id,challenge_id,user_scope_key,ip_scope_key,expires_at,created_at
       )
       SELECT ?,?,?,?,?,?
       WHERE EXISTS (
         SELECT 1
         FROM auth_mfa_challenges c
         JOIN auth_totp_credentials t
           ON t.id=c.credential_id AND t.status='active'
         WHERE c.id=? AND c.user_id=? AND c.credential_id=?
           AND c.consumed_at IS NULL AND c.invalidated_at IS NULL
           AND c.expires_at>? AND c.attempt_count<c.max_attempts
           AND c.attempt_count + (
             SELECT count(*) FROM auth_mfa_attempt_reservations pending
             WHERE pending.challenge_id=c.id
               AND pending.failure_claim_nonce IS NULL
               AND pending.expires_at>?
           ) < c.max_attempts
       )
         AND NOT EXISTS (
           SELECT 1 FROM auth_password_rate_limits
           WHERE scope_key=? AND locked_until>?
         )
         AND (
           coalesce((
             SELECT CASE WHEN window_started_at>? THEN failure_count ELSE 0 END
             FROM auth_password_rate_limits WHERE scope_key=?
           ),0)
           + (
             SELECT count(*) FROM auth_mfa_attempt_reservations pending
             WHERE pending.user_scope_key=?
               AND pending.failure_claim_nonce IS NULL
               AND pending.expires_at>?
           )
         ) < ?
         AND (? IS NULL OR (
           NOT EXISTS (
             SELECT 1 FROM auth_password_rate_limits
             WHERE scope_key=? AND locked_until>?
           )
           AND (
             coalesce((
               SELECT CASE WHEN window_started_at>? THEN failure_count ELSE 0 END
               FROM auth_password_rate_limits WHERE scope_key=?
             ),0)
             + (
               SELECT count(*) FROM auth_mfa_attempt_reservations pending
               WHERE pending.ip_scope_key=?
                 AND pending.failure_claim_nonce IS NULL
                 AND pending.expires_at>?
             )
           ) < ?
         ))`,
    ).bind(
      reservation.id,
      reservation.challengeId,
      reservation.userScopeKey,
      reservation.ipScopeKey,
      reservation.expiresAt,
      timestamp,
      challenge.challengeId,
      challenge.userId,
      challenge.id,
      timestamp,
      timestamp,
      reservation.userScopeKey,
      timestamp,
      cutoff,
      reservation.userScopeKey,
      reservation.userScopeKey,
      timestamp,
      MFA_USER_FAILURE_LIMIT,
      reservation.ipScopeKey,
      reservation.ipScopeKey,
      timestamp,
      cutoff,
      reservation.ipScopeKey,
      reservation.ipScopeKey,
      timestamp,
      MFA_IP_FAILURE_LIMIT,
    ),
  ]);
  return Number(results[1]?.meta?.changes ?? 0) === 1 ? reservation : null;
}

async function mfaReservationDenialError(
  db: D1Database,
  token: string,
  now: Date,
): Promise<MfaError> {
  const timestamp = nowIso(now);
  const challenge = await challengeFromToken(db, token);
  if (!challenge || challenge.status !== "active") {
    return new MfaError("MFA_CHALLENGE_INVALID");
  }
  if (challenge.challengeConsumedAt) {
    return new MfaError("MFA_CHALLENGE_USED");
  }
  if (challenge.challengeExpiresAt <= timestamp) {
    return new MfaError("MFA_CHALLENGE_EXPIRED");
  }
  if (challenge.challengeInvalidatedAt) {
    return new MfaError(
      challenge.challengeAttemptCount >= challenge.challengeMaxAttempts
        ? "MFA_ATTEMPTS_EXCEEDED"
        : "MFA_CHALLENGE_INVALID",
    );
  }
  const pending = await db.prepare(
    `SELECT count(*) AS value FROM auth_mfa_attempt_reservations
     WHERE challenge_id=? AND failure_claim_nonce IS NULL AND expires_at>?`,
  ).bind(challenge.challengeId, timestamp).first<{ value: number }>();
  return new MfaError(
    challenge.challengeAttemptCount + Number(pending?.value ?? 0)
        >= challenge.challengeMaxAttempts
      ? "MFA_ATTEMPTS_EXCEEDED"
      : "MFA_RATE_LIMITED",
  );
}

function activeMfaAttemptGuard(
  reservation: MfaAttemptReservation,
  now: Date,
): SessionInsertGuard {
  return {
    selectSql: `SELECT 1 FROM auth_mfa_attempt_reservations
      WHERE id=? AND challenge_id=? AND user_scope_key=?
        AND ip_scope_key IS ? AND failure_claim_nonce IS NULL
        AND expires_at>?`,
    bindings: [
      reservation.id,
      reservation.challengeId,
      reservation.userScopeKey,
      reservation.ipScopeKey,
      nowIso(now),
    ],
  };
}

function releaseMfaAttemptStatement(
  db: D1Database,
  reservation: MfaAttemptReservation,
): D1PreparedStatement {
  return db.prepare(
    `DELETE FROM auth_mfa_attempt_reservations
     WHERE id=? AND challenge_id=? AND user_scope_key=? AND ip_scope_key IS ?`,
  ).bind(
    reservation.id,
    reservation.challengeId,
    reservation.userScopeKey,
    reservation.ipScopeKey,
  );
}

async function releaseMfaAttempt(
  db: D1Database,
  reservation: MfaAttemptReservation,
): Promise<void> {
  try {
    await releaseMfaAttemptStatement(db, reservation).run();
  } catch {
    // The expiring lease is fail-secure; cleanup must not mask the auth result.
  }
}

async function recordChallengeFailure(
  db: D1Database,
  challenge: LoginChallenge,
  reservation: MfaAttemptReservation,
  requestIp: string | null,
  now: Date,
  reason: "code" | "user_agent",
): Promise<{ recorded: boolean; attemptsExceeded: boolean }> {
  const timestamp = nowIso(now);
  const failureClaimNonce = crypto.randomUUID();
  const claimedGuard = {
    selectSql: `SELECT 1 FROM auth_mfa_attempt_reservations
      WHERE id=? AND challenge_id=? AND user_scope_key=?
        AND ip_scope_key IS ? AND failure_claim_nonce=?
        AND failure_claimed_at=?`,
    bindings: [
      reservation.id,
      reservation.challengeId,
      reservation.userScopeKey,
      reservation.ipScopeKey,
      failureClaimNonce,
      timestamp,
    ],
  } satisfies SessionInsertGuard;
  const rateLimitStatements = await mfaVerificationFailureStatements(db, {
    userId: challenge.userId,
    requestIp,
    now,
    guard: claimedGuard,
  });
  const results = await batchWithSecurityEvent(
    db,
    {
      userId: challenge.userId,
      eventType: "mfa.challenge.failed",
      severity: "warning",
      authSource: "local_session",
      assuranceLevel: "primary",
      metadata: { challengeId: challenge.challengeId, reason },
      createdAt: timestamp,
    },
    () => [
      db.prepare(
        `UPDATE auth_mfa_attempt_reservations
         SET failure_claim_nonce=?,failure_claimed_at=?
         WHERE id=? AND challenge_id=? AND user_scope_key=?
           AND ip_scope_key IS ? AND failure_claim_nonce IS NULL
           AND failure_claimed_at IS NULL
           AND expires_at>?
           AND EXISTS (
             SELECT 1
             FROM auth_mfa_challenges c
             JOIN auth_totp_credentials t
               ON t.id=c.credential_id AND t.status='active'
             WHERE c.id=? AND c.user_id=? AND c.credential_id=?
               AND c.consumed_at IS NULL AND c.invalidated_at IS NULL
               AND c.expires_at>? AND c.attempt_count<c.max_attempts
           )`,
      ).bind(
        failureClaimNonce,
        timestamp,
        reservation.id,
        reservation.challengeId,
        reservation.userScopeKey,
        reservation.ipScopeKey,
        timestamp,
        challenge.challengeId,
        challenge.userId,
        challenge.id,
        timestamp,
      ),
      db.prepare(
        `UPDATE auth_mfa_challenges
         SET attempt_count=attempt_count+1,
             invalidated_at=CASE
               WHEN attempt_count+1>=max_attempts THEN ?
               ELSE invalidated_at END
         WHERE id=? AND user_id=?
           AND consumed_at IS NULL AND invalidated_at IS NULL
           AND expires_at>? AND attempt_count<max_attempts
           AND EXISTS (${claimedGuard.selectSql})
         RETURNING attempt_count AS attemptCount,max_attempts AS maxAttempts`,
      ).bind(
        timestamp,
        challenge.challengeId,
        challenge.userId,
        timestamp,
        ...claimedGuard.bindings,
      ),
      ...rateLimitStatements,
    ],
    claimedGuard,
  );
  await releaseMfaAttempt(db, reservation);
  const challengeResult = results[1] as D1Result<{
    attemptCount: number;
    maxAttempts: number;
  }> | undefined;
  const row = challengeResult?.results?.[0];
  const recorded = Number(results[0]?.meta?.changes ?? 0) === 1
    && Number(challengeResult?.meta?.changes ?? 0) === 1
    && Boolean(row);
  return {
    recorded,
    attemptsExceeded: recorded
      && Number(row?.attemptCount ?? 0) >= Number(row?.maxAttempts ?? 1),
  };
}

async function verifyChallengeUserAgent(
  keyring: IdentityKeyring,
  challenge: LoginChallenge,
  userAgent: string | null,
): Promise<boolean> {
  if (!challenge.requestUserAgentHmac) return true;
  if (!challenge.evidenceKeyVersion) return false;
  const evidence = await userAgentEvidence(
    keyring,
    challenge.userId,
    userAgent,
    challenge.evidenceKeyVersion,
  );
  return evidence
    ? secureDigestEqual(challenge.requestUserAgentHmac, evidence.digest)
    : false;
}

async function verifiedFactor(
  db: D1Database,
  keyring: IdentityKeyring,
  credential: TotpCredential,
  code: string,
  now: Date,
): Promise<VerifiedFactor | null> {
  if (/^\d{6}$/.test(code)) {
    const match = await verifyTotpCode(
      await protectedSecretValue(keyring, credential),
      code,
      now,
    );
    if (!match) return null;
    if (
      credential.lastUsedStep !== null
      && match.matchedCounter <= credential.lastUsedStep
    ) {
      throw new MfaError("MFA_CODE_REPLAYED");
    }
    return {
      factorType: "totp",
      factorKey: String(match.matchedCounter),
      matchedCounter: match.matchedCounter,
    };
  }
  const normalized = normalizeBackupCode(code);
  if (
    !normalized
    || !credential.backupBatchId
    || !credential.backupKeyVersion
  ) {
    return null;
  }
  const hashed = await hashBackupCode(keyring, {
    userId: credential.userId,
    batchId: credential.backupBatchId,
    code: normalized,
    keyVersion: credential.backupKeyVersion,
  });
  const row = await db.prepare(
    `SELECT id FROM auth_backup_codes
     WHERE credential_id=? AND user_id=? AND batch_id=?
       AND code_hmac=? AND key_version=?
       AND used_at IS NULL AND revoked_at IS NULL LIMIT 1`,
  ).bind(
    credential.id,
    credential.userId,
    credential.backupBatchId,
    hashed.digest,
    hashed.keyVersion,
  ).first<{ id: string }>();
  return row
    ? {
      factorType: "backup_code",
      factorKey: row.id,
      backupCodeId: row.id,
    }
    : null;
}

function factorClaimStatement(
  db: D1Database,
  input: {
    claimId: string;
    operationId: string;
    credentialId: string;
    factor: VerifiedFactor;
    createdAt: string;
    sourceGuardSql: string;
    sourceGuardBindings: Array<string | number | null>;
  },
): D1PreparedStatement {
  if (
    !/^\s*SELECT\b/i.test(input.sourceGuardSql)
    || input.sourceGuardSql.includes(";")
  ) {
    throw new Error("INVALID_MFA_CLAIM_GUARD");
  }
  return db.prepare(
    `INSERT INTO auth_mfa_factor_claims (
       id,operation_id,credential_id,factor_type,factor_key,created_at
     )
     SELECT ?,?,?,?,?,?
     WHERE EXISTS (${input.sourceGuardSql})`,
  ).bind(
    input.claimId,
    input.operationId,
    input.credentialId,
    input.factor.factorType,
    input.factor.factorKey,
    input.createdAt,
    ...input.sourceGuardBindings,
  );
}

function factorConsumeStatement(
  db: D1Database,
  credential: TotpCredential,
  factor: VerifiedFactor,
  claimId: string,
  operationId: string,
  timestamp: string,
): D1PreparedStatement {
  if (factor.factorType === "totp") {
    return db.prepare(
      `UPDATE auth_totp_credentials SET last_used_step=?,updated_at=?
       WHERE id=? AND user_id=? AND status='active'
         AND (last_used_step IS NULL OR last_used_step<?)
         AND EXISTS (
           SELECT 1 FROM auth_mfa_factor_claims
           WHERE id=? AND operation_id=? AND credential_id=?
         )`,
    ).bind(
      factor.matchedCounter,
      timestamp,
      credential.id,
      credential.userId,
      factor.matchedCounter,
      claimId,
      operationId,
      credential.id,
    );
  }
  return db.prepare(
    `UPDATE auth_backup_codes SET used_at=?
     WHERE id=? AND credential_id=? AND user_id=?
       AND used_at IS NULL AND revoked_at IS NULL
       AND EXISTS (
         SELECT 1 FROM auth_mfa_factor_claims
         WHERE id=? AND operation_id=? AND credential_id=?
       )`,
  ).bind(
    timestamp,
    factor.backupCodeId,
    credential.id,
    credential.userId,
    claimId,
    operationId,
    credential.id,
  );
}

function factorConsumedGuard(
  credential: TotpCredential,
  factor: VerifiedFactor,
  claimId: string,
  operationId: string,
  timestamp: string,
): SessionInsertGuard {
  if (factor.factorType === "totp") {
    return {
      selectSql: `SELECT 1
        FROM auth_totp_credentials t
        JOIN auth_mfa_factor_claims c ON c.credential_id=t.id
        WHERE t.id=? AND t.user_id=? AND t.status='active'
          AND t.last_used_step=? AND c.id=? AND c.operation_id=?`,
      bindings: [
        credential.id,
        credential.userId,
        factor.matchedCounter,
        claimId,
        operationId,
      ],
    };
  }
  return {
    selectSql: `SELECT 1
      FROM auth_backup_codes b
      JOIN auth_mfa_factor_claims c ON c.credential_id=b.credential_id
      WHERE b.id=? AND b.credential_id=? AND b.user_id=?
        AND b.used_at=? AND c.id=? AND c.operation_id=?`,
    bindings: [
      factor.backupCodeId,
      credential.id,
      credential.userId,
      timestamp,
      claimId,
      operationId,
    ],
  };
}

export async function verifyLoginMfa(
  db: D1Database,
  keyring: IdentityKeyring,
  input: {
    token: string;
    code: string;
    userAgent: string | null;
    securityContext?: AuthRequestSecurityContext;
    deviceToken?: string | null;
    requestIp?: string | null;
    rememberMe?: boolean;
    now?: Date;
  },
): Promise<{
  session: CreatedSession;
  userId: string;
  locale: string;
  accountType: string;
  themePreference: string;
  onboardingCompletedAt: string | null;
}> {
  const now = input.now ?? new Date();
  const timestamp = nowIso(now);
  const challenge = await challengeFromToken(db, input.token);
  if (!challenge) throw new MfaError("MFA_CHALLENGE_INVALID");
  if (challenge.challengeConsumedAt) {
    throw new MfaError("MFA_CHALLENGE_USED");
  }
  if (challenge.challengeInvalidatedAt) {
    throw new MfaError(
      challenge.challengeAttemptCount >= challenge.challengeMaxAttempts
        ? "MFA_ATTEMPTS_EXCEEDED"
        : "MFA_CHALLENGE_INVALID",
    );
  }
  if (challenge.challengeExpiresAt <= timestamp) {
    await db.prepare(
      `UPDATE auth_mfa_challenges SET invalidated_at=?
       WHERE id=? AND consumed_at IS NULL AND invalidated_at IS NULL`,
    ).bind(timestamp, challenge.challengeId).run();
    throw new MfaError("MFA_CHALLENGE_EXPIRED");
  }
  if (challenge.challengeAttemptCount >= challenge.challengeMaxAttempts) {
    throw new MfaError("MFA_ATTEMPTS_EXCEEDED");
  }
  const rollingLimit = await mfaVerificationRateLimit(db, {
    userId: challenge.userId,
    requestIp: input.requestIp ?? null,
    now,
  });
  if (!rollingLimit.allowed) {
    throw new MfaError("MFA_RATE_LIMITED");
  }
  const reservation = await reserveMfaAttempt(
    db,
    challenge,
    input.requestIp ?? null,
    now,
  );
  if (!reservation) {
    throw await mfaReservationDenialError(db, input.token, now);
  }
  if (
    challenge.status !== "active"
    || !await verifyChallengeUserAgent(keyring, challenge, input.userAgent)
  ) {
    await recordChallengeFailure(
      db,
      challenge,
      reservation,
      input.requestIp ?? null,
      now,
      "user_agent",
    );
    throw new MfaError("MFA_CHALLENGE_INVALID");
  }
  let factor: VerifiedFactor | null;
  try {
    factor = await verifiedFactor(
      db,
      keyring,
      challenge,
      input.code,
      now,
    );
  } catch (error) {
    if (error instanceof MfaError && error.code === "MFA_CODE_REPLAYED") {
      await recordChallengeFailure(
        db,
        challenge,
        reservation,
        input.requestIp ?? null,
        now,
        "code",
      );
    }
    throw error;
  }
  if (!factor) {
    const failure = await recordChallengeFailure(
      db,
      challenge,
      reservation,
      input.requestIp ?? null,
      now,
      "code",
    );
    if (!failure.recorded) {
      throw await mfaReservationDenialError(db, input.token, now);
    }
    throw new MfaError(
      failure.attemptsExceeded ? "MFA_ATTEMPTS_EXCEEDED" : "MFA_CODE_INCORRECT",
    );
  }

  const operationId = challenge.challengeId;
  const claimId = crypto.randomUUID();
  const securityEvidence = input.securityContext
    ? await prepareAuthRequestSecurityEvidence(
        keyring,
        challenge.userId,
        input.securityContext,
      )
    : null;
  const deviceContinuity = await prepareDeviceContinuity(db, keyring, {
    userId: challenge.userId,
    deviceToken: input.deviceToken ?? null,
    securityEvidence,
    now,
  });
  const profile = await db.prepare(
    `SELECT id,${USER_IDENTITY_SELECT},
       default_workspace_id AS defaultWorkspaceId
     FROM user_profiles WHERE id=? LIMIT 1`,
  ).bind(challenge.userId).first<UserIdentityRow & {
    defaultWorkspaceId: string | null;
  }>();
  if (!profile) throw new MfaError("MFA_STATE_CONFLICT");
  const identity = await resolveUserIdentity(
    { mode: "dual_write", keyring },
    profile,
  );
  const prepared = await prepareLocalSessionCreation(db, {
    userId: challenge.userId,
    userAgent: input.userAgent,
    authMethod: `${challenge.primaryAuthMethod === "password" || challenge.primaryAuthMethod === "google"
      ? challenge.primaryAuthMethod : "email_otp"}+${factor.factorType}`,
    assuranceLevel: "mfa",
    deviceContinuity,
    loginSecurityNotification: {
      keyring,
      recipientEmail: identity.email,
      locale: challenge.locale === "uz"
        ? "uz"
        : challenge.locale === "en"
          ? "en"
          : "ru",
      workspaceId: profile.defaultWorkspaceId,
    },
    rememberMe: input.rememberMe,
    now,
  });
  const factorGuard = factorConsumedGuard(
    challenge,
    factor,
    claimId,
    operationId,
    timestamp,
  );
  const challengeConsumedGuard = {
    selectSql: `SELECT 1 FROM auth_mfa_challenges
      WHERE id=? AND user_id=? AND consumed_at=?
        AND EXISTS (
          SELECT 1 FROM auth_mfa_factor_claims
          WHERE id=? AND operation_id=?
        )`,
    bindings: [
      challenge.challengeId,
      challenge.userId,
      timestamp,
      claimId,
      operationId,
    ],
  } satisfies SessionInsertGuard;
  const sessionStatements = guardedSessionInsertStatements(
    db,
    prepared,
    challengeConsumedGuard,
  );
  const sessionCreatedGuard = {
    selectSql: "SELECT 1 FROM auth_sessions WHERE id=? AND user_id=?",
    bindings: [prepared.session.sessionId, challenge.userId],
  } satisfies SessionInsertGuard;
  const failureClearStatement = await mfaVerificationFailureClearStatement(db, {
    userId: challenge.userId,
    guard: sessionCreatedGuard,
  });
  const attemptGuard = activeMfaAttemptGuard(reservation, now);
  const statements = [
    factorClaimStatement(db, {
      claimId,
      operationId,
      credentialId: challenge.id,
      factor,
      createdAt: timestamp,
      sourceGuardSql: `SELECT 1 FROM auth_mfa_challenges
        WHERE id=? AND user_id=? AND credential_id=?
          AND consumed_at IS NULL AND invalidated_at IS NULL
          AND expires_at>? AND attempt_count<max_attempts
          AND EXISTS (${attemptGuard.selectSql})`,
      sourceGuardBindings: [
        challenge.challengeId,
        challenge.userId,
        challenge.id,
        timestamp,
        ...attemptGuard.bindings,
      ],
    }),
    factorConsumeStatement(
      db,
      challenge,
      factor,
      claimId,
      operationId,
      timestamp,
    ),
    db.prepare(
      `UPDATE auth_mfa_challenges SET consumed_at=?
       WHERE id=? AND user_id=? AND credential_id=?
         AND consumed_at IS NULL AND invalidated_at IS NULL
         AND EXISTS (${factorGuard.selectSql})`,
    ).bind(
      timestamp,
      challenge.challengeId,
      challenge.userId,
      challenge.id,
      ...factorGuard.bindings,
    ),
    ...sessionStatements,
    failureClearStatement,
    db.prepare(
      `DELETE FROM auth_mfa_attempt_reservations
       WHERE challenge_id=? AND user_scope_key=?
         AND EXISTS (
           SELECT 1 FROM auth_sessions WHERE id=? AND user_id=?
         )`,
    ).bind(
      challenge.challengeId,
      reservation.userScopeKey,
      prepared.session.sessionId,
      challenge.userId,
    ),
  ];
  let results: D1Result[];
  try {
    results = await batchWithSecurityEvent(
      db,
      {
        userId: challenge.userId,
        sessionId: prepared.session.sessionId,
        deviceId: prepared.session.deviceId,
        eventType: "session.created",
        authSource: "local_session",
        assuranceLevel: "mfa",
        ipHash: securityEvidence?.ipHash ?? null,
        userAgentHash: securityEvidence?.userAgentHash ?? null,
        metadata: {
          authMethod: prepared.authMethod,
          deviceName: prepared.displayName,
          ...deviceContinuityEventMetadata(prepared.deviceContinuity),
          challengeId: challenge.challengeId,
          ...requestSecurityEventMetadata(securityEvidence),
        },
        createdAt: timestamp,
      },
      () => statements,
      sessionCreatedGuard,
    );
  } catch (error) {
    if (isFactorClaimConflict(error)) {
      throw new MfaError("MFA_CODE_REPLAYED");
    }
    throw error;
  }
  const sessionInsertResultIndex = 3 + sessionStatements.length - 1;
  const reservationCleanupResultIndex = 4 + sessionStatements.length;
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    const current = await challengeFromToken(db, input.token);
    if (current?.challengeConsumedAt) {
      throw new MfaError("MFA_CODE_REPLAYED");
    }
  }
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1
    || Number(results[1]?.meta?.changes ?? 0) !== 1
    || Number(results[2]?.meta?.changes ?? 0) !== 1
    || Number(results[sessionInsertResultIndex]?.meta?.changes ?? 0) !== 1
    || Number(results[reservationCleanupResultIndex]?.meta?.changes ?? 0) < 1
  ) {
    throw new MfaError("MFA_STATE_CONFLICT");
  }
  return {
    session: prepared.session,
    userId: challenge.userId,
    locale: challenge.locale,
    accountType: challenge.accountType,
    themePreference: challenge.themePreference,
    onboardingCompletedAt: challenge.onboardingCompletedAt,
  };
}

async function managementFactor(
  db: D1Database,
  keyring: IdentityKeyring,
  input: { userId: string; code: string; now: Date },
): Promise<{ credential: TotpCredential; factor: VerifiedFactor }> {
  const credential = await activeCredential(db, input.userId);
  if (!credential) throw new MfaError("MFA_NOT_ENABLED");
  const factor = await verifiedFactor(
    db,
    keyring,
    credential,
    input.code,
    input.now,
  );
  if (!factor) throw new MfaError("MFA_CODE_INCORRECT");
  return { credential, factor };
}

export async function regenerateBackupCodes(
  db: D1Database,
  keyring: IdentityKeyring,
  input: {
    userId: string;
    sessionId: string;
    code: string;
    now?: Date;
  },
): Promise<{ backupCodes: string[] }> {
  const now = input.now ?? new Date();
  const timestamp = nowIso(now);
  const { credential, factor } = await managementFactor(
    db,
    keyring,
    { userId: input.userId, code: input.code, now },
  );
  const operationId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  const batchId = crypto.randomUUID();
  const backup = await backupCodeRecords(keyring, {
    userId: input.userId,
    batchId,
  });
  const backupKeyVersion = backup.records[0].keyVersion;
  const factorGuard = factorConsumedGuard(
    credential,
    factor,
    claimId,
    operationId,
    timestamp,
  );
  const statements: D1PreparedStatement[] = [
    factorClaimStatement(db, {
      claimId,
      operationId,
      credentialId: credential.id,
      factor,
      createdAt: timestamp,
      sourceGuardSql: `SELECT 1 FROM auth_totp_credentials
        WHERE id=? AND user_id=? AND status='active'
          AND EXISTS (
            SELECT 1 FROM auth_sessions
            WHERE id=? AND user_id=? AND revoked_at IS NULL
              AND expires_at>? AND coalesce(idle_expires_at,expires_at)>?
          )`,
      sourceGuardBindings: [
        credential.id,
        input.userId,
        input.sessionId,
        input.userId,
        timestamp,
        timestamp,
      ],
    }),
    factorConsumeStatement(
      db,
      credential,
      factor,
      claimId,
      operationId,
      timestamp,
    ),
    db.prepare(
      `UPDATE auth_backup_codes SET revoked_at=?
       WHERE credential_id=? AND user_id=?
         AND used_at IS NULL AND revoked_at IS NULL
         AND EXISTS (${factorGuard.selectSql})`,
    ).bind(
      timestamp,
      credential.id,
      input.userId,
      ...factorGuard.bindings,
    ),
    db.prepare(
      `UPDATE auth_totp_credentials
       SET backup_batch_id=?,backup_key_version=?,updated_at=?
       WHERE id=? AND user_id=? AND status='active'
         AND EXISTS (${factorGuard.selectSql})`,
    ).bind(
      batchId,
      backupKeyVersion,
      timestamp,
      credential.id,
      input.userId,
      ...factorGuard.bindings,
    ),
  ];
  for (const record of backup.records) {
    statements.push(db.prepare(
      `INSERT INTO auth_backup_codes (
         id,credential_id,user_id,batch_id,code_hmac,key_version,created_at
       )
       SELECT ?,?,?,?,?,?,?
       WHERE EXISTS (
         SELECT 1 FROM auth_totp_credentials
         WHERE id=? AND user_id=? AND status='active' AND backup_batch_id=?
       )`,
    ).bind(
      record.id,
      credential.id,
      input.userId,
      batchId,
      record.digest,
      record.keyVersion,
      timestamp,
      credential.id,
      input.userId,
      batchId,
    ));
  }
  statements.push(db.prepare(
    `UPDATE auth_sessions SET assurance_level='mfa',mfa_verified_at=?
     WHERE id=? AND user_id=? AND revoked_at IS NULL
       AND EXISTS (
         SELECT 1 FROM auth_totp_credentials
         WHERE id=? AND backup_batch_id=? AND status='active'
       )`,
  ).bind(
    timestamp,
    input.sessionId,
    input.userId,
    credential.id,
    batchId,
  ));
  let results: D1Result[];
  try {
    results = await batchWithSecurityEvent(
      db,
      {
        userId: input.userId,
        sessionId: input.sessionId,
        eventType: "mfa.backup_codes.regenerated",
        severity: "warning",
        authSource: "local_session",
        assuranceLevel: "mfa",
        metadata: {
          credentialId: credential.id,
          backupCodeCount: backup.records.length,
        },
        createdAt: timestamp,
      },
      () => statements,
      {
        selectSql: `SELECT 1 FROM auth_totp_credentials
          WHERE id=? AND user_id=? AND backup_batch_id=?`,
        bindings: [credential.id, input.userId, batchId],
      },
    );
  } catch (error) {
    if (isFactorClaimConflict(error)) {
      throw new MfaError("MFA_CODE_REPLAYED");
    }
    throw error;
  }
  const currentSessionResult = results[4 + backup.records.length];
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1
    || Number(results[1]?.meta?.changes ?? 0) !== 1
    || Number(results[3]?.meta?.changes ?? 0) !== 1
    || Number(currentSessionResult?.meta?.changes ?? 0) !== 1
  ) {
    throw new MfaError("MFA_STATE_CONFLICT");
  }
  return { backupCodes: backup.displayCodes };
}

export async function disableMfa(
  db: D1Database,
  keyring: IdentityKeyring,
  input: {
    userId: string;
    sessionId: string;
    currentToken: string;
    code: string;
    now?: Date;
  },
): Promise<{ session: { token: string; expiresAt: string } }> {
  const now = input.now ?? new Date();
  const timestamp = nowIso(now);
  const { credential, factor } = await managementFactor(
    db,
    keyring,
    { userId: input.userId, code: input.code, now },
  );
  const rotation = await prepareSessionTokenRotation(db, {
    userId: input.userId,
    sessionId: input.sessionId,
    currentToken: input.currentToken,
    reason: "mfa_disabled",
    now,
  });
  if (!rotation || rotation.assuranceLevel !== "mfa") {
    throw new MfaError("MFA_STATE_CONFLICT");
  }
  const operationId = crypto.randomUUID();
  const claimId = crypto.randomUUID();
  const factorGuard = factorConsumedGuard(
    credential,
    factor,
    claimId,
    operationId,
    timestamp,
  );
  const disabledByOperationGuard = {
    selectSql: `SELECT 1
      FROM auth_totp_credentials t
      JOIN auth_mfa_factor_claims c ON c.credential_id=t.id
      WHERE t.id=? AND t.user_id=? AND t.status='disabled'
        AND c.id=? AND c.operation_id=?`,
    bindings: [
      credential.id,
      input.userId,
      claimId,
      operationId,
    ],
  } satisfies SessionInsertGuard;
  const completedGuard = {
    selectSql: `SELECT 1
      FROM auth_totp_credentials t
      JOIN auth_mfa_factor_claims c ON c.credential_id=t.id
      JOIN auth_sessions s ON s.id=? AND s.user_id=t.user_id
      WHERE t.id=? AND t.user_id=? AND t.status='disabled'
        AND c.id=? AND c.operation_id=?
        AND s.token_hash=? AND s.revoked_at IS NULL
        AND s.auth_method='email_otp' AND s.assurance_level='primary'
        AND s.mfa_verified_at IS NULL`,
    bindings: [
      input.sessionId,
      credential.id,
      input.userId,
      claimId,
      operationId,
      rotation.tokenHash,
    ],
  } satisfies SessionInsertGuard;
  const statements = [
    factorClaimStatement(db, {
      claimId,
      operationId,
      credentialId: credential.id,
      factor,
      createdAt: timestamp,
      sourceGuardSql: `SELECT 1 FROM auth_totp_credentials
        WHERE id=? AND user_id=? AND status='active'
          AND EXISTS (
            SELECT 1 FROM auth_sessions
            WHERE id=? AND user_id=? AND token_hash=?
              AND assurance_level='mfa' AND revoked_at IS NULL
              AND expires_at>? AND coalesce(idle_expires_at,expires_at)>?
          )`,
      sourceGuardBindings: [
        credential.id,
        input.userId,
        input.sessionId,
        input.userId,
        rotation.previousTokenHash,
        timestamp,
        timestamp,
      ],
    }),
    factorConsumeStatement(
      db,
      credential,
      factor,
      claimId,
      operationId,
      timestamp,
    ),
    db.prepare(
      `UPDATE auth_backup_codes SET revoked_at=?
       WHERE credential_id=? AND user_id=?
         AND used_at IS NULL AND revoked_at IS NULL
         AND EXISTS (${factorGuard.selectSql})`,
    ).bind(
      timestamp,
      credential.id,
      input.userId,
      ...factorGuard.bindings,
    ),
    db.prepare(
      `UPDATE auth_totp_credentials
       SET status='disabled',disabled_at=?,updated_at=?
       WHERE id=? AND user_id=? AND status='active'
         AND EXISTS (${factorGuard.selectSql})`,
    ).bind(
      timestamp,
      timestamp,
      credential.id,
      input.userId,
      ...factorGuard.bindings,
    ),
    db.prepare(
      `UPDATE auth_sessions SET revoked_at=?
       WHERE user_id=? AND id<>? AND revoked_at IS NULL
         AND EXISTS (${disabledByOperationGuard.selectSql})`,
    ).bind(
      timestamp,
      input.userId,
      input.sessionId,
      ...disabledByOperationGuard.bindings,
    ),
    rotation.historyStatement,
    rotation.rotationStatement,
    db.prepare(
      `UPDATE auth_sessions
       SET auth_method='email_otp',assurance_level='primary',
           mfa_verified_at=NULL
       WHERE id=? AND user_id=? AND token_hash=? AND revoked_at IS NULL
         AND EXISTS (${disabledByOperationGuard.selectSql})`,
    ).bind(
      input.sessionId,
      input.userId,
      rotation.tokenHash,
      ...disabledByOperationGuard.bindings,
    ),
  ];
  let results: D1Result[];
  try {
    results = await batchWithSecurityEvent(
      db,
      {
        userId: input.userId,
        sessionId: input.sessionId,
        deviceId: rotation.deviceId,
        eventType: "mfa.disabled",
        severity: "warning",
        authSource: "local_session",
        assuranceLevel: "mfa",
        metadata: {
          credentialId: credential.id,
          sessionTokenRotated: true,
          tokenHistoryId: rotation.historyId,
        },
        createdAt: timestamp,
      },
      () => statements,
      completedGuard,
    );
  } catch (error) {
    if (isFactorClaimConflict(error)) {
      throw new MfaError("MFA_CODE_REPLAYED");
    }
    throw error;
  }
  if (
    Number(results[0]?.meta?.changes ?? 0) !== 1
    || Number(results[1]?.meta?.changes ?? 0) !== 1
    || Number(results[3]?.meta?.changes ?? 0) !== 1
    || Number(results[5]?.meta?.changes ?? 0) !== 1
    || Number(results[6]?.meta?.changes ?? 0) !== 1
    || Number(results[7]?.meta?.changes ?? 0) !== 1
    || Number(results[8]?.meta?.changes ?? 0) !== 1
  ) {
    throw new MfaError("MFA_STATE_CONFLICT");
  }
  return {
    session: { token: rotation.token, expiresAt: rotation.expiresAt },
  };
}
