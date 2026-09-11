import { randomToken } from "../auth/crypto";
import {
  identityLookupHmac,
  protectIdentityValue,
  revealIdentityValue,
  type IdentityKeyring,
} from "../auth/keyring";
import type { AiOutputLocale } from "./localization";

export const GUEST_AI_COOKIE = "juro_guest_ai";
export const GUEST_AI_SESSION_TTL_MS = 24 * 60 * 60 * 1_000;
export const GUEST_AI_RESERVATION_TTL_MS = 2 * 60 * 1_000;
export const GUEST_AI_IP_WINDOW_MS = 60 * 60 * 1_000;
export const GUEST_AI_MAX_SESSIONS_PER_IP = 5;
export const GUEST_AI_MAX_REQUESTS = 5;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export type GuestAiSessionState = "available" | "reserved" | "consumed";

export type GuestAiSession = {
  id: string;
  tokenHmac: string;
  tokenKeyVersion: string;
  locale: AiOutputLocale;
  state: GuestAiSessionState;
  requestCount: number;
  answerCount: number;
  reservedRunId: string | null;
  reservationExpiresAt: string | null;
  expiresAt: string;
  consumedAt: string | null;
};

export type GuestAiRun = {
  id: string;
  sessionId: string;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  provider: string;
  model: string;
  providerResponseId: string | null;
  fallbackFromProvider: string | null;
  status: "processing" | "completed" | "failed" | "expired";
  responseKind: "answer" | "clarification_required" | null;
  requestCiphertext: string;
  requestIv: string;
  requestKeyVersion: string;
  resultCiphertext: string | null;
  resultIv: string | null;
  resultKeyVersion: string | null;
  legalDatabaseAsOf: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  attemptCount: number;
  latencyMs: number | null;
  errorCode: string | null;
  expiresAt: string;
};

export class GuestAiError extends Error {
  constructor(
    public readonly code:
      | "GUEST_AI_DISABLED"
      | "GUEST_CONFIGURATION_UNAVAILABLE"
      | "GUEST_SESSION_REQUIRED"
      | "GUEST_SESSION_INVALID"
      | "GUEST_SESSION_EXPIRED"
      | "GUEST_SESSION_CONSUMED"
      | "GUEST_RATE_LIMIT"
      | "GUEST_REQUEST_LIMIT"
      | "GUEST_RUN_CONFLICT"
      | "GUEST_RUN_PROCESSING"
      | "GUEST_RUN_FAILED"
      | "GUEST_RESERVATION_LOST",
  ) {
    super(code);
    this.name = "GuestAiError";
  }
}

type GuestSessionRow = {
  id: string;
  tokenHmac: string;
  tokenKeyVersion: string;
  locale: string;
  state: string;
  requestCount: number;
  answerCount: number;
  reservedRunId: string | null;
  reservationExpiresAt: string | null;
  expiresAt: string;
  consumedAt: string | null;
};

type GuestRunRow = {
  id: string;
  sessionId: string;
  idempotencyKey: string;
  requestHash: string;
  correlationId: string;
  provider: string;
  model: string;
  providerResponseId: string | null;
  fallbackFromProvider: string | null;
  status: string;
  responseKind: string | null;
  requestCiphertext: string;
  requestIv: string;
  requestKeyVersion: string;
  resultCiphertext: string | null;
  resultIv: string | null;
  resultKeyVersion: string | null;
  legalDatabaseAsOf: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  attemptCount: number;
  latencyMs: number | null;
  errorCode: string | null;
  expiresAt: string;
};

function date(value: Date | string | undefined): Date {
  return value instanceof Date ? value : value ? new Date(value) : new Date();
}

function isoAfter(now: Date, milliseconds: number): string {
  return new Date(now.getTime() + milliseconds).toISOString();
}

