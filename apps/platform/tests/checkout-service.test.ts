import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BillingDomainError, confirmSubscriptionCheckout, createSubscriptionCheckout, readCheckoutOrder } from "../lib/billing/checkout-service";
import { paymentFoundationStatus } from "../lib/billing/foundation";
import { checkoutConfirmSchema, checkoutCreateSchema } from "../lib/billing/input";
import { finalizeSandboxPayment } from "../lib/billing/payment-finalization";
import { signSandboxWebhook, verifySandboxWebhook } from "../lib/billing/sandbox-provider";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
  plan: "33333333-3333-4333-8333-333333333333",
  planVersion: "44444444-4444-4444-8444-444444444444",
  policy: "55555555-5555-4555-8555-555555555555",
  policyVersion: "66666666-6666-4666-8666-666666666666",
  taxProfile: "77777777-7777-4777-8777-777777777777",
  createRequest: "88888888-8888-4888-8888-888888888888",
  confirmRequest: "99999999-9999-4999-8999-999999999999",
};

function seededBilling() {
  const fixture = sqliteD1Fixture();
  const { sqlite } = fixture;
  const now = "2026-08-03T00:00:00.000Z";
  sqlite.prepare(`INSERT INTO user_profiles(id,email,locale,account_type,created_at,updated_at)
    VALUES (?,?,?,'individual',?,?)`).run(ids.user, "billing@example.test", "ru", now, now);
  sqlite.prepare(`INSERT INTO workspaces(id,type,name,locale,created_at,updated_at)
    VALUES (?,'individual','Billing test','ru',?,?)`).run(ids.workspace, now, now);
  sqlite.prepare("INSERT INTO pricing_policies(id,code,name,status,created_at,updated_at) VALUES (?,?,?,'approved',?,?)")
    .run(ids.policy, "subscription_standard", "Standard subscription", now, now);
  sqlite.prepare(`INSERT INTO pricing_policy_versions(
    id,policy_id,version,currency,provider_commission_rate_basis_points,vat_rate_basis_points,
    provider_fee_bearer,basis,effective_from,approval_status,approved_by_user_id,approved_at,
    created_by_user_id,created_at
  ) VALUES (?,?,1,'UZS',0,1200,'PLATFORM_ABSORBS','approved test policy',?,'approved',?,?,?,?)`)
    .run(ids.policyVersion, ids.policy, now, ids.user, now, ids.user, now);
  sqlite.prepare(`INSERT INTO tax_profiles(
    id,subject_type,subject_id,service_type,payer_status,tax_model,vat_rate_basis_points,
    effective_from,approval_status,approved_by_user_id,approved_at,version,created_at,updated_at
  ) VALUES (?,'PLATFORM','JURO','SUBSCRIPTION','VAT_PAYER','VAT_ON_PLATFORM_REVENUE_ONLY',1200,
    ?,'approved',?,?,1,?,?)`).run(ids.taxProfile, now, ids.user, now, now, now);
  sqlite.prepare("INSERT INTO subscription_plans(id,code,status,created_at,updated_at) VALUES (?,?,'active',?,?)")
    .run(ids.plan, "individual", now, now);
  sqlite.prepare(`INSERT INTO subscription_plan_versions(
    id,plan_id,version,name_ru,name_uz,name_en,billing_period,price_minor,currency,entitlements_json,
    effective_from,approval_status,approved_by_user_id,approved_at,created_by_user_id,created_at
  ) VALUES (?,?,1,'Личная подписка','Shaxsiy obuna','Personal plan','monthly',1000000,'UZS','{}',?,'approved',?,?,?,?)`)
    .run(ids.planVersion, ids.plan, now, ids.user, now, ids.user, now);
  return fixture;
}

