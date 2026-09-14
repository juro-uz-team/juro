import { AiUnavailableError, type AiStructuredResult } from "../document-builder/ai/openai";
import {
  assertProviderCallAllowed,
  parseProviderEnvironment,
  ProviderCostControlError,
} from "../ai/provider-cost-control";
import { ProviderUsageError, recordProviderUsage } from "../ai/provider-usage";
import {
  ComparisonProcessingError,
  type AnalysisPackageContext,
  type ExtractedDocument,
} from "../document-comparison/types";
import {
  legalDatabaseFreshnessFromAsOf,
  type LegalDatabaseFreshness,
} from "../legal/verified-retrieval";
import { retrieveLiveLexSourcesForDocument } from "../legal/live-lex-retrieval";
import {
  documentAnalysisResultSchema,
  enforceDocumentAnalysisFreshness,
  enforceDocumentAnalysisSourceBoundary,
  enforceDocumentExcerptBoundary,
  type DocumentAnalysisResult,
} from "./schema";
import {
  loadCompletedOcrExtraction,
  OcrProcessingError,
  scheduleOcrProcessing,
} from "./ocr-processor";
import { planDocumentAnalysis } from "./chunking";
import {
  extractAnalysisDocument,
  isAnalysisPackageContext,
  PackageExtractionError,
} from "./package-extractor";
import {
  AnalysisRevisionError,
  analysisSourceVersionId,
  storeInitialAnalysisDocumentVersion,
  suggestedRevisionId,
} from "./revisions";
import { scheduleTrustedUserDocumentIndexStatements } from "./user-document-vectors";
import { resolveAiRuntimeSettings, type AiRuntimeSettings } from "../ai/runtime-settings";

export const DOCUMENT_ANALYSIS_INLINE_BYTE_LIMIT = 20 * 1024 * 1024;
export { DOCUMENT_ANALYSIS_INLINE_TEXT_LIMIT } from "./limits";

export type DocumentAnalysisProcessorEnv = {
  APP_ENV?: "development" | "staging" | "production";
  DB: D1Database;
  BUCKET: R2Bucket;
  LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_CHAT_MODEL?: string;
  OPENAI_DEEP_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_DOCUMENT_MODEL?: string;
  ANTHROPIC_FALLBACK_MODEL?: string;
};

type AnalysisRow = {
  analysisId: string;
  workspaceId: string;
  ownerUserId: string;
  consentVersion: string;
  createdAt: string;
  status: string;
  summaryJson: string | null;
  fileId: string;
  fileKind: string;
  r2Key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
};

// This marker is written only by the explicitly enabled, non-user staging
// lifecycle probe. It lets its append-only provider-cost evidence use a
// per-seeded-analysis identity without changing any user analysis event ID.
const stagingSyntheticProbeConsentVersion = "synthetic-probe";

type PersistedAnalysis = {
  sourceFreshness: LegalDatabaseFreshness;
  result: DocumentAnalysisResult;
  technical: {
    provider: "openai" | "anthropic";
    model: string;
    providerResponseId: string | null;
    fallbackFromProvider: "openai" | "anthropic" | null;
    attempts: number;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    runtimeConfigHash: string;
  };
  extraction: {
    detectedLanguage: string;
    pageCount: number | null;
    textQuality: string;
    packageContext: AnalysisPackageContext | null;
  };
};

export class DocumentAnalysisProcessingError extends Error {
  constructor(
    readonly code:
      | "DOCUMENT_ANALYSIS_NOT_FOUND"
      | "DOCUMENT_ANALYSIS_FILE_UNSAFE"
      | "DOCUMENT_ANALYSIS_OBJECT_MISSING"
      | "DOCUMENT_ANALYSIS_INTEGRITY_FAILED"
      | "DOCUMENT_ANALYSIS_EXTRACTION_FAILED"
      | "DOCUMENT_ANALYSIS_OCR_REQUIRED"
      | "DOCUMENT_ANALYSIS_PACKAGE_OCR_REQUIRED"
      | "DOCUMENT_ANALYSIS_CAPACITY_REQUIRED"
      | "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE"
      | "DOCUMENT_ANALYSIS_INVALID_OUTPUT"
      | "DOCUMENT_ANALYSIS_PERSISTENCE_FAILED",
    readonly retryable: boolean,
    readonly diagnosticStage?: DocumentAnalysisDiagnosticStage,
    readonly diagnosticDetail?: DocumentAnalysisDiagnosticDetail,
  ) {
    super(code);
    this.name = "DocumentAnalysisProcessingError";
  }
}

export type DocumentAnalysisDiagnosticStage =
  | "integrity"
  | "ocr"
  | "object"
  | "extract"
  | "version"
  | "retrieval"
  | "runtime"
  | "provider"
  | "validation";

export type DocumentAnalysisDiagnosticDetail =
  | "ANALYSIS_REVISION_STORAGE_FAILED"
  | "ANALYSIS_REVISION_SOURCE_INVALID"
  | "ANALYSIS_VERSION_OBJECT_WRITE_NOT_ATTACHED"
  | "ANALYSIS_VERSION_CREATE_INTENT_FAILED"
  | "ANALYSIS_VERSION_WRITE_OBJECT_FAILED"
  | "ANALYSIS_VERSION_ATTACH_FAILED"
  | "ANALYSIS_VERSION_VERIFY_ATTACHMENT_FAILED"
  | "ANALYSIS_VERSION_OBJECT_WRITE_SOURCE_MISMATCH"
  | "ANALYSIS_DOCUMENT_VERSION_OBJECT_WRITE_MISMATCH"
  | "ANALYSIS_VERSION_OBJECT_WRITE_ATTACHMENT_MISMATCH"
  | "ANALYSIS_VERSION_OBJECT_WRITE_TRANSITION_INVALID"
  | "LEGAL_RETRIEVAL_SQLITE_PATTERN_TOO_COMPLEX"
  | "LEGAL_RETRIEVAL_SQLITE_ERROR"
  | "LEGAL_RETRIEVAL_FAILED"
  | "PROVIDER_HTTP_400"
  | "PROVIDER_HTTP_401"
  | "PROVIDER_HTTP_403"
  | "PROVIDER_HTTP_404"
  | "PROVIDER_HTTP_408"
  | "PROVIDER_HTTP_409"
  | "PROVIDER_HTTP_429"
  | "PROVIDER_HTTP_5XX"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_CIRCUIT_OPEN"
  | "PROVIDER_COST_CONTROL_INVALID"
  | "PROVIDER_COST_CONTROL_PERSISTENCE_FAILED"
  | "PROVIDER_USAGE_INVALID"
  | "PROVIDER_USAGE_PERSISTENCE_FAILED"
  | "PROVIDER_EXECUTION_FAILED"
  | "RUNTIME_SETTINGS_FAILED"
  | "INVALID_AI_OUTPUT"
  | "INVALID_AI_OUTPUT_MAX_TOKENS"
  | "INVALID_AI_OUTPUT_TOOL_RESULT_MISSING"
  | "INVALID_AI_OUTPUT_ENVELOPE_JSON_INVALID"
  | "INVALID_AI_OUTPUT_ENVELOPE_SCHEMA_INVALID"
  | "INVALID_AI_OUTPUT_SOURCE_BOUNDARY"
  | "INVALID_AI_OUTPUT_EXCERPT_BOUNDARY"
  | "INVALID_AI_OUTPUT_SCHEMA_INVALID"
  | "PROVIDER_UNAVAILABLE";

