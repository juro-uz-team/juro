import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import type { DependencyHealthKey } from "../lib/operations/dependency-health";
import { recordDependencyHealthEvidence } from "../worker/dependency-health-evidence";
import type { PlatformJobEnv } from "../worker/platform-jobs";
import {
  PRODUCTION_ANTHROPIC_CONNECTIVITY_TIMEOUT_MS,
  PRODUCTION_ANTHROPIC_MODEL_ACCESS_TIMEOUT_MS,
  PRODUCTION_DOCUMENT_ANALYSIS_PROVIDER_TIMEOUT_MS,
  PRODUCTION_DOCUMENT_ANALYSIS_TOTAL_TIMEOUT_MS,
  PRODUCTION_MALWARE_SCANNER_PROBE_TIMEOUT_MS,
  PRODUCTION_PROVIDER_PROBE_TIMEOUT_MS,
  documentAnalysisProbeFailureCode,
  productionDependencyProbesEnabled,
  productionDocumentAnalysisProbeOptions,
  providerDiagnosticSafeErrorCode,
  runAnthropicProductionProbe,
  runProductionDependencyProbes,
  runLocalDependencyProbes,
  safeProviderFailureReason,
} from "../worker/production-dependency-probes";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";
import {env} from "./helpers/runtime-env";
import {probeProviderContract} from "../worker/provider-contract-probe";

test("provider connectivity uses the retained structured transports and rejects invalid output without retry",async context=>{
  const oldOpenAi=env.OPENAI_API_KEY,oldAnthropic=env.ANTHROPIC_API_KEY;
  env.OPENAI_API_KEY="test-key";env.ANTHROPIC_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldOpenAi;env.ANTHROPIC_API_KEY=oldAnthropic;});
  const requests:Array<{url:string;body:Record<string,unknown>}>=[];
  let invalid=false;
  context.mock.method(globalThis,"fetch",async(url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));requests.push({url:String(url),body});
    const output={status:invalid?"wrong":"ok"};
    return String(url).includes("anthropic")?Response.json({id:"probe",model:body.model,
      content:[{type:"text",text:JSON.stringify(output)}],usage:{input_tokens:1,output_tokens:1}}):
      Response.json({id:"probe",model:body.model,output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}],usage:{input_tokens:1,output_tokens:1}});
  });
  for(const provider of ["openai","anthropic"] as const){
    assert.deepEqual(await probeProviderContract(provider,{timeoutMs:20000}),{provider,fallbackFromProvider:null,status:"ok"});
  }
  assert.equal(requests.length,2);
  assert.equal(requests[0].body.model,"gpt-5.6-terra");
  assert.equal(requests[0].body.max_output_tokens,256);
  assert.equal(requests[1].body.max_tokens,256);
  assert(!JSON.stringify(requests).includes("legalDatabaseAsOf"));
  invalid=true;
  await assert.rejects(()=>probeProviderContract("openai",{timeoutMs:20000}));
  assert.equal(requests.length,3,"Invalid output must not trigger a second paid call or fallback");
  await assert.rejects(()=>probeProviderContract("anthropic",{timeoutMs:20000}));
  assert.equal(requests.length,4,"Each provider must reject invalid output without retry");
  await assert.rejects(()=>probeProviderContract("anthropic",{timeoutMs:20000,deadlineAt:Date.now()-1}));
  assert.equal(requests.length,4,"An exhausted shared deadline must prevent another HTTP call");
});

const probedKeys = [
  "private_r2",
  "document_builder",
  "malware_scanner",
  "openai",
  "anthropic",
  "document_analysis",
  "resend",
  "lawyer_area",
] as const satisfies readonly DependencyHealthKey[];

function probeEnv(db: D1Database) {
  return {
    APP_ENV: "production",
    PRODUCTION_SYNTHETIC_PROBES_ENABLED: "true",
    DB: db,
  } as unknown as PlatformJobEnv & { PRODUCTION_SYNTHETIC_PROBES_ENABLED: string };
}

