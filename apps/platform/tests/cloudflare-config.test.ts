import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  ATTACHED_PLATFORM_QUEUE_BINDINGS,
  PLATFORM_QUEUE_BINDINGS,
} from "../worker/platform-jobs";
import {
  normalizeSitesPrimaryBindings,
  type CloudflareBindingConfig,
} from "../build/cloudflare-binding-normalizer";

type NamedBinding = {
  binding: string;
  [key: string]: unknown;
};

type EnvironmentConfig = {
  name: string;
  workers_dev?: boolean;
  preview_urls?: boolean;
  routes?: unknown[];
  assets: NamedBinding;
  vars: Record<string, string>;
  d1_databases: NamedBinding[];
  r2_buckets: NamedBinding[];
  queues: {
    producers: Array<NamedBinding & { queue: string }>;
    consumers: Array<{
      queue: string;
      max_batch_size: number;
      max_retries: number;
      dead_letter_queue?: string;
    }>;
  };
  vectorize: NamedBinding[];
  analytics_engine_datasets: NamedBinding[];
  ai: NamedBinding;
  images: NamedBinding;
  observability?: unknown;
  triggers?: unknown;
};

type WranglerConfig = EnvironmentConfig & {
  compatibility_date: string;
  compatibility_flags: string[];
  env: Record<"staging" | "production", EnvironmentConfig>;
};

const source = JSON.parse(
  readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"),
) as WranglerConfig;

const environments = ["development", "staging", "production"] as const;
const productionMigrationPattern =
  "./drizzle/{0121_*,012[4-9]_*,013[0-9]_*,014[0-5]_*,014[7-9]_*,0146_lawyer_profile_services,0155_citation_evidence_receipts,0156_provider_usage_observation}.sql";

test("production migration discovery includes citation receipts without reviving retired corpus storage", () => {
  const pattern = source.env.production.d1_databases[0]?.migrations_pattern;
  assert.equal(typeof pattern, "string");
  const migrations = new Set(globSync(String(pattern), {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
  }).map(path => basename(path)));
  for (const name of [
    "0121_fix_ai_quality_hash_constraints.sql",
    "0146_lawyer_profile_services.sql",
    "0147_signed_share_verification_hardening.sql",
    "0155_citation_evidence_receipts.sql",
    "0156_provider_usage_observation.sql",
  ]) assert.ok(migrations.has(name), `Required production migration is hidden: ${name}`);
  for (const name of [
    "0146_versioned_legal_search_indexes.sql",
    "0150_retire_legacy_official_corpus_storage.sql",
    "0151_remove_legacy_official_corpus_schemas.sql",
  ]) assert.ok(!migrations.has(name), `Retired corpus migration is exposed: ${name}`);
  assert.ok([...migrations].every(name => !/^012[23]_/.test(name)),
    "Staging review evidence migrations must remain excluded");
});