function sessionFromRow(row: GuestSessionRow): GuestAiSession {
  if (
    (row.locale !== "ru" && row.locale !== "uz" && row.locale !== "en")
    || !["available", "reserved", "consumed"].includes(row.state)
  ) throw new GuestAiError("GUEST_SESSION_INVALID");
  return {
    ...row,
    locale: row.locale,
    state: row.state as GuestAiSessionState,
    requestCount: Number(row.requestCount),
    answerCount: Number(row.answerCount),
  };
}

function runFromRow(row: GuestRunRow): GuestAiRun {
  if (!["processing", "completed", "failed", "expired"].includes(row.status)) {
    throw new GuestAiError("GUEST_RUN_FAILED");
  }
  if (
    row.responseKind !== null
    && row.responseKind !== "answer"
    && row.responseKind !== "clarification_required"
  ) throw new GuestAiError("GUEST_RUN_FAILED");
  return {
    ...row,
    status: row.status as GuestAiRun["status"],
    responseKind: row.responseKind as GuestAiRun["responseKind"],
    inputTokens: Number(row.inputTokens),
    outputTokens: Number(row.outputTokens),
    cachedInputTokens: Number(row.cachedInputTokens),
    attemptCount: Number(row.attemptCount),
    latencyMs: row.latencyMs === null ? null : Number(row.latencyMs),
  };
}

function cookieValue(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header || header.length > 8_192) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== GUEST_AI_COOKIE) continue;
    const value = part.slice(separator + 1).trim();
    return value.length <= 128 ? value : null;
  }
  return null;
}

function parseCookie(request: Request): { sessionId: string; token: string } | null {
  const value = cookieValue(request);
  if (!value) return null;
  const separator = value.indexOf(".");
  if (separator < 0) return null;
  const sessionId = value.slice(0, separator);
  const token = value.slice(separator + 1);
  return UUID_PATTERN.test(sessionId) && TOKEN_PATTERN.test(token)
    ? { sessionId, token }
    : null;
}

export function guestAiEnabled(env: { GUEST_AI_ENABLED?: string }): boolean {
  return env.GUEST_AI_ENABLED === "true";
}

export function guestSessionCookie(
  sessionId: string,
  token: string,
  requestUrl: string,
): string {
  if (!UUID_PATTERN.test(sessionId) || !TOKEN_PATTERN.test(token)) {
    throw new GuestAiError("GUEST_SESSION_INVALID");
  }
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${GUEST_AI_COOKIE}=${sessionId}.${token}; Path=/; Max-Age=86400; HttpOnly; SameSite=Strict${secure}`;
}

export function clearGuestSessionCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${GUEST_AI_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict${secure}`;
}

export async function createGuestAiSession(input: {
  db: D1Database;
  keyring: IdentityKeyring;
  connectingIp: string | null;
  locale: AiOutputLocale;
  now?: Date | string;
}): Promise<{ session: GuestAiSession; token: string }> {
  const now = date(input.now);
  const connectingIp = input.connectingIp?.normalize("NFKC").trim() ?? "";
  if (!connectingIp || connectingIp.length > 64) {
    throw new GuestAiError("GUEST_SESSION_INVALID");
  }
  const ip = await identityLookupHmac(
    input.keyring,
    connectingIp,
    "guest-ai-session-ip",
  );
  const windowStart = new Date(now.getTime() - GUEST_AI_IP_WINDOW_MS).toISOString();
  const count = await input.db.prepare(
    "SELECT COUNT(*) AS count FROM guest_ai_sessions WHERE ip_hmac=? AND created_at>=?",
  ).bind(ip.digest, windowStart).first<{ count: number }>();
  if (Number(count?.count ?? 0) >= GUEST_AI_MAX_SESSIONS_PER_IP) {
    throw new GuestAiError("GUEST_RATE_LIMIT");
  }

  const id = crypto.randomUUID();
  const token = randomToken(32);
  const tokenHmac = await identityLookupHmac(
    input.keyring,
    `${id}\n${token}`,
    "guest-ai-session-token",
  );
  const nowIso = now.toISOString();
  const expiresAt = isoAfter(now, GUEST_AI_SESSION_TTL_MS);
  await input.db.prepare(
    `INSERT INTO guest_ai_sessions (
       id,token_hmac,token_key_version,ip_hmac,locale,state,request_count,
       answer_count,reserved_run_id,reservation_expires_at,expires_at,
       consumed_at,created_at,updated_at
     ) VALUES (?,?,?,?,?,'available',0,0,NULL,NULL,?,NULL,?,?)`,
  ).bind(
    id,
    tokenHmac.digest,
    tokenHmac.keyVersion,
    ip.digest,
    input.locale,
    expiresAt,
    nowIso,
    nowIso,
  ).run();
  return {
    token,
    session: {
      id,
      tokenHmac: tokenHmac.digest,
      tokenKeyVersion: tokenHmac.keyVersion,
      locale: input.locale,
      state: "available",
      requestCount: 0,
      answerCount: 0,
      reservedRunId: null,
      reservationExpiresAt: null,
      expiresAt,
      consumedAt: null,
    },
  };
}

