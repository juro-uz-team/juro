import {
  dependencyHealthEnvironment,
  recordDependencyHealth,
  type DependencyHealthEvidenceKind,
  type DependencyHealthKey,
  type DependencyHealthSafeErrorCode,
  type DependencyHealthState,
} from "../lib/operations/dependency-health";

/**
 * Minimal worker-facing boundary for dependency-health evidence. It only
 * accepts pre-classified technical states/codes and deliberately swallows its
 * own persistence failure: health observability must never make a completed
 * queue job, scan, or scheduled task fail or retry.
 */
export type DependencyHealthEvidenceEnv = {
  APP_ENV: string;
  DB: D1Database;
};

type OperationalEvidence = {
  key: DependencyHealthKey;
  state: "operational";
  evidenceKind: DependencyHealthEvidenceKind;
  startedAt: number;
  minimumOperationalIntervalMs?: number;
};

type FailedEvidence = {
  key: DependencyHealthKey;
  state: Exclude<DependencyHealthState, "operational" | "unknown" | "stale">;
  safeErrorCode: DependencyHealthSafeErrorCode;
  evidenceKind: DependencyHealthEvidenceKind;
  startedAt: number;
};

export type DependencyHealthEvidence = OperationalEvidence | FailedEvidence;

export type ProviderDiagnosticSafeErrorCode = Extract<
  DependencyHealthSafeErrorCode,
  | "PROVIDER_CREDIT_BALANCE_LOW"
  | "PROVIDER_SPEND_LIMIT_REACHED"
  | "PROVIDER_BILLING_CONFIGURATION"
  | "PROVIDER_WORKSPACE_CONFIGURATION"
  | "PROVIDER_REQUEST_CONFIGURATION"
>;

const maxLatencyMs = 60_000;
export const D1_HEALTH_DEGRADED_LATENCY_MS = 2_000;

type D1HealthProbeClock = {
  nowMs?: () => number;
  now?: () => Date;
};

