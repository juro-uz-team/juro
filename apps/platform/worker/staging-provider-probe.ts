import { z } from "zod";
import {callProviderContractProbe} from "./provider-contract-probe";
import {runLegalChatStorageProbe} from "./legal-chat-storage-probe";
import {
  AiExecutionBudgetAbortError,
  createAiExecutionBudget,
  type AiExecutionBudget,
} from "../lib/ai/execution-budget";
import {
  createStagingAiSloProbeCorrelationId,
  recordStagingAiSloProbe,
  type AiSloFirstUsefulStage,
} from "../lib/ai/slo-telemetry";
import {
  providerFailureEvidence,
  recordDependencyHealthEvidence,
} from "./dependency-health-evidence";

type StagingProviderProbeEnv = {DB:D1Database;APP_ENV:string;STAGING_SYNTHETIC_PROBES_ENABLED:string};

// Contract and storage observations are distinct from semantic answer acceptance.
const ROLLING_PROBE_VERSION = "v28";
const ROLLING_PROBE_KEY_PREFIX = `staging-provider-slo-${ROLLING_PROBE_VERSION}`;
export const STAGING_PROVIDER_PROBE_EXECUTION_BUDGET_MS = 30_000;
const STAGING_PROVIDER_PROBE_PROVIDER_TIMEOUT_MS = 25_500;
const STAGING_PROVIDER_PROBE_POST_PROVIDER_RESERVE_MS = 2_000;
const STAGING_PROVIDER_PROBE_RETENTION_MS = 30 * 24 * 60 * 60_000;
const STAGING_PROVIDER_PROBE_MAX_RECORDS_PER_PROVIDER = 2_000;
const STAGING_PROVIDER_PROBE_ABANDONED_AFTER_MS = 2 * 60_000;
type Provider = "openai" | "anthropic";
// Staging probes exercise both configured server-side providers with a fixed,
// content-free structured-output request. This is deliberately opt-in and
// staging-only; production cannot enable this code path.
const providers = ["openai", "anthropic"] as const satisfies readonly Provider[];

// Retained as the stable minimal probe contract used by unit tests and older
// immutable probe records. This probe does not claim legal-answer correctness.
export const providerProbeOutputSchema = z.object({
  status: z.literal("ok"),
}).strict();

export type StagingProviderProbeSummary = {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  retentionDeleted: number;
};

export type RollingProbeExecution = {
  id: string;
  probeKey: string;
  startedAt: number;
  startedAtIso: string;
  /** Alternates every five-minute scheduled slot without storing a counter. */
  locale: "ru" | "uz";
};

type ProviderProbeTiming = {
  providerCompleted: boolean;
  model: string | null;
  providerStartedAt: number | null;
  providerTtftMs: number | null;
  validationLatencyMs: number | null;
  persistenceLatencyMs: number | null;
  firstUsefulStage: AiSloFirstUsefulStage;
  firstUsefulLatencyMs: number | null;
};

type ProviderProbeResult = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  latencyMs: number;
  attempts: number;
  timing: ProviderProbeTiming;
};

class ProviderProbeStageError extends Error {
  constructor(readonly safeCode: string) {
    super(safeCode);
    this.name = "ProviderProbeStageError";
  }
}

export function stagingProviderProbeEnabled(
  env: Pick<StagingProviderProbeEnv, "APP_ENV" | "STAGING_SYNTHETIC_PROBES_ENABLED">,
): boolean {
  return env.APP_ENV === "staging"
    && (env as Record<string, unknown>).STAGING_SYNTHETIC_PROBES_ENABLED === "true";
}

function normalizedExecutionId(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new ProviderProbeStageError("PROBE_EXECUTION_ID_INVALID");
  }
  return value.toLowerCase();
}

/** Creates one opaque, timestamped execution identifier shared by both providers. */
export function createRollingStagingProviderProbeExecution(
  now = new Date(),
  id = crypto.randomUUID(),
): RollingProbeExecution {
  const executionId = normalizedExecutionId(id);
  const startedAt = now.getTime();
  if (!Number.isFinite(startedAt)) throw new ProviderProbeStageError("PROBE_EXECUTION_TIME_INVALID");
  const startedAtIso = now.toISOString();
  const timestampKey = startedAtIso.replace(/[-:.]/g, "");
  const locale = Math.floor(startedAt / (5 * 60_000)) % 2 === 0 ? "ru" : "uz";
  return {
    id: executionId,
    probeKey: `${ROLLING_PROBE_KEY_PREFIX}-${timestampKey}-${executionId}`,
    startedAt,
    startedAtIso,
    locale,
  };
}

