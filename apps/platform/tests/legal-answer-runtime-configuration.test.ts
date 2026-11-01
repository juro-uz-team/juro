import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { parseAnswerRuntimeConfiguration } from "../lib/legal-answer-workflow/runtime-configuration";
import { createConfiguredAnswerRuntime } from "../lib/legal-answer-workflow/configured-runtime";
import { ProviderReceiptJournal } from "../lib/legal-answer-workflow/receipt-journal";
import { OperatingUsageLedger } from "../lib/legal-answer-workflow/operating-usage";

const hash = "a".repeat(64);
const release = (capability: "current" | "history") => ({ id: `fixture-${capability}`, environment: "staging", capability,
  instances: [{ id: "fixture-instance", shardId: "fixture-shard" }],
  configuration: { backend: "prepared-corpus-v1", navigationBackend: "pgvector", identity: "fixture-config",
    embeddingModel: "openai/text-embedding-3-large", dimensions: 3072,
    artifacts: { packageSha256: hash, vectorCompletionSha256: hash, vectorIdentitySha256: hash,
      membershipSha256: hash, workIndexSha256: hash, navigationSha256: hash, sparseSha256: hash },
    evidenceSemantics: "discovery-only", categoryRanking: { mode: "disabled" },
    gatewayIdentity: "fixture-gateway", providerProjectIdentity: "fixture-project",
    gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false } });
const environment = {
  APP_URL: "https://juro.example", OPENAI_API_KEY: "fixture-only",
  OPENAI_CHAT_MODEL: "ignored-obsolete-model", OPENAI_DEEP_MODEL: "ignored-obsolete-model",
  PREPARED_CURRENT_URL: "http://127.0.0.1:19141", PREPARED_HISTORY_URL: "http://127.0.0.1:19142",
  PREPARED_CURRENT_WORKER_SHA256: hash, PREPARED_HISTORY_WORKER_SHA256: hash, PREPARED_TRANSPORT_TOKEN: "t".repeat(40),
  LEGAL_ANSWER_SOURCE_URL: "http://127.0.0.1:19151", LEGAL_ANSWER_SOURCE_WORKER_SHA256: hash, LEGAL_ANSWER_SOURCE_TOKEN: "s".repeat(40),
};
const configuration = (directory: string) => ({ format: "legal-answer-runtime-v1", purpose: "qualification", phase: "final",
  legalDatabaseAsOf: "2026-10-29", generationSha256: hash, currentRelease: release("current"), historyRelease: release("history"),
  generationRates: { "gpt-6-luna": { input: 100_000, cachedInput: 10_000, output: 500_000 },
    "gpt-6.1-terra": { input: 1_000_000, cachedInput: 50_000, output: 5_000_000 } }, embeddingInputRate: 130_000,
  ledgerPath: join(directory, "ledger.sqlite"), receiptPath: join(directory, "receipts.sqlite") });

test("both model routes require standard service and targeted default reads", () => {
  const value = configuration(tmpdir());
  const parsed = parseAnswerRuntimeConfiguration(value, environment);
  assert.equal(parsed.corpus.candidateReadScope, "provision");
  assert.equal(parsed.corpus.automaticReadScope, "provision");
  for (const model of ["gpt-6-luna", "gpt-6.1-terra"]) {
    for (const field of ["serviceTier", "continuationServiceTier"]) {
      assert.throws(() => parseAnswerRuntimeConfiguration({ ...value, [field]: { [model]: "fast" } }, environment),
        /ANSWER_RUNTIME_CONFIGURATION_INVALID/);
    }
  }
  for (const field of ["automaticReadScope", "candidateReadScope"]) for (const readScope of ["section", "document"]) {
    assert.throws(() => parseAnswerRuntimeConfiguration({ ...value, [field]: readScope }, environment),
      /ANSWER_RUNTIME_CONFIGURATION_INVALID/);
  }
});