test("payment foundation is fail-closed in production and sandbox never enables there", () => {
  assert.deepEqual(paymentFoundationStatus({ APP_ENV: "production", DB: {} as D1Database, PAYMENT_FOUNDATION_ENABLED: "true", PAYMENT_SANDBOX_ENABLED: "true", PAYMENT_PRODUCTION_APPROVED: "false" }), {
    enabled: false, sandboxEnabled: false, productionApproved: false, reason: "production_approval_required",
  });
  assert.deepEqual(paymentFoundationStatus({ APP_ENV: "staging", DB: {} as D1Database, PAYMENT_FOUNDATION_ENABLED: "true", PAYMENT_SANDBOX_ENABLED: "true", PAYMENT_PRODUCTION_APPROVED: "false" }), {
    enabled: true, sandboxEnabled: true, productionApproved: false, reason: "ready",
  });
});

test("checkout schemas reject unbounded identifiers and unknown payment methods", () => {
  assert.equal(checkoutCreateSchema.safeParse({ requestId: ids.createRequest, planVersionId: ids.planVersion, locale: "ru" }).success, true);
  assert.equal(checkoutCreateSchema.safeParse({ requestId: "retry", planVersionId: ids.planVersion, locale: "ru" }).success, false);
  assert.equal(checkoutConfirmSchema.safeParse({ requestId: ids.confirmRequest, locale: "uz", accountType: "individual", renewalMode: "AUTO_RENEW", paymentMethod: "SANDBOX_CARD" }).success, true);
  assert.equal(checkoutConfirmSchema.safeParse({ requestId: ids.confirmRequest, locale: "uz", accountType: "individual", renewalMode: "AUTO_RENEW", paymentMethod: "raw_card" }).success, false);
});

test("subscription checkout is tenant-scoped, priced once, and replay-safe", async () => {
  const { sqlite, d1 } = seededBilling();
  try {
    const actor = { userId: ids.user, workspaceId: ids.workspace };
    const first = await createSubscriptionCheckout(d1, actor, { requestId: ids.createRequest, planVersionId: ids.planVersion }, new Date("2026-08-03T10:00:00.000Z"));
    const replay = await createSubscriptionCheckout(d1, actor, { requestId: ids.createRequest, planVersionId: ids.planVersion }, new Date("2026-08-03T10:00:01.000Z"));
    assert.equal(first.order.id, replay.order.id);
    assert.equal(first.order.status, "PRICED");
    assert.equal(first.pricingSnapshot?.clientTotalMinor, 1_120_000);
    assert.equal(first.pricingSnapshot?.juroVatAmountMinor, 120_000);
    assert.equal(first.items[0]?.titleEn, "Personal plan");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM marketplace_orders").get()?.count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pricing_snapshots").get()?.count, 1);
    assert.equal(await readCheckoutOrder(d1, { userId: ids.user, workspaceId: "other-workspace" }, String(first.order.id)), null);

    const confirmed = await confirmSubscriptionCheckout(d1, actor, String(first.order.id), {
      requestId: ids.confirmRequest,
      renewalMode: "AUTO_RENEW",
      checkoutUrl: `/ru/individual/orders/${String(first.order.id)}/payment`,
    }, new Date("2026-08-03T10:05:00.000Z"));
    const confirmReplay = await confirmSubscriptionCheckout(d1, actor, String(first.order.id), {
      requestId: ids.confirmRequest,
      renewalMode: "AUTO_RENEW",
      checkoutUrl: `/ru/individual/orders/${String(first.order.id)}/payment`,
    }, new Date("2026-08-03T10:05:01.000Z"));
    assert.equal(confirmed.order.status, "AWAITING_PAYMENT");
    assert.equal(confirmed.order.acceptedPricingSnapshotId, first.pricingSnapshot?.id);
    assert.equal(confirmReplay.paymentAttempt?.id, confirmed.paymentAttempt?.id);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payment_attempts").get()?.count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM consents WHERE type='subscription_checkout'").get()?.count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM subscriptions").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM ledger_transactions").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("checkout fails closed when approved pricing policy is missing", async () => {
  const { sqlite, d1 } = seededBilling();
  try {
    sqlite.prepare("UPDATE pricing_policies SET status='draft'").run();
    await assert.rejects(
      createSubscriptionCheckout(d1, { userId: ids.user, workspaceId: ids.workspace }, { requestId: ids.createRequest, planVersionId: ids.planVersion }, new Date("2026-08-03T10:00:00.000Z")),
      (error: unknown) => error instanceof BillingDomainError && error.code === "PRICING_POLICY_UNAVAILABLE",
    );
  } finally {
    sqlite.close();
  }
});