function probeId(provider: Provider, execution: RollingProbeExecution): string {
  return `${execution.id}-${provider}`;
}

function newProviderTiming(): ProviderProbeTiming {
  return {
    providerCompleted: false,
    model: null,
    providerStartedAt: null,
    providerTtftMs: null,
    validationLatencyMs: null,
    persistenceLatencyMs: null,
    firstUsefulStage: "none",
    firstUsefulLatencyMs: null,
  };
}

function providerErrorCode(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? (error as { code?: unknown }).code
    : null;
  if (typeof code === "string" && /^[A-Z0-9_]{3,64}$/.test(code)) return code;
  if (error instanceof ProviderProbeStageError) return error.safeCode;
  // D1 stores no exception message, provider response, prompt, or output.
  // The narrow class is sufficient to distinguish transport/schema/runtime
  // failures while preserving the closed probe's no-content guarantee.
  const name = error instanceof Error ? error.name : "";
  if (name === "ZodError") return "PROVIDER_PROBE_SCHEMA_INVALID";
  if (name === "TypeError") return "PROVIDER_PROBE_TYPE_ERROR";
  if (name === "ReferenceError") return "PROVIDER_PROBE_REFERENCE_ERROR";
  return "PROVIDER_PROBE_FAILED";
}

function anthropicHttpFailureCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = "code" in error ? (error as { code?: unknown }).code : null;
    if (typeof code === "string" && /^[A-Z0-9_]{3,48}$/.test(code)) {
      return `PROBE_ANTHROPIC_${code}`.slice(0, 64);
    }
    const status = "providerStatus" in error ? (error as { providerStatus?: unknown }).providerStatus : null;
    const type = "providerErrorType" in error ? (error as { providerErrorType?: unknown }).providerErrorType : null;
    if (typeof status === "number" && status >= 400 && status <= 599) {
      const safeType = typeof type === "string" && /^[a-z_]{3,40}$/.test(type)
        ? `_${type.toUpperCase()}`
        : "";
      return `PROBE_ANTHROPIC_HTTP_${status}${safeType}`.slice(0, 64);
    }
  }
  return error instanceof TypeError ? "PROBE_ANTHROPIC_CALL_TYPE_ERROR" : "PROBE_ANTHROPIC_CALL_FAILED";
}

function openAiHttpFailureCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const code = "code" in error ? (error as { code?: unknown }).code : null;
    const status = "providerStatus" in error ? (error as { providerStatus?: unknown }).providerStatus : null;
    const type = "providerErrorType" in error ? (error as { providerErrorType?: unknown }).providerErrorType : null;
    if (typeof status === "number" && status >= 400 && status <= 599) {
      const safeType = typeof type === "string" && /^[a-zA-Z0-9_.-]{3,48}$/.test(type)
        ? `_${type.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`
        : "";
      return `PROBE_OPENAI_HTTP_${status}${safeType}`.slice(0, 64);
    }
    if (typeof code === "string" && /^[A-Z0-9_]{3,48}$/.test(code)) {
      return `PROBE_OPENAI_${code}`.slice(0, 64);
    }
  }
  return error instanceof TypeError ? "PROBE_OPENAI_CALL_TYPE_ERROR" : "PROBE_OPENAI_CALL_FAILED";
}

function providerTimeoutMs(budget: AiExecutionBudget): number {
  const remaining = budget.remainingMs - STAGING_PROVIDER_PROBE_POST_PROVIDER_RESERVE_MS;
  if (budget.signal.aborted || remaining < 1) {
    throw new ProviderProbeStageError("PROBE_BUDGET_EXHAUSTED");
  }
  return Math.min(STAGING_PROVIDER_PROBE_PROVIDER_TIMEOUT_MS, remaining);
}

function stageTimeoutMs(budget: AiExecutionBudget): number {
  return Math.max(1, Math.min(
    STAGING_PROVIDER_PROBE_PROVIDER_TIMEOUT_MS + 1_500,
    budget.remainingMs,
  ));
}

function requireProbeBudget(budget: AiExecutionBudget): void {
  if (budget.signal.aborted || budget.remainingMs < STAGING_PROVIDER_PROBE_POST_PROVIDER_RESERVE_MS) {
    throw new AiExecutionBudgetAbortError(budget.abortReason ?? "overall_timeout");
  }
}

