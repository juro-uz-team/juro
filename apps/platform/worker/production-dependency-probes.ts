import { z } from "zod";
import {probeProviderContract} from "./provider-contract-probe";
import { createDefaultAnswers } from "../lib/document-builder/defaults";
import { generateDocx } from "../lib/document-builder/generation/docx";
import { generatePdf } from "../lib/document-builder/generation/pdf";
import { generateZip } from "../lib/document-builder/generation/zip";
import { renderReceipt } from "../lib/document-builder/templates/receipt";
import type {
  DependencyHealthKey,
  DependencyHealthSafeErrorCode,
} from "../lib/operations/dependency-health";
import { malwareScannerResponseSchema } from "../lib/document-analysis/malware-scanner";
import type { PlatformJobEnv } from "./platform-jobs";
import {
  providerFailureEvidence,
  recordDependencyHealthEvidence,
} from "./dependency-health-evidence";
import type { ProviderDiagnosticSafeErrorCode } from "./dependency-health-evidence";

const R2_PROBE_INTERVAL_MS = 8 * 60_000;
const MALWARE_PROBE_INTERVAL_MS = 10 * 60_000;
const PROVIDER_PROBE_INTERVAL_MS = 10 * 60_000;
const BUILDER_PROBE_INTERVAL_MS = 20 * 60_000;
const DOCUMENT_ANALYSIS_PROBE_INTERVAL_MS = 25 * 60_000;
const LAWYER_AREA_PROBE_INTERVAL_MS = 25 * 60_000;
const EMAIL_PROBE_INTERVAL_MS = 23 * 60 * 60_000;
const MAX_PROVIDER_RESPONSE_BYTES = 4_096;
export const PRODUCTION_MALWARE_SCANNER_PROBE_TIMEOUT_MS = 55_000;
export const PRODUCTION_PROVIDER_PROBE_TIMEOUT_MS = 20_000;
export const PRODUCTION_ANTHROPIC_MODEL_ACCESS_TIMEOUT_MS = 3_000;
export const PRODUCTION_ANTHROPIC_CONNECTIVITY_TIMEOUT_MS = 5_000;
export const PRODUCTION_DOCUMENT_ANALYSIS_PROVIDER_TIMEOUT_MS = 25_000;
export const PRODUCTION_DOCUMENT_ANALYSIS_TOTAL_TIMEOUT_MS = 55_000;

const r2Payload = new TextEncoder().encode(
  "JURO production private R2 synthetic dependency probe v1\n",
);
const eicarBytes = new TextEncoder().encode(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
);

const resendResponseSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,180}$/u),
}).passthrough();

type ProbeOutcome = "succeeded" | "failed" | "skipped";

export type ProductionDependencyProbeSummary = {
  privateR2: ProbeOutcome;
  documentBuilder: ProbeOutcome;
  malwareScanner: ProbeOutcome;
  openai: ProbeOutcome;
  anthropic: ProbeOutcome;
  documentAnalysis: ProbeOutcome;
  resend: ProbeOutcome;
  lawyerArea: ProbeOutcome;
};

export type ProviderProbeResult = {
  provider: "openai" | "anthropic";
  fallbackFromProvider: "openai" | "anthropic" | null;
  status: string;
};

export type AnthropicProductionProbeStage =
  | "anthropic_model_access"
  | "anthropic_connectivity"
  | "anthropic_legal_chat_contract"
  | "anthropic_structured_output_contract";

export type ProductionDependencyProbeHooks = {
  fetchImpl?: typeof fetch;
  openai?: () => Promise<ProviderProbeResult>;
  anthropic?: () => Promise<ProviderProbeResult>;
  documentAnalysis?: () => Promise<void>;
};

export function productionDependencyProbesEnabled(
  env: Pick<PlatformJobEnv, "APP_ENV"> & { PRODUCTION_SYNTHETIC_PROBES_ENABLED?: string },
): boolean {
  return env.APP_ENV === "production"
    && env.PRODUCTION_SYNTHETIC_PROBES_ENABLED === "true";
}