export function dependencyHealthLatencyMs(
  startedAt: number,
  now = Date.now(),
): number {
  if (!Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  return Math.min(maxLatencyMs, Math.max(0, Math.round(now - startedAt)));
}

async function recentlyRecordedOperationalEvidence(
  env: DependencyHealthEvidenceEnv,
  key: DependencyHealthKey,
  environment: ReturnType<typeof dependencyHealthEnvironment>,
  minimumIntervalMs: number,
  now: Date,
): Promise<boolean> {
  if (minimumIntervalMs <= 0) return false;
  const row = await env.DB.prepare(
    `SELECT checked_at AS checkedAt,state
     FROM dependency_health_checks
     WHERE environment=? AND dependency_key=?
     ORDER BY checked_at DESC,id DESC
     LIMIT 1`,
  ).bind(environment, key).first<{ checkedAt: string; state: string }>();
  // Throttle repeated successes, never recovery from a more recent failure.
  if (!row?.checkedAt || row.state !== "operational") return false;
  const lastCheckedAt = Date.parse(row.checkedAt);
  return Number.isFinite(lastCheckedAt) && now.getTime() - lastCheckedAt < minimumIntervalMs;
}

/**
 * Persists one content-free observation. Operational events can be throttled
 * to prevent an append-only ledger from growing with every routine queue
 * message; failures are never throttled. Returns whether a row was written.
 */
export async function recordDependencyHealthEvidence(
  env: DependencyHealthEvidenceEnv,
  evidence: DependencyHealthEvidence,
  now = new Date(),
): Promise<boolean> {
  const environment = dependencyHealthEnvironment(env.APP_ENV);
  try {
    if (
      evidence.state === "operational"
      && await recentlyRecordedOperationalEvidence(
        env,
        evidence.key,
        environment,
        evidence.minimumOperationalIntervalMs ?? 0,
        now,
      )
    ) {
      return false;
    }
    await recordDependencyHealth({
      db: env.DB,
      now,
      value: {
        environment,
        key: evidence.key,
        state: evidence.state,
        latencyMs: dependencyHealthLatencyMs(evidence.startedAt, now.getTime()),
        ...(evidence.state === "operational" ? {} : { safeErrorCode: evidence.safeErrorCode }),
        evidenceKind: evidence.evidenceKind,
      },
    });
    return true;
  } catch {
    // Keep the log content-free: a health write may fail during a database
    // incident, when exposing a low-level error would add no user value.
    console.error(JSON.stringify({
      event: "dependency_health.evidence_persistence_failed",
      environment,
      dependencyKey: evidence.key,
      evidenceKind: evidence.evidenceKind,
    }));
    return false;
  }
}

/**
 * Measure a dedicated, content-free D1 read instead of attributing the
 * duration of an entire scheduled workflow to the database dependency.
 * A slow successful read is still degraded evidence: it proves reachability,
 * but not healthy request-path latency.
 */
export async function recordScheduledD1HealthEvidence(
  env: DependencyHealthEvidenceEnv,
  clock: D1HealthProbeClock = {},
): Promise<boolean> {
  const nowMs = clock.nowMs ?? Date.now;
  const now = clock.now ?? (() => new Date());
  const startedAt = nowMs();
  try {
    const value = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
    const checkedAt = now();
    const latencyMs = dependencyHealthLatencyMs(startedAt, checkedAt.getTime());
    if (value?.ok !== 1) {
      return recordDependencyHealthEvidence(env, {
        key: "d1",
        state: "degraded",
        safeErrorCode: "DEPENDENCY_UNAVAILABLE",
        evidenceKind: "synthetic_probe",
        startedAt,
      }, checkedAt);
    }
    return recordDependencyHealthEvidence(env, latencyMs > D1_HEALTH_DEGRADED_LATENCY_MS
      ? {
        key: "d1",
        state: "degraded",
        safeErrorCode: "PROBE_LATENCY_HIGH",
        evidenceKind: "synthetic_probe",
        startedAt,
      }
      : {
        key: "d1",
        state: "operational",
        evidenceKind: "synthetic_probe",
        startedAt,
      }, checkedAt);
  } catch {
    const checkedAt = now();
    return recordDependencyHealthEvidence(env, {
      key: "d1",
      state: "degraded",
      safeErrorCode: "DEPENDENCY_UNAVAILABLE",
      evidenceKind: "synthetic_probe",
      startedAt,
    }, checkedAt);
  }
}

/**
 * A completed Builder generation has already written the final files to
 * private R2 and committed their metadata in D1. Record only that completed
 * technical fact, never document IDs, file names, workspace IDs or content.
 *
 * These are integration events rather than synthetic probes. The per-key
 * throttle keeps routine user traffic from turning the append-only health
 * ledger into a copy of product activity.
 */
export async function recordDocumentBuilderCompletionEvidence(
  env: DependencyHealthEvidenceEnv,
  startedAt: number,
  now = new Date(),
): Promise<void> {
  await Promise.all([
    recordDependencyHealthEvidence(env, {
      key: "document_builder",
      state: "operational",
      evidenceKind: "integration_event",
      startedAt,
      minimumOperationalIntervalMs: 30 * 60_000,
    }, now),
    recordDependencyHealthEvidence(env, {
      key: "private_r2",
      state: "operational",
      evidenceKind: "integration_event",
      startedAt,
      minimumOperationalIntervalMs: 10 * 60_000,
    }, now),
    recordDependencyHealthEvidence(env, {
      key: "d1",
      state: "operational",
      evidenceKind: "integration_event",
      startedAt,
      minimumOperationalIntervalMs: 10 * 60_000,
    }, now),
  ]);
}

/**
 * A lawyer-area observation is emitted only after the access-grant batch
 * atomically creates the grant, updates the handoff, records consent and
 * writes the audit event. It contains no participant or case identifiers.
 */
export async function recordLawyerAccessGrantCompletionEvidence(
  env: DependencyHealthEvidenceEnv,
  startedAt: number,
  now = new Date(),
): Promise<void> {
  await Promise.all([
    recordDependencyHealthEvidence(env, {
      key: "lawyer_area",
      state: "operational",
      evidenceKind: "integration_event",
      startedAt,
      minimumOperationalIntervalMs: 30 * 60_000,
    }, now),
    recordDependencyHealthEvidence(env, {
      key: "d1",
      state: "operational",
      evidenceKind: "integration_event",
      startedAt,
      minimumOperationalIntervalMs: 10 * 60_000,
    }, now),
  ]);
}

export function providerFailureEvidence(
  provider: "openai" | "anthropic",
  code: string,
  diagnosticSafeErrorCode: ProviderDiagnosticSafeErrorCode | null = null,
): Pick<FailedEvidence, "key" | "state" | "safeErrorCode"> {
  const normalized = code.toUpperCase();
  const key = provider;
  if (diagnosticSafeErrorCode) {
    return { key, state: "degraded", safeErrorCode: diagnosticSafeErrorCode };
  }
  if (normalized.includes("CONFIG") || normalized.includes("NOT_CONFIGURED")) {
    return { key, state: "outage", safeErrorCode: "PROBE_CONFIGURATION_ERROR" };
  }
  if (
    normalized.includes("AUTH")
    || normalized.includes("HTTP_401")
    || normalized.includes("HTTP_403")
  ) {
    return { key, state: "outage", safeErrorCode: "PROBE_AUTH_ERROR" };
  }
  if (normalized.includes("TIMEOUT")) {
    return { key, state: "degraded", safeErrorCode: "PROVIDER_TIMEOUT" };
  }
  return { key, state: "degraded", safeErrorCode: "PROVIDER_UNAVAILABLE" };
}
