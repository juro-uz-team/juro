import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Operation = { id: string; category: string; phase: string; maximum: number;
  charged: number | null; state: string; expires: number | null };
export type SpendingPhase = "diagnostic" | "final" | "operating";
function money(value: number, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error("SPENDING_AMOUNT_INVALID");
  return value;
}

/** Opens an existing ledger. This adapter never creates budgets or resets historic operations. */
export class CategorySpendingLedger {
  private readonly db: DatabaseSync;
  constructor(path: string, private readonly caps: Readonly<Record<string, number>>,
    private readonly phases: readonly SpendingPhase[] = ["diagnostic", "final"]) {
    if (!statSync(path).isFile()) throw new Error("SPENDING_LEDGER_REQUIRED");
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA busy_timeout=5000");
    try {
      if (!phases.length || phases.some(phase => !["diagnostic", "final", "operating"].includes(phase))
        || this.db.prepare("SELECT DISTINCT phase FROM operations").all().some(row => !phases.includes(row.phase as SpendingPhase))) {
        throw new Error("SPENDING_PURPOSE_MISMATCH");
      }
      for (const [category, cap] of Object.entries(caps)) {
        money(cap, 1);
        const row = this.db.prepare("SELECT cap,diagnostic FROM categories WHERE id=?").get(category);
        if (!row || row.cap !== cap || typeof row.diagnostic !== "number"
          || !Number.isSafeInteger(row.diagnostic) || row.diagnostic < 0 || row.diagnostic > cap) {
          throw new Error("SPENDING_POLICY_MISMATCH");
        }
      }
    } catch (error) { this.db.close(); throw error; }
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = operation(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  assertReconciled() {
    if (this.db.prepare(`SELECT id FROM operations WHERE state IN ('unknown','overrun')
      OR (state='dispatched' AND (expires IS NULL OR expires<=?)) LIMIT 1`).get(Date.now() / 1000)) {
      throw new Error("PROVIDER_USAGE_UNRECONCILED");
    }
  }
  private operation(id: string): Operation {
    const row = this.db.prepare("SELECT * FROM operations WHERE id=?").get(id);
    if (!row) throw new Error("SPENDING_RESERVATION_MISSING");
    return row as Operation;
  }
  reserve(input: { category: string; phase: SpendingPhase; maximumMicrousd: number; expiresAt: number }) {
    money(input.maximumMicrousd, 1);
    if (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now()
      || input.expiresAt > Date.now() + 300_000) throw new Error("SPENDING_EXPIRY_INVALID");
    if (!this.phases.includes(input.phase)) throw new Error("SPENDING_PHASE_INVALID");
    return this.transaction(() => {
      this.assertReconciled();
      const policy = this.db.prepare("SELECT cap,diagnostic FROM categories WHERE id=?").get(input.category);
      if (!policy || !Object.hasOwn(this.caps, input.category) || policy.cap !== this.caps[input.category]
        || typeof policy.diagnostic !== "number") throw new Error("SPENDING_POLICY_MISMATCH");
      let total = 0n, diagnostic = 0n;
      for (const row of this.db.prepare("SELECT phase,maximum,charged,state FROM operations WHERE category=?").all(input.category)) {
        if (!["reserved", "dispatched", "unknown", "overrun", "settled"].includes(String(row.state))) throw new Error("SPENDING_STATE_INVALID");
        if (typeof row.maximum !== "number" || (row.charged !== null && typeof row.charged !== "number")) {
          throw new Error("SPENDING_AMOUNT_INVALID");
        }
        const held = BigInt(money(row.charged ?? row.maximum));
        total += held;
        if (row.phase === "diagnostic") diagnostic += held;
      }
      const maximum = BigInt(input.maximumMicrousd);
      if (total + maximum > BigInt(this.caps[input.category])
        || (input.phase === "diagnostic" && diagnostic + maximum > BigInt(money(policy.diagnostic)))) {
        throw new Error("PROVIDER_SPENDING_CAP");
      }
      const id = randomUUID();
      this.db.prepare(`INSERT INTO operations(id,category,phase,maximum,charged,state,expires)
        VALUES(?,?,?,?,NULL,'reserved',?)`).run(id, input.category, input.phase, input.maximumMicrousd, input.expiresAt / 1000);
      return id;
    });
  }
  dispatch(id: string) {
    this.transaction(() => {
      this.assertReconciled();
      const result = this.db.prepare(`UPDATE operations SET state='dispatched'
        WHERE id=? AND state='reserved' AND expires>?`).run(id, Date.now() / 1000);
      if (result.changes !== 1) throw new Error("SPENDING_DISPATCH_REJECTED");
    });
  }
  cancel(id: string) {
    this.transaction(() => {
      const result = this.db.prepare("UPDATE operations SET state='settled',charged=0 WHERE id=? AND state='reserved'").run(id);
      if (result.changes !== 1) throw new Error("RESERVATION_NOT_CANCELLABLE");
    });
  }
  settle(id: string, charged: number | null) {
    if (charged !== null) money(charged);
    const exceeded = this.transaction(() => {
      const row = this.operation(id);
      if (row.state === "settled") {
        if (charged === null || charged !== row.charged) throw new Error("SPENDING_SETTLEMENT_CONFLICT");
        return false;
      }
      if (row.state !== "dispatched" && row.state !== "unknown") throw new Error("SPENDING_SETTLEMENT_STATE_INVALID");
      const over = charged !== null && charged > row.maximum;
      this.db.prepare("UPDATE operations SET state=?,charged=?,maximum=? WHERE id=?")
        .run(over ? "overrun" : charged === null ? "unknown" : "settled", over ? null : charged,
          Math.max(row.maximum, charged ?? 0), id);
      return over;
    });
    if (exceeded) throw new Error("SPENDING_BOUND_EXCEEDED");
  }
  close() { this.db.close(); }
}