test("sandbox webhook signature rejects tampering and stale delivery", async () => {
  const secret = "sandbox-test-secret-that-is-at-least-32-bytes-long";
  const timestamp = "2026-08-03T10:00:00.000Z";
  const body = JSON.stringify({ eventId: ids.confirmRequest });
  const signature = await signSandboxWebhook(secret, timestamp, body);
  assert.equal(await verifySandboxWebhook(secret, timestamp, body, signature, new Date("2026-08-03T10:01:00.000Z")), true);
  assert.equal(await verifySandboxWebhook(secret, timestamp, `${body} `, signature, new Date("2026-08-03T10:01:00.000Z")), false);
  assert.equal(await verifySandboxWebhook(secret, timestamp, body, signature, new Date("2026-08-03T10:06:00.001Z")), false);
  assert.equal(await verifySandboxWebhook(secret, timestamp, body, "0".repeat(64), new Date("2026-08-03T10:01:00.000Z")), false);
});

test("verified funded event activates subscription exactly once and posts a balanced ledger", async () => {
  const { sqlite, d1 } = seededBilling();
  try {
    const actor = { userId: ids.user, workspaceId: ids.workspace };
    const checkout = await createSubscriptionCheckout(d1, actor, { requestId: ids.createRequest, planVersionId: ids.planVersion }, new Date("2026-08-03T10:00:00.000Z"));
    const confirmed = await confirmSubscriptionCheckout(d1, actor, String(checkout.order.id), {
      requestId: ids.confirmRequest,
      renewalMode: "ONE_TIME",
      checkoutUrl: `/ru/individual/orders/${String(checkout.order.id)}/payment`,
    }, new Date("2026-08-03T10:05:00.000Z"));
    const event = {
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "payment.funded" as const,
      providerAttemptId: String(confirmed.paymentAttempt?.providerAttemptId),
      amountMinor: Number(confirmed.paymentAttempt?.amountMinor),
      currency: "UZS" as const,
      occurredAt: "2026-08-03T10:06:00.000Z",
    };
    const raw = JSON.stringify(event);
    const funded = await finalizeSandboxPayment(d1, event, raw, new Date("2026-08-03T10:06:00.000Z"));
    const replay = await finalizeSandboxPayment(d1, event, raw, new Date("2026-08-03T10:06:01.000Z"));
    assert.equal(funded.replay, false);
    assert.equal(funded.orderStatus, "ACTIVE");
    assert.equal(replay.replay, true);
    assert.equal(sqlite.prepare("SELECT status FROM marketplace_orders WHERE id=?").get(checkout.order.id as string)?.status, "ACTIVE");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payments").get()?.count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM subscriptions WHERE status='active'").get()?.count, 1);
    assert.equal(sqlite.prepare("SELECT auto_renew_consent_at AS value FROM subscriptions").get()?.value, null);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payment_provider_events").get()?.count, 1);
    assert.equal(sqlite.prepare("SELECT status FROM subscription_invoices WHERE order_id=?").get(checkout.order.id as string)?.status, "paid");
    const ledger = sqlite.prepare("SELECT status,debit_total_minor AS debit,credit_total_minor AS credit FROM ledger_transactions").get() as { status: string; debit: number; credit: number };
    assert.equal(ledger.status, "posted");
    assert.equal(ledger.debit, 1_120_000);
    assert.equal(ledger.credit, 1_120_000);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get()?.count, 3);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("auto-renew activates only with the persisted order-scoped consent", async () => {
  const { sqlite, d1 } = seededBilling();
  try {
    const actor = { userId: ids.user, workspaceId: ids.workspace };
    const checkout = await createSubscriptionCheckout(d1, actor, { requestId: ids.createRequest, planVersionId: ids.planVersion }, new Date("2026-08-03T10:00:00.000Z"));
    const confirmed = await confirmSubscriptionCheckout(d1, actor, String(checkout.order.id), {
      requestId: ids.confirmRequest,
      renewalMode: "AUTO_RENEW",
      checkoutUrl: `/ru/individual/orders/${String(checkout.order.id)}/payment`,
    }, new Date("2026-08-03T10:05:00.000Z"));
    const event = {
      eventId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      type: "payment.funded" as const,
      providerAttemptId: String(confirmed.paymentAttempt?.providerAttemptId),
      amountMinor: Number(confirmed.paymentAttempt?.amountMinor),
      currency: "UZS" as const,
      occurredAt: "2026-08-03T10:06:00.000Z",
    };
    await finalizeSandboxPayment(d1, event, JSON.stringify(event), new Date("2026-08-03T10:06:00.000Z"));
    assert.equal(sqlite.prepare("SELECT auto_renew_consent_at AS value FROM subscriptions").get()?.value, "2026-08-03T10:06:00.000Z");
  } finally {
    sqlite.close();
  }
});

