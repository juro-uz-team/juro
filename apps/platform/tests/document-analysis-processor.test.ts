import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  documentAnalysisProviderUsageEventId,
  documentAnalysisDiagnosticDetail,
  type DocumentAnalysisProcessorDependencies,
  DocumentAnalysisProcessingError,
  executeDocumentAnalysisJob,
} from "../lib/document-analysis/processor";
import { AiUnavailableError } from "../lib/document-builder/ai/openai";
import { ProviderUsageError } from "../lib/ai/provider-usage";
import { ComparisonProcessingError } from "../lib/document-comparison/types";
import { PackageExtractionError } from "../lib/document-analysis/package-extractor";
import { DOCUMENT_ANALYSIS_INLINE_TEXT_LIMIT } from "../lib/document-analysis/limits";
import { QUICK_DOCUMENT_ANALYSIS_INPUT_SIZE } from "../lib/document-analysis/chunking";
import type { DocumentAnalysisResult } from "../lib/document-analysis/schema";

const result: DocumentAnalysisResult = {
  documentType: "Договор оказания услуг",
  summary: "Синтетический документ регулирует услуги.",
  language: "ru",
  outputLanguage: "ru",
  jurisdiction: "UZ",
  mode: "quick",
  userSide: null,
  legalComplianceStatus: "unverified",
  parties: [{ name: "Сторона А", role: "Заказчик", isUserSide: true }],
  amounts: [],
  dates: [],
  obligations: [],
  deadlines: [],
  risks: [{
    severity: "medium",
    riskType: "document_internal",
    title: "Неясный срок",
    clause: null,
    page: null,
    exactExcerpt: "срок определяется дополнительно",
    problem: "Срок не определён.",
    consequence: "Исполнение трудно контролировать.",
    legalBasisSourceIds: [],
    recommendation: "Указать точный срок.",
    proposedWording: "Установить срок в 10 календарных дней.",
    confidence: "high",
  }],
  missingClauses: [],
  contradictions: [],
  questions: [],
  recommendations: [],
  overallQuality: { score: 70, explanation: "Нужен точный срок." },
  sources: [],
  legalDatabaseAsOf: "unavailable",
  extractionWarnings: [],
};

test("document consumer refuses quarantined files before any R2 or AI read", async () => {
  const fixture = await databaseFixture("quarantined", "analysis_quarantined");
  let r2Reads = 0;
  let aiCalls = 0;
  await assert.rejects(
    executeDocumentAnalysisJob({
      DB: fixture.db,
      BUCKET: { async get() { r2Reads += 1; return null; } } as unknown as R2Bucket,
    }, "analysis-a", "workspace-a", {
      analyze: async () => { aiCalls += 1; throw new Error("must not run"); },
    }),
    (error: unknown) => error instanceof DocumentAnalysisProcessingError
      && error.code === "DOCUMENT_ANALYSIS_FILE_UNSAFE",
  );
  assert.equal(r2Reads, 0);
  assert.equal(aiCalls, 0);
  fixture.sqlite.close();
});

