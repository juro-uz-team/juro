import { withinSignal } from "./lifetime";
import { subscriptionPeriod, type AnswerPeriod } from "../billing/entitlements";

/** Early HTTP admission only; the retained atomic reservation remains authoritative under concurrency. */
export async function answerAllowanceAvailable(input: {
  db: D1Database; workspaceId: string; userId: string; idempotencyKey: string;
  monthlyLimit: number | null; answerPeriod?: AnswerPeriod; signal: AbortSignal;
}) {
  const { periodStart } = input.answerPeriod ?? subscriptionPeriod(new Date());
  const scope = `legal-chat:${input.workspaceId}:${input.userId}`;
  const row = await withinSignal(input.signal, () => input.db.prepare(`SELECT
    EXISTS(SELECT 1 FROM idempotency_keys WHERE key=? AND scope=?) AS existing,
    (SELECT value FROM control_settings WHERE key='ai.max_monthly_cycles') AS ceiling,
    (SELECT COALESCE(SUM(units),0) FROM ai_usage_ledger WHERE workspace_id=? AND (?=1 OR user_id=?)
      AND feature='legal_chat' AND period_start=? AND status IN ('reserved','consumed')) AS used`)
    .bind(`${scope}:${input.idempotencyKey}`, scope, input.workspaceId, Number(input.answerPeriod?.pooled ?? false), input.userId, periodStart)
    .first<{ existing: number | boolean; ceiling: string | null; used: number | string }>());
  if (!row) throw new Error("ANSWER_ALLOWANCE_UNAVAILABLE");
  // An existing key must reach the hash/replay checks even when the allowance is now exhausted.
  if (row.existing) return true;
  if (input.answerPeriod?.readOnly) return false;
  const ceiling = row.ceiling === null ? null : Number(JSON.parse(row.ceiling));
  const limit = ceiling !== null && Number.isInteger(ceiling) && ceiling > 0
    ? Math.min(input.monthlyLimit ?? ceiling, ceiling) : input.monthlyLimit;
  // PostgreSQL SUM(integer) returns bigint as decimal text; SQLite returns a number.
  const used = typeof row.used === "string" && /^\d+$/.test(row.used) ? Number(row.used) : row.used;
  if (typeof used !== "number" || !Number.isSafeInteger(used) || used < 0
    || (limit !== null && (!Number.isSafeInteger(limit) || limit < 0))) {
    throw new Error("ANSWER_ALLOWANCE_INVALID");
  }
  return limit === null || used < limit;
}