export async function resolveGuestAiSession(input: {
  db: D1Database;
  keyring: IdentityKeyring;
  request: Request;
  now?: Date | string;
}): Promise<GuestAiSession> {
  const parsed = parseCookie(input.request);
  if (!parsed) throw new GuestAiError("GUEST_SESSION_REQUIRED");
  const row = await input.db.prepare(
    `SELECT id,token_hmac AS tokenHmac,token_key_version AS tokenKeyVersion,
       locale,state,request_count AS requestCount,answer_count AS answerCount,
       reserved_run_id AS reservedRunId,reservation_expires_at AS reservationExpiresAt,
       expires_at AS expiresAt,consumed_at AS consumedAt
     FROM guest_ai_sessions WHERE id=? LIMIT 1`,
  ).bind(parsed.sessionId).first<GuestSessionRow>();
  if (!row) throw new GuestAiError("GUEST_SESSION_INVALID");
  const tokenHmac = await identityLookupHmac(
    input.keyring,
    `${parsed.sessionId}\n${parsed.token}`,
    "guest-ai-session-token",
    row.tokenKeyVersion,
  );
  if (tokenHmac.digest !== row.tokenHmac) {
    throw new GuestAiError("GUEST_SESSION_INVALID");
  }
  if (Date.parse(row.expiresAt) <= date(input.now).getTime()) {
    throw new GuestAiError("GUEST_SESSION_EXPIRED");
  }
  return sessionFromRow(row);
}

async function runForIdempotency(
  db: D1Database,
  sessionId: string,
  idempotencyKey: string,
): Promise<GuestAiRun | null> {
  const row = await db.prepare(
    `SELECT id,session_id AS sessionId,idempotency_key AS idempotencyKey,
       request_hash AS requestHash,correlation_id AS correlationId,provider,model,
       provider_response_id AS providerResponseId,fallback_from_provider AS fallbackFromProvider,
       status,response_kind AS responseKind,request_ciphertext AS requestCiphertext,
       request_iv AS requestIv,request_key_version AS requestKeyVersion,result_ciphertext AS resultCiphertext,
       result_iv AS resultIv,result_key_version AS resultKeyVersion,
       legal_database_as_of AS legalDatabaseAsOf,input_tokens AS inputTokens,
       output_tokens AS outputTokens,cached_input_tokens AS cachedInputTokens,
       attempt_count AS attemptCount,latency_ms AS latencyMs,error_code AS errorCode,
       expires_at AS expiresAt
     FROM guest_ai_runs WHERE session_id=? AND idempotency_key=? LIMIT 1`,
  ).bind(sessionId, idempotencyKey).first<GuestRunRow>();
  return row ? runFromRow(row) : null;
}

export type GuestRunReservation =
  | { kind: "created"; run: GuestAiRun }
  | { kind: "completed"; run: GuestAiRun }
  | { kind: "processing"; run: GuestAiRun }
  | { kind: "failed"; run: GuestAiRun };

