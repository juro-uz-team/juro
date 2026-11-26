import assert from "node:assert/strict";
import test from "node:test";
import {
  claimStagingDocumentAnalysisProbe,
  runStagingDocumentAnalysisProbe,
  stagingDocumentAnalysisProbeEnabled,
  stagingDocumentAnalysisProbeExecutionKey,
  stagingDocumentAnalysisProbeProviderOptions,
} from "../worker/staging-document-analysis-probe";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

test("document analysis probe is impossible outside explicitly enabled staging", () => {
  assert.equal(stagingDocumentAnalysisProbeEnabled({ APP_ENV: "development", STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED: "true" } as never), false);
  assert.equal(stagingDocumentAnalysisProbeEnabled({ APP_ENV: "production", STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED: "true" } as never), false);
  assert.equal(stagingDocumentAnalysisProbeEnabled({ APP_ENV: "staging", STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED: "false" } as never), false);
  assert.equal(stagingDocumentAnalysisProbeEnabled({ APP_ENV: "staging", STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED: "true" } as never), true);
});

test("document analysis probe shares one bounded deadline and intentionally has no provider fallback", () => {
  assert.deepEqual(stagingDocumentAnalysisProbeProviderOptions(10_000), {
    providerTimeoutMs: 60_000,
    providerMaxAttempts: 1,
    deadlineAt: 70_000,
  });
});

test("document analysis budget begins after the independent scanner stage", () => {
  // The scanner can legitimately take tens of seconds. Its elapsed time must
  // not reduce the controlled provider window once a file is safely promoted.
  const analysisStartedAt = 47_000;
  assert.equal(stagingDocumentAnalysisProbeProviderOptions(analysisStartedAt).deadlineAt, 107_000);
});

test("document analysis probe has one durable, versioned claim per UTC window", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const firstWindow = new Date("2026-08-12T00:01:02.003Z");
    const secondWindow = new Date("2026-08-13T00:00:00.000Z");
    assert.equal(
      stagingDocumentAnalysisProbeExecutionKey(firstWindow),
      "staging-document-analysis-v5-20260812",
    );
    assert.equal(
      stagingDocumentAnalysisProbeExecutionKey(secondWindow),
      "staging-document-analysis-v5-20260813",
    );

    const first = await claimStagingDocumentAnalysisProbe(
      { DB: d1 },
      { now: firstWindow, runId: "11111111-1111-4111-8111-111111111111" },
    );
    assert.deepEqual(first, {
      claimed: true,
      probeExecutionKey: "staging-document-analysis-v5-20260812",
      runId: "11111111-1111-4111-8111-111111111111",
    });

    const sameWindow = await claimStagingDocumentAnalysisProbe(
      { DB: d1 },
      { now: new Date("2026-08-12T23:59:59.999Z"), runId: "22222222-2222-4222-8222-222222222222" },
    );
    assert.deepEqual(sameWindow, {
      claimed: false,
      probeExecutionKey: "staging-document-analysis-v5-20260812",
      runId: null,
    });

    const nextDay = await claimStagingDocumentAnalysisProbe(
      { DB: d1 },
      { now: secondWindow, runId: "33333333-3333-4333-8333-333333333333" },
    );
    assert.equal(nextDay.claimed, true);
    assert.deepEqual(
      sqlite.prepare(
        `SELECT schedule_name AS scheduleName,cron,scheduled_for AS scheduledFor,
                idempotency_key AS idempotencyKey,status,error_code AS errorCode
         FROM scheduled_runs
         WHERE schedule_name='staging-document-analysis-probe'
         ORDER BY scheduled_for`,
      ).all().map((row) => ({ ...(row as object) })),
      [
        {
          scheduleName: "staging-document-analysis-probe",
          cron: "one-shot-utc",
          scheduledFor: "2026-08-12T00:00:00.000Z",
          idempotencyKey: "staging-document-analysis-probe:staging-document-analysis-v5-20260812",
          status: "running",
          errorCode: null,
        },
        {
          scheduleName: "staging-document-analysis-probe",
          cron: "one-shot-utc",
          scheduledFor: "2026-08-13T00:00:00.000Z",
          idempotencyKey: "staging-document-analysis-probe:staging-document-analysis-v5-20260813",
          status: "running",
          errorCode: null,
        },
      ],
    );
  } finally {
    sqlite.close();
  }
});

test("failed one-shot document probe remains blocked until an operator resets its durable claim", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const at = new Date("2026-08-12T12:00:00.000Z");
    const first = await claimStagingDocumentAnalysisProbe(
      { DB: d1 },
      { now: at, runId: "44444444-4444-4444-8444-444444444444" },
    );
    assert.equal(first.claimed, true);
    const idempotencyKey = "staging-document-analysis-probe:staging-document-analysis-v5-20260812";
    sqlite.prepare(
      "UPDATE scheduled_runs SET status='failed',error_code='DOCUMENT_ANALYSIS_PROBE_ANALYSIS_FAILED' WHERE idempotency_key=?",
    ).run(idempotencyKey);

    assert.equal(
      (await claimStagingDocumentAnalysisProbe(
        { DB: d1 },
        { now: at, runId: "55555555-5555-4555-8555-555555555555" },
      )).claimed,
      false,
    );

    // A conscious operator reset is the only same-window path to another
    // execution. Normal cron invocations never perform this deletion.
    sqlite.prepare("DELETE FROM scheduled_runs WHERE idempotency_key=?").run(idempotencyKey);
    assert.equal(
      (await claimStagingDocumentAnalysisProbe(
        { DB: d1 },
        { now: at, runId: "66666666-6666-4666-8666-666666666666" },
      )).claimed,
      true,
    );
  } finally {
    sqlite.close();
  }
});

test("an enabled document probe cannot repeat after its first terminal staging attempt", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const privateBucket = { delete: async () => undefined };
  try {
    // Scanner configuration is deliberately absent: this proves the gate is
    // claimed before any real scanner/R2/provider execution, then remains
    // terminal rather than being retried by every five-minute cron tick.
    const env = {
      APP_ENV: "staging",
      STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED: "true",
      MALWARE_SCAN_ENABLED: "false",
      DB: d1,
      BUCKET: privateBucket,
      QUARANTINE_BUCKET: privateBucket,
    } as never;
    assert.deepEqual(await runStagingDocumentAnalysisProbe(env), {
      attempted: 1,
      completed: 0,
      failed: 1,
      skipped: 0,
      errorCode: "DOCUMENT_ANALYSIS_PROBE_SCANNER_DISABLED",
    });
    assert.deepEqual(await runStagingDocumentAnalysisProbe(env), {
      attempted: 0,
      completed: 0,
      failed: 0,
      skipped: 1,
    });
    assert.deepEqual(
      {
        ...(sqlite.prepare(
          `SELECT status,error_code AS errorCode
           FROM scheduled_runs
           WHERE schedule_name='staging-document-analysis-probe'
           LIMIT 1`,
        ).get() as object),
      },
      {
        status: "failed",
        errorCode: "DOCUMENT_ANALYSIS_PROBE_SCANNER_DISABLED",
      },
    );
    assert.equal(
      Number((sqlite.prepare(
        `SELECT count(*) AS count FROM dependency_health_checks
         WHERE dependency_key='malware_scanner' AND evidence_kind='synthetic_probe'`,
      ).get() as { count: number }).count),
      1,
    );
  } finally {
    sqlite.close();
  }
});
