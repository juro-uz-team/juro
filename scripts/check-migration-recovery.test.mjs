import assert from "node:assert/strict";
import test from "node:test";
import { pendingMigrations, verifyRecoveryReceipt } from "./check-migration-recovery.mjs";

const existing = { name: "0001_accounts.sql", sha256: "a".repeat(64) };
const added = { name: "0002_account_preferences.sql", sha256: "b".repeat(64) };
test("code-only deployment needs no new backup; missing or altered applied history is rejected", () => {
  assert.deepEqual(pendingMigrations([existing], [existing]), []);
  assert.deepEqual(pendingMigrations([existing, added], [existing]), [added]);
  assert.throws(() => pendingMigrations([], [existing]));
  assert.throws(() => pendingMigrations([{ ...existing, sha256: added.sha256 }], [existing]));
});

test("recovery evidence cannot authorize another environment, release, migration set or expired backup", () => {
  const revision = "c".repeat(40), now = Date.parse("2026-09-29T00:00:00Z");
  const receipt = { environment: "production", revision, restoreVerified: true, offServerCopy: true,
    expiresAt: "2026-09-29T01:00:00Z", pendingMigrations: [added] };
  verifyRecoveryReceipt(receipt, "production", revision, [added], now);
  for (const change of [{ environment: "staging" }, { revision: "d".repeat(40) }, { restoreVerified: false },
    { offServerCopy: false }, { pendingMigrations: [] }, { expiresAt: "invalid" }, { expiresAt: "2026-09-28T00:00:00Z" }]) {
    assert.throws(() => verifyRecoveryReceipt({ ...receipt, ...change }, "production", revision, [added], now));
  }
});
