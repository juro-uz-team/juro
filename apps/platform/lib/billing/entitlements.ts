import { subscriptionPlans, type PlanLimits, type PricingPlanCode } from "../../config/pricing";

const legacyAnswers = { individual: 120, business: 300, legal_team: 600 } as const;
type LegacyPlan = keyof typeof legacyAnswers;

export type WorkspaceEntitlements = {
  planCode: PricingPlanCode | LegacyPlan;
  subscriptionStatus: string | null;
  version: number | null;
  aiAnswerCyclesMonthly: number;
  limits: PlanLimits;
  periodStart: string;
  periodEnd: string;
  termEndsAt: string | null;
  pooled: boolean;
  readOnly: boolean;
  lawyerHandoff: boolean;
  fullDocumentAnalysis: boolean;
  expertDocumentAnalysis: boolean;
  documentComparison: boolean;
};

export type AiAnswerCycleLimit = number | null;
export type AnswerPeriod = Pick<WorkspaceEntitlements, "periodStart" | "periodEnd" | "pooled" | "readOnly">;

type SubscriptionEvidence = {
  planCode: string;
  status: string;
  startedAt?: string | null;
  currentPeriodEndsAt: string | null;
  planVersion?: number | null;
  termsJson?: string | null;
};

const activeStatuses = new Set(["active", "trialing"]);

function savedLimits(subscription: SubscriptionEvidence, fallback: PlanLimits): PlanLimits {
  try {
    const data = JSON.parse(subscription.termsJson ?? "null") as { access?: string; limits?: PlanLimits } | null;
    const stored = data?.limits;
    if (data?.access === subscription.planCode && stored &&
      (Object.keys(fallback) as Array<keyof PlanLimits>).every(key => Number.isSafeInteger(stored[key]) && stored[key] > 0)) {
      return stored;
    }
  } catch { /* Legacy billing versions did not carry these terms. */ }
  return fallback;
}

function nextAnniversary(anchor: Date, offset: number) {
  const local = new Date(anchor.getTime() + 5 * 60 * 60_000);
  const originalDay = local.getUTCDate();
  local.setUTCDate(1);
  local.setUTCMonth(local.getUTCMonth() + offset);
  const days = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 0)).getUTCDate();
  local.setUTCDate(Math.min(originalDay, days));
  return new Date(local.getTime() - 5 * 60 * 60_000);
}

export function subscriptionPeriod(now: Date, startedAt?: string | null, endsAt?: string | null) {
  const anchor = new Date(startedAt ?? "");
  if (!Number.isFinite(anchor.getTime()) || anchor > now) {
    return {
      periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
    };
  }
  const localMonth = (date: Date) => {
    const local = new Date(date.getTime() + 5 * 60 * 60_000);
    return local.getUTCFullYear() * 12 + local.getUTCMonth();
  };
  let month = localMonth(now) - localMonth(anchor);
  if (nextAnniversary(anchor, month) > now) month--;
  const end = nextAnniversary(anchor, month + 1);
  const termEnd = new Date(endsAt ?? "");
  return {
    periodStart: nextAnniversary(anchor, month).toISOString(),
    periodEnd: (termEnd > now && termEnd < end ? termEnd : end).toISOString(),
  };
}

export function entitlementsForSubscription(
  subscription: SubscriptionEvidence | null,
  now = new Date(),
  companyWorkspace = false,
): WorkspaceEntitlements {
  const end = subscription?.currentPeriodEndsAt ?? null;
  const endTime = end === null ? Infinity : Date.parse(end);
  const active = !!subscription && activeStatuses.has(subscription.status) && endTime > now.getTime()
    && (!subscription.startedAt || Date.parse(subscription.startedAt) <= now.getTime());
  const plan = active && subscription
    ? subscriptionPlans.find(candidate => candidate.code === subscription.planCode)
    : undefined;
  const legacy = active && subscription && Object.hasOwn(legacyAnswers, subscription.planCode)
    ? subscription.planCode as LegacyPlan : null;
  const effective = plan ?? subscriptionPlans[0];
  const limits = plan && subscription ? savedLimits(subscription, plan.limits) : effective.limits;
  const advanced = !!legacy || effective.code === "advanced" || effective.code === "company" || effective.code === "lawyer";
  return {
    planCode: legacy ?? effective.code,
    subscriptionStatus: subscription?.status ?? null,
    version: legacy ? null : plan ? subscription?.planVersion ?? plan.version : effective.version,
    limits: legacy ? { ...subscriptionPlans[2].limits, answers: legacyAnswers[legacy] } : limits,
    aiAnswerCyclesMonthly: legacy ? legacyAnswers[legacy] : limits.answers,
    ...subscriptionPeriod(now, effective.code === "free" ? null : subscription?.startedAt, end),
    termEndsAt: end,
    pooled: effective.code === "company" || (!legacy && effective.code === "free" && companyWorkspace),
    readOnly: companyWorkspace && subscription?.planCode === "company" && endTime <= now.getTime(),
    lawyerHandoff: true,
    fullDocumentAnalysis: effective.code !== "free" || !!legacy,
    expertDocumentAnalysis: advanced,
    documentComparison: advanced,
  };
}

export async function workspaceEntitlements(
  db: D1Database,
  workspaceId: string,
  now = new Date(),
): Promise<WorkspaceEntitlements> {
  const row = await db.prepare(
    `SELECT w.type AS workspaceType,s.plan_code AS planCode,s.status,
      s.started_at AS startedAt,s.current_period_ends_at AS currentPeriodEndsAt,
      v.version AS planVersion,v.entitlements_json AS termsJson
     FROM workspaces w LEFT JOIN subscriptions s ON s.workspace_id=w.id
     LEFT JOIN subscription_plan_versions v ON v.id=s.plan_version_id WHERE w.id=?`,
  ).bind(workspaceId).first<SubscriptionEvidence & { workspaceType: string }>();
  return entitlementsForSubscription(row?.planCode ? row : null, now, row?.workspaceType === "business");
}

export function resolveAiAnswerCycleLimit(
  environment: "development" | "staging" | "production" | undefined,
  entitlementLimit: number,
): AiAnswerCycleLimit {
  return environment === "development" ? null : entitlementLimit;
}
