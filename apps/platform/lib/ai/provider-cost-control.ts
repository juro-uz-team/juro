import { z } from "zod";
import type { ProviderName } from "./provider-usage";

const ENVIRONMENTS = ["development", "staging", "production"] as const;
const PROVIDERS = ["openai", "anthropic"] as const;
const MAX_COST_MICROUSD = 1_000_000_000_000_000;

export type ProviderEnvironment = (typeof ENVIRONMENTS)[number];
export type ProviderCircuitReason = "manual" | "daily_cost_limit" | "failure_spike";

export const costGuardPolicyMutationSchema = z.object({
  provider: z.enum(PROVIDERS),
  dailyCostLimitMicrousd: z.number().int().min(1).max(MAX_COST_MICROUSD),
  rollingFailureLimit: z.number().int().min(2).max(100_000),
  rollingWindowMinutes: z.number().int().min(1).max(1_440),
  enabled: z.boolean().default(true),
  effectiveFrom: z.string().datetime({ offset: true }),
}).strict();

export const providerCircuitMutationSchema = z.object({
  provider: z.enum(PROVIDERS),
  state: z.enum(["open", "closed"]),
}).strict();

export class ProviderCostControlError extends Error {
  constructor(
    readonly code:
      | "PROVIDER_COST_CONTROL_INVALID"
      | "PROVIDER_COST_CONTROL_PERSISTENCE_FAILED"
      | "PROVIDER_CIRCUIT_OPEN",
    readonly provider?: ProviderName,
    readonly reason?: ProviderCircuitReason,
  ) {
    super(code);
    this.name = "ProviderCostControlError";
  }
}

export type CostGuardPolicyView = {
  id: string;
  environment: ProviderEnvironment;
  provider: ProviderName;
  dailyCostLimitMicrousd: number;
  rollingFailureLimit: number;
  rollingWindowMinutes: number;
  enabled: number;
  effectiveFrom: string;
  createdAt: string;
};

export type ProviderCircuitView = {
  environment: ProviderEnvironment;
  provider: ProviderName;
  state: "open" | "closed";
  reason: ProviderCircuitReason | null;
  observedValue: number | null;
  thresholdValue: number | null;
  openedAt: string | null;
  closedAt: string | null;
  updatedAt: string;
};

export type CostControlEventView = {
  id: string;
  environment: ProviderEnvironment;
  provider: ProviderName;
  transition: "opened" | "closed";
  reason: ProviderCircuitReason;
  observedValue: number | null;
  thresholdValue: number | null;
  actorUserId: string | null;
  createdAt: string;
};

export type OperationalAlertView = {
  id: string;
  provider: ProviderName;
  reason: ProviderCircuitReason;
  status: "pending" | "sending" | "retrying" | "sent" | "failed";
  attemptCount: number;
  errorCode: string | null;
  createdAt: string;
  sentAt: string | null;
};

export type ProviderCostControlDashboard = {
  policies: CostGuardPolicyView[];
  circuits: ProviderCircuitView[];
  events: CostControlEventView[];
  alerts: OperationalAlertView[];
};

type ActivePolicy = {
  dailyCostLimitMicrousd: number;
  rollingFailureLimit: number;
  rollingWindowMinutes: number;
  enabled: number;
};

function canonicalTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new ProviderCostControlError("PROVIDER_COST_CONTROL_INVALID");
  return new Date(timestamp).toISOString();
}

function environmentValue(value: string): ProviderEnvironment {
  if ((ENVIRONMENTS as readonly string[]).includes(value)) return value as ProviderEnvironment;
  throw new ProviderCostControlError("PROVIDER_COST_CONTROL_INVALID");
}

async function activePolicy(
  db: D1Database,
  environment: ProviderEnvironment,
  provider: ProviderName,
  now: string,
): Promise<ActivePolicy | null> {
  return db.prepare(
    `SELECT daily_cost_limit_microusd AS dailyCostLimitMicrousd,
      rolling_failure_limit AS rollingFailureLimit,
      rolling_window_minutes AS rollingWindowMinutes,enabled
     FROM ai_cost_guard_policy_versions
     WHERE environment=? AND provider=? AND effective_from<=?
     ORDER BY effective_from DESC,id DESC LIMIT 1`,
  ).bind(environment, provider, now).first<ActivePolicy>();
}

