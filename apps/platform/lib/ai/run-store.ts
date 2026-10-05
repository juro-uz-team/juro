import { LEGAL_CHAT_RESERVATION_TTL_MS } from "../legal-chat/execution-limits";

const CHAT_FEATURE = "legal_chat";
const FREE_MONTHLY_CYCLES = 20;
// Provider-specific deadlines can legitimately outlive the old 30-second
// route budget (especially in deep mode). Recovery stays bounded, but must not
// expire a live provider/fallback chain and race its finalization.
const STALE_RESERVATION_MS = LEGAL_CHAT_RESERVATION_TTL_MS;

export type AiRunReservation = {
  kind: "reserved";
  runId: string;
  ledgerId: string;
  correlationId: string;
  periodStart: string;
  periodEnd: string;
};

export type AiRunReplay = {
  kind: "completed";
  runId: string;
  conversationId: string;
  responseMessageId: string;
  response: unknown;
};

export type AiRunPending = { kind: "processing"; runId: string };
export type AiRunExpired = { kind: "expired"; runId: string };
export type AiRunFailed = { kind: "failed"; runId: string; errorCode: string };

export type AiRunStatus =
  | { kind: "missing" }
  | { kind: "processing"; runId: string }
  | { kind: "completed"; runId: string; conversationId: string; responseMessageId: string; branchId: string | null }
  | { kind: "failed"; runId: string; errorCode: string };

export class AiRunConflictError extends Error {
  readonly code: "IDEMPOTENCY_CONFLICT" | "PLAN_LIMIT";

  constructor(code: "IDEMPOTENCY_CONFLICT" | "PLAN_LIMIT", message: string) {
    super(message);
    this.name = "AiRunConflictError";
    this.code = code;
  }
}

type ReserveInput = {
  db: D1Database;
  workspaceId: string;
  userId: string;
  idempotencyKey: string;
  requestHash: string;
  conversationId: string | null;
  provider: string;
  model: string;
  answerMode: "short" | "detailed";
  reasoningMode: "fast" | "deep";
  legalDatabaseAsOf: string;
  instructionHash: string;
  sourceVersionHash: string;
  /** Null explicitly disables the cycle cap for local development. */
  monthlyLimit?: number | null;
};

