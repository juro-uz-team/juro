import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  ATTACHED_PLATFORM_QUEUE_BINDINGS,
  JOB_KINDS,
  LEGACY_JOB_KINDS,
  QUEUE_BINDING_BY_KIND,
  expectedDocumentAnalysisDlqQueueName,
  expectedDocumentExportDlqQueueName,
  expectedMalwareScanDlqQueueName,
  expectedOcrProcessingDlqQueueName,
  expectedQueueName,
  handleQueue,
  jobEnvelopeSchema,
  type JobEnvelope,
  type JobKind,
  type PlatformJobEnv,
} from "../worker/platform-jobs";
import { dispatchOutbox } from "../worker/platform-outbox";
import {
  enqueueDueTaskReminders,
  handleScheduled,
  reconcileRetryExhaustedDocumentJobs,
  reconcileRetryExhaustedQueueJobs,
} from "../worker/platform-scheduled";

class SqliteD1Statement {
  constructor(
    private readonly owner: SqliteD1,
    readonly sql: string,
    readonly values: unknown[] = [],
  ) {}

  bind(...values: unknown[]): SqliteD1Statement {
    return new SqliteD1Statement(this.owner, this.sql, values);
  }

  private sqliteValues(): Array<null | number | bigint | string> {
    return this.values.map((value) => {
      if (
        value === null ||
        typeof value === "number" ||
        typeof value === "bigint" ||
        typeof value === "string"
      ) {
        return value;
      }
      throw new TypeError("Unsupported synthetic D1 binding value.");
    });
  }

  async run<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: true;
    meta: { changes: number };
  }> {
    if (
      this.owner.stealJobLeaseOnReject &&
      /SET status = 'rejected'/i.test(this.sql)
    ) {
      this.owner.database.prepare(`
        UPDATE job_runs
        SET lease_owner = 'newer-worker',
            lease_expires_at = '2999-01-01T00:00:00.000Z'
        WHERE status = 'running'
      `).run();
    }
    const statement = this.owner.database.prepare(this.sql);
    let results: T[] = [];
    let changes = 0;
    if (/\bRETURNING\b/i.test(this.sql)) {
      results = statement.all(...this.sqliteValues()) as T[];
      changes = Number(
        (
          this.owner.database.prepare(
            "SELECT changes() AS changes",
          ).get() as { changes: number | bigint }
        ).changes,
      );
    } else {
      const result = statement.run(...this.sqliteValues());
      changes = Number(result.changes);
    }
    return { results, success: true, meta: { changes } };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.owner.database.prepare(this.sql).get(
      ...this.sqliteValues(),
    ) as T | undefined) ?? null;
  }

  async all<T = Record<string, unknown>>(): Promise<{
    results: T[];
    success: true;
    meta: { changes: number };
  }> {
    const results = this.owner.database.prepare(this.sql).all(
      ...this.sqliteValues(),
    ) as T[];
    return { results, success: true, meta: { changes: 0 } };
  }
}

class SqliteD1 {
  prepareCalls = 0;
  stealJobLeaseOnReject = false;

  constructor(readonly database: DatabaseSync) {}

  prepare(sql: string): SqliteD1Statement {
    this.prepareCalls += 1;
    return new SqliteD1Statement(this, sql);
  }

  async batch<T = unknown>(
    statements: SqliteD1Statement[],
  ): Promise<Array<{
    results: T[];
    success: true;
    meta: { changes: number };
  }>> {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run<T>());
      }
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

function latestMigrationSql(): string {
  const journal = JSON.parse(
    readFileSync(
      new URL("../drizzle/meta/_journal.json", import.meta.url),
      "utf8",
    ),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const entry = journal.entries.find(({ idx }) => idx === 11);
  assert.ok(entry);
  return readFileSync(
    new URL(`../drizzle/${entry.tag}.sql`, import.meta.url),
    "utf8",
  );
}

function createDatabase(): {
  sqlite: DatabaseSync;
  d1: SqliteD1;
} {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE workspaces (
      id text PRIMARY KEY NOT NULL,
      type text NOT NULL,
      name text NOT NULL,
      locale text DEFAULT 'ru' NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    INSERT INTO workspaces (
      id, type, name, locale, created_at, updated_at
    ) VALUES (
      'ws_test', 'individual', 'Synthetic workspace', 'ru',
      '2026-07-26T00:00:00.000Z', '2026-07-26T00:00:00.000Z'
    );
  `);
  for (
    const statement of latestMigrationSql()
      .split("--> statement-breakpoint")
      .map((value) => value.trim())
      .filter(Boolean)
  ) {
    sqlite.exec(statement);
  }
  // The queue/scheduler fixture starts from the durable-runtime migration so
  // that it remains small. Add the later task-notification boundary here for
  // scheduled reminder contracts without coupling every worker test to all UI
  // schema migrations.
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS analysis_version_object_writes (
      id text PRIMARY KEY NOT NULL,
      analysis_id text NOT NULL,
      workspace_id text NOT NULL,
      owner_user_id text NOT NULL,
      target_version integer NOT NULL,
      source_kind text NOT NULL,
      r2_key text NOT NULL UNIQUE,
      size_bytes integer NOT NULL,
      sha256 text NOT NULL,
      status text NOT NULL,
      version_id text,
      attempt_count integer NOT NULL DEFAULT 0,
      last_error_code text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      reconciled_at text
    );
    CREATE TABLE IF NOT EXISTS builder_document_version_object_writes (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      owner_user_id text NOT NULL,
      document_id text NOT NULL,
      target_version integer NOT NULL,
      source_revision integer NOT NULL,
      target_revision integer NOT NULL,
      source text NOT NULL,
      source_entity_id text NOT NULL,
      r2_key text NOT NULL UNIQUE,
      size_bytes integer NOT NULL,
      sha256 text NOT NULL,
      idempotency_key_sha256 text NOT NULL,
      status text NOT NULL,
      version_id text,
      attempt_count integer NOT NULL DEFAULT 0,
      last_error_code text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      reconciled_at text
    );
    CREATE TABLE IF NOT EXISTS cases (
      id text PRIMARY KEY NOT NULL,
      workspace_id text,
      owner_user_id text NOT NULL,
      locale text NOT NULL,
      archived_at text
    );
    CREATE TABLE IF NOT EXISTS workspace_members (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      user_id text NOT NULL,
      role text NOT NULL,
      status text NOT NULL,
      joined_at text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      case_id text NOT NULL,
      owner_user_id text NOT NULL,
      title text NOT NULL,
      due_at text,
      status text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_reminders (
      id text PRIMARY KEY NOT NULL,
      task_id text NOT NULL,
      channel text NOT NULL,
      reminder_at text NOT NULL,
      status text NOT NULL,
      sent_at text,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS task_reminder_email_jobs (
      id text PRIMARY KEY NOT NULL,
      reminder_id text NOT NULL,
      workspace_id text NOT NULL,
      user_id text NOT NULL,
      reminder_updated_at text NOT NULL,
      status text NOT NULL,
      attempt_count integer NOT NULL DEFAULT 0,
      provider_message_id text,
      error_code text,
      sent_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL,
      UNIQUE(reminder_id,reminder_updated_at)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id text PRIMARY KEY NOT NULL,
      workspace_id text,
      user_id text NOT NULL,
      document_id text,
      type text NOT NULL,
      title text NOT NULL,
      body text NOT NULL,
      read_at text,
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_memories (
      id text PRIMARY KEY NOT NULL,
      status text NOT NULL,
      deleted_at text,
      ciphertext text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS memory_sources (
      id text PRIMARY KEY NOT NULL,
      memory_id text NOT NULL REFERENCES user_memories(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS document_analyses (
      id text PRIMARY KEY NOT NULL,
      workspace_id text NOT NULL,
      owner_user_id text NOT NULL,
      uploaded_file_id text NOT NULL,
      status text NOT NULL,
      summary_json text,
      result_sha256 text,
      error_code text,
      consent_version text NOT NULL,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_document_index_jobs (
      id text PRIMARY KEY NOT NULL,
      analysis_id text NOT NULL,
      document_version_id text NOT NULL,
      workspace_id text NOT NULL,
      owner_user_id text NOT NULL,
      source_hash text NOT NULL,
      language text NOT NULL,
      access_scope text NOT NULL,
      status text NOT NULL,
      chunk_count integer NOT NULL DEFAULT 0,
      attempt_count integer NOT NULL DEFAULT 0,
      mutation_id text,
      error_code text,
      started_at text,
      submitted_at text,
      deleted_at text,
      created_at text NOT NULL,
      updated_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dependency_health_checks (
      id text PRIMARY KEY NOT NULL,
      environment text NOT NULL,
      dependency_key text NOT NULL,
      state text NOT NULL,
      checked_at text NOT NULL,
      latency_ms integer,
      safe_error_code text,
      evidence_kind text NOT NULL,
      created_at text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS operational_job_redrive_events (
      id text PRIMARY KEY NOT NULL,
      source_job_id text NOT NULL,
      version integer NOT NULL
    );
  `);
  const guestMigration = readFileSync(
    new URL("../drizzle/0065_guest_ai_sessions.sql", import.meta.url),
    "utf8",
  );
  for (const statement of guestMigration
    .split("--> statement-breakpoint")
    .map((value) => value.trim())
    .filter(Boolean)) {
    sqlite.exec(statement);
  }
  return { sqlite, d1: new SqliteD1(sqlite) };
}

type QueueSend = {
  binding: string;
  body: unknown;
};

function createEnv(
  d1: SqliteD1,
  options: {
    asyncEnabled?: string;
    cronEnabled?: string;
    schemaVersion?: string;
    analyticsThrows?: boolean;
    failingQueueBindings?: string[];
  } = {},
): {
  env: PlatformJobEnv;
  metrics: unknown[];
  sends: QueueSend[];
} {
  const metrics: unknown[] = [];
  const sends: QueueSend[] = [];
  const failing = new Set(options.failingQueueBindings ?? []);
  const queue = (binding: string) => ({
    async send(body: unknown) {
      if (failing.has(binding)) {
        throw new Error("synthetic queue failure");
      }
      sends.push({ binding, body });
      return {
        metadata: {
          metrics: {
            backlogCount: 0,
            backlogBytes: 0,
          },
        },
      };
    },
  });

  const env = {
    DB: d1,
    APP_ENV: "development",
    ASYNC_RUNTIME_ENABLED: options.asyncEnabled ?? "true",
    CRON_ENABLED: options.cronEnabled ?? "false",
    LEGAL_ADVICE_INGESTION_ENABLED: "false",
    JOB_SCHEMA_VERSION: options.schemaVersion ?? "1",
    PLATFORM_ANALYTICS: {
      writeDataPoint(value: unknown) {
        if (options.analyticsThrows) {
          throw new Error("synthetic analytics failure");
        }
        metrics.push(value);
      },
    },
    DOCUMENT_ANALYSIS_QUEUE: queue("DOCUMENT_ANALYSIS_QUEUE"),
    OCR_PROCESSING_QUEUE: queue("OCR_PROCESSING_QUEUE"),
    DOCUMENT_EXPORT_QUEUE: queue("DOCUMENT_EXPORT_QUEUE"),
    EMAIL_NOTIFICATIONS_QUEUE: queue("EMAIL_NOTIFICATIONS_QUEUE"),
    LEGAL_SOURCES_SYNC_QUEUE: queue("LEGAL_SOURCES_SYNC_QUEUE"),
    DATA_RETENTION_CLEANUP_QUEUE: queue("DATA_RETENTION_CLEANUP_QUEUE"),
    NOTIFICATIONS_QUEUE: queue("NOTIFICATIONS_QUEUE"),
    MALWARE_SCAN_QUEUE: queue("MALWARE_SCAN_QUEUE"),
  } as unknown as PlatformJobEnv;
  return { env, metrics, sends };
}

type MessageState = {
  acknowledgements: number;
  retries: Array<{ delaySeconds?: number } | undefined>;
};

function mockMessage(
  body: unknown,
  id: string,
  attempts = 1,
): {
  message: Message<unknown>;
  state: MessageState;
} {
  const state: MessageState = {
    acknowledgements: 0,
    retries: [],
  };
  const message = {
    id,
    timestamp: new Date(),
    body,
    attempts,
    ack() {
      state.acknowledgements += 1;
    },
    retry(options?: { delaySeconds?: number }) {
      state.retries.push(options);
    },
  } satisfies Message<unknown>;
  return { message, state };
}

function mockBatch(
  queue: string,
  messages: Message<unknown>[],
): {
  batch: MessageBatch<unknown>;
  retryAll: Array<{ delaySeconds?: number } | undefined>;
} {
  const retryAll: Array<{ delaySeconds?: number } | undefined> = [];
  const batch = {
    queue,
    messages,
    metadata: {
      metrics: {
        backlogCount: messages.length,
        backlogBytes: 0,
      },
    },
    retryAll(options?: { delaySeconds?: number }) {
      retryAll.push(options);
    },
    ackAll() {
      for (const message of messages) {
        message.ack();
      }
    },
  } satisfies MessageBatch<unknown>;
  return { batch, retryAll };
}

function envelope(
  kind: JobKind = "malware.scan",
  overrides: Partial<JobEnvelope> = {},
): JobEnvelope {
  const tenantKind = new Set<JobKind>([
    "document.analyze",
    "document.index",
    "ocr.process",
    "document.export",
    "email.send",
    "notification.dispatch",
    "malware.scan",
  ]).has(kind);
  return {
    schemaVersion: 1,
    jobId: `job_${kind.replaceAll(".", "_")}`,
    kind,
    idempotencyKey: `idem_${kind.replaceAll(".", "_")}`,
    subjectId: `subject_${kind.replaceAll(".", "_")}`,
    ...(tenantKind ? { workspaceId: "ws_test" } : {}),
    correlationId: `corr_${kind.replaceAll(".", "_")}`,
    enqueuedAt: "2026-07-26T00:00:00.000Z",
    ...overrides,
  };
}

function envelopeDigestForTest(value: JobEnvelope): string {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: value.schemaVersion,
    jobId: value.jobId,
    kind: value.kind,
    idempotencyKey: value.idempotencyKey,
    subjectId: value.subjectId,
    workspaceId: value.workspaceId ?? null,
    correlationId: value.correlationId,
  })).digest("hex");
}

