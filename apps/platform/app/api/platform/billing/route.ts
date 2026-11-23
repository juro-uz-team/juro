import { pricingConfig } from "../../../../config/pricing";
import { parseJsonRequest } from "../../../../lib/auth/input";
import { workspaceEntitlements } from "../../../../lib/billing/entitlements";
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
        `SELECT id,provider,plan_code AS planCode,status,current_period_ends_at AS currentPeriodEndsAt,
          cancel_at_period_end AS cancelAtPeriodEnd,created_at AS createdAt,updated_at AS updatedAt
         FROM subscriptions WHERE workspace_id=? LIMIT 1`,
      ).bind(workspace.id),
      db.prepare(
        `SELECT id,amount_minor AS amountMinor,currency,status,created_at AS createdAt
         FROM payments WHERE workspace_id=? ORDER BY created_at DESC LIMIT 30`,
      ).bind(workspace.id),
    ]),
    workspaceEntitlements(db, workspace.id),
  ]);
  const [subscription, payments] = records;
  return response({
    provider: paymentFoundationStatus(runtimeEnv()),
    demo: paymentDemoStatus(runtimeEnv()),
    config: pricingConfig,
    subscription: subscription.results[0] ?? null,
    payments: payments.results,
    entitlements,
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
  if (!pricingConfig.plans.some((plan) => plan.code === parsed.data.planCode)) {
    return response({
      code: "PLAN_UNAVAILABLE",
      error: billingErrorMessage("PLAN_UNAVAILABLE", parsed.data.locale),
    }, 400);
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