export async function reserveAiRun(input: ReserveInput): Promise<AiRunReservation | AiRunReplay | AiRunPending | AiRunExpired | AiRunFailed> {
  const registryKey = `legal-chat:${input.workspaceId}:${input.userId}:${input.idempotencyKey}`;
  const scope = `legal-chat:${input.workspaceId}:${input.userId}`;
  const now = isoNow();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const insert = await input.db.prepare(
    `INSERT OR IGNORE INTO idempotency_keys
      (key,scope,request_hash,status,result_ref,expires_at,completed_at,created_at,updated_at)
     VALUES (?,?,?,'started',NULL,?,NULL,?,?)`,
  ).bind(registryKey, scope, input.requestHash, expiresAt, now, now).run();

  if ((insert.meta.changes ?? 0) === 0) {
    return resolveExistingReservation(
      input.db,
      registryKey,
      input.requestHash,
      input.workspaceId,
      input.userId,
    );
  }

  const runId = crypto.randomUUID();
  const ledgerId = crypto.randomUUID();
  const correlationId = crypto.randomUUID();
  const { periodStart, periodEnd } = monthlyPeriod(new Date());
  const configured=await input.db.prepare("SELECT value FROM control_settings WHERE key='ai.max_monthly_cycles'").first<{value:string}>();
  const ceiling=configured?Number(JSON.parse(configured.value)):null;
  const planLimit = input.monthlyLimit === undefined ? FREE_MONTHLY_CYCLES : input.monthlyLimit;
  const limit = ceiling!==null&&Number.isInteger(ceiling)&&ceiling>0?Math.min(planLimit??ceiling,ceiling):planLimit;
  const [runResult, ledgerResult] = await input.db.batch([
    input.db.prepare(
      `INSERT INTO ai_runs
        (id,workspace_id,user_id,conversation_id,request_message_id,response_message_id,idempotency_key,
         correlation_id,provider,model,provider_response_id,fallback_from_provider,answer_mode,reasoning_mode,
         status,legal_database_as_of,instruction_hash,source_version_hash,input_tokens,output_tokens,
         cached_input_tokens,estimated_cost_microusd,attempt_count,latency_ms,error_code,started_at,
         completed_at,created_at,updated_at)
       VALUES (?,?,?,?,NULL,NULL,?,?,?, ?,NULL,NULL,?,?,'reserved',?,?,?,0,0,0,NULL,0,NULL,NULL,?,NULL,?,?)`,
    ).bind(
      runId, input.workspaceId, input.userId, input.conversationId, input.idempotencyKey,
      correlationId, input.provider, input.model, input.answerMode, input.reasoningMode,
      input.legalDatabaseAsOf, input.instructionHash, input.sourceVersionHash, now, now, now,
    ),
    input.db.prepare(
      `INSERT INTO ai_usage_ledger
        (id,workspace_id,user_id,ai_run_id,idempotency_key,feature,period_start,period_end,units,status,
         provider,model,input_tokens,output_tokens,cached_input_tokens,estimated_cost_microusd,
         released_at,consumed_at,created_at,updated_at)
       SELECT ?,?,?,?,?,?,?,?,1,'reserved',?,?,0,0,0,NULL,NULL,NULL,?,?
       WHERE (? IS NULL OR
              (SELECT COALESCE(SUM(units),0) FROM ai_usage_ledger
               WHERE workspace_id=? AND user_id=? AND feature=? AND period_start=?
                 AND status IN ('reserved','consumed')) < ?)`,
    ).bind(
      ledgerId, input.workspaceId, input.userId, runId, input.idempotencyKey, CHAT_FEATURE,
      periodStart, periodEnd, input.provider, input.model, now, now,
      limit, input.workspaceId, input.userId, CHAT_FEATURE, periodStart, limit,
    ),
  ]);
  if (!runResult.success) throw new Error("AI_RUN_RESERVATION_FAILED");
  if (!ledgerResult.success || (ledgerResult.meta.changes ?? 0) === 0) {
    await input.db.batch([
      input.db.prepare("UPDATE ai_runs SET status='rejected',error_code='PLAN_LIMIT',completed_at=?,updated_at=? WHERE id=?").bind(now, now, runId),
      input.db.prepare("UPDATE idempotency_keys SET status='failed',result_ref=?,updated_at=? WHERE key=?").bind(runId, now, registryKey),
    ]);
    throw new AiRunConflictError("PLAN_LIMIT", "Monthly AI answer limit reached.");
  }
  await input.db.prepare("UPDATE idempotency_keys SET result_ref=?,updated_at=? WHERE key=? AND status='started'")
    .bind(runId, now, registryKey).run();
  return { kind: "reserved", runId, ledgerId, correlationId, periodStart, periodEnd };
}

async function resolveExistingReservation(
  db: D1Database,
  registryKey: string,
  requestHash: string,
  workspaceId: string,
  userId: string,
): Promise<AiRunReplay | AiRunPending | AiRunExpired | AiRunFailed> {
  const row = await db.prepare(
    "SELECT request_hash AS requestHash,status,result_ref AS resultRef,updated_at AS updatedAt FROM idempotency_keys WHERE key=?",
  ).bind(registryKey).first<{ requestHash: string; status: string; resultRef: string | null; updatedAt: string }>();
  if (!row || row.requestHash !== requestHash) {
    throw new AiRunConflictError("IDEMPOTENCY_CONFLICT", "Idempotency key was already used for a different request.");
  }
  if (row.status === "completed" && row.resultRef) {
    const completed = await db.prepare(
      `SELECT r.id,r.conversation_id AS conversationId,r.response_message_id AS responseMessageId,
        m.structured_json AS structuredJson
       FROM ai_runs r LEFT JOIN conversation_messages m ON m.id=r.response_message_id
       WHERE r.id=? AND r.workspace_id=? AND r.user_id=? AND r.status='completed'`,
    ).bind(row.resultRef, workspaceId, userId).first<{ id: string; conversationId: string | null; responseMessageId: string | null; structuredJson: string | null }>();
    if (completed?.structuredJson && completed.conversationId && completed.responseMessageId) {
      return {
        kind: "completed", runId: completed.id, conversationId: completed.conversationId,
        responseMessageId: completed.responseMessageId, response: parseJson(completed.structuredJson, null),
      };
    }
    return { kind: "failed", runId: row.resultRef, errorCode: "AI_RUN_REPLAY_UNAVAILABLE" };
  }
  if (row.status === "failed") {
    const failed = row.resultRef
      ? await db.prepare(
        "SELECT error_code AS errorCode FROM ai_runs WHERE id=? AND workspace_id=? AND user_id=? AND status='failed'",
      ).bind(row.resultRef, workspaceId, userId).first<{ errorCode: string | null }>()
      : null;
    return {
      kind: "failed",
      runId: row.resultRef || "",
      errorCode: failed?.errorCode || "AI_RUN_FAILED",
    };
  }
  if (await expireStaleReservation(db, registryKey, row)) {
    return { kind: "expired", runId: row.resultRef || "" };
  }
  if (row.status === "started") return { kind: "processing", runId: row.resultRef || "" };
  return { kind: "failed", runId: row.resultRef || "", errorCode: "AI_RUN_STATE_INVALID" };
}

