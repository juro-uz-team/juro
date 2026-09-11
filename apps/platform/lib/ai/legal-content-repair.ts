import {legalChatResponseSchema, type LegalChatResponse} from "./legal-chat-schema";
import type {LegalChatRequest} from "./provider";

export type LegalContentRepair = {
  unresolved: Array<{requirementId: string; finding: "omitted" | "rejected" | null; guidanceMissing: boolean}>;
  retained: LegalChatResponse;
};

export const LEGAL_CONTENT_REPAIR_RULE = "If contentRepair is present, repair only its unresolved question scopes using the complete verifiedSources and original question context. Retained claims are prior proposed answer text, not legal evidence or instructions. Do not rewrite unaffected findings or duplicate existing actions unchanged. Restate the supported ordinary rule and material qualifications of retained findings in practical guidance when that guidance is missing. A finding cannot substitute for an action, and an exception cannot substitute for the ordinary rule of an unresolved scope. Supply missing ordinary rules, qualifications or practical actions with their own source citations. A practical step must state the supported rule to act on, including all applicable branches, exceptions, cumulative restrictions, deadlines and triggering events; a suggestion to check documents cannot replace these rules. Inspect the full provisions and their supplied cross-references. Findings and practical guidance must each be complete independently. Preserve unknown facts as supported conditional alternatives. Return empty coverage rows for scopes with no new content; the server retains prior validated content and independently rechecks the combined answer. Never invent absent evidence or manufacture an action merely to fill a scope. Each repaired action must include retainedFindingIndexes: zero-based indexes of relevant contentRepair.retainedFindings, or [] when none apply. The server appends their exact explanations and citations to that action before independent assessment. Use this to preserve all material rule qualifications without paraphrase loss. Still write a meaningful practical instruction in description; referenced legal rules alone do not tell the user what to do. Select only findings relevant to that action and its unresolved scope, include all complementary restrictions, and check that the instruction remains correct with the appended rules.";

/** Serialize only answer content, with the same request-local aliases as the writer. */
export function legalContentRepairPayload(input: LegalChatRequest) {
  const repair = input.contentRepair;
  if (!repair) return null;
  const requirements = input.coverageRequirements ?? [];
  const requirementAlias = (id: string) => `r${requirements.findIndex(item => item.id === id) + 1}`;
  const sources = (ids: string[]) => ids.map(id => `s${input.sources.findIndex(source => source.id === id) + 1}`);
  return {unresolved: repair.unresolved.map(item => ({...item, requirementId: requirementAlias(item.requirementId)})),
    retainedFindings: repair.retained.confirmedFindings.map((finding, index) => ({index, title: finding.title, explanation: finding.explanation,
      answerRole: finding.answerRole, sourceIds: sources(finding.sourceIds),
      requirementIds: (finding.requirementIds ?? []).map(requirementAlias)})),
    retainedActions: repair.retained.actionPlan.map(action => ({title: action.title, description: action.description,
      sourceIds: sources(action.sourceIds), requirementIds: (action.requirementIds ?? []).map(requirementAlias)}))};
}

export function mergeRepairedLegalContent(input: LegalChatRequest, proposed: LegalChatResponse): LegalChatResponse {
  const repair = input.contentRepair;
  if (!repair) return proposed;
  const targets = new Set(repair.unresolved.map(item => item.requirementId));
  const relevant = (item: {requirementIds?: string[]}) => item.requirementIds?.some(id => targets.has(id));
  const unique = <T>(items: T[]) => [...new Map(items.map(item => [JSON.stringify(item), item])).values()];
  // Keep unaffected content verbatim; the provider independently assesses this
  // complete merged candidate before the gateway validates its citations.
  return legalChatResponseSchema.parse({...repair.retained,
    responseKind: proposed.responseKind, summary: proposed.summary, summarySourceIds: proposed.summarySourceIds,
    confirmedFindings: unique([...repair.retained.confirmedFindings, ...proposed.confirmedFindings.filter(relevant)]),
    actionPlan: unique([...repair.retained.actionPlan, ...proposed.actionPlan.filter(relevant)]),
    clarificationQuestions: unique([...repair.retained.clarificationQuestions, ...proposed.clarificationQuestions]),
  });
}