export async function reserveGuestAiRun(input: {
  db: D1Database;
  session: GuestAiSession;
  idempotencyKey: string;
  requestHash: string;
  provider: string;
  model: string;
  legalDatabaseAsOf: string;
  instructionHash: string;
  sourceVersionHash: string;
  keyring: IdentityKeyring;
  question: string;
  now?: Date | string;
}): Promise<GuestRunReservation> {
  if (!IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) {
    throw new GuestAiError("GUEST_RUN_CONFLICT");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.requestHash)) {
    throw new GuestAiError("GUEST_RUN_CONFLICT");
  }
  const existing = await runForIdempotency(
    input.db,
    input.session.id,
    input.idempotencyKey,
  );
  if (existing) {
    if (existing.requestHash !== input.requestHash) {
      throw new GuestAiError("GUEST_RUN_CONFLICT");
    }
    if (existing.status === "completed") return { kind: "completed", run: existing };
    if (existing.status === "processing") return { kind: "processing", run: existing };
    return { kind: "failed", run: existing };
  }

  const now = date(input.now);
  const nowIso = now.toISOString();
  const runId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const reservationExpiresAt = isoAfter(now, GUEST_AI_RESERVATION_TTL_MS);
  const protectedQuestion = await protectIdentityValue(
    input.keyring,
    input.question,
    {
      purpose: "guest-ai-question",
      subjectId: input.session.id,
      recordId: runId,
    },
  );
  const [expiredRun, reservedSession, insertedRun] = await input.db.batch([
    input.db.prepare(
      `UPDATE guest_ai_runs SET status='expired',error_code='RESERVATION_EXPIRED',updated_at=?
       WHERE id=(SELECT reserved_run_id FROM guest_ai_sessions WHERE id=? AND state='reserved' AND reservation_expires_at<=?)
         AND session_id=? AND status='processing'`,
    ).bind(nowIso, input.session.id, nowIso, input.session.id),
    input.db.prepare(
      `UPDATE guest_ai_sessions
       SET state='reserved',reserved_run_id=?,reservation_expires_at=?,
           request_count=request_count+1,updated_at=?
       WHERE id=? AND token_hmac=? AND expires_at>? AND answer_count=0
         AND request_count<?
         AND (state='available' OR (state='reserved' AND reservation_expires_at<=?))`,
    ).bind(
      runId,
      reservationExpiresAt,
      nowIso,
      input.session.id,
      input.session.tokenHmac,
      nowIso,
      GUEST_AI_MAX_REQUESTS,
      nowIso,
    ),
    input.db.prepare(
      `INSERT INTO guest_ai_runs (
         id,session_id,idempotency_key,request_hash,correlation_id,provider,model,
         status,request_ciphertext,request_iv,request_key_version,
         legal_database_as_of,instruction_hash,source_version_hash,
         input_tokens,output_tokens,cached_input_tokens,attempt_count,expires_at,
         started_at,created_at,updated_at
       )
       SELECT ?,?,?,?,?,?,?,'processing',?,?,?,?,?,?,0,0,0,0,?,?,?,?
       WHERE EXISTS (
         SELECT 1 FROM guest_ai_sessions
         WHERE id=? AND state='reserved' AND reserved_run_id=?
       )`,
    ).bind(
      runId,
      input.session.id,
      input.idempotencyKey,
      input.requestHash,
      correlationId,
      input.provider,
      input.model,
      protectedQuestion.ciphertext,
      protectedQuestion.iv,
      protectedQuestion.keyVersion,
      input.legalDatabaseAsOf,
      input.instructionHash,
      input.sourceVersionHash,
      input.session.expiresAt,
      nowIso,
      nowIso,
      nowIso,
      input.session.id,
      runId,
    ),
  ]);
  void expiredRun;
  if (
    Number(reservedSession.meta.changes ?? 0) !== 1
    || Number(insertedRun.meta.changes ?? 0) !== 1
  ) {
    const current = await input.db.prepare(
      "SELECT state,request_count AS requestCount,answer_count AS answerCount,expires_at AS expiresAt,reservation_expires_at AS reservationExpiresAt FROM guest_ai_sessions WHERE id=? LIMIT 1",
    ).bind(input.session.id).first<{
      state: string;
      requestCount: number;
      answerCount: number;
      expiresAt: string;
      reservationExpiresAt: string | null;
    }>();
    if (!current || Date.parse(current.expiresAt) <= now.getTime()) {
      throw new GuestAiError("GUEST_SESSION_EXPIRED");
    }
    if (current.state === "consumed" || Number(current.answerCount) === 1) {
      throw new GuestAiError("GUEST_SESSION_CONSUMED");
    }
    if (Number(current.requestCount) >= GUEST_AI_MAX_REQUESTS) {
      throw new GuestAiError("GUEST_REQUEST_LIMIT");
    }
    throw new GuestAiError("GUEST_RUN_PROCESSING");
  }
  return {
    kind: "created",
    run: {
      id: runId,
      sessionId: input.session.id,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      correlationId,
      provider: input.provider,
      model: input.model,
      providerResponseId: null,
      fallbackFromProvider: null,
      status: "processing",
      responseKind: null,
      requestCiphertext: protectedQuestion.ciphertext,
      requestIv: protectedQuestion.iv,
      requestKeyVersion: protectedQuestion.keyVersion,
      resultCiphertext: null,
      resultIv: null,
      resultKeyVersion: null,
      legalDatabaseAsOf: input.legalDatabaseAsOf,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      attemptCount: 0,
      latencyMs: null,
      errorCode: null,
      expiresAt: input.session.expiresAt,
    },
  };
}