test("provider diagnostics expose only an allow-listed HTTP category", () => {
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "PROVIDER_UNAVAILABLE", false, 401, "authentication_error")),
    "PROVIDER_HTTP_401",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "PROVIDER_UNAVAILABLE", true, 503, "api_error")),
    "PROVIDER_HTTP_5XX",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "PROVIDER_TIMEOUT", true)),
    "PROVIDER_TIMEOUT",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "INVALID_AI_OUTPUT", false)),
    "INVALID_AI_OUTPUT",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "INVALID_AI_OUTPUT", false, null, "anthropic_output_max_tokens")),
    "INVALID_AI_OUTPUT_MAX_TOKENS",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "INVALID_AI_OUTPUT", false, null, "anthropic_tool_result_missing")),
    "INVALID_AI_OUTPUT_TOOL_RESULT_MISSING",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "INVALID_AI_OUTPUT", false, null, "anthropic_envelope_json_invalid")),
    "INVALID_AI_OUTPUT_ENVELOPE_JSON_INVALID",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "INVALID_AI_OUTPUT", false, null, "anthropic_envelope_schema_invalid")),
    "INVALID_AI_OUTPUT_ENVELOPE_SCHEMA_INVALID",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "INVALID_AI_OUTPUT", false, null, "document_source_boundary")),
    "INVALID_AI_OUTPUT_SOURCE_BOUNDARY",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "INVALID_AI_OUTPUT", false, null, "document_excerpt_boundary")),
    "INVALID_AI_OUTPUT_EXCERPT_BOUNDARY",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("provider payload must never persist", "INVALID_AI_OUTPUT", false, null, "untrusted-provider-detail")),
    "INVALID_AI_OUTPUT",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new AiUnavailableError("response withheld", "PROVIDER_UNAVAILABLE", false, 400)),
    "PROVIDER_HTTP_400",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new ProviderUsageError("PROVIDER_USAGE_PERSISTENCE_FAILED"), "provider"),
    "PROVIDER_USAGE_PERSISTENCE_FAILED",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new Error("opaque provider failure"), "provider"),
    "PROVIDER_EXECUTION_FAILED",
  );
  assert.equal(
    documentAnalysisDiagnosticDetail(new Error("LIKE or GLOB pattern too complex"), "retrieval"),
    "LEGAL_RETRIEVAL_SQLITE_PATTERN_TOO_COMPLEX",
  );
});

test("document provider calls keep append-only usage opaque across queue retries", async () => {
  const base = {
    analysisId: "staging-document-analysis-v1-analysis",
    consentVersion: "synthetic-probe",
  };
  const first = await documentAnalysisProviderUsageEventId({
    row: { ...base, createdAt: "2026-08-12T10:00:00.000Z" },
    environment: "staging",
    provider: "anthropic",
    callStartedAt: "2026-08-12T10:00:01.000Z",
    callOrdinal: 1,
  });
  const firstRepeat = await documentAnalysisProviderUsageEventId({
    row: { ...base, createdAt: "2026-08-12T10:00:00.000Z" },
    environment: "staging",
    provider: "anthropic",
    callStartedAt: "2026-08-12T10:00:01.000Z",
    callOrdinal: 1,
  });
  const queueRetry = await documentAnalysisProviderUsageEventId({
    row: { ...base, createdAt: "2026-08-12T10:00:00.000Z" },
    environment: "staging",
    provider: "anthropic",
    callStartedAt: "2026-08-12T10:05:01.000Z",
    callOrdinal: 1,
  });

  assert.match(first, /^provider_usage_document_v2_[a-f0-9]{48}$/);
  assert.equal(firstRepeat, first);
  assert.notEqual(queueRetry, first);
  assert.equal(first.includes(base.analysisId), false);
  assert.equal(first.includes("2026-08-12"), false);
});

test("ordinary document analysis provider calls do not collide across attempts", async () => {
  const first = await documentAnalysisProviderUsageEventId({
      row: {
        analysisId: "analysis-a",
        consentVersion: "2026-07-30",
        createdAt: "2026-07-30T00:00:00.000Z",
      },
      environment: "staging",
      provider: "openai",
      callStartedAt: "2026-07-30T00:01:00.000Z",
      callOrdinal: 1,
    });
  const retry = await documentAnalysisProviderUsageEventId({
    row: {
      analysisId: "analysis-a",
      consentVersion: "2026-07-30",
      createdAt: "2026-07-30T00:00:00.000Z",
    },
    environment: "staging",
    provider: "openai",
    callStartedAt: "2026-07-30T00:03:00.000Z",
    callOrdinal: 1,
  });
  assert.notEqual(first, retry);
  assert.equal(first.includes("analysis-a"), false);
});

