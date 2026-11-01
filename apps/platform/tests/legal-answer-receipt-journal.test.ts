import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ProviderReceiptJournal } from "../lib/legal-answer-workflow/receipt-journal";
import type { AttributedReceipt } from "../lib/legal-answer-workflow/execution";
import { createResponsesModel } from "../lib/legal-answer-workflow/provider";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "juro-receipts-")), path = join(directory, "receipts.sqlite");
  return { path, cleanup() {
    for (const suffix of ["", "-wal", "-shm", "-journal"]) if (existsSync(path + suffix)) unlinkSync(path + suffix);
    rmdirSync(directory);
  } };
}
const receipt: AttributedReceipt = { runId: "run-a", category: "generation", receipt: {
  event: "reserved", reservationId: "reservation", model: "gpt-6-luna", stage: "interpret", requestSha256: "a".repeat(64),
  at: "2026-10-29T00:00:00.000Z", maximumMicrousd: 1000, rates: { input: 100_000, cachedInput: 10_000, output: 500_000 },
} };

for (const inputTokenCounting of [false, true]) test(`provider usage and input counting persist through the real journal: ${inputTokenCounting}`, async () => {
  const file = fixture(), journal = new ProviderReceiptJournal(file.path), charges: (number | null)[] = [];
  try {
    const model = createResponsesModel({ apiKey: "fixture", model: "gpt-6-luna", purpose: "qualification", phase: "diagnostic",
      deadlineAt: Date.now() + 3000, inputTokenCounting, rates: { input: 100_000, cachedInput: 10_000, output: 500_000 },
      ledger: { reserve: () => "reservation", dispatch: () => {}, cancel: () => {}, settle: (_id, charge) => { charges.push(charge); } },
      receipt: async value => journal.append({ runId: "run-reasoning", category: "generation", receipt: value }),
      fetchImpl: async url => String(url).endsWith("/input_tokens")
        ? Response.json({ object: "response.input_tokens", input_tokens: 100 })
        : Response.json({ id: "response", model: "gpt-6-luna", service_tier: "default", status: "completed",
        usage: { input_tokens: 100, input_tokens_details: { cached_tokens: 20 }, output_tokens: 50,
          output_tokens_details: { reasoning_tokens: 30 } },
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: '{"ok":true}' }] }] }),
    });
    assert.deepEqual(await model.complete({ stage: "interpret", instruction: "Artificial fixture", input: {},
      schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      signal: AbortSignal.timeout(3000) }), { ok: true });
    assert.deepEqual(charges, [34]);
    const records = journal.records("run-reasoning");
    assert.deepEqual(records.map(item => item.receipt.event), ["reserved", "received", "usage", "settled"]);
    const usage = records.find(item => item.receipt.event === "usage")!;
    assert.equal(usage.category === "generation" && usage.receipt.reasoningTokens, 30);
    assert.equal(usage.category === "generation" && usage.receipt.countedInputTokens, inputTokenCounting ? 100 : undefined);
  } finally { journal.close(); file.cleanup(); }
});

test("financial receipts survive independent handles and reopen without accepting private payload fields", () => {
  const file = fixture();
  const first = new ProviderReceiptJournal(file.path), second = new ProviderReceiptJournal(file.path);
  try {
    first.append(receipt);
    const selection = { ...receipt, runId: "run-selection", receipt: { ...receipt.receipt, stage: "select" as const } };
    first.append(selection);
    assert.deepEqual(second.records("run-selection"), [selection]);
    const tiered = { ...receipt, runId: "run-fast", receipt: { ...receipt.receipt,
      event: "settled" as const, requestedServiceTier: "fast" as const, serviceTier: "default" as const,
      chargedMicrousd: 40 } };
    first.append(tiered);
    assert.deepEqual(second.records("run-fast"), [tiered]);
    second.append({ ...receipt, receipt: { ...receipt.receipt, event: "settled", chargedMicrousd: 40 } });
    const unexpected = { ...receipt, prompt: "Private question" };
    assert.throws(() => first.append(unexpected), /RECEIPT_METADATA_INVALID/);
    assert.equal(second.records("run-a").length, 2);
    assert.deepEqual(second.records("run-b"), []);
  } finally { first.close(); second.close(); }
  const reopened = new ProviderReceiptJournal(file.path);
  try {
    assert.deepEqual(reopened.records("run-a").map(record => record.receipt.event), ["reserved", "settled"]);
    const raw = new DatabaseSync(file.path);
    try {
      assert.throws(() => raw.exec("UPDATE provider_receipts SET body='changed'"), /RECEIPT_IMMUTABLE/);
      assert.throws(() => raw.exec("DELETE FROM provider_receipts"), /RECEIPT_IMMUTABLE/);
    } finally { raw.close(); }
  } finally { reopened.close(); file.cleanup(); }
});

test("receipt journal refuses an existing spending database without changing its identity or records", () => {
  const file = fixture(), original = new DatabaseSync(file.path);
  original.exec("CREATE TABLE categories(id TEXT); INSERT INTO categories VALUES('generation')");
  original.close();
  try {
    assert.throws(() => new ProviderReceiptJournal(file.path), /RECEIPT_JOURNAL_IDENTITY/);
    const check = new DatabaseSync(file.path);
    try {
      assert.equal(check.prepare("PRAGMA application_id").get()?.application_id, 0);
      assert.equal(check.prepare("SELECT id FROM categories").get()?.id, "generation");
      assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='provider_receipts'").get()?.n, 0);
    } finally { check.close(); }
  } finally { file.cleanup(); }
});

test("receipt journal persists bounded provider diagnostics and rejects private diagnostic fields", () => {
  const file = fixture(), journal = new ProviderReceiptJournal(file.path);
  const rejected = { ...receipt, receipt: { ...receipt.receipt, event: "failed" as const, httpStatus: 400,
    providerError: { type: "invalid_request_error" as const, code: "unsupported_parameter" as const, param: "model" as const } } };
  try {
    journal.append(rejected);
    assert.deepEqual(journal.records("run-a")[0], rejected);
    for (const providerError of [{ ...rejected.receipt.providerError, message: "Private input" },
      { ...rejected.receipt.providerError, param: "Private input" }]) {
      assert.throws(() => journal.append({ ...rejected, receipt: { ...rejected.receipt, providerError } } as AttributedReceipt),
        /RECEIPT_METADATA_INVALID/);
    }
    assert.equal(journal.records("run-a").length, 1);
  } finally { journal.close(); file.cleanup(); }
});
