import assert from "node:assert/strict";
import test from "node:test";

import {
  createTargetActivationSetEvaluationClient,
  handleTargetActivationSetEvaluationRequest,
  TARGET_ACTIVATION_SET_EVALUATION_PATH,
} from "../lib/legal-corpus/target-evaluation";
import {
  createRuntimeTargetActivationSetEvaluation,
  selectRuntimeEvidenceBucket,
  type TargetRetrievalRuntimeEnv,
} from "../lib/legal-corpus/target-runtime";
import {activationEvaluationReportSha256,activationSetEvaluationEnv} from "./helpers/activation-evaluation-env";
import { sqliteD1FixtureFromDirectory } from "./helpers/sqlite-d1";

test("history retrieval selects its accepted R2 evidence bucket without changing current retrieval", () => {
  const current = { get: async () => null };
  const history = { get: async () => null };
  assert.equal(selectRuntimeEvidenceBucket("current", current, history), current);
  assert.equal(selectRuntimeEvidenceBucket("history", current, history), history);
  assert.equal(selectRuntimeEvidenceBucket("history", current), current);
});

function evaluationBoundaryEnv(): TargetRetrievalRuntimeEnv {
  return { APP_ENV: "staging", LEGAL_CORPUS_SHADOW_MODE: "true" };
}