function builderBucket() {
  const objects = new Map<string, Uint8Array>();
  const bucket = {
    async delete(key: string) {
      objects.delete(key);
    },
    async put(key: string, value: Uint8Array) {
      const bytes = Uint8Array.from(value);
      objects.set(key, bytes);
      return { size: bytes.byteLength };
    },
    async head(key: string) {
      const bytes = objects.get(key);
      return bytes ? { size: bytes.byteLength } : null;
    },
    async get(key: string) {
      const bytes = objects.get(key);
      return bytes ? {
        body: null,
        async arrayBuffer() {
          return bytes.slice().buffer;
        },
      } : null;
    },
  } as unknown as R2Bucket;
  return { bucket, objects };
}

function builderAssets(requests: string[]): Fetcher {
  return {
    async fetch(request: RequestInfo | URL) {
      const url = new URL(request instanceof Request ? request.url : String(request));
      requests.push(url.href);
      const path = url.pathname.replace(/^\//u, "");
      try {
        return new Response(await readFile(new URL(`../public/${path}`, import.meta.url)));
      } catch {
        return new Response(null, { status: 404 });
      }
    },
  } as Fetcher;
}

async function seedOperational(
  env: ReturnType<typeof probeEnv>,
  excluded: readonly DependencyHealthKey[] = [],
): Promise<void> {
  const excludedKeys = new Set(excluded);
  const now = new Date();
  for (const key of probedKeys) {
    if (excludedKeys.has(key)) continue;
    await recordDependencyHealthEvidence(env, {
      key,
      state: "operational",
      evidenceKind: "synthetic_probe",
      startedAt: now.getTime() - 10,
    }, now);
  }
}

test("production dependency probes are impossible outside explicitly enabled production", () => {
  assert.equal(productionDependencyProbesEnabled({
    APP_ENV: "development",
    PRODUCTION_SYNTHETIC_PROBES_ENABLED: "true",
  }), false);
  assert.equal(productionDependencyProbesEnabled({
    APP_ENV: "staging",
    PRODUCTION_SYNTHETIC_PROBES_ENABLED: "true",
  }), false);
  assert.equal(productionDependencyProbesEnabled({
    APP_ENV: "production",
    PRODUCTION_SYNTHETIC_PROBES_ENABLED: "false",
  }), false);
  assert.equal(productionDependencyProbesEnabled({
    APP_ENV: "production",
    PRODUCTION_SYNTHETIC_PROBES_ENABLED: "true",
  }), true);
});

test("the production malware probe allows a bounded ClamAV cold start", () => {
  assert.equal(PRODUCTION_MALWARE_SCANNER_PROBE_TIMEOUT_MS, 55_000);
  assert.ok(PRODUCTION_MALWARE_SCANNER_PROBE_TIMEOUT_MS > 30_000);
  assert.ok(PRODUCTION_MALWARE_SCANNER_PROBE_TIMEOUT_MS < 60_000);
});

test("production provider probes stay bounded and isolate OpenAI from fallback", () => {
  assert.equal(PRODUCTION_PROVIDER_PROBE_TIMEOUT_MS, 20_000);
  assert.equal(PRODUCTION_ANTHROPIC_MODEL_ACCESS_TIMEOUT_MS, 3_000);
  assert.equal(PRODUCTION_ANTHROPIC_CONNECTIVITY_TIMEOUT_MS, 5_000);
  assert.ok(PRODUCTION_ANTHROPIC_MODEL_ACCESS_TIMEOUT_MS < PRODUCTION_ANTHROPIC_CONNECTIVITY_TIMEOUT_MS);
  assert.ok(PRODUCTION_ANTHROPIC_CONNECTIVITY_TIMEOUT_MS < PRODUCTION_PROVIDER_PROBE_TIMEOUT_MS);
});

test("the document-analysis feature probe reserves time for real provider fallback", () => {
  assert.equal(PRODUCTION_DOCUMENT_ANALYSIS_PROVIDER_TIMEOUT_MS, 25_000);
  assert.equal(PRODUCTION_DOCUMENT_ANALYSIS_TOTAL_TIMEOUT_MS, 55_000);
  assert.ok(PRODUCTION_DOCUMENT_ANALYSIS_PROVIDER_TIMEOUT_MS * 2 < PRODUCTION_DOCUMENT_ANALYSIS_TOTAL_TIMEOUT_MS);
  const options = productionDocumentAnalysisProbeOptions(1_000);
  assert.deepEqual(options, {
    providerTimeoutMs: 25_000,
    providerMaxAttempts: 1,
    deadlineAt: 56_000,
  });
  assert.equal("fallbackEnabled" in options, false);
});

test("document-analysis probe failures preserve only exact safe provider causes", () => {
  assert.equal(documentAnalysisProbeFailureCode(Object.assign(new Error("private response"), {
    code: "PROVIDER_UNAVAILABLE",
    providerStatus: 429,
    providerErrorType: "credit_balance_exhausted",
    documentAnalysisProbeProvider: "openai",
  })), "PROVIDER_CREDIT_BALANCE_LOW");
  assert.equal(documentAnalysisProbeFailureCode(Object.assign(new Error("private response"), {
    code: "PROVIDER_UNAVAILABLE",
    providerStatus: 400,
    providerErrorType: "invalid_request_error",
    providerFailureReason: "anthropic_workspace_spend_limit",
    documentAnalysisProbeProvider: "anthropic",
  })), "PROVIDER_SPEND_LIMIT_REACHED");
  assert.equal(documentAnalysisProbeFailureCode(Object.assign(new Error("private response"), {
    code: "INVALID_AI_OUTPUT",
    documentAnalysisProbeProvider: "anthropic",
  })), "ANALYSIS_JOB_FAILED");
  assert.equal(documentAnalysisProbeFailureCode(new Error("private response")), "ANALYSIS_JOB_FAILED");
});

test("Anthropic production probe runs model access, connectivity, then the structured-output contract", async () => {
  const calls: string[] = [];
  const result = await runAnthropicProductionProbe({
    modelAccess: async () => { calls.push("model-access"); },
    connectivity: async () => { calls.push("connectivity"); },
    structuredOutput: async () => {
      calls.push("structured-output");
      return {
        provider: "anthropic",
        fallbackFromProvider: null,
        status: "ok",
      };
    },
  });
  assert.deepEqual(calls, ["model-access", "connectivity", "structured-output"]);
  assert.deepEqual(result, {
    provider: "anthropic",
    fallbackFromProvider: null,
    status: "ok",
  });
});

test("Anthropic production probe stops at model-access failure and tags the stage", async () => {
  let connectivityCalled = false;
  let structuredOutputCalled = false;
  await assert.rejects(() => runAnthropicProductionProbe({
    modelAccess: async () => { throw new Error("private model-access detail"); },
    connectivity: async () => { connectivityCalled = true; },
    structuredOutput: async () => {
      structuredOutputCalled = true;
      throw new Error("must not run");
    },
  }), (error: unknown) => error instanceof Error
    && (error as Error & { providerProbeStage?: unknown }).providerProbeStage === "anthropic_model_access");
  assert.equal(connectivityCalled, false);
  assert.equal(structuredOutputCalled, false);
});

test("Anthropic production probe stops at connectivity failure and tags the stage", async () => {
  let structuredOutputCalled = false;
  await assert.rejects(() => runAnthropicProductionProbe({
    modelAccess: async () => undefined,
    connectivity: async () => { throw new Error("private connectivity detail"); },
    structuredOutput: async () => {
      structuredOutputCalled = true;
      throw new Error("must not run");
    },
  }), (error: unknown) => error instanceof Error
    && (error as Error & { providerProbeStage?: unknown }).providerProbeStage === "anthropic_connectivity");
  assert.equal(structuredOutputCalled, false);
});

test("Anthropic production probe tags a structured-output contract failure after connectivity succeeds", async () => {
  await assert.rejects(() => runAnthropicProductionProbe({
    modelAccess: async () => undefined,
    connectivity: async () => undefined,
    structuredOutput: async () => { throw new Error("private structured-output detail"); },
  }), (error: unknown) => error instanceof Error
    && (error as Error & { providerProbeStage?: unknown }).providerProbeStage === "anthropic_structured_output_contract");
});

test("Anthropic probe diagnostics classify only documented content-free 400 causes", () => {
  const failure = (providerFailureReason: string) => Object.assign(new Error(
    "Резервный AI-провайдер не прошёл проверку соединения.",
  ), {
    providerStatus: 400,
    providerErrorType: "invalid_request_error",
    providerFailureReason,
  });
  assert.equal(safeProviderFailureReason("anthropic", failure(
    "anthropic_workspace_spend_limit",
  )), "anthropic_workspace_spend_limit");
  assert.equal(safeProviderFailureReason("anthropic", failure(
    "anthropic_organization_spend_limit",
  )), "anthropic_organization_spend_limit");
  assert.equal(safeProviderFailureReason("anthropic", failure(
    "anthropic_workspace_header_required",
  )), "anthropic_workspace_header_required");
  assert.equal(safeProviderFailureReason("anthropic", failure(
    "anthropic_workspace_header_invalid",
  )), "anthropic_workspace_header_invalid");
  assert.equal(safeProviderFailureReason("anthropic", failure(
    "private_provider_reason_must_not_be_logged",
  )), null);
  assert.equal(safeProviderFailureReason("openai", failure(
    "You have reached your specified API usage limits.",
  )), null);
  assert.equal(safeProviderFailureReason("openai", Object.assign(new Error("safe"), {
    providerStatus: 429,
    providerErrorType: "credit_balance_exhausted",
  })), "openai_credit_balance_exhausted");
  assert.equal(safeProviderFailureReason("openai", Object.assign(new Error("safe"), {
    providerStatus: 400,
    providerErrorType: "credit_balance_exhausted",
  })), null);
  assert.equal(safeProviderFailureReason("openai", Object.assign(new Error("safe"), {
    providerStatus: 429,
    providerErrorType: "private_provider_reason_must_not_be_logged",
  })), null);
  assert.equal(safeProviderFailureReason("anthropic", Object.assign(new Error("safe"), {
    providerStatus: 429,
    providerErrorType: "rate_limit_error",
    providerFailureReason: "anthropic_enforced_spend_limit",
  })), "anthropic_enforced_spend_limit");
  assert.equal(safeProviderFailureReason("anthropic", Object.assign(new Error("safe"), {
    providerStatus: 400,
    providerErrorType: "invalid_request_error",
    providerFailureReason: "anthropic_enforced_spend_limit",
  })), null);
  assert.equal(safeProviderFailureReason("anthropic", Object.assign(new Error("safe"), {
    providerStatus: 400,
    providerErrorType: "invalid_request_error",
    providerFailureReason: "private_provider_reason_must_not_be_logged",
  })), null);
  assert.equal(providerDiagnosticSafeErrorCode("openai_credit_balance_exhausted"), "PROVIDER_CREDIT_BALANCE_LOW");
  assert.equal(providerDiagnosticSafeErrorCode("anthropic_workspace_spend_limit"), "PROVIDER_SPEND_LIMIT_REACHED");
  assert.equal(providerDiagnosticSafeErrorCode("anthropic_billing_configuration"), "PROVIDER_BILLING_CONFIGURATION");
  assert.equal(providerDiagnosticSafeErrorCode("anthropic_workspace_policy"), "PROVIDER_WORKSPACE_CONFIGURATION");
  assert.equal(providerDiagnosticSafeErrorCode("anthropic_request_model"), "PROVIDER_REQUEST_CONFIGURATION");
});

test("fresh operational evidence skips every production dependency probe", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const env = probeEnv(d1);
    await seedOperational(env);
    const unexpected = async () => {
      throw new Error("A fresh probe must not call a provider.");
    };
    assert.deepEqual(await runProductionDependencyProbes(env, {
      openai: unexpected,
      anthropic: unexpected,
      documentAnalysis: unexpected,
      fetchImpl: unexpected as unknown as typeof fetch,
    }), {
      privateR2: "skipped",
      documentBuilder: "skipped",
      malwareScanner: "skipped",
      openai: "skipped",
      anthropic: "skipped",
      documentAnalysis: "skipped",
      resend: "skipped",
      lawyerArea: "skipped",
    });
  } finally {
    sqlite.close();
  }
});

