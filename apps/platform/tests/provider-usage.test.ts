import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createAiModelPriceVersion,
  ProviderUsageError,
  ProviderUsageControlError,
  readAiCostDashboard,
  recordProviderUsage,
} from "../lib/ai/provider-usage";
import { platformStaffRoleAllows } from "../lib/auth/staff-access";
import {createLegalChatAccounting} from "../lib/legal-chat/provider-accounting";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const now = "2026-08-04T12:00:00.000Z";

test("a post-commit control failure retains usage and permits later legal receipts", async context => {
  const {sqlite, d1} = sqliteD1Fixture();
  try {
    const prepare = d1.prepare.bind(d1);
    let failControl = true;
    context.mock.method(d1, "prepare", (sql: string) => {
      if (failControl && sql.includes("FROM ai_cost_guard_policy_versions")) {
        failControl = false;
        throw new Error("Control read unavailable after usage commit");
      }
      return prepare(sql);
    });
    const receipts = createLegalChatAccounting({db: d1, environment: "development", workspaceId: null,
      userId: null, feature: "legal_chat"});
    const observation = {provider: "openai" as const, model: "same-model", attempt: 1 as const,
      elapsedMs: 1, httpStatus: 200, outcome: "completed" as const, errorCode: null,
      usage: {inputTokens: 10, outputTokens: 2, cachedInputTokens: 0}};
    await assert.rejects(receipts.onAttemptFinished(observation), ProviderUsageControlError);
    await receipts.onAttemptFinished(observation);
    const dashboard = await readAiCostDashboard({db: d1, environment: "development"});
    assert.equal(failControl, false);
    assert.equal(dashboard.daily[0]!.requestCount, 2);
    assert.equal(dashboard.daily[0]!.inputTokens, 20);
  } finally {sqlite.close();}
});

test("legal request receipts retain completed and failed attempts with exact aggregate totals", async () => {
  const {sqlite, d1} = sqliteD1Fixture();
  try {
    const receipts = createLegalChatAccounting({db: d1, environment: "development", workspaceId: null,
      userId: null, feature: "legal_chat"});
    const observation = {provider: "openai" as const, model: "same-model", attempt: 1 as const,
      elapsedMs: 15, httpStatus: 200};
    await receipts.onAttempt();
    await receipts.onAttemptFinished({...observation, outcome: "completed", errorCode: null,
      usage: {inputTokens: 100, outputTokens: 20, cachedInputTokens: 10}});
    await receipts.onAttempt();
    await receipts.onAttemptFinished({...observation, outcome: "failed", errorCode: "PROVIDER_TIMEOUT", httpStatus: null, usage: null});
    await receipts.onAttempt();
    await receipts.onAttemptFinished({...observation, outcome: "failed", errorCode: "INVALID_AI_OUTPUT",
      usage: {inputTokens: 50, outputTokens: 5, cachedInputTokens: 0}});
    const dashboard = await readAiCostDashboard({db: d1, environment: "development"});
    assert.equal(dashboard.daily[0]!.requestCount, 3);
    assert.equal(dashboard.daily[0]!.failedRequestCount, 2);
    assert.equal(dashboard.daily[0]!.inputTokens, 150);
    assert.equal(dashboard.daily[0]!.outputTokens, 25);
    assert.deepEqual(receipts.totals(), {attempts: 3, inputTokens: 150, outputTokens: 25, cachedInputTokens: 10});
    assert.deepEqual(sqlite.prepare("SELECT status,usage_observed AS observed FROM ai_provider_usage_events ORDER BY status DESC,usage_observed")
      .all().map(row => [row.status, row.observed]), [["succeeded", 1], ["failed", 0], ["failed", 1]]);
  } finally {sqlite.close();}
});