async function runBatch(
  env: PlatformJobEnv,
  queue: string,
  messages: Message<unknown>[],
): Promise<ReturnType<typeof mockBatch>> {
  const mocked = mockBatch(queue, messages);
  await handleQueue(mocked.batch, env);
  return mocked;
}

test("accepts supported identifiers-only envelopes", () => {
  for (const kind of JOB_KINDS) {
    assert.equal(jobEnvelopeSchema.safeParse(envelope(kind)).success, true);
  }
});

test("routes only v2 task kinds and compatibility-blocks legacy kinds", () => {
  assert.deepEqual(
    JOB_KINDS.map((kind) => [
      kind,
      QUEUE_BINDING_BY_KIND[kind],
      expectedQueueName(kind, "staging"),
    ]),
    [
      ["document.analyze", "DOCUMENT_ANALYSIS_QUEUE", "staging-document-analysis"],
      ["document.index", "DOCUMENT_ANALYSIS_QUEUE", "staging-document-analysis"],
      ["ocr.process", "OCR_PROCESSING_QUEUE", "staging-ocr-processing"],
      ["document.export", "DOCUMENT_EXPORT_QUEUE", "staging-document-export"],
      ["email.send", "EMAIL_NOTIFICATIONS_QUEUE", "staging-email-notifications"],
      ["legal.sync", "LEGAL_SOURCES_SYNC_QUEUE", "staging-legal-sources-sync"],
      ["legal.parse", "LEGAL_SOURCES_SYNC_QUEUE", "staging-legal-sources-sync"],
      ["legal.index", "LEGAL_SOURCES_SYNC_QUEUE", "staging-legal-sources-sync"],
      ["cleanup.run", "DATA_RETENTION_CLEANUP_QUEUE", "staging-data-retention-cleanup"],
      ["notification.dispatch", "NOTIFICATIONS_QUEUE", "staging-notifications"],
      ["malware.scan", "MALWARE_SCAN_QUEUE", "staging-malware-scan"],
    ],
  );
  assert.equal(
    ATTACHED_PLATFORM_QUEUE_BINDINGS.includes("MALWARE_SCAN_QUEUE" as never),
    true,
  );

  for (const legacyKind of LEGACY_JOB_KINDS) {
    assert.equal(
      jobEnvelopeSchema.safeParse({
        ...envelope(),
        kind: legacyKind,
      }).success,
      false,
    );
    assert.equal(Object.hasOwn(QUEUE_BINDING_BY_KIND, legacyKind), false);
    assert.throws(
      () =>
        (expectedQueueName as unknown as (
          kind: string,
          environment: "development",
        ) => string)(legacyKind, "development"),
      /Unsupported job kind/,
    );
  }
});

test("rejects unknown fields, content payloads, bad versions, and missing tenant scope", () => {
  assert.equal(
    jobEnvelopeSchema.safeParse({
      ...envelope(),
      payload: { documentText: "must never enter a queue" },
    }).success,
    false,
  );
  assert.equal(
    jobEnvelopeSchema.safeParse({
      ...envelope(),
      schemaVersion: 2,
    }).success,
    false,
  );
  const tenant = envelope("document.analyze");
  delete (tenant as Partial<JobEnvelope>).workspaceId;
  assert.equal(jobEnvelopeSchema.safeParse(tenant).success, false);
  assert.equal(
    jobEnvelopeSchema.safeParse({
      ...envelope(),
      subjectId: "not allowed!",
    }).success,
    false,
  );
});

test("disabled or incompatible runtimes retry the batch without D1 access", async () => {
  for (const options of [
    { asyncEnabled: "false" },
    { schemaVersion: "2" },
  ]) {
    const { sqlite, d1 } = createDatabase();
    try {
      const { env } = createEnv(d1, options);
      const item = mockMessage(envelope(), `message_${options.asyncEnabled ?? "schema"}`);
      const { retryAll } = await runBatch(
        env,
        expectedQueueName("cleanup.run", "development"),
        [item.message],
      );
      assert.deepEqual(retryAll, [{ delaySeconds: 300 }]);
      assert.equal(d1.prepareCalls, 0);
      assert.equal(item.state.acknowledgements, 0);
    } finally {
      sqlite.close();
    }
  }
});

test("invalid messages are acknowledged without persistence or telemetry", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env, metrics } = createEnv(d1);
    const item = mockMessage({ version: 0, content: "unsafe" }, "invalid");
    await runBatch(
      env,
      expectedQueueName("cleanup.run", "development"),
      [item.message],
    );
    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    assert.equal(d1.prepareCalls, 0);
    assert.deepEqual(metrics, []);
  } finally {
    sqlite.close();
  }
});

test("unimplemented v2 handlers reject exactly once and redelivery is deduplicated", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env, metrics } = createEnv(d1);
    const body = envelope();
    const first = mockMessage(body, "probe_message_1");
    await runBatch(
      env,
      expectedQueueName(body.kind, "development"),
      [first.message],
    );
    assert.equal(first.state.acknowledgements, 1);
    assert.deepEqual(first.state.retries, []);

    const row = sqlite.prepare(`
      SELECT status, lease_owner, error_code
      FROM job_runs
      WHERE idempotency_key = ?
    `).get(body.idempotencyKey) as {
      status: string;
      lease_owner: string | null;
      error_code: string | null;
    };
    assert.equal(row.status, "rejected");
    assert.equal(row.lease_owner, null);
    assert.equal(row.error_code, "JOB_HANDLER_NOT_ENABLED");
    assert.equal(metrics.length, 1);

    const duplicate = mockMessage(body, "probe_message_2", 2);
    await runBatch(
      env,
      expectedQueueName(body.kind, "development"),
      [duplicate.message],
    );
    assert.equal(duplicate.state.acknowledgements, 1);
    assert.deepEqual(duplicate.state.retries, []);
    assert.equal(
      (
        sqlite.prepare(
          "SELECT COUNT(*) AS count FROM job_runs",
        ).get() as { count: number }
      ).count,
      1,
    );
    assert.equal(metrics.length, 1);
  } finally {
    sqlite.close();
  }
});

test("dormant legacy legal-corpus jobs are terminal and never invoke a corpus handler", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env, metrics } = createEnv(d1);
    const body = envelope("legal.sync", {
      jobId: "job_legacy_corpus_sync",
      idempotencyKey: "legacy_corpus_sync_key",
      subjectId: "legacy_source_request",
      correlationId: "legacy_corpus_sync",
    });
    const item = mockMessage(body, "legacy_corpus_message");
    await runBatch(
      env,
      expectedQueueName("legal.sync", "development"),
      [item.message],
    );

    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    const row = sqlite.prepare(`
      SELECT status,error_code FROM job_runs WHERE idempotency_key=?
    `).get(body.idempotencyKey) as { status: string; error_code: string | null };
    assert.equal(row.status, "rejected");
    assert.equal(row.error_code, "LEGAL_CORPUS_DORMANT");
    assert.equal(metrics.length, 1);
  } finally {
    sqlite.close();
  }
});

test("idempotency hash conflicts are acknowledged without overwriting the original", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1);
    const original = envelope();
    const first = mockMessage(original, "conflict_1");
    await runBatch(
      env,
      expectedQueueName(original.kind, "development"),
      [first.message],
    );

    const conflictBody = envelope("cleanup.run", {
      jobId: "job_conflict_second",
      idempotencyKey: original.idempotencyKey,
      subjectId: "subject_conflict_second",
    });
    const conflict = mockMessage(conflictBody, "conflict_2");
    await runBatch(
      env,
      expectedQueueName(conflictBody.kind, "development"),
      [conflict.message],
    );
    assert.equal(conflict.state.acknowledgements, 1);
    assert.deepEqual(conflict.state.retries, []);
    const stored = sqlite.prepare(`
      SELECT id, subject_id
      FROM job_runs
      WHERE idempotency_key = ?
    `).get(original.idempotencyKey) as {
      id: string;
      subject_id: string;
    };
    assert.equal(stored.id, original.jobId);
    assert.equal(stored.subject_id, original.subjectId);
  } finally {
    sqlite.close();
  }
});