export async function readAiRunStatus(input: {
  db: D1Database;
  workspaceId: string;
  userId: string;
  idempotencyKey: string;
}): Promise<AiRunStatus> {
  const registryKey = `legal-chat:${input.workspaceId}:${input.userId}:${input.idempotencyKey}`;
  const scope = `legal-chat:${input.workspaceId}:${input.userId}`;
  const row = await input.db.prepare(
    `SELECT k.status AS registryStatus,k.result_ref AS resultRef,
      r.id AS runId,r.status AS runStatus,r.error_code AS errorCode,
      r.conversation_id AS conversationId,r.response_message_id AS responseMessageId,
      (SELECT b.id FROM message_branches b
       WHERE b.response_message_id=r.response_message_id
         AND b.workspace_id=? AND b.owner_user_id=? LIMIT 1) AS branchId
     FROM idempotency_keys k
     LEFT JOIN ai_runs r ON r.id=k.result_ref AND r.workspace_id=? AND r.user_id=?
     WHERE k.key=? AND k.scope=? LIMIT 1`,
  ).bind(
    input.workspaceId,
    input.userId,
    input.workspaceId,
    input.userId,
    registryKey,
    scope,
  ).first<{
    registryStatus: string;
    resultRef: string | null;
    runId: string | null;
    runStatus: string | null;
    errorCode: string | null;
    conversationId: string | null;
    responseMessageId: string | null;
    branchId: string | null;
  }>();
  if (!row) return { kind: "missing" };
  const runId = row.runId || row.resultRef || "";
  if (row.registryStatus === "completed" && row.runStatus === "completed") {
    if (row.conversationId && row.responseMessageId) {
      return {
        kind: "completed",
        runId,
        conversationId: row.conversationId,
        responseMessageId: row.responseMessageId,
        branchId: row.branchId,
      };
    }
    return { kind: "failed", runId, errorCode: "AI_RUN_REPLAY_UNAVAILABLE" };
  }
  if (row.registryStatus === "started" && (!row.runStatus || ["reserved", "finalizing"].includes(row.runStatus))) {
    return { kind: "processing", runId };
  }
  if (["failed", "rejected"].includes(row.runStatus || "") || row.registryStatus === "failed") {
    return { kind: "failed", runId, errorCode: row.errorCode || "AI_RUN_FAILED" };
  }
  return { kind: "failed", runId, errorCode: "AI_RUN_STATE_INVALID" };
}

