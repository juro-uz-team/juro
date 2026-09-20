import { z } from "zod";

import { POST as executeAiPostForInternalEvaluation } from "../../app/api/platform/ai/route";
import {
  LEGAL_EVALUATION_CORPUS_VERSION,
} from "../../evaluation/legal-evaluation-contract";
import {
  LEGAL_EVALUATION_BEHAVIORS,
  legalEvaluationCorpus,
  type LegalEvaluationScenario,
} from "../../evaluation/legal-evaluation-corpus";
import { randomToken, sha256 } from "../auth/crypto";
import {
  prepareUserIdentityWrite,
  userIdentityWriteBindings,
} from "../auth/identity-protection";
import { runtimeIdentityProtection } from "../auth/identity-runtime";
import { SESSION_COOKIE } from "../auth/session-token";
import {
  requireD1,
  runtimeEnv,
  type BuilderRuntimeEnv,
} from "../document-builder/storage/runtime";
import { sha256Json } from "./run-store";

const ZERO_HASH = "0".repeat(64);
const evaluationIdentifier = z.string().trim().min(8).max(120)
  .regex(/^[A-Za-z0-9._:-]+$/);
const scenarioIdentifier = z.string().trim().min(1).max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const stagingLegalEvaluationRunInputSchema = z.object({
  action: z.literal("run"),
  evaluationRunId: evaluationIdentifier,
  scenarioId: scenarioIdentifier,
  attempt: z.number().int().min(1).max(5),
}).strict();

export const stagingLegalEvaluationReadInputSchema = z.object({
  action: z.literal("read"),
  evaluationRunId: evaluationIdentifier,
  scenarioId: scenarioIdentifier.optional(),
}).strict();

export const stagingLegalEvaluationReviewInputSchema = z.object({
  action: z.literal("review"),
  evaluationRunId: evaluationIdentifier,
  scenarioId: scenarioIdentifier,
  reviewerTaskId: evaluationIdentifier,
  classification: z.enum([
    "correct",
    "partially_incorrect",
    "incorrect",
    "unsafe",
    "outdated_source",
    "broken_citation",
    "insufficient_context",
    "language_issue",
  ]),
  languageQuality: z.number().int().min(0).max(100),
  observedBehaviors: z.array(z.enum(LEGAL_EVALUATION_BEHAVIORS))
    .max(LEGAL_EVALUATION_BEHAVIORS.length),
  metrics: z.object({
    criticalDeadlineDetected: z.boolean().optional(),
    retrievalRank1Matched: z.boolean().optional(),
    retrievalRank3Matched: z.boolean().optional(),
    supportedLegalClaimCount: z.number().int().min(0).max(1_000).optional(),
    unsupportedLegalClaimCount: z.number().int().min(0).max(1_000).optional(),
    citedLegalClaimCount: z.number().int().min(0).max(1_000).optional(),
    validCitedLegalClaimCount: z.number().int().min(0).max(1_000).optional(),
    sourceQualityPassed: z.boolean().optional(),
    uiNoiseDetected: z.boolean().optional(),
    refused: z.boolean().optional(),
    providerTimedOut: z.boolean().optional(),
  }).strict(),
  notes: z.string().trim().min(1).max(4_000),
}).strict();

export const stagingLegalEvaluationRequestSchema = z.discriminatedUnion("action", [
  stagingLegalEvaluationRunInputSchema,
  stagingLegalEvaluationReadInputSchema,
  stagingLegalEvaluationReviewInputSchema,
]);

type RunInput = z.infer<typeof stagingLegalEvaluationRunInputSchema>;
type ReadInput = z.infer<typeof stagingLegalEvaluationReadInputSchema>;
type ReviewInput = z.infer<typeof stagingLegalEvaluationReviewInputSchema>;

type AttemptRow = {
  attemptId: string;
  evaluationRunId: string;
  scenarioId: string;
  attemptNumber: number;
  aiRunId: string | null;
  status: "running" | "completed" | "failed";
  httpStatus: number | null;
  safeErrorCode: string | null;
  workerVersionId: string;
  workerVersionCreatedAt: string;
  startedAt: string;
  completedAt: string | null;
};

