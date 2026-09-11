import assert from "node:assert/strict";
import test from "node:test";
import {legalResearchFailureReason} from "../lib/ai/legal-answer-failure";

test("research failures distinguish unavailable operations from actual absent coverage", () => {
  assert.equal(legalResearchFailureReason([{code: "QUESTION_INTERPRETATION_UNAVAILABLE"}]), "question_interpretation_unavailable");
  for (const code of ["LEGAL_SOURCE_SEARCH_TIMEOUT", "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE", "TARGET_RETRIEVAL_TIMEOUT"]) {
    assert.equal(legalResearchFailureReason([{code}]), "official_research_unavailable");
  }
  for (const code of ["LEGAL_SOURCE_IRRELEVANT", "INSUFFICIENT_INDEXED_COVERAGE", "SECONDARY_RESEARCH_UNAVAILABLE"]) {
    assert.equal(legalResearchFailureReason([{code}]), undefined);
  }
  assert.equal(legalResearchFailureReason([]), undefined);
});