test("production starts without an invented allocation and retains actual usage for both configured model routes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "juro-operating-runtime-"));
  const value = configuration(directory);
  const config = parseAnswerRuntimeConfiguration({ ...value, purpose: "production", phase: "operating",
    inputTokenCounting: { "gpt-6-luna": false },
    generationRates: { ...value.generationRates, "gpt-6.1-terra": value.generationRates["gpt-6-luna"] } }, environment);
  const previousFetch = globalThis.fetch;
  const requestedModels: string[] = [];
  const countedModels: string[] = [];
  globalThis.fetch = async (_url, init) => {
    if (String(_url).endsWith("/input_tokens")) {
      countedModels.push(JSON.parse(String(init?.body)).model);
      return Response.json({ input_tokens: 10 });
    }
    const body = JSON.parse(String(init?.body)); requestedModels.push(body.model);
    assert.equal(body.service_tier, "default");
    return Response.json({ id: `fixture-${requestedModels.length}`, model: body.model, service_tier: "default", status: "completed",
      usage: { input_tokens: 10, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } },
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "{}" }] }] });
  };
  let runtime: ReturnType<typeof createConfiguredAnswerRuntime> | undefined;
  try {
    runtime = createConfiguredAnswerRuntime(config, {
      store: { namespace: `legal-prepared-${hash}`, get: async () => null, put: async () => { throw new Error("Unexpected write"); } },
      privateObjects: { get: async () => null },
    });
    for (const mode of ["fast", "deep"] as const) {
      const signal = new AbortController().signal;
      const execution = await runtime.dependencies(mode).createExecution({ runId: mode, model: config.models[mode], request: {
        question: "Artificial question", language: "en", format: "detailed", mode, actor: { tenantId: "w", userId: "u" },
        history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 30_000, signal,
      } });
      assert.deepEqual(await execution.model.complete({ stage: "interpret", instruction: "Fixture", input: {}, schema: {}, signal }), {});
    }
    runtime.close();
    assert.deepEqual(requestedModels, ["gpt-6-luna", "gpt-6.1-terra"]);
    assert.deepEqual(countedModels, ["gpt-6.1-terra"]);
    const journal = new ProviderReceiptJournal(value.receiptPath), ledger = new OperatingUsageLedger(value.ledgerPath);
    try {
      for (const mode of ["fast", "deep"]) {
        const settled = journal.records(mode).find(record => record.receipt.event === "settled");
        assert.ok(settled);
        assert.equal(ledger.read(settled.receipt.reservationId).actualMicrousd, 2);
      }
    } finally { journal.close(); ledger.close(); }
  } finally { runtime?.close(); globalThis.fetch = previousFetch; rmSync(directory, { recursive: true, force: true }); }
});

test("qualification uses the production model routes and rejects changed corpus and financial boundaries", () => {
  const value = configuration(tmpdir());
  const parsed = parseAnswerRuntimeConfiguration(value, environment);
  assert.deepEqual(parsed.models, { fast: "gpt-6-luna", deep: "gpt-6.1-terra" });
  assert.equal(parsed.corpus.current.worker.token, environment.PREPARED_TRANSPORT_TOKEN);
  const longContext = { input: 200_000, cachedInput: 20_000, output: 750_000 };
  assert.deepEqual(parseAnswerRuntimeConfiguration({ ...value,
    generationRates: { ...value.generationRates, "gpt-6-luna": { ...value.generationRates["gpt-6-luna"], longContext } } }, environment)
    .generationRates["gpt-6-luna"].longContext, longContext);
  const rotated = parseAnswerRuntimeConfiguration(value, { ...environment, OPENAI_API_KEY: "another-fixture-key",
    PREPARED_TRANSPORT_TOKEN: "z".repeat(40), LEGAL_ANSWER_SOURCE_TOKEN: "x".repeat(40) });
  assert.equal(parsed.sourceVersionHash, rotated.sourceVersionHash);
  const withoutSourceWorker = { ...environment, LEGAL_ANSWER_SOURCE_URL: undefined,
    LEGAL_ANSWER_SOURCE_WORKER_SHA256: undefined, LEGAL_ANSWER_SOURCE_TOKEN: undefined };
  assert.equal(parseAnswerRuntimeConfiguration(value, withoutSourceWorker).corpus.sources, undefined);
  assert.throws(() => parseAnswerRuntimeConfiguration({ ...value, receiptPath: value.ledgerPath }, environment), /FINANCIAL_PATH_CONFLICT/);
  assert.throws(() => parseAnswerRuntimeConfiguration({ ...value, historyRelease: release("current") }, environment), /RELEASE_MISMATCH/);
  assert.throws(() => parseAnswerRuntimeConfiguration(value, { ...environment, LEGAL_ANSWER_SOURCE_URL: "https://external.example" }), /CORPUS_TRANSPORT_CONFIGURATION/);
  assert.throws(() => parseAnswerRuntimeConfiguration({ ...value, generationRates: {} }, environment), /MODEL_RATES_MISSING/);
  assert.deepEqual(parsed.spendingCaps, { generation: 6_000_000, embedding: 1_000_000 });
  const qualificationCaps = { generation: 19_000_000, embedding: 1_000_000 };
  assert.deepEqual(parseAnswerRuntimeConfiguration({ ...value, spendingCaps: qualificationCaps }, environment).spendingCaps,
    qualificationCaps);
  assert.throws(() => parseAnswerRuntimeConfiguration({ ...value,
    spendingCaps: { generation: -1, embedding: 1_000_000 } }, environment), /CONFIGURATION_INVALID/);
  const production = { ...value, purpose: "production", phase: "operating",
    generationRates: { ...value.generationRates, "gpt-6.1-terra": value.generationRates["gpt-6-luna"] } };
  assert.equal(parseAnswerRuntimeConfiguration(production, environment).spendingCaps, undefined);
  const policy = { generation: 20_000_000, embedding: 5_000_000 };
  const configured = parseAnswerRuntimeConfiguration({ ...production, spendingCaps: policy }, environment);
  assert.deepEqual(configured.spendingCaps, policy);
  assert.equal(configured.phase, "operating");
  assert.deepEqual(configured.models, { fast: "gpt-6-luna", deep: "gpt-6.1-terra" });
  assert.deepEqual(parsed.models, { fast: "gpt-6-luna", deep: "gpt-6.1-terra" });
  assert.throws(() => parseAnswerRuntimeConfiguration({ ...production, spendingCaps: policy, phase: "final" }, environment), /CONFIGURATION_INVALID/);
});