test("fresh degraded evidence also respects each production probe cooldown", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const env = probeEnv(d1);
    await seedOperational(env, ["openai", "anthropic", "document_analysis"]);
    const now = new Date();
    for (const key of ["openai", "anthropic", "document_analysis"] as const) {
      await recordDependencyHealthEvidence(env, {
        key,
        state: "degraded",
        safeErrorCode: key === "document_analysis" ? "ANALYSIS_JOB_FAILED" : "PROVIDER_UNAVAILABLE",
        evidenceKind: "synthetic_probe",
        startedAt: now.getTime() - 10,
      }, now);
    }
    let providerCalls = 0;
    const unexpected = async () => {
      providerCalls += 1;
      throw new Error("A fresh failure must stay inside its configured cooldown.");
    };
    const summary = await runProductionDependencyProbes(env, {
      openai: unexpected,
      anthropic: unexpected,
      documentAnalysis: unexpected,
    });
    assert.equal(summary?.openai, "skipped");
    assert.equal(summary?.anthropic, "skipped");
    assert.equal(summary?.documentAnalysis, "skipped");
    assert.equal(providerCalls, 0);
  } finally {
    sqlite.close();
  }
});

test("document-analysis probe persists a safe provider diagnostic without upstream text", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const originalConsoleError = console.error;
  const errors: string[] = [];
  console.error = (...values: unknown[]) => { errors.push(values.join(" ")); };
  try {
    const env = probeEnv(d1);
    await seedOperational(env, ["document_analysis"]);
    const summary = await runProductionDependencyProbes(env, {
      documentAnalysis: async () => {
        throw Object.assign(new Error("private upstream billing response"), {
          code: "PROVIDER_UNAVAILABLE",
          providerStatus: 429,
          providerErrorType: "credit_balance_exhausted",
          documentAnalysisProbeProvider: "openai",
        });
      },
    });
    assert.equal(summary?.documentAnalysis, "failed");
    assert.equal(errors.length, 1);
    assert.equal(errors[0].includes("private upstream billing response"), false);
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,safe_error_code AS safeErrorCode
      FROM dependency_health_checks WHERE dependency_key='document_analysis'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as object) }, {
      state: "degraded",
      safeErrorCode: "PROVIDER_CREDIT_BALANCE_LOW",
    });
  } finally {
    console.error = originalConsoleError;
    sqlite.close();
  }
});