test("a reused job id with a different idempotency key is a terminal conflict", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1);
    const original = envelope();
    const first = mockMessage(original, "job_id_conflict_1");
    await runBatch(
      env,
      expectedQueueName(original.kind, "development"),
      [first.message],
    );

    const conflicting = envelope("cleanup.run", {
      jobId: original.jobId,
      idempotencyKey: "idem_same_job_different_key",
      correlationId: "corr_same_job_different_key",
    });
    const second = mockMessage(conflicting, "job_id_conflict_2");
    await runBatch(
      env,
      expectedQueueName(conflicting.kind, "development"),
      [second.message],
    );

    assert.equal(second.state.acknowledgements, 1);
    assert.deepEqual(second.state.retries, []);
    assert.equal(
      (
        sqlite.prepare(
          "SELECT COUNT(*) AS count FROM job_runs",
        ).get() as { count: number }
      ).count,
      1,
    );
  } finally {
    sqlite.close();
  }
});

test("active leases retry and expired leases are reclaimed", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1);
    const body = envelope();
    const seed = mockMessage(body, "lease_seed");
    await runBatch(
      env,
      expectedQueueName(body.kind, "development"),
      [seed.message],
    );

    sqlite.prepare(`
      UPDATE job_runs
      SET status = 'running',
          lease_owner = 'other-worker',
          lease_expires_at = '2999-01-01T00:00:00.000Z',
          finished_at = NULL
      WHERE idempotency_key = ?
    `).run(body.idempotencyKey);
    const busy = mockMessage(body, "lease_busy", 2);
    await runBatch(
      env,
      expectedQueueName(body.kind, "development"),
      [busy.message],
    );
    assert.equal(busy.state.acknowledgements, 0);
    assert.deepEqual(busy.state.retries, [{ delaySeconds: 30 }]);

    sqlite.prepare(`
      UPDATE job_runs
      SET lease_expires_at = '2000-01-01T00:00:00.000Z'
      WHERE idempotency_key = ?
    `).run(body.idempotencyKey);
    const takeover = mockMessage(body, "lease_takeover", 3);
    await runBatch(
      env,
      expectedQueueName(body.kind, "development"),
      [takeover.message],
    );
    assert.equal(takeover.state.acknowledgements, 1);
    assert.deepEqual(takeover.state.retries, []);
    assert.equal(
      (
        sqlite.prepare(`
          SELECT status FROM job_runs WHERE idempotency_key = ?
        `).get(body.idempotencyKey) as { status: string }
      ).status,
      "rejected",
    );
  } finally {
    sqlite.close();
  }
});

test("a stale lease owner cannot complete or fail a newer claim", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1);
    d1.stealJobLeaseOnReject = true;
    const body = envelope("cleanup.run", {
      jobId: "job_stale_worker",
      idempotencyKey: "idem_stale_worker",
      subjectId: "subject_stale_worker",
      correlationId: "corr_stale_worker",
    });
    const item = mockMessage(body, "stale_worker");
    await runBatch(
      env,
      expectedQueueName(body.kind, "development"),
      [item.message],
    );
    assert.equal(item.state.acknowledgements, 0);
    assert.deepEqual(item.state.retries, [{ delaySeconds: 15 }]);
    const row = sqlite.prepare(`
      SELECT status, lease_owner, error_code
      FROM job_runs
      WHERE idempotency_key = ?
    `).get(body.idempotencyKey) as {
      status: string;
      lease_owner: string;
      error_code: string | null;
    };
    assert.equal(row.status, "running");
    assert.equal(row.lease_owner, "newer-worker");
    assert.equal(row.error_code, null);
  } finally {
    sqlite.close();
  }
});

test("queue mismatches and disabled handlers are recorded as terminal rejections", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1);
    const mismatchedBody = envelope("document.analyze");
    const mismatch = mockMessage(mismatchedBody, "mismatch");
    await runBatch(
      env,
      expectedQueueName("document.export", "development"),
      [mismatch.message],
    );
    assert.equal(mismatch.state.acknowledgements, 1);
    assert.equal(
      (
        sqlite.prepare(`
          SELECT error_code FROM job_runs WHERE idempotency_key = ?
        `).get(mismatchedBody.idempotencyKey) as { error_code: string }
      ).error_code,
      "JOB_QUEUE_MISMATCH",
    );

    const disabledBody = envelope("malware.scan", {
      jobId: "job_malware_disabled",
      idempotencyKey: "idem_malware_disabled",
      correlationId: "corr_malware_disabled",
    });
    const disabled = mockMessage(disabledBody, "disabled_handler");
    await runBatch(
      env,
      expectedQueueName(disabledBody.kind, "development"),
      [disabled.message],
    );
    assert.equal(disabled.state.acknowledgements, 1);
    assert.equal(
      (
        sqlite.prepare(`
          SELECT error_code FROM job_runs WHERE idempotency_key = ?
        `).get(disabledBody.idempotencyKey) as { error_code: string }
      ).error_code,
      "JOB_HANDLER_NOT_ENABLED",
    );
  } finally {
    sqlite.close();
  }
});

test("document analysis queue refuses quarantined tenant rows before R2 or AI access", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    sqlite.exec(`
      CREATE TABLE document_files (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
        kind TEXT NOT NULL, r2_key TEXT NOT NULL, file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL, size_bytes INTEGER NOT NULL, sha256 TEXT,
        archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS document_analyses (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, owner_user_id TEXT NOT NULL,
        uploaded_file_id TEXT NOT NULL, status TEXT NOT NULL, summary_json TEXT,
        result_sha256 TEXT, error_code TEXT, consent_version TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO document_files VALUES (
        'file_unsafe','ws_test','user_test','analysis_quarantined','quarantine/ws_test/file_unsafe',
        'synthetic.pdf','application/pdf',10,'${"0".repeat(64)}',NULL,
        '2026-07-26T00:00:00.000Z','2026-07-26T00:00:00.000Z'
      );
      INSERT INTO document_analyses VALUES (
        'analysis_unsafe','ws_test','user_test','file_unsafe','quarantined',
        '{"mode":"quick","locale":"ru"}',NULL,'MALWARE_SCANNER_UNAVAILABLE','2026-07-30',
        '2026-07-26T00:00:00.000Z','2026-07-26T00:00:00.000Z'
      );
    `);
    const { env } = createEnv(d1);
    const body = envelope("document.analyze", {
      jobId: "job_document_unsafe",
      idempotencyKey: "idem_document_unsafe",
      subjectId: "analysis_unsafe",
      workspaceId: "ws_test",
      correlationId: "corr_document_unsafe",
    });
    const item = mockMessage(body, "document_unsafe");
    await runBatch(env, expectedQueueName(body.kind, "development"), [item.message]);
    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    const job = sqlite.prepare(
      "SELECT status,error_code AS errorCode FROM job_runs WHERE idempotency_key=?",
    ).get(body.idempotencyKey) as { status: string; errorCode: string };
    assert.equal(job.status, "rejected");
    assert.equal(job.errorCode, "DOCUMENT_ANALYSIS_FILE_UNSAFE");
    const analysis = sqlite.prepare(
      "SELECT status,error_code AS errorCode FROM document_analyses WHERE id='analysis_unsafe'",
    ).get() as { status: string; errorCode: string };
    assert.equal(analysis.status, "quarantined");
    assert.equal(analysis.errorCode, "MALWARE_SCANNER_UNAVAILABLE");
  } finally {
    sqlite.close();
  }
});

test("document-analysis DLQ terminalizes only the durable run, preserves retryable analysis state, and records health evidence", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const body = envelope("document.analyze", {
      jobId: "job_document_dlq",
      idempotencyKey: "idem_document_dlq",
      subjectId: "analysis_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_document_dlq",
    });
    sqlite.prepare(`
      INSERT INTO document_analyses (
        id,workspace_id,owner_user_id,uploaded_file_id,status,summary_json,
        result_sha256,error_code,consent_version,created_at,updated_at
      ) VALUES (?,'ws_test','user_test','file_dlq','retrying',NULL,NULL,
        'DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE','2026-08-12',?,?)
    `).run(body.subjectId, "2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z");
    insertSourceQueueJobRun(sqlite, body);
    insertOutbox(sqlite, {
      id: "outbox_document_dlq",
      queueBinding: "DOCUMENT_ANALYSIS_QUEUE",
      kind: "document.analyze",
      idempotencyKey: body.idempotencyKey,
      subjectId: body.subjectId,
      workspaceId: body.workspaceId ?? null,
      correlationId: body.correlationId,
      status: "dispatched",
    });

    const { env } = createEnv(d1);
    const item = mockMessage(body, "document_dlq_delivery", 1);
    await runBatch(
      env,
      expectedDocumentAnalysisDlqQueueName("development"),
      [item.message],
    );

    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    const run = sqlite.prepare(`
      SELECT status,error_code AS errorCode,lease_owner AS leaseOwner,
        next_attempt_at AS nextAttemptAt,finished_at AS finishedAt
      FROM job_runs WHERE id=?
    `).get(body.jobId) as {
      status: string;
      errorCode: string | null;
      leaseOwner: string | null;
      nextAttemptAt: string | null;
      finishedAt: string | null;
    };
    assert.equal(run.status, "dead_lettered");
    assert.equal(run.errorCode, "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE");
    assert.equal(run.leaseOwner, null);
    assert.equal(run.nextAttemptAt, null);
    assert.ok(run.finishedAt);
    assert.equal(
      (sqlite.prepare(
        "SELECT status FROM document_analyses WHERE id=?",
      ).get(body.subjectId) as { status: string }).status,
      "retrying",
      "the existing audited redrive can still claim this analysis",
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT status FROM job_outbox WHERE id='outbox_document_dlq'",
      ).get() as { status: string }).status,
      "dispatched",
      "the outbox remains eligible for the existing redrive path",
    );
    const health = sqlite.prepare(`
      SELECT dependency_key AS dependencyKey,state,safe_error_code AS safeErrorCode,
        evidence_kind AS evidenceKind
      FROM dependency_health_checks
      ORDER BY created_at DESC,id DESC LIMIT 1
    `).get() as {
      dependencyKey: string;
      state: string;
      safeErrorCode: string | null;
      evidenceKind: string;
    };
    assert.equal(health.dependencyKey, "queue_dlq");
    assert.equal(health.state, "degraded");
    assert.equal(health.safeErrorCode, "DLQ_BACKLOG");
    assert.equal(health.evidenceKind, "integration_event");
  } finally {
    sqlite.close();
  }
});

test("a superseded DLQ delivery cannot terminalize a newer audited redrive", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const body = envelope("document.analyze", {
      jobId: "job_document_superseded_dlq",
      idempotencyKey: "idem_document_superseded_dlq",
      subjectId: "analysis_document_superseded_dlq",
      correlationId: "corr_document_superseded_dlq",
      redriveVersion: 0,
    });
    insertSourceQueueJobRun(sqlite, body);
    sqlite.prepare(`
      INSERT INTO operational_job_redrive_events (id,source_job_id,version)
      VALUES ('redrive_document_superseded_dlq',?,1)
    `).run(body.jobId);

    const { env } = createEnv(d1);
    const item = mockMessage(body, "document_superseded_dlq_delivery");
    await runBatch(
      env,
      expectedDocumentAnalysisDlqQueueName("development"),
      [item.message],
    );

    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    const run = sqlite.prepare(
      "SELECT status,error_code AS errorCode FROM job_runs WHERE id=?",
    ).get(body.jobId) as { status: string; errorCode: string };
    assert.equal(run.status, "retrying");
    assert.equal(run.errorCode, "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE");
  } finally {
    sqlite.close();
  }
});