type CompletedRunRow = {
  attemptId: string;
  scenarioId: string;
  attemptNumber: number;
  promptSha256: string;
  aiRunId: string;
  provider: string;
  model: string;
  instructionHash: string;
  legalDatabaseAsOf: string;
  sourceVersionHash: string;
  runCompletedAt: string;
  question: string;
  answer: string;
  structuredJson: string;
  responseSha256: string;
  workerVersionId: string;
  workerVersionCreatedAt: string;
  startedAt: string;
  completedAt: string;
  reviewId: string | null;
  reviewerKind: string | null;
  reviewerId: string | null;
  reviewerTaskId: string | null;
  attestation: string | null;
  classification: string | null;
  languageQuality: number | null;
  observedBehaviorsJson: string | null;
  metricsJson: string | null;
  notes: string | null;
  questionSha256: string | null;
  answerSha256: string | null;
  previousHash: string | null;
  eventHash: string | null;
  reviewedAt: string | null;
};

export class StagingLegalEvaluationError extends Error {
  constructor(readonly code: string, readonly status = 400) {
    super(code);
    this.name = "StagingLegalEvaluationError";
  }
}

export function stagingLegalEvaluationEnabled(
  env: Pick<BuilderRuntimeEnv, "APP_ENV" | "STAGING_LEGAL_EVALUATION_ENABLED">,
): boolean {
  return env.APP_ENV === "staging"
    && env.STAGING_LEGAL_EVALUATION_ENABLED === "true";
}

function scenarioById(scenarioId: string): LegalEvaluationScenario {
  const scenario = legalEvaluationCorpus.find((candidate) => candidate.id === scenarioId);
  if (!scenario) throw new StagingLegalEvaluationError("LEGAL_EVALUATION_SCENARIO_NOT_FOUND", 404);
  return scenario;
}

function safeCode(value: unknown, fallback: string): string {
  if (typeof value === "string" && /^[A-Z0-9_]{3,64}$/.test(value)) return value;
  return fallback;
}

function stablePrefix(evaluationRunId: string, scenarioId: string, attempt: number, digest: string) {
  const token = digest.slice(0, 32);
  return {
    attemptId: `legal_eval_attempt_${token}`,
    userId: `legal_eval_user_${token}`,
    workspaceId: `legal_eval_workspace_${token}`,
    membershipId: `legal_eval_member_${token}`,
    conversationId: `legal_eval_conversation_${token}`,
    sessionId: `legal_eval_session_${token}`,
    idempotencyKey: `legal-eval:${evaluationRunId}:${scenarioId}:${attempt}`.slice(0, 128),
  };
}

function versionEvidence(env: BuilderRuntimeEnv): { id: string; timestamp: string } {
  const version = env.WORKER_VERSION;
  if (!version?.id || !version.timestamp) {
    throw new StagingLegalEvaluationError("LEGAL_EVALUATION_WORKER_VERSION_UNAVAILABLE", 503);
  }
  return { id: version.id, timestamp: String(version.timestamp) };
}

async function existingAttempt(
  db: D1Database,
  evaluationRunId: string,
  scenarioId: string,
  attempt: number,
): Promise<AttemptRow | null> {
  return db.prepare(
    `SELECT id AS attemptId,evaluation_run_id AS evaluationRunId,scenario_id AS scenarioId,
      attempt_number AS attemptNumber,ai_run_id AS aiRunId,status,http_status AS httpStatus,
      safe_error_code AS safeErrorCode,worker_version_id AS workerVersionId,
      worker_version_created_at AS workerVersionCreatedAt,started_at AS startedAt,
      completed_at AS completedAt
     FROM staging_legal_evaluation_attempts
     WHERE evaluation_run_id=? AND scenario_id=? AND attempt_number=? LIMIT 1`,
  ).bind(evaluationRunId, scenarioId, attempt).first<AttemptRow>();
}