test("provider probes publish operational evidence only for exact non-fallback results", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const env = probeEnv(d1);
    await seedOperational(env, ["openai", "anthropic"]);
    const summary = await runProductionDependencyProbes(env, {
      openai: async () => ({
        provider: "openai",
        fallbackFromProvider: null,
        status: "ok",
      }),
      anthropic: async () => ({
        provider: "anthropic",
        fallbackFromProvider: null,
        status: "ok",
      }),
    });
    assert.equal(summary?.openai, "succeeded");
    assert.equal(summary?.anthropic, "succeeded");
    const rows = sqlite.prepare(`SELECT dependency_key AS dependencyKey,state,evidence_kind AS evidenceKind
      FROM dependency_health_checks
      WHERE dependency_key IN ('openai','anthropic')
      ORDER BY dependency_key`).all() as Array<{
        dependencyKey: string;
        state: string;
        evidenceKind: string;
      }>;
    assert.deepEqual(rows.map((row) => ({ ...row })), [
      { dependencyKey: "anthropic", state: "operational", evidenceKind: "synthetic_probe" },
      { dependencyKey: "openai", state: "operational", evidenceKind: "synthetic_probe" },
    ]);
  } finally {
    sqlite.close();
  }
});

test("provider probe failures log only bounded diagnostic fields", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const originalConsoleError = console.error;
  const errors: string[] = [];
  console.error = (...values: unknown[]) => { errors.push(values.join(" ")); };
  try {
    const env = probeEnv(d1);
    await seedOperational(env, ["openai"]);
    const failure = Object.assign(new Error("raw provider message must stay private"), {
      code: "PROVIDER_TIMEOUT",
      providerStatus: 429,
      providerErrorType: "first_byte_timeout",
      providerRequestId: "untrusted request id with spaces",
    });
    const summary = await runProductionDependencyProbes(env, {
      openai: async () => { throw failure; },
    });
    assert.equal(summary?.openai, "failed");
    assert.equal(errors.length, 1);
    const log = JSON.parse(errors[0]) as Record<string, unknown>;
    assert.deepEqual({ ...log, elapsedMs: 0 }, {
      event: "production_dependency_probe.provider_failed",
      provider: "openai",
      safeCode: "PROVIDER_TIMEOUT",
      errorName: "Error",
      providerStatus: 429,
      providerErrorType: "first_byte_timeout",
      providerRequestId: null,
      providerProbeStage: null,
      providerFailureReason: null,
      elapsedMs: 0,
    });
    assert.equal(errors[0].includes("raw provider message"), false);
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,safe_error_code AS safeErrorCode
      FROM dependency_health_checks WHERE dependency_key='openai'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as object) }, {
      state: "degraded",
      safeErrorCode: "PROVIDER_TIMEOUT",
    });
  } finally {
    console.error = originalConsoleError;
    sqlite.close();
  }
});