test("document-analysis DLQ retries instead of racing an active source lease", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const body = envelope("document.analyze", {
      jobId: "job_document_dlq_busy",
      idempotencyKey: "idem_document_dlq_busy",
      subjectId: "analysis_dlq_busy",
      workspaceId: "ws_test",
      correlationId: "corr_document_dlq_busy",
    });
    sqlite.prepare(`
      INSERT INTO document_analyses (
        id,workspace_id,owner_user_id,uploaded_file_id,status,summary_json,
        result_sha256,error_code,consent_version,created_at,updated_at
      ) VALUES (?,'ws_test','user_test','file_dlq_busy','processing',NULL,NULL,
        NULL,'2026-08-12',?,?)
    `).run(body.subjectId, "2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z");
    insertSourceQueueJobRun(sqlite, body, {
      status: "running",
      errorCode: null,
      leaseExpiresAt: "2999-01-01T00:00:00.000Z",
    });
    const { env } = createEnv(d1);
    const item = mockMessage(body, "document_dlq_busy_delivery", 2);
    await runBatch(
      env,
      expectedDocumentAnalysisDlqQueueName("development"),
      [item.message],
    );

    assert.equal(item.state.acknowledgements, 0);
    assert.deepEqual(item.state.retries, [{ delaySeconds: 30 }]);
    assert.equal(
      (sqlite.prepare(
        "SELECT status FROM job_runs WHERE id=?",
      ).get(body.jobId) as { status: string }).status,
      "running",
    );
  } finally {
    sqlite.close();
  }
});

test("document-analysis DLQ terminalizes an exact durable run even if its source subject was purged", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const body = envelope("document.analyze", {
      jobId: "job_document_dlq_purged",
      idempotencyKey: "idem_document_dlq_purged",
      subjectId: "analysis_already_purged",
      workspaceId: "ws_test",
      correlationId: "corr_document_dlq_purged",
    });
    insertSourceQueueJobRun(sqlite, body);
    const { env } = createEnv(d1);
    const item = mockMessage(body, "document_dlq_purged_delivery", 1);
    await runBatch(
      env,
      expectedDocumentAnalysisDlqQueueName("development"),
      [item.message],
    );

    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    assert.equal(
      (sqlite.prepare(
        "SELECT status FROM job_runs WHERE id=?",
      ).get(body.jobId) as { status: string }).status,
      "dead_lettered",
    );
  } finally {
    sqlite.close();
  }
});

test("shared document-analysis DLQ also terminalizes exhausted indexing jobs without mutating index state", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const body = envelope("document.index", {
      jobId: "job_document_index_dlq",
      idempotencyKey: "idem_document_index_dlq",
      subjectId: "index_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_document_index_dlq",
    });
    sqlite.prepare(`
      INSERT INTO user_document_index_jobs (
        id,analysis_id,document_version_id,workspace_id,owner_user_id,source_hash,
        language,access_scope,status,chunk_count,attempt_count,mutation_id,error_code,
        started_at,submitted_at,deleted_at,created_at,updated_at
      ) VALUES (?,'analysis_complete','version_dlq','ws_test','user_test',?,
        'ru','owner','failed',0,3,NULL,'USER_DOCUMENT_VECTOR_EMBEDDING_FAILED',
        NULL,NULL,NULL,?,?)
    `).run(
      body.subjectId,
      "a".repeat(64),
      "2026-08-12T00:00:00.000Z",
      "2026-08-12T00:00:00.000Z",
    );
    insertSourceQueueJobRun(sqlite, body);
    const { env } = createEnv(d1);
    const item = mockMessage(body, "document_index_dlq_delivery", 1);
    await runBatch(
      env,
      expectedDocumentAnalysisDlqQueueName("development"),
      [item.message],
    );

    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    assert.equal(
      (sqlite.prepare(
        "SELECT status,error_code AS errorCode FROM job_runs WHERE id=?",
      ).get(body.jobId) as { status: string; errorCode: string }).status,
      "dead_lettered",
    );
    const indexJob = sqlite.prepare(
      "SELECT status,error_code AS errorCode FROM user_document_index_jobs WHERE id=?",
    ).get(body.subjectId) as { status: string; errorCode: string | null };
    assert.equal(indexJob.status, "failed");
    assert.equal(indexJob.errorCode, "USER_DOCUMENT_VECTOR_EMBEDDING_FAILED");
  } finally {
    sqlite.close();
  }
});

test("OCR DLQ terminalizes only the ledger and preserves retryable OCR prerequisites", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS file_extractions (
        id TEXT PRIMARY KEY,
        analysis_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        updated_at TEXT NOT NULL
      );
    `);
    const body = envelope("ocr.process", {
      jobId: "job_ocr_dlq",
      idempotencyKey: "idem_ocr_dlq",
      subjectId: "analysis_ocr_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_ocr_dlq",
    });
    sqlite.prepare(`
      INSERT INTO document_analyses (
        id,workspace_id,owner_user_id,uploaded_file_id,status,summary_json,
        result_sha256,error_code,consent_version,created_at,updated_at
      ) VALUES (?,'ws_test','user_test','file_ocr_dlq','awaiting_ocr',NULL,NULL,
        'OCR_PROVIDER_UNAVAILABLE','2026-08-12',?,?)
    `).run(body.subjectId, "2026-08-12T00:00:00.000Z", "2026-08-12T00:00:00.000Z");
    sqlite.prepare(`
      INSERT INTO file_extractions (id,analysis_id,workspace_id,status,error_code,updated_at)
      VALUES ('ocr-analysis_ocr_dlq',?,'ws_test','retrying','OCR_PROVIDER_UNAVAILABLE',?)
    `).run(body.subjectId, "2026-08-12T00:00:00.000Z");
    insertSourceQueueJobRun(sqlite, body, {
      errorCode: "OCR_PROVIDER_UNAVAILABLE",
    });
    insertOutbox(sqlite, {
      id: "outbox_ocr_dlq",
      queueBinding: "OCR_PROCESSING_QUEUE",
      kind: "ocr.process",
      idempotencyKey: body.idempotencyKey,
      subjectId: body.subjectId,
      workspaceId: body.workspaceId ?? null,
      correlationId: body.correlationId,
      status: "dispatched",
    });
    const { env } = createEnv(d1);
    const item = mockMessage(body, "ocr_dlq_delivery", 1);
    await runBatch(
      env,
      expectedOcrProcessingDlqQueueName("development"),
      [item.message],
    );
    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT status,error_code AS errorCode FROM job_runs WHERE id=?",
      ).get(body.jobId) as object },
      { status: "dead_lettered", errorCode: "OCR_PROVIDER_UNAVAILABLE" },
    );
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT status,error_code AS errorCode FROM document_analyses WHERE id=?",
      ).get(body.subjectId) as object },
      { status: "awaiting_ocr", errorCode: "OCR_PROVIDER_UNAVAILABLE" },
      "OCR stays retryable for an audited redrive; the UI/API must project the dead-letter ledger, not claim completion.",
    );
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT status,error_code AS errorCode FROM file_extractions WHERE analysis_id=?",
      ).get(body.subjectId) as object },
      { status: "retrying", errorCode: "OCR_PROVIDER_UNAVAILABLE" },
    );
  } finally {
    sqlite.close();
  }
});

test("document-export DLQ terminalizes the durable run without mutating the retryable export or its audited redrive", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    sqlite.exec(`
      CREATE TABLE analysis_exports (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT
      );
      INSERT INTO analysis_exports (id,workspace_id,status,error_code)
      VALUES ('export_dlq','ws_test','retrying','ANALYSIS_EXPORT_OBJECT_FAILED');
    `);
    const body = envelope("document.export", {
      jobId: "job_document_export_dlq",
      idempotencyKey: "idem_document_export_dlq",
      subjectId: "export_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_document_export_dlq",
    });
    insertSourceQueueJobRun(sqlite, body, {
      errorCode: "DOCUMENT_EXPORT_OBJECT_FAILED",
    });
    insertOutbox(sqlite, {
      id: "outbox_document_export_dlq",
      queueBinding: "DOCUMENT_EXPORT_QUEUE",
      kind: "document.export",
      idempotencyKey: body.idempotencyKey,
      subjectId: body.subjectId,
      workspaceId: body.workspaceId ?? null,
      correlationId: body.correlationId,
      status: "dispatched",
    });
    const { env, sends } = createEnv(d1);
    const item = mockMessage(body, "document_export_dlq_delivery", 1);
    await runBatch(
      env,
      expectedDocumentExportDlqQueueName("development"),
      [item.message],
    );

    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT status,error_code AS errorCode FROM job_runs WHERE id=?",
      ).get(body.jobId) as object },
      { status: "dead_lettered", errorCode: "DOCUMENT_EXPORT_OBJECT_FAILED" },
    );
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT status,error_code AS errorCode FROM analysis_exports WHERE id='export_dlq'",
      ).get() as object },
      { status: "retrying", errorCode: "ANALYSIS_EXPORT_OBJECT_FAILED" },
      "the DLQ consumer must not alter user-visible export state or claim a result",
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT status FROM job_outbox WHERE id='outbox_document_export_dlq'",
      ).get() as { status: string }).status,
      "dispatched",
      "the append-only operator redrive still owns republishing",
    );
    assert.equal(sends.length, 0, "DLQ terminalization never republishes an export");
  } finally {
    sqlite.close();
  }
});

test("malware-scan DLQ keeps the file quarantined and only terminalizes the durable run", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    sqlite.exec(`
      CREATE TABLE document_files (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        r2_key TEXT NOT NULL,
        file_name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS document_analyses (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        owner_user_id TEXT NOT NULL,
        uploaded_file_id TEXT NOT NULL,
        status TEXT NOT NULL,
        summary_json TEXT,
        result_sha256 TEXT,
        error_code TEXT,
        consent_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO document_files VALUES (
        'file_malware_dlq','ws_test','user_test','analysis_quarantined',
        'quarantine/ws_test/file_malware_dlq','synthetic.pdf','application/pdf',10,
        '${"0".repeat(64)}',NULL,'2026-08-12T00:00:00.000Z','2026-08-12T00:00:00.000Z'
      );
      INSERT INTO document_analyses VALUES (
        'analysis_malware_dlq','ws_test','user_test','file_malware_dlq','quarantined',
        NULL,NULL,'MALWARE_SCANNER_UNAVAILABLE','2026-08-12',
        '2026-08-12T00:00:00.000Z','2026-08-12T00:00:00.000Z'
      );
    `);
    const body = envelope("malware.scan", {
      jobId: "job_malware_scan_dlq",
      idempotencyKey: "idem_malware_scan_dlq",
      subjectId: "analysis_malware_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_malware_scan_dlq",
    });
    insertSourceQueueJobRun(sqlite, body, {
      errorCode: "MALWARE_SCANNER_UNAVAILABLE",
    });
    insertOutbox(sqlite, {
      id: "outbox_malware_scan_dlq",
      queueBinding: "MALWARE_SCAN_QUEUE",
      kind: "malware.scan",
      idempotencyKey: body.idempotencyKey,
      subjectId: body.subjectId,
      workspaceId: body.workspaceId ?? null,
      correlationId: body.correlationId,
      status: "dispatched",
    });
    const { env, sends } = createEnv(d1);
    const item = mockMessage(body, "malware_scan_dlq_delivery", 1);
    await runBatch(
      env,
      expectedMalwareScanDlqQueueName("development"),
      [item.message],
    );

    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT status,error_code AS errorCode FROM job_runs WHERE id=?",
      ).get(body.jobId) as object },
      { status: "dead_lettered", errorCode: "MALWARE_SCANNER_UNAVAILABLE" },
    );
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT kind,r2_key AS r2Key FROM document_files WHERE id='file_malware_dlq'",
      ).get() as object },
      {
        kind: "analysis_quarantined",
        r2Key: "quarantine/ws_test/file_malware_dlq",
      },
      "a dead-lettered scanner job must never promote a quarantined file",
    );
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT status,error_code AS errorCode FROM document_analyses WHERE id='analysis_malware_dlq'",
      ).get() as object },
      { status: "quarantined", errorCode: "MALWARE_SCANNER_UNAVAILABLE" },
    );
    assert.equal(sends.length, 0, "DLQ terminalization cannot enqueue extraction or analysis");
  } finally {
    sqlite.close();
  }
});

test("scheduled reconciliation fences stale document and OCR retry exhaustion without resubmitting work", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const document = envelope("document.analyze", {
      jobId: "job_document_scheduled_dlq",
      idempotencyKey: "idem_document_scheduled_dlq",
      subjectId: "analysis_scheduled_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_document_scheduled_dlq",
    });
    const ocr = envelope("ocr.process", {
      jobId: "job_ocr_scheduled_dlq",
      idempotencyKey: "idem_ocr_scheduled_dlq",
      subjectId: "analysis_ocr_scheduled_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_ocr_scheduled_dlq",
    });
    sqlite.exec(`
      INSERT INTO document_analyses (
        id,workspace_id,owner_user_id,uploaded_file_id,status,summary_json,
        result_sha256,error_code,consent_version,created_at,updated_at
      ) VALUES
        ('analysis_scheduled_dlq','ws_test','user_test','file_scheduled_dlq','retrying',NULL,NULL,
         'DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE','2026-08-12','2026-08-12T00:00:00.000Z','2026-08-12T00:00:00.000Z'),
        ('analysis_ocr_scheduled_dlq','ws_test','user_test','file_ocr_scheduled_dlq','awaiting_ocr',NULL,NULL,
         'OCR_PROVIDER_UNAVAILABLE','2026-08-12','2026-08-12T00:00:00.000Z','2026-08-12T00:00:00.000Z');
    `);
    insertSourceQueueJobRun(sqlite, document);
    insertSourceQueueJobRun(sqlite, ocr, {
      errorCode: "OCR_PROVIDER_UNAVAILABLE",
    });
    insertOutbox(sqlite, {
      id: "outbox_document_scheduled_dlq",
      queueBinding: "DOCUMENT_ANALYSIS_QUEUE",
      kind: "document.analyze",
      idempotencyKey: document.idempotencyKey,
      subjectId: document.subjectId,
      workspaceId: document.workspaceId ?? null,
      correlationId: document.correlationId,
      status: "dispatched",
    });
    insertOutbox(sqlite, {
      id: "outbox_ocr_scheduled_dlq",
      queueBinding: "OCR_PROCESSING_QUEUE",
      kind: "ocr.process",
      idempotencyKey: ocr.idempotencyKey,
      subjectId: ocr.subjectId,
      workspaceId: ocr.workspaceId ?? null,
      correlationId: ocr.correlationId,
      status: "retrying",
    });
    const { env, sends } = createEnv(d1);
    const result = await reconcileRetryExhaustedDocumentJobs(env, {
      now: new Date("2026-08-12T00:20:00.000Z"),
    });
    assert.deepEqual(result, { eligible: 2, terminalized: 2 });
    assert.equal(sends.length, 0, "reconciliation never silently republishes work");
    const states = sqlite.prepare(`
      SELECT id,status,error_code AS errorCode,lease_owner AS leaseOwner,
        next_attempt_at AS nextAttemptAt
      FROM job_runs
      WHERE id IN (?,?)
      ORDER BY id ASC
    `).all(document.jobId, ocr.jobId) as Array<{
      id: string;
      status: string;
      errorCode: string | null;
      leaseOwner: string | null;
      nextAttemptAt: string | null;
    }>;
    assert.deepEqual(states.map((state) => ({ ...state })), [
      {
        id: document.jobId,
        status: "dead_lettered",
        errorCode: "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE",
        leaseOwner: null,
        nextAttemptAt: null,
      },
      {
        id: ocr.jobId,
        status: "dead_lettered",
        errorCode: "OCR_PROVIDER_UNAVAILABLE",
        leaseOwner: null,
        nextAttemptAt: null,
      },
    ]);
    assert.equal(
      (sqlite.prepare("SELECT status FROM document_analyses WHERE id=?").get(document.subjectId) as { status: string }).status,
      "retrying",
    );
    assert.equal(
      (sqlite.prepare("SELECT status FROM document_analyses WHERE id=?").get(ocr.subjectId) as { status: string }).status,
      "awaiting_ocr",
    );
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT state,safe_error_code AS safeErrorCode,evidence_kind AS evidenceKind
        FROM dependency_health_checks
        WHERE dependency_key='queue_dlq'
        ORDER BY created_at DESC,id DESC LIMIT 1
      `).get() as object },
      { state: "degraded", safeErrorCode: "DLQ_BACKLOG", evidenceKind: "scheduled_job" },
    );
  } finally {
    sqlite.close();
  }
});

