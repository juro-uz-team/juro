import { z } from "zod";
import {
  evaluateProviderCostControl,
  readProviderCostControlDashboard,
  type ProviderCostControlDashboard,
} from "./provider-cost-control";

const PROVIDERS = ["openai", "anthropic"] as const;
const MAX_RATE_MICROUSD = 1_000_000_000_000;

export type ProviderName = (typeof PROVIDERS)[number];

type PriceRow = {
  id: string;
  inputRate: number;
  outputRate: number;
  cachedInputRate: number;
};

export type ProviderUsageInput = {
  db: D1Database;
  environment: "development" | "staging" | "production";
  workspaceId: string | null;
  userId: string | null;
  feature: string;
  operation: string;
  provider: ProviderName;
  model: string;
  providerRequestId?: string | null;
  inputTokens: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  /** False means token counts are storage placeholders, never measured usage. */
  usageObserved?: boolean;
  itemCount?: number;
  dimensions?: number | null;
  status: "succeeded" | "failed";
  errorCode?: string | null;
  startedAt: string;
  completedAt: string;
  eventId?: string;
};

export type ProviderUsageRecord = {
  id: string;
  priceVersionId: string | null;
  estimatedCostMicrousd: number | null;
};

export type AiModelPriceView = {
  id: string;
  provider: ProviderName;
  model: string;
  operation: string;
  inputMicrousdPerMillionTokens: number;
  outputMicrousdPerMillionTokens: number;
  cachedInputMicrousdPerMillionTokens: number;
  currency: "USD";
  effectiveFrom: string;
  sourceUrl: string | null;
  createdAt: string;
};

export type AiCostDailyView = {
  usageDay: string;
  feature: string;
  operation: string;
  provider: ProviderName;
  model: string;
  requestCount: number;
  failedRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  estimatedCostMicrousd: number;
  unpricedRequestCount: number;
};

export type AiCostDashboard = {
  prices: AiModelPriceView[];
  daily: AiCostDailyView[];
  unpricedEvents: number;
} & ProviderCostControlDashboard;

export class ProviderUsageError extends Error {
  constructor(readonly code: "PROVIDER_USAGE_INVALID" | "PROVIDER_USAGE_PERSISTENCE_FAILED") {
    super(code);
    this.name = "ProviderUsageError";
  }
}

/** The usage transaction is durable; only its subsequent control check failed. */
export class ProviderUsageControlError extends ProviderUsageError {
  constructor(readonly recorded: ProviderUsageRecord) {
    super("PROVIDER_USAGE_PERSISTENCE_FAILED");
    this.name = "ProviderUsageControlError";
  }
}

const priceMutationSchema = z.object({
  provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1).max(120).regex(/^[A-Za-z0-9._:-]+$/),
  operation: z.string().trim().min(1).max(64).regex(/^[a-z0-9._-]+$/),
  inputMicrousdPerMillionTokens: z.number().int().min(0).max(MAX_RATE_MICROUSD),
  outputMicrousdPerMillionTokens: z.number().int().min(0).max(MAX_RATE_MICROUSD).default(0),
  cachedInputMicrousdPerMillionTokens: z.number().int().min(0).max(MAX_RATE_MICROUSD).default(0),
  effectiveFrom: z.string().datetime({ offset: true }),
  sourceUrl: z.string().url().max(500).nullable().optional(),
}).strict();

export const aiModelPriceMutationSchema = priceMutationSchema;

function cleanIdentifier(value: string, max: number, pattern: RegExp): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > max || !pattern.test(normalized)) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  return normalized;
}

function safeInteger(value: number | undefined, fallback = 0): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 0) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  return candidate;
}

function canonicalTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  return new Date(timestamp).toISOString();
}

function safeProviderRequestId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 255 && /^[A-Za-z0-9._:-]+$/.test(normalized)
    ? normalized
    : null;
}

async function activePrice(
  db: D1Database,
  provider: ProviderName,
  model: string,
  operation: string,
  completedAt: string,
): Promise<PriceRow | null> {
  return db.prepare(
    `SELECT id,input_microusd_per_million_tokens AS inputRate,
      output_microusd_per_million_tokens AS outputRate,
      cached_input_microusd_per_million_tokens AS cachedInputRate
     FROM ai_model_price_versions
     WHERE provider=? AND model=? AND operation=? AND effective_from<=?
     ORDER BY effective_from DESC,id DESC LIMIT 1`,
  ).bind(provider, model, operation, completedAt).first<PriceRow>();
}

function estimatedCost(input: {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  price: PriceRow;
}): number {
  const uncached = Math.max(0, input.inputTokens - input.cachedInputTokens);
  const numerator = BigInt(uncached) * BigInt(input.price.inputRate)
    + BigInt(input.cachedInputTokens) * BigInt(input.price.cachedInputRate)
    + BigInt(input.outputTokens) * BigInt(input.price.outputRate);
  const cost = (numerator + 999_999n) / 1_000_000n;
  if (cost > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  return Number(cost);
}

async function aggregateId(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("\n")));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `cost_${hex.slice(0, 59)}`;
}