async function probeDue(
  env: Pick<PlatformJobEnv, "DB" | "APP_ENV">,
  key: DependencyHealthKey,
  intervalMs: number,
  now = new Date(),
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT checked_at AS checkedAt
       FROM dependency_health_checks
      WHERE environment=? AND dependency_key=?
      ORDER BY checked_at DESC,id DESC
      LIMIT 1`,
  ).bind(env.APP_ENV, key).first<{ checkedAt: string }>();
  if (!row) return true;
  // A failure is still a completed observation. Ignoring its timestamp makes
  // every degraded dependency run on the five-minute scheduler heartbeat,
  // bypassing the per-probe cost and ledger-growth intervals above.
  const checkedAt = Date.parse(row.checkedAt);
  return !Number.isFinite(checkedAt) || now.getTime() - checkedAt >= intervalMs;
}

async function recordOperational(
  env: PlatformJobEnv,
  key: DependencyHealthKey,
  startedAt: number,
): Promise<void> {
  await recordDependencyHealthEvidence(env, {
    key,
    state: "operational",
    evidenceKind: "synthetic_probe",
    startedAt,
  });
}

async function recordFailure(
  env: PlatformJobEnv,
  key: DependencyHealthKey,
  safeErrorCode: DependencyHealthSafeErrorCode,
  startedAt: number,
): Promise<void> {
  await recordDependencyHealthEvidence(env, {
    key,
    state: "degraded",
    safeErrorCode,
    evidenceKind: "synthetic_probe",
    startedAt,
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  return left.every((byte, index) => byte === right[index]);
}

async function roundTripR2(
  bucket: R2Bucket,
  objectKey: string,
  payload: Uint8Array,
): Promise<void> {
  await bucket.delete(objectKey).catch(() => undefined);
  try {
    const stored = await bucket.put(objectKey, payload, {
      sha256: await sha256(payload),
      httpMetadata: {
        contentType: "application/octet-stream",
        cacheControl: "private, no-store",
      },
      customMetadata: {
        purpose: "production-dependency-probe",
        synthetic: "true",
      },
    });
    if (!stored || stored.size !== payload.byteLength) {
      throw new Error("R2_PROBE_WRITE_INVALID");
    }
    const head = await bucket.head(objectKey);
    if (!head || head.size !== payload.byteLength) {
      throw new Error("R2_PROBE_HEAD_INVALID");
    }
    const object = await bucket.get(objectKey);
    if (!object || !("body" in object)) throw new Error("R2_PROBE_READ_MISSING");
    const received = new Uint8Array(await object.arrayBuffer());
    if (!equalBytes(received, payload)) throw new Error("R2_PROBE_READ_INVALID");
  } finally {
    await bucket.delete(objectKey).catch(() => undefined);
  }
}

async function runPrivateR2Probe(env: PlatformJobEnv): Promise<ProbeOutcome> {
  if (!(await probeDue(env, "private_r2", R2_PROBE_INTERVAL_MS))) return "skipped";
  const startedAt = Date.now();
  try {
    await Promise.all([
      roundTripR2(env.BUCKET, "system/probes/production-private-r2-v1.bin", r2Payload),
      roundTripR2(env.QUARANTINE_BUCKET, "system/probes/production-quarantine-r2-v1.bin", r2Payload),
    ]);
    await recordOperational(env, "private_r2", startedAt);
    return "succeeded";
  } catch {
    await recordFailure(env, "private_r2", "DEPENDENCY_UNAVAILABLE", startedAt);
    return "failed";
  }
}

async function fetchAsset(env: PlatformJobEnv, path: string): Promise<ArrayBuffer> {
  if (!env.ASSETS) throw new Error("BUILDER_ASSET_BINDING_UNAVAILABLE");
  // Queue exporters already use a deliberately non-public origin for direct
  // ASSETS binding reads. Reuse that boundary here: a production custom-domain
  // URL can re-enter Worker routing from a scheduled event instead of resolving
  // as a binding-local asset lookup.
  const response = await env.ASSETS.fetch(new Request(`https://juro-assets.invalid${path}`, {
    headers: { accept: "*/*" },
  }));
  if (!response.ok) throw new Error("BUILDER_ASSET_UNAVAILABLE");
  return response.arrayBuffer();
}

type BuilderProbeStage = "asset" | "defaults" | "render" | "docx" | "pdf" | "archive" | "validation" | "storage";

function builderFailureCode(stage: BuilderProbeStage): DependencyHealthSafeErrorCode {
  if (stage === "asset") return "BUILDER_ASSET_UNAVAILABLE";
  if (stage === "defaults") return "BUILDER_DEFAULTS_FAILED";
  if (stage === "render") return "BUILDER_RENDER_FAILED";
  if (stage === "docx") return "BUILDER_DOCX_FAILED";
  if (stage === "pdf") return "BUILDER_PDF_FAILED";
  if (stage === "archive") return "BUILDER_ARCHIVE_FAILED";
  if (stage === "validation") return "BUILDER_OUTPUT_INVALID";
  return "BUILDER_STORAGE_FAILED";
}

