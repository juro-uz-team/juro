import {legalDraftClaims, legalDraftSchema, legalVerificationSchema, type LegalDraft} from "./answer-contract";
import type {AnswerQuestion} from "./answer-engine";
import {assertAnswerEvidence} from "./evidence-boundary";

/** Checks structure and provenance only. This does not judge legal meaning or completeness. */
export async function checkLegalDraft(question: AnswerQuestion, value: LegalDraft) {
  await assertAnswerEvidence(question);
  const draft = legalDraftSchema.parse(value);
  const claims = legalDraftClaims(draft);
  const sources = new Set(question.evidence.map(item => item.source.id));
  const findings = new Set(claims.filter(item => item.kind === "finding").map(item => item.id));
  const actions = new Set(claims.filter(item => item.kind === "action").map(item => item.id));
  // Membership is explicit writer structure, never inferred from prose or citation overlap.
  const boundFindings = new Set<string>();
  const boundActions = new Set<string>();
  for (const binding of draft.ruleBindings) {
    if (!findings.has(binding.findingId) || boundFindings.has(binding.findingId)) {
      throw new Error("INVALID_FINDING_BINDING");
    }
    boundFindings.add(binding.findingId);
    for (const id of binding.actionIds) {
      if (!actions.has(id) || boundActions.has(id)) throw new Error("INVALID_ACTION_BINDING");
      boundActions.add(id);
    }
  }
  if (boundFindings.size !== findings.size || boundActions.size !== actions.size) {
    throw new Error("INCOMPLETE_ISSUE_BINDINGS");
  }
  const verdicts = claims.map(claim => ({
    id: claim.id,
    // Legacy engine field: supported means structurally admissible for this method,
    // never that the source entails the claim. The public result carries the method.
    supported: claim.kind === "question" || claim.kind === "gap" ||
      (claim.sourceIds.length > 0 && new Set(claim.sourceIds).size === claim.sourceIds.length
        && claim.sourceIds.every(id => sources.has(id))),
    dependsOn: [],
    reason: "Programmatic citation and structure checks only; legal meaning was not independently reviewed.",
  }));
  return legalVerificationSchema.parse({
    validationMethod: "programmatic", mainPointAnswersQuestion: false,
    claims: verdicts, sourceGaps: [], retention: [], coverage: [],
    complete: false, gaps: [], questions: [],
  });
}