test("Anthropic probe logs a fixed spend-limit reason without the upstream message", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const originalConsoleError = console.error;
  const errors: string[] = [];
  console.error = (...values: unknown[]) => { errors.push(values.join(" ")); };
  try {
    const env = probeEnv(d1);
    await seedOperational(env, ["anthropic"]);
    const failure = Object.assign(new Error(
      "Резервный AI-провайдер не прошёл проверку соединения.",
    ), {
      code: "PROVIDER_UNAVAILABLE",
      providerStatus: 400,
      providerErrorType: "invalid_request_error",
      providerRequestId: "req_anthropicprobe1234",
      providerProbeStage: "anthropic_connectivity",
      providerFailureReason: "anthropic_workspace_spend_limit",
    });
    const summary = await runProductionDependencyProbes(env, {
      anthropic: async () => { throw failure; },
    });
    assert.equal(summary?.anthropic, "failed");
    assert.equal(errors.length, 1);
    const log = JSON.parse(errors[0]) as Record<string, unknown>;
    assert.deepEqual({ ...log, elapsedMs: 0 }, {
      event: "production_dependency_probe.provider_failed",
      provider: "anthropic",
      safeCode: "PROVIDER_UNAVAILABLE",
      errorName: "Error",
      providerStatus: 400,
      providerErrorType: "invalid_request_error",
      providerRequestId: "req_anthropicprobe1234",
      providerProbeStage: "anthropic_connectivity",
      providerFailureReason: "anthropic_workspace_spend_limit",
      elapsedMs: 0,
    });
    assert.equal(errors[0].includes("private-upstream-marker"), false);
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,safe_error_code AS safeErrorCode
      FROM dependency_health_checks WHERE dependency_key='anthropic'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as object) }, {
      state: "degraded",
      safeErrorCode: "PROVIDER_SPEND_LIMIT_REACHED",
    });
  } finally {
    console.error = originalConsoleError;
    sqlite.close();
  }
});