function logSyntheticBuilderFailure(stage: BuilderProbeStage, error: unknown): void {
  const errorName = error instanceof Error && /^(?:Error|RangeError|TypeError)$/u.test(error.name)
    ? error.name
    : "UnknownError";
  const reason = error instanceof Error
    ? error.message
      .replace(/[^\x20-\x7e]/gu, "?")
      .replace(/(?:[A-Za-z]:\\|\/)[^\s]+/gu, "[path]")
      .slice(0, 160)
    : "unavailable";
  // This path operates only on the fixed synthetic fixture below. Keep the
  // one-line diagnostic bounded and path-free; never emit answers, assets,
  // stack traces, object keys, credentials, or provider output.
  console.error(JSON.stringify({
    event: "production_dependency_probe.builder_failed",
    stage,
    errorName,
    reason,
  }));
}

async function runDocumentBuilderProbe(env: PlatformJobEnv): Promise<ProbeOutcome> {
  if (!(await probeDue(env, "document_builder", BUILDER_PROBE_INTERVAL_MS))) return "skipped";
  const startedAt = Date.now();
  const objectKey = "system/probes/production-document-builder-v1.zip";
  let stage: BuilderProbeStage = "asset";
  try {
    const [template, regularFont, boldFont, footerMark] = await Promise.all([
      fetchAsset(env, "/document-templates/receipt-ru.docx"),
      fetchAsset(env, "/document-templates/DejaVuSans-JURO.ttf"),
      fetchAsset(env, "/document-templates/DejaVuSans-Bold-JURO.ttf"),
      fetchAsset(env, "/document-templates/juro-mark-footer.png"),
    ]);
    stage = "defaults";
    const answers = createDefaultAnswers("ru", "2026-01-01");
    stage = "render";
    const paragraphs = renderReceipt(answers).paragraphs;
    stage = "docx";
    const docx = generateDocx(template, paragraphs);
    stage = "pdf";
    const pdf = await generatePdf(paragraphs, regularFont, boldFont, footerMark);
    stage = "archive";
    const zip = generateZip([
      { name: "juro-production-probe.docx", bytes: docx },
      { name: "juro-production-probe.pdf", bytes: pdf },
    ]);
    stage = "validation";
    if (docx[0] !== 0x50 || docx[1] !== 0x4b || pdf[0] !== 0x25 || pdf[1] !== 0x50
      || zip[0] !== 0x50 || zip[1] !== 0x4b) {
      throw new Error("BUILDER_OUTPUT_INVALID");
    }
    stage = "storage";
    await roundTripR2(env.BUCKET, objectKey, zip);
    await recordOperational(env, "document_builder", startedAt);
    await recordOperational(env, "private_r2", startedAt);
    return "succeeded";
  } catch (error) {
    logSyntheticBuilderFailure(stage, error);
    await recordFailure(env, "document_builder", builderFailureCode(stage), startedAt);
    return "failed";
  }
}


function safeProviderCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Z0-9_]{3,64}$/u.test(code)) return code;
  }
  return "PROVIDER_UNAVAILABLE";
}

export type SafeProviderFailureReason =
  | "openai_credit_balance_exhausted"
  | "anthropic_organization_spend_limit"
  | "anthropic_workspace_spend_limit"
  | "anthropic_workspace_header_required"
  | "anthropic_workspace_header_invalid"
  | "anthropic_enforced_spend_limit"
  | "anthropic_credit_balance_low"
  | "anthropic_billing_configuration"
  | "anthropic_workspace_policy"
  | "anthropic_organization_policy"
  | "anthropic_request_model"
  | "anthropic_request_max_tokens"
  | "anthropic_request_messages"
  | null;