test("scheduled reconciliation terminalizes retry-exhausted export and malware jobs without republishing or promoting files", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const exportJob = envelope("document.export", {
      jobId: "job_document_export_scheduled_dlq",
      idempotencyKey: "idem_document_export_scheduled_dlq",
      subjectId: "export_scheduled_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_document_export_scheduled_dlq",
    });
    const malwareJob = envelope("malware.scan", {
      jobId: "job_malware_scan_scheduled_dlq",
      idempotencyKey: "idem_malware_scan_scheduled_dlq",
      subjectId: "analysis_malware_scheduled_dlq",
      workspaceId: "ws_test",
      correlationId: "corr_malware_scan_scheduled_dlq",
    });
    insertSourceQueueJobRun(sqlite, exportJob, {
      errorCode: "DOCUMENT_EXPORT_OBJECT_FAILED",
    });
    insertSourceQueueJobRun(sqlite, malwareJob, {
      errorCode: "MALWARE_SCANNER_UNAVAILABLE",
    });
    insertOutbox(sqlite, {
      id: "outbox_document_export_scheduled_dlq",
      queueBinding: "DOCUMENT_EXPORT_QUEUE",
      kind: "document.export",
      idempotencyKey: exportJob.idempotencyKey,
      subjectId: exportJob.subjectId,
      workspaceId: exportJob.workspaceId ?? null,
      correlationId: exportJob.correlationId,
      status: "dispatched",
    });
    insertOutbox(sqlite, {
      id: "outbox_malware_scan_scheduled_dlq",
      queueBinding: "MALWARE_SCAN_QUEUE",
      kind: "malware.scan",
      idempotencyKey: malwareJob.idempotencyKey,
      subjectId: malwareJob.subjectId,
      workspaceId: malwareJob.workspaceId ?? null,
      correlationId: malwareJob.correlationId,
      status: "retrying",
    });
    const { env, sends } = createEnv(d1);
    const result = await reconcileRetryExhaustedQueueJobs(env, {
      now: new Date("2026-08-12T00:20:00.000Z"),
    });

    assert.deepEqual(result, { eligible: 2, terminalized: 2 });
    assert.equal(sends.length, 0, "scheduled recovery is terminalization-only");
    assert.deepEqual(
      (sqlite.prepare(`
        SELECT id,status,error_code AS errorCode FROM job_runs
        WHERE id IN (?,?) ORDER BY id ASC
      `).all(exportJob.jobId, malwareJob.jobId) as Array<object>).map((row) => ({ ...row })),
      [
        {
          id: exportJob.jobId,
          status: "dead_lettered",
          errorCode: "DOCUMENT_EXPORT_OBJECT_FAILED",
        },
        {
          id: malwareJob.jobId,
          status: "dead_lettered",
          errorCode: "MALWARE_SCANNER_UNAVAILABLE",
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  } finally {
    sqlite.close();
  }
});

test("scheduled reconciliation never races fresh work, an active lease, or a pending redrive", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const fresh = envelope("document.analyze", {
      jobId: "job_document_fresh_retry",
      idempotencyKey: "idem_document_fresh_retry",
      subjectId: "analysis_fresh_retry",
      workspaceId: "ws_test",
      correlationId: "corr_document_fresh_retry",
    });
    const active = envelope("ocr.process", {
      jobId: "job_ocr_active_retry",
      idempotencyKey: "idem_ocr_active_retry",
      subjectId: "analysis_ocr_active_retry",
      workspaceId: "ws_test",
      correlationId: "corr_ocr_active_retry",
    });
    const redrive = envelope("document.index", {
      jobId: "job_index_pending_redrive",
      idempotencyKey: "idem_index_pending_redrive",
      subjectId: "index_pending_redrive",
      workspaceId: "ws_test",
      correlationId: "corr_index_pending_redrive",
    });
    insertSourceQueueJobRun(sqlite, fresh);
    insertSourceQueueJobRun(sqlite, active, {
      status: "running",
      leaseExpiresAt: "2999-01-01T00:00:00.000Z",
    });
    insertSourceQueueJobRun(sqlite, redrive);
    sqlite.prepare("UPDATE job_runs SET updated_at=? WHERE id=?").run(
      "2026-08-12T00:19:00.000Z",
      fresh.jobId,
    );
    insertOutbox(sqlite, {
      id: "outbox_fresh_retry",
      queueBinding: "DOCUMENT_ANALYSIS_QUEUE",
      kind: "document.analyze",
      idempotencyKey: fresh.idempotencyKey,
      subjectId: fresh.subjectId,
      workspaceId: fresh.workspaceId ?? null,
      correlationId: fresh.correlationId,
      status: "dispatched",
    });
    insertOutbox(sqlite, {
      id: "outbox_ocr_active_retry",
      queueBinding: "OCR_PROCESSING_QUEUE",
      kind: "ocr.process",
      idempotencyKey: active.idempotencyKey,
      subjectId: active.subjectId,
      workspaceId: active.workspaceId ?? null,
      correlationId: active.correlationId,
      status: "dispatched",
    });
    insertOutbox(sqlite, {
      id: "outbox_index_pending_redrive",
      queueBinding: "DOCUMENT_ANALYSIS_QUEUE",
      kind: "document.index",
      idempotencyKey: redrive.idempotencyKey,
      subjectId: redrive.subjectId,
      workspaceId: redrive.workspaceId ?? null,
      correlationId: redrive.correlationId,
      status: "pending",
    });
    const { env } = createEnv(d1);
    assert.deepEqual(
      await reconcileRetryExhaustedDocumentJobs(env, {
        now: new Date("2026-08-12T00:20:00.000Z"),
      }),
      { eligible: 0, terminalized: 0 },
    );
    const statuses = sqlite.prepare(`
      SELECT id,status FROM job_runs WHERE id IN (?,?,?) ORDER BY id ASC
    `).all(fresh.jobId, active.jobId, redrive.jobId) as Array<{
      id: string;
      status: string;
    }>;
    assert.deepEqual(statuses.map((status) => ({ ...status })), [
      { id: fresh.jobId, status: "retrying" },
      { id: redrive.jobId, status: "retrying" },
      { id: active.jobId, status: "running" },
    ]);
  } finally {
    sqlite.close();
  }
});

