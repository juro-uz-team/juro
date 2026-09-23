import { setTimeout as wait } from "node:timers/promises";
import { dispatchOutbox } from "./platform-outbox";
import {
  LEX_METADATA_DISCOVERY_CRON,
  lexMetadataRetryDue,
  reconcileStaleLexMetadataMonitorRuns,
  runLexMetadataMonitor,
} from "../lib/legal/metadata-monitor";
import { runDirectLegalSourceHealthCheck } from "../lib/legal/direct-source-health";
import { purgeDueDeletedUserMemories } from "../lib/ai/user-memory";
import { purgeExpiredGuestAiSessions } from "../lib/ai/guest-session";
import { purgeExpiredVoiceRecordings } from "../lib/ai/voice-recording";
import { purgeExpiredQuestionIntakes } from "../lib/ai/question-intake";
import {
  purgeExpiredPendingRegistrations,
} from "../lib/auth/registration-retention";
import { purgeExpiredDocumentAnalysisUploads } from "../lib/document-analysis/resource-retention";
import { reconcileAnalysisVersionObjectWrites } from "../lib/document-analysis/version-object-write";
import { reconcileBuilderVersionObjectWrites } from "../lib/document-builder/document-version-object-write";
import { taskReminderSubjectId } from "../lib/notifications/task-reminder-dispatch";
import { taskReminderEmailJobId } from "../lib/notifications/task-reminder-email";
import {
  expectedQueueName,
  type PlatformJobEnv,
} from "./platform-jobs";
import {
  recordDependencyHealthEvidence,
  recordScheduledD1HealthEvidence,
} from "./dependency-health-evidence";
import { reconcileQueueDlqHealth } from "./queue-dlq-health-reconciliation";

const OUTBOX_CRON = "*/5 * * * *";
const LOCK_NAME = "outbox-dispatch";
const LOCK_MS = 4 * 60 * 1_000;
const TASK_REMINDER_BATCH_SIZE = 100;
const QUEUE_DLQ_RECONCILIATION_BATCH_SIZE = 20;
// Source consumers retry at most three times with short bounded delays. The
// larger grace window prevents Cron from racing a delayed source delivery or a
// five-minute execution lease, but still makes a dropped/busy DLQ observable
// within one operational interval.
export const QUEUE_DLQ_RECONCILIATION_GRACE_MS = 15 * 60 * 1_000;

type DueTaskReminder = {
  reminderId: string;
  workspaceId: string;
  userId: string;
  channel: "in_app" | "email";
  updatedAt: string;
};