test("a rejected provider response retains observed usage and its failed outcome", async () => {
  const {sqlite, d1} = sqliteD1Fixture();
  try {
    seed(sqlite);
    await createAiModelPriceVersion({db: d1, actorUserId: "cost-user", now: new Date(now), value: {
      provider: "openai", model: "observed-failure", operation: "responses",
      inputMicrousdPerMillionTokens: 1_000_000, outputMicrousdPerMillionTokens: 2_000_000,
      cachedInputMicrousdPerMillionTokens: 0, effectiveFrom: "2026-08-01T00:00:00.000Z",
    }});
    const recorded = await recordProviderUsage({db: d1, environment: "development", workspaceId: null,
      userId: null, feature: "legal_chat", operation: "responses", provider: "openai", model: "observed-failure",
      inputTokens: 100, outputTokens: 50, cachedInputTokens: 20, status: "failed", errorCode: "INVALID_AI_OUTPUT",
      startedAt: now, completedAt: now});
    assert.equal(recorded.estimatedCostMicrousd, 180);
    const dashboard = await readAiCostDashboard({db: d1, environment: "development", now: new Date(now)});
    const daily = dashboard.daily.find(row => row.model === "observed-failure")!;
    assert.equal(daily.failedRequestCount, 1);
    assert.equal(daily.inputTokens, 100);
    assert.equal(daily.outputTokens, 50);
    assert.equal(daily.estimatedCostMicrousd, 180);
    const base = {db: d1, environment: "development" as const, workspaceId: null, userId: null,
      feature: "legal_chat", operation: "responses", provider: "openai" as const, model: "observed-failure",
      inputTokens: 0, outputTokens: 0, status: "failed" as const, errorCode: "PROVIDER_TIMEOUT",
      startedAt: now, completedAt: now};
    const unknown = await recordProviderUsage({...base, usageObserved: false});
    const measuredZero = await recordProviderUsage({...base, usageObserved: true});
    assert.equal(unknown.estimatedCostMicrousd, null);
    assert.equal(measuredZero.estimatedCostMicrousd, 0);
    assert.deepEqual(sqlite.prepare("SELECT usage_observed AS observed FROM ai_provider_usage_events WHERE id IN (?,?) ORDER BY usage_observed")
      .all(unknown.id, measuredZero.id).map(row => row.observed), [0, 1]);
    await assert.rejects(recordProviderUsage({...base, inputTokens: 1, usageObserved: false}), ProviderUsageError);
  } finally {sqlite.close();}
});

function seed(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]) {
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES ('cost-user','cost@example.test',?,?)")
    .run(now, now);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES ('cost-workspace','individual','Cost',?,?)")
    .run(now, now);
  sqlite.prepare(`INSERT INTO workspace_members
    (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
    VALUES ('cost-member','cost-workspace','cost-user','owner','active',?,?,?)`).run(now, now, now);
}

test("system-scoped guest usage accepts null tenant identities and remains cost-accounted", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seed(sqlite);
    await createAiModelPriceVersion({
      db: d1,
      actorUserId: "cost-user",
      now: new Date(now),
      value: {
        provider: "anthropic",
        model: "guest-cost-test",
        operation: "messages",
        inputMicrousdPerMillionTokens: 1_000_000,
        outputMicrousdPerMillionTokens: 2_000_000,
        cachedInputMicrousdPerMillionTokens: 0,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        sourceUrl: "https://www.anthropic.com/pricing",
      },
    });
    const result = await recordProviderUsage({
      db: d1,
      environment: "development",
      workspaceId: null,
      userId: null,
      feature: "guest_legal_chat",
      operation: "messages",
      provider: "anthropic",
      model: "guest-cost-test",
      inputTokens: 100,
      outputTokens: 50,
      status: "succeeded",
      startedAt: "2026-08-04T11:59:59.000Z",
      completedAt: now,
      eventId: "guest-system-usage",
    });
    assert.equal(result.estimatedCostMicrousd, 200);
    const row = sqlite.prepare(
      "SELECT workspace_id AS workspaceId,user_id AS userId,scope_key AS scopeKey FROM ai_cost_daily_aggregates WHERE feature='guest_legal_chat'",
    ).get() as { workspaceId: string | null; userId: string | null; scopeKey: string };
    assert.equal(row.workspaceId, null);
    assert.equal(row.userId, null);
    assert.equal(row.scopeKey, "system");
  } finally {
    sqlite.close();
  }
});