export function documentAnalysisDiagnosticDetail(
  error: unknown,
  stage?: DocumentAnalysisDiagnosticStage,
): DocumentAnalysisDiagnosticDetail | undefined {
  if (error instanceof AiUnavailableError) {
    if (error.code === "INVALID_AI_OUTPUT") {
      // providerErrorType can originate at a provider boundary. Persist only
      // fixed, content-free categories here; never propagate model output,
      // parser errors, provider body text, or a dynamic upstream type.
      switch (error.providerErrorType) {
        case "anthropic_output_max_tokens": return "INVALID_AI_OUTPUT_MAX_TOKENS";
        case "anthropic_tool_result_missing": return "INVALID_AI_OUTPUT_TOOL_RESULT_MISSING";
        case "anthropic_envelope_json_invalid": return "INVALID_AI_OUTPUT_ENVELOPE_JSON_INVALID";
        case "anthropic_envelope_schema_invalid": return "INVALID_AI_OUTPUT_ENVELOPE_SCHEMA_INVALID";
        case "document_source_boundary": return "INVALID_AI_OUTPUT_SOURCE_BOUNDARY";
        case "document_excerpt_boundary": return "INVALID_AI_OUTPUT_EXCERPT_BOUNDARY";
        default: return "INVALID_AI_OUTPUT";
      }
    }
    if (error.code === "PROVIDER_TIMEOUT") return "PROVIDER_TIMEOUT";
    if (error.code === "PROVIDER_CIRCUIT_OPEN") return "PROVIDER_CIRCUIT_OPEN";
    switch (error.providerStatus) {
      case 400: return "PROVIDER_HTTP_400";
      case 401: return "PROVIDER_HTTP_401";
      case 403: return "PROVIDER_HTTP_403";
      case 404: return "PROVIDER_HTTP_404";
      case 408: return "PROVIDER_HTTP_408";
      case 409: return "PROVIDER_HTTP_409";
      case 429: return "PROVIDER_HTTP_429";
      default:
        return error.providerStatus !== null && error.providerStatus >= 500
          ? "PROVIDER_HTTP_5XX"
          : "PROVIDER_UNAVAILABLE";
    }
  }
  if (error instanceof AnalysisRevisionError) {
    if (error.code === "ANALYSIS_REVISION_STORAGE_FAILED") {
      if (error.diagnosticStage === "create_intent") return "ANALYSIS_VERSION_CREATE_INTENT_FAILED";
      if (error.diagnosticStage === "write_object") return "ANALYSIS_VERSION_WRITE_OBJECT_FAILED";
      if (error.diagnosticStage === "attach_version") return "ANALYSIS_VERSION_ATTACH_FAILED";
      if (error.diagnosticStage === "verify_attachment") return "ANALYSIS_VERSION_VERIFY_ATTACHMENT_FAILED";
    }
    if (error.code === "ANALYSIS_REVISION_STORAGE_FAILED" || error.code === "ANALYSIS_REVISION_SOURCE_INVALID") {
      return error.code;
    }
    return error.message === "ANALYSIS_VERSION_OBJECT_WRITE_NOT_ATTACHED"
      ? "ANALYSIS_VERSION_OBJECT_WRITE_NOT_ATTACHED"
      : (() => {
        const normalized = error.message.toUpperCase();
        if (normalized.includes("ANALYSIS_VERSION_OBJECT_WRITE_SOURCE_MISMATCH")) {
          return "ANALYSIS_VERSION_OBJECT_WRITE_SOURCE_MISMATCH";
        }
        if (normalized.includes("ANALYSIS_DOCUMENT_VERSION_OBJECT_WRITE_MISMATCH")) {
          return "ANALYSIS_DOCUMENT_VERSION_OBJECT_WRITE_MISMATCH";
        }
        if (normalized.includes("ANALYSIS_VERSION_OBJECT_WRITE_ATTACHMENT_MISMATCH")) {
          return "ANALYSIS_VERSION_OBJECT_WRITE_ATTACHMENT_MISMATCH";
        }
        if (normalized.includes("ANALYSIS_VERSION_OBJECT_WRITE_TRANSITION_INVALID")) {
          return "ANALYSIS_VERSION_OBJECT_WRITE_TRANSITION_INVALID";
        }
        return undefined;
      })();
  }
  if (error instanceof ProviderUsageError) return error.code;
  if (error instanceof ProviderCostControlError) {
    if (error.code === "PROVIDER_COST_CONTROL_INVALID") return "PROVIDER_COST_CONTROL_INVALID";
    if (error.code === "PROVIDER_COST_CONTROL_PERSISTENCE_FAILED") {
      return "PROVIDER_COST_CONTROL_PERSISTENCE_FAILED";
    }
    return "PROVIDER_CIRCUIT_OPEN";
  }
  if (error instanceof Error) {
    // The detail remains an allow-listed operational category: never include
    // document text, source content, SQL, provider responses, or credentials.
    if (stage === "retrieval") {
      if (/LIKE or GLOB pattern too complex/i.test(error.message)) {
        return "LEGAL_RETRIEVAL_SQLITE_PATTERN_TOO_COMPLEX";
      }
      if (/SQLITE_ERROR/i.test(error.message)) return "LEGAL_RETRIEVAL_SQLITE_ERROR";
      return "LEGAL_RETRIEVAL_FAILED";
    }
    if (stage === "runtime") return "RUNTIME_SETTINGS_FAILED";
    if (stage === "provider") return "PROVIDER_EXECUTION_FAILED";
  }
  return undefined;
}