export async function assertProviderCallAllowed(input: {
  db: D1Database;
  environment: ProviderEnvironment;
  provider: ProviderName;
}): Promise<void> {
  const row = await input.db.prepare(
    `SELECT state,reason FROM ai_provider_circuit_states
     WHERE environment=? AND provider=? LIMIT 1`,
  ).bind(input.environment, input.provider).first<{
    state: "open" | "closed";
    reason: ProviderCircuitReason | null;
  }>();
  if (row?.state === "open") {
    throw new ProviderCostControlError(
      "PROVIDER_CIRCUIT_OPEN",
      input.provider,
      row.reason ?? "manual",
    );
  }
}

async function transitionOpen(input: {
  db: D1Database;
  environment: ProviderEnvironment;
  provider: ProviderName;
  reason: ProviderCircuitReason;
  observedValue: number | null;
  thresholdValue: number | null;
  actorUserId: string | null;
  now: string;
}): Promise<boolean> {
  const eventId = crypto.randomUUID();
  const alertId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();
  try {
    await input.db.batch([
      input.db.prepare(
        `INSERT INTO ai_provider_circuit_states
         (environment,provider,state,reason,current_event_id,observed_value,threshold_value,
          opened_at,closed_at,updated_by_user_id,updated_at)
         VALUES (?,?,'open',?,?,?,?,?,NULL,?,?)
         ON CONFLICT(environment,provider) DO UPDATE SET
          state='open',reason=excluded.reason,current_event_id=excluded.current_event_id,
          observed_value=excluded.observed_value,threshold_value=excluded.threshold_value,
          opened_at=excluded.opened_at,closed_at=NULL,
          updated_by_user_id=excluded.updated_by_user_id,updated_at=excluded.updated_at
         WHERE ai_provider_circuit_states.state='closed'`,
      ).bind(
        input.environment,
        input.provider,
        input.reason,
        eventId,
        input.observedValue,
        input.thresholdValue,
        input.now,
        input.actorUserId,
        input.now,
      ),
      input.db.prepare(
        `INSERT INTO ai_cost_control_events
         (id,environment,provider,transition,reason,observed_value,threshold_value,actor_user_id,created_at)
         SELECT ?,?,?,'opened',?,?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM ai_provider_circuit_states
           WHERE environment=? AND provider=? AND state='open' AND current_event_id=?
         )`,
      ).bind(
        eventId,
        input.environment,
        input.provider,
        input.reason,
        input.observedValue,
        input.thresholdValue,
        input.actorUserId,
        input.now,
        input.environment,
        input.provider,
        eventId,
      ),
      input.db.prepare(
        `INSERT INTO operational_alert_jobs
         (id,cost_control_event_id,environment,provider,alert_type,severity,reason,
          observed_value,threshold_value,status,attempt_count,provider_message_id,sent_at,error_code,
          created_at,updated_at)
         SELECT ?,?,?,?,'ai_provider_circuit_opened','critical',?,?,?,'pending',0,NULL,NULL,NULL,?,?
         WHERE EXISTS (SELECT 1 FROM ai_cost_control_events WHERE id=? AND transition='opened')`,
      ).bind(
        alertId,
        eventId,
        input.environment,
        input.provider,
        input.reason,
        input.observedValue,
        input.thresholdValue,
        input.now,
        input.now,
        eventId,
      ),
      input.db.prepare(
        `INSERT INTO job_outbox
         (id,queue_binding,job_type,schema_version,idempotency_key,subject_id,workspace_id,
          correlation_id,enqueued_at,available_at,status,dispatch_attempts,created_at,updated_at)
         SELECT ?,'EMAIL_NOTIFICATIONS_QUEUE','email.send',1,?,?,NULL,?,?,?,'pending',0,?,?
         WHERE EXISTS (SELECT 1 FROM operational_alert_jobs WHERE id=? AND status='pending')`,
      ).bind(
        outboxId,
        `operations_alert_${alertId}`,
        alertId,
        `cost_circuit_${eventId}`,
        input.now,
        input.now,
        input.now,
        input.now,
        alertId,
      ),
    ]);
  } catch {
    throw new ProviderCostControlError("PROVIDER_COST_CONTROL_PERSISTENCE_FAILED");
  }
  const state = await input.db.prepare(
    `SELECT current_event_id AS eventId FROM ai_provider_circuit_states
     WHERE environment=? AND provider=? LIMIT 1`,
  ).bind(input.environment, input.provider).first<{ eventId: string }>();
  return state?.eventId === eventId;
}