export function safeProviderFailureReason(
  provider: "openai" | "anthropic",
  error: unknown,
): SafeProviderFailureReason {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & {
    providerStatus?: unknown;
    providerErrorType?: unknown;
    providerFailureReason?: unknown;
  };
  if (provider === "openai") {
    return candidate.providerStatus === 429
      && candidate.providerErrorType === "credit_balance_exhausted"
      ? "openai_credit_balance_exhausted"
      : null;
  }
  const safeReasons = new Set<Exclude<SafeProviderFailureReason, null>>([
    "anthropic_organization_spend_limit",
    "anthropic_workspace_spend_limit",
    "anthropic_workspace_header_required",
    "anthropic_workspace_header_invalid",
    "anthropic_enforced_spend_limit",
    "anthropic_credit_balance_low",
    "anthropic_billing_configuration",
    "anthropic_workspace_policy",
    "anthropic_organization_policy",
    "anthropic_request_model",
    "anthropic_request_max_tokens",
    "anthropic_request_messages",
  ]);
  if (typeof candidate.providerFailureReason !== "string"
      || !safeReasons.has(candidate.providerFailureReason as Exclude<SafeProviderFailureReason, null>)) {
    return null;
  }
  if (candidate.providerFailureReason === "anthropic_enforced_spend_limit") {
    return candidate.providerStatus === 429 && candidate.providerErrorType === "rate_limit_error"
      ? candidate.providerFailureReason
      : null;
  }
  if (candidate.providerFailureReason === "anthropic_billing_configuration"
      && candidate.providerStatus === 402 && candidate.providerErrorType === "billing_error") {
    return candidate.providerFailureReason;
  }
  return candidate.providerStatus === 400 && candidate.providerErrorType === "invalid_request_error"
    ? candidate.providerFailureReason as Exclude<SafeProviderFailureReason, null>
    : null;
}

export function providerDiagnosticSafeErrorCode(
  reason: SafeProviderFailureReason,
): ProviderDiagnosticSafeErrorCode | null {
  if (reason === "openai_credit_balance_exhausted" || reason === "anthropic_credit_balance_low") {
    return "PROVIDER_CREDIT_BALANCE_LOW";
  }
  if (
    reason === "anthropic_organization_spend_limit"
    || reason === "anthropic_workspace_spend_limit"
    || reason === "anthropic_enforced_spend_limit"
  ) {
    return "PROVIDER_SPEND_LIMIT_REACHED";
  }
  if (reason === "anthropic_billing_configuration") {
    return "PROVIDER_BILLING_CONFIGURATION";
  }
  if (
    reason === "anthropic_workspace_header_required"
    || reason === "anthropic_workspace_header_invalid"
    || reason === "anthropic_workspace_policy"
    || reason === "anthropic_organization_policy"
  ) {
    return "PROVIDER_WORKSPACE_CONFIGURATION";
  }
  if (
    reason === "anthropic_request_model"
    || reason === "anthropic_request_max_tokens"
    || reason === "anthropic_request_messages"
  ) {
    return "PROVIDER_REQUEST_CONFIGURATION";
  }
  return null;
}

function safeProviderFailureDetails(error: unknown): {
  errorName: string;
  providerStatus: number | null;
  providerErrorType: string | null;
  providerRequestId: string | null;
  providerProbeStage: AnthropicProductionProbeStage | null;
} {
  if (typeof error !== "object" || error === null) {
    return {
      errorName: "UnknownError",
      providerStatus: null,
      providerErrorType: null,
      providerRequestId: null,
      providerProbeStage: null,
    };
  }
  const candidate = error as {
    name?: unknown;
    providerStatus?: unknown;
    providerErrorType?: unknown;
    providerRequestId?: unknown;
    providerProbeStage?: unknown;
  };
  const errorName = typeof candidate.name === "string"
    && /^[A-Za-z][A-Za-z0-9]{0,63}$/u.test(candidate.name)
    ? candidate.name
    : "UnknownError";
  const providerStatus = typeof candidate.providerStatus === "number"
    && Number.isInteger(candidate.providerStatus)
    && candidate.providerStatus >= 400
    && candidate.providerStatus <= 599
    ? candidate.providerStatus
    : null;
  const providerErrorType = typeof candidate.providerErrorType === "string"
    && /^[A-Za-z0-9_-]{1,96}$/u.test(candidate.providerErrorType)
    ? candidate.providerErrorType
    : null;
  // Anthropic documents `request-id` as the support correlation identifier.
  // Keep only its bounded opaque form; never persist or log the response body.
  const providerRequestId = typeof candidate.providerRequestId === "string"
    && /^req_[A-Za-z0-9]{8,128}$/u.test(candidate.providerRequestId)
    ? candidate.providerRequestId
    : null;
  const providerProbeStage = candidate.providerProbeStage === "anthropic_model_access"
    || candidate.providerProbeStage === "anthropic_connectivity"
    || candidate.providerProbeStage === "anthropic_legal_chat_contract"
    || candidate.providerProbeStage === "anthropic_structured_output_contract"
    ? candidate.providerProbeStage
    : null;
  return { errorName, providerStatus, providerErrorType, providerRequestId, providerProbeStage };
}