test("invalid document-analysis DLQ messages retain bounded retry instead of blind acknowledgement", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1);
    const invalid = mockMessage({ unexpected: "not a queue envelope" }, "document_dlq_invalid", 1);
    await runBatch(
      env,
      expectedDocumentAnalysisDlqQueueName("development"),
      [invalid.message],
    );
    assert.equal(invalid.state.acknowledgements, 0);
    assert.deepEqual(invalid.state.retries, [{ delaySeconds: 15 }]);
    const health = sqlite.prepare(`
      SELECT dependency_key AS dependencyKey,state,safe_error_code AS safeErrorCode
      FROM dependency_health_checks
      WHERE dependency_key='queue_dlq'
      ORDER BY created_at DESC,id DESC LIMIT 1
    `).get() as {
      dependencyKey: string;
      state: string;
      safeErrorCode: string | null;
    };
    assert.equal(health.dependencyKey, "queue_dlq");
    assert.equal(health.state, "degraded");
    assert.equal(health.safeErrorCode, "DLQ_INVALID_MESSAGE");
  } finally {
    sqlite.close();
  }
});

test("unmatched document-analysis DLQ envelopes retain bounded retry instead of blind acknowledgement", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1);
    const body = envelope("document.analyze", {
      jobId: "job_document_dlq_orphan",
      idempotencyKey: "idem_document_dlq_orphan",
      subjectId: "analysis_dlq_orphan",
      workspaceId: "ws_test",
      correlationId: "corr_document_dlq_orphan",
    });
    const orphan = mockMessage(body, "document_dlq_orphan", 2);
    await runBatch(
      env,
      expectedDocumentAnalysisDlqQueueName("development"),
      [orphan.message],
    );
    assert.equal(orphan.state.acknowledgements, 0);
    assert.deepEqual(orphan.state.retries, [{ delaySeconds: 30 }]);
    assert.equal(
      (sqlite.prepare("SELECT COUNT(*) AS count FROM job_runs").get() as { count: number }).count,
      0,
    );
    assert.equal(
      (sqlite.prepare(`
        SELECT safe_error_code AS safeErrorCode
        FROM dependency_health_checks
        WHERE dependency_key='queue_dlq'
        ORDER BY checked_at DESC,id DESC LIMIT 1
      `).get() as { safeErrorCode: string | null }).safeErrorCode,
      "DLQ_UNMATCHED_MESSAGE",
    );
  } finally {
    sqlite.close();
  }
});

test("invalid and disabled messages remain isolated within a batch", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1);
    const failingBody = envelope();
    const invalid = mockMessage({ unsafe: true }, "mixed_invalid");
    const failing = mockMessage(failingBody, "mixed_failing", 2);
    await runBatch(
      env,
      expectedQueueName(failingBody.kind, "development"),
      [invalid.message, failing.message],
    );
    assert.equal(invalid.state.acknowledgements, 1);
    assert.deepEqual(invalid.state.retries, []);
    assert.equal(failing.state.acknowledgements, 1);
    assert.deepEqual(failing.state.retries, []);
    const row = sqlite.prepare(`
      SELECT status, error_code, next_attempt_at
      FROM job_runs
      WHERE idempotency_key = ?
    `).get(failingBody.idempotencyKey) as {
      status: string;
      error_code: string;
      next_attempt_at: string | null;
    };
    assert.equal(row.status, "rejected");
    assert.equal(row.error_code, "JOB_HANDLER_NOT_ENABLED");
    assert.equal(row.next_attempt_at, null);
  } finally {
    sqlite.close();
  }
});

test("telemetry failures never roll back a durable rejection", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1, { analyticsThrows: true });
    const body = envelope();
    const item = mockMessage(body, "metrics_failure");
    await runBatch(
      env,
      expectedQueueName(body.kind, "development"),
      [item.message],
    );
    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    assert.equal(
      (
        sqlite.prepare(`
          SELECT status FROM job_runs WHERE idempotency_key = ?
        `).get(body.idempotencyKey) as { status: string }
      ).status,
      "rejected",
    );
  } finally {
    sqlite.close();
  }
});

test("structured logs never contain rejected message content", async () => {
  const { sqlite, d1 } = createDatabase();
  const entries: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...values: unknown[]) => entries.push(values.join(" "));
  console.error = (...values: unknown[]) => entries.push(values.join(" "));
  try {
    const { env } = createEnv(d1);
    const marker = "SECRET_DOCUMENT_TEXT_42";
    const item = mockMessage({
      ...envelope(),
      payload: { text: marker },
    }, "secret_log_test");
    await runBatch(
      env,
      expectedQueueName("cleanup.run", "development"),
      [item.message],
    );
    assert.equal(item.state.acknowledgements, 1);
    assert.doesNotMatch(entries.join("\n"), new RegExp(marker));
  } finally {
    console.log = originalLog;
    console.error = originalError;
    sqlite.close();
  }
});

test("scheduled runtime remains inert when disabled and rejects unknown cron", async () => {
  for (const options of [
    { asyncEnabled: "false", cronEnabled: "false" },
    { asyncEnabled: "true", cronEnabled: "false" },
    { asyncEnabled: "true", cronEnabled: "true" },
  ]) {
    const { sqlite, d1 } = createDatabase();
    try {
      const { env } = createEnv(d1, options);
      let noRetryCalls = 0;
      await handleScheduled(
        {
          scheduledTime: Date.UTC(2026, 6, 26),
          cron: "0 0 * * *",
          noRetry() {
            noRetryCalls += 1;
          },
        },
        env,
      );
      assert.equal(noRetryCalls, 1);
      assert.equal(d1.prepareCalls, 0);
    } finally {
      sqlite.close();
    }
  }
});

test("disabled legal corpus cron does not enqueue work the consumer would reject", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    const { env } = createEnv(d1, {
      asyncEnabled: "true",
      cronEnabled: "true",
    });
    let noRetryCalls = 0;
    await handleScheduled({
      scheduledTime: Date.UTC(2026, 7, 12, 19, 0),
      cron: "0 19 * * *",
      noRetry() {
        noRetryCalls += 1;
      },
    }, env);
    assert.equal(noRetryCalls, 1);
    assert.equal(d1.prepareCalls, 0);
  } finally {
    sqlite.close();
  }
});

test("reviewed outbox cron is locked, durable, and idempotent", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    insertOutbox(sqlite);
    const { env, sends } = createEnv(d1, {
      asyncEnabled: "true",
      cronEnabled: "true",
    });
    let noRetryCalls = 0;
    const controller = {
      scheduledTime: Date.UTC(2026, 6, 26, 0, 5),
      cron: "*/5 * * * *",
      noRetry() {
        noRetryCalls += 1;
      },
    } satisfies ScheduledController;
    await handleScheduled(controller, env);
    assert.equal(noRetryCalls, 0);
    assert.equal(sends.length, 1);
    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT status,error_code AS errorCode
         FROM scheduled_runs WHERE schedule_name='outbox-dispatch'`,
      ).get() },
      { status: "completed", errorCode: null },
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM scheduled_locks").get() as { total: number }).total,
      0,
    );
    const d1Health = sqlite.prepare(`SELECT state,latency_ms AS latencyMs,
      evidence_kind AS evidenceKind
      FROM dependency_health_checks WHERE dependency_key='d1'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as {
      state: string;
      latencyMs: number;
      evidenceKind: string;
    };
    assert.equal(d1Health.state, "operational");
    assert.equal(d1Health.evidenceKind, "synthetic_probe");
    assert.ok(d1Health.latencyMs <= 2_000, "D1 latency must measure the dedicated probe, not the full cron run");

    await handleScheduled(controller, env);
    assert.equal(noRetryCalls, 1);
    assert.equal(sends.length, 1);
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM scheduled_runs").get() as { total: number }).total,
      1,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM scheduled_locks").get() as { total: number }).total,
      0,
    );
  } finally {
    sqlite.close();
  }
});

test("outbox cron hard-purges only due memory tombstones without logging content", async () => {
  const { sqlite, d1 } = createDatabase();
  const entries: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => entries.push(values.join(" "));
  try {
    sqlite.exec(`
      INSERT INTO user_memories (id,status,deleted_at,ciphertext) VALUES
        ('memory_due','deleted','2020-01-01T00:00:00.000Z','SECRET_MEMORY_MARKER'),
        ('memory_future','deleted','2999-01-01T00:00:00.000Z','future-ciphertext'),
        ('memory_active','active','2020-01-01T00:00:00.000Z','active-ciphertext');
      INSERT INTO memory_sources (id,memory_id) VALUES
        ('source_due','memory_due'),
        ('source_future','memory_future'),
        ('source_active','memory_active');
    `);
    const { env } = createEnv(d1, {
      asyncEnabled: "true",
      cronEnabled: "true",
    });
    await handleScheduled({
      scheduledTime: Date.UTC(2026, 7, 10, 0, 5),
      cron: "*/5 * * * *",
      noRetry() {},
    }, env);

    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM user_memories WHERE id='memory_due'").get()?.total, 0);
    assert.equal(sqlite.prepare("SELECT count(*) AS total FROM memory_sources WHERE id='source_due'").get()?.total, 0);
    assert.equal(sqlite.prepare("SELECT status FROM user_memories WHERE id='memory_future'").get()?.status, "deleted");
    assert.equal(sqlite.prepare("SELECT status FROM user_memories WHERE id='memory_active'").get()?.status, "active");
    const completion = entries.map((entry) => {
      try {
        return JSON.parse(entry) as Record<string, unknown>;
      } catch {
        return {};
      }
    }).find((entry) => entry.event === "scheduled.outbox_completed");
    assert.equal(completion?.memoryRetentionEligible, 1);
    assert.equal(completion?.memoryRetentionPurged, 1);
    assert.equal(completion?.builderVersionObjectsEligible, 0);
    assert.doesNotMatch(entries.join("\n"), /SECRET_MEMORY_MARKER/);
  } finally {
    console.log = originalLog;
    sqlite.close();
  }
});