async function prepareTenant(input: {
  db: D1Database;
  scenario: LegalEvaluationScenario;
  evaluationRunId: string;
  attempt: number;
  ids: ReturnType<typeof stablePrefix>;
  attemptId: string;
  promptSha256: string;
  version: { id: string; timestamp: string };
  startedAt: string;
}): Promise<void> {
  const email = `legal-eval-${input.ids.userId.slice(-32)}@example.test`;
  const identity = await prepareUserIdentityWrite(runtimeIdentityProtection(), {
    userId: input.ids.userId,
    email,
    phone: null,
  });
  const statements: D1PreparedStatement[] = [
    input.db.prepare(
      `INSERT INTO user_profiles (
        id,email,email_ciphertext,email_iv,email_key_version,
        email_lookup_hash,email_lookup_key_version,
        phone,phone_ciphertext,phone_iv,phone_key_version,
        phone_lookup_hash,phone_lookup_key_version,
        full_name,locale,account_type,lifecycle_status,onboarding_completed_at,
        created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?,?)`,
    ).bind(
      input.ids.userId,
      ...userIdentityWriteBindings(identity),
      "JURO canonical staging legal evaluation",
      input.scenario.locale,
      input.scenario.accountType,
      input.startedAt,
      input.startedAt,
      input.startedAt,
    ),
    input.db.prepare(
      `INSERT INTO workspaces (id,type,name,locale,created_at,updated_at)
       VALUES (?,'individual','JURO canonical staging legal evaluation',?,?,?)`,
    ).bind(input.ids.workspaceId, input.scenario.locale, input.startedAt, input.startedAt),
    input.db.prepare(
      `INSERT INTO workspace_members (
        id,workspace_id,user_id,role,status,joined_at,created_at,updated_at
       ) VALUES (?,?,?,'owner','active',?,?,?)`,
    ).bind(
      input.ids.membershipId,
      input.ids.workspaceId,
      input.ids.userId,
      input.startedAt,
      input.startedAt,
      input.startedAt,
    ),
    input.db.prepare("UPDATE user_profiles SET default_workspace_id=? WHERE id=?")
      .bind(input.ids.workspaceId, input.ids.userId),
    input.db.prepare(
      `INSERT INTO staging_legal_evaluation_attempts (
        id,evaluation_run_id,scenario_id,attempt_number,corpus_version,locale,
        account_type,prompt_sha256,user_id,workspace_id,conversation_id,ai_run_id,
        status,http_status,safe_error_code,response_sha256,worker_version_id,
        worker_version_created_at,started_at,completed_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,NULL,NULL,'running',NULL,NULL,NULL,?,?,?,NULL)`,
    ).bind(
      input.attemptId,
      input.evaluationRunId,
      input.scenario.id,
      input.attempt,
      LEGAL_EVALUATION_CORPUS_VERSION,
      input.scenario.locale,
      input.scenario.accountType,
      input.promptSha256,
      input.ids.userId,
      input.ids.workspaceId,
      input.version.id,
      input.version.timestamp,
      input.startedAt,
    ),
  ];

  if (input.scenario.conversationHistory?.length) {
    statements.push(input.db.prepare(
      `INSERT INTO conversations (
        id,workspace_id,owner_user_id,case_id,title,locale,status,created_at,updated_at
       ) VALUES (?,?,?,NULL,?,?,'active',?,?)`,
    ).bind(
      input.ids.conversationId,
      input.ids.workspaceId,
      input.ids.userId,
      input.scenario.prompt.slice(0, 120),
      input.scenario.locale,
      input.startedAt,
      input.startedAt,
    ));
    let parentBranchId: string | null = null;
    for (const [index, turn] of input.scenario.conversationHistory.entries()) {
      const suffix = `${index + 1}`;
      const userMessageId = `${input.ids.conversationId}_history_user_${suffix}`;
      const assistantMessageId = `${input.ids.conversationId}_history_assistant_${suffix}`;
      const branchId = `${input.ids.conversationId}_history_branch_${suffix}`;
      const versionId = `${input.ids.conversationId}_history_version_${suffix}`;
      const createdAt = new Date(Date.parse(input.startedAt) + index).toISOString();
      statements.push(
        input.db.prepare(
          "INSERT INTO conversation_messages (id,conversation_id,author_type,content,created_at) VALUES (?,?,'user',?,?)",
        ).bind(userMessageId, input.ids.conversationId, turn.user, createdAt),
        input.db.prepare(
          "INSERT INTO conversation_messages (id,conversation_id,author_type,content,created_at) VALUES (?,?,'assistant',?,?)",
        ).bind(assistantMessageId, input.ids.conversationId, turn.assistant, createdAt),
        input.db.prepare(
          `INSERT INTO message_branches (
            id,conversation_id,workspace_id,owner_user_id,parent_branch_id,
            forked_from_message_id,request_message_id,response_message_id,operation,created_at
           ) VALUES (?,?,?,?,?,NULL,?,?,'follow_up',?)`,
        ).bind(
          branchId,
          input.ids.conversationId,
          input.ids.workspaceId,
          input.ids.userId,
          parentBranchId,
          userMessageId,
          assistantMessageId,
          createdAt,
        ),
        input.db.prepare(
          `INSERT INTO message_versions (
            id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,
            operation,version_number,content_sha256,created_at
           ) VALUES (?,?,?,?,NULL,?,'follow_up',1,?,?)`,
        ).bind(
          versionId,
          input.ids.conversationId,
          branchId,
          userMessageId,
          input.ids.userId,
          await sha256(turn.user),
          createdAt,
        ),
      );
      parentBranchId = branchId;
    }
  }
  await input.db.batch(statements);
}