function sloFailure(input: {
  error: unknown;
  budget: AiExecutionBudget;
}): {
  outcome: "failed" | "timed_out" | "cancelled";
  safeErrorCode: "AI_SLO_TIMEOUT" | "AI_SLO_PROVIDER_UNAVAILABLE" | "AI_SLO_ABORTED" |
    "AI_SLO_VALIDATION_FAILED" | "AI_SLO_PERSISTENCE_FAILED" | "AI_SLO_INTERNAL_ERROR";
} {
  const code = providerErrorCode(input.error);
  if (
    input.error instanceof AiExecutionBudgetAbortError
    || input.budget.abortReason === "overall_timeout"
    || code.includes("TIMEOUT")
    || code.includes("BUDGET_EXHAUSTED")
  ) {
    return { outcome: "timed_out", safeErrorCode: "AI_SLO_TIMEOUT" };
  }
  if (code.includes("CANCELLED") || input.budget.abortReason === "caller") {
    return { outcome: "cancelled", safeErrorCode: "AI_SLO_ABORTED" };
  }
  if (code.includes("INVALID_AI_OUTPUT") || code.includes("SCHEMA") || code.includes("BOUNDARY")) {
    return { outcome: "failed", safeErrorCode: "AI_SLO_VALIDATION_FAILED" };
  }
  if (code.includes("PERSISTENCE") || code.includes("FINALIZATION") || code.includes("RESERVATION")) {
    return { outcome: "failed", safeErrorCode: "AI_SLO_PERSISTENCE_FAILED" };
  }
  if (code.includes("PROVIDER") || code.includes("ANTHROPIC") || code.includes("OPENAI") || code.includes("CONFIG")) {
    return { outcome: "failed", safeErrorCode: "AI_SLO_PROVIDER_UNAVAILABLE" };
  }
  return { outcome: "failed", safeErrorCode: "AI_SLO_INTERNAL_ERROR" };
}

/**
 * Prunes only completed/failed v28 technical probe rows. It never deletes the
 * prior fixed-key evidence or the append-only SLO telemetry ledger.
 */
export async function pruneRollingStagingProviderProbeRows(
  env: StagingProviderProbeEnv,
  now = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - STAGING_PROVIDER_PROBE_RETENTION_MS).toISOString();
  const abandonedBefore = new Date(now.getTime() - STAGING_PROVIDER_PROBE_ABANDONED_AFTER_MS).toISOString();
  const prefix = `${ROLLING_PROBE_KEY_PREFIX}-%`;
  // Only v27 rolling rows are mutable/retained here. Historical probe rows and
  // append-only ai_slo_telemetry_events are intentionally never touched.
  await env.DB.prepare(`
    UPDATE staging_provider_probes
    SET status='failed',error_code='PROBE_EXECUTION_ABANDONED',finished_at=?,updated_at=?
    WHERE probe_key LIKE ? AND status='running' AND started_at<?
  `).bind(now.toISOString(), now.toISOString(), prefix, abandonedBefore).run();
  const expired = await env.DB.prepare(`
    DELETE FROM staging_provider_probes
    WHERE probe_key LIKE ? AND status IN ('succeeded','failed') AND created_at<?
  `).bind(prefix, cutoff).run();
  let deleted = Number(expired.meta.changes ?? 0);
  for (const provider of providers) {
    const result = await env.DB.prepare(`
      DELETE FROM staging_provider_probes
      WHERE id IN (
        SELECT id FROM staging_provider_probes
        WHERE probe_key LIKE ? AND provider=? AND status IN ('succeeded','failed')
        ORDER BY created_at DESC,id DESC
        LIMIT -1 OFFSET ?
      )
    `).bind(prefix, provider, STAGING_PROVIDER_PROBE_MAX_RECORDS_PER_PROVIDER).run();
    deleted += Number(result.meta.changes ?? 0);
  }
  return deleted;
}