export async function completeGuestAiRun(input: {
  db: D1Database;
  keyring: IdentityKeyring;
  run: GuestAiRun;
  resultJson: string;
  responseKind: "answer" | "clarification_required";
  provider: string;
  model: string;
  providerResponseId?: string | null;
  fallbackFromProvider?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  attempts: number;
  latencyMs: number;
  additionalStatements?: D1PreparedStatement[];
  sourceVersionHash?: string;
  legalDatabaseAsOf?: string;
  now?: Date | string;
}): Promise<void> {
  const protectedResult = await protectIdentityValue(
    input.keyring,
    input.resultJson,
    {
      purpose: "guest-ai-result",
      subjectId: input.run.sessionId,
      recordId: input.run.id,
    },
  );
  const nowIso = date(input.now).toISOString();
  const consumed = input.responseKind === "answer";
  const [runResult, sessionResult] = await input.db.batch([
    input.db.prepare(
      `UPDATE guest_ai_runs SET status='completed',response_kind=?,
         result_ciphertext=?,result_iv=?,result_key_version=?,provider=?,model=?,
         provider_response_id=?,fallback_from_provider=?,input_tokens=?,output_tokens=?,
         cached_input_tokens=?,attempt_count=?,latency_ms=?,error_code=NULL,
         source_version_hash=COALESCE(?,source_version_hash),legal_database_as_of=COALESCE(?,legal_database_as_of),
         completed_at=?,updated_at=?
       WHERE id=? AND session_id=? AND status='processing'
         AND EXISTS (
           SELECT 1 FROM guest_ai_sessions
           WHERE id=? AND state='reserved' AND reserved_run_id=?
         )`,
    ).bind(
      input.responseKind,
      protectedResult.ciphertext,
      protectedResult.iv,
      protectedResult.keyVersion,
      input.provider,
      input.model,
      input.providerResponseId ?? null,
      input.fallbackFromProvider ?? null,
      input.inputTokens,
      input.outputTokens,
      input.cachedInputTokens,
      input.attempts,
      input.latencyMs,
      input.sourceVersionHash ?? null,
      input.legalDatabaseAsOf ?? null,
      nowIso,
      nowIso,
      input.run.id,
      input.run.sessionId,
      input.run.sessionId,
      input.run.id,
    ),
    input.db.prepare(
      `UPDATE guest_ai_sessions SET state=?,answer_count=?,consumed_at=?,
         reserved_run_id=NULL,reservation_expires_at=NULL,updated_at=?
       WHERE id=? AND state='reserved' AND reserved_run_id=?
         AND EXISTS (
           SELECT 1 FROM guest_ai_runs
           WHERE id=? AND session_id=? AND status='completed'
         )`,
    ).bind(
      consumed ? "consumed" : "available",
      consumed ? 1 : 0,
      consumed ? nowIso : null,
      nowIso,
      input.run.sessionId,
      input.run.id,
      input.run.id,
      input.run.sessionId,
    ),
    ...(input.additionalStatements ?? []),
  ]);
  if (
    Number(runResult.meta.changes ?? 0) !== 1
    || Number(sessionResult.meta.changes ?? 0) !== 1
  ) throw new GuestAiError("GUEST_RESERVATION_LOST");
}