async function defaultOpenAiProbe(): Promise<ProviderProbeResult> {
  return probeProviderContract("openai",{timeoutMs:PRODUCTION_PROVIDER_PROBE_TIMEOUT_MS});
}

function withAnthropicProbeStage(
  error: unknown,
  providerProbeStage: AnthropicProductionProbeStage,
): Error & { providerProbeStage: AnthropicProductionProbeStage } {
  if (error instanceof Error) return Object.assign(error, { providerProbeStage });
  return Object.assign(new Error("PROVIDER_UNAVAILABLE"), {
    code: "PROVIDER_UNAVAILABLE",
    providerProbeStage,
  });
}

export async function runAnthropicProductionProbe(hooks: {
  modelAccess?: () => Promise<void>;
  connectivity?: () => Promise<void>;
  structuredOutput?: () => Promise<ProviderProbeResult>;
} = {}): Promise<ProviderProbeResult> {
  const deadlineAt = Date.now() + PRODUCTION_PROVIDER_PROBE_TIMEOUT_MS;
  try {
    if (hooks.modelAccess) {
      await hooks.modelAccess();
    } else {
      const { probeAnthropicModelAccess } = await import("../lib/document-builder/ai/anthropic");
      await probeAnthropicModelAccess({
        timeoutMs: Math.max(1, Math.min(
          PRODUCTION_ANTHROPIC_MODEL_ACCESS_TIMEOUT_MS,
          deadlineAt - Date.now(),
        )),
        deadlineAt,
      });
    }
  } catch (error) {
    throw withAnthropicProbeStage(error, "anthropic_model_access");
  }

  try {
    if (hooks.connectivity) {
      await hooks.connectivity();
    } else {
      const { probeAnthropicConnectivity } = await import("../lib/document-builder/ai/anthropic");
      await probeAnthropicConnectivity({
        timeoutMs: Math.max(1, Math.min(
          PRODUCTION_ANTHROPIC_CONNECTIVITY_TIMEOUT_MS,
          deadlineAt - Date.now(),
        )),
        deadlineAt,
      });
    }
  } catch (error) {
    throw withAnthropicProbeStage(error, "anthropic_connectivity");
  }

  try {
    if (hooks.structuredOutput) return await hooks.structuredOutput();
    return await probeProviderContract("anthropic",{
      timeoutMs:Math.max(1,deadlineAt-Date.now()),deadlineAt,
    });
  } catch (error) {
    throw withAnthropicProbeStage(error, "anthropic_structured_output_contract");
  }
}

async function runOneProviderProbe(
  env: PlatformJobEnv,
  provider: "openai" | "anthropic",
  hook: (() => Promise<ProviderProbeResult>) | undefined,
): Promise<ProbeOutcome> {
  if (!(await probeDue(env, provider, PROVIDER_PROBE_INTERVAL_MS))) return "skipped";
  const startedAt = Date.now();
  try {
    const result = await (hook ?? (provider === "openai" ? defaultOpenAiProbe : runAnthropicProductionProbe))();
    if (result.provider !== provider || result.fallbackFromProvider !== null
      || result.status !== "ok") {
      throw Object.assign(new Error("PROVIDER_PROBE_BOUNDARY_FAILED"), { code: "PROVIDER_UNAVAILABLE" });
    }
    await recordOperational(env, provider, startedAt);
    return "succeeded";
  } catch (error) {
    const safeCode = safeProviderCode(error);
    const providerFailureReason = safeProviderFailureReason(provider, error);
    console.error(JSON.stringify({
      event: "production_dependency_probe.provider_failed",
      provider,
      safeCode,
      ...safeProviderFailureDetails(error),
      providerFailureReason,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    }));
    await recordDependencyHealthEvidence(env, {
      ...providerFailureEvidence(provider, safeCode, providerDiagnosticSafeErrorCode(providerFailureReason)),
      evidenceKind: "synthetic_probe",
      startedAt,
    });
    return "failed";
  }
}

export function productionDocumentAnalysisProbeOptions(now = Date.now()) {
  return {
    providerTimeoutMs: PRODUCTION_DOCUMENT_ANALYSIS_PROVIDER_TIMEOUT_MS,
    providerMaxAttempts: 1,
    deadlineAt: now + PRODUCTION_DOCUMENT_ANALYSIS_TOTAL_TIMEOUT_MS,
  } as const;
}

type DocumentAnalysisProbeProvider = "openai" | "anthropic";

