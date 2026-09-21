import { z } from "zod";
import {
  ATTACHED_PLATFORM_QUEUE_BINDINGS,
  JOB_KINDS,
  PLATFORM_QUEUE_BINDINGS,
  QUEUE_BINDING_BY_KIND,
  jobEnvelopeSchema,
  retryDelay,
  type JobEnvelope,
  type PlatformQueueBinding,
} from "./platform-jobs";

export type PlatformOutboxEnv = {
  DB: D1Database;
  APP_ENV?: string;
  ASYNC_RUNTIME_ENABLED?: string;
  JOB_SCHEMA_VERSION?: string;
} & Partial<Record<PlatformQueueBinding, Queue<JobEnvelope>>>;

const outboxRowSchema = z.object({
  id: z.string().min(1).max(180),
  queue_binding: z.enum(PLATFORM_QUEUE_BINDINGS),
  job_type: z.enum(JOB_KINDS),
  schema_version: z.literal(1),
  idempotency_key: z.string().min(1).max(180),
  subject_id: z.string().min(1).max(180),
  workspace_id: z.string().min(1).max(180).nullable(),
  correlation_id: z.string().min(1).max(180),
  enqueued_at: z.string(),
  dispatch_attempts: z.number().int().positive(),
  lease_owner: z.string().min(1),
  redrive_version: z.number().int().min(0),
}).strict();

type OutboxRow = z.infer<typeof outboxRowSchema>;

const attachedQueueBindings = new Set<string>(
  ATTACHED_PLATFORM_QUEUE_BINDINGS,
);

type DispatchSummary = {
  claimed: number;
  dispatched: number;
  rejected: number;
  retrying: number;
};

function logOutbox(
  level: "info" | "error",
  fields: Record<string, string | number>,
): void {
  const entry = JSON.stringify(fields);
  if (level === "error") {
    console.error(entry);
  } else {
    console.log(entry);
  }
}

function isoAfter(iso: string, milliseconds: number): string {
  return new Date(new Date(iso).getTime() + milliseconds).toISOString();
}

async function claimNextOutbox(
  env: PlatformOutboxEnv,
  now: string,
  subjectId: string | null,
): Promise<OutboxRow | null> {
  const leaseOwner = crypto.randomUUID();
  const leaseExpiresAt = isoAfter(now, 2 * 60 * 1_000);
  const result = await env.DB.prepare(`
    UPDATE job_outbox
    SET status = 'dispatching',
        dispatch_attempts = dispatch_attempts + 1,
        lease_owner = ?,
        lease_expires_at = ?,
        error_code = NULL,
        updated_at = ?
    WHERE id = (
      SELECT id
      FROM job_outbox
      WHERE status IN ('pending', 'retrying', 'dispatching')
        AND (? IS NULL OR subject_id = ?)
        AND available_at <= ?
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
      ORDER BY available_at, created_at
      LIMIT 1
    )
    RETURNING
      id, queue_binding, job_type, schema_version, idempotency_key,
      subject_id, workspace_id, correlation_id, enqueued_at,
      dispatch_attempts, lease_owner,
      COALESCE((
        SELECT MAX(redrive.version)
        FROM operational_job_redrive_events AS redrive
        WHERE redrive.source_job_id=job_outbox.id
      ),0) AS redrive_version
  `).bind(
    leaseOwner,
    leaseExpiresAt,
    now,
    subjectId,
    subjectId,
    now,
    now,
    now,
  ).run<OutboxRow>();

  const candidate = result.results[0];
  if (!candidate) {
    return null;
  }
  const parsed = outboxRowSchema.safeParse(candidate);
  if (!parsed.success) {
    await env.DB.prepare(`
      UPDATE job_outbox
      SET status = 'rejected',
          lease_owner = NULL,
          lease_expires_at = NULL,
          error_code = 'JOB_OUTBOX_INVALID',
          updated_at = ?
      WHERE id = ? AND lease_owner = ?
    `).bind(now, candidate.id, leaseOwner).run();
    logOutbox("error", {
      event: "outbox.invalid_row",
      environment: env.APP_ENV ?? "unknown",
    });
    return null;
  }
  return parsed.data;
}

function queueBinding(
  env: PlatformOutboxEnv,
  binding: PlatformQueueBinding,
): Queue<JobEnvelope> {
  const queue = env[binding];
  if (!queue) {
    throw new TypeError("Queue binding is not attached.");
  }
  return queue;
}