test("OpenAI probe persists only the fixed low-credit diagnostic for an exact 429 code", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const originalConsoleError = console.error;
  const errors: string[] = [];
  console.error = (...values: unknown[]) => { errors.push(values.join(" ")); };
  try {
    const env = probeEnv(d1);
    await seedOperational(env, ["openai"]);
    const failure = Object.assign(new Error("private provider response"), {
      code: "PROVIDER_UNAVAILABLE",
      providerStatus: 429,
      providerErrorType: "credit_balance_exhausted",
    });
    const summary = await runProductionDependencyProbes(env, {
      openai: async () => { throw failure; },
    });
    assert.equal(summary?.openai, "failed");
    const log = JSON.parse(errors[0]) as Record<string, unknown>;
    assert.equal(log.providerFailureReason, "openai_credit_balance_exhausted");
    assert.equal(errors[0].includes("private provider response"), false);
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,safe_error_code AS safeErrorCode
      FROM dependency_health_checks WHERE dependency_key='openai'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as object) }, {
      state: "degraded",
      safeErrorCode: "PROVIDER_CREDIT_BALANCE_LOW",
    });
  } finally {
    console.error = originalConsoleError;
    sqlite.close();
  }
});

test("the Builder probe uses the binding-local asset origin and removes its R2 archive", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const { bucket, objects } = builderBucket();
  const assetRequests: string[] = [];
  try {
    const env = {
      ...probeEnv(d1),
      ASSETS: builderAssets(assetRequests),
      BUCKET: bucket,
    };
    await seedOperational(env, ["document_builder"]);
    const summary = await runProductionDependencyProbes(env);
    assert.equal(summary?.documentBuilder, "succeeded");
    assert.equal(objects.size, 0);
    assert.equal(assetRequests.length, 4);
    assert.ok(assetRequests.every((request) => new URL(request).origin === "https://juro-assets.invalid"));
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,safe_error_code AS safeErrorCode
      FROM dependency_health_checks WHERE dependency_key='document_builder'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as object) }, {
      state: "operational",
      safeErrorCode: null,
    });
  } finally {
    sqlite.close();
  }
});