test("document analysis carries a safe provider diagnostic into its worker boundary", async () => {
  const fixture = await databaseFixture("ready", "analysis_safe");
  const bytes = new TextEncoder().encode("Сторона А. срок определяется дополнительно");
  const sha256 = await sha256Hex(bytes);
  fixture.sqlite.prepare("UPDATE document_files SET size_bytes=?,sha256=? WHERE id='file-a'")
    .run(bytes.byteLength, sha256);
  // The provider boundary is the subject of this test. Seed the immutable
  // extracted-text version that would normally be written just before it.
  fixture.sqlite.prepare(`INSERT INTO analysis_document_versions
    (id,analysis_id,workspace_id,owner_user_id,version,parent_version_id,source_kind,r2_key,object_write_id,
     file_name,mime_type,size_bytes,sha256,idempotency_key,selection_sha256,revision_ids_json,created_by_user_id,created_at)
    VALUES ('analysis-source-analysis-a','analysis-a','workspace-a','user-a',1,NULL,'extracted',
      'analysis-versions/workspace-a/analysis-a/1.md',NULL,'contract.normalized-v1.md',
      'text/markdown; charset=utf-8',?,?,NULL,NULL,'[]',NULL,'2026-07-30T00:00:00.000Z')`)
    .run(bytes.byteLength, sha256);

  await assert.rejects(
    executeDocumentAnalysisJob({
      DB: fixture.db,
      BUCKET: {
        async get() {
          return {
            async arrayBuffer() {
              return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
            },
          };
        },
      } as unknown as R2Bucket,
    }, "analysis-a", "workspace-a", {
      extract: async () => ({
        fileName: "contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        pageCount: 1,
        detectedLanguage: "ru",
        textQuality: "good",
        warningCode: null,
        text: new TextDecoder().decode(bytes),
        sections: [],
        packageContext: null,
      }),
      retrieve: async () => ({
        sources: [],
        evidence: [],
        freshness: { status: "unavailable", asOf: "unavailable", ageDays: null, maxAgeDays: 7 },
        legalDatabaseAsOf: "unavailable",
        retrievalMode: "lexical",
        semanticStatus: "unavailable",
        applicableAt: "2026-07-30T10:00:00.000Z",
      }),
      analyze: async () => {
        throw new AiUnavailableError("provider body is intentionally withheld", "PROVIDER_TIMEOUT", true);
      },
    }),
    (error: unknown) => error instanceof DocumentAnalysisProcessingError
      && error.code === "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE"
      && error.diagnosticStage === "provider"
      && error.diagnosticDetail === "PROVIDER_TIMEOUT",
  );

  const analysis = fixture.sqlite.prepare("SELECT status,error_code AS errorCode FROM document_analyses WHERE id='analysis-a'")
    .get() as { status: string; errorCode: string };
  assert.equal(analysis.status, "retrying");
  assert.equal(analysis.errorCode, "DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE");
  fixture.sqlite.close();
});