async function finishAttemptFailed(input: {
  db: D1Database;
  attemptId: string;
  httpStatus: number;
  safeErrorCode: string;
  conversationId?: string | null;
  aiRunId?: string | null;
}): Promise<void> {
  await input.db.prepare(
    `UPDATE staging_legal_evaluation_attempts
     SET conversation_id=?,ai_run_id=?,status='failed',http_status=?,safe_error_code=?,completed_at=?
     WHERE id=? AND status='running'`,
  ).bind(
    input.conversationId ?? null,
    input.aiRunId ?? null,
    Math.max(400, Math.min(599, input.httpStatus)),
    safeCode(input.safeErrorCode, "LEGAL_EVALUATION_RUN_FAILED"),
    new Date().toISOString(),
    input.attemptId,
  ).run();
}

export async function runStagingLegalEvaluationScenario(input: RunInput) {
  const env = runtimeEnv();
  if (!stagingLegalEvaluationEnabled(env)) {
    throw new StagingLegalEvaluationError("LEGAL_EVALUATION_DISABLED", 404);
  }
  const version = versionEvidence(env);
  const db = requireD1();
  const scenario = scenarioById(input.scenarioId);
  const prior = await existingAttempt(db, input.evaluationRunId, scenario.id, input.attempt);
  if (prior) return { ...prior, replay: true };

  const digest = await sha256(`${input.evaluationRunId}\n${scenario.id}\n${input.attempt}`);
  const ids = stablePrefix(input.evaluationRunId, scenario.id, input.attempt, digest);
  const promptSha256 = await sha256(scenario.prompt);
  const startedAt = new Date().toISOString();
  await prepareTenant({
    db,
    scenario,
    evaluationRunId: input.evaluationRunId,
    attempt: input.attempt,
    ids,
    attemptId: ids.attemptId,
    promptSha256,
    version,
    startedAt,
  });

  const sessionToken = randomToken(32);
  const sessionHash = await sha256(sessionToken);
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await db.prepare(
    `INSERT INTO auth_sessions (
      id,user_id,token_hash,auth_method,assurance_level,authenticated_at,
      mfa_verified_at,expires_at,idle_expires_at,revoked_at,created_at,last_seen_at
     ) VALUES (?,?,?,'staging_evaluation','primary',?,NULL,?,?,NULL,?,?)`,
  ).bind(
    ids.sessionId,
    ids.userId,
    sessionHash,
    startedAt,
    expiresAt,
    expiresAt,
    startedAt,
    startedAt,
  ).run();

  let terminalBody: Record<string, unknown> | null = null;
  let terminalStatus = 500;
  try {
    const request = new Request("https://staging.app.juro.uz/api/platform/ai", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-juro-csrf": "1",
        origin: "https://staging.app.juro.uz",
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(sessionToken)}`,
        "idempotency-key": ids.idempotencyKey,
      },
      body: JSON.stringify({
        idempotencyKey: ids.idempotencyKey,
        question: scenario.prompt,
        locale: scenario.locale,
        conversationId: scenario.conversationHistory?.length ? ids.conversationId : undefined,
        operation: scenario.conversationHistory?.length ? "follow_up" : "new",
        answerMode: "detailed",
        reasoningMode: "fast",
      }),
    });
    const response = await executeAiPostForInternalEvaluation(request);
    terminalStatus = response.status;
    terminalBody = await response.json().catch(() => null) as Record<string, unknown> | null;
    const runId = typeof terminalBody?.runId === "string" ? terminalBody.runId : null;
    const conversationId = typeof terminalBody?.conversationId === "string"
      ? terminalBody.conversationId
      : scenario.conversationHistory?.length ? ids.conversationId : null;
    if (!response.ok || !runId || !conversationId) {
      await finishAttemptFailed({
        db,
        attemptId: ids.attemptId,
        httpStatus: response.status,
        safeErrorCode: safeCode(terminalBody?.code, "LEGAL_EVALUATION_AI_ROUTE_FAILED"),
        conversationId,
        aiRunId: runId,
      });
      return {
        attemptId: ids.attemptId,
        evaluationRunId: input.evaluationRunId,
        scenarioId: scenario.id,
        attemptNumber: input.attempt,
        status: "failed" as const,
        httpStatus: response.status,
        safeErrorCode: safeCode(terminalBody?.code, "LEGAL_EVALUATION_AI_ROUTE_FAILED"),
        replay: false,
      };
    }
    const persisted = await db.prepare(
      `SELECT run.status,request.content AS question,response.content AS answer,
        response.structured_json AS structuredJson
       FROM ai_runs run
       JOIN conversation_messages request ON request.id=run.request_message_id
       JOIN conversation_messages response ON response.id=run.response_message_id
       WHERE run.id=? AND run.conversation_id=? AND run.workspace_id=? AND run.user_id=?
       LIMIT 1`,
    ).bind(runId, conversationId, ids.workspaceId, ids.userId).first<{
      status: string;
      question: string;
      answer: string;
      structuredJson: string | null;
    }>();
    if (
      persisted?.status !== "completed"
      || persisted.question !== scenario.prompt
      || !persisted.structuredJson
    ) {
      await finishAttemptFailed({
        db,
        attemptId: ids.attemptId,
        httpStatus: 500,
        safeErrorCode: "LEGAL_EVALUATION_PERSISTENCE_MISMATCH",
        conversationId,
        aiRunId: runId,
      });
      return {
        attemptId: ids.attemptId,
        evaluationRunId: input.evaluationRunId,
        scenarioId: scenario.id,
        attemptNumber: input.attempt,
        status: "failed" as const,
        httpStatus: 500,
        safeErrorCode: "LEGAL_EVALUATION_PERSISTENCE_MISMATCH",
        replay: false,
      };
    }
    const responseSha256 = await sha256Json({
      answer: persisted.answer,
      structuredJson: persisted.structuredJson,
    });
    const completedAt = new Date().toISOString();
    await db.prepare(
      `UPDATE staging_legal_evaluation_attempts
       SET conversation_id=?,ai_run_id=?,status='completed',http_status=?,safe_error_code=NULL,
         response_sha256=?,completed_at=?
       WHERE id=? AND status='running'`,
    ).bind(
      conversationId,
      runId,
      response.status,
      responseSha256,
      completedAt,
      ids.attemptId,
    ).run();
    return {
      attemptId: ids.attemptId,
      evaluationRunId: input.evaluationRunId,
      scenarioId: scenario.id,
      attemptNumber: input.attempt,
      aiRunId: runId,
      status: "completed" as const,
      httpStatus: response.status,
      responseSha256,
      workerVersionId: version.id,
      workerVersionCreatedAt: version.timestamp,
      completedAt,
      replay: false,
    };
  } catch (error) {
    await finishAttemptFailed({
      db,
      attemptId: ids.attemptId,
      httpStatus: terminalStatus,
      safeErrorCode: error instanceof StagingLegalEvaluationError
        ? error.code
        : "LEGAL_EVALUATION_INTERNAL_FAILED",
      conversationId: typeof terminalBody?.conversationId === "string"
        ? terminalBody.conversationId
        : scenario.conversationHistory?.length ? ids.conversationId : null,
      aiRunId: typeof terminalBody?.runId === "string" ? terminalBody.runId : null,
    });
    throw error;
  } finally {
    await db.prepare("DELETE FROM auth_sessions WHERE id=? AND user_id=?")
      .bind(ids.sessionId, ids.userId).run().catch(() => undefined);
  }
}

function completedRunQuery(singleScenario: boolean): string {
  return `SELECT attempt.id AS attemptId,attempt.scenario_id AS scenarioId,
    attempt.attempt_number AS attemptNumber,attempt.prompt_sha256 AS promptSha256,
    run.id AS aiRunId,run.provider,run.model,run.instruction_hash AS instructionHash,
    run.legal_database_as_of AS legalDatabaseAsOf,run.source_version_hash AS sourceVersionHash,
    run.completed_at AS runCompletedAt,question.content AS question,answer.content AS answer,
    answer.structured_json AS structuredJson,attempt.response_sha256 AS responseSha256,
    attempt.worker_version_id AS workerVersionId,
    attempt.worker_version_created_at AS workerVersionCreatedAt,
    attempt.started_at AS startedAt,attempt.completed_at AS completedAt,
    review.id AS reviewId,review.reviewer_kind AS reviewerKind,
    review.reviewer_id AS reviewerId,review.reviewer_task_id AS reviewerTaskId,
    review.attestation,review.classification,review.language_quality AS languageQuality,
    review.observed_behaviors_json AS observedBehaviorsJson,
    review.metrics_json AS metricsJson,review.notes,
    review.question_sha256 AS questionSha256,review.answer_sha256 AS answerSha256,
    review.previous_hash AS previousHash,review.event_hash AS eventHash,
    review.created_at AS reviewedAt
   FROM staging_legal_evaluation_attempts attempt
   JOIN ai_runs run ON run.id=attempt.ai_run_id AND run.status='completed'
   JOIN conversation_messages question ON question.id=run.request_message_id
   JOIN conversation_messages answer ON answer.id=run.response_message_id
   LEFT JOIN staging_legal_evaluation_agent_reviews review
     ON review.attempt_id=attempt.id AND review.ai_run_id=run.id
   WHERE attempt.evaluation_run_id=? AND attempt.status='completed'
     ${singleScenario ? "AND attempt.scenario_id=?" : ""}
     AND attempt.attempt_number=(
       SELECT min(candidate.attempt_number)
       FROM staging_legal_evaluation_attempts candidate
       WHERE candidate.evaluation_run_id=attempt.evaluation_run_id
         AND candidate.scenario_id=attempt.scenario_id
         AND candidate.status='completed'
     )
   ORDER BY attempt.scenario_id`;
}

export async function readStagingLegalEvaluation(input: ReadInput) {
  const env = runtimeEnv();
  if (!stagingLegalEvaluationEnabled(env)) {
    throw new StagingLegalEvaluationError("LEGAL_EVALUATION_DISABLED", 404);
  }
  const db = requireD1();
  const statement = db.prepare(completedRunQuery(Boolean(input.scenarioId)));
  const rows = input.scenarioId
    ? await statement.bind(input.evaluationRunId, input.scenarioId).all<CompletedRunRow>()
    : await statement.bind(input.evaluationRunId).all<CompletedRunRow>();
  const attemptSummary = await db.prepare(
    `SELECT status,count(*) AS count
     FROM staging_legal_evaluation_attempts WHERE evaluation_run_id=? GROUP BY status`,
  ).bind(input.evaluationRunId).all<{ status: string; count: number }>();
  return {
    evaluationRunId: input.evaluationRunId,
    corpusVersion: LEGAL_EVALUATION_CORPUS_VERSION,
    corpusSize: legalEvaluationCorpus.length,
    attempts: Object.fromEntries(attemptSummary.results.map((row) => [row.status, Number(row.count)])),
    records: rows.results.map((row) => ({
      ...row,
      scenario: scenarioById(row.scenarioId),
      structuredOutput: JSON.parse(row.structuredJson) as unknown,
      observedBehaviors: row.observedBehaviorsJson ? JSON.parse(row.observedBehaviorsJson) as unknown : null,
      metrics: row.metricsJson ? JSON.parse(row.metricsJson) as unknown : null,
    })),
  };
}

export async function reviewStagingLegalEvaluation(input: ReviewInput) {
  const env = runtimeEnv();
  if (!stagingLegalEvaluationEnabled(env)) {
    throw new StagingLegalEvaluationError("LEGAL_EVALUATION_DISABLED", 404);
  }
  const db = requireD1();
  const scenario = scenarioById(input.scenarioId);
  const read = await readStagingLegalEvaluation({
    action: "read",
    evaluationRunId: input.evaluationRunId,
    scenarioId: scenario.id,
  });
  const record = read.records[0];
  if (!record) throw new StagingLegalEvaluationError("LEGAL_EVALUATION_COMPLETED_RUN_NOT_FOUND", 404);
  if (record.reviewId) return { reviewId: record.reviewId, eventHash: record.eventHash, replay: true };
  const questionSha256 = await sha256(record.question);
  const answerSha256 = await sha256(record.answer);
  if (questionSha256 !== record.promptSha256 || record.question !== scenario.prompt) {
    throw new StagingLegalEvaluationError("LEGAL_EVALUATION_REVIEW_PROMPT_MISMATCH", 409);
  }
  const previous = await db.prepare(
    `SELECT event_hash AS eventHash
     FROM staging_legal_evaluation_agent_reviews
     WHERE reviewer_id='openai-codex' ORDER BY created_at DESC,id DESC LIMIT 1`,
  ).first<{ eventHash: string }>();
  const previousHash = previous?.eventHash ?? ZERO_HASH;
  const createdAt = new Date().toISOString();
  const reviewId = crypto.randomUUID();
  const eventHash = await sha256Json({
    id: reviewId,
    evaluationRunId: input.evaluationRunId,
    scenarioId: scenario.id,
    attemptId: record.attemptId,
    aiRunId: record.aiRunId,
    reviewerKind: "openai_codex",
    reviewerId: "openai-codex",
    reviewerTaskId: input.reviewerTaskId,
    attestation: "AI_REVIEW_NOT_HUMAN_LEGAL_APPROVAL",
    classification: input.classification,
    languageQuality: input.languageQuality,
    observedBehaviors: input.observedBehaviors,
    metrics: input.metrics,
    notes: input.notes,
    questionSha256,
    answerSha256,
    previousHash,
    createdAt,
  });
  await db.prepare(
    `INSERT INTO staging_legal_evaluation_agent_reviews (
      id,evaluation_run_id,scenario_id,attempt_id,ai_run_id,reviewer_kind,
      reviewer_id,reviewer_task_id,attestation,classification,language_quality,
      observed_behaviors_json,metrics_json,notes,question_sha256,answer_sha256,
      previous_hash,event_hash,created_at
     ) VALUES (?,?,?,?,?,'openai_codex','openai-codex',?,'AI_REVIEW_NOT_HUMAN_LEGAL_APPROVAL',?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    reviewId,
    input.evaluationRunId,
    scenario.id,
    record.attemptId,
    record.aiRunId,
    input.reviewerTaskId,
    input.classification,
    input.languageQuality,
    JSON.stringify(input.observedBehaviors),
    JSON.stringify(input.metrics),
    input.notes,
    questionSha256,
    answerSha256,
    previousHash,
    eventHash,
    createdAt,
  ).run();
  return { reviewId, eventHash, reviewedAt: createdAt, replay: false };
}