test("the Builder probe records a content-free DOCX-stage failure for an invalid template", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const { bucket } = builderBucket();
  try {
    const env = {
      ...probeEnv(d1),
      ASSETS: {
        async fetch() {
          return new Response(Uint8Array.of(0));
        },
      } as unknown as Fetcher,
      BUCKET: bucket,
    };
    await seedOperational(env, ["document_builder"]);
    const originalConsoleError = console.error;
    const errors: string[] = [];
    console.error = (...values: unknown[]) => { errors.push(values.join(" ")); };
    let summary;
    try {
      summary = await runProductionDependencyProbes(env);
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(summary?.documentBuilder, "failed");
    assert.deepEqual(JSON.parse(errors[0]), {
      event: "production_dependency_probe.builder_failed",
      stage: "docx",
      errorName: "Error",
      reason: "End of data reached (data length = 1, asked index = 4). Corrupted zip ?",
    });
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,safe_error_code AS safeErrorCode
      FROM dependency_health_checks WHERE dependency_key='document_builder'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as object) }, {
      state: "degraded",
      safeErrorCode: "BUILDER_DOCX_FAILED",
    });
  } finally {
    sqlite.close();
  }
});

test("the lawyer-area probe exercises and atomically removes its synthetic access grant", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    const env = probeEnv(d1);
    await seedOperational(env, ["lawyer_area"]);
    const summary = await runProductionDependencyProbes(env);
    assert.equal(summary?.lawyerArea, "succeeded");
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS count FROM lawyer_access_grants
      WHERE id LIKE 'production-health-lawyer-v1-%'`).get() as { count: number }).count, 0);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS count FROM user_profiles
      WHERE id LIKE 'production-health-lawyer-v1-%'`).get() as { count: number }).count, 0);
    assert.deepEqual({ ...(sqlite.prepare(`SELECT state,evidence_kind AS evidenceKind
      FROM dependency_health_checks WHERE dependency_key='lawyer_area'
      ORDER BY checked_at DESC,id DESC LIMIT 1`).get() as object) }, {
      state: "operational",
      evidenceKind: "synthetic_probe",
    });
  } finally {
    sqlite.close();
  }
});

test("local dependency checks refresh native storage and builder without calling paid providers or sending mail", async context => {
  const { sqlite, d1 } = sqliteD1Fixture();
  context.after(() => sqlite.close());
  context.mock.method(globalThis, "fetch", async () => { assert.fail("Local probes must not call external services"); });
  const { bucket, objects } = builderBucket();
  const env = { ...probeEnv(d1), APP_ENV: "staging" as const, PRODUCTION_SYNTHETIC_PROBES_ENABLED: "false",
    BUCKET: bucket, QUARANTINE_BUCKET: bucket, ASSETS: builderAssets([]),
  };
  const summary = await runLocalDependencyProbes(env);
  assert.equal(summary.privateR2, "succeeded");
  assert.equal(summary.documentBuilder, "succeeded");
  assert.equal(summary.lawyerArea, "succeeded");
  assert.equal(summary.malwareScanner, "failed", "Missing scanner must not be reported healthy");
  assert.equal(objects.size, 0);
  const keys = sqlite.prepare("SELECT DISTINCT dependency_key AS key FROM dependency_health_checks ORDER BY key").all();
  assert.deepEqual(keys.map(row => (row as {key:string}).key), ["document_builder", "lawyer_area", "malware_scanner", "private_r2"]);
  assert.equal((await runLocalDependencyProbes(env)).privateR2, "skipped", "Bound ledger and probe frequency");
});