export async function evaluateProviderCostControl(input: {
  db: D1Database;
  environment: ProviderEnvironment;
  provider: ProviderName;
  now: string;
}): Promise<{ opened: boolean; reason: ProviderCircuitReason | null }> {
  const now = canonicalTimestamp(input.now);
  const policy = await activePolicy(input.db, input.environment, input.provider, now);
  if (!policy || policy.enabled !== 1) return { opened: false, reason: null };

  const usageDay = now.slice(0, 10);
  const cost = await input.db.prepare(
    `SELECT COALESCE(sum(estimated_cost_microusd),0) AS value
     FROM ai_cost_daily_aggregates WHERE environment=? AND usage_day=? AND provider=?`,
  ).bind(input.environment, usageDay, input.provider).first<{ value: number }>();
  const dailyCost = Number(cost?.value ?? 0);
  if (dailyCost >= policy.dailyCostLimitMicrousd) {
    return {
      opened: await transitionOpen({
        ...input,
        now,
        reason: "daily_cost_limit",
        observedValue: dailyCost,
        thresholdValue: policy.dailyCostLimitMicrousd,
        actorUserId: null,
      }),
      reason: "daily_cost_limit",
    };
  }

  const windowStart = new Date(Date.parse(now) - policy.rollingWindowMinutes * 60_000).toISOString();
  const failures = await input.db.prepare(
    `SELECT count(*) AS value FROM ai_provider_usage_events
     WHERE environment=? AND provider=? AND status='failed' AND completed_at>=? AND completed_at<=?`,
  ).bind(input.environment, input.provider, windowStart, now).first<{ value: number }>();
  const failureCount = Number(failures?.value ?? 0);
  if (failureCount >= policy.rollingFailureLimit) {
    return {
      opened: await transitionOpen({
        ...input,
        now,
        reason: "failure_spike",
        observedValue: failureCount,
        thresholdValue: policy.rollingFailureLimit,
        actorUserId: null,
      }),
      reason: "failure_spike",
    };
  }
  return { opened: false, reason: null };
}