function withDocumentAnalysisProbeProvider(
  error: unknown,
  provider: DocumentAnalysisProbeProvider | null,
): Error & { documentAnalysisProbeProvider: DocumentAnalysisProbeProvider | null } {
  if (error instanceof Error) return Object.assign(error, { documentAnalysisProbeProvider: provider });
  return Object.assign(new Error("DOCUMENT_ANALYSIS_PROBE_FAILED"), {
    code: "ANALYSIS_JOB_FAILED",
    documentAnalysisProbeProvider: provider,
  });
}

function documentAnalysisProbeProvider(error: unknown): DocumentAnalysisProbeProvider | null {
  if (typeof error !== "object" || error === null || !("documentAnalysisProbeProvider" in error)) return null;
  const provider = (error as { documentAnalysisProbeProvider?: unknown }).documentAnalysisProbeProvider;
  return provider === "openai" || provider === "anthropic" ? provider : null;
}

export function documentAnalysisProbeFailureCode(error: unknown): DependencyHealthSafeErrorCode {
  const provider = documentAnalysisProbeProvider(error);
  const safeCode = safeProviderCode(error);
  if (!provider) return "ANALYSIS_JOB_FAILED";
  const diagnosticCode = providerDiagnosticSafeErrorCode(safeProviderFailureReason(provider, error));
  if (diagnosticCode) return diagnosticCode;
  if (safeCode === "PROBE_CONFIGURATION_ERROR") return "PROBE_CONFIGURATION_ERROR";
  if (safeCode === "PROVIDER_TIMEOUT") return "PROVIDER_TIMEOUT";
  if (
    safeCode === "PROVIDER_UNAVAILABLE"
    || safeCode === "PROVIDER_CIRCUIT_OPEN"
    || safeCode === "ANTHROPIC_PREFLIGHT_FAILED"
    || safeCode === "ANTHROPIC_REQUEST_FAILED"
  ) {
    return "PROVIDER_UNAVAILABLE";
  }
  return "ANALYSIS_JOB_FAILED";
}

function logDocumentAnalysisProbeFailure(
  error: unknown,
  safeErrorCode: DependencyHealthSafeErrorCode,
  startedAt: number,
): void {
  const provider = documentAnalysisProbeProvider(error);
  console.error(JSON.stringify({
    event: "production_dependency_probe.document_analysis_failed",
    provider,
    safeCode: safeProviderCode(error),
    safeErrorCode,
    ...safeProviderFailureDetails(error),
    providerFailureReason: provider ? safeProviderFailureReason(provider, error) : null,
    elapsedMs: Math.max(0, Date.now() - startedAt),
  }));
}

async function defaultDocumentAnalysisProbe(): Promise<void> {
  const { runDocumentAnalysis } = await import("../lib/document-analysis/provider");
  let lastProvider: DocumentAnalysisProbeProvider | null = null;
  try {
    await runDocumentAnalysis({
      fileName: "juro-production-synthetic-probe.txt",
      mimeType: "text/plain",
      extractedText: "Synthetic technical health-check document. It contains no user data and no legal claim.",
      detectedLanguage: "en",
      extractionWarnings: [],
      packageContext: null,
      locale: "ru",
      mode: "quick",
      userSide: null,
      sources: [],
      legalDatabaseAsOf: "unavailable",
      requestId: crypto.randomUUID(),
    }, {
      ...productionDocumentAnalysisProbeOptions(),
      // This is a feature probe, not a provider probe. Follow the same quick
      // OpenAI -> Anthropic route as a user analysis so one healthy provider
      // keeps the feature operational. The dedicated provider probes above
      // continue to isolate and report each provider independently.
      beforeProviderCall: ({ provider }) => { lastProvider = provider; },
    });
  } catch (error) {
    throw withDocumentAnalysisProbeProvider(error, lastProvider);
  }
}

async function runDocumentAnalysisProbe(
  env: PlatformJobEnv,
  hook?: () => Promise<void>,
): Promise<ProbeOutcome> {
  if (!(await probeDue(env, "document_analysis", DOCUMENT_ANALYSIS_PROBE_INTERVAL_MS))) return "skipped";
  const startedAt = Date.now();
  try {
    await (hook ?? defaultDocumentAnalysisProbe)();
    await recordOperational(env, "document_analysis", startedAt);
    return "succeeded";
  } catch (error) {
    const safeErrorCode = documentAnalysisProbeFailureCode(error);
    logDocumentAnalysisProbeFailure(error, safeErrorCode, startedAt);
    await recordFailure(env, "document_analysis", safeErrorCode, startedAt);
    return "failed";
  }
}