test("0081 records priced and failed provider calls exactly once without content", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seed(sqlite);
    const price = await createAiModelPriceVersion({
      db: d1,
      actorUserId: "cost-user",
      now: new Date(now),
      value: {
        provider: "openai",
        model: "text-embedding-3-large",
        operation: "embeddings",
        inputMicrousdPerMillionTokens: 130_000,
        outputMicrousdPerMillionTokens: 0,
        cachedInputMicrousdPerMillionTokens: 0,
        effectiveFrom: "2026-08-01T00:00:00.000Z",
        sourceUrl: "https://openai.com/api/pricing/",
      },
    });
    const success = await recordProviderUsage({
      db: d1,
      environment: "development",
      workspaceId: "cost-workspace",
      userId: "cost-user",
      feature: "document_search",
      operation: "embeddings",
      provider: "openai",
      model: "text-embedding-3-large",
      providerRequestId: "req_cost_1",
      inputTokens: 1_000,
      itemCount: 1,
      dimensions: 1_536,
      status: "succeeded",
      startedAt: "2026-08-04T11:59:59.000Z",
      completedAt: now,
      eventId: "usage-cost-success",
    });
    assert.equal(success.priceVersionId, price.id);
    assert.equal(success.estimatedCostMicrousd, 130);

    await recordProviderUsage({
      db: d1,
      environment: "development",
      workspaceId: "cost-workspace",
      userId: "cost-user",
      feature: "document_search",
      operation: "embeddings",
      provider: "openai",
      model: "text-embedding-3-large",
      inputTokens: 0,
      itemCount: 1,
      dimensions: 1_536,
      status: "failed",
      errorCode: "PROVIDER_HTTP_429",
      startedAt: now,
      completedAt: "2026-08-04T12:00:01.000Z",
      eventId: "usage-cost-failure",
    });

    const rows = (sqlite.prepare(
      `SELECT status,input_tokens AS inputTokens,estimated_cost_microusd AS cost,
        provider_request_id AS requestId,error_code AS errorCode
       FROM ai_provider_usage_events ORDER BY completed_at`,
    ).all() as Array<Record<string, unknown>>).map((row) => ({ ...row }));
    assert.deepEqual(rows, [
      { status: "succeeded", inputTokens: 1_000, cost: 130, requestId: "req_cost_1", errorCode: null },
      { status: "failed", inputTokens: 0, cost: null, requestId: null, errorCode: "PROVIDER_HTTP_429" },
    ]);
    const aggregate = { ...(sqlite.prepare(
      `SELECT request_count AS requests,failed_request_count AS failures,input_tokens AS inputTokens,
        estimated_cost_microusd AS cost,unpriced_request_count AS unpriced
       FROM ai_cost_daily_aggregates`,
    ).get() as Record<string, unknown>) };
    assert.deepEqual(aggregate, { requests: 2, failures: 1, inputTokens: 1_000, cost: 130, unpriced: 0 });

    await assert.rejects(
      () => recordProviderUsage({
        db: d1,
        environment: "development",
        workspaceId: "cost-workspace",
        userId: "cost-user",
        feature: "document_search",
        operation: "embeddings",
        provider: "openai",
        model: "text-embedding-3-large",
        inputTokens: 1_000,
        status: "succeeded",
        startedAt: now,
        completedAt: now,
        eventId: "usage-cost-success",
      }),
      (error: unknown) => error instanceof ProviderUsageError && error.code === "PROVIDER_USAGE_PERSISTENCE_FAILED",
    );
    assert.equal((sqlite.prepare("SELECT request_count AS count FROM ai_cost_daily_aggregates").get() as { count: number }).count, 2);

    assert.throws(
      () => sqlite.prepare("UPDATE ai_provider_usage_events SET input_tokens=5 WHERE id='usage-cost-success'").run(),
      /AI_PROVIDER_USAGE_EVENT_IMMUTABLE/,
    );
    assert.throws(
      () => sqlite.prepare("DELETE FROM ai_model_price_versions WHERE id=?").run(price.id),
      /AI_MODEL_PRICE_VERSION_IMMUTABLE/,
    );
    const usageColumns = (sqlite.prepare("PRAGMA table_info(ai_provider_usage_events)").all() as Array<{ name: string }>)
      .map((column) => column.name);
    for (const forbidden of ["prompt", "answer", "document_text", "filename", "email", "phone"]) {
      assert.equal(usageColumns.includes(forbidden), false);
    }
    sqlite.prepare("DELETE FROM workspace_members WHERE workspace_id='cost-workspace'").run();
    sqlite.prepare("DELETE FROM workspaces WHERE id='cost-workspace'").run();
    sqlite.prepare("DELETE FROM user_profiles WHERE id='cost-user'").run();
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM ai_provider_usage_events").get() as { count: number }).count, 2);
    assert.equal((sqlite.prepare("SELECT count(*) AS count FROM ai_model_price_versions").get() as { count: number }).count, 1);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("0081 cost admin boundary is administrator-only, fresh-MFA-gated and CSRF-protected", () => {
  const route = readFileSync(new URL("../app/api/platform/admin/costs/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/[locale]/admin/costs/page.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/_staff/CostConsole.tsx", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../drizzle/0081_provider_cost_observability.sql", import.meta.url), "utf8");

  assert.equal(platformStaffRoleAllows("administrator", "staff.operations.manage"), true);
  assert.equal(platformStaffRoleAllows("support", "staff.operations.manage"), false);
  assert.equal(platformStaffRoleAllows("legal_reviewer", "staff.operations.manage"), false);
  assert.match(route, /requirePlatformStaffRequest\(request, "staff\.operations\.manage", \{ freshMfaWithinMs: 15 \* 60 \* 1000 \}\)/);
  assert.match(route, /assertSafeWrite\(request\)/);
  assert.match(page, /requirePlatformStaffAccess\(runtime\.DB, session, "staff\.operations\.manage", \{ now, freshMfaWithinMs: 15 \* 60 \* 1000 \}\)/);
  assert.match(page, /robots: \{ index: false, follow: false, nocache: true \}/);
  assert.match(client, /"x-juro-csrf": "1"/);
  assert.doesNotMatch(client, /dangerouslySetInnerHTML|transition:\s*all/);
  assert.match(migration, /ai_provider_usage_events_no_update/);
  assert.match(migration, /ai_provider_usage_events_no_delete/);
});

test("0081 price sources are provider-bound and dashboard reports unpriced calls", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seed(sqlite);
    await assert.rejects(
      () => createAiModelPriceVersion({
        db: d1,
        actorUserId: "cost-user",
        now: new Date(now),
        value: {
          provider: "openai",
          model: "text-embedding-3-large",
          operation: "embeddings",
          inputMicrousdPerMillionTokens: 1,
          effectiveFrom: now,
          sourceUrl: "https://example.com/pricing",
        },
      }),
      (error: unknown) => error instanceof ProviderUsageError && error.code === "PROVIDER_USAGE_INVALID",
    );
    await recordProviderUsage({
      db: d1,
      environment: "staging",
      workspaceId: "cost-workspace",
      userId: "cost-user",
      feature: "document_indexing",
      operation: "embeddings",
      provider: "openai",
      model: "text-embedding-3-large",
      inputTokens: 25,
      itemCount: 2,
      dimensions: 1_536,
      status: "succeeded",
      startedAt: now,
      completedAt: now,
      eventId: "usage-unpriced",
    });
    const dashboard = await readAiCostDashboard({ db: d1, environment: "staging", now: new Date(now) });
    assert.equal(dashboard.prices.length, 0);
    assert.equal(dashboard.daily.length, 1);
    assert.equal(dashboard.unpricedEvents, 1);
  } finally {
    sqlite.close();
  }
});
