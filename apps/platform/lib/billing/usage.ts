import { requireD1 } from "../document-builder/storage/runtime";
import { workspaceEntitlements, type WorkspaceEntitlements } from "./entitlements";

export type UsageMetric = "drafts" | "pages";

export class SubscriptionLimitError extends Error {
  constructor(readonly code: "PLAN_LIMIT" | "PAGES_PER_RUN_LIMIT" | "WORKSPACE_TERM_EXPIRED" | "TEMPLATE_PLAN_UNAVAILABLE" | "USAGE_CONFLICT") {
    super(code);
  }
}

export function subscriptionFailure(error: unknown) {
  if (!(error instanceof Error)) return null;
  const status = {
    ACTIVE_CASE_LIMIT: 409,
    SUBSCRIPTION_STORAGE_LIMIT: 409,
    SUBSCRIPTION_FILE_LIMIT: 413,
    WORKSPACE_TERM_EXPIRED: 403,
    TEMPLATE_PLAN_UNAVAILABLE: 403,
    PAGES_PER_RUN_LIMIT: 422,
    PLAN_LIMIT: 429,
    USAGE_CONFLICT: 409,
  }[error.message];
  return status === undefined ? null : { status, code: error.message };
}

export function accountingPages(text: string, scannedPages = 0) {
  return Math.max(scannedPages, Math.ceil(Array.from(text).length / 2_500));
}

export function selectAccountingPages(text: string, first: number, last: number) {
  return Array.from(text).slice((first - 1) * 2_500, last * 2_500).join("");
}

