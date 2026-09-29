import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readDependencyHealth } from "../lib/operations/dependency-health";
import {
  D1_HEALTH_DEGRADED_LATENCY_MS,
  dependencyHealthLatencyMs,
  providerFailureEvidence,
  recordDocumentBuilderCompletionEvidence,
  recordDependencyHealthEvidence,
  recordLawyerAccessGrantCompletionEvidence,
  recordScheduledD1HealthEvidence,
} from "../worker/dependency-health-evidence";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

test("dependency evidence records bounded, safe operational and failure outcomes", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const now = new Date("2026-08-12T06:00:00.000Z");
    const env = { APP_ENV: "staging", DB: d1 };
    assert.equal(await recordDependencyHealthEvidence(env, {
      key: "openai",
      state: "operational",
      evidenceKind: "synthetic_probe",
      startedAt: now.getTime() - 42,
      minimumOperationalIntervalMs: 15 * 60_000,
    }, now), true);
    assert.equal(await recordDependencyHealthEvidence(env, {
      key: "openai",
      state: "operational",
      evidenceKind: "synthetic_probe",
      startedAt: now.getTime() - 84,
      minimumOperationalIntervalMs: 15 * 60_000,
    }, new Date("2026-08-12T06:01:00.000Z")), false);

    const failure = providerFailureEvidence("openai", "PROBE_OPENAI_TIMEOUT");
    assert.equal(await recordDependencyHealthEvidence(env, {
      ...failure,
      evidenceKind: "synthetic_probe",
      startedAt: new Date("2026-08-12T06:01:00.000Z").getTime() - 120,
    }, new Date("2026-08-12T06:01:00.000Z")), true);

    const health = await readDependencyHealth({
      db: d1,
      environment: "staging",
      now: new Date("2026-08-12T06:01:00.000Z"),
    });
    const openai = health.find((entry) => entry.key === "openai");
    assert.equal(openai?.state, "degraded");
    assert.equal(openai?.safeErrorCode, "PROVIDER_TIMEOUT");
    assert.equal(openai?.latencyMs, 120);
    const countRow = sqlite.prepare(
      "SELECT count(*) AS count FROM dependency_health_checks WHERE dependency_key='openai'",
    ).get() as { count: number };
    assert.equal(countRow.count, 2);
  } finally {
    sqlite.close();
  }
});

test("dependency evidence classifies provider configuration/auth failures without raw values", () => {
  assert.deepEqual(providerFailureEvidence("anthropic", "STAGING_AI_CHAT_OPENAI_NOT_CONFIGURED"), {
    key: "anthropic",
    state: "outage",
    safeErrorCode: "PROBE_CONFIGURATION_ERROR",
  });
  assert.deepEqual(providerFailureEvidence("openai", "PROBE_OPENAI_HTTP_401"), {
    key: "openai",
    state: "outage",
    safeErrorCode: "PROBE_AUTH_ERROR",
  });
  assert.deepEqual(providerFailureEvidence("anthropic", "PROVIDER_UNAVAILABLE", "PROVIDER_CREDIT_BALANCE_LOW"), {
    key: "anthropic",
    state: "degraded",
    safeErrorCode: "PROVIDER_CREDIT_BALANCE_LOW",
  });
  assert.equal(dependencyHealthLatencyMs(0, 120_000), 60_000);
});

test("scheduled D1 evidence measures the dedicated query and degrades slow success", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const env = { APP_ENV: "production", DB: d1 };
    assert.equal(await recordScheduledD1HealthEvidence(env, {
      nowMs: () => 1_000,
      now: () => new Date(1_018),
    }), true);
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,latency_ms AS latencyMs,
      safe_error_code AS safeErrorCode,evidence_kind AS evidenceKind
      FROM dependency_health_checks WHERE dependency_key='d1'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as Record<string, unknown>) }, {
      state: "operational",
      latencyMs: 18,
      safeErrorCode: null,
      evidenceKind: "synthetic_probe",
    });

    assert.equal(await recordScheduledD1HealthEvidence(env, {
      nowMs: () => 60_000,
      now: () => new Date(60_000 + D1_HEALTH_DEGRADED_LATENCY_MS + 1),
    }), true);
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,latency_ms AS latencyMs,
      safe_error_code AS safeErrorCode,evidence_kind AS evidenceKind
      FROM dependency_health_checks WHERE dependency_key='d1'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as Record<string, unknown>) }, {
      state: "degraded",
      latencyMs: D1_HEALTH_DEGRADED_LATENCY_MS + 1,
      safeErrorCode: "PROBE_LATENCY_HIGH",
      evidenceKind: "synthetic_probe",
    });
  } finally {
    sqlite.close();
  }
});

