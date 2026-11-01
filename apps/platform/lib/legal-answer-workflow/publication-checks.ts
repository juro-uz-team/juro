import type { Assessment, Interpretation, OfficialProvision, WrittenAnswer } from "./contracts";

export function checkCoverage(interpretation: Interpretation, assessment: Assessment, evidence: OfficialProvision[]) {
  const requirements = new Set(interpretation.requirements.map(item => item.id));
  const sources = new Set(evidence.map(item => item.identity));
  if (requirements.size !== interpretation.requirements.length) throw new Error("REQUIREMENT_ID_CONFLICT");
  for (const support of assessment.support) {
    if (!requirements.has(support.requirementId) || support.sourceIds.some(id => !sources.has(id))) {
      throw new Error("COVERAGE_IDENTITY_INVALID");
    }
  }
  if (assessment.gaps.some(gap => !requirements.has(gap.requirementId))) throw new Error("GAP_IDENTITY_INVALID");
  return assessment.gaps.length === 0 && interpretation.requirements.every(requirement =>
    assessment.support.some(support => support.requirementId === requirement.id));
}

export function checkWrittenAnswer(content: WrittenAnswer, interpretation: Interpretation,
  assessment: Assessment | null, evidence: OfficialProvision[]) {
  const sources = new Set(evidence.map(item => item.identity));
  const required = new Set(interpretation.requirements.map(item => item.id));
  const cited = [content.summarySourceIds,
    ...content.issues.flatMap(issue => [issue.sourceIds, ...issue.actions.map(action => action.sourceIds)]),
    ...content.conditionalBranches.map(item => item.sourceIds), ...content.risks.map(item => item.sourceIds),
    ...content.deadlines.map(item => item.sourceIds), ...content.referenceNotes.map(item => item.sourceIds)];
  if (cited.some(ids => ids.some(id => !sources.has(id)))) throw new Error("ANSWER_CITATION_INVALID");
  const covered = new Set<string>();
  for (const issue of content.issues) {
    for (const requirement of issue.requirementIds) {
      if (!required.has(requirement) || (assessment !== null && !assessment.support.some(support =>
        support.requirementId === requirement && support.sourceIds.every(id => issue.sourceIds.includes(id))))) {
        throw new Error("ANSWER_REQUIREMENT_INVALID");
      }
      covered.add(requirement);
    }
  }
  // Direct research plans are provisional. Citation/label identity is an application
  // invariant; semantic coverage of the actual question is the agent's responsibility.
  if (assessment !== null && [...required].some(id => !covered.has(id))) throw new Error("ANSWER_REQUIREMENT_MISSING");
}
