import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { OperatingUsageLedger } from "../lib/legal-answer-workflow/operating-usage";
import { CategorySpendingLedger } from "../lib/ai/category-spending-ledger";

test("operating usage survives restart with actual and conservatively unknown charges without a manual allocation", () => {
  const directory = mkdtempSync(join(tmpdir(), "juro-operating-usage-"));
  const path = join(directory, "usage.sqlite");
  let ledger = new OperatingUsageLedger(path);
  try {
    const known = ledger.reserve({ category: "generation", phase: "operating", maximumMicrousd: 100, expiresAt: Date.now() + 30_000 });
    ledger.dispatch(known); ledger.settle(known, 13);
    const unknown = ledger.reserve({ category: "embedding", phase: "operating", maximumMicrousd: 25, expiresAt: Date.now() + 30_000 });
    ledger.dispatch(unknown); ledger.settle(unknown, null);
    ledger.close(); ledger = new OperatingUsageLedger(path);
    assert.equal(ledger.read(known).actualMicrousd, 13);
    assert.equal(ledger.read(known).accountedMicrousd, 13);
    assert.equal(ledger.read(unknown).actualMicrousd, null);
    assert.equal(ledger.read(unknown).accountedMicrousd, 25);
    assert.equal(ledger.read(unknown).state, "unknown");
    ledger.settle(unknown, 4);
    assert.equal(ledger.read(unknown).actualMicrousd, 4);
    assert.equal(ledger.read(unknown).accountedMicrousd, 4);
    assert.throws(() => ledger.settle(known, 99), /STATE/);
  } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("operating accounting rejects task phases and foreign ledgers and fences dispatch and cancellation across handles", () => {
  const directory = mkdtempSync(join(tmpdir(), "juro-operating-fences-"));
  const path = join(directory, "usage.sqlite"), foreign = join(directory, "task.sqlite");
  const prior = new DatabaseSync(foreign);
  prior.exec("CREATE TABLE categories(id TEXT PRIMARY KEY,cap INTEGER); INSERT INTO categories VALUES('generation',19000000)"); prior.close();
  const first = new OperatingUsageLedger(path), second = new OperatingUsageLedger(path);
  try {
    assert.throws(() => new OperatingUsageLedger(foreign), /LEDGER_IDENTITY/);
    const task = new DatabaseSync(foreign, { readOnly: true });
    try { assert.equal(task.prepare("SELECT cap FROM categories").get()?.cap, 19_000_000); } finally { task.close(); }
    const input = { category: "generation", phase: "operating" as const, maximumMicrousd: 100, expiresAt: Date.now() + 30_000 };
    assert.throws(() => first.reserve({ ...input, phase: "diagnostic" }), /RESERVATION_INVALID/);
    assert.throws(() => first.reserve({ ...input, phase: "final" }), /RESERVATION_INVALID/);
    assert.throws(() => first.reserve({ ...input, expiresAt: 0 }), /RESERVATION_INVALID/);
    const id = first.reserve(input); second.dispatch(id);
    assert.throws(() => first.dispatch(id), /STATE/);
    assert.throws(() => first.cancel(id), /STATE/);
    // Accounting retains an actual charge even if it exceeds its estimated maximum.
    second.settle(id, 120); assert.equal(first.read(id).accountedMicrousd, 120);
    const cancelled = second.reserve(input); first.cancel(cancelled);
    assert.equal(second.read(cancelled).accountedMicrousd, 0);
    assert.throws(() => second.dispatch(cancelled), /STATE/);
  } finally { first.close(); second.close(); rmSync(directory, { recursive: true, force: true }); }
});

test("adding a cap cannot reopen operating history as an empty spending ledger", () => {
  const directory = mkdtempSync(join(tmpdir(), "juro-operating-policy-"));
  const path = join(directory, "usage.sqlite"), ledger = new OperatingUsageLedger(path);
  try {
    const id = ledger.reserve({ category: "generation", phase: "operating", maximumMicrousd: 100, expiresAt: Date.now() + 30_000 });
    ledger.dispatch(id); ledger.settle(id, 37);
    for (const phases of [["operating"], ["diagnostic", "final"]] as const) {
      assert.throws(() => new CategorySpendingLedger(path, { generation: 19_000_000, embedding: 1_000_000 }, [...phases]));
      assert.equal(ledger.read(id).actualMicrousd, 37);
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('categories','operations')").get()?.n, 0);
    } finally { db.close(); }
  } finally { ledger.close(); rmSync(directory, { recursive: true, force: true }); }
});