export async function failGuestAiRun(input: {
  db: D1Database;
  run: GuestAiRun;
  errorCode: string;
  now?: Date | string;
}): Promise<void> {
  const nowIso = date(input.now).toISOString();
  await input.db.batch([
    input.db.prepare(
      `UPDATE guest_ai_runs SET status='failed',error_code=?,completed_at=?,updated_at=?
       WHERE id=? AND session_id=? AND status='processing'`,
    ).bind(input.errorCode.slice(0, 64), nowIso, nowIso, input.run.id, input.run.sessionId),
    input.db.prepare(
      `UPDATE guest_ai_sessions SET state='available',reserved_run_id=NULL,
         reservation_expires_at=NULL,updated_at=?
       WHERE id=? AND state='reserved' AND reserved_run_id=? AND answer_count=0`,
    ).bind(nowIso, input.run.sessionId, input.run.id),
  ]);
}

export async function revealGuestAiRunResult(input: {
  keyring: IdentityKeyring;
  run: GuestAiRun;
}): Promise<string> {
  if (
    input.run.status !== "completed"
    || !input.run.resultCiphertext
    || !input.run.resultIv
    || !input.run.resultKeyVersion
  ) throw new GuestAiError("GUEST_RUN_FAILED");
  return revealIdentityValue(
    input.keyring,
    {
      ciphertext: input.run.resultCiphertext,
      iv: input.run.resultIv,
      keyVersion: input.run.resultKeyVersion,
    },
    {
      purpose: "guest-ai-result",
      subjectId: input.run.sessionId,
      recordId: input.run.id,
    },
  );
}

export async function revealGuestAiRunQuestion(input: {
  keyring: IdentityKeyring;
  run: GuestAiRun;
}): Promise<string> {
  return revealIdentityValue(
    input.keyring,
    {
      ciphertext: input.run.requestCiphertext,
      iv: input.run.requestIv,
      keyVersion: input.run.requestKeyVersion,
    },
    {
      purpose: "guest-ai-question",
      subjectId: input.run.sessionId,
      recordId: input.run.id,
    },
  );
}

export async function latestGuestAiRun(
  db: D1Database,
  sessionId: string,
): Promise<GuestAiRun | null> {
  const row = await db.prepare(
    `SELECT id,session_id AS sessionId,idempotency_key AS idempotencyKey,
       request_hash AS requestHash,correlation_id AS correlationId,provider,model,
       provider_response_id AS providerResponseId,fallback_from_provider AS fallbackFromProvider,
       status,response_kind AS responseKind,request_ciphertext AS requestCiphertext,
       request_iv AS requestIv,request_key_version AS requestKeyVersion,result_ciphertext AS resultCiphertext,
       result_iv AS resultIv,result_key_version AS resultKeyVersion,
       legal_database_as_of AS legalDatabaseAsOf,input_tokens AS inputTokens,
       output_tokens AS outputTokens,cached_input_tokens AS cachedInputTokens,
       attempt_count AS attemptCount,latency_ms AS latencyMs,error_code AS errorCode,
       expires_at AS expiresAt
     FROM guest_ai_runs WHERE session_id=? AND status='completed'
     ORDER BY created_at DESC,id DESC LIMIT 1`,
  ).bind(sessionId).first<GuestRunRow>();
  return row ? runFromRow(row) : null;
}