export type DocumentAnalysisProcessorDependencies = {
  extract: (input: {
    bytes: Uint8Array;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
  }) => Promise<ExtractedDocument>;
  retrieve: (
    db: D1Database,
    query: string,
    locale: "ru" | "uz",
    limit?: number,
  ) => Promise<{
    sources: import("../legal/source-context").LegalSourceContext[];
    freshness: LegalDatabaseFreshness;
    legalDatabaseAsOf: string;
  }>;
  analyze: (input: {
    fileName: string;
    mimeType: string;
    extractedText: string;
    detectedLanguage: string;
    extractionWarnings: string[];
    packageContext: AnalysisPackageContext | null;
    locale: "ru" | "uz";
    mode: "quick" | "full" | "expert";
    userSide: string | null;
    sources: import("../legal/source-context").LegalSourceContext[];
    legalDatabaseAsOf: string;
    requestId: string;
    beforeProviderCall?: (input: {
      provider: "openai" | "anthropic";
      model: string;
    }) => void | Promise<void>;
    runtimeSettings?: AiRuntimeSettings;
  }) => Promise<AiStructuredResult<DocumentAnalysisResult>>;
};

/**
 * Gives every real provider call a stable, content-free ledger identity. The
 * call start and ordinal distinguish queue retries and multi-chunk calls while
 * keeping an accidental replay of the same bookkeeping operation idempotent.
 * Including the analysis creation time also keeps controlled probe reseeds
 * append-only without exposing document, tenant, or provider request IDs.
 */
export async function documentAnalysisProviderUsageEventId(input: {
  row: {
    analysisId: string;
    consentVersion: string;
    createdAt: string;
  };
  environment: "development" | "staging" | "production";
  provider: "openai" | "anthropic";
  callStartedAt: string;
  callOrdinal: number;
}): Promise<string> {
  if (!Number.isSafeInteger(input.callOrdinal) || input.callOrdinal < 1) {
    throw new TypeError("Invalid document analysis provider call ordinal.");
  }
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode([
      "document-analysis-provider-usage-v2",
      input.environment,
      input.row.analysisId,
      input.row.createdAt,
      input.row.consentVersion === stagingSyntheticProbeConsentVersion ? "synthetic-probe" : "user-analysis",
      input.provider,
      input.callStartedAt,
      String(input.callOrdinal),
    ].join("\n")),
  );
  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  return `provider_usage_document_v2_${hex.slice(0, 48)}`;
}

function withSequentialAnalysisSession(
  env: DocumentAnalysisProcessorEnv,
): DocumentAnalysisProcessorEnv {
  // D1 version-intent triggers read the analysis state immediately after the
  // processor claims it. A primary-anchored session keeps that write visible to
  // all following statements in this lifecycle, including on read-replicated
  // deployments. The generated runtime type exposes the same prepare/batch
  // surface required by this processor, while local test doubles may not
  // implement sessions and safely retain their original behavior.
  if (typeof env.DB.withSession !== "function") return env;
  return {
    ...env,
    DB: env.DB.withSession("first-primary") as unknown as D1Database,
  };
}

const defaultDependencies: DocumentAnalysisProcessorDependencies = {
  extract: extractAnalysisDocument,
  retrieve: retrieveLiveLexSourcesForDocument,
  analyze: async (input) => {
    const { runDocumentAnalysis } = await import("./provider");
    return runDocumentAnalysis(input, {
      beforeProviderCall: input.beforeProviderCall,
      runtimeSettings: input.runtimeSettings,
    });
  },
};

export async function executeDocumentAnalysisJob(
  env: DocumentAnalysisProcessorEnv,
  analysisId: string,
  workspaceId: string,
  dependencies: Partial<DocumentAnalysisProcessorDependencies> = {},
): Promise<{ status: "completed" | "already_completed"; analysisId: string }> {
  const deps = { ...defaultDependencies, ...dependencies };
  const scopedEnv = withSequentialAnalysisSession(env);
  const row = await loadAnalysis(scopedEnv.DB, analysisId, workspaceId);
  if (!row) {
    throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_NOT_FOUND", false);
  }
  if (row.status === "completed") return { status: "already_completed", analysisId };

  let persisted: PersistedAnalysis;
  if (row.status === "persisting") {
    persisted = parsePersistedAnalysis(row.summaryJson);
  } else {
    assertSafeReadyState(row);
    const claimed = await scopedEnv.DB.prepare(
      "UPDATE document_analyses SET status='processing',error_code=NULL,updated_at=? WHERE id=? AND workspace_id=? AND status IN ('ready','retrying')",
    ).bind(new Date().toISOString(), analysisId, workspaceId).run();
    if (Number(claimed.meta.changes ?? 0) !== 1 && row.status !== "processing") {
      throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_FILE_UNSAFE", false);
    }
    persisted = await analyzeObject(scopedEnv, row, deps);
    await scopedEnv.DB.prepare(
      "UPDATE document_analyses SET status='persisting',summary_json=?,error_code=NULL,updated_at=? WHERE id=? AND workspace_id=? AND status='processing'",
    ).bind(JSON.stringify(persisted), new Date().toISOString(), analysisId, workspaceId).run();
  }

  try {
    await persistNormalizedAnalysis(scopedEnv, row, persisted);
    return { status: "completed", analysisId };
  } catch (error) {
    if (error instanceof DocumentAnalysisProcessingError) throw error;
    const failure = new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_PERSISTENCE_FAILED", true) as
      DocumentAnalysisProcessingError & { cause?: unknown };
    failure.cause = error;
    throw failure;
  }
}