async function executeProviderProbe(input: {
  env: StagingProviderProbeEnv;
  provider: Provider;
  execution: RollingProbeExecution;
  budget: AiExecutionBudget;
  timing: ProviderProbeTiming;
}): Promise<ProviderProbeResult> {
  const {env,provider,execution,budget,timing}=input;
  const stage=budget.beginStage(`probe.${provider}.contract`,{timeoutMs:stageTimeoutMs(budget)});
  try {
    timing.providerStartedAt=Date.now();
    const result=await callProviderContractProbe(provider,{timeoutMs:providerTimeoutMs(budget),
      deadlineAt:Date.now()+budget.remainingMs,signal:stage.signal,requestId:probeId(provider,execution)});
    timing.providerCompleted=true;
    timing.model=result.model;
    stage.complete();
    // A completed technical response is not a user's first useful Legal Answer.
    timing.firstUsefulStage="none";
    timing.firstUsefulLatencyMs=null;
    if(provider==="openai") {
      requireProbeBudget(budget);
      const started=Date.now();
      try {
        await runLegalChatStorageProbe({db:env.DB,environment:env.APP_ENV,enabled:env.STAGING_SYNTHETIC_PROBES_ENABLED,
          executionId:execution.id,locale:execution.locale,signal:budget.signal});
      } catch {
        throw new ProviderProbeStageError("PROBE_PERSISTENCE_FAILED");
      }
      timing.persistenceLatencyMs=Date.now()-started;
    }
    return {model:result.model,inputTokens:result.usage.inputTokens,outputTokens:result.usage.outputTokens,
      cachedInputTokens:result.usage.cachedInputTokens,latencyMs:result.latencyMs,attempts:result.attempts,timing};
  } catch(error) {
    stage.fail();
    if(error instanceof AiExecutionBudgetAbortError||budget.signal.aborted)throw error;
    if(error instanceof ProviderProbeStageError)throw error;
    throw new ProviderProbeStageError(provider==="anthropic"?anthropicHttpFailureCode(error):openAiHttpFailureCode(error));
  }
}

async function markProbeFailed(input: {
  env: StagingProviderProbeEnv;
  id: string;
  safeCode: string;
  startedAt: number;
  allowedStatuses?: readonly ("running" | "succeeded")[];
}): Promise<void> {
  const finishedAt = new Date().toISOString();
  const statuses = input.allowedStatuses ?? ["running"];
  const statusPredicate = statuses.map(() => "?").join(",");
  await input.env.DB.prepare(`
    UPDATE staging_provider_probes
    SET status='failed',error_code=?,latency_ms=?,finished_at=?,updated_at=?
    WHERE id=? AND status IN (${statusPredicate})
  `).bind(
    input.safeCode,
    Math.max(0, Date.now() - input.startedAt),
    finishedAt,
    finishedAt,
    input.id,
    ...statuses,
  ).run();
}

async function recordProbeSloSuccess(input: {
  env: StagingProviderProbeEnv;
  provider: Provider;
  correlationId: string;
  result: ProviderProbeResult;
  startedAt: number;
}): Promise<void> {
  await recordStagingAiSloProbe({
    db: input.env.DB,
    correlationId: input.correlationId,
    answerMode: "short",
    reasoningMode: "fast",
    provider: input.provider,
    model: input.result.model,
    outcome: "completed",
    fallback: "none",
    providerTtftMs: input.result.timing.providerTtftMs,
    providerTotalMs: input.result.latencyMs,
    validationLatencyMs: input.result.timing.validationLatencyMs,
    persistenceLatencyMs: input.result.timing.persistenceLatencyMs,
    endToEndMs: Math.max(0, Date.now() - input.startedAt),
    firstUsefulStage: input.result.timing.firstUsefulStage,
    firstUsefulLatencyMs: input.result.timing.firstUsefulLatencyMs,
  });
}