function isoAfter(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function scheduledFor(controller: ScheduledController): string {
  return new Date(controller.scheduledTime).toISOString();
}

async function maybeRunStagingProviderProbes(env: PlatformJobEnv) {
  if (
    env.APP_ENV !== "staging"
    || (env as Record<string, unknown>).STAGING_SYNTHETIC_PROBES_ENABLED !== "true"
  ) return null;
  const { runStagingProviderProbes } = await import("./staging-provider-probe");
  return runStagingProviderProbes(env);
}

async function maybeRunStagingEmailDeliveryProbe(env: PlatformJobEnv) {
  if (
    env.APP_ENV !== "staging"
    || (env as Record<string, unknown>).STAGING_SYNTHETIC_PROBES_ENABLED !== "true"
  ) return null;
  const { runStagingEmailDeliveryProbe } = await import("./staging-email-delivery-probe");
  return runStagingEmailDeliveryProbe(env);
}

async function maybeRunStagingMalwareScannerProbe(env: PlatformJobEnv) {
  if (
    env.APP_ENV !== "staging"
    || (env as Record<string, unknown>).MALWARE_SCANNER_PROBE_ENABLED !== "true"
  ) return null;
  const { runStagingMalwareScannerProbe } = await import("./staging-malware-scanner-probe");
  const summary = await runStagingMalwareScannerProbe(env);
  if (summary.failed > 0) throw new Error("STAGING_MALWARE_SCANNER_PROBE_FAILED");
  return summary;
}

async function maybeRunStagingDocumentAnalysisProbe(env: PlatformJobEnv) {
  if (
    env.APP_ENV !== "staging"
    || (env as Record<string, unknown>).STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED !== "true"
  ) return null;
  const { runStagingDocumentAnalysisProbe } = await import("./staging-document-analysis-probe");
  return runStagingDocumentAnalysisProbe(env);
}

async function maybeEnqueueStagingQueueHealthProbe(env: PlatformJobEnv) {
  if (
    env.APP_ENV !== "staging"
    || (env as Record<string, unknown>).STAGING_QUEUE_HEALTH_PROBE_ENABLED !== "true"
  ) return null;
  const { enqueueStagingQueueHealthProbe } = await import("./staging-queue-health-probe");
  return enqueueStagingQueueHealthProbe(env);
}

async function maybeEnqueueProductionQueueHealthProbe(env: PlatformJobEnv) {
  if (
    env.APP_ENV !== "production"
    || (env as Record<string, unknown>).PRODUCTION_QUEUE_HEALTH_PROBE_ENABLED !== "true"
  ) return null;
  const { enqueueProductionQueueHealthProbe } = await import("./production-queue-health-probe");
  return enqueueProductionQueueHealthProbe(env);
}

async function maybeRunProductionDependencyProbes(env: PlatformJobEnv) {
  if (
    env.APP_ENV !== "production"
    || (env as Record<string, unknown>).PRODUCTION_SYNTHETIC_PROBES_ENABLED !== "true"
  ) return null;
  const { runProductionDependencyProbes } = await import("./production-dependency-probes");
  return runProductionDependencyProbes(env);
}
function logScheduled(
  level: "info" | "error",
  fields: Record<string, string | number | boolean | null>,
): void {
  const entry = JSON.stringify(fields);
  if (level === "error") console.error(entry);
  else console.log(entry);
}

type RetryExhaustedQueueJob = {
  jobId: string;
  idempotencyKey: string;
  queueName: string;
  jobType:
    | "document.analyze"
    | "document.index"
    | "ocr.process"
    | "document.export"
    | "malware.scan";
  subjectId: string;
  workspaceId: string;
  correlationId: string;
  envelopeHash: string;
  attempt: number;
};

export type QueueDlqReconciliationSummary = {
  eligible: number;
  terminalized: number;
};

/**
 * Recovers the small failure window in which an implemented document-related
 * DLQ cannot terminalize its own ledger entry before that DLQ consumer
 * exhausts retries.
 *
 * This is deliberately a terminalization-only pass: it does not resubmit a
 * provider call, mutate analysis/OCR/index/export state, promote a quarantined
 * file, or mark user work as successful. The existing append-only
 * operational-redrive flow remains the only way to republish the original
 * identifiers after review. Every UPDATE is fenced by the source queue,
 * immutable envelope hash, attempt count, expired lease, and a
 * dispatched/retrying outbox record.
 */
export async function reconcileRetryExhaustedQueueJobs(
  env: Pick<PlatformJobEnv, "APP_ENV" | "DB">,
  input: {
    now?: Date;
    limit?: number;
  } = {},
): Promise<QueueDlqReconciliationSummary> {
  const now = input.now ?? new Date();
  const nowIso = now.toISOString();
  const cutoffIso = new Date(
    now.getTime() - QUEUE_DLQ_RECONCILIATION_GRACE_MS,
  ).toISOString();
  const limit = Math.max(
    1,
    Math.min(
      QUEUE_DLQ_RECONCILIATION_BATCH_SIZE,
      Math.trunc(input.limit ?? QUEUE_DLQ_RECONCILIATION_BATCH_SIZE),
    ),
  );
  const documentAnalysisQueue = expectedQueueName(
    "document.analyze",
    env.APP_ENV,
  );
  const ocrQueue = expectedQueueName("ocr.process", env.APP_ENV);
  const documentExportQueue = expectedQueueName("document.export", env.APP_ENV);
  const malwareScanQueue = expectedQueueName("malware.scan", env.APP_ENV);

  const candidates = await env.DB.prepare(`
    SELECT
      j.id AS jobId,
      j.idempotency_key AS idempotencyKey,
      j.queue_name AS queueName,
      j.job_type AS jobType,
      j.subject_id AS subjectId,
      j.workspace_id AS workspaceId,
      j.correlation_id AS correlationId,
      j.envelope_hash AS envelopeHash,
      j.attempt AS attempt
    FROM job_runs j
    JOIN job_outbox o
      ON o.idempotency_key=j.idempotency_key
     AND o.job_type=j.job_type
     AND o.subject_id=j.subject_id
     AND COALESCE(o.workspace_id,'')=COALESCE(j.workspace_id,'')
     AND o.correlation_id=j.correlation_id
    WHERE (
        (j.queue_name=? AND j.job_type IN ('document.analyze','document.index'))
        OR (j.queue_name=? AND j.job_type='ocr.process')
        OR (j.queue_name=? AND j.job_type='document.export')
        OR (j.queue_name=? AND j.job_type='malware.scan')
      )
      AND j.status IN ('running','retrying')
      AND j.attempt>=3
      AND j.updated_at<=?
      AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=?)
      AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=?)
      AND o.status IN ('dispatched','retrying')
      AND (o.lease_expires_at IS NULL OR o.lease_expires_at<=?)
    ORDER BY j.updated_at ASC,j.id ASC
    LIMIT ?
  `).bind(
    documentAnalysisQueue,
    ocrQueue,
    documentExportQueue,
    malwareScanQueue,
    cutoffIso,
    cutoffIso,
    nowIso,
    nowIso,
    limit,
  ).all<RetryExhaustedQueueJob>();

  let terminalized = 0;
  for (const candidate of candidates.results) {
    const updated = await env.DB.prepare(`
      UPDATE job_runs
      SET status='dead_lettered',
          lease_owner=NULL,
          lease_expires_at=NULL,
          next_attempt_at=NULL,
          error_code=COALESCE(error_code,'JOB_TRANSIENT_FAILURE'),
          finished_at=?,
          updated_at=?
      WHERE id=?
        AND idempotency_key=?
        AND queue_name=?
        AND job_type=?
        AND subject_id=?
        AND workspace_id=?
        AND correlation_id=?
        AND envelope_hash=?
        AND attempt=?
        AND status IN ('running','retrying')
        AND updated_at<=?
        AND (next_attempt_at IS NULL OR next_attempt_at<=?)
        AND (lease_expires_at IS NULL OR lease_expires_at<=?)
        AND EXISTS (
          SELECT 1
          FROM job_outbox o
          WHERE o.idempotency_key=job_runs.idempotency_key
            AND o.job_type=job_runs.job_type
            AND o.subject_id=job_runs.subject_id
            AND COALESCE(o.workspace_id,'')=COALESCE(job_runs.workspace_id,'')
            AND o.correlation_id=job_runs.correlation_id
            AND o.status IN ('dispatched','retrying')
            AND (o.lease_expires_at IS NULL OR o.lease_expires_at<=?)
        )
    `).bind(
      nowIso,
      nowIso,
      candidate.jobId,
      candidate.idempotencyKey,
      candidate.queueName,
      candidate.jobType,
      candidate.subjectId,
      candidate.workspaceId,
      candidate.correlationId,
      candidate.envelopeHash,
      candidate.attempt,
      cutoffIso,
      cutoffIso,
      nowIso,
      nowIso,
    ).run();
    terminalized += Number(updated.meta.changes ?? 0);
  }

  if (terminalized > 0) {
    await recordDependencyHealthEvidence(env, {
      key: "queue_dlq",
      state: "degraded",
      safeErrorCode: "DLQ_BACKLOG",
      evidenceKind: "scheduled_job",
      startedAt: now.getTime(),
    }, now);
  }

  return { eligible: candidates.results.length, terminalized };
}

/**
 * Backward-compatible name retained for callers that only knew the original
 * document/OCR recovery scope. It now reconciles the full set of durable
 * document-related DLQ jobs, including export and malware scan.
 */
export const reconcileRetryExhaustedDocumentJobs = reconcileRetryExhaustedQueueJobs;

/**
 * Enqueues opaque reminder identifiers through the durable outbox. The queue
 * consumer reloads and authorizes all tenant state before delivery.
 */
export async function enqueueDueTaskReminders(
  env: PlatformJobEnv,
  now: string,
): Promise<{ due: number; enqueued: number }> {
  const due = await env.DB.prepare(
    `SELECT
       tr.id AS reminderId,
       t.workspace_id AS workspaceId,
       t.owner_user_id AS userId,
       tr.channel,
       tr.updated_at AS updatedAt
     FROM task_reminders tr
     JOIN tasks t ON t.id=tr.task_id
     JOIN cases c ON c.id=t.case_id AND c.workspace_id=t.workspace_id
     JOIN workspace_members wm
       ON wm.workspace_id=t.workspace_id
      AND wm.user_id=t.owner_user_id
      AND wm.status='active'
     WHERE tr.channel IN ('in_app','email')
       AND tr.status='pending'
       AND tr.reminder_at<=?
       AND t.status NOT IN ('completed','cancelled')
       AND c.archived_at IS NULL
     ORDER BY tr.reminder_at ASC, tr.id ASC
     LIMIT ?`,
  ).bind(now, TASK_REMINDER_BATCH_SIZE).all<DueTaskReminder>();

  let enqueued = 0;
  for (const reminder of due.results) {
    if (reminder.channel === "email") {
      const jobId = taskReminderEmailJobId(reminder.reminderId, reminder.updatedAt);
      const results = await env.DB.batch([
        env.DB.prepare(
          `INSERT OR IGNORE INTO task_reminder_email_jobs (
             id,reminder_id,workspace_id,user_id,reminder_updated_at,status,
             attempt_count,provider_message_id,error_code,sent_at,created_at,updated_at
           ) VALUES (?,?,?,?,?,'pending',0,NULL,NULL,NULL,?,?)`,
        ).bind(
          jobId,
          reminder.reminderId,
          reminder.workspaceId,
          reminder.userId,
          reminder.updatedAt,
          now,
          now,
        ),
        env.DB.prepare(
          `INSERT OR IGNORE INTO job_outbox (
             id,queue_binding,job_type,schema_version,idempotency_key,subject_id,
             workspace_id,correlation_id,enqueued_at,available_at,status,
             dispatch_attempts,created_at,updated_at
           ) SELECT ?,'EMAIL_NOTIFICATIONS_QUEUE','email.send',1,?,?,workspace_id,
             ?,?,?,'pending',0,?,?
           FROM task_reminder_email_jobs WHERE id=? AND status='pending'`,
        ).bind(jobId, jobId, jobId, jobId, now, now, now, now, jobId),
      ]);
      enqueued += Number(results[1]?.meta?.changes ?? 0);
      continue;
    }
    const subjectId = taskReminderSubjectId(
      reminder.reminderId,
      reminder.updatedAt,
    );
    const result = await env.DB.prepare(
      `INSERT OR IGNORE INTO job_outbox (
         id,queue_binding,job_type,schema_version,idempotency_key,subject_id,
         workspace_id,correlation_id,enqueued_at,available_at,status,
         dispatch_attempts,created_at,updated_at
       ) VALUES (
         ?,'NOTIFICATIONS_QUEUE','notification.dispatch',1,?,?,?, ?,?,?,
         'pending',0,?,?
       )`,
    ).bind(
      subjectId,
      subjectId,
      subjectId,
      reminder.workspaceId,
      subjectId,
      now,
      now,
      now,
      now,
    ).run();
    enqueued += Number(result.meta?.changes ?? 0);
  }
  return { due: due.results.length, enqueued };
}

async function claimSchedule(
  env: PlatformJobEnv,
  controller: ScheduledController,
): Promise<{ runId: string; holderId: string } | null> {
  const now = new Date().toISOString();
  const holderId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const dueAt = scheduledFor(controller);
  const idempotencyKey = `${LOCK_NAME}:${dueAt}`;
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO scheduled_locks (name,holder_id,acquired_at,expires_at,updated_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(name) DO UPDATE SET
         holder_id=excluded.holder_id,
         acquired_at=excluded.acquired_at,
         expires_at=excluded.expires_at,
         updated_at=excluded.updated_at
       WHERE scheduled_locks.expires_at<=excluded.acquired_at`,
    ).bind(LOCK_NAME, holderId, now, isoAfter(now, LOCK_MS), now),
    env.DB.prepare(
      `INSERT INTO scheduled_runs (
         id,schedule_name,cron,scheduled_for,idempotency_key,holder_id,
         status,error_code,started_at,finished_at,created_at,updated_at
       )
       SELECT ?,?,?,?,?,?,'running',NULL,?,NULL,?,?
       WHERE EXISTS (
         SELECT 1 FROM scheduled_locks
         WHERE name=? AND holder_id=? AND expires_at>?
       )
       ON CONFLICT(idempotency_key) DO NOTHING`,
    ).bind(
      runId,
      LOCK_NAME,
      controller.cron,
      dueAt,
      idempotencyKey,
      holderId,
      now,
      now,
      now,
      LOCK_NAME,
      holderId,
      now,
    ),
  ]);
  if (Number(results[1]?.meta?.changes ?? 0) === 1) {
    return { runId, holderId };
  }
  await env.DB.prepare(
    `DELETE FROM scheduled_locks WHERE name=? AND holder_id=?`,
  ).bind(LOCK_NAME, holderId).run();
  return null;
}

async function finishSchedule(
  env: PlatformJobEnv,
  run: { runId: string; holderId: string },
  status: "completed" | "failed",
  errorCode: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE scheduled_runs
       SET status=?,error_code=?,finished_at=?,updated_at=?
       WHERE id=? AND holder_id=? AND status='running'`,
    ).bind(status, errorCode, now, now, run.runId, run.holderId),
    env.DB.prepare(
      `DELETE FROM scheduled_locks
       WHERE name=? AND holder_id=?`,
    ).bind(LOCK_NAME, run.holderId),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) {
    throw new Error("SCHEDULE_LEASE_LOST");
  }
}