async function runMalwareScannerProbe(env: PlatformJobEnv): Promise<ProbeOutcome> {
  if (!(await probeDue(env, "malware_scanner", MALWARE_PROBE_INTERVAL_MS))) return "skipped";
  const startedAt = Date.now();
  try {
    if (env.MALWARE_SCAN_ENABLED !== "true" || !env.MALWARE_SCANNER) {
      throw new Error("SCANNER_CONFIGURATION_UNAVAILABLE");
    }
    const sourceSha256 = await sha256(eicarBytes);
    const response = await env.MALWARE_SCANNER.fetch("https://malware-scanner.internal/v1/scan", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(eicarBytes.byteLength),
        "x-content-sha256": sourceSha256,
        "x-juro-scan-schema": "1",
      },
      body: eicarBytes,
      // The private ClamAV container scales to zero between sparse requests.
      // Production evidence shows a clean cold scan can take nearly 30 seconds,
      // so keep the probe bounded without classifying a healthy cold start as
      // an outage. This remains far below the Cron invocation wall-time.
      signal: AbortSignal.timeout(PRODUCTION_MALWARE_SCANNER_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("SCANNER_HTTP_ERROR");
    }
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
      throw new Error("SCANNER_RESPONSE_TOO_LARGE");
    }
    const result = malwareScannerResponseSchema.parse(JSON.parse(responseText) as unknown);
    if (result.verdict !== "infected" || result.sourceSha256 !== sourceSha256
      || result.threats.length < 1) {
      throw new Error("SCANNER_DETECTION_FAILED");
    }
    await recordOperational(env, "malware_scanner", startedAt);
    return "succeeded";
  } catch {
    await recordFailure(env, "malware_scanner", "SCANNER_UNAVAILABLE", startedAt);
    return "failed";
  }
}

function safeRecipient(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return normalized.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(normalized)
    ? normalized
    : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
    throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
  }
  return JSON.parse(text) as unknown;
}

