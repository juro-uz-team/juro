import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createDemoPaymentRun,
  listDemoPaymentRuns,
  transitionDemoPaymentRun,
} from "../lib/billing/demo-payments";
import { paymentDemoStatus } from "../lib/billing/foundation";
import { demoPaymentInputSchema } from "../lib/billing/input";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const ids = {
  user: "11111111-1111-4111-8111-111111111111",
  workspace: "ws_demo_payment_owner",
  request: "22222222-2222-4222-8222-222222222222",
};

function fixture() {
  const result = sqliteD1Fixture();
  const now = "2026-08-09T00:00:00.000Z";
  result.sqlite.prepare(`INSERT INTO user_profiles(id,email,locale,account_type,created_at,updated_at)
    VALUES (?,?,'ru','individual',?,?)`).run(ids.user, "demo-payment@example.test", now, now);
  result.sqlite.prepare(`INSERT INTO workspaces(id,type,name,locale,created_at,updated_at)
    VALUES (?,'individual','Demo payment','ru',?,?)`).run(ids.workspace, now, now);
  return result;
}

test("production demo availability is explicit and cannot imply a real provider", () => {
  assert.deepEqual(paymentDemoStatus({ APP_ENV: "production", DB: {} as D1Database, PAYMENT_PRODUCTION_DEMO_ENABLED: "true" }), {
    enabled: true,
    provider: "demo",
    isSimulation: true,
    externalNetwork: false,
    entitlementsActivated: false,
    reason: "ready",
  });
  assert.equal(paymentDemoStatus({ APP_ENV: "production", DB: {} as D1Database }).enabled, false);
});

test("demo schema bounds amounts, flow types and lifecycle actions", () => {
  assert.equal(demoPaymentInputSchema.safeParse({ action: "create", requestId: ids.request, locale: "ru", flowType: "subscription", amountMinor: 10_000 }).success, true);
  assert.equal(demoPaymentInputSchema.safeParse({ action: "create", requestId: ids.request, locale: "ru", flowType: "real_card", amountMinor: 10_000 }).success, false);
  assert.equal(demoPaymentInputSchema.safeParse({ action: "transition", requestId: ids.request, locale: "uz", runId: ids.request, outcome: "charge_card" }).success, false);
});

test("subscription demo is idempotent, append-only and cannot activate entitlements", async () => {
  const { sqlite, d1 } = fixture();
  try {
    const actor = { userId: ids.user, workspaceId: ids.workspace };
    const created = await createDemoPaymentRun(d1, actor, { requestId: ids.request, flowType: "subscription", amountMinor: 12_000_000 });
    const replay = await createDemoPaymentRun(d1, actor, { requestId: ids.request, flowType: "subscription", amountMinor: 12_000_000 });
    assert.equal(created.id, replay.id);
    assert.equal(created.provider, "demo");
    assert.equal(created.isSimulation, 1);
    const succeeded = await transitionDemoPaymentRun(d1, actor, { requestId: "33333333-3333-4333-8333-333333333333", runId: created.id, action: "succeed" });
    assert.equal(succeeded.status, "succeeded");
    const refunded = await transitionDemoPaymentRun(d1, actor, { requestId: "44444444-4444-4444-8444-444444444444", runId: created.id, action: "refund" });
    assert.equal(refunded.status, "refunded");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM demo_payment_runs").get()?.count, 1);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM demo_payment_events").get()?.count, 3);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM subscriptions").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM subscription_entitlements").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM payments").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM marketplace_orders").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM ledger_transactions").get()?.count, 0);
    assert.throws(() => sqlite.prepare("DELETE FROM demo_payment_runs WHERE id=?").run(created.id), /DEMO_PAYMENT_RUN_APPEND_ONLY/);
    assert.throws(() => sqlite.prepare("UPDATE demo_payment_events SET status='failed' WHERE run_id=?").run(created.id), /DEMO_PAYMENT_EVENT_IMMUTABLE/);
  } finally {
    sqlite.close();
  }
});

test("lawyer payout is simulation-only and tenant scoped", async () => {
  const { sqlite, d1 } = fixture();
  try {
    const actor = { userId: ids.user, workspaceId: ids.workspace };
    const created = await createDemoPaymentRun(d1, actor, { requestId: ids.request, flowType: "lawyer_service", amountMinor: 50_000_000 });
    await transitionDemoPaymentRun(d1, actor, { requestId: "55555555-5555-4555-8555-555555555555", runId: created.id, action: "succeed" });
    const paid = await transitionDemoPaymentRun(d1, actor, { requestId: "66666666-6666-4666-8666-666666666666", runId: created.id, action: "payout" });
    assert.equal(paid.status, "paid_out");
    assert.deepEqual(await listDemoPaymentRuns(d1, { userId: ids.user, workspaceId: "ws_other_tenant" }), []);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM lawyer_payables").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM settlement_allocations").get()?.count, 0);
  } finally {
    sqlite.close();
  }
});

test("demo payment route and UI retain auth, CSRF, tenant and truthful-label contracts", async () => {
  const [route, ui, billing, migration, config] = await Promise.all([
    readFile(new URL("../app/api/platform/demo-payments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/DemoPaymentsClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/BillingClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0111_production_demo_payments.sql", import.meta.url), "utf8"),
    readFile(new URL("../lib/runtime/self-hosted.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /requireApiUser/);
  assert.match(route, /assertSafeWrite/);
  assert.match(route, /workspaceForUserById/);
  assert.match(route, /paymentDemoStatus/);
  assert.match(ui, /provider=demo/);
  assert.match(ui, /isSimulation=true/);
  assert.match(ui, /не создаёт подписку/);
  assert.doesNotMatch(ui, /(?:name|id)=["'](?:cardNumber|cvv|pan|expiry)["']/i);
  assert.match(billing, /demo-payments/);
  assert.match(migration, /`provider` text DEFAULT 'demo'/);
  assert.match(migration, /`is_simulation` integer DEFAULT 1/);
  assert.match(migration, /DEMO_PAYMENT_EVENT_IMMUTABLE/);
  assert.match(config, /PAYMENT_FOUNDATION_ENABLED: "false"/);
});