async function expireStaleReservation(
  db: D1Database,
  registryKey: string,
  row: { status: string; resultRef: string | null; updatedAt: string },
): Promise<boolean> {
  if (row.status !== "started" || Date.parse(row.updatedAt) > Date.now() - STALE_RESERVATION_MS) return false;
  const now = isoNow();
  if (!row.resultRef) {
    const result = await db.prepare(
      "UPDATE idempotency_keys SET status='failed',updated_at=? WHERE key=? AND status='started' AND updated_at<=? AND result_ref IS NULL",
    ).bind(now, registryKey, new Date(Date.now() - STALE_RESERVATION_MS).toISOString()).run();
    return Number(result.meta.changes ?? 0) === 1;
  }
  const cutoff = new Date(Date.now() - STALE_RESERVATION_MS).toISOString();
  await db.batch([
    db.prepare(
      "UPDATE ai_runs SET status='failed',error_code='AI_RUN_EXPIRED',completed_at=?,updated_at=? WHERE id=? AND status='reserved' AND updated_at<=?",
    ).bind(now, now, row.resultRef, cutoff),
    db.prepare(
      "UPDATE ai_usage_ledger SET status='released',released_at=?,updated_at=? WHERE ai_run_id=? AND status='reserved' AND EXISTS (SELECT 1 FROM ai_runs WHERE id=? AND status='failed' AND error_code='AI_RUN_EXPIRED')",
    ).bind(now, now, row.resultRef, row.resultRef),
    db.prepare(
      "UPDATE idempotency_keys SET status='failed',updated_at=? WHERE key=? AND status='started' AND EXISTS (SELECT 1 FROM ai_runs WHERE id=? AND status='failed' AND error_code='AI_RUN_EXPIRED')",
    ).bind(now, registryKey, row.resultRef),
  ]);
  const expired = await db.prepare("SELECT status,error_code AS errorCode FROM ai_runs WHERE id=?")
    .bind(row.resultRef).first<{ status: string; errorCode: string | null }>();
  return expired?.status === "failed" && expired.errorCode === "AI_RUN_EXPIRED";
}

export async function beginAiRunFinalization(input: Pick<CompleteAiRunInput, "db" | "runId" | "workspaceId" | "userId">): Promise<boolean> {
  const now = isoNow();
  const result = await input.db.prepare(
    "UPDATE ai_runs SET status='finalizing',updated_at=? WHERE id=? AND workspace_id=? AND user_id=? AND status='reserved' AND updated_at>?",
  ).bind(now, input.runId, input.workspaceId, input.userId,
    new Date(Date.now()-STALE_RESERVATION_MS).toISOString()).run();
  return Number(result.meta.changes ?? 0) === 1;
}

/** Renew only an unexpired reservation owned by this execution. A delayed
 * heartbeat cannot revive an expired, cancelled or finalized run. */
export async function renewAiRunReservation(input: {
  db: D1Database; runId: string; workspaceId: string; userId: string; now?: number;
}): Promise<boolean> {
  const time = input.now ?? Date.now();
  const now = new Date(time).toISOString();
  const cutoff = new Date(time - STALE_RESERVATION_MS).toISOString();
  const [run] = await input.db.batch([
    input.db.prepare(`UPDATE ai_runs SET updated_at=?
      WHERE id=? AND workspace_id=? AND user_id=? AND status='reserved' AND updated_at>?`)
      .bind(now,input.runId,input.workspaceId,input.userId,cutoff),
    input.db.prepare(`UPDATE idempotency_keys SET updated_at=?
      WHERE result_ref=? AND scope=? AND status='started'
      AND EXISTS (SELECT 1 FROM ai_runs WHERE id=? AND workspace_id=? AND user_id=?
        AND status='reserved' AND updated_at=?)`)
      .bind(now,input.runId,`legal-chat:${input.workspaceId}:${input.userId}`,
        input.runId,input.workspaceId,input.userId,now),
  ]);
  return Number(run!.meta.changes ?? 0) === 1;
}

export type CompleteAiRunInput = {
  db: D1Database;
  runId: string;
  ledgerId: string;
  workspaceId: string;
  userId: string;
  idempotencyKey: string;
  conversationId: string;
  requestMessageId: string;
  responseMessageId: string;
  providerResponseId: string | null;
  provider: "openai" | "anthropic";
  fallbackFromProvider: "openai" | "anthropic" | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  attempts: number;
  latencyMs: number;
  chargeable: boolean;
  sourceVersionHash?: string;
  legalDatabaseAsOf?: string;
};

