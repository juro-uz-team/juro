import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertProviderCallAllowed,
  createCostGuardPolicyVersion,
  evaluateProviderCostControl,
  ProviderCostControlError,
  readProviderCostControlDashboard,
  setProviderCircuitState,
} from "../lib/ai/provider-cost-control";
import { createAiModelPriceVersion, recordProviderUsage } from "../lib/ai/provider-usage";
import {
  executeOperationalAlertEmail,
  OperationalAlertEmailError,
} from "../lib/operations/alert-email";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const now = "2026-08-04T15:00:00.000Z";

function seed(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]) {
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES ('guard-user','guard@example.test',?,?)")
    .run(now, now);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES ('guard-workspace','individual','Guard',?,?)")
    .run(now, now);
  sqlite.prepare(`INSERT INTO workspace_members
    (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
    VALUES ('guard-member','guard-workspace','guard-user','owner','active',?,?,?)`).run(now, now, now);
}

test("0082 opens exactly one durable cost circuit and queues one identifiers-only alert", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seed(sqlite);
    await createAiModelPriceVersion({
      db: d1,
      actorUserId: "guard-user",
      now: new Date(now),
      value: {
        provider: "openai",
        model: "gpt-cost-test",
        operation: "responses",
        inputMicrousdPerMillionTokens: 1_000_000,
        outputMicrousdPerMillionTokens: 0,
        cachedInputMicrousdPerMillionTokens: 0,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        sourceUrl: "https://openai.com/api/pricing/",
      },
    });
    await createCostGuardPolicyVersion({
      db: d1,
      environment: "development",
      actorUserId: "guard-user",
      now: new Date(now),
      value: {
        provider: "openai",
        dailyCostLimitMicrousd: 100,
        rollingFailureLimit: 5,
        rollingWindowMinutes: 15,
        enabled: true,
        effectiveFrom: "2026-08-04T14:00:00.000Z",
      },
    });
    await assertProviderCallAllowed({ db: d1, environment: "development", provider: "openai" });

    await recordProviderUsage({
      db: d1,
      environment: "development",
      workspaceId: "guard-workspace",
      userId: "guard-user",
      feature: "legal_chat",
      operation: "responses",
      provider: "openai",
      model: "gpt-cost-test",
      inputTokens: 100,
      status: "succeeded",
      startedAt: "2026-08-04T14:59:59.000Z",
      completedAt: now,
      eventId: "guard-cost-event",
    });

    await assert.rejects(
      () => assertProviderCallAllowed({ db: d1, environment: "development", provider: "openai" }),
      (error: unknown) => error instanceof ProviderCostControlError
        && error.code === "PROVIDER_CIRCUIT_OPEN"
        && error.reason === "daily_cost_limit",
    );
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM ai_cost_control_events").get() as { count: number }).count, 1);
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM operational_alert_jobs").get() as { count: number }).count, 1);
    const outbox = sqlite.prepare(
      "SELECT job_type AS jobType,queue_binding AS queueBinding,workspace_id AS workspaceId FROM job_outbox WHERE idempotency_key LIKE 'operations_alert_%'",
    ).get() as { jobType: string; queueBinding: string; workspaceId: string | null };
    assert.deepEqual({ ...outbox }, {
      jobType: "email.send",
      queueBinding: "EMAIL_NOTIFICATIONS_QUEUE",
      workspaceId: null,
    });

    const repeated = await evaluateProviderCostControl({
      db: d1,
      environment: "development",
      provider: "openai",
      now: "2026-08-04T15:00:01.000Z",
    });
    assert.deepEqual(repeated, { opened: false, reason: "daily_cost_limit" });
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM operational_alert_jobs").get() as { count: number }).count, 1);

    assert.deepEqual(await setProviderCircuitState({
      db: d1,
      environment: "development",
      provider: "openai",
      state: "closed",
      actorUserId: "guard-user",
      now: new Date("2026-08-04T15:01:00.000Z"),
    }), { changed: true });
    await assertProviderCallAllowed({ db: d1, environment: "development", provider: "openai" });
    const dashboard = await readProviderCostControlDashboard({ db: d1, environment: "development" });
    assert.equal(dashboard.policies.length, 1);
    assert.equal(dashboard.circuits.find((row) => row.provider === "openai")?.state, "closed");
    assert.deepEqual(dashboard.events.map((event) => event.transition), ["closed", "opened"]);
    assert.throws(
      () => sqlite.prepare("DELETE FROM ai_cost_control_events").run(),
      /AI_COST_CONTROL_EVENT_IMMUTABLE/,
    );
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("0082 opens a provider circuit after the configured rolling failure spike", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seed(sqlite);
    await createCostGuardPolicyVersion({
      db: d1,
      environment: "staging",
      actorUserId: "guard-user",
      now: new Date(now),
      value: {
        provider: "anthropic",
        dailyCostLimitMicrousd: 10_000_000,
        rollingFailureLimit: 2,
        rollingWindowMinutes: 10,
        enabled: true,
        effectiveFrom: "2026-08-04T14:00:00.000Z",
      },
    });
    for (const [index, completedAt] of [
      "2026-08-04T14:59:00.000Z",
      "2026-08-04T15:00:00.000Z",
    ].entries()) {
      await recordProviderUsage({
        db: d1,
        environment: "staging",
        workspaceId: "guard-workspace",
        userId: "guard-user",
        feature: "document_analysis",
        operation: "messages",
        provider: "anthropic",
        model: "claude-test",
        inputTokens: 0,
        status: "failed",
        errorCode: "PROVIDER_HTTP_529",
        startedAt: completedAt,
        completedAt,
        eventId: `failure-${index}`,
      });
    }
    const state = sqlite.prepare(
      "SELECT state,reason,observed_value AS observed,threshold_value AS threshold FROM ai_provider_circuit_states WHERE environment='staging' AND provider='anthropic'",
    ).get() as Record<string, unknown>;
    assert.deepEqual({ ...state }, {
      state: "open",
      reason: "failure_spike",
      observed: 2,
      threshold: 2,
    });
  } finally {
    sqlite.close();
  }
});