export async function createCostGuardPolicyVersion(input: {
  db: D1Database;
  environment: ProviderEnvironment;
  actorUserId: string | null;
  value: z.input<typeof costGuardPolicyMutationSchema>;
  now?: Date;
}): Promise<{ id: string }> {
  const value = costGuardPolicyMutationSchema.parse(input.value);
  const now = input.now ?? new Date();
  const effectiveFrom = canonicalTimestamp(value.effectiveFrom);
  if (Date.parse(effectiveFrom) > now.getTime() + 366 * 24 * 60 * 60 * 1_000) {
    throw new ProviderCostControlError("PROVIDER_COST_CONTROL_INVALID");
  }
  const id = crypto.randomUUID();
  try {
    await input.db.prepare(
      `INSERT INTO ai_cost_guard_policy_versions
       (id,environment,provider,daily_cost_limit_microusd,rolling_failure_limit,
        rolling_window_minutes,enabled,effective_from,created_by_user_id,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      input.environment,
      value.provider,
      value.dailyCostLimitMicrousd,
      value.rollingFailureLimit,
      value.rollingWindowMinutes,
      value.enabled ? 1 : 0,
      effectiveFrom,
      input.actorUserId,
      now.toISOString(),
    ).run();
  } catch {
    throw new ProviderCostControlError("PROVIDER_COST_CONTROL_PERSISTENCE_FAILED");
  }
  return { id };
}

export async function setProviderCircuitState(input: {
  db: D1Database;
  environment: ProviderEnvironment;
  provider: ProviderName;
  state: "open" | "closed";
  actorUserId: string | null;
  now?: Date;
}): Promise<{ changed: boolean }> {
  const now = (input.now ?? new Date()).toISOString();
  if (input.state === "open") {
    return {
      changed: await transitionOpen({
        db: input.db,
        environment: input.environment,
        provider: input.provider,
        reason: "manual",
        observedValue: null,
        thresholdValue: null,
        actorUserId: input.actorUserId,
        now,
      }),
    };
  }

  const eventId = crypto.randomUUID();
  try {
    await input.db.batch([
      input.db.prepare(
        `UPDATE ai_provider_circuit_states SET
          state='closed',reason=NULL,current_event_id=?,observed_value=NULL,threshold_value=NULL,
          opened_at=NULL,closed_at=?,updated_by_user_id=?,updated_at=?
         WHERE environment=? AND provider=? AND state='open'`,
      ).bind(
        eventId,
        now,
        input.actorUserId,
        now,
        input.environment,
        input.provider,
      ),
      input.db.prepare(
        `INSERT INTO ai_cost_control_events
         (id,environment,provider,transition,reason,observed_value,threshold_value,actor_user_id,created_at)
         SELECT ?,?,?,'closed','manual',NULL,NULL,?,?
         WHERE EXISTS (
           SELECT 1 FROM ai_provider_circuit_states
           WHERE environment=? AND provider=? AND state='closed' AND current_event_id=?
         )`,
      ).bind(
        eventId,
        input.environment,
        input.provider,
        input.actorUserId,
        now,
        input.environment,
        input.provider,
        eventId,
      ),
    ]);
  } catch {
    throw new ProviderCostControlError("PROVIDER_COST_CONTROL_PERSISTENCE_FAILED");
  }
  const state = await input.db.prepare(
    `SELECT current_event_id AS eventId FROM ai_provider_circuit_states
     WHERE environment=? AND provider=? LIMIT 1`,
  ).bind(input.environment, input.provider).first<{ eventId: string }>();
  return { changed: state?.eventId === eventId };
}

export async function readProviderCostControlDashboard(input: {
  db: D1Database;
  environment: ProviderEnvironment;
}): Promise<ProviderCostControlDashboard> {
  const [policies, circuits, events, alerts] = await Promise.all([
    input.db.prepare(
      `SELECT id,environment,provider,daily_cost_limit_microusd AS dailyCostLimitMicrousd,
        rolling_failure_limit AS rollingFailureLimit,rolling_window_minutes AS rollingWindowMinutes,
        enabled,effective_from AS effectiveFrom,created_at AS createdAt
       FROM ai_cost_guard_policy_versions WHERE environment=?
       ORDER BY effective_from DESC,created_at DESC LIMIT 100`,
    ).bind(input.environment).all<CostGuardPolicyView>(),
    input.db.prepare(
      `SELECT environment,provider,state,reason,observed_value AS observedValue,
        threshold_value AS thresholdValue,opened_at AS openedAt,closed_at AS closedAt,
        updated_at AS updatedAt
       FROM ai_provider_circuit_states WHERE environment=? ORDER BY provider`,
    ).bind(input.environment).all<ProviderCircuitView>(),
    input.db.prepare(
      `SELECT id,environment,provider,transition,reason,observed_value AS observedValue,
        threshold_value AS thresholdValue,actor_user_id AS actorUserId,created_at AS createdAt
       FROM ai_cost_control_events WHERE environment=? ORDER BY created_at DESC LIMIT 100`,
    ).bind(input.environment).all<CostControlEventView>(),
    input.db.prepare(
      `SELECT id,provider,reason,status,attempt_count AS attemptCount,error_code AS errorCode,
        created_at AS createdAt,sent_at AS sentAt
       FROM operational_alert_jobs WHERE environment=? ORDER BY created_at DESC LIMIT 100`,
    ).bind(input.environment).all<OperationalAlertView>(),
  ]);
  const byProvider = new Map(circuits.results.map((row) => [row.provider, row]));
  const now = new Date().toISOString();
  const completeCircuits = PROVIDERS.map((provider) => byProvider.get(provider) ?? {
    environment: input.environment,
    provider,
    state: "closed" as const,
    reason: null,
    observedValue: null,
    thresholdValue: null,
    openedAt: null,
    closedAt: null,
    updatedAt: now,
  });
  return {
    policies: policies.results,
    circuits: completeCircuits,
    events: events.results,
    alerts: alerts.results,
  };
}

export function parseProviderEnvironment(value: string | undefined): ProviderEnvironment {
  return environmentValue(value ?? "development");
}