async function analyzeObject(
  env: DocumentAnalysisProcessorEnv,
  row: AnalysisRow,
  deps: DocumentAnalysisProcessorDependencies,
): Promise<PersistedAnalysis> {
  let diagnosticStage: DocumentAnalysisDiagnosticStage = "integrity";
  try {
    if (!row.sha256 || !/^[a-f0-9]{64}$/i.test(row.sha256)) {
      await setAnalysisState(env.DB, row, "failed", "DOCUMENT_ANALYSIS_INTEGRITY_FAILED");
      throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_INTEGRITY_FAILED", false);
    }
    diagnosticStage = "ocr";
    let extracted = await loadCompletedOcrExtraction(env, {
      analysisId: row.analysisId,
      workspaceId: row.workspaceId,
      fileId: row.fileId,
      sourceSha256: row.sha256.toLowerCase(),
    });
    if (!extracted) {
      if (row.sizeBytes > DOCUMENT_ANALYSIS_INLINE_BYTE_LIMIT) {
        if (row.mimeType === "application/zip") {
          // There is no deployed streaming ZIP extractor.  Do not leave a
          // file in a waiting state that no consumer can complete, and do not
          // send it to OCR or an AI provider as a fallback.
          await setAnalysisState(env.DB, row, "failed", "DOCUMENT_ANALYSIS_CAPACITY_REQUIRED");
          throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_CAPACITY_REQUIRED", false);
        }
        await scheduleOcrProcessing(env.DB, {
          analysisId: row.analysisId,
          fileId: row.fileId,
          workspaceId: row.workspaceId,
          ownerUserId: row.ownerUserId,
          sourceSha256: row.sha256.toLowerCase(),
        });
        throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_OCR_REQUIRED", false);
      }
      diagnosticStage = "object";
      const object = await env.BUCKET.get(row.r2Key);
      if (!object) {
        throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_OBJECT_MISSING", false);
      }
      const bytes = new Uint8Array(await object.arrayBuffer());
      if (bytes.byteLength !== row.sizeBytes || await sha256Hex(bytes) !== row.sha256.toLowerCase()) {
        await setAnalysisState(env.DB, row, "failed", "DOCUMENT_ANALYSIS_INTEGRITY_FAILED");
        throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_INTEGRITY_FAILED", false);
      }
      try {
        diagnosticStage = "extract";
        extracted = await deps.extract({
          bytes,
          fileName: row.fileName,
          mimeType: row.mimeType,
          sizeBytes: row.sizeBytes,
        });
      } catch (error) {
        if (error instanceof PackageExtractionError) {
          // PackageExtractionError only represents the bounded inline
          // capacity boundary.  A background handler does not exist yet, so
          // terminalize truthfully instead of implying asynchronous progress.
          await setAnalysisState(env.DB, row, "failed", "DOCUMENT_ANALYSIS_CAPACITY_REQUIRED");
          throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_CAPACITY_REQUIRED", false);
        }
        if (
          error instanceof ComparisonProcessingError &&
          (error.code === "OCR_REQUIRED" || error.code === "NO_READABLE_TEXT")
        ) {
          await scheduleOcrProcessing(env.DB, {
            analysisId: row.analysisId,
            fileId: row.fileId,
            workspaceId: row.workspaceId,
            ownerUserId: row.ownerUserId,
            sourceSha256: row.sha256.toLowerCase(),
          });
          throw new DocumentAnalysisProcessingError(
            row.mimeType === "application/zip"
              ? "DOCUMENT_ANALYSIS_PACKAGE_OCR_REQUIRED"
              : "DOCUMENT_ANALYSIS_OCR_REQUIRED",
            false,
          );
        }
        throw error;
      }
    }
    diagnosticStage = "version";
    await storeInitialAnalysisDocumentVersion(env, {
      analysisId: row.analysisId,
      workspaceId: row.workspaceId,
      ownerUserId: row.ownerUserId,
      fileName: row.fileName,
      text: extracted.text,
    });

    diagnosticStage = "retrieval";
    const request = parseRequestMetadata(row.summaryJson);
    // The full document never becomes a Lex query. A bounded structural
    // sample gives live retrieval the document's subject without handing it a
    // local corpus or building any document-to-law embedding index.
    const retrieval = await deps.retrieve(
      env.DB,
      extracted.text.slice(0, 12_000),
      request.locale,
      request.mode === "quick" ? 3 : 5,
    );
    diagnosticStage = "runtime";
    const providerEnvironment = parseProviderEnvironment(env.APP_ENV);
    const runtimeSettings = await resolveAiRuntimeSettings({ db: env.DB, env });
    const providerCalls: Array<{
      provider: "openai" | "anthropic";
      model: string;
      startedAt: string;
      ordinal: number;
    }> = [];
    let ai: AiStructuredResult<DocumentAnalysisResult>;
    try {
      diagnosticStage = "provider";
      const analysisPlan = planDocumentAnalysis(extracted.text, request.mode);
      const chunks = analysisPlan.chunks;
      const chunkResults: AiStructuredResult<DocumentAnalysisResult>[] = [];
      for (const chunk of chunks) {
        chunkResults.push(await deps.analyze({
          fileName: row.fileName,
          mimeType: row.mimeType,
          extractedText: chunk.text,
          detectedLanguage: extracted.detectedLanguage,
          extractionWarnings: [
            ...(extracted.warningCode ? [extracted.warningCode] : []),
            ...(analysisPlan.representativeSample ? ["DOCUMENT_QUICK_REPRESENTATIVE_SAMPLE"] : []),
            ...(chunks.length > 1 ? [`DOCUMENT_CHUNK_${chunk.index}_OF_${chunk.total}`] : []),
          ],
          packageContext: extracted.packageContext ?? null,
          locale: request.locale,
          mode: request.mode,
          userSide: null,
          sources: retrieval.sources,
          legalDatabaseAsOf: retrieval.legalDatabaseAsOf,
          requestId: `document-analysis-${row.analysisId}-chunk-${chunk.index}`,
          runtimeSettings,
          beforeProviderCall: async (call) => {
            try {
              await assertProviderCallAllowed({
                db: env.DB,
                environment: providerEnvironment,
                provider: call.provider,
              });
            } catch (error) {
              if (error instanceof ProviderCostControlError && error.code === "PROVIDER_CIRCUIT_OPEN") {
                throw new AiUnavailableError(
                  "AI-провайдер остановлен системой контроля расходов.",
                  "PROVIDER_CIRCUIT_OPEN",
                  false,
                );
              }
              throw error;
            }
            providerCalls.push({
              ...call,
              startedAt: new Date().toISOString(),
              ordinal: providerCalls.length + 1,
            });
          },
        }));
      }
      ai = mergeChunkAnalysisResults(chunkResults);
    } catch (error) {
      const completedAt = new Date().toISOString();
      const errorCode = isAiProviderError(error) ? error.code : "PROVIDER_UNAVAILABLE";
      try {
        for (const call of providerCalls) {
          await recordProviderUsage({
            db: env.DB,
            environment: providerEnvironment,
            workspaceId: row.workspaceId,
            userId: row.ownerUserId,
            feature: "document_analysis",
            operation: call.provider === "openai" ? "responses" : "messages",
            provider: call.provider,
            model: call.model,
            inputTokens: 0,
            outputTokens: 0,
            cachedInputTokens: 0,
            status: "failed",
            errorCode,
            startedAt: call.startedAt,
            completedAt,
            eventId: await documentAnalysisProviderUsageEventId({
              row,
              environment: providerEnvironment,
              provider: call.provider,
              callStartedAt: call.startedAt,
              callOrdinal: call.ordinal,
            }),
          });
        }
      } catch {
        // The document analysis state remains the reconciliation source.
      }
      throw error;
    }
    if (providerCalls.length > 0) {
      const completedAt = new Date().toISOString();
      for (const call of providerCalls.filter((call) => call.provider !== ai.provider)) {
        await recordProviderUsage({
          db: env.DB,
          environment: providerEnvironment,
          workspaceId: row.workspaceId,
          userId: row.ownerUserId,
          feature: "document_analysis",
          operation: call.provider === "openai" ? "responses" : "messages",
          provider: call.provider,
          model: call.model,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          status: "failed",
          errorCode: "FALLBACK_USED",
          startedAt: call.startedAt,
          completedAt,
          eventId: await documentAnalysisProviderUsageEventId({
            row,
            environment: providerEnvironment,
            provider: call.provider,
            callStartedAt: call.startedAt,
            callOrdinal: call.ordinal,
          }),
        });
      }
      const successfulCall = [...providerCalls].reverse().find((call) => call.provider === ai.provider)!;
      await recordProviderUsage({
        db: env.DB,
        environment: providerEnvironment,
        workspaceId: row.workspaceId,
        userId: row.ownerUserId,
        feature: "document_analysis",
        operation: ai.provider === "openai" ? "responses" : "messages",
        provider: ai.provider,
        model: ai.model,
        providerRequestId: ai.providerResponseId,
        inputTokens: ai.usage.inputTokens,
        outputTokens: ai.usage.outputTokens,
        cachedInputTokens: ai.usage.cachedInputTokens,
        status: "succeeded",
        startedAt: successfulCall.startedAt,
        completedAt,
        eventId: await documentAnalysisProviderUsageEventId({
          row,
          environment: providerEnvironment,
          provider: ai.provider,
          callStartedAt: successfulCall.startedAt,
          callOrdinal: successfulCall.ordinal,
        }),
      });
    }
    const sourceById = new Map(retrieval.sources.map((source) => [source.id, source]));
    let boundedResult: DocumentAnalysisResult;
    diagnosticStage = "validation";
    let schemaValidatedResult: DocumentAnalysisResult;
    try {
      schemaValidatedResult = documentAnalysisResultSchema.parse(ai.data);
    } catch {
      await setAnalysisState(env.DB, row, "failed", "DOCUMENT_ANALYSIS_INVALID_OUTPUT");
      throw new DocumentAnalysisProcessingError(
        "DOCUMENT_ANALYSIS_INVALID_OUTPUT",
        false,
        "validation",
        "INVALID_AI_OUTPUT_SCHEMA_INVALID",
      );
    }
    let sourceBoundResult: DocumentAnalysisResult;
    try {
      sourceBoundResult = enforceDocumentAnalysisSourceBoundary(
        schemaValidatedResult,
        new Set(retrieval.sources.filter((source) => source.excerpt?.trim()).map((source) => source.id)),
      );
    } catch {
      await setAnalysisState(env.DB, row, "failed", "DOCUMENT_ANALYSIS_INVALID_OUTPUT");
      throw new DocumentAnalysisProcessingError(
        "DOCUMENT_ANALYSIS_INVALID_OUTPUT",
        false,
        "validation",
        "INVALID_AI_OUTPUT_SOURCE_BOUNDARY",
      );
    }
    try {
      const validatedResult = enforceDocumentExcerptBoundary(sourceBoundResult, extracted.text);
      boundedResult = {
        ...validatedResult,
        sources: validatedResult.sources.map((reference) => {
          const source = sourceById.get(reference.sourceId)!;
          return {
            sourceId: source.id,
            actTitle: source.actTitle,
            actIdentifier: source.actIdentifier,
            article: source.article ?? null,
            excerpt: source.excerpt ?? null,
            originalUrl: source.officialUrl,
            verifiedAt: source.verifiedAt,
          };
        }),
      };
    } catch {
      await setAnalysisState(env.DB, row, "failed", "DOCUMENT_ANALYSIS_INVALID_OUTPUT");
      throw new DocumentAnalysisProcessingError(
        "DOCUMENT_ANALYSIS_INVALID_OUTPUT",
        false,
        "validation",
        "INVALID_AI_OUTPUT_EXCERPT_BOUNDARY",
      );
    }
    return {
      result: enforceDocumentAnalysisFreshness(boundedResult, retrieval.freshness),
      sourceFreshness: retrieval.freshness,
      technical: {
        provider: ai.provider,
        model: ai.model,
        providerResponseId: ai.providerResponseId,
        fallbackFromProvider: ai.fallbackFromProvider,
        attempts: ai.attempts,
        latencyMs: ai.latencyMs,
        inputTokens: ai.usage.inputTokens,
        outputTokens: ai.usage.outputTokens,
        cachedInputTokens: ai.usage.cachedInputTokens,
        runtimeConfigHash: runtimeSettings.configHash,
      },
      extraction: {
        detectedLanguage: extracted.detectedLanguage,
        pageCount: extracted.pageCount,
        textQuality: extracted.textQuality,
        packageContext: extracted.packageContext ?? null,
      },
    };
  } catch (error) {
    if (error instanceof DocumentAnalysisProcessingError) throw error;
    if (error instanceof OcrProcessingError) {
      const status = error.retryable ? "retrying" : "failed";
      await setAnalysisState(env.DB, row, status, error.code);
      throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_EXTRACTION_FAILED", error.retryable);
    }
    if (error instanceof PackageExtractionError) {
      await setAnalysisState(env.DB, row, "failed", "DOCUMENT_ANALYSIS_CAPACITY_REQUIRED");
      throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_CAPACITY_REQUIRED", false);
    }
    if (error instanceof AnalysisRevisionError) {
      await setAnalysisState(env.DB, row, "retrying", "DOCUMENT_ANALYSIS_PERSISTENCE_FAILED");
      throw new DocumentAnalysisProcessingError(
        "DOCUMENT_ANALYSIS_PERSISTENCE_FAILED",
        true,
        "version",
        documentAnalysisDiagnosticDetail(error),
      );
    }
    if (error instanceof ComparisonProcessingError) {
      const waiting = error.code === "OCR_REQUIRED" ? "awaiting_ocr" : "failed";
      const code = error.code === "OCR_REQUIRED"
        ? "DOCUMENT_ANALYSIS_OCR_REQUIRED"
        : "DOCUMENT_ANALYSIS_EXTRACTION_FAILED";
      await setAnalysisState(env.DB, row, waiting, code);
      throw new DocumentAnalysisProcessingError(code, false);
    }
    if (isAiProviderError(error)) {
      const code = error.code === "INVALID_AI_OUTPUT"
        ? "DOCUMENT_ANALYSIS_INVALID_OUTPUT"
        : "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE";
      const status = (error.code === "PROVIDER_UNAVAILABLE" || error.code === "PROVIDER_CIRCUIT_OPEN") && !error.retryable
        ? "awaiting_ai_configuration"
        : error.retryable ? "retrying" : "failed";
      await setAnalysisState(env.DB, row, status, code);
      // Preserve only the already allow-listed provider diagnostic category.
      // The outer worker/probe can then distinguish a bounded timeout from an
      // HTTP/auth/circuit failure without retaining provider bodies, document
      // text, credentials, or low-level error messages.
      throw new DocumentAnalysisProcessingError(
        code,
        error.retryable,
        "provider",
        documentAnalysisDiagnosticDetail(error),
      );
    }
    await setAnalysisState(env.DB, row, "retrying", "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE");
    throw new DocumentAnalysisProcessingError(
      "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE",
      true,
      diagnosticStage,
      documentAnalysisDiagnosticDetail(error, diagnosticStage),
    );
  }
}

