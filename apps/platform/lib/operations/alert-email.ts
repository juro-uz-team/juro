import { sendEmailRequest } from "../runtime/email";
import { z } from "zod";


const providerAlertRowSchema = z.object({
  id: z.string().uuid(),
  environment: z.enum(["development", "staging", "production"]),
  provider: z.enum(["openai", "anthropic"]),
  alertType: z.literal("ai_provider_circuit_opened"),
  severity: z.literal("critical"),
  reason: z.enum(["manual", "daily_cost_limit", "failure_spike"]),
  observedValue: z.number().int().nonnegative().nullable(),
  thresholdValue: z.number().int().positive().nullable(),
  status: z.enum(["pending", "sending", "retrying", "sent", "failed"]),
  providerMessageId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

const legalCorpusAlertRowSchema = z.object({
  id: z.string().uuid(),
  environment: z.enum(["development", "staging", "production"]),
  sourceKind: z.literal("lex"),
  alertType: z.enum(["legal_corpus_sync_failed", "legal_corpus_stale"]),
  severity: z.enum(["warning", "critical"]),
  reason: z.enum(["run_failed", "never_succeeded", "stale_success"]),
  observedValue: z.number().int().nonnegative().nullable(),
  thresholdValue: z.number().int().positive().nullable(),
  status: z.enum(["pending", "sending", "retrying", "sent", "failed"]),
  providerMessageId: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

type OperationalAlertRow =
  | (z.infer<typeof providerAlertRowSchema> & { domain: "provider" })
  | (z.infer<typeof legalCorpusAlertRowSchema> & { domain: "legal_corpus" });

export type OperationalAlertEmailEnv = {
  DB: D1Database;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  OPERATIONS_ALERT_EMAIL?: string;
};

export type OperationalAlertEmailErrorCode =
  | "OPERATIONAL_ALERT_CONFIGURATION_UNAVAILABLE"
  | "OPERATIONAL_ALERT_JOB_INVALID"
  | "OPERATIONAL_ALERT_PROVIDER_REJECTED"
  | "OPERATIONAL_ALERT_PROVIDER_UNAVAILABLE";

export class OperationalAlertEmailError extends Error {
  constructor(
    readonly code: OperationalAlertEmailErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "OperationalAlertEmailError";
  }
}

function normalizeRecipient(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new OperationalAlertEmailError("OPERATIONAL_ALERT_CONFIGURATION_UNAVAILABLE", false);
  }
  return normalized;
}

function providerFailure(status: number): OperationalAlertEmailError {
  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return new OperationalAlertEmailError("OPERATIONAL_ALERT_PROVIDER_UNAVAILABLE", true);
  }
  return new OperationalAlertEmailError("OPERATIONAL_ALERT_PROVIDER_REJECTED", false);
}

function alertCopy(row: OperationalAlertRow): { subject: string; html: string } {
  if (row.domain === "legal_corpus") {
    const source = "Lex.uz";
    const reason = ({
      run_failed: "последняя синхронизация завершилась ошибкой",
      never_succeeded: "успешная полная синхронизация ещё не зафиксирована",
      stale_success: "последняя успешная синхронизация старше допустимого порога",
    } as const)[row.reason];
    const freshness = row.observedValue === null
      ? "не применяется"
      : `${row.observedValue} ч / порог ${row.thresholdValue} ч`;
    const subject = `[JURO ${row.environment}] ${source}: состояние юридической базы требует проверки`;
    return {
      subject,
      html: `<div style="font-family:Arial,sans-serif;color:#111d36"><h2>${subject}</h2><p><strong>Причина:</strong> ${reason}<br><strong>Свежесть:</strong> ${freshness}<br><strong>Событие:</strong> ${row.id}<br><strong>Время:</strong> ${row.createdAt}</p><p>Проверьте журнал синхронизации, Queue/DLQ и состояние источника в защищённой панели JURO. Не считайте базу актуальной до успешного полного запуска.</p></div>`,
    };
  }
  const reason = ({
    manual: "ручное аварийное отключение",
    daily_cost_limit: "достигнут дневной лимит стоимости",
    failure_spike: "обнаружен всплеск ошибок провайдера",
  } as const)[row.reason];
  const metric = row.observedValue === null
    ? "не применяется"
    : `${row.observedValue.toLocaleString("en-US")} / ${row.thresholdValue?.toLocaleString("en-US")}`;
  const subject = `[JURO ${row.environment}] ${row.provider}: circuit breaker открыт`;
  return {
    subject,
    html: `<div style="font-family:Arial,sans-serif;color:#111d36"><h2>${subject}</h2><p>AI-вызовы к провайдеру остановлены до ручной проверки.</p><p><strong>Причина:</strong> ${reason}<br><strong>Метрика / порог:</strong> ${metric}<br><strong>Событие:</strong> ${row.id}<br><strong>Время:</strong> ${row.createdAt}</p><p>Проверьте usage, цены и provider status в защищённой панели JURO. Закрывайте circuit только после устранения причины.</p></div>`,
  };
}

async function alertJob(db: D1Database, jobId: string): Promise<OperationalAlertRow | null> {
  const providerRow = await db.prepare(
    `SELECT id,environment,provider,alert_type AS alertType,severity,reason,
      observed_value AS observedValue,threshold_value AS thresholdValue,status,
      provider_message_id AS providerMessageId,created_at AS createdAt
     FROM operational_alert_jobs WHERE id=? LIMIT 1`,
  ).bind(jobId).first<Record<string, unknown>>();
  if (providerRow) {
    const parsed = providerAlertRowSchema.safeParse(providerRow);
    return parsed.success ? { ...parsed.data, domain: "provider" } : null;
  }
  const legalRow = await db.prepare(
    `SELECT id,environment,source_kind AS sourceKind,alert_type AS alertType,severity,reason,
      observed_value AS observedValue,threshold_value AS thresholdValue,status,
      provider_message_id AS providerMessageId,created_at AS createdAt
     FROM legal_corpus_alert_jobs WHERE id=? LIMIT 1`,
  ).bind(jobId).first<Record<string, unknown>>();
  if (!legalRow) return null;
  const parsed = legalCorpusAlertRowSchema.safeParse(legalRow);
  return parsed.success ? { ...parsed.data, domain: "legal_corpus" } : null;
}

function alertTable(row: OperationalAlertRow): "operational_alert_jobs" | "legal_corpus_alert_jobs" {
  return row.domain === "provider" ? "operational_alert_jobs" : "legal_corpus_alert_jobs";
}

async function updateFailure(
  db: D1Database,
  row: OperationalAlertRow,
  error: OperationalAlertEmailError,
): Promise<void> {
  await db.prepare(
    `UPDATE ${alertTable(row)} SET status=?,error_code=?,updated_at=?
     WHERE id=? AND status<>'sent'`,
  ).bind(
    error.retryable ? "retrying" : "failed",
    error.code,
    new Date().toISOString(),
    row.id,
  ).run();
}

export async function executeOperationalAlertEmail(
  env: OperationalAlertEmailEnv,
  jobId: string,
): Promise<{ providerMessageId: string | null; alreadySent: boolean }> {
  const row = await alertJob(env.DB, jobId);
  if (!row || row.status === "failed") {
    throw new OperationalAlertEmailError("OPERATIONAL_ALERT_JOB_INVALID", false);
  }
  if (row.status === "sent") {
    return { providerMessageId: row.providerMessageId, alreadySent: true };
  }
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !env.OPERATIONS_ALERT_EMAIL) {
    const error = new OperationalAlertEmailError("OPERATIONAL_ALERT_CONFIGURATION_UNAVAILABLE", false);
    await updateFailure(env.DB, row, error);
    throw error;
  }

  let recipient: string;
  try {
    recipient = normalizeRecipient(env.OPERATIONS_ALERT_EMAIL);
  } catch (error) {
    const safe = error instanceof OperationalAlertEmailError
      ? error
      : new OperationalAlertEmailError("OPERATIONAL_ALERT_CONFIGURATION_UNAVAILABLE", false);
    await updateFailure(env.DB, row, safe);
    throw safe;
  }

  const now = new Date().toISOString();
  const staleSendingBefore = new Date(Date.parse(now) - 2 * 60 * 1_000).toISOString();
  const claimed = await env.DB.prepare(
    `UPDATE ${alertTable(row)}
     SET status='sending',attempt_count=attempt_count+1,error_code=NULL,updated_at=?
     WHERE id=? AND (status IN ('pending','retrying') OR (status='sending' AND updated_at<=?))`,
  ).bind(now, jobId, staleSendingBefore).run();
  if (Number(claimed.meta.changes ?? 0) !== 1) {
    const current = await alertJob(env.DB, jobId);
    if (current?.status === "sent") {
      return { providerMessageId: current.providerMessageId, alreadySent: true };
    }
    throw new OperationalAlertEmailError("OPERATIONAL_ALERT_PROVIDER_UNAVAILABLE", true);
  }

  const copy = alertCopy(row);
  let response: Response | null = null;
  try {
    response = await sendEmailRequest({
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": `juro_operational_alert_${jobId}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [recipient],
        subject: copy.subject,
        html: copy.html,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      const error = providerFailure(response.status);
      await response.body?.cancel();
      await updateFailure(env.DB, row, error);
      throw error;
    }
    const payload = await response.json().catch(() => null) as { id?: unknown } | null;
    if (typeof payload?.id !== "string" || !/^[A-Za-z0-9_-]{1,180}$/.test(payload.id)) {
      const error = new OperationalAlertEmailError("OPERATIONAL_ALERT_PROVIDER_UNAVAILABLE", true);
      await updateFailure(env.DB, row, error);
      throw error;
    }
    const sentAt = new Date().toISOString();
    const sent = await env.DB.prepare(
      `UPDATE ${alertTable(row)}
       SET status='sent',provider_message_id=?,sent_at=?,error_code=NULL,updated_at=?
       WHERE id=? AND status='sending'`,
    ).bind(payload.id, sentAt, sentAt, jobId).run();
    if (Number(sent.meta.changes ?? 0) !== 1) {
      throw new OperationalAlertEmailError("OPERATIONAL_ALERT_PROVIDER_UNAVAILABLE", true);
    }
    return { providerMessageId: payload.id, alreadySent: false };
  } catch (error) {
    if (error instanceof OperationalAlertEmailError) throw error;
    const safe = new OperationalAlertEmailError("OPERATIONAL_ALERT_PROVIDER_UNAVAILABLE", true);
    try {
      await response?.body?.cancel();
    } catch {
      // The provider response has no remaining usable body.
    }
    await updateFailure(env.DB, row, safe);
    throw safe;
  }
}
