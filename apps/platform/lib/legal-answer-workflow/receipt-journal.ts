import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AttributedReceipt } from "./execution";
import { providerErrorSchema } from "./provider-http";

const identifier = z.string().min(1).max(240);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const common = {
  event: z.enum(["reserved", "received", "usage", "settled", "failed"]), reservationId: identifier,
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/u), at: z.iso.datetime(), maximumMicrousd: count,
  providerRequestId: identifier.optional(), inputTokens: count.optional(), chargedMicrousd: count.optional(),
  errorCode: z.string().regex(/^[A-Z][A-Z_]{0,119}$/u).optional(),
  httpStatus: z.number().int().min(100).max(599).optional(), providerError: providerErrorSchema.optional(),
};
const recordSchema = z.discriminatedUnion("category", [
  z.object({ runId: identifier, category: z.literal("generation"), receipt: z.object({ ...common,
    model: z.string().min(1).max(80), stage: z.enum(["interpret", "select", "assess", "write"]), responseId: identifier.optional(),
    outputTokens: count.optional(), reasoningTokens: count.optional(), cachedInputTokens: count.optional(), cacheWrite30mTokens: count.optional(), cacheWrite12hTokens: count.optional(),
    countedInputTokens: count.optional(),
    rates: z.object({ input: count, cachedInput: count, output: count }).strict(),
    requestedServiceTier: z.enum(["default", "fast"]).optional(), serviceTier: z.enum(["default", "fast"]).optional(),
  }).strict() }).strict(),
  z.object({ runId: identifier, category: z.literal("embedding"), receipt: z.object({ ...common,
    model: z.literal("text-embedding-3-large"), dimensions: z.union([z.literal(1536), z.literal(3072)]), inputRate: count,
  }).strict() }).strict(),
]);
const applicationId = 0x4a554a52;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Durable financial metadata only. This journal cannot open a spending ledger or application database. */
export class ProviderReceiptJournal {
  private readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    try {
      this.db.exec("PRAGMA busy_timeout=5000");
      this.db.exec("BEGIN IMMEDIATE");
      const identity = this.db.prepare("PRAGMA application_id").get()?.application_id;
      const tables = this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get()?.n;
      if (identity !== applicationId && (identity !== 0 || tables !== 0)) throw new Error("RECEIPT_JOURNAL_IDENTITY");
      this.db.exec(`PRAGMA application_id=${applicationId}`);
      this.db.exec(`CREATE TABLE IF NOT EXISTS provider_receipts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,run_id TEXT NOT NULL,category TEXT NOT NULL,
        reservation_id TEXT NOT NULL,event TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS provider_receipts_run ON provider_receipts(run_id,sequence);
        CREATE TRIGGER IF NOT EXISTS provider_receipts_no_update BEFORE UPDATE ON provider_receipts
          BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;
        CREATE TRIGGER IF NOT EXISTS provider_receipts_no_delete BEFORE DELETE ON provider_receipts
          BEGIN SELECT RAISE(ABORT,'RECEIPT_IMMUTABLE'); END;`);
      this.db.exec("COMMIT");
      this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL");
    } catch (error) {
      try { this.db.exec("ROLLBACK"); } catch { /* No active transaction. */ }
      this.db.close();
      throw error;
    }
  }
  append(value: AttributedReceipt): void {
    const parsed = recordSchema.safeParse(value);
    if (!parsed.success) throw new Error("RECEIPT_METADATA_INVALID");
    const record = parsed.data, body = JSON.stringify(record);
    this.db.prepare(`INSERT INTO provider_receipts(run_id,category,reservation_id,event,body,sha256) VALUES(?,?,?,?,?,?)`)
      .run(record.runId, record.category, record.receipt.reservationId, record.receipt.event, body, digest(body));
  }
  records(runId: string): AttributedReceipt[] {
    identifier.parse(runId);
    return this.db.prepare("SELECT body,sha256 FROM provider_receipts WHERE run_id=? ORDER BY sequence").all(runId).map(row => {
      if (typeof row.body !== "string" || digest(row.body) !== row.sha256) throw new Error("RECEIPT_JOURNAL_INTEGRITY");
      return recordSchema.parse(JSON.parse(row.body));
    });
  }
  close() { this.db.close(); }
}