export async function latestGuestAiClarificationRun(
  db: D1Database,
  sessionId: string,
): Promise<GuestAiRun | null> {
  const row = await db.prepare(
    `SELECT id,session_id AS sessionId,idempotency_key AS idempotencyKey,
       request_hash AS requestHash,correlation_id AS correlationId,provider,model,
       provider_response_id AS providerResponseId,fallback_from_provider AS fallbackFromProvider,
       status,response_kind AS responseKind,request_ciphertext AS requestCiphertext,
       request_iv AS requestIv,request_key_version AS requestKeyVersion,result_ciphertext AS resultCiphertext,
       result_iv AS resultIv,result_key_version AS resultKeyVersion,
       legal_database_as_of AS legalDatabaseAsOf,input_tokens AS inputTokens,
       output_tokens AS outputTokens,cached_input_tokens AS cachedInputTokens,
       attempt_count AS attemptCount,latency_ms AS latencyMs,error_code AS errorCode,
       expires_at AS expiresAt
     FROM guest_ai_runs
     WHERE session_id=? AND status='completed' AND response_kind='clarification_required'
     ORDER BY created_at DESC,id DESC LIMIT 1`,
  ).bind(sessionId).first<GuestRunRow>();
  return row ? runFromRow(row) : null;
}

export async function purgeExpiredGuestAiSessions(input: {
  db: D1Database;
  now?: Date | string;
  limit?: number;
}): Promise<{ eligible: number; purged: number; reservationsReleased: number }> {
  const schema = await input.db.prepare(
    "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('guest_ai_sessions','guest_ai_runs')",
  ).first<{ count: number }>();
  if (Number(schema?.count ?? 0) !== 2) {
    return { eligible: 0, purged: 0, reservationsReleased: 0 };
  }
  const nowIso = date(input.now).toISOString();
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 250);
  const due = await input.db.prepare(
    "SELECT id FROM guest_ai_sessions WHERE expires_at<=? ORDER BY expires_at,id LIMIT ?",
  ).bind(nowIso, limit).all<{ id: string }>();
  const cleanup = await input.db.batch([
    input.db.prepare(
      `UPDATE guest_ai_runs SET status='expired',error_code='RESERVATION_EXPIRED',updated_at=?
       WHERE status='processing' AND expires_at>? AND id IN (
         SELECT reserved_run_id FROM guest_ai_sessions
         WHERE state='reserved' AND reservation_expires_at<=?
       )`,
    ).bind(nowIso, nowIso, nowIso),
    input.db.prepare(
      `UPDATE guest_ai_sessions SET state='available',reserved_run_id=NULL,
         reservation_expires_at=NULL,updated_at=?
       WHERE state='reserved' AND answer_count=0 AND expires_at>?
         AND reservation_expires_at<=?`,
    ).bind(nowIso, nowIso, nowIso),
  ]);
  const deleted = due.results.length === 0
    ? []
    : await input.db.batch(due.results.map(({ id }) => input.db.prepare(
      "DELETE FROM guest_ai_sessions WHERE id=? AND expires_at<=?",
    ).bind(id, nowIso)));
  return {
    eligible: due.results.length,
    purged: deleted.reduce(
      (total, result) => total + Number(result.meta.changes ?? 0),
      0,
    ),
    reservationsReleased: Number(cleanup[1]?.meta.changes ?? 0),
  };
}