test("completed Builder generation and confirmed lawyer access emit only factual, content-free integration evidence", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const now = new Date("2026-08-12T06:00:00.000Z");
    const env = { APP_ENV: "staging", DB: d1 };
    await recordDocumentBuilderCompletionEvidence(env, now.getTime() - 42, now);
    await recordLawyerAccessGrantCompletionEvidence(env, now.getTime() - 42, now);
    // A routine second success is intentionally throttled; the health ledger
    // is not a product-activity log.
    await recordDocumentBuilderCompletionEvidence(env, now.getTime() - 21, now);

    const rows = (sqlite.prepare(
      `SELECT dependency_key AS dependencyKey,state,latency_ms AS latencyMs,
              safe_error_code AS safeErrorCode,evidence_kind AS evidenceKind
       FROM dependency_health_checks ORDER BY dependency_key`,
    ).all() as Array<{
      dependencyKey: string;
      state: string;
      latencyMs: number | null;
      safeErrorCode: string | null;
      evidenceKind: string;
    }>).map((row) => ({ ...row }));
    assert.deepEqual(rows, [
      { dependencyKey: "d1", state: "operational", latencyMs: 42, safeErrorCode: null, evidenceKind: "integration_event" },
      { dependencyKey: "document_builder", state: "operational", latencyMs: 42, safeErrorCode: null, evidenceKind: "integration_event" },
      { dependencyKey: "lawyer_area", state: "operational", latencyMs: 42, safeErrorCode: null, evidenceKind: "integration_event" },
      { dependencyKey: "private_r2", state: "operational", latencyMs: 42, safeErrorCode: null, evidenceKind: "integration_event" },
    ]);
  } finally {
    sqlite.close();
  }
});

test("real-flow routes emit evidence only after their successful D1 commit", async () => {
  const root = new URL("../", import.meta.url);
  const [receiptGeneration, configuredGeneration, accessGrant] = await Promise.all([
    readFile(new URL("app/api/document-builder/documents/[id]/generate/route.ts", root), "utf8"),
    readFile(new URL("app/api/document-builder/configured-documents/[id]/generate/route.ts", root), "utf8"),
    readFile(new URL("app/api/platform/lawyer-requests/[requestId]/access-grant/route.ts", root), "utf8"),
  ]);

  for (const route of [receiptGeneration, configuredGeneration]) {
    const committed = route.indexOf("await db.batch([", route.indexOf("await Promise.all(["));
    const evidence = route.indexOf("await recordDocumentBuilderCompletionEvidence");
    assert.ok(committed >= 0 && evidence > committed);
    assert.ok(evidence < route.indexOf("await bucket.delete", evidence));
    assert.match(route, /APP_ENV: runtimeEnv\(\)\.APP_ENV \?\? "development"/);
    const invocation = route.slice(evidence, route.indexOf("}, startedAt);", evidence) + "}, startedAt);".length);
    assert.doesNotMatch(invocation, /documentId|workspaceId|userId|r2Key/);
  }

  const committed = accessGrant.indexOf("await db.batch([");
  const evidence = accessGrant.indexOf("await recordLawyerAccessGrantCompletionEvidence");
  assert.ok(committed >= 0 && evidence > committed);
  assert.ok(evidence < accessGrant.indexOf("return response", evidence));
  assert.match(accessGrant, /APP_ENV: runtimeEnv\(\)\.APP_ENV \?\? "development"/);
  const invocation = accessGrant.slice(evidence, accessGrant.indexOf("}, startedAt);", evidence) + "}, startedAt);".length);
  assert.doesNotMatch(invocation, /requestId|caseId|lawyerUserId|grantId/);
});

test("successful recovery is not suppressed by older operational evidence", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const env = { APP_ENV: "production", DB: d1 };
    const base = Date.parse("2026-09-29T00:00:00Z");
    const success = { key: "legal_source_sync" as const, state: "operational" as const,
      evidenceKind: "synthetic_probe" as const, startedAt: base, minimumOperationalIntervalMs: 20 * 60 * 60_000 };
    await recordDependencyHealthEvidence(env, success, new Date(base));
    await recordDependencyHealthEvidence(env, { key: "legal_source_sync", state: "degraded", safeErrorCode: "LEGAL_SYNC_FAILED",
      evidenceKind: "synthetic_probe", startedAt: base + 60_000 }, new Date(base + 60_000));
    assert.equal(await recordDependencyHealthEvidence(env, success, new Date(base + 120_000)), true);
    const health = await readDependencyHealth({ db: d1, environment: "production", now: new Date(base + 120_000) });
    assert.equal(health.find(row => row.key === "legal_source_sync")?.state, "operational");
  } finally { sqlite.close(); }
});
