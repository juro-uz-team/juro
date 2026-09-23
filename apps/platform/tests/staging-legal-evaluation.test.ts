import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("canonical legal evaluation runner is staging-only, token-gated, and prompt-closed", async () => {
  const [route, runner, queue, config, runtime] = await Promise.all([
    readFile(new URL("../app/api/platform/internal/staging/legal-evaluation/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/ai/staging-legal-evaluation.ts", import.meta.url), "utf8"),
    readFile(new URL("../worker/staging-legal-evaluation-queue.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/runtime/self-hosted.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/document-builder/storage/runtime.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /fixedTimeMatch/u);
  assert.match(route, /authorization/u);
  assert.match(route, /STAGING_LEGAL_EVALUATION_TOKEN/u);
  assert.match(route, /stagingLegalEvaluationEnabled/u);
  assert.match(route, /requirePlatformStaffRequest\(request, "staff\.operations\.manage"/u);
  assert.match(route, /freshMfaWithinMs: 15 \* 60 \* 1_000/u);
  assert.match(route, /assertSafeWrite\(request\)/u);
  assert.match(route, /withPlatformStaffErrors\(postStagingLegalEvaluation\)/u);
  assert.doesNotMatch(route, /body\.prompt|question:/u);
  assert.match(runner, /legalEvaluationCorpus\.find/u);
  assert.match(runner, /executeAiPostForInternalEvaluation/u);
  assert.match(runner, /staging_evaluation/u);
  assert.match(runner, /AI_REVIEW_NOT_HUMAN_LEGAL_APPROVAL/u);
  assert.match(runner, /scenario\.prompt/u);
  assert.match(config, /STAGING_LEGAL_EVALUATION_ENABLED: "false"/u);
  assert.match(queue, /stagingLegalEvaluationRunInputSchema/u);
  assert.match(queue, /stagingLegalEvaluationReviewInputSchema/u);
  assert.match(queue, /runStagingLegalEvaluationScenario/u);
  assert.match(queue, /reviewStagingLegalEvaluation/u);
  assert.doesNotMatch(queue, /prompt\s*:/u);
  assert.match(runtime, /STAGING_LEGAL_EVALUATION_TOKEN\?: string/u);
});

test("agent evaluation evidence is append-only and cannot impersonate the human MFA ledger", async () => {
  const migration = await readFile(
    new URL("../drizzle/0120_staging_legal_evaluation_agent_evidence.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /staging_legal_evaluation_attempts/u);
  assert.match(migration, /staging_legal_evaluation_agent_reviews/u);
  assert.match(migration, /reviewer_kind.*openai_codex/su);
  assert.match(migration, /AI_REVIEW_NOT_HUMAN_LEGAL_APPROVAL/u);
  assert.match(migration, /STAGING_LEGAL_EVALUATION_ATTEMPT_IMMUTABLE/u);
  assert.match(migration, /STAGING_LEGAL_EVALUATION_AGENT_REVIEW_IMMUTABLE/u);
  assert.match(migration, /STAGING_LEGAL_EVALUATION_AGENT_CHAIN_CONFLICT/u);
  assert.doesNotMatch(migration, /platform_staff_assignments|actor_mfa_verified_at/u);
  assert.doesNotMatch(migration, /DROP\s+TABLE/iu);
});

test("interactive AI authentication can be resolved from the exact internal Request", async () => {
  const [session, auth, api, route] = await Promise.all([
    readFile(new URL("../lib/auth/session.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/chatgpt-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/document-builder/auth/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/ai/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(session, /getSessionUser\(request\?: Request\)/u);
  assert.match(session, /request\?\.headers \?\? await headers\(\)/u);
  assert.match(auth, /getAuthPrincipal\(request\?: Request\)/u);
  assert.match(api, /requireApiUser\(request\?: Request\)/u);
  assert.match(route, /legalChatOwner\(request\)/u);
  assert.match(await readFile(new URL("../lib/legal-chat/http-owner.ts", import.meta.url), "utf8"), /requireApiUser\(request\)/u);

});