async function runOne(input: {
  env: StagingProviderProbeEnv;
  provider: Provider;
  execution: RollingProbeExecution;
  budget: AiExecutionBudget;
}): Promise<"succeeded" | "failed" | "skipped"> {
  const { env, provider, execution, budget } = input;
  const id = probeId(provider, execution);
  const correlationId = createStagingAiSloProbeCorrelationId();
  const timing = newProviderTiming();
  const insert = await env.DB.prepare(`
    INSERT INTO staging_provider_probes (
      id,probe_key,provider,status,model,provider_response_id,input_tokens,
      output_tokens,cached_input_tokens,latency_ms,error_code,started_at,
      finished_at,created_at,updated_at
    ) VALUES (?,?,?,'running',NULL,NULL,0,0,0,0,NULL,?,NULL,?,?)
    ON CONFLICT(probe_key,provider) DO NOTHING
  `).bind(
    id,
    execution.probeKey,
    provider,
    execution.startedAtIso,
    execution.startedAtIso,
    execution.startedAtIso,
  ).run();
  if (Number(insert.meta.changes ?? 0) !== 1) return "skipped";

  try {
    const result = await executeProviderProbe({ env, provider, execution, budget, timing });
    requireProbeBudget(budget);
    const finishedAt = new Date().toISOString();
    const updated = await env.DB.prepare(`
      UPDATE staging_provider_probes
      SET status='succeeded',model=?,provider_response_id=NULL,input_tokens=?,
          output_tokens=?,cached_input_tokens=?,latency_ms=?,finished_at=?,
          updated_at=?
      WHERE id=? AND status='running'
    `).bind(
      result.model,
      result.inputTokens,
      result.outputTokens,
      result.cachedInputTokens,
      Math.max(0, Date.now() - execution.startedAt),
      finishedAt,
      finishedAt,
      id,
    ).run();
    if (Number(updated.meta.changes ?? 0) !== 1) {
      throw new ProviderProbeStageError("PROBE_EXECUTION_LEASE_LOST");
    }
    requireProbeBudget(budget);
    try {
      await recordProbeSloSuccess({
        env,
        provider,
        correlationId,
        result,
        startedAt: execution.startedAt,
      });
    } catch {
      // A successful provider call without durable, safe SLO evidence must
      // never create a green provider signal. The probe result remains
      // inspectable, but is explicitly downgraded instead of hidden.
      await markProbeFailed({
        env,
        id,
        startedAt: execution.startedAt,
        safeCode: "PROBE_SLO_TELEMETRY_FAILED",
        allowedStatuses: ["succeeded"],
      });
      console.error(JSON.stringify({
        event: "staging.provider_probe_slo_persistence_failed",
        provider,
        executionId: execution.id,
      }));
      return "failed";
    }
    await recordDependencyHealthEvidence(env, {
      key: provider,
      state: "operational",
      evidenceKind: "synthetic_probe",
      startedAt: execution.startedAt,
      minimumOperationalIntervalMs: 15 * 60_000,
    });
    return "succeeded";
  } catch (error) {
    const safeCode = providerErrorCode(error);
    await markProbeFailed({
      env,
      id,
      startedAt: execution.startedAt,
      safeCode,
    });
    const failure = sloFailure({ error, budget });
    try {
      await recordStagingAiSloProbe({
        db: env.DB,
        correlationId,
        answerMode: "short",
        reasoningMode: "fast",
        provider: timing.model ? provider : "none",
        model: timing.model,
        outcome: failure.outcome,
        fallback: "none",
        providerTtftMs: timing.providerTtftMs,
        providerTotalMs: timing.providerStartedAt === null
          ? null
          : Math.max(0, Date.now() - timing.providerStartedAt),
        validationLatencyMs: timing.validationLatencyMs,
        persistenceLatencyMs: timing.persistenceLatencyMs,
        endToEndMs: Math.max(0, Date.now() - execution.startedAt),
        firstUsefulStage: "none",
        firstUsefulLatencyMs: null,
        safeErrorCode: failure.safeErrorCode,
      });
    } catch {
      console.error(JSON.stringify({
        event: "staging.provider_probe_slo_persistence_failed",
        provider,
        executionId: execution.id,
      }));
    }
    // A local storage failure does not establish a provider outage.
    if(!timing.providerCompleted)await recordDependencyHealthEvidence(env, {
      ...providerFailureEvidence(provider, safeCode),
      evidenceKind: "synthetic_probe",
      startedAt: execution.startedAt,
    });
    return "failed";
  }
}

/**
 * Rolling, staging-only real-provider validation. Every invocation has an
 * opaque execution ID, new technical rows for both providers, one shared hard
 * 30-second deadline, and append-only SLO measurements. It has no HTTP entry
 * point and never records prompts, outputs, user IDs, account IDs, URLs, or
 * provider response bodies. Retention affects only its v28 technical table;
 * historical provider evidence and append-only SLO telemetry are preserved.
 */
export async function runStagingProviderProbes(
  env: StagingProviderProbeEnv,
): Promise<StagingProviderProbeSummary | null> {
  if (!stagingProviderProbeEnabled(env)) return null;
  // Retention is deliberately outside the provider execution window. A
  // retention fault must never make an interactive provider check run late or
  // be reported as a provider outage.
  let retentionDeleted = 0;
  try {
    retentionDeleted = await pruneRollingStagingProviderProbeRows(env);
  } catch {
    console.error(JSON.stringify({
      event: "staging.provider_probe_retention_failed",
      environment: env.APP_ENV,
    }));
  }
  const execution = createRollingStagingProviderProbeExecution();
  const budget = createAiExecutionBudget({
    totalBudgetMs: STAGING_PROVIDER_PROBE_EXECUTION_BUDGET_MS,
  });
  try {
    const outcomes = await Promise.all(providers.map((provider) => runOne({
      env,
      provider,
      execution,
      budget,
    })));
    return {
      attempted: outcomes.filter((outcome) => outcome !== "skipped").length,
      succeeded: outcomes.filter((outcome) => outcome === "succeeded").length,
      failed: outcomes.filter((outcome) => outcome === "failed").length,
      skipped: outcomes.filter((outcome) => outcome === "skipped").length,
      retentionDeleted,
    };
  } finally {
    budget.dispose();
  }
}