test("a late failure event cannot downgrade a settled order", async () => {
  const { sqlite, d1 } = seededBilling();
  try {
    const actor = { userId: ids.user, workspaceId: ids.workspace };
    const checkout = await createSubscriptionCheckout(d1, actor, { requestId: ids.createRequest, planVersionId: ids.planVersion }, new Date("2026-08-03T10:00:00.000Z"));
    const confirmed = await confirmSubscriptionCheckout(d1, actor, String(checkout.order.id), {
      requestId: ids.confirmRequest,
      renewalMode: "ONE_TIME",
      checkoutUrl: `/ru/individual/orders/${String(checkout.order.id)}/payment`,
    }, new Date("2026-08-03T10:05:00.000Z"));
    const providerAttemptId = String(confirmed.paymentAttempt?.providerAttemptId);
    const amountMinor = Number(confirmed.paymentAttempt?.amountMinor);
    const funded = { eventId: "abababab-abab-4bab-8bab-abababababab", type: "payment.funded" as const, providerAttemptId, amountMinor, currency: "UZS" as const, occurredAt: "2026-08-03T10:06:00.000Z" };
    await finalizeSandboxPayment(d1, funded, JSON.stringify(funded), new Date("2026-08-03T10:06:00.000Z"));
    const lateFailure = { eventId: "bcbcbcbc-bcbc-4cbc-8bcb-bcbcbcbcbcbc", type: "payment.failed" as const, providerAttemptId, amountMinor, currency: "UZS" as const, occurredAt: "2026-08-03T10:07:00.000Z" };
    await assert.rejects(finalizeSandboxPayment(d1, lateFailure, JSON.stringify(lateFailure), new Date("2026-08-03T10:07:00.000Z")), /PAYMENT_STATE_CONFLICT/);
    assert.equal(sqlite.prepare("SELECT status FROM marketplace_orders WHERE id=?").get(checkout.order.id as string)?.status, "ACTIVE");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payment_provider_events").get()?.count, 1);
  } finally {
    sqlite.close();
  }
});