async function persistNormalizedAnalysis(
  env: DocumentAnalysisProcessorEnv,
  row: AnalysisRow,
  persisted: PersistedAnalysis,
): Promise<void> {
  const db = env.DB;
  const now = new Date().toISOString();
  const summary = legacyCompatibleSummary(persisted);
  const summaryJson = JSON.stringify(summary);
  const resultSha256 = await sha256Hex(new TextEncoder().encode(summaryJson));
  await db.prepare("DELETE FROM document_risks WHERE analysis_id=?").bind(row.analysisId).run();
  let revisionCount = 0;
  for (let offset = 0; offset < persisted.result.risks.length; offset += 20) {
    const statements: D1PreparedStatement[] = [];
    for (const risk of persisted.result.risks.slice(offset, offset + 20)) {
      const riskId = crypto.randomUUID();
      statements.push(db.prepare(
        `INSERT INTO document_risks
         (id,analysis_id,level,title,description,excerpt,confidence_percent,risk_type,clause,page,recommendation,proposed_wording,legal_basis_source_ids_json,created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        riskId,
        row.analysisId,
        risk.severity,
        risk.title,
        [risk.problem, risk.consequence, risk.recommendation].join("\n\n"),
        risk.exactExcerpt,
        risk.confidence === "high" ? 90 : risk.confidence === "medium" ? 70 : 45,
        risk.riskType,
        risk.clause,
        risk.page,
        risk.recommendation,
        risk.proposedWording,
        JSON.stringify(risk.legalBasisSourceIds),
        now,
      ));
      if (
        risk.exactExcerpt?.trim()
        && risk.proposedWording?.trim()
        && risk.exactExcerpt !== risk.proposedWording
      ) {
        statements.push(db.prepare(
          `INSERT INTO suggested_revisions
           (id,analysis_id,risk_id,source_version_id,workspace_id,owner_user_id,original_text,
            proposed_text,status,decided_by_user_id,decided_at,applied_version_id,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,?,'pending',NULL,NULL,NULL,?,?)`,
        ).bind(
          suggestedRevisionId(riskId), row.analysisId, riskId, analysisSourceVersionId(row.analysisId),
          row.workspaceId, row.ownerUserId, risk.exactExcerpt, risk.proposedWording, now, now,
        ));
        revisionCount += 1;
      }
    }
    await db.batch(statements);
  }

  const runId = `document-analysis-run-${row.analysisId}`;
  const ledgerId = `document-analysis-usage-${row.analysisId}`;
  const idempotencyKey = `document-analysis:${row.analysisId}`;
  const { periodStart, periodEnd } = monthlyPeriod(new Date(now));
  const sourceVersionHash = await sha256Hex(new TextEncoder().encode(
    persisted.result.sources.map((source) => `${source.sourceId}:${source.verifiedAt}`).sort().join("|"),
  ));
  const instructionHash = await sha256Hex(new TextEncoder().encode(
    JSON.stringify({ version: "juro-document-analysis-v1", runtimeConfigHash: persisted.technical.runtimeConfigHash }),
  ));
  const sourceVersion = await db.prepare(
    `SELECT id,sha256 FROM analysis_document_versions
     WHERE id=? AND analysis_id=? AND workspace_id=? AND owner_user_id=? LIMIT 1`,
  ).bind(
    analysisSourceVersionId(row.analysisId),
    row.analysisId,
    row.workspaceId,
    row.ownerUserId,
  ).first<{ id: string; sha256: string }>();
  if (!sourceVersion) {
    throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_PERSISTENCE_FAILED", true);
  }
  const detectedLanguage = (["ru", "uz", "mixed", "unknown"] as const).includes(
    persisted.extraction.detectedLanguage as "ru" | "uz" | "mixed" | "unknown",
  )
    ? persisted.extraction.detectedLanguage as "ru" | "uz" | "mixed" | "unknown"
    : "unknown";
  await db.batch([
    db.prepare(
      `INSERT INTO ai_runs
       (id,workspace_id,user_id,conversation_id,request_message_id,response_message_id,idempotency_key,
        correlation_id,provider,model,provider_response_id,fallback_from_provider,answer_mode,reasoning_mode,
        status,legal_database_as_of,instruction_hash,source_version_hash,input_tokens,output_tokens,
        cached_input_tokens,estimated_cost_microusd,attempt_count,latency_ms,error_code,started_at,
        completed_at,created_at,updated_at)
       VALUES (?,?,?,NULL,NULL,NULL,?,?,?,?,?,?,?,?, 'completed',?,?,?,?,?,?,NULL,?,?,NULL,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET provider=excluded.provider,model=excluded.model,
        provider_response_id=excluded.provider_response_id,fallback_from_provider=excluded.fallback_from_provider,
        status='completed',legal_database_as_of=excluded.legal_database_as_of,
        source_version_hash=excluded.source_version_hash,input_tokens=excluded.input_tokens,
        output_tokens=excluded.output_tokens,cached_input_tokens=excluded.cached_input_tokens,
        attempt_count=excluded.attempt_count,latency_ms=excluded.latency_ms,
        completed_at=excluded.completed_at,updated_at=excluded.updated_at`,
    ).bind(
      runId, row.workspaceId, row.ownerUserId, idempotencyKey, `document-analysis-${row.analysisId}`,
      persisted.technical.provider, persisted.technical.model, persisted.technical.providerResponseId,
      persisted.technical.fallbackFromProvider, persisted.result.mode,
      persisted.result.mode === "expert" ? "deep" : "fast", persisted.result.legalDatabaseAsOf,
      instructionHash, sourceVersionHash, persisted.technical.inputTokens,
      persisted.technical.outputTokens, persisted.technical.cachedInputTokens,
      persisted.technical.attempts, persisted.technical.latencyMs, now, now, now, now,
    ),
    db.prepare(
      `INSERT INTO ai_usage_ledger
       (id,workspace_id,user_id,ai_run_id,idempotency_key,feature,period_start,period_end,units,status,
        provider,model,input_tokens,output_tokens,cached_input_tokens,estimated_cost_microusd,
        released_at,consumed_at,created_at,updated_at)
       VALUES (?,?,?,?,?,'document_analysis',?,?,1,'consumed',?,?,?,?,?,NULL,NULL,?,?,?)
       ON CONFLICT(ai_run_id) DO UPDATE SET provider=excluded.provider,model=excluded.model,
        input_tokens=excluded.input_tokens,output_tokens=excluded.output_tokens,
        cached_input_tokens=excluded.cached_input_tokens,status='consumed',consumed_at=excluded.consumed_at,
        updated_at=excluded.updated_at`,
    ).bind(
      ledgerId, row.workspaceId, row.ownerUserId, runId, idempotencyKey,
      periodStart, periodEnd, persisted.technical.provider, persisted.technical.model,
      persisted.technical.inputTokens, persisted.technical.outputTokens,
      persisted.technical.cachedInputTokens, now, now, now,
    ),
    db.prepare(
      "UPDATE document_analyses SET status='completed',summary_json=?,result_sha256=?,error_code=NULL,updated_at=? WHERE id=? AND workspace_id=? AND status='persisting'",
    ).bind(summaryJson, resultSha256, now, row.analysisId, row.workspaceId),
    ...scheduleTrustedUserDocumentIndexStatements(env, {
      analysisId: row.analysisId,
      documentVersionId: sourceVersion.id,
      workspaceId: row.workspaceId,
      ownerUserId: row.ownerUserId,
      sourceHash: sourceVersion.sha256,
      language: detectedLanguage,
      now,
    }),
    db.prepare(
      `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       VALUES (?,?,?,'document_analysis',?,'analysis_completed',?,?)`,
    ).bind(
      crypto.randomUUID(), row.workspaceId, row.ownerUserId, row.analysisId,
      JSON.stringify({
        provider: persisted.technical.provider,
        model: persisted.technical.model,
        fallbackFromProvider: persisted.technical.fallbackFromProvider,
        riskCount: persisted.result.risks.length,
        sourceCount: persisted.result.sources.length,
        revisionCount,
        sourceFreshnessStatus: persisted.sourceFreshness.status,
        sourceFreshnessAsOf: persisted.sourceFreshness.asOf,
        privateCorpusIndexScheduled: env.LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST === "true",
      }),
      now,
    ),
  ]);
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string, limit: number): T[] {
  const seen = new Set<string>();
  const output: T[] = [];
  for (const item of items) {
    const signature = key(item);
    if (seen.has(signature)) continue;
    seen.add(signature);
    output.push(item);
    if (output.length >= limit) break;
  }
  return output;
}

/**
 * A long document is analysed fragment-by-fragment; this deterministic merge
 * retains only schema-bounded findings and never invents a cross-fragment
 * legal conclusion. Each source and excerpt still goes through the canonical
 * source/excerpt validation below against the original document text.
 */
function mergeChunkAnalysisResults(
  results: readonly AiStructuredResult<DocumentAnalysisResult>[],
): AiStructuredResult<DocumentAnalysisResult> {
  const first = results[0];
  const last = results.at(-1);
  if (!first || !last) throw new Error("DOCUMENT_ANALYSIS_CHUNKS_EMPTY");
  const data = results.map((result) => result.data);
  const allVerified = data.every((result) => result.legalComplianceStatus === "verified");
  const anyOfficialSource = data.some((result) => result.sources.length > 0);
  const summaries = data.map((result) => result.summary.trim()).filter(Boolean);
  return {
    ...last,
    attempts: results.reduce((total, result) => total + result.attempts, 0),
    latencyMs: results.reduce((total, result) => total + result.latencyMs, 0),
    usage: {
      inputTokens: results.reduce((total, result) => total + result.usage.inputTokens, 0),
      outputTokens: results.reduce((total, result) => total + result.usage.outputTokens, 0),
      cachedInputTokens: results.reduce((total, result) => total + result.usage.cachedInputTokens, 0),
    },
    data: {
      ...first.data,
      summary: summaries.join("\n\n").slice(0, 4_000) || first.data.summary,
      legalComplianceStatus: allVerified ? "verified" : anyOfficialSource ? "partial" : "unverified",
      parties: uniqueBy(data.flatMap((result) => result.parties), (item) => `${item.name}|${item.role}|${item.isUserSide}`, 30),
      amounts: uniqueBy(data.flatMap((result) => result.amounts), (item) => item, 50),
      dates: uniqueBy(data.flatMap((result) => result.dates), (item) => item, 50),
      obligations: uniqueBy(data.flatMap((result) => result.obligations), (item) => `${item.party}|${item.obligation}|${item.clause ?? ""}|${item.deadline ?? ""}`, 100),
      deadlines: uniqueBy(data.flatMap((result) => result.deadlines), (item) => `${item.title}|${item.value}|${item.clause ?? ""}`, 50),
      risks: uniqueBy(data.flatMap((result) => result.risks), (item) => `${item.riskType}|${item.title}|${item.exactExcerpt ?? ""}`, 100),
      missingClauses: uniqueBy(data.flatMap((result) => result.missingClauses), (item) => `${item.title}|${item.reason}`, 50),
      contradictions: uniqueBy(data.flatMap((result) => result.contradictions), (item) => item, 50),
      questions: uniqueBy(data.flatMap((result) => result.questions), (item) => item, 30),
      recommendations: uniqueBy(data.flatMap((result) => result.recommendations), (item) => item, 50),
      sources: uniqueBy(data.flatMap((result) => result.sources), (item) => item.sourceId, 12),
      extractionWarnings: uniqueBy(data.flatMap((result) => result.extractionWarnings), (item) => item, 20),
    },
  };
}

function assertSafeReadyState(row: AnalysisRow): void {
  if (!(["ready", "processing", "retrying"] as string[]).includes(row.status) || row.fileKind !== "analysis_safe") {
    throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_FILE_UNSAFE", false);
  }
}

async function loadAnalysis(
  db: D1Database,
  analysisId: string,
  workspaceId: string,
): Promise<AnalysisRow | null> {
  return db.prepare(
    `SELECT a.id AS analysisId,a.workspace_id AS workspaceId,a.owner_user_id AS ownerUserId,
      a.consent_version AS consentVersion,a.created_at AS createdAt,
      a.status,a.summary_json AS summaryJson,f.id AS fileId,f.kind AS fileKind,f.r2_key AS r2Key,
      f.file_name AS fileName,f.mime_type AS mimeType,f.size_bytes AS sizeBytes,f.sha256
     FROM document_analyses a JOIN document_files f ON f.id=a.uploaded_file_id
     WHERE a.id=? AND a.workspace_id=? AND f.workspace_id=? AND f.archived_at IS NULL LIMIT 1`,
  ).bind(analysisId, workspaceId, workspaceId).first<AnalysisRow>();
}

function parseRequestMetadata(value: string | null): {
  locale: "ru" | "uz";
  mode: "quick" | "full" | "expert";
} {
  try {
    const parsed = JSON.parse(value || "{}") as Record<string, unknown>;
    return {
      locale: parsed.locale === "uz" ? "uz" : "ru",
      mode: parsed.mode === "full" || parsed.mode === "expert" ? parsed.mode : "quick",
    };
  } catch {
    return { locale: "ru", mode: "quick" };
  }
}

function parsePersistedAnalysis(value: string | null): PersistedAnalysis {
  try {
    const parsed = JSON.parse(value || "{}") as PersistedAnalysis;
    const result = documentAnalysisResultSchema.parse(parsed.result);
    if (parsed.extraction?.packageContext !== null
      && parsed.extraction?.packageContext !== undefined
      && !isAnalysisPackageContext(parsed.extraction.packageContext)) {
      throw new Error("INVALID_PACKAGE_CONTEXT");
    }
    return {
      ...parsed,
      technical: {
        ...parsed.technical,
        runtimeConfigHash: /^[a-f0-9]{64}$/.test(parsed.technical?.runtimeConfigHash ?? "")
          ? parsed.technical.runtimeConfigHash
          : "0".repeat(64),
      },
      result,
      extraction: {
        ...parsed.extraction,
        packageContext: parsed.extraction?.packageContext ?? null,
      },
      sourceFreshness: parsed.sourceFreshness
        ?? legalDatabaseFreshnessFromAsOf(result.legalDatabaseAsOf),
    };
  } catch {
    throw new DocumentAnalysisProcessingError("DOCUMENT_ANALYSIS_PERSISTENCE_FAILED", true);
  }
}

function legacyCompatibleSummary(persisted: PersistedAnalysis) {
  const result = persisted.result;
  return {
    summary: result.summary,
    parties: result.parties.map((party) => `${party.name} — ${party.role}`),
    dates: result.dates,
    obligations: result.obligations.map((item) => `${item.party}: ${item.obligation}`),
    payments: result.amounts,
    disputedTerms: result.contradictions,
    missingItems: result.missingClauses.map((item) => item.title),
    questions: result.questions,
    disclaimer: result.legalComplianceStatus === "unverified"
      ? "Правовые основания не подтверждены проверенными источниками; показан структурный анализ документа."
      : "Правовые выводы привязаны к проверенным источникам, но результат требует профессиональной проверки.",
    result,
    technical: persisted.technical,
    extraction: persisted.extraction,
  };
}

async function setAnalysisState(
  db: D1Database,
  row: AnalysisRow,
  status: string,
  errorCode: string,
): Promise<void> {
  await db.prepare(
    "UPDATE document_analyses SET status=?,error_code=?,updated_at=? WHERE id=? AND workspace_id=?",
  ).bind(status, errorCode, new Date().toISOString(), row.analysisId, row.workspaceId).run();
}

function isAiProviderError(error: unknown): error is {
  code: "PROVIDER_UNAVAILABLE" | "PROVIDER_TIMEOUT" | "INVALID_AI_OUTPUT" | "AI_REFUSED" | "PROVIDER_CIRCUIT_OPEN";
  retryable: boolean;
} {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; code?: unknown; retryable?: unknown };
  return candidate.name === "AiUnavailableError"
    && typeof candidate.retryable === "boolean"
    && ["PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT", "INVALID_AI_OUTPUT", "AI_REFUSED", "PROVIDER_CIRCUIT_OPEN"]
      .includes(String(candidate.code));
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function monthlyPeriod(now: Date): { periodStart: string; periodEnd: string } {
  return {
    periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
    periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
  };
}