test("local development has no retired staging corpus mode or binding", () => {
  const viteConfig = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const taskRunner = readFileSync(new URL("../scripts/platform-tasks.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(viteConfig, /JURO_STAGING_CORPUS_READS|LEGAL_CORPUS_READ_DB/u);
  assert.doesNotMatch(taskRunner, /dev-staging-corpus|JURO_STAGING_CORPUS_READS/u);
  assert.match(viteConfig, /remoteBindings: useRemoteBindings \? true : undefined/u);
});

const queueContract = [
  ["DOCUMENT_ANALYSIS_QUEUE", "document-analysis"],
  ["OCR_PROCESSING_QUEUE", "ocr-processing"],
  ["DOCUMENT_EXPORT_QUEUE", "document-export"],
  ["EMAIL_NOTIFICATIONS_QUEUE", "email-notifications"],
  ["LEGAL_SOURCES_SYNC_QUEUE", "legal-sources-sync"],
  ["DATA_RETENTION_CLEANUP_QUEUE", "data-retention-cleanup"],
  ["NOTIFICATIONS_QUEUE", "notifications"],
] as const;

// These bindings are deliberately metrics-only readers for DLQs that have a
// durable terminalizer. They are not job producer contracts.
const documentDlqMetricsContract = [
  ["DOCUMENT_ANALYSIS_DLQ", "document-analysis-dlq"],
  ["OCR_PROCESSING_DLQ", "ocr-processing-dlq"],
] as const;

const isolatedDlqMetricsContract = [
  ...documentDlqMetricsContract,
  ["DOCUMENT_EXPORT_DLQ", "document-export-dlq"],
  ["MALWARE_SCAN_DLQ", "malware-scan-dlq"],
] as const;

// This deliberately stays outside the platform job/outbox binding contract:
// it is a staging-only, content-free round-trip health probe.
const stagingQueueHealthProbeContract = [
  "STAGING_QUEUE_HEALTH_PROBE_QUEUE",
  "queue-health",
] as const;

// Production has its own content-free Queue round-trip. It is intentionally
// isolated from all user-work queues and from the staging probe.
const productionQueueHealthProbeContract = [
  "PRODUCTION_QUEUE_HEALTH_PROBE_QUEUE",
  "queue-health",
] as const;

const vectorContract = [
  ["LEX_UZ_INDEX", "lex-uz"],
  ["ADVICE_UZ_INDEX", "advice-uz"],
  ["INTERNAL_LEGAL_MATERIALS_INDEX", "internal-legal-materials"],
  ["USER_DOCUMENTS_INDEX", "user-documents"],
] as const;

function selectedEnvironment(
  environment: (typeof environments)[number],
): EnvironmentConfig {
  return environment === "development" ? source : source.env[environment];
}

function assertUnique(values: string[], label: string): void {
  assert.equal(
    new Set(values).size,
    values.length,
    `${label} contains duplicate values`,
  );
}

test("declares isolated Cloudflare environments with reviewed staging and production consumers and cron", () => {
  const resourceNames = new Map<string, Set<string>>();

  for (const environment of environments) {
    const config = selectedEnvironment(environment);
    assert.equal(config.name, environment === "production" ? "juro" : `juro-platform-${environment}`);
    assert.equal(config.vars.APP_ENV, environment);
    assert.equal(
      config.vars.ASYNC_RUNTIME_ENABLED,
      environment === "staging" || environment === "production" ? "true" : "false",
    );
    assert.equal(
      config.vars.CRON_ENABLED,
      environment === "staging" || environment === "production" ? "true" : "false",
    );
    assert.equal(
      config.vars.ACCOUNT_DELETION_PURGE_ENABLED,
      environment === "staging" || environment === "production" ? "true" : "false",
    );
    assert.equal(
      config.vars.STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED,
      environment === "staging"
        ? (config.vars.STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED === "true" ? "true" : "false")
        : environment === "production" ? "false" : undefined,
    );
    assert.equal(
      config.vars.STAGING_QUEUE_HEALTH_PROBE_ENABLED,
      environment === "staging" ? "true" : "false",
    );
    assert.equal(
      config.vars.PRODUCTION_QUEUE_HEALTH_PROBE_ENABLED,
      environment === "production" ? "true" : undefined,
    );
    assert.equal(
      config.vars.PRODUCTION_SYNTHETIC_PROBES_ENABLED,
      environment === "production" ? "true" : "false",
    );
    assert.equal(
      config.vars.MALWARE_SCANNER_PROBE_ENABLED,
        environment === "staging" || environment === "production" ? "false" : undefined,
    );
    assert.equal(
      config.vars.LEGAL_ADVICE_INGESTION_ENABLED,
      "false",
    );
    assert.equal(
      config.vars.LEGAL_LEX_INGESTION_ENABLED,
      "false",
    );
    assert.equal(
      config.vars.LEGAL_DIRECT_RETRIEVAL_ENABLED,
      "true",
    );
    for (const flag of [
      "LEGAL_CORPUS_ENABLED",
      "LEGAL_CORPUS_LIVE_LEXUZ_ENABLED",
      "LEGAL_CORPUS_AUTO_INGEST_ENABLED",
      "LEGAL_CORPUS_MULTILINGUAL_ENABLED",
      "LEGAL_CORPUS_HISTORICAL_ENABLED",
      "LEGAL_CORPUS_DENSE_ENABLED",
      "LEGAL_CORPUS_SHADOW_MODE",
    ]) {
      assert.equal(
        config.vars[flag],
        undefined,
        `${environment} must not configure retired ${flag}`,
      );
    }
    assert.equal(config.vars.LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST, "false");
    assert.equal(
      config.vars.LEGAL_LEX_RSS_DISCOVERY_ENABLED,
      "false",
    );
    assert.equal(
      config.vars.LEGAL_LEX_METADATA_MONITOR_ENABLED,
      "false",
    );
    assert.equal(
      config.vars.LEGAL_SOURCE_STAFF_API_ENABLED,
      "false",
    );
    assert.equal(
      config.vars.LAWYER_PROFILE_DIRECTORY_ENABLED,
      environment === "development" || environment === "staging" || environment === "production"
        ? "true"
        : "false",
    );
    assert.equal(
      config.vars.GUEST_AI_ENABLED,
      "true",
    );
    assert.equal(
      config.vars.IDENTITY_PROTECTION_MODE,
      environment === "staging" || environment === "production"
        ? "dual_write"
        : "legacy",
    );
    assert.equal(config.vars.JOB_SCHEMA_VERSION, "1");
    assert.deepEqual(
      config.triggers,
      environment === "staging" || environment === "production"
        ? { crons: ["*/5 * * * *", "0 19 * * *"] }
        : undefined,
    );
    assert.deepEqual(config.assets, { binding: "ASSETS" });
    assert.deepEqual(config.ai, { binding: "AI" });

    assert.deepEqual(
      config.d1_databases.map(({ binding }) => binding),
      ["DB"],
    );
    assert.equal(config.d1_databases[0]?.migrations_dir, "./drizzle");
    assert.equal(
      config.d1_databases[0]?.migrations_pattern,
      environment === "production"
        ? productionMigrationPattern
        : undefined,
    );
    assert.deepEqual(
      config.r2_buckets,
      [
        {
          binding: "BUCKET",
          bucket_name: environment === "production"
            ? "juro-private-documents"
            : `juro-${environment}-files`,
        },
        {
          binding: "BACKUP_BUCKET",
          bucket_name: `juro-${environment}-backups`,
        },
        {
          binding: "QUARANTINE_BUCKET",
          bucket_name: `juro-${environment}-quarantine`,
        },
      ],
    );
    const hasAsyncConsumers = environment === "staging" || environment === "production";
    const environmentQueueContract = hasAsyncConsumers
      ? [...queueContract, ["MALWARE_SCAN_QUEUE", "malware-scan"] as const]
      : queueContract;
    const environmentDlqMetricsContract = hasAsyncConsumers
      ? isolatedDlqMetricsContract
      : documentDlqMetricsContract;
    const environmentProducerContract = hasAsyncConsumers
      ? [
        environmentQueueContract[0]!,
        environmentDlqMetricsContract[0]!,
        environmentQueueContract[1]!,
        environmentDlqMetricsContract[1]!,
        environmentQueueContract[2]!,
        environmentDlqMetricsContract[2]!,
        ...environmentQueueContract.slice(3, -1),
        environmentQueueContract.at(-1)!,
        environmentDlqMetricsContract[3]!,
      ]
      : [
        environmentQueueContract[0]!,
        environmentDlqMetricsContract[0]!,
        environmentQueueContract[1]!,
        environmentDlqMetricsContract[1]!,
        ...environmentQueueContract.slice(2),
      ];
    const expectedProducerContract = environment === "staging"
      ? [...environmentProducerContract, stagingQueueHealthProbeContract]
      : environment === "production"
        ? [...environmentProducerContract, productionQueueHealthProbeContract]
        : environmentProducerContract;
    assert.deepEqual(
      config.queues.producers,
      expectedProducerContract.map(([binding, name]) => ({
        binding,
        queue: `${environment}-${name}`,
      })),
    );
    assert.deepEqual(
      config.queues.producers
        .map(({ binding }) => binding)
        .filter((binding) => !binding.endsWith("_DLQ")),
      environment === "staging" || environment === "production"
        ? [
          ...ATTACHED_PLATFORM_QUEUE_BINDINGS,
          ...(environment === "staging" ? [stagingQueueHealthProbeContract[0]] : []),
          ...(environment === "production" ? [productionQueueHealthProbeContract[0]] : []),
        ]
        : [...ATTACHED_PLATFORM_QUEUE_BINDINGS].filter((binding) =>
          binding !== "MALWARE_SCAN_QUEUE"
        ),
    );
    assert.deepEqual(
      config.queues.producers
        .map(({ binding }) => binding)
        .filter((binding) => binding.endsWith("_DLQ")),
      environmentDlqMetricsContract.map(([binding]) => binding),
    );
    assert.deepEqual(
      [...PLATFORM_QUEUE_BINDINGS].filter((binding) =>
        !ATTACHED_PLATFORM_QUEUE_BINDINGS.includes(
          binding as (typeof ATTACHED_PLATFORM_QUEUE_BINDINGS)[number],
        )
      ),
      [],
    );
    assert.deepEqual(
      config.queues.consumers,
      hasAsyncConsumers
        ? [
          {
            queue: `${environment}-document-analysis`,
            max_batch_size: 1,
            max_batch_timeout: 5,
            max_retries: 3,
            dead_letter_queue: `${environment}-document-analysis-dlq`,
            max_concurrency: 1,
            retry_delay: 30,
          },
          {
            // This second-level consumer has no further DLQ. It retries D1
            // terminalization separately, then acknowledges only a durable
            // terminal job ledger state.
            queue: `${environment}-document-analysis-dlq`,
            max_batch_size: 1,
            max_batch_timeout: 5,
            max_retries: 10,
            max_concurrency: 1,
            retry_delay: 60,
          },
          {
            queue: `${environment}-ocr-processing`,
            max_batch_size: 1,
            max_batch_timeout: 5,
            max_retries: 3,
            dead_letter_queue: `${environment}-ocr-processing-dlq`,
            max_concurrency: 1,
            retry_delay: 30,
          },
          {
            // OCR is a separate prerequisite path: its terminalizer must
            // remain available even while document-analysis capacity is busy.
            queue: `${environment}-ocr-processing-dlq`,
            max_batch_size: 1,
            max_batch_timeout: 5,
            max_retries: 10,
            max_concurrency: 1,
            retry_delay: 60,
          },
          {
            queue: `${environment}-document-export`,
            max_batch_size: 1,
            max_batch_timeout: 5,
            max_retries: 3,
            dead_letter_queue: `${environment}-document-export-dlq`,
            max_concurrency: 1,
            retry_delay: 30,
          },
          {
            // Exports have a durable source record, so a retry-exhausted
            // delivery is terminalized by the same audited DLQ contract.
            queue: `${environment}-document-export-dlq`,
            max_batch_size: 1,
            max_batch_timeout: 5,
            max_retries: 10,
            max_concurrency: 1,
            retry_delay: 60,
          },
          {
            queue: `${environment}-legal-sources-sync`,
            max_batch_size: 5,
            max_batch_timeout: 5,
            max_retries: 5,
            dead_letter_queue: `${environment}-legal-sources-sync-dlq`,
            max_concurrency: 1,
            retry_delay: 30,
          },
          {
            queue: `${environment}-email-notifications`,
            max_batch_size: 5,
            max_batch_timeout: 5,
            max_retries: 5,
            dead_letter_queue: `${environment}-email-notifications-dlq`,
            max_concurrency: 2,
            retry_delay: 30,
          },
          {
            queue: `${environment}-data-retention-cleanup`,
            max_batch_size: 5,
            max_batch_timeout: 5,
            max_retries: 5,
            dead_letter_queue: `${environment}-data-retention-cleanup-dlq`,
            max_concurrency: 1,
            retry_delay: 30,
          },
          {
            queue: `${environment}-notifications`,
            max_batch_size: 5,
            max_batch_timeout: 5,
            max_retries: 5,
            dead_letter_queue: `${environment}-notifications-dlq`,
            max_concurrency: 2,
            retry_delay: 30,
          },
          {
            queue: `${environment}-malware-scan`,
            max_batch_size: 1,
            max_batch_timeout: 5,
            max_retries: 3,
            dead_letter_queue: `${environment}-malware-scan-dlq`,
            max_concurrency: 1,
            retry_delay: 30,
          },
          {
            // The scanner DLQ only records retry exhaustion. It cannot mark a
            // quarantined file safe or enqueue extraction/analysis work.
            queue: `${environment}-malware-scan-dlq`,
            max_batch_size: 1,
            max_batch_timeout: 5,
            max_retries: 10,
            max_concurrency: 1,
            retry_delay: 60,
          },
          ...(environment === "staging"
            ? [{
              queue: "staging-queue-health",
              max_batch_size: 1,
              max_batch_timeout: 5,
              max_retries: 3,
              max_concurrency: 1,
              retry_delay: 30,
            }, {
              queue: "staging-legal-evaluation",
              max_batch_size: 1,
              max_batch_timeout: 1,
              max_retries: 0,
              max_concurrency: 4,
            }]
            : []),
          ...(environment === "production"
            ? [{
              // No DLQ is intentional: bounded delivery failures age the D1
              // claim into a visible degraded observation on the next cron.
              queue: "production-queue-health",
              max_batch_size: 1,
              max_batch_timeout: 5,
              max_retries: 3,
              max_concurrency: 1,
              retry_delay: 30,
            }]
            : []),
        ]
        : [],
    );

    assert.deepEqual(
      config.vectorize,
      vectorContract.map(([binding, name]) => ({
        binding,
        index_name: `${environment}-${name}`,
      })),
    );
    assert.deepEqual(
      config.analytics_engine_datasets.map(({ binding }) => binding),
      ["PLATFORM_ANALYTICS"],
    );
    assert.deepEqual(config.images, { binding: "IMAGES" });

    const allBindings = [
      ...config.d1_databases,
      ...config.r2_buckets,
      ...config.queues.producers,
      ...config.vectorize,
      ...config.analytics_engine_datasets,
      config.ai,
      config.images,
      config.assets,
    ].map(({ binding }) => binding);
    assertUnique(allBindings, `${environment} bindings`);

    resourceNames.set(environment, new Set([
      config.name,
      ...config.d1_databases.map((entry) => String(entry.database_name)),
      ...config.r2_buckets.map((entry) => String(entry.bucket_name)),
      ...config.queues.producers.map(({ queue }) => queue),
      ...config.queues.consumers.flatMap(({ dead_letter_queue }) =>
        dead_letter_queue ? [dead_letter_queue] : []
      ),
      ...config.vectorize.map((entry) => String(entry.index_name)),
      ...config.analytics_engine_datasets.map((entry) =>
        String(entry.dataset)
      ),
    ]));
  }

  for (let left = 0; left < environments.length; left += 1) {
    for (let right = left + 1; right < environments.length; right += 1) {
      const leftName = environments[left];
      const rightName = environments[right];
      const overlap = [...(resourceNames.get(leftName) ?? [])].filter((name) =>
        resourceNames.get(rightName)?.has(name)
      );
      assert.deepEqual(
        overlap,
        [],
        `${leftName} and ${rightName} share resources`,
      );
    }
  }

  assert.equal(source.env.staging.workers_dev, false);
  assert.equal(source.env.staging.preview_urls, false);
  assert.deepEqual(source.env.staging.routes, []);
  assert.deepEqual(source.env.production.routes, [
    { pattern: "app.juro.uz", zone_name: "juro.uz", custom_domain: true },
    { pattern: "lawyer.juro.uz", zone_name: "juro.uz", custom_domain: true },
    { pattern: "admin.juro.uz", zone_name: "juro.uz", custom_domain: true },
    { pattern: "status.juro.uz", zone_name: "juro.uz", custom_domain: true },
  ]);
  assert.equal(
    Object.hasOwn(source.env.staging.vars, "ALLOW_PLATFORM_AUTH_HEADERS"),
    false,
  );
  assert.equal(
    Object.hasOwn(source.env.staging.vars, "LOCAL_AUTH_BYPASS"),
    false,
  );
  assert.equal(
    Object.hasOwn(source.env.production.vars, "LOCAL_AUTH_BYPASS"),
    false,
  );
});

test("pins verified D1 identifiers for every isolated environment and excludes secrets", () => {
  const serialized = JSON.stringify(source);
  assert.equal(
    source.d1_databases[0]?.database_id,
    "d07670cf-f7bf-460c-a668-101671d4c330",
  );
  assert.equal(
    source.env.staging.d1_databases[0]?.database_id,
    "bb716a96-b2fb-4823-90d6-6c228fed181a",
  );
  assert.equal(
    source.env.production.d1_databases[0]?.database_id,
    "4cce509b-0e02-4ca9-a3ba-a5ce1327aeda",
  );
  assert.match(
    serialized,
    /4cce509b-0e02-4ca9-a3ba-a5ce1327aeda/i,
    "the verified production D1 identifier is pinned to prevent fallback to staging",
  );
  assert.doesNotMatch(serialized, /"account_id"\s*:/i);
  assert.doesNotMatch(serialized, /"(?:api_key|secret|token)"\s*:/i);
  for (const secretBinding of [
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "RESEND_API_KEY",
    "SESSION_SECRET",
    "ENCRYPTION_KEY",
    "OTP_HASH_SECRET",
    "CRON_SECRET",
    "TURNSTILE_SECRET_KEY",
    "TOTP_ENCRYPTION_KEY",
    "SIGNED_URL_SECRET",
    "IDENTITY_KEYRING",
    "AI_PROVIDER_API_KEY",
    "LEGISLATION_FEED_API_KEY",
    "QDRANT_API_KEY",
    "PAYMENT_API_KEY",
    "PAYMENT_WEBHOOK_SECRET",
  ]) {
    assert.equal(
      serialized.includes(`\"${secretBinding}\"`),
      false,
      `${secretBinding} must not be checked into Wrangler vars`,
    );
  }
});

test("does not attach legacy queue contracts and limits malware scanning to isolated async environments", () => {
  const serialized = JSON.stringify(source);
  for (const legacyBinding of [
    "AI_JOBS_QUEUE",
    "FILE_JOBS_QUEUE",
    "DOCUMENT_JOBS_QUEUE",
    "LEGAL_SYNC_QUEUE",
    "EMAIL_JOBS_QUEUE",
    "NOTIFICATION_JOBS_QUEUE",
    "CLEANUP_JOBS_QUEUE",
    "BACKUP_JOBS_QUEUE",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(`"${legacyBinding}"`));
  }
  assert.doesNotMatch(
    serialized,
    /juro-(?:ai|file|document|legal|email|notification|cleanup|backup)-jobs-/,
  );
  assert.match(serialized, /"MALWARE_SCAN_QUEUE"/);
  assert.match(serialized, /staging-malware-scan/);
  assert.deepEqual(source.queues.consumers, []);
  assert.equal(source.env.production.queues.consumers.length, 13);
  assert.equal(source.env.staging.queues.consumers.length, 14);
  assert.deepEqual(
    source.env.staging.queues.consumers.map(({ queue }) => queue),
    [
      "staging-document-analysis",
      "staging-document-analysis-dlq",
      "staging-ocr-processing",
      "staging-ocr-processing-dlq",
      "staging-document-export",
      "staging-document-export-dlq",
      "staging-legal-sources-sync",
      "staging-email-notifications",
      "staging-data-retention-cleanup",
      "staging-notifications",
      "staging-malware-scan",
      "staging-malware-scan-dlq",
      "staging-queue-health",
      "staging-legal-evaluation",
    ],
  );
  assert.deepEqual(
    source.env.production.queues.consumers.map(({ queue }) => queue),
    [
      "production-document-analysis",
      "production-document-analysis-dlq",
      "production-ocr-processing",
      "production-ocr-processing-dlq",
      "production-document-export",
      "production-document-export-dlq",
      "production-legal-sources-sync",
      "production-email-notifications",
      "production-data-retention-cleanup",
      "production-notifications",
      "production-malware-scan",
      "production-malware-scan-dlq",
      "production-queue-health",
    ],
  );
});

test("normalizes Sites primary bindings without losing add-ons", () => {
  const config: CloudflareBindingConfig = {
    d1_databases: [
      { binding: "DB", database_name: "selected-db" },
      { binding: "REPORTING_DB", database_name: "reporting-db" },
    ],
    r2_buckets: [
      { binding: "BUCKET", bucket_name: "selected-bucket" },
      { binding: "BACKUP_BUCKET", bucket_name: "backup-bucket" },
    ],
    vars: {
      APP_ENV: "staging",
      LOCAL_OVERRIDE: "source",
    },
  };

  normalizeSitesPrimaryBindings(
    config,
    {
      d1Binding: "DB",
      r2Binding: "BUCKET",
      databaseId: "00000000-0000-4000-8000-000000000000",
      databaseName: "site-creator-d1",
      bucketName: "site-creator-r2",
    },
    {
      LOCAL_OVERRIDE: "local",
    },
  );

  assert.deepEqual(config.d1_databases, [
    {
      binding: "DB",
      database_name: "site-creator-d1",
      database_id: "00000000-0000-4000-8000-000000000000",
      migrations_dir: "./drizzle",
    },
    { binding: "REPORTING_DB", database_name: "reporting-db" },
  ]);
  assert.deepEqual(config.r2_buckets, [
    { binding: "BUCKET", bucket_name: "site-creator-r2" },
    { binding: "BACKUP_BUCKET", bucket_name: "backup-bucket" },
  ]);
  assert.deepEqual(config.vars, {
    APP_ENV: "staging",
    LOCAL_OVERRIDE: "local",
  });

  const once = structuredClone(config);
  normalizeSitesPrimaryBindings(
    config,
    {
      d1Binding: "DB",
      r2Binding: "BUCKET",
      databaseId: "00000000-0000-4000-8000-000000000000",
      databaseName: "site-creator-d1",
      bucketName: "site-creator-r2",
    },
    {
      LOCAL_OVERRIDE: "local",
    },
  );
  assert.deepEqual(config, once);
});

test("rejects duplicate primary binding declarations", () => {
  assert.throws(
    () =>
      normalizeSitesPrimaryBindings(
        {
          d1_databases: [
            { binding: "DB" },
            { binding: "DB" },
          ],
        },
        {
          d1Binding: "DB",
          databaseId: "placeholder",
          databaseName: "placeholder",
          bucketName: "placeholder",
        },
        {},
      ),
    /Duplicate Cloudflare binding "DB"/,
  );

  assert.throws(
    () =>
      normalizeSitesPrimaryBindings(
        {
          r2_buckets: [
            { binding: "BUCKET" },
            { binding: "BUCKET" },
          ],
        },
        {
          r2Binding: "BUCKET",
          databaseId: "placeholder",
          databaseName: "placeholder",
          bucketName: "placeholder",
        },
        {},
      ),
    /Duplicate Cloudflare binding "BUCKET"/,
  );
});

test("preserves resolved bindings when Sites does not explicitly override them", () => {
  const config: CloudflareBindingConfig = {
    d1_databases: [{ binding: "DB", database_name: "juro-production" }],
    r2_buckets: [{ binding: "BUCKET", bucket_name: "juro-private-documents" }],
  };

  normalizeSitesPrimaryBindings(config, {}, {});

  assert.deepEqual(config.d1_databases, [
    { binding: "DB", database_name: "juro-production" },
  ]);
  assert.deepEqual(config.r2_buckets, [
    { binding: "BUCKET", bucket_name: "juro-private-documents" }]);
});

test("rejects incomplete Sites binding metadata", () => {
  assert.throws(
    () => normalizeSitesPrimaryBindings({}, { d1Binding: "DB" }, {}),
    /requires both databaseId and databaseName/,
  );
  assert.throws(
    () => normalizeSitesPrimaryBindings({}, { r2Binding: "BUCKET" }, {}),
    /requires bucketName/,
  );
});

test("production deployment cannot activate a development-bound container follow-up", () => {
  const deployment = readFileSync(
    new URL("../scripts/deploy-production.mjs", import.meta.url),
    "utf8",
  );
  const router = JSON.parse(
    readFileSync(
      new URL("../wrangler.app-production-router.jsonc", import.meta.url),
      "utf8",
    ).replace(/^\s*\/\/.*$/gm, ""),
  ) as {
    routes: unknown[];
    services: Array<{ binding: string; service: string; environment: string }>;
  };

  assert.match(
    deployment,
    /"deploy",\s*"--config",\s*configPath,\s*"--containers-rollout",\s*"none"/s,
  );
  assert.deepEqual(router.routes, []);
  assert.deepEqual(router.services, [
    { binding: "PLATFORM", service: "juro", environment: "production" },
  ]);
});

test("ignores every supported local secret-file convention", () => {
  const candidates = [
    ".env",
    ".env.local",
    ".dev.vars",
    ".dev.vars.staging",
  ];
  const ignored = execFileSync(
    "git",
    ["check-ignore", "--stdin", "--no-index"],
    {
      cwd: new URL("..", import.meta.url),
      input: `${candidates.join("\n")}\n`,
      encoding: "utf8",
    },
  ).trim().split("\n");
  assert.deepEqual(ignored, candidates);

  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
  }).split("\0").filter(Boolean);
  assert.deepEqual(
    tracked.filter((path) =>
      /(^|\/)(?:\.env(?:\.|$)|\.dev\.vars(?:\.|$))/.test(path)
    ),
    [],
  );
});