test("0082 operational alert email is idempotent and stores no recipient", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    seed(sqlite);
    await setProviderCircuitState({
      db: d1,
      environment: "staging",
      provider: "openai",
      state: "open",
      actorUserId: "guard-user",
      now: new Date(now),
    });
    const alert = sqlite.prepare("SELECT id FROM operational_alert_jobs").get() as { id: string };
    globalThis.fetch = async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; html: string };
      assert.deepEqual(body.to, ["muzaffarbekmurodoff@gmail.com"]);
      assert.match(body.subject, /staging.*openai/i);
      assert.doesNotMatch(body.html, /guard@example\.test|guard-workspace/);
      return Response.json({ id: "resend_alert_1" });
    };
    const env = {
      DB: d1,
      RESEND_API_KEY: "synthetic-resend-key",
      EMAIL_FROM: "JURO <no-reply@juro.uz>",
      OPERATIONS_ALERT_EMAIL: "muzaffarbekmurodoff@gmail.com",
    };
    assert.deepEqual(await executeOperationalAlertEmail(env, alert.id), {
      providerMessageId: "resend_alert_1",
      alreadySent: false,
    });
    assert.deepEqual(await executeOperationalAlertEmail(env, alert.id), {
      providerMessageId: "resend_alert_1",
      alreadySent: true,
    });
    assert.equal(calls, 1);
    const columns = (sqlite.prepare("PRAGMA table_info(operational_alert_jobs)").all() as Array<{ name: string }>).map((row) => row.name);
    assert.equal(columns.some((column) => column.includes("recipient") || column.includes("email")), false);
  } finally {
    globalThis.fetch = originalFetch;
    sqlite.close();
  }
});

test("0082 alert delivery fails closed when operations email config is absent", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seed(sqlite);
    await setProviderCircuitState({
      db: d1,
      environment: "development",
      provider: "anthropic",
      state: "open",
      actorUserId: "guard-user",
      now: new Date(now),
    });
    const alert = sqlite.prepare("SELECT id FROM operational_alert_jobs").get() as { id: string };
    await assert.rejects(
      () => executeOperationalAlertEmail({ DB: d1 }, alert.id),
      (error: unknown) => error instanceof OperationalAlertEmailError
        && error.code === "OPERATIONAL_ALERT_CONFIGURATION_UNAVAILABLE"
        && error.retryable === false,
    );
    const state = sqlite.prepare("SELECT status,error_code AS errorCode FROM operational_alert_jobs").get();
    assert.deepEqual({ ...(state as Record<string, unknown>) }, {
      status: "failed",
      errorCode: "OPERATIONAL_ALERT_CONFIGURATION_UNAVAILABLE",
    });
  } finally {
    sqlite.close();
  }
});

test("document-analysis and operational controls retain provider cost safeguards", () => {
  const documentProcessor = readFileSync(new URL("../lib/document-analysis/processor.ts", import.meta.url), "utf8");
  const adminRoute = readFileSync(new URL("../app/api/platform/admin/costs/route.ts", import.meta.url), "utf8");
  const adminClient = readFileSync(new URL("../app/_staff/CostConsole.tsx", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../worker/platform-jobs.ts", import.meta.url), "utf8");

  assert.match(documentProcessor, /assertProviderCallAllowed/);
  assert.match(documentProcessor, /beforeProviderCall/);
  assert.match(documentProcessor, /recordProviderUsage/);
  assert.match(documentProcessor, /PROVIDER_CIRCUIT_OPEN/);
  assert.match(adminRoute, /requirePlatformStaffRequest\(request, "staff\.operations\.manage", \{ freshMfaWithinMs: 15 \* 60 \* 1000 \}\)/);
  assert.match(adminRoute, /assertSafeWrite\(request\)/);
  assert.match(adminClient, /action: "policy"/);
  assert.match(adminClient, /action: "circuit"/);
  assert.match(worker, /executeOperationalAlertEmail/);
  assert.match(worker, /operational_alert_jobs/);
  assert.doesNotMatch(adminClient, /dangerouslySetInnerHTML|transition:\s*all/);
});