export async function workspaceUsage(
  db: D1Database, workspaceId: string, userId: string, terms: WorkspaceEntitlements,
) {
  const [answers, documentUsage, capacity] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(units),0) AS used FROM ai_usage_ledger
      WHERE workspace_id=? AND (?::boolean OR user_id=?) AND feature='legal_chat'
        AND period_start=? AND status='consumed'`)
      .bind(workspaceId, terms.pooled, userId, terms.periodStart).first<{ used: number }>(),
    db.prepare(`SELECT metric,SUM(units) AS used FROM subscription_usage
      WHERE workspace_id=? AND (?::boolean OR user_id=?) AND period_start=? AND status='consumed'
      GROUP BY metric`).bind(workspaceId, terms.pooled, userId, terms.periodStart)
      .all<{ metric: UsageMetric; used: number }>(),
    db.prepare(`SELECT
      (SELECT count(*) FROM cases WHERE workspace_id=? AND archived_at IS NULL AND status <> 'completed') AS cases,
      subscription_storage_bytes(?) AS bytes`)
      .bind(workspaceId, workspaceId).first<{ cases: number; bytes: number }>(),
  ]);
  return {
    answers: Number(answers?.used ?? 0),
    drafts: Number(documentUsage.results.find(row => row.metric === "drafts")?.used ?? 0),
    pages: Number(documentUsage.results.find(row => row.metric === "pages")?.used ?? 0),
    cases: Number(capacity?.cases ?? 0),
    bytes: Number(capacity?.bytes ?? 0),
  };
}

export type UsageOperation = {
  workspaceId: string;
  userId: string;
  metric: UsageMetric;
  operationId: string;
};

export async function reserveSubscriptionUsage(input: UsageOperation & {
  units: number; requestHash: string; db?: D1Database; resume?: boolean;
}) {
  const db = input.db ?? requireD1();
  const { workspaceId, userId, metric, operationId, units, requestHash } = input;
  const terms = await workspaceEntitlements(db, workspaceId);
  if (terms.readOnly) throw new SubscriptionLimitError("WORKSPACE_TERM_EXPIRED");
  if (!Number.isSafeInteger(units) || units < 0) throw new SubscriptionLimitError("USAGE_CONFLICT");
  if (metric === "pages" && terms.version !== null && units > terms.limits.pagesPerRun) {
    throw new SubscriptionLimitError("PAGES_PER_RUN_LIMIT");
  }
  const limit = terms.version === null ? null : terms.limits[metric];
  const [, reserved, existing] = await db.batch<{ requestHash: string; units: number; status: string }>([
    db.prepare("SELECT pg_advisory_xact_lock(hashtextextended(?,0))")
      .bind(`subscription-usage:${workspaceId}:${metric}`),
    db.prepare(`INSERT INTO subscription_usage
      (workspace_id,user_id,metric,operation_id,request_hash,period_start,period_end,units,status)
      SELECT ?,?,?,?,?,?,?,?,'reserved'
      WHERE EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND status='active')
        AND (?::integer IS NULL OR ?::integer <= ?::integer - (
          SELECT COALESCE(sum(units),0) FROM subscription_usage WHERE workspace_id=? AND metric=?
          AND period_start=? AND (?::boolean OR user_id=?) AND status IN ('reserved','consumed')
        ))
      ON CONFLICT (workspace_id,user_id,metric,operation_id) DO UPDATE
      SET status='reserved',period_start=excluded.period_start,period_end=excluded.period_end,reserved_at=clock_timestamp()
      WHERE subscription_usage.status='released' AND subscription_usage.request_hash=excluded.request_hash
        AND subscription_usage.units=excluded.units`)
      .bind(workspaceId,userId,metric,operationId,requestHash,terms.periodStart,terms.periodEnd,units,
        workspaceId,userId,limit,units,limit,workspaceId,metric,terms.periodStart,terms.pooled,userId),
    db.prepare(`SELECT request_hash AS requestHash,units,status FROM subscription_usage
      WHERE workspace_id=? AND user_id=? AND metric=? AND operation_id=?`)
      .bind(workspaceId,userId,metric,operationId),
  ]);
  if (reserved.meta.changes === 1) return "reserved" as const;
  const previous = existing.results[0];
  if (!previous) throw new SubscriptionLimitError("PLAN_LIMIT");
  if (previous.requestHash !== requestHash || Number(previous.units) !== units) throw new SubscriptionLimitError("USAGE_CONFLICT");
  if (previous.status === "consumed") return "consumed" as const;
  if (input.resume && previous.status === "reserved") return "reserved" as const;
  throw new SubscriptionLimitError(previous.status === "released" ? "PLAN_LIMIT" : "USAGE_CONFLICT");
}

export function settleSubscriptionUsage(db: D1Database, input: UsageOperation, consumed: boolean) {
  return db.prepare(`UPDATE subscription_usage SET status=? WHERE workspace_id=? AND user_id=?
    AND metric=? AND operation_id=? AND status='reserved'`)
    .bind(consumed ? "consumed" : "released", input.workspaceId, input.userId, input.metric, input.operationId);
}

export async function companyMemberUsage(db: D1Database, workspaceId: string, periodStart: string) {
  return (await db.prepare(`WITH activity AS (
    SELECT user_id,'answers' AS metric,units FROM ai_usage_ledger
      WHERE workspace_id=? AND period_start=? AND feature='legal_chat' AND status='consumed'
    UNION ALL
    SELECT user_id,metric,units FROM subscription_usage
      WHERE workspace_id=? AND period_start=? AND status='consumed'
  )
  SELECT activity.user_id AS userId,coalesce(nullif(p.full_name,''),activity.user_id) AS name,
    coalesce(sum(units) FILTER (WHERE metric='answers'),0) AS answers,
    coalesce(sum(units) FILTER (WHERE metric='drafts'),0) AS drafts,
    coalesce(sum(units) FILTER (WHERE metric='pages'),0) AS pages
  FROM activity LEFT JOIN user_profiles p ON p.id=activity.user_id
  GROUP BY activity.user_id,p.full_name ORDER BY name,activity.user_id`)
    .bind(workspaceId,periodStart,workspaceId,periodStart)
    .all<{ userId: string; name: string; answers: number; drafts: number; pages: number }>()).results;
}