test("candidate qualification storage is immutable and indexed by release", () => {
  const { sqlite } = sqliteD1FixtureFromDirectory(new URL("../legal-drizzle/", import.meta.url));
  try {
    const table = sqlite.prepare(`SELECT sql FROM sqlite_master
      WHERE type='table' AND name='legal_search_candidate_qualifications'`).get() as { sql: string };
    const triggers = sqlite.prepare(`SELECT name FROM sqlite_master
      WHERE type='trigger' AND tbl_name='legal_search_candidate_qualifications'
      ORDER BY name`).all() as Array<{ name: string }>;
    const indexes = sqlite.prepare(`SELECT name FROM sqlite_master
      WHERE type='index' AND tbl_name='legal_search_candidate_qualifications'
      ORDER BY name`).all() as Array<{ name: string }>;
    assert.match(table.sql, /status`='qualified'/u);
    assert.deepEqual(triggers.map(({ name }) => name), [
      "legal_search_candidate_qualifications_no_delete",
      "legal_search_candidate_qualifications_no_update",
    ]);
    assert.equal(indexes.some(({ name }) =>
      name === "legal_search_candidate_qualification_release_idx"), true);
  } finally {
    sqlite.close();
  }
});

test("activation-set evaluation has a distinct staging-only private boundary", async () => {
  const publicRequest = new Request(
    `https://example.test${TARGET_ACTIVATION_SET_EVALUATION_PATH}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
  );
  assert.equal((await handleTargetActivationSetEvaluationRequest(
    publicRequest, evaluationBoundaryEnv(),
  )).status, 404);
  const privateRequest = new Request(
    `http://legal-corpus.internal${TARGET_ACTIVATION_SET_EVALUATION_PATH}`,
    { method: "POST", headers: { "content-type": "application/json",
      "x-juro-service-binding": "target-activation-set-evaluation-v1",
      "x-juro-legal-environment": "staging" }, body: JSON.stringify({
      activationSetId: "activation:staging:evaluation-v1",
      historyReconciliationRunId: "history-evaluation:staging:custom-v1",
      historyReportSha256: "a".repeat(64),
      question: { id: "question-activation-set", question: "What was the law?" },
    }) },
  );
  const unavailableResponse = await handleTargetActivationSetEvaluationRequest(
    privateRequest.clone() as Request, evaluationBoundaryEnv());
  assert.equal(unavailableResponse.status, 503);
  assert.deepEqual(await unavailableResponse.json(), {
    code: "TARGET_ACTIVATION_SET_EVALUATION_UNAVAILABLE",
  });
  assert.equal((await handleTargetActivationSetEvaluationRequest(privateRequest, {
    ...evaluationBoundaryEnv(), LEGAL_CORPUS_SHADOW_MODE: "false",
  })).status, 404);
  assert.equal((await handleTargetActivationSetEvaluationRequest(privateRequest.clone() as Request, {
    ...evaluationBoundaryEnv(), APP_ENV: "production",
  })).status, 404);
});

test("activation-set evaluation client pins exact identifiers and private marker", async () => {
  let observedUrl = "";
  let observedMarker: string | null = null;
  const client = createTargetActivationSetEvaluationClient({ environment: "staging",
    service: { async fetch(input, init) {
      const request = new Request(input as RequestInfo, init as RequestInit);
      observedUrl = request.url;
      observedMarker = request.headers.get("x-juro-service-binding");
      return Response.json({ result: { kind: "source_unavailability" }, observation: {} });
    } } as Fetcher });
  const result = await client.answer({ activationSetId: "activation:staging:evaluation-v1",
    historyReconciliationRunId: "history-evaluation:staging:custom-v1",
    historyReportSha256: "a".repeat(64),
    question: { id: "question-activation-set", question: "What was the law?" } });
  assert.equal(typeof result, "object");
  assert.equal(observedMarker, "target-activation-set-evaluation-v1");
  assert.equal(new URL(observedUrl).pathname, TARGET_ACTIVATION_SET_EVALUATION_PATH);
});

test("activation-set evaluation resolves as-of and every comparison matrix through the exact pair", async () => {
  const timestamp2020 = { kind: "timestamp" as const, instant: "2020-01-01T00:00:00.000Z" };
  const timestamp2025 = { kind: "timestamp" as const, instant: "2025-01-01T00:00:00.000Z" };
  const current = { kind: "current" as const };
  const scopeById = {
    as_of: { temporalEndpoint: timestamp2025 },
    current_history: { comparison: { left: current, right: timestamp2025 } },
    history_current: { comparison: { left: timestamp2020, right: current } },
    history_history: { comparison: { left: timestamp2020, right: timestamp2025 } },
  };
  const plans = Object.fromEntries(Object.entries(scopeById).map(([id, scope]) => [id, {
    id: `plan-${id}`, originalLanguage: "en", answerLanguage: "en", ...scope,
    readings: [{ id: "reading-change", statement: "How the governing rule changed",
      requirements: [{ id: "requirement-change", statement: "Governing rule at each endpoint" }] }],
    formulations: [{ id: "formulation-change", text: "Labor Code governing rule",
      privateNameSpans: [], readingIds: ["reading-change"],
      requirementIds: ["requirement-change"], kind: "legal_register" }],
    missingCaseFacts: [],
  }]));
  const evaluation = await createRuntimeTargetActivationSetEvaluation({
    env: activationSetEvaluationEnv(plans),
    activationSetId: "activation:staging:evaluation-v1",
    historyReconciliationRunId: "history-evaluation:staging:custom-v1",
    historyReportSha256: activationEvaluationReportSha256,
  });
  const expected = {
    as_of: { kind: "endpoint", endpoint: timestamp2025,
      releaseId: "release:staging:history:evaluation-v1" },
    current_history: { kind: "comparison", left: current, right: timestamp2025,
      leftReleaseId: "release:staging:current:evaluation-v1",
      rightReleaseId: "release:staging:history:evaluation-v1" },
    history_current: { kind: "comparison", left: timestamp2020, right: current,
      leftReleaseId: "release:staging:history:evaluation-v1",
      rightReleaseId: "release:staging:current:evaluation-v1" },
    history_history: { kind: "comparison", left: timestamp2020, right: timestamp2025,
      leftReleaseId: "release:staging:history:evaluation-v1",
      rightReleaseId: "release:staging:history:evaluation-v1" },
  } as const;
  for (const id of Object.keys(scopeById) as Array<keyof typeof scopeById>) {
    const response = await evaluation.answer({ id, question: `Question for ${id}` });
    assert.equal(response.result.kind, "source_unavailability");
    if (response.result.kind === "source_unavailability") {
      assert.equal(response.result.safeErrorCode, "INDEXED_CANDIDATE_UNAVAILABLE");
    }
    assert.equal(response.observation.activationSetId, "activation:staging:evaluation-v1");
    assert.equal(response.observation.historyReportSha256, activationEvaluationReportSha256);
    assert.deepEqual(response.observation.resolutions, [expected[id]]);
  }
});