test("safe retrying document analysis persists normalized result, usage, audit and is idempotent", async () => {
  const fixture = await databaseFixture("retrying", "analysis_safe");
  const bytes = new TextEncoder().encode("Сторона А. срок определяется дополнительно");
  const sha256 = await sha256Hex(bytes);
  fixture.sqlite.prepare("UPDATE document_files SET file_name='package.zip',mime_type='application/zip',size_bytes=?,sha256=? WHERE id='file-a'").run(bytes.byteLength, sha256);
  let aiCalls = 0;
  const packageContext = {
    schemaVersion: 1 as const,
    primaryMemberId: "package-member-01",
    members: [
      { id: "package-member-01", name: "contract.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", role: "primary" as const, detectedLanguage: "ru" as const, pageCount: 1, sectionCount: 1 },
      { id: "package-member-02", name: "annex.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", role: "annex" as const, detectedLanguage: "ru" as const, pageCount: 1, sectionCount: 1 },
    ],
    relationships: [{ fromMemberId: "package-member-02", toMemberId: "package-member-01", kind: "annex_to" as const, confidence: "high" as const, evidence: ["member_role"] }],
  };
  const derived = new Map<string, { bytes: Uint8Array; sha256: string }>();
  const env = {
    DB: fixture.db,
    BUCKET: {
      async get(key: string) {
        const stored = derived.get(key);
        if (stored) return {
          ...r2Metadata(key, stored),
          async arrayBuffer() { return stored.bytes.buffer.slice(stored.bytes.byteOffset, stored.bytes.byteOffset + stored.bytes.byteLength); },
        };
        assert.equal(key, "safe/workspace-a/analysis-a/file-a");
        return { async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
      },
      async head(key: string) {
        const stored = derived.get(key);
        return stored ? r2Metadata(key, stored) : null;
      },
      async put(key: string, value: unknown, options?: { sha256?: string }) {
        assert.ok(value instanceof Uint8Array);
        const stored = { bytes: value.slice(), sha256: await sha256Hex(value) };
        assert.equal(options?.sha256, stored.sha256);
        derived.set(key, stored);
        return r2Metadata(key, stored);
      },
    } as unknown as R2Bucket,
  };
  const dependencies = {
    extract: async () => ({
      fileName: "package.zip",
      mimeType: "application/zip",
      sizeBytes: bytes.byteLength,
      pageCount: 1,
      detectedLanguage: "ru" as const,
      textQuality: "good" as const,
      warningCode: null,
      text: new TextDecoder().decode(bytes),
      sections: [],
      packageContext,
    }),
    retrieve: async () => ({
      sources: [],
      evidence: [],
      freshness: {
        status: "unavailable" as const,
        asOf: "unavailable",
        ageDays: null,
        maxAgeDays: 7,
      },
      legalDatabaseAsOf: "unavailable",
      retrievalMode: "lexical" as const,
      semanticStatus: "unavailable" as const,
      applicableAt: "2026-07-30T10:00:00.000Z",
    }),
    analyze: async (input: Parameters<DocumentAnalysisProcessorDependencies["analyze"]>[0]) => {
      aiCalls += 1;
      assert.deepEqual(input.packageContext, packageContext);
      return {
        data: result,
        provider: "anthropic" as const,
        model: "claude-sonnet-4-6",
        providerResponseId: "synthetic-provider-id",
        attempts: 1,
        latencyMs: 12,
        usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
        fallbackFromProvider: null,
      };
    },
  };
  assert.equal((await executeDocumentAnalysisJob(env, "analysis-a", "workspace-a", dependencies)).status, "completed");
  assert.equal((await executeDocumentAnalysisJob(env, "analysis-a", "workspace-a", dependencies)).status, "already_completed");
  assert.equal(aiCalls, 1);
  const analysis = fixture.sqlite.prepare("SELECT status,error_code AS errorCode FROM document_analyses WHERE id='analysis-a'")
    .get() as { status: string; errorCode: string | null };
  assert.equal(analysis.status, "completed");
  assert.equal(analysis.errorCode, null);
  const persistedSummary = JSON.parse((fixture.sqlite.prepare("SELECT summary_json AS summaryJson FROM document_analyses WHERE id='analysis-a'").get() as { summaryJson: string }).summaryJson) as { extraction: { packageContext: typeof packageContext } };
  assert.deepEqual(persistedSummary.extraction.packageContext, packageContext);

  assert.equal((fixture.sqlite.prepare("SELECT count(*) AS count FROM document_risks").get() as { count: number }).count, 1);
  assert.equal((fixture.sqlite.prepare("SELECT feature,status FROM ai_usage_ledger").get() as { feature: string; status: string }).feature, "document_analysis");
  const persistedRisk = fixture.sqlite.prepare("SELECT risk_type AS riskType,recommendation,proposed_wording AS proposedWording,legal_basis_source_ids_json AS sourceIds FROM document_risks").get() as { riskType: string; recommendation: string; proposedWording: string; sourceIds: string };
  assert.equal(persistedRisk.riskType, "document_internal");
  assert.equal(persistedRisk.recommendation, "Указать точный срок.");
  assert.equal(persistedRisk.proposedWording, "Установить срок в 10 календарных дней.");
  assert.equal(persistedRisk.sourceIds, "[]");
  assert.equal((fixture.sqlite.prepare("SELECT count(*) AS count FROM analysis_document_versions").get() as { count: number }).count, 1);
  assert.equal((fixture.sqlite.prepare("SELECT count(*) AS count FROM suggested_revisions").get() as { count: number }).count, 1);
  assert.equal((fixture.sqlite.prepare("SELECT count(*) AS count FROM user_document_index_jobs").get() as { count: number }).count, 0);
  assert.equal((fixture.sqlite.prepare("SELECT action FROM workspace_audit_events").get() as { action: string }).action, "analysis_completed");
  fixture.sqlite.close();
});

test("a ZIP member requiring OCR schedules the tenant-scoped package OCR queue", async () => {
  const fixture = await databaseFixture("ready", "analysis_safe");
  const bytes = new TextEncoder().encode("synthetic-verified-zip-bytes");
  const sha256 = await sha256Hex(bytes);
  fixture.sqlite.prepare("UPDATE document_files SET mime_type='application/zip',file_name='package.zip',size_bytes=?,sha256=? WHERE id='file-a'")
    .run(bytes.byteLength, sha256);
  let aiCalls = 0;

  await assert.rejects(
    executeDocumentAnalysisJob({
      DB: fixture.db,
      BUCKET: {
        async get() {
          return { async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
        },
      } as unknown as R2Bucket,
    }, "analysis-a", "workspace-a", {
      extract: async () => {
        throw new ComparisonProcessingError("OCR_REQUIRED", "synthetic image member");
      },
      analyze: async () => {
        aiCalls += 1;
        throw new Error("must not run");
      },
    }),
    (error: unknown) => error instanceof DocumentAnalysisProcessingError
      && error.code === "DOCUMENT_ANALYSIS_PACKAGE_OCR_REQUIRED",
  );

  const analysis = fixture.sqlite.prepare("SELECT status,error_code AS errorCode FROM document_analyses WHERE id='analysis-a'")
    .get() as { status: string; errorCode: string };
  assert.equal(analysis.status, "awaiting_ocr");
  assert.equal(analysis.errorCode, "DOCUMENT_ANALYSIS_OCR_REQUIRED");
  assert.deepEqual(
    { ...fixture.sqlite.prepare(
      "SELECT queue_binding AS queueBinding,job_type AS jobType,status FROM job_outbox",
    ).get() as object },
    { queueBinding: "OCR_PROCESSING_QUEUE", jobType: "ocr.process", status: "pending" },
  );
  assert.equal(aiCalls, 0);
  fixture.sqlite.close();
});

test("an expanded ZIP beyond the inline memory budget fails terminally without provider or queue work", async () => {
  const fixture = await databaseFixture("ready", "analysis_safe");
  const bytes = new TextEncoder().encode("synthetic-verified-zip-bytes");
  const sha256 = await sha256Hex(bytes);
  fixture.sqlite.prepare("UPDATE document_files SET mime_type='application/zip',file_name='package.zip',size_bytes=?,sha256=? WHERE id='file-a'")
    .run(bytes.byteLength, sha256);

  await assert.rejects(
    executeDocumentAnalysisJob({
      DB: fixture.db,
      BUCKET: {
        async get() {
          return { async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
        },
      } as unknown as R2Bucket,
    }, "analysis-a", "workspace-a", {
      extract: async () => {
        throw new PackageExtractionError("synthetic capacity boundary");
      },
    }),
    (error: unknown) => error instanceof DocumentAnalysisProcessingError
      && error.code === "DOCUMENT_ANALYSIS_CAPACITY_REQUIRED",
  );

  const analysis = fixture.sqlite.prepare("SELECT status,error_code AS errorCode FROM document_analyses WHERE id='analysis-a'")
    .get() as { status: string; errorCode: string };
  assert.equal(analysis.status, "failed");
  assert.equal(analysis.errorCode, "DOCUMENT_ANALYSIS_CAPACITY_REQUIRED");
  assert.equal((fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM job_outbox").get() as { count: number }).count, 0);
  fixture.sqlite.close();
});

test("large quick analysis uses one bounded representative provider request", async () => {
  const fixture = await databaseFixture("ready", "analysis_safe");
  const bytes = new TextEncoder().encode("synthetic-verified-pdf-bytes");
  const sha256 = await sha256Hex(bytes);
  fixture.sqlite.prepare("UPDATE document_files SET mime_type='application/pdf',file_name='contract.pdf',size_bytes=?,sha256=? WHERE id='file-a'")
    .run(bytes.byteLength, sha256);
  let aiCalls = 0;
  let retrievalLimit = 0;
  const stored = new Map<string, { bytes: Uint8Array; sha256: string }>();
  const longText = `${"x".repeat(DOCUMENT_ANALYSIS_INLINE_TEXT_LIMIT + 1)} срок определяется дополнительно`;

  const completed = await executeDocumentAnalysisJob({
    DB: fixture.db,
    LEGAL_CORPUS_USER_UPLOAD_AUTO_TRUST: "true",
    BUCKET: {
      async get(key: string) {
        const version = stored.get(key);
        if (version) return {
          ...r2Metadata(key, version),
          async arrayBuffer() { return version.bytes.buffer.slice(version.bytes.byteOffset, version.bytes.byteOffset + version.bytes.byteLength); },
        };
        return { async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
      },
      async head(key: string) {
        const version = stored.get(key);
        return version ? r2Metadata(key, version) : null;
      },
      async put(key: string, value: unknown, options?: { sha256?: string }) {
        assert.ok(value instanceof Uint8Array);
        const version = { bytes: value.slice(), sha256: await sha256Hex(value) };
        assert.equal(options?.sha256, version.sha256);
        stored.set(key, version);
        return r2Metadata(key, version);
      },
    } as unknown as R2Bucket,
  }, "analysis-a", "workspace-a", {
      extract: async () => ({
        fileName: "contract.pdf",
        mimeType: "application/pdf",
        sizeBytes: bytes.byteLength,
        pageCount: 1,
        detectedLanguage: "ru",
        textQuality: "good",
        warningCode: null,
        text: longText,
        sections: [],
        packageContext: null,
      }),
      retrieve: async (_db, _query, _locale, limit) => {
        retrievalLimit = limit ?? 0;
        return {
          sources: [],
          freshness: { status: "unavailable" as const, asOf: "unavailable", ageDays: null, maxAgeDays: 7 },
          legalDatabaseAsOf: "unavailable",
        };
      },
      analyze: async (input) => {
        aiCalls += 1;
        assert.equal(input.extractedText.length <= QUICK_DOCUMENT_ANALYSIS_INPUT_SIZE, true);
        assert.equal(input.extractionWarnings.includes("DOCUMENT_QUICK_REPRESENTATIVE_SAMPLE"), true);
        assert.equal(input.extractedText.includes("JURO_REPRESENTATIVE_SAMPLE_BOUNDARY"), true);
        return {
          data: result,
          provider: "anthropic" as const,
          model: "claude-sonnet-4-6",
          providerResponseId: `synthetic-long-${aiCalls}`,
          attempts: 1,
          latencyMs: 12,
          usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 0 },
          fallbackFromProvider: null,
        };
      },
  });

  const analysis = fixture.sqlite.prepare("SELECT status,error_code AS errorCode FROM document_analyses WHERE id='analysis-a'")
    .get() as { status: string; errorCode: string };
  assert.equal(completed.status, "completed");
  assert.equal(analysis.status, "completed");
  assert.equal(analysis.errorCode, null);
  assert.equal(aiCalls, 1);
  assert.equal(retrievalLimit, 3);
  assert.equal((fixture.sqlite.prepare("SELECT COUNT(*) AS count FROM job_outbox").get() as { count: number }).count, 1);
  fixture.sqlite.close();
});

async function databaseFixture(status: string, fileKind: string) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE workspaces(id TEXT PRIMARY KEY);
    CREATE TABLE user_profiles(id TEXT PRIMARY KEY);
    INSERT INTO workspaces VALUES ('workspace-a'),('workspace-b');
    INSERT INTO user_profiles VALUES ('user-a');
    CREATE TABLE document_files (id TEXT PRIMARY KEY,workspace_id TEXT,owner_user_id TEXT NOT NULL,kind TEXT NOT NULL,r2_key TEXT NOT NULL UNIQUE,file_name TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT,archived_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE document_analyses (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,uploaded_file_id TEXT NOT NULL UNIQUE,status TEXT NOT NULL,summary_json TEXT,result_sha256 TEXT,error_code TEXT,consent_version TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE file_extractions (id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL UNIQUE,file_id TEXT NOT NULL,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,status TEXT NOT NULL,method TEXT NOT NULL,provider TEXT NOT NULL,model TEXT,source_sha256 TEXT NOT NULL,r2_key TEXT,text_sha256 TEXT,size_bytes INTEGER,token_estimate INTEGER,detected_mime_type TEXT,detected_language TEXT,text_quality TEXT,warnings_json TEXT NOT NULL DEFAULT '[]',error_code TEXT,completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE job_outbox (id TEXT PRIMARY KEY,queue_binding TEXT NOT NULL,job_type TEXT NOT NULL,schema_version INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,subject_id TEXT NOT NULL,workspace_id TEXT,correlation_id TEXT NOT NULL,enqueued_at TEXT NOT NULL,available_at TEXT NOT NULL,status TEXT NOT NULL,dispatch_attempts INTEGER NOT NULL,lease_owner TEXT,lease_expires_at TEXT,next_attempt_at TEXT,dispatched_at TEXT,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE document_risks (id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL,level TEXT NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,excerpt TEXT,confidence_percent INTEGER,risk_type TEXT NOT NULL DEFAULT 'document_internal',clause TEXT,page INTEGER,recommendation TEXT,proposed_wording TEXT,legal_basis_source_ids_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL);
    CREATE TABLE analysis_document_versions (id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,version INTEGER NOT NULL,parent_version_id TEXT,source_kind TEXT NOT NULL,r2_key TEXT NOT NULL,object_write_id TEXT,file_name TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,idempotency_key TEXT,selection_sha256 TEXT,revision_ids_json TEXT NOT NULL DEFAULT '[]',created_by_user_id TEXT,created_at TEXT NOT NULL,UNIQUE(analysis_id,version));
    CREATE TABLE user_document_index_jobs (id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL,document_version_id TEXT NOT NULL UNIQUE,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,source_hash TEXT NOT NULL,language TEXT NOT NULL,access_scope TEXT NOT NULL,status TEXT NOT NULL,chunk_count INTEGER NOT NULL,attempt_count INTEGER NOT NULL,mutation_id TEXT,error_code TEXT,started_at TEXT,submitted_at TEXT,deleted_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE user_document_vector_chunks (id TEXT PRIMARY KEY,job_id TEXT NOT NULL,vector_id TEXT NOT NULL UNIQUE,chunk_index INTEGER NOT NULL,char_start INTEGER NOT NULL,char_end INTEGER NOT NULL,page INTEGER NOT NULL,status TEXT NOT NULL,mutation_id TEXT,submitted_at TEXT NOT NULL,deleted_at TEXT);
    CREATE TABLE analysis_version_object_writes (id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,target_version INTEGER NOT NULL,source_kind TEXT NOT NULL,r2_key TEXT NOT NULL UNIQUE,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,status TEXT NOT NULL,version_id TEXT,attempt_count INTEGER NOT NULL,last_error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,reconciled_at TEXT);
    CREATE TRIGGER analysis_document_versions_object_write_attach AFTER INSERT ON analysis_document_versions WHEN NEW.object_write_id IS NOT NULL BEGIN UPDATE analysis_version_object_writes SET status='attached',version_id=NEW.id,last_error_code=NULL,updated_at=NEW.created_at,reconciled_at=NEW.created_at WHERE id=NEW.object_write_id AND status='attaching'; END;
    CREATE TABLE suggested_revisions (id TEXT PRIMARY KEY,analysis_id TEXT NOT NULL,risk_id TEXT NOT NULL,source_version_id TEXT NOT NULL,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,original_text TEXT NOT NULL,proposed_text TEXT NOT NULL,status TEXT NOT NULL,decided_by_user_id TEXT,decided_at TEXT,applied_version_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE ai_runs (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT,request_message_id TEXT,response_message_id TEXT,idempotency_key TEXT NOT NULL,correlation_id TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,provider_response_id TEXT,fallback_from_provider TEXT,answer_mode TEXT NOT NULL,reasoning_mode TEXT NOT NULL,status TEXT NOT NULL,legal_database_as_of TEXT NOT NULL,instruction_hash TEXT NOT NULL,source_version_hash TEXT NOT NULL,input_tokens INTEGER NOT NULL DEFAULT 0,output_tokens INTEGER NOT NULL DEFAULT 0,cached_input_tokens INTEGER NOT NULL DEFAULT 0,estimated_cost_microusd INTEGER,attempt_count INTEGER NOT NULL DEFAULT 0,latency_ms INTEGER,error_code TEXT,started_at TEXT NOT NULL,completed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(workspace_id,user_id,idempotency_key));
    CREATE TABLE ai_usage_ledger (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,ai_run_id TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL,feature TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,units INTEGER NOT NULL,status TEXT NOT NULL,provider TEXT NOT NULL,model TEXT NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,cached_input_tokens INTEGER NOT NULL,estimated_cost_microusd INTEGER,released_at TEXT,consumed_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(workspace_id,user_id,idempotency_key));
    CREATE TABLE workspace_audit_events (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,actor_user_id TEXT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,metadata_json TEXT NOT NULL,created_at TEXT NOT NULL);
    INSERT INTO document_files VALUES ('file-a','workspace-a','user-a','${fileKind}','safe/workspace-a/analysis-a/file-a','contract.pdf','application/pdf',1,'${"0".repeat(64)}',NULL,'2026-07-30T00:00:00.000Z','2026-07-30T00:00:00.000Z');
    INSERT INTO document_analyses VALUES ('analysis-a','workspace-a','user-a','file-a','${status}','{"mode":"quick","locale":"ru"}',NULL,NULL,'2026-07-30','2026-07-30T00:00:00.000Z','2026-07-30T00:00:00.000Z');
    ALTER TABLE document_analyses ADD COLUMN progress_stage TEXT;
  `);
  return { sqlite, db: sqliteD1(sqlite) };
}

class TestStatement {
  constructor(private readonly sqlite: DatabaseSync, private readonly sql: string, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new TestStatement(this.sqlite, this.sql, values); }
  first<T>(): T | null { return (this.sqlite.prepare(this.sql).get(...this.bindings()) as T | undefined) ?? null; }
  all<T>() {
    return {
      results: this.sqlite.prepare(this.sql).all(...this.bindings()) as T[],
      success: true as const,
      meta: { changes: 0 },
    };
  }
  run() {
    const result = this.sqlite.prepare(this.sql).run(...this.bindings());
    return { results: [], success: true as const, meta: { changes: Number(result.changes) } };
  }
  private bindings() { return this.values as Array<null | number | bigint | string>; }
}

function sqliteD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) { return new TestStatement(sqlite, sql); },
    async batch(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => (statement as unknown as TestStatement).run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function r2Metadata(key: string, value: { bytes: Uint8Array; sha256: string }) {
  return {
    key,
    version: "synthetic",
    size: value.bytes.byteLength,
    etag: value.sha256,
    httpEtag: `"${value.sha256}"`,
    uploaded: new Date("2026-07-30T00:00:00.000Z"),
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: {},
    range: undefined,
    checksums: { sha256: Uint8Array.from(value.sha256.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16))).buffer },
    storageClass: "Standard",
    ssecKeyMd5: undefined,
    writeHttpMetadata() {},
  };
}