async function markOutboxRejected(
  env: PlatformOutboxEnv,
  row: OutboxRow,
  now: string,
): Promise<boolean> {
  const result = await env.DB.prepare(`
    UPDATE job_outbox
    SET status = 'rejected',
        lease_owner = NULL,
        lease_expires_at = NULL,
        next_attempt_at = NULL,
        error_code = 'JOB_OUTBOX_INVALID',
        updated_at = ?
    WHERE id = ? AND lease_owner = ? AND status = 'dispatching'
  `).bind(now, row.id, row.lease_owner).run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function markOutboxRetrying(
  env: PlatformOutboxEnv,
  row: OutboxRow,
  now: string,
): Promise<boolean> {
  const delaySeconds = retryDelay(row.dispatch_attempts);
  const result = await env.DB.prepare(`
    UPDATE job_outbox
    SET status = 'retrying',
        lease_owner = NULL,
        lease_expires_at = NULL,
        next_attempt_at = ?,
        error_code = 'JOB_OUTBOX_SEND_FAILED',
        updated_at = ?
    WHERE id = ? AND lease_owner = ? AND status = 'dispatching'
  `).bind(
    isoAfter(now, delaySeconds * 1_000),
    now,
    row.id,
    row.lease_owner,
  ).run();
  return Number(result.meta.changes ?? 0) === 1;
}

async function markOutboxDispatched(
  env: PlatformOutboxEnv,
  row: OutboxRow,
  now: string,
): Promise<boolean> {
  const result = await env.DB.prepare(`
    UPDATE job_outbox
    SET status = 'dispatched',
        lease_owner = NULL,
        lease_expires_at = NULL,
        next_attempt_at = NULL,
        dispatched_at = ?,
        error_code = NULL,
        updated_at = ?
    WHERE id = ? AND lease_owner = ? AND status = 'dispatching'
  `).bind(now, now, row.id, row.lease_owner).run();
  return Number(result.meta.changes ?? 0) === 1;
}

/**
 * Sends identifiers-only outbox rows. A crash after Queue.send() but before
 * the fenced status update can resend the envelope; consumers deduplicate it
 * by idempotencyKey.
 */
export async function dispatchOutbox(
  env: PlatformOutboxEnv,
  limit = 10,
  subjectId: string | null = null,
): Promise<DispatchSummary> {
  const summary: DispatchSummary = {
    claimed: 0,
    dispatched: 0,
    rejected: 0,
    retrying: 0,
  };
  if (String(env.ASYNC_RUNTIME_ENABLED) !== "true") {
    logOutbox("error", {
      event: "outbox.runtime_disabled",
      environment: env.APP_ENV ?? "unknown",
    });
    return summary;
  }
  if (String(env.JOB_SCHEMA_VERSION) !== "1") {
    logOutbox("error", {
      event: "outbox.schema_version_mismatch",
      environment: env.APP_ENV ?? "unknown",
    });
    return summary;
  }

  const safeLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
  if (subjectId !== null && !/^[A-Za-z0-9:_-]{1,180}$/.test(subjectId)) {
    throw new TypeError("Invalid outbox subject identifier.");
  }

  for (let index = 0; index < safeLimit; index += 1) {
    const now = new Date().toISOString();
    let row: OutboxRow | null;
    try {
      row = await claimNextOutbox(env, now, subjectId);
    } catch {
      logOutbox("error", {
        event: "outbox.claim_failed",
        environment: env.APP_ENV ?? "unknown",
      });
      break;
    }
    if (!row) {
      break;
    }
    summary.claimed += 1;

    const envelope = jobEnvelopeSchema.safeParse({
      schemaVersion: row.schema_version,
      jobId: row.id,
      kind: row.job_type,
      idempotencyKey: row.idempotency_key,
      subjectId: row.subject_id,
      workspaceId: row.workspace_id,
      correlationId: row.correlation_id,
      enqueuedAt: row.enqueued_at,
      redriveVersion: row.redrive_version,
    });
    if (
      !envelope.success ||
      QUEUE_BINDING_BY_KIND[row.job_type] !== row.queue_binding ||
      !attachedQueueBindings.has(row.queue_binding)
    ) {
      if (await markOutboxRejected(env, row, now)) {
        summary.rejected += 1;
        logOutbox("error", {
          event: "outbox.rejected",
          environment: env.APP_ENV ?? "unknown",
          jobId: row.id,
        });
      } else {
        logOutbox("error", {
          event: "outbox.lease_lost_before_rejection",
          environment: env.APP_ENV ?? "unknown",
          jobId: row.id,
        });
      }
      continue;
    }

    try {
      await queueBinding(env, row.queue_binding).send(envelope.data, {
        contentType: "json",
      });
      if (await markOutboxDispatched(env, row, new Date().toISOString())) {
        summary.dispatched += 1;
      } else {
        logOutbox("error", {
          event: "outbox.lease_lost_after_send",
          environment: env.APP_ENV ?? "unknown",
          jobId: row.id,
        });
      }
    } catch {
      try {
        if (await markOutboxRetrying(env, row, new Date().toISOString())) {
          summary.retrying += 1;
          logOutbox("error", {
            event: "outbox.send_failed",
            environment: env.APP_ENV ?? "unknown",
            jobId: row.id,
          });
        } else {
          logOutbox("error", {
            event: "outbox.lease_lost_after_send_failure",
            environment: env.APP_ENV ?? "unknown",
            jobId: row.id,
          });
        }
      } catch {
        // The expired dispatch lease makes the row recoverable.
      }
    }
  }

  return summary;
}
