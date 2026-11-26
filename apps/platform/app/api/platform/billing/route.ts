import { pricingConfig } from "../../../../config/pricing";
import { parseJsonRequest } from "../../../../lib/auth/input";
import { aiAnswerCeilingQuery, effectiveAiAnswerLimit, workspaceEntitlements } from "../../../../lib/billing/entitlements";
import { billingPlanSelectionSchema } from "../../../../lib/billing/input";
import { billingErrorMessage } from "../../../../lib/billing/localization";
import { paymentProviderStatus } from "../../../../lib/billing/provider";
import { paymentDemoStatus, paymentFoundationStatus } from "../../../../lib/billing/foundation";
import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../lib/document-builder/auth/api";
import { requireD1, runtimeEnv } from "../../../../lib/document-builder/storage/runtime";
import { requireSelectedWorkspace } from "../../../../lib/platform/workspace";
import { canManageTeam } from "../../../../lib/platform/permissions";
import { companyMemberUsage, workspaceUsage } from "../../../../lib/billing/usage";
import { publishedDefinitions } from "../../../../lib/document-builder/registry/published";
import { templatesOnPlan } from "../../../../lib/document-builder/template-access";

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

export const GET = withApiErrors(async function GET(request: Request) {
  const user = await requireApiUser();
  const workspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const db = requireD1();
  const [records, entitlements] = await Promise.all([
    db.batch([
      db.prepare(
        `SELECT s.id,s.provider,s.plan_code AS planCode,s.status,s.current_period_ends_at AS currentPeriodEndsAt,
          s.cancel_at_period_end AS cancelAtPeriodEnd,s.created_at AS createdAt,s.updated_at AS updatedAt,
          v.name_ru AS planNameRu,v.name_uz AS planNameUz,v.name_en AS planNameEn
         FROM subscriptions s LEFT JOIN subscription_plan_versions v ON v.id=s.plan_version_id WHERE s.workspace_id=? LIMIT 1`,
      ).bind(workspace.id),
      db.prepare(
        `SELECT id,amount_minor AS amountMinor,currency,status,created_at AS createdAt
         FROM payments WHERE workspace_id=? AND ?::boolean ORDER BY created_at DESC LIMIT 30`,
      ).bind(workspace.id, workspace.role === "owner"),
    ]),
    workspaceEntitlements(db, workspace.id),
  ]);
  const [subscription, payments] = records;
  const [usage, members, professional, definitions, ceiling] = await Promise.all([
    workspaceUsage(db, workspace.id, user.id, entitlements),
    workspace.type === "business" && canManageTeam(workspace.role)
      ? companyMemberUsage(db, workspace.id, entitlements.periodStart) : [],
    workspace.type === "individual"
      ? db.prepare("SELECT marketplace_status AS status FROM lawyer_profiles WHERE user_id=? LIMIT 1").bind(user.id).first()
      : null,
    publishedDefinitions(),
    db.prepare(aiAnswerCeilingQuery).first<{ value: string }>(),
  ]);
  const templateCounts = Object.fromEntries(pricingConfig.plans.map(plan => {
    const available = templatesOnPlan(definitions, plan.code);
    return [plan.code, {
      total: available.length,
      ru: available.filter(template => template.languages.includes("ru")).length,
      uz: available.filter(template => template.languages.includes("uz")).length,
    }];
  }));
  return response({
    provider: paymentFoundationStatus(runtimeEnv()),
    demo: paymentDemoStatus(runtimeEnv()),
    config: pricingConfig,
    subscription: subscription.results[0] ?? null,
    payments: payments.results,
    entitlements,
    workspace,
    usage,
    answerLimit: effectiveAiAnswerLimit(entitlements.limits.answers, ceiling?.value),
    members,
    professional,
    templateCounts,
  });
});

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  await requireApiUser();
  const parsed = await parseJsonRequest(request, billingPlanSelectionSchema, 1_024);
  if (!parsed.ok) {
    return response({
      code: parsed.error.toUpperCase(),
    }, parsed.error === "payload_too_large" ? 413 : 400);
  }
  const provider = paymentProviderStatus();
  if (!provider.credentialsConfigured) {
    return response({
      code: "PAYMENT_PROVIDER_UNAVAILABLE",
      error: billingErrorMessage("PAYMENT_PROVIDER_UNAVAILABLE", parsed.data.locale),
    }, 503);
  }
  return response({
    code: "PAYMENT_ADAPTER_REQUIRED",
    error: billingErrorMessage("PAYMENT_ADAPTER_REQUIRED", parsed.data.locale),
  }, 501);
});