async function runEmailDeliveryProbe(
  env: PlatformJobEnv,
  fetchImpl: typeof fetch,
): Promise<ProbeOutcome> {
  if (!(await probeDue(env, "resend", EMAIL_PROBE_INTERVAL_MS))) return "skipped";
  const startedAt = Date.now();
  const recipient = safeRecipient(env.OPERATIONS_ALERT_EMAIL);
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !recipient) {
    await recordFailure(env, "resend", "PROBE_CONFIGURATION_ERROR", startedAt);
    return "failed";
  }
  try {
    const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const response = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
        "idempotency-key": `juro-production-health-${day}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [recipient],
        subject: "[JURO production] Контролируемая проверка email",
        html: "<p>Контролируемая техническая проверка production JURO. Письмо не содержит пользовательских или юридических данных.</p>",
      }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error("EMAIL_PROVIDER_REJECTED");
    }
    resendResponseSchema.parse(await boundedJson(response));
    await recordOperational(env, "resend", startedAt);
    return "succeeded";
  } catch {
    await recordFailure(env, "resend", "EMAIL_DELIVERY_FAILED", startedAt);
    return "failed";
  }
}

async function runLawyerAreaProbe(env: PlatformJobEnv): Promise<ProbeOutcome> {
  if (!(await probeDue(env, "lawyer_area", LAWYER_AREA_PROBE_INTERVAL_MS))) return "skipped";
  const startedAt = Date.now();
  const prefix = "production-health-lawyer-v1";
  const ids = {
    client: `${prefix}-client`,
    lawyer: `${prefix}-lawyer`,
    workspace: `${prefix}-workspace`,
    member: `${prefix}-member`,
    caseId: `${prefix}-case`,
    profile: `${prefix}-profile`,
    request: `${prefix}-request`,
    grant: `${prefix}-grant`,
  };
  const now = new Date().toISOString();
  try {
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO user_profiles(id,email,full_name,locale,account_type,lifecycle_status,created_at,updated_at)
        VALUES (?,?,'JURO synthetic client probe','ru','individual','active',?,?)`).bind(
        ids.client, `${ids.client}@example.test`, now, now,
      ),
      env.DB.prepare(`INSERT INTO user_profiles(id,email,full_name,locale,account_type,lifecycle_status,created_at,updated_at)
        VALUES (?,?,'JURO synthetic lawyer probe','ru','lawyer','active',?,?)`).bind(
        ids.lawyer, `${ids.lawyer}@example.test`, now, now,
      ),
      env.DB.prepare("INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual','JURO synthetic lawyer probe','ru',?,?)")
        .bind(ids.workspace, now, now),
      env.DB.prepare(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
        VALUES (?,?,?,'owner','active',?,?,?)`).bind(ids.member, ids.workspace, ids.client, now, now, now),
      env.DB.prepare(`INSERT INTO cases(id,owner_user_id,workspace_id,account_type,locale,title,legal_area,status,created_at,updated_at)
        VALUES (?,?,?,'individual','ru','JURO synthetic lawyer probe','other','open',?,?)`)
        .bind(ids.caseId, ids.client, ids.workspace, now, now),
      env.DB.prepare(`INSERT INTO lawyer_profiles(id,user_id,display_name,status,created_at,updated_at)
        VALUES (?,?,'JURO synthetic lawyer probe','pending',?,?)`).bind(ids.profile, ids.lawyer, now, now),
      env.DB.prepare(`INSERT INTO lawyer_requests
        (id,workspace_id,case_id,requester_user_id,lawyer_profile_id,status,anonymized_summary,requested_scope_json,created_at,updated_at)
        VALUES (?,?,?,?,?,'awaiting_user_consent','Synthetic technical probe','{}',?,?)`)
        .bind(ids.request, ids.workspace, ids.caseId, ids.client, ids.profile, now, now),
      env.DB.prepare(`INSERT INTO lawyer_access_grants
        (id,lawyer_request_id,case_id,lawyer_user_id,granted_by_user_id,created_at)
        VALUES (?,?,?,?,?,?)`).bind(ids.grant, ids.request, ids.caseId, ids.lawyer, ids.client, now),
      env.DB.prepare(`SELECT g.id AS grantId
        FROM lawyer_access_grants g
        JOIN lawyer_requests r ON r.id=g.lawyer_request_id
        JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id
        WHERE g.id=? AND g.case_id=? AND g.lawyer_user_id=? AND r.workspace_id=? AND p.user_id=?`)
        .bind(ids.grant, ids.caseId, ids.lawyer, ids.workspace, ids.lawyer),
      env.DB.prepare("DELETE FROM lawyer_access_grants WHERE id=?").bind(ids.grant),
      env.DB.prepare("DELETE FROM lawyer_requests WHERE id=?").bind(ids.request),
      env.DB.prepare("DELETE FROM lawyer_profiles WHERE id=?").bind(ids.profile),
      env.DB.prepare("DELETE FROM cases WHERE id=?").bind(ids.caseId),
      env.DB.prepare("DELETE FROM workspace_members WHERE id=?").bind(ids.member),
      env.DB.prepare("DELETE FROM workspaces WHERE id=?").bind(ids.workspace),
      env.DB.prepare("DELETE FROM user_profiles WHERE id IN (?,?)").bind(ids.client, ids.lawyer),
    ]);
    const verification = results[8]?.results as Array<{ grantId?: string }> | undefined;
    if (verification?.[0]?.grantId !== ids.grant) throw new Error("LAWYER_AREA_PROBE_VERIFICATION_FAILED");
    await recordOperational(env, "lawyer_area", startedAt);
    return "succeeded";
  } catch {
    await recordFailure(env, "lawyer_area", "LAWYER_HANDOFF_UNAVAILABLE", startedAt);
    return "failed";
  }
}

/**
 * Production-only, content-free dependency checks. The scheduler already owns
 * an idempotent per-slot lease; individual due checks bound provider cost and
 * prevent routine probes from growing the append-only health ledger.
 */
export async function runProductionDependencyProbes(
  env: PlatformJobEnv & { PRODUCTION_SYNTHETIC_PROBES_ENABLED?: string },
  hooks: ProductionDependencyProbeHooks = {},
): Promise<ProductionDependencyProbeSummary | null> {
  if (!productionDependencyProbesEnabled(env)) return null;
  const privateR2 = await runPrivateR2Probe(env);
  const documentBuilder = await runDocumentBuilderProbe(env);
  const malwareScanner = await runMalwareScannerProbe(env);
  const openai = await runOneProviderProbe(env, "openai", hooks.openai);
  const anthropic = await runOneProviderProbe(env, "anthropic", hooks.anthropic);
  const documentAnalysis = await runDocumentAnalysisProbe(env, hooks.documentAnalysis);
  const resend = await runEmailDeliveryProbe(env, hooks.fetchImpl ?? fetch);
  const lawyerArea = await runLawyerAreaProbe(env);
  return {
    privateR2,
    documentBuilder,
    malwareScanner,
    openai,
    anthropic,
    documentAnalysis,
    resend,
    lawyerArea,
  };
}