test("sandbox funded event rejects amount mismatch before any financial side effect", async () => {
  const { sqlite, d1 } = seededBilling();
  try {
    const actor = { userId: ids.user, workspaceId: ids.workspace };
    const checkout = await createSubscriptionCheckout(d1, actor, { requestId: ids.createRequest, planVersionId: ids.planVersion }, new Date("2026-08-03T10:00:00.000Z"));
    const confirmed = await confirmSubscriptionCheckout(d1, actor, String(checkout.order.id), {
      requestId: ids.confirmRequest,
      renewalMode: "ONE_TIME",
      checkoutUrl: `/ru/individual/orders/${String(checkout.order.id)}/payment`,
    }, new Date("2026-08-03T10:05:00.000Z"));
    const event = {
      eventId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      type: "payment.funded" as const,
      providerAttemptId: String(confirmed.paymentAttempt?.providerAttemptId),
      amountMinor: Number(confirmed.paymentAttempt?.amountMinor) + 1,
      currency: "UZS" as const,
      occurredAt: "2026-08-03T10:06:00.000Z",
    };
    await assert.rejects(finalizeSandboxPayment(d1, event, JSON.stringify(event)), /PAYMENT_AMOUNT_MISMATCH/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payments").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM ledger_transactions").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payment_provider_events").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("declined sandbox payment can be retried without repricing or duplicate consent", async () => {
  const { sqlite, d1 } = seededBilling();
  try {
    const actor = { userId: ids.user, workspaceId: ids.workspace };
    const checkout = await createSubscriptionCheckout(d1, actor, { requestId: ids.createRequest, planVersionId: ids.planVersion }, new Date("2026-08-03T10:00:00.000Z"));
    const firstAttempt = await confirmSubscriptionCheckout(d1, actor, String(checkout.order.id), {
      requestId: ids.confirmRequest,
      renewalMode: "ONE_TIME",
      checkoutUrl: `/ru/individual/orders/${String(checkout.order.id)}/payment`,
    }, new Date("2026-08-03T10:05:00.000Z"));
    const declinedEvent = {
      eventId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      type: "payment.failed" as const,
      providerAttemptId: String(firstAttempt.paymentAttempt?.providerAttemptId),
      amountMinor: Number(firstAttempt.paymentAttempt?.amountMinor),
      currency: "UZS" as const,
      occurredAt: "2026-08-03T10:06:00.000Z",
    };
    await finalizeSandboxPayment(d1, declinedEvent, JSON.stringify(declinedEvent), new Date("2026-08-03T10:06:00.000Z"));
    const retried = await confirmSubscriptionCheckout(d1, actor, String(checkout.order.id), {
      requestId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      renewalMode: "ONE_TIME",
      checkoutUrl: `/ru/individual/orders/${String(checkout.order.id)}/payment`,
    }, new Date("2026-08-03T10:07:00.000Z"));
    assert.notEqual(retried.paymentAttempt?.providerAttemptId, firstAttempt.paymentAttempt?.providerAttemptId);
    assert.equal(retried.order.acceptedPricingSnapshotId, checkout.pricingSnapshot?.id);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM pricing_snapshots").get()?.count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payment_attempts").get()?.count, 2);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM consents WHERE type='subscription_checkout'").get()?.count, 1);
  } finally {
    sqlite.close();
  }
});

test("checkout routes and UI retain auth, CSRF, workspace, localization and feature-flag boundaries", async () => {
  const [createRoute, readRoute, confirmRoute, plansRoute, checkoutUi, paymentUi, billingUi] = await Promise.all([
    readFile(new URL("../app/api/checkout/create/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/checkout/[orderId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/checkout/[orderId]/confirm/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/subscriptions/plans/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/CheckoutClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/OrderPaymentClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/BillingClient.tsx", import.meta.url), "utf8"),
  ]);
  for (const source of [createRoute, readRoute, confirmRoute]) {
    assert.match(source, /requireApiUser/);
    assert.match(source, /workspaceForUser/);
    assert.match(source, /paymentFoundationStatus/);
  }
  assert.match(createRoute, /assertSafeWrite/);
  assert.match(confirmRoute, /assertSafeWrite/);
  assert.match(confirmRoute, /sandboxEnabled/);
  assert.doesNotMatch(createRoute + confirmRoute, /providerPaymentId.*success|status:\s*["']paid["']/i);
  for (const source of [checkoutUi, paymentUi]) {
    assert.match(source, /type PlatformLocale/);
    assert.match(source, /en:\s*\{/);
    assert.match(source, /en-GB/);
    assert.match(source, /x-juro-csrf/);
  }
  assert.match(plansRoute, /requireApiUser/);
  assert.match(plansRoute, /Response\.json\(pricingConfig,/);
  assert.match(checkoutUi, /titleEn/);
  assert.match(checkoutUi, /AUTO_RENEW/);
  assert.match(paymentUi, /sandbox-authorize/);
  assert.match(billingUi, /subscriptionPlans\.map/);
  assert.match(billingUi, /Plan purchases and renewals are currently unavailable/);
  assert.doesNotMatch(billingUi, /api\/checkout/);
});