export async function recordProviderUsage(input: ProviderUsageInput): Promise<ProviderUsageRecord> {
  const feature = cleanIdentifier(input.feature, 64, /^[a-z0-9._-]+$/);
  const operation = cleanIdentifier(input.operation, 64, /^[a-z0-9._-]+$/);
  const model = cleanIdentifier(input.model, 120, /^[A-Za-z0-9._:-]+$/);
  const startedAt = canonicalTimestamp(input.startedAt);
  const completedAt = canonicalTimestamp(input.completedAt);
  if (Date.parse(completedAt) < Date.parse(startedAt)) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  if ((input.workspaceId === null) !== (input.userId === null)) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  const inputTokens = safeInteger(input.inputTokens);
  const outputTokens = safeInteger(input.outputTokens);
  const cachedInputTokens = safeInteger(input.cachedInputTokens);
  if (cachedInputTokens > inputTokens) throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  const itemCount = safeInteger(input.itemCount);
  const dimensions = input.dimensions === null || input.dimensions === undefined
    ? null
    : safeInteger(input.dimensions);
  if (dimensions !== null && dimensions === 0) throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  const errorCode = input.status === "failed"
    ? cleanIdentifier(input.errorCode || "PROVIDER_REQUEST_FAILED", 100, /^[A-Z0-9._-]+$/)
    : null;
  // A response rejected after parsing may still report billable tokens.
  // Its failed outcome is independent of that observed usage.
  const hasObservedUsage = input.usageObserved ?? (input.status === "succeeded" || inputTokens > 0 || outputTokens > 0);
  if (!hasObservedUsage && (inputTokens || outputTokens || cachedInputTokens)) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  const price = hasObservedUsage
    ? await activePrice(input.db, input.provider, model, operation, completedAt)
    : null;
  const cost = price
    ? estimatedCost({ inputTokens, outputTokens, cachedInputTokens, price })
    : null;
  const eventId = input.eventId || crypto.randomUUID();
  if (!/^[A-Za-z0-9._:-]{1,180}$/.test(eventId)) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  const usageDay = completedAt.slice(0, 10);
  const scopeKey = input.workspaceId && input.userId
    ? `${input.workspaceId}:${input.userId}`
    : "system";
  const dailyId = await aggregateId([
    input.environment,
    usageDay,
    scopeKey,
    feature,
    operation,
    input.provider,
    model,
  ]);
  const now = completedAt;
  try {
    await input.db.batch([
      input.db.prepare(
        `INSERT INTO ai_provider_usage_events
         (id,environment,usage_day,workspace_id,user_id,feature,operation,provider,model,
          provider_request_id,request_count,input_tokens,output_tokens,cached_input_tokens,
          item_count,dimensions,status,error_code,price_version_id,estimated_cost_microusd,
          started_at,completed_at,created_at,usage_observed)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        eventId,
        input.environment,
        usageDay,
        input.workspaceId,
        input.userId,
        feature,
        operation,
        input.provider,
        model,
        safeProviderRequestId(input.providerRequestId),
        inputTokens,
        outputTokens,
        cachedInputTokens,
        itemCount,
        dimensions,
        input.status,
        errorCode,
        price?.id ?? null,
        cost,
        startedAt,
        completedAt,
        now,
        hasObservedUsage ? 1 : 0,
      ),
      input.db.prepare(
        `INSERT INTO ai_cost_daily_aggregates
         (id,environment,usage_day,scope_key,workspace_id,user_id,feature,operation,provider,model,
          request_count,failed_request_count,input_tokens,output_tokens,cached_input_tokens,
          estimated_cost_microusd,unpriced_request_count,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
          request_count=ai_cost_daily_aggregates.request_count+1,
          failed_request_count=ai_cost_daily_aggregates.failed_request_count+excluded.failed_request_count,
          input_tokens=ai_cost_daily_aggregates.input_tokens+excluded.input_tokens,
          output_tokens=ai_cost_daily_aggregates.output_tokens+excluded.output_tokens,
          cached_input_tokens=ai_cost_daily_aggregates.cached_input_tokens+excluded.cached_input_tokens,
          estimated_cost_microusd=ai_cost_daily_aggregates.estimated_cost_microusd+excluded.estimated_cost_microusd,
          unpriced_request_count=ai_cost_daily_aggregates.unpriced_request_count+excluded.unpriced_request_count,
          updated_at=excluded.updated_at`,
      ).bind(
        dailyId,
        input.environment,
        usageDay,
        scopeKey,
        input.workspaceId,
        input.userId,
        feature,
        operation,
        input.provider,
        model,
        input.status === "failed" ? 1 : 0,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        cost ?? 0,
        hasObservedUsage && !price ? 1 : 0,
        now,
        now,
      ),
    ]);
  } catch {
    throw new ProviderUsageError("PROVIDER_USAGE_PERSISTENCE_FAILED");
  }
  try {
    await evaluateProviderCostControl({
      db: input.db,
      environment: input.environment,
      provider: input.provider,
      now: completedAt,
    });
  } catch {
    throw new ProviderUsageControlError({id: eventId, priceVersionId: price?.id ?? null, estimatedCostMicrousd: cost});
  }
  return { id: eventId, priceVersionId: price?.id ?? null, estimatedCostMicrousd: cost };
}

function priceSourceAllowed(provider: ProviderName, value: string | null | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  const host = url.hostname.toLowerCase();
  const allowed = provider === "openai"
    ? host === "openai.com" || host.endsWith(".openai.com")
    : host === "anthropic.com" || host.endsWith(".anthropic.com");
  if (!allowed) throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  url.hash = "";
  return url.toString();
}

export async function createAiModelPriceVersion(input: {
  db: D1Database;
  actorUserId: string;
  value: z.input<typeof priceMutationSchema>;
  now?: Date;
}): Promise<{ id: string }> {
  const value = priceMutationSchema.parse(input.value);
  const now = input.now ?? new Date();
  const effectiveFrom = canonicalTimestamp(value.effectiveFrom);
  if (Date.parse(effectiveFrom) > now.getTime() + 366 * 24 * 60 * 60 * 1000) {
    throw new ProviderUsageError("PROVIDER_USAGE_INVALID");
  }
  const id = crypto.randomUUID();
  const sourceUrl = priceSourceAllowed(value.provider, value.sourceUrl);
  try {
    await input.db.prepare(
      `INSERT INTO ai_model_price_versions
       (id,provider,model,operation,input_microusd_per_million_tokens,
        output_microusd_per_million_tokens,cached_input_microusd_per_million_tokens,
        currency,effective_from,source_url,created_by_user_id,created_at)
       VALUES (?,?,?,?,?,?,?,'USD',?,?,?,?)`,
    ).bind(
      id,
      value.provider,
      value.model,
      value.operation,
      value.inputMicrousdPerMillionTokens,
      value.outputMicrousdPerMillionTokens,
      value.cachedInputMicrousdPerMillionTokens,
      effectiveFrom,
      sourceUrl,
      input.actorUserId,
      now.toISOString(),
    ).run();
  } catch {
    throw new ProviderUsageError("PROVIDER_USAGE_PERSISTENCE_FAILED");
  }
  return { id };
}

export async function readAiCostDashboard(input: {
  db: D1Database;
  environment: "development" | "staging" | "production";
  days?: number;
  now?: Date;
}): Promise<AiCostDashboard> {
  const days = Math.min(Math.max(input.days ?? 30, 1), 93);
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [prices, daily, unpriced, control] = await Promise.all([
    input.db.prepare(
      `SELECT id,provider,model,operation,
        input_microusd_per_million_tokens AS inputMicrousdPerMillionTokens,
        output_microusd_per_million_tokens AS outputMicrousdPerMillionTokens,
        cached_input_microusd_per_million_tokens AS cachedInputMicrousdPerMillionTokens,
        currency,effective_from AS effectiveFrom,source_url AS sourceUrl,created_at AS createdAt
       FROM ai_model_price_versions ORDER BY effective_from DESC,created_at DESC LIMIT 100`,
    ).all<AiModelPriceView>(),
    input.db.prepare(
      `SELECT usage_day AS usageDay,feature,operation,provider,model,
        sum(request_count) AS requestCount,sum(failed_request_count) AS failedRequestCount,
        sum(input_tokens) AS inputTokens,sum(output_tokens) AS outputTokens,
        sum(cached_input_tokens) AS cachedInputTokens,
        sum(estimated_cost_microusd) AS estimatedCostMicrousd,
        sum(unpriced_request_count) AS unpricedRequestCount
       FROM ai_cost_daily_aggregates
       WHERE environment=? AND usage_day>=?
       GROUP BY usage_day,feature,operation,provider,model
       ORDER BY usage_day DESC,estimatedCostMicrousd DESC LIMIT 500`,
    ).bind(input.environment, cutoff).all<AiCostDailyView>(),
    input.db.prepare(
      `SELECT count(*) AS count FROM ai_provider_usage_events
       WHERE environment=? AND (usage_observed=1 OR (usage_observed IS NULL AND status='succeeded'))
         AND price_version_id IS NULL`,
    ).bind(input.environment).first<{ count: number }>(),
    readProviderCostControlDashboard({ db: input.db, environment: input.environment }),
  ]);
  return {
    prices: prices.results,
    daily: daily.results,
    unpricedEvents: Number(unpriced?.count ?? 0),
    ...control,
  };
}
