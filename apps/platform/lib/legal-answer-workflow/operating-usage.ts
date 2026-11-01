import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { ProviderLedger } from "./provider";

const amount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const operation = z.object({ id: z.string().uuid(), category: z.enum(["generation", "embedding"]),
  maximumMicrousd: amount, actualMicrousd: amount.nullable(), accountedMicrousd: amount,
  state: z.enum(["reserved", "dispatched", "settled", "unknown", "cancelled"]), expiresAt: z.number().finite() });
const applicationId = 0x4a554f50;

/** Operating attribution without a new funding allowance. Explicit spending caps use the separate capped ledger. */
export class OperatingUsageLedger implements ProviderLedger {
  private readonly db: DatabaseSync;
  private closed = false;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA busy_timeout=5000; BEGIN IMMEDIATE");
      const identity = this.db.prepare("PRAGMA application_id").get()?.application_id;
      const tables = this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()?.n;
      if (identity !== applicationId && (identity !== 0 || tables !== 0)) throw new Error("OPERATING_LEDGER_IDENTITY");
      this.db.exec(`PRAGMA application_id=${applicationId};
        CREATE TABLE IF NOT EXISTS operating_usage (
          id TEXT PRIMARY KEY, category TEXT NOT NULL CHECK(category IN ('generation','embedding')),
          maximumMicrousd INTEGER NOT NULL CHECK(maximumMicrousd>0),
          actualMicrousd INTEGER CHECK(actualMicrousd>=0), accountedMicrousd INTEGER NOT NULL CHECK(accountedMicrousd>=0),
          state TEXT NOT NULL CHECK(state IN ('reserved','dispatched','settled','unknown','cancelled')), expiresAt REAL NOT NULL);
        COMMIT;`);
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* No active transaction. */ }
      this.db.close(); throw error;
    }
  }
  reserve(input: Parameters<ProviderLedger["reserve"]>[0]): string {
    if (input.phase !== "operating" || !["generation", "embedding"].includes(input.category)
      || !Number.isSafeInteger(input.maximumMicrousd) || input.maximumMicrousd <= 0
      || !Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now()) throw new Error("OPERATING_RESERVATION_INVALID");
    const id = randomUUID();
    this.db.prepare(`INSERT INTO operating_usage VALUES(?,?,?,NULL,?,'reserved',?)`)
      .run(id, input.category, input.maximumMicrousd, input.maximumMicrousd, input.expiresAt);
    return id;
  }
  dispatch(id: string): void {
    const result = this.db.prepare("UPDATE operating_usage SET state='dispatched' WHERE id=? AND state='reserved' AND expiresAt>?").run(id, Date.now());
    if (result.changes !== 1) throw new Error("OPERATING_RESERVATION_STATE");
  }
  settle(id: string, charged: number | null): void {
    if (charged !== null && (!Number.isSafeInteger(charged) || charged < 0)) throw new Error("OPERATING_CHARGE_INVALID");
    const result = this.db.prepare(`UPDATE operating_usage SET state=?,actualMicrousd=?,accountedMicrousd=COALESCE(?,maximumMicrousd)
      WHERE id=? AND state IN ('dispatched','unknown')`)
      .run(charged === null ? "unknown" : "settled", charged, charged, id);
    if (result.changes !== 1) throw new Error("OPERATING_RESERVATION_STATE");
  }
  cancel(id: string): void {
    const result = this.db.prepare("UPDATE operating_usage SET state='cancelled',actualMicrousd=0,accountedMicrousd=0 WHERE id=? AND state='reserved'").run(id);
    if (result.changes !== 1) throw new Error("OPERATING_RESERVATION_STATE");
  }
  read(id: string): z.infer<typeof operation> {
    const result = operation.safeParse(this.db.prepare("SELECT * FROM operating_usage WHERE id=?").get(id));
    if (!result.success) throw new Error("OPERATING_USAGE_UNAVAILABLE");
    return result.data;
  }
  close(): void { if (!this.closed) { this.closed = true; this.db.close(); } }
}