export function completeAiRunStatements(input: CompleteAiRunInput): D1PreparedStatement[] {
  const now = isoNow();
  const registryKey = `legal-chat:${input.workspaceId}:${input.userId}:${input.idempotencyKey}`;
  return [
    input.db.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM ai_runs run JOIN ai_usage_ledger ledger ON ledger.ai_run_id=run.id
        JOIN idempotency_keys registry ON registry.result_ref=run.id
      WHERE run.id=? AND run.workspace_id=? AND run.user_id=? AND run.status='finalizing'
        AND ledger.id=? AND ledger.status='reserved' AND registry.key=? AND registry.status='started'
    ) THEN 1 ELSE json_extract('AI_RUN_FINALIZATION_CLAIM_FAILED','$') END AS owned`)
      .bind(input.runId,input.workspaceId,input.userId,input.ledgerId,registryKey),
    input.db.prepare(
      `UPDATE ai_runs SET conversation_id=?,request_message_id=?,response_message_id=?,provider_response_id=?,provider=?,fallback_from_provider=?,model=?,status='completed',
       input_tokens=?,output_tokens=?,cached_input_tokens=?,attempt_count=?,latency_ms=?,
       source_version_hash=COALESCE(?,source_version_hash),legal_database_as_of=COALESCE(?,legal_database_as_of),completed_at=?,updated_at=?
       WHERE id=? AND workspace_id=? AND user_id=? AND status='finalizing'`,
    ).bind(
      input.conversationId, input.requestMessageId, input.responseMessageId, input.providerResponseId,
      input.provider, input.fallbackFromProvider, input.model,
      input.inputTokens, input.outputTokens, input.cachedInputTokens, input.attempts, input.latencyMs,
      input.sourceVersionHash ?? null, input.legalDatabaseAsOf ?? null,
      now, now, input.runId, input.workspaceId, input.userId,
    ),
    input.db.prepare(
      `UPDATE ai_usage_ledger SET status=?,provider=?,model=?,input_tokens=?,output_tokens=?,cached_input_tokens=?,
       released_at=?,consumed_at=?,updated_at=? WHERE id=? AND ai_run_id=? AND status='reserved'
       AND EXISTS (SELECT 1 FROM ai_runs WHERE id=? AND status='completed')`,
    ).bind(
      input.chargeable ? "consumed" : "released", input.provider, input.model, input.inputTokens, input.outputTokens,
      input.cachedInputTokens, input.chargeable ? null : now, input.chargeable ? now : null,
      now, input.ledgerId, input.runId, input.runId,
    ),
    input.db.prepare(
      "UPDATE idempotency_keys SET status='completed',result_ref=?,completed_at=?,updated_at=? WHERE key=? AND status='started' AND EXISTS (SELECT 1 FROM ai_runs WHERE id=? AND status='completed')",
    ).bind(input.runId, now, now, registryKey, input.runId),
  ];
}

export async function completeAiRun(input: CompleteAiRunInput): Promise<void> {
  if (!await beginAiRunFinalization(input)) throw new Error("AI_RUN_FINALIZATION_CLAIM_FAILED");
  await input.db.batch(completeAiRunStatements(input));
}

export async function failAiRun(input: {
  db: D1Database;
  runId: string;
  ledgerId: string;
  workspaceId: string;
  userId: string;
  idempotencyKey: string;
  errorCode: string;
}): Promise<void> {
  const now = isoNow();
  const registryKey = `legal-chat:${input.workspaceId}:${input.userId}:${input.idempotencyKey}`;
  await input.db.batch([
    input.db.prepare("UPDATE ai_runs SET status='failed',error_code=?,completed_at=?,updated_at=? WHERE id=? AND workspace_id=? AND user_id=? AND status IN ('reserved','finalizing')")
      .bind(input.errorCode, now, now, input.runId, input.workspaceId, input.userId),
    input.db.prepare("UPDATE ai_usage_ledger SET status='released',released_at=?,updated_at=? WHERE id=? AND ai_run_id=? AND status='reserved' AND EXISTS (SELECT 1 FROM ai_runs WHERE id=? AND status='failed')")
      .bind(now, now, input.ledgerId, input.runId, input.runId),
    input.db.prepare("UPDATE idempotency_keys SET status='failed',result_ref=?,updated_at=? WHERE key=? AND status='started' AND EXISTS (SELECT 1 FROM ai_runs WHERE id=? AND status='failed')")
      .bind(input.runId, now, registryKey, input.runId),
  ]);
}

export async function sha256Json(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function monthlyPeriod(date: Date): { periodStart: string; periodEnd: string } {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  return {
    periodStart: new Date(Date.UTC(year, month, 1)).toISOString(),
    periodEnd: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
  };
}

function isoNow(): string {
  return new Date().toISOString();
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