test("outbox cron purges expired guest AI content and retains active sessions without logging ciphertext", async () => {
  const { sqlite, d1 } = createDatabase();
  const entries: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => entries.push(values.join(" "));
  try {
    const sessionInsert = sqlite.prepare(`INSERT INTO guest_ai_sessions(
      id,token_hmac,token_key_version,ip_hmac,locale,state,request_count,
      answer_count,expires_at,consumed_at,created_at,updated_at
    ) VALUES (?,?,?,?,?,'consumed',1,1,?,?,?,?)`);
    sessionInsert.run(
      "guest_due", "token-due", "v1", "ip-due", "ru",
      "2020-08-09T00:00:00.000Z", "2020-08-03T00:01:00.000Z",
      "2026-08-03T00:00:00.000Z", "2026-08-03T00:01:00.000Z",
    );
    sessionInsert.run(
      "guest_future", "token-future", "v1", "ip-future", "uz",
      "2999-08-09T00:00:00.000Z", "2026-08-03T00:01:00.000Z",
      "2026-08-03T00:00:00.000Z", "2026-08-03T00:01:00.000Z",
    );
    const runInsert = sqlite.prepare(`INSERT INTO guest_ai_runs(
      id,session_id,idempotency_key,request_hash,correlation_id,provider,model,
      status,response_kind,request_ciphertext,request_iv,request_key_version,
      result_ciphertext,result_iv,result_key_version,legal_database_as_of,
      instruction_hash,source_version_hash,expires_at,started_at,completed_at,
      created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,'completed','answer',?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    runInsert.run(
      "guest-run-due", "guest_due", "guest-idem-due", "a".repeat(64),
      "guest-corr-due", "openai", "synthetic", "SECRET_GUEST_QUESTION_CIPHER",
      "iv", "v1", "SECRET_GUEST_RESULT_CIPHER", "iv", "v1",
      "2026-08-03T00:00:00.000Z", "b".repeat(64), "c".repeat(64),
      "2020-08-09T00:00:00.000Z", "2020-08-03T00:00:00.000Z",
      "2026-08-03T00:01:00.000Z", "2026-08-03T00:00:00.000Z",
      "2026-08-03T00:01:00.000Z",
    );

    const { env } = createEnv(d1, {
      asyncEnabled: "true",
      cronEnabled: "true",
    });
    await handleScheduled({
      scheduledTime: Date.UTC(2026, 7, 10, 0, 5),
      cron: "*/5 * * * *",
      noRetry() {},
    }, env);

    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM guest_ai_sessions WHERE id='guest_due'").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM guest_ai_runs WHERE id='guest-run-due'").get()?.count, 0);
    assert.equal(sqlite.prepare("SELECT state FROM guest_ai_sessions WHERE id='guest_future'").get()?.state, "consumed");
    const completion = entries.map((entry) => {
      try {
        return JSON.parse(entry) as Record<string, unknown>;
      } catch {
        return {};
      }
    }).find((entry) => entry.event === "scheduled.outbox_completed");
    assert.equal(completion?.guestAiRetentionEligible, 1);
    assert.equal(completion?.guestAiRetentionPurged, 1);
    assert.equal(completion?.builderVersionObjectsEligible, 0);
    assert.doesNotMatch(entries.join("\n"), /SECRET_GUEST_/);
  } finally {
    console.log = originalLog;
    sqlite.close();
  }
});

test("due in-app task reminders create one inbox notification and remain retry-safe", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    sqlite.exec(`
      INSERT INTO workspace_members (
        id,workspace_id,user_id,role,status,joined_at,created_at,updated_at
      ) VALUES (
        'wm_reminder','ws_test','user_reminder','owner','active',
        '2026-07-20T00:00:00.000Z','2026-07-20T00:00:00.000Z',
        '2026-07-20T00:00:00.000Z'
      );
      INSERT INTO cases (id,workspace_id,owner_user_id,locale,archived_at)
      VALUES ('case_reminder','ws_test','user_reminder','uz',NULL);
      INSERT INTO tasks (id,workspace_id,case_id,owner_user_id,title,due_at,status)
      VALUES ('task_reminder','ws_test','case_reminder','user_reminder','Ariza yuborish','2026-07-30T00:00:00.000Z','planned');
      INSERT INTO task_reminders (id,task_id,channel,reminder_at,status,sent_at,updated_at)
      VALUES ('reminder_due','task_reminder','in_app','2026-07-29T00:00:00.000Z','pending',NULL,'2026-07-28T00:00:00.000Z');
    `);
    const { env, sends } = createEnv(d1);
    const now = "2026-07-29T00:00:00.000Z";
    assert.deepEqual(await enqueueDueTaskReminders(env, now), {
      due: 1,
      enqueued: 1,
    });
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM notifications").get() as { total: number }).total,
      0,
    );
    assert.deepEqual(await dispatchOutbox(env, 10), {
      claimed: 1,
      dispatched: 1,
      rejected: 0,
      retrying: 0,
    });
    assert.equal(sends.length, 1);
    assert.equal(sends[0]?.binding, "NOTIFICATIONS_QUEUE");
    const queued = sends[0]?.body as JobEnvelope;
    assert.equal(queued.kind, "notification.dispatch");
    assert.equal(queued.workspaceId, "ws_test");
    assert.match(queued.subjectId, /^task-reminder:reminder_due:[0-9a-z]+$/);
    assert.doesNotMatch(JSON.stringify(queued), /Ariza yuborish/);

    const first = mockMessage(queued, "notification_reminder_1");
    await runBatch(
      env,
      expectedQueueName("notification.dispatch", "development"),
      [first.message],
    );
    assert.equal(first.state.acknowledgements, 1);
    assert.deepEqual(first.state.retries, []);
    assert.deepEqual(
      { ...sqlite.prepare(
        "SELECT id,type,title,body FROM notifications WHERE id='task-reminder:reminder_due'",
      ).get() },
      {
        id: "task-reminder:reminder_due",
        type: "deadline_reminder",
        title: "Vazifa muddati",
        body: "Vazifa muddati yaqinlashmoqda: Ariza yuborish.",
      },
    );
    const sentRow = sqlite.prepare(
      "SELECT status,sent_at AS sentAt FROM task_reminders WHERE id='reminder_due'",
    ).get() as { status: string; sentAt: string | null };
    assert.equal(sentRow.status, "sent");
    assert.ok(sentRow.sentAt);

    const duplicate = mockMessage(queued, "notification_reminder_2", 2);
    await runBatch(
      env,
      expectedQueueName("notification.dispatch", "development"),
      [duplicate.message],
    );
    assert.equal(duplicate.state.acknowledgements, 1);
    assert.deepEqual(duplicate.state.retries, []);
    assert.deepEqual(await enqueueDueTaskReminders(env, now), {
      due: 0,
      enqueued: 0,
    });
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM notifications").get() as { total: number }).total,
      1,
    );
  } finally {
    sqlite.close();
  }
  assert.equal(
    jobEnvelopeSchema.safeParse({
      ...envelope("email.send"),
      workspaceId: undefined,
      subjectId: "operational_alert_id",
    }).success,
    true,
  );
});

test("due email task reminders enqueue an opaque idempotent email job", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    sqlite.exec(`
      INSERT INTO workspace_members (
        id,workspace_id,user_id,role,status,joined_at,created_at,updated_at
      ) VALUES (
        'wm_email_reminder','ws_test','user_email_reminder','owner','active',
        '2026-07-20T00:00:00.000Z','2026-07-20T00:00:00.000Z',
        '2026-07-20T00:00:00.000Z'
      );
      INSERT INTO cases (id,workspace_id,owner_user_id,locale,archived_at)
      VALUES ('case_email_reminder','ws_test','user_email_reminder','ru',NULL);
      INSERT INTO tasks (id,workspace_id,case_id,owner_user_id,title,due_at,status)
      VALUES ('task_email_reminder','ws_test','case_email_reminder','user_email_reminder','Secret task title','2026-07-30T00:00:00.000Z','planned');
      INSERT INTO task_reminders (id,task_id,channel,reminder_at,status,sent_at,updated_at)
      VALUES ('reminder_email_due','task_email_reminder','email','2026-07-29T00:00:00.000Z','pending',NULL,'2026-07-28T00:00:00.000Z');
    `);
    const { env, sends } = createEnv(d1);
    const now = "2026-07-29T00:00:00.000Z";
    assert.deepEqual(await enqueueDueTaskReminders(env, now), {
      due: 1,
      enqueued: 1,
    });
    const durable = sqlite.prepare(
      "SELECT id,status,workspace_id AS workspaceId,user_id AS userId FROM task_reminder_email_jobs",
    ).get() as { id: string; status: string; workspaceId: string; userId: string };
    assert.match(durable.id, /^task-reminder-email:reminder_email_due:[0-9a-z]+$/u);
    assert.deepEqual({ status: durable.status, workspaceId: durable.workspaceId, userId: durable.userId }, {
      status: "pending",
      workspaceId: "ws_test",
      userId: "user_email_reminder",
    });
    assert.deepEqual(await dispatchOutbox(env, 10), {
      claimed: 1,
      dispatched: 1,
      rejected: 0,
      retrying: 0,
    });
    assert.equal(sends.length, 1);
    assert.equal(sends[0]?.binding, "EMAIL_NOTIFICATIONS_QUEUE");
    const queued = sends[0]?.body as JobEnvelope;
    assert.equal(queued.kind, "email.send");
    assert.equal(queued.subjectId, durable.id);
    assert.equal(queued.workspaceId, "ws_test");
    assert.doesNotMatch(JSON.stringify(queued), /Secret task title|@/u);
    assert.deepEqual(await enqueueDueTaskReminders(env, now), {
      due: 1,
      enqueued: 0,
    });
  } finally {
    sqlite.close();
  }
});

test("notification consumer does not reveal or deliver a reminder across workspaces", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    sqlite.exec(`
      INSERT INTO workspaces (id,type,name,locale,created_at,updated_at)
      VALUES ('ws_other','individual','Other workspace','ru','2026-07-20T00:00:00.000Z','2026-07-20T00:00:00.000Z');
      INSERT INTO workspace_members (
        id,workspace_id,user_id,role,status,joined_at,created_at,updated_at
      ) VALUES (
        'wm_isolated','ws_test','user_isolated','owner','active',
        '2026-07-20T00:00:00.000Z','2026-07-20T00:00:00.000Z',
        '2026-07-20T00:00:00.000Z'
      );
      INSERT INTO cases (id,workspace_id,owner_user_id,locale,archived_at)
      VALUES ('case_isolated','ws_test','user_isolated','ru',NULL);
      INSERT INTO tasks (id,workspace_id,case_id,owner_user_id,title,due_at,status)
      VALUES ('task_isolated','ws_test','case_isolated','user_isolated','Sensitive title','2026-07-30T00:00:00.000Z','planned');
      INSERT INTO task_reminders (id,task_id,channel,reminder_at,status,sent_at,updated_at)
      VALUES ('reminder_isolated','task_isolated','in_app','2026-07-29T00:00:00.000Z','pending',NULL,'2026-07-28T00:00:00.000Z');
    `);
    const { env } = createEnv(d1);
    const subjectId = "task-reminder:reminder_isolated:ms3w2yo0";
    const body = envelope("notification.dispatch", {
      jobId: "job_notification_cross_workspace",
      idempotencyKey: "idem_notification_cross_workspace",
      subjectId,
      workspaceId: "ws_other",
      correlationId: "corr_notification_cross_workspace",
    });
    const item = mockMessage(body, "notification_cross_workspace");
    await runBatch(
      env,
      expectedQueueName("notification.dispatch", "development"),
      [item.message],
    );
    assert.equal(item.state.acknowledgements, 1);
    assert.deepEqual(item.state.retries, []);
    assert.equal(
      (sqlite.prepare(
        "SELECT error_code FROM job_runs WHERE idempotency_key=?",
      ).get(body.idempotencyKey) as { error_code: string }).error_code,
      "NOTIFICATION_SOURCE_NOT_FOUND",
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM notifications").get() as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT status FROM task_reminders WHERE id='reminder_isolated'",
      ).get() as { status: string }).status,
      "pending",
    );
  } finally {
    sqlite.close();
  }
});
function insertOutbox(
  sqlite: DatabaseSync,
  overrides: Partial<{
    id: string;
    queueBinding: string;
    kind: string;
    idempotencyKey: string;
    subjectId: string;
    workspaceId: string | null;
    correlationId: string;
    status: string;
    leaseOwner: string | null;
    leaseExpiresAt: string | null;
  }> = {},
): void {
  const input = {
    id: "outbox_probe",
    queueBinding: "DATA_RETENTION_CLEANUP_QUEUE",
    kind: "cleanup.run",
    idempotencyKey: "outbox_idem_probe",
    subjectId: "outbox_subject_probe",
    workspaceId: null,
    correlationId: "outbox_corr_probe",
    status: "pending",
    leaseOwner: null,
    leaseExpiresAt: null,
    ...overrides,
  };
  sqlite.prepare(`
    INSERT INTO job_outbox (
      id, queue_binding, job_type, schema_version, idempotency_key,
      subject_id, workspace_id, correlation_id, enqueued_at,
      available_at, status, dispatch_attempts, lease_owner,
      lease_expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).run(
    input.id,
    input.queueBinding,
    input.kind,
    input.idempotencyKey,
    input.subjectId,
    input.workspaceId,
    input.correlationId,
    "2026-07-26T00:00:00.000Z",
    "2000-01-01T00:00:00.000Z",
    input.status,
    input.leaseOwner,
    input.leaseExpiresAt,
    "2026-07-26T00:00:00.000Z",
    "2026-07-26T00:00:00.000Z",
  );
}

function insertSourceQueueJobRun(
  sqlite: DatabaseSync,
  body: JobEnvelope,
  overrides: Partial<{
    status: "running" | "retrying";
    errorCode: string | null;
    leaseExpiresAt: string | null;
  }> = {},
): void {
  const input = {
    status: "retrying" as const,
    errorCode: body.kind === "document.index"
      ? "USER_DOCUMENT_INDEX_FAILED"
      : "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE",
    leaseExpiresAt: null,
    ...overrides,
  };
  const now = "2026-08-12T00:00:00.000Z";
  sqlite.prepare(`
    INSERT INTO job_runs (
      id,queue_name,message_id,job_type,schema_version,idempotency_key,
      subject_id,workspace_id,correlation_id,envelope_hash,status,attempt,
      lease_owner,lease_expires_at,next_attempt_at,error_code,started_at,
      finished_at,created_at,updated_at
    ) VALUES (?,?,?,?,1,?,?,?,?,?,?,3,NULL,?,?,?, ?,NULL,?,?)
  `).run(
    body.jobId,
    expectedQueueName(body.kind, "development"),
    `source_${body.jobId}`,
    body.kind,
    body.idempotencyKey,
    body.subjectId,
    body.workspaceId ?? null,
    body.correlationId,
    envelopeDigestForTest(body),
    input.status,
    input.leaseExpiresAt,
    "2026-08-12T00:01:00.000Z",
    input.errorCode,
    now,
    now,
    now,
  );
}

test("outbox dispatch is leased, identifiers-only, and fenced on success", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    insertOutbox(sqlite);
    const { env, sends } = createEnv(d1);
    const result = await dispatchOutbox({DB:env.DB,APP_ENV:env.APP_ENV,ASYNC_RUNTIME_ENABLED:env.ASYNC_RUNTIME_ENABLED,
      JOB_SCHEMA_VERSION:env.JOB_SCHEMA_VERSION,DATA_RETENTION_CLEANUP_QUEUE:env.DATA_RETENTION_CLEANUP_QUEUE});
    assert.deepEqual(result, {
      claimed: 1,
      dispatched: 1,
      rejected: 0,
      retrying: 0,
    });
    assert.equal(sends.length, 1);
    assert.equal(sends[0]?.binding, "DATA_RETENTION_CLEANUP_QUEUE");
    assert.deepEqual(
      Object.keys(sends[0]?.body as Record<string, unknown>).sort(),
      [
        "correlationId",
        "enqueuedAt",
        "idempotencyKey",
        "jobId",
        "kind",
        "redriveVersion",
        "schemaVersion",
        "subjectId",
        "workspaceId",
      ].sort(),
    );
    assert.equal((sends[0]?.body as JobEnvelope).redriveVersion, 0);
    const row = sqlite.prepare(`
      SELECT status, lease_owner, dispatched_at
      FROM job_outbox
      WHERE id = 'outbox_probe'
    `).get() as {
      status: string;
      lease_owner: string | null;
      dispatched_at: string | null;
    };
    assert.equal(row.status, "dispatched");
    assert.equal(row.lease_owner, null);
    assert.ok(row.dispatched_at);
  } finally {
    sqlite.close();
  }
});

test("outbox dispatch publishes the latest audited redrive version", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    insertOutbox(sqlite, { id: "outbox_redrive_version" });
    sqlite.prepare(`
      INSERT INTO operational_job_redrive_events (id,source_job_id,version)
      VALUES ('redrive_outbox_version_1','outbox_redrive_version',1),
        ('redrive_outbox_version_2','outbox_redrive_version',2)
    `).run();
    const { env, sends } = createEnv(d1);

    assert.deepEqual(await dispatchOutbox(env), {
      claimed: 1,
      dispatched: 1,
      rejected: 0,
      retrying: 0,
    });
    assert.equal((sends[0]?.body as JobEnvelope).redriveVersion, 2);
  } finally {
    sqlite.close();
  }
});