test("configured Luna execution preserves an unknown prior charge and blocks dispatch before any network request", async () => {
  const directory = mkdtempSync(join(tmpdir(), "juro-configured-runtime-"));
  const value = configuration(directory), db = new DatabaseSync(value.ledgerPath);
  db.exec(`CREATE TABLE categories(id TEXT PRIMARY KEY,cap INTEGER,diagnostic INTEGER);
    CREATE TABLE operations(id TEXT PRIMARY KEY,category TEXT,phase TEXT,maximum INTEGER,charged INTEGER,state TEXT,expires REAL);
    INSERT INTO categories VALUES('generation',6000000,1200000),('embedding',1000000,200000);
    INSERT INTO operations VALUES('prior','generation','diagnostic',100,NULL,'unknown',0);`);
  db.close();
  const runtime = createConfiguredAnswerRuntime(parseAnswerRuntimeConfiguration(value, environment), {
    store: { namespace: `legal-prepared-${hash}`, get: async () => null, put: async () => { throw new Error("Unexpected write"); } },
    privateObjects: { get: async () => null },
  });
  const previousFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; throw new Error("Unexpected network call"); };
  try {
    const dependencies = runtime.dependencies("deep");
    const signal = new AbortController().signal;
    const execution = await dependencies.createExecution({ runId: "run", model: "gpt-6.1-terra", request: {
      question: "Artificial question", language: "en", format: "detailed", mode: "deep", actor: { tenantId: "w", userId: "u" },
      history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 30_000, signal,
    } });
    await assert.rejects(() => execution.model.complete({ stage: "interpret", instruction: "Fixture", input: {}, schema: {}, signal }), /PROVIDER_USAGE_UNRECONCILED/);
    assert.equal(networkCalls, 0);
    const check = new DatabaseSync(value.ledgerPath, { readOnly: true });
    try {
      assert.equal(check.prepare("SELECT count(*) AS n FROM operations").get()?.n, 1);
      assert.equal(check.prepare("SELECT charged FROM operations WHERE id='prior'").get()?.charged, null);
    } finally { check.close(); }
  } finally {
    globalThis.fetch = previousFetch;
    runtime.close();
    assert.throws(() => runtime.dependencies("deep"), /RUNTIME_CLOSED/);
    for (const file of [value.ledgerPath, value.receiptPath]) {
      for (const suffix of ["", "-wal", "-shm", "-journal"]) if (existsSync(file + suffix)) unlinkSync(file + suffix);
    }
    rmdirSync(directory);
  }
});