export async function handleScheduled(
  controller: ScheduledController,
  env: PlatformJobEnv,
): Promise<void> {
  if (
    String(env.ASYNC_RUNTIME_ENABLED) !== "true"
    || String(env.CRON_ENABLED) !== "true"
  ) {
    logScheduled("info", {
      event: "scheduled.runtime_disabled",
      environment: env.APP_ENV,
      cron: controller.cron,
    });
    controller.noRetry();
    return;
  }
  if (controller.cron !== OUTBOX_CRON && controller.cron !== LEX_METADATA_DISCOVERY_CRON) {
    logScheduled("error", {
      event: "scheduled.unknown_cron",
      environment: env.APP_ENV,
      cron: controller.cron,
    });
    controller.noRetry();
    return;
  }

  if (controller.cron === LEX_METADATA_DISCOVERY_CRON) {
    const metadataEnabled = (env as Record<string, unknown>).LEGAL_LEX_METADATA_MONITOR_ENABLED === "true";
    if (!metadataEnabled) {
      logScheduled("info", {
        event: "scheduled.lex_metadata_monitor_disabled",
        environment: env.APP_ENV,
        cron: controller.cron,
      });
      // Keep the whole daily legal-source path inert when its existing
      // monitor gate is disabled. This avoids a corpus job whose consumer
      // would be fail-closed and preserves the established scheduler contract.
      controller.noRetry();
      return;
    }
    const summary = await runLexMetadataMonitor(env, {
      wait: (delayMs) => wait(delayMs),
    });
    logScheduled("info", {
      event: "scheduled.lex_metadata_monitor_finished",
      environment: env.APP_ENV,
      cron: controller.cron,
      status: summary.status,
      discovered: summary.discovered,
      processed: summary.processed,
      changed: summary.changed,
      errors: summary.errors,
    });
    return;
  }

  const run = await claimSchedule(env, controller);
  if (!run) {
    logScheduled("info", {
      event: "scheduled.duplicate_or_busy",
      environment: env.APP_ENV,
      cron: controller.cron,
    });
    controller.noRetry();
    return;
  }
  let failureCode = "OUTBOX_DISPATCH_FAILED";
  try {
    failureCode = "TASK_REMINDER_ENQUEUE_FAILED";
    const now = new Date().toISOString();
    const taskReminders = await enqueueDueTaskReminders(env, now);
    const lexMetadataMonitorEnabled = (env as Record<string, unknown>).LEGAL_LEX_METADATA_MONITOR_ENABLED === "true";
    let lexMetadataStaleRuns = 0;
    let lexMetadataRetry: Awaited<ReturnType<typeof runLexMetadataMonitor>> | null = null;
    if (lexMetadataMonitorEnabled) {
      failureCode = "LEX_METADATA_MONITOR_RECONCILE_FAILED";
      lexMetadataStaleRuns = await reconcileStaleLexMetadataMonitorRuns(env, { now: new Date(now) });
    }
    const directLexRetrievalEnabled = (env as Record<string, unknown>).LEGAL_DIRECT_RETRIEVAL_ENABLED === "true";
    const lexSourceStartedAt = Date.now();
    failureCode = "LEX_SOURCE_HEALTH_CHECK_FAILED";
    const lexSourceHealth = directLexRetrievalEnabled
      ? await runDirectLegalSourceHealthCheck({
        db: env.DB,
        environment: env.APP_ENV,
      })
      : {
        state: "unknown" as const,
        alertCode: "DIRECT_SOURCE_HEALTH_UNKNOWN" as const,
        checkedAt: null,
        ageMinutes: null,
        sources: [],
      };
    if (directLexRetrievalEnabled) {
      await recordDependencyHealthEvidence(env, lexSourceHealth.state === "fresh"
        ? {
          key: "legal_source_sync",
          state: "operational",
          evidenceKind: "synthetic_probe",
          startedAt: lexSourceStartedAt,
          minimumOperationalIntervalMs: 20 * 60 * 60_000,
        }
        : {
          key: "legal_source_sync",
          state: "degraded",
          safeErrorCode: lexSourceHealth.state === "stale" ? "LEGAL_SYNC_STALE" : "LEGAL_SYNC_FAILED",
          evidenceKind: "synthetic_probe",
          startedAt: lexSourceStartedAt,
        });
    }
    if (lexMetadataMonitorEnabled) {
      failureCode = "LEX_METADATA_MONITOR_RETRY_FAILED";
      lexMetadataRetry = await lexMetadataRetryDue(env, new Date(now))
        ? await runLexMetadataMonitor(env, {
          now: new Date(now),
          runType: "metadata_retry",
          wait: (delayMs) => wait(delayMs),
        })
        : null;
    }
    failureCode = "OUTBOX_DISPATCH_FAILED";
    const summary = await dispatchOutbox(env, 100);
    failureCode = "QUEUE_HEALTH_PROBE_ENQUEUE_FAILED";
    const queueHealthProbe = await maybeEnqueueStagingQueueHealthProbe(env);
    failureCode = "PRODUCTION_QUEUE_HEALTH_PROBE_ENQUEUE_FAILED";
    const productionQueueHealthProbe = await maybeEnqueueProductionQueueHealthProbe(env);
    failureCode = "QUEUE_DLQ_RECONCILIATION_FAILED";
    const documentDlqReconciliation = await reconcileRetryExhaustedQueueJobs(
      env,
      { now: new Date(now) },
    );
    failureCode = "QUEUE_DLQ_HEALTH_RECONCILIATION_FAILED";
    const queueDlqHealth = await reconcileQueueDlqHealth(env, {
      now: new Date(now),
    });
    failureCode = "PENDING_REGISTRATION_RETENTION_CLEANUP_FAILED";
    const pendingRegistrationRetention = await purgeExpiredPendingRegistrations({
      db: env.DB,
      now,
    });
    failureCode = "MEMORY_RETENTION_CLEANUP_FAILED";
    const memoryRetention = await purgeDueDeletedUserMemories({
      db: env.DB,
      now,
    });
    failureCode = "GUEST_AI_RETENTION_CLEANUP_FAILED";
    const guestAiRetention = await purgeExpiredGuestAiSessions({
      db: env.DB,
      now,
    });
    failureCode = "AI_QUESTION_INTAKE_RETENTION_CLEANUP_FAILED";
    const questionIntakeRetention = await purgeExpiredQuestionIntakes({
      db: env.DB,
      now,
    });
    failureCode = "VOICE_RETENTION_CLEANUP_FAILED";
    const voiceRetention = await purgeExpiredVoiceRecordings({
      db: env.DB,
      bucket: env.BUCKET,
      quarantineBucket: env.QUARANTINE_BUCKET,
      now,
    });
    failureCode = "DOCUMENT_ANALYSIS_RETENTION_CLEANUP_FAILED";
    const documentAnalysisRetention = await purgeExpiredDocumentAnalysisUploads({
      env: {
        DB: env.DB,
        BUCKET: env.BUCKET,
        QUARANTINE_BUCKET: env.QUARANTINE_BUCKET,
        USER_DOCUMENTS_INDEX: env.USER_DOCUMENTS_INDEX,
      },
      now,
    });
    failureCode = "ANALYSIS_VERSION_OBJECT_RECONCILIATION_FAILED";
    const analysisVersionObjects = await reconcileAnalysisVersionObjectWrites({
      db: env.DB,
      bucket: env.BUCKET,
      now,
    });
    failureCode = "BUILDER_VERSION_OBJECT_RECONCILIATION_FAILED";
    const builderVersionObjects = await reconcileBuilderVersionObjectWrites({
      db: env.DB,
      bucket: env.BUCKET,
      now,
    });
    failureCode = "PROVIDER_PROBE_FAILED";
    const providerProbe = await maybeRunStagingProviderProbes(env);
    failureCode = "EMAIL_DELIVERY_PROBE_FAILED";
    const emailDeliveryProbe = await maybeRunStagingEmailDeliveryProbe(env);
    failureCode = "MALWARE_SCANNER_PROBE_FAILED";
    const malwareScannerProbe = await maybeRunStagingMalwareScannerProbe(env);
    failureCode = "DOCUMENT_ANALYSIS_PROBE_FAILED";
    const documentAnalysisProbe = await maybeRunStagingDocumentAnalysisProbe(env);
    if (documentAnalysisProbe?.failed) {
      failureCode = documentAnalysisProbe.errorCode ?? failureCode;
      throw new Error(failureCode);
    }
    failureCode = "PRODUCTION_DEPENDENCY_PROBES_FAILED";
    const productionDependencyProbes = await maybeRunProductionDependencyProbes(env);
    // Measure D1 directly. The surrounding cron can include R2, queues,
    // provider calls and retention work, so its total duration is not D1
    // latency and must never be published as such.
    await recordScheduledD1HealthEvidence(env);
    failureCode = "SCHEDULE_COMPLETION_FAILED";
    await finishSchedule(env, run, "completed", null);
    logScheduled("info", {
      event: "scheduled.outbox_completed",
      environment: env.APP_ENV,
      cron: controller.cron,
      claimed: summary.claimed,
      dispatched: summary.dispatched,
      retrying: summary.retrying,
      rejected: summary.rejected,
      queueDlqEligible: documentDlqReconciliation.eligible,
      queueDlqTerminalized: documentDlqReconciliation.terminalized,
      queueDlqHealthState: queueDlqHealth.state,
      queueDlqDocumentBacklog: queueDlqHealth.documentAnalysisBacklog,
      queueDlqOcrBacklog: queueDlqHealth.ocrBacklog,
      queueDlqDocumentExportBacklog: queueDlqHealth.documentExportBacklog,
      queueDlqMalwareScanBacklog: queueDlqHealth.malwareScanBacklog,
      queueDlqDurableDeadLettered: queueDlqHealth.durableDeadLettered,
      taskRemindersDue: taskReminders.due,
      taskRemindersEnqueued: taskReminders.enqueued,
      lexMetadataStaleRuns,
      lexSourceHealthState: lexSourceHealth.state,
      lexSourceHealthError: lexSourceHealth.alertCode,
      lexMetadataRetryStatus: lexMetadataRetry?.status ?? "not_due",
      pendingRegistrationRetentionEligible: pendingRegistrationRetention.eligible,
      pendingRegistrationRetentionPurged: pendingRegistrationRetention.purged,
      pendingRegistrationRetentionStaleMarkersPurged: pendingRegistrationRetention.staleMarkersPurged,
      pendingRegistrationRetentionRemainingDue: pendingRegistrationRetention.remainingDue,
      registrationOtpRetentionEligible: pendingRegistrationRetention.registrationOtpEligible,
      registrationOtpRetentionPurged: pendingRegistrationRetention.registrationOtpPurged,
      memoryRetentionEligible: memoryRetention.eligible,
      memoryRetentionPurged: memoryRetention.purged,
      guestAiRetentionEligible: guestAiRetention.eligible,
      guestAiRetentionPurged: guestAiRetention.purged,
      guestAiReservationsReleased: guestAiRetention.reservationsReleased,
      questionIntakeRetentionEligible: questionIntakeRetention.eligible,
      questionIntakeRetentionPurged: questionIntakeRetention.purged,
      voiceRetentionEligible: voiceRetention.eligible,
      voiceRetentionPurged: voiceRetention.purged,
      documentAnalysisRetentionEligible: documentAnalysisRetention.eligible,
      documentAnalysisRetentionPurged: documentAnalysisRetention.purged,
      documentAnalysisRetentionRetrying: documentAnalysisRetention.retrying,
      documentAnalysisIdempotencyPurged: documentAnalysisRetention.idempotencyPurged,
      analysisVersionObjectsEligible: analysisVersionObjects.eligible,
      analysisVersionObjectsClaimed: analysisVersionObjects.claimed,
      analysisVersionObjectsAttached: analysisVersionObjects.attached,
      analysisVersionObjectsDeleted: analysisVersionObjects.deleted,
      analysisVersionObjectsRetrying: analysisVersionObjects.retrying,
      builderVersionObjectsEligible: builderVersionObjects.eligible,
      builderVersionObjectsClaimed: builderVersionObjects.claimed,
      builderVersionObjectsAttached: builderVersionObjects.attached,
      builderVersionObjectsDeleted: builderVersionObjects.deleted,
      builderVersionObjectsRetrying: builderVersionObjects.retrying,
      providerProbeAttempted: providerProbe?.attempted ?? 0,
      providerProbeSucceeded: providerProbe?.succeeded ?? 0,
      providerProbeFailed: providerProbe?.failed ?? 0,
      providerProbeSkipped: providerProbe?.skipped ?? 0,
      emailDeliveryProbeAttempted: emailDeliveryProbe?.attempted ?? 0,
      emailDeliveryProbeAccepted: emailDeliveryProbe?.accepted ?? 0,
      emailDeliveryProbeFailed: emailDeliveryProbe?.failed ?? 0,
      productionQueueHealthProbeEnqueued: productionQueueHealthProbe?.enqueued ?? 0,
      productionQueueHealthProbeStale: productionQueueHealthProbe?.stale ?? 0,
      productionQueueHealthProbeFailed: productionQueueHealthProbe?.failed ?? 0,
      productionQueueHealthProbeSkipped: productionQueueHealthProbe?.skipped ?? 0,
      productionPrivateR2Probe: productionDependencyProbes?.privateR2 ?? "disabled",
      productionDocumentBuilderProbe: productionDependencyProbes?.documentBuilder ?? "disabled",
      productionMalwareScannerProbe: productionDependencyProbes?.malwareScanner ?? "disabled",
      productionOpenAiProbe: productionDependencyProbes?.openai ?? "disabled",
      productionAnthropicProbe: productionDependencyProbes?.anthropic ?? "disabled",
      productionDocumentAnalysisProbe: productionDependencyProbes?.documentAnalysis ?? "disabled",
      productionEmailProbe: productionDependencyProbes?.resend ?? "disabled",
      productionLawyerAreaProbe: productionDependencyProbes?.lawyerArea ?? "disabled",
      emailDeliveryProbeSkipped: emailDeliveryProbe?.skipped ?? 0,
      emailDeliveryProbeAlreadyAccepted: emailDeliveryProbe?.alreadyAccepted ?? 0,
      malwareScannerProbeAttempted: malwareScannerProbe?.attempted ?? 0,
      malwareScannerProbeDetected: malwareScannerProbe?.detected ?? 0,
      malwareScannerProbeFailed: malwareScannerProbe?.failed ?? 0,
      malwareScannerProbeSkipped: malwareScannerProbe?.skipped ?? 0,
      documentAnalysisProbeAttempted: documentAnalysisProbe?.attempted ?? 0,
      documentAnalysisProbeCompleted: documentAnalysisProbe?.completed ?? 0,
      documentAnalysisProbeFailed: documentAnalysisProbe?.failed ?? 0,
      documentAnalysisProbeSkipped: documentAnalysisProbe?.skipped ?? 0,
      queueHealthProbeEnqueued: queueHealthProbe?.enqueued ?? 0,
      queueHealthProbeStale: queueHealthProbe?.stale ?? 0,
      queueHealthProbeFailed: queueHealthProbe?.failed ?? 0,
      queueHealthProbeSkipped: queueHealthProbe?.skipped ?? 0,
    });
  } catch {
    try {
      await finishSchedule(env, run, "failed", failureCode);
    } catch {
      // The expiring lock allows recovery when bookkeeping also fails.
    }
    throw new Error(failureCode);
  }
}