test("subject-scoped outbox dispatch leaves neighboring work pending", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    insertOutbox(sqlite, {
      id: "outbox_neighbor",
      idempotencyKey: "outbox_idem_neighbor",
      subjectId: "subject_neighbor",
      correlationId: "outbox_corr_neighbor",
    });
    insertOutbox(sqlite, {
      id: "outbox_target",
      idempotencyKey: "outbox_idem_target",
      subjectId: "subject_target",
      correlationId: "outbox_corr_target",
    });
    const { env, sends } = createEnv(d1);
    assert.deepEqual(await dispatchOutbox(env, 1, "subject_target"), {
      claimed: 1,
      dispatched: 1,
      rejected: 0,
      retrying: 0,
    });
    assert.equal(sends.length, 1);
    assert.equal(
      (sends[0]?.body as { subjectId: string }).subjectId,
      "subject_target",
    );
    const states = sqlite.prepare(
      "SELECT subject_id AS subjectId,status FROM job_outbox ORDER BY subject_id",
    ).all();
    assert.equal((states[0] as { status: string }).status, "pending");
    assert.equal((states[1] as { status: string }).status, "dispatched");
    await assert.rejects(
      dispatchOutbox(env, 1, "invalid subject"),
      /Invalid outbox subject identifier/,
    );
  } finally {
    sqlite.close();
  }
});

test("outbox compatibility-blocks legacy job kinds without publishing", async () => {
  for (const legacyKind of LEGACY_JOB_KINDS) {
    const { sqlite, d1 } = createDatabase();
    try {
      insertOutbox(sqlite, {
        id: `outbox_legacy_${legacyKind.replaceAll(".", "_")}`,
        kind: legacyKind,
        idempotencyKey: `outbox_idem_${legacyKind.replaceAll(".", "_")}`,
      });
      const { env, sends } = createEnv(d1);
      assert.deepEqual(await dispatchOutbox(env), {
        claimed: 0,
        dispatched: 0,
        rejected: 0,
        retrying: 0,
      });
      assert.equal(sends.length, 0);
      assert.equal(
        (
          sqlite.prepare(`
            SELECT status FROM job_outbox WHERE job_type = ?
          `).get(legacyKind) as { status: string }
        ).status,
        "rejected",
      );
    } finally {
      sqlite.close();
    }
  }
});

test("malware scan dispatches through its attached fail-closed queue", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    insertOutbox(sqlite, {
      id: "outbox_malware_attached",
      queueBinding: "MALWARE_SCAN_QUEUE",
      kind: "malware.scan",
      idempotencyKey: "outbox_idem_malware_attached",
      workspaceId: "ws_test",
    });
    const { env, sends } = createEnv(d1);
    assert.deepEqual(await dispatchOutbox(env), {
      claimed: 1,
      dispatched: 1,
      rejected: 0,
      retrying: 0,
    });
    assert.equal(sends.length, 1);
    assert.equal(
      (
        sqlite.prepare(`
          SELECT status FROM job_outbox WHERE id = 'outbox_malware_attached'
        `).get() as { status: string }
      ).status,
      "dispatched",
    );
  } finally {
    sqlite.close();
  }
});

test("outbox cannot publish while runtime or schema is disabled", async () => {
  for (const options of [
    { asyncEnabled: "false" },
    { schemaVersion: "2" },
  ]) {
    const { sqlite, d1 } = createDatabase();
    try {
      insertOutbox(sqlite);
      const { env, sends } = createEnv(d1, options);
      assert.deepEqual(await dispatchOutbox(env), {
        claimed: 0,
        dispatched: 0,
        rejected: 0,
        retrying: 0,
      });
      assert.equal(d1.prepareCalls, 0);
      assert.equal(sends.length, 0);
      assert.equal(
        (
          sqlite.prepare(`
            SELECT status FROM job_outbox WHERE id = 'outbox_probe'
          `).get() as { status: string }
        ).status,
        "pending",
      );
    } finally {
      sqlite.close();
    }
  }
});

test("outbox rejects queue-kind mismatches and retries send failures", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    insertOutbox(sqlite, {
      id: "outbox_mismatch",
      kind: "document.export",
      idempotencyKey: "outbox_idem_mismatch",
    });
    const { env } = createEnv(d1);
    assert.deepEqual(await dispatchOutbox(env), {
      claimed: 1,
      dispatched: 0,
      rejected: 1,
      retrying: 0,
    });
    assert.equal(
      (
        sqlite.prepare(`
          SELECT status FROM job_outbox WHERE id = 'outbox_mismatch'
        `).get() as { status: string }
      ).status,
      "rejected",
    );

    insertOutbox(sqlite, {
      id: "outbox_retry",
      idempotencyKey: "outbox_idem_retry",
    });
    const failing = createEnv(d1, {
      failingQueueBindings: ["DATA_RETENTION_CLEANUP_QUEUE"],
    });
    assert.deepEqual(await dispatchOutbox(failing.env), {
      claimed: 1,
      dispatched: 0,
      rejected: 0,
      retrying: 1,
    });
    const retry = sqlite.prepare(`
      SELECT status, error_code, next_attempt_at
      FROM job_outbox
      WHERE id = 'outbox_retry'
    `).get() as {
      status: string;
      error_code: string;
      next_attempt_at: string | null;
    };
    assert.equal(retry.status, "retrying");
    assert.equal(retry.error_code, "JOB_OUTBOX_SEND_FAILED");
    assert.ok(retry.next_attempt_at);
  } finally {
    sqlite.close();
  }
});

test("outbox reclaims expired leases but leaves active dispatches alone", async () => {
  const { sqlite, d1 } = createDatabase();
  try {
    insertOutbox(sqlite, {
      id: "outbox_active",
      idempotencyKey: "outbox_idem_active",
      status: "dispatching",
      leaseOwner: "active-worker",
      leaseExpiresAt: "2999-01-01T00:00:00.000Z",
    });
    const { env, sends } = createEnv(d1);
    assert.deepEqual(await dispatchOutbox(env), {
      claimed: 0,
      dispatched: 0,
      rejected: 0,
      retrying: 0,
    });
    assert.equal(sends.length, 0);

    sqlite.prepare(`
      UPDATE job_outbox
      SET lease_expires_at = '2000-01-01T00:00:00.000Z'
      WHERE id = 'outbox_active'
    `).run();
    assert.deepEqual(await dispatchOutbox(env), {
      claimed: 1,
      dispatched: 1,
      rejected: 0,
      retrying: 0,
    });
    assert.equal(sends.length, 1);
  } finally {
    sqlite.close();
  }
});
