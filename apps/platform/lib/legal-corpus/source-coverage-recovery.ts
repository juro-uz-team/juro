import type {LegalChatRequest} from "../ai/provider";
import {retainRecoveredLegalEvidence, type RecoveredLegalEvidence} from "../ai/legal-evidence-recovery";
import type {SecondaryInternetRetrieval} from "../legal/secondary-internet-retrieval";
import {legalDatabaseFreshnessFromAsOf} from "../legal/verified-retrieval";
import {retrieveCorpusAwareLegalSources, shouldRetrieveSecondaryInternet, type LegalChatSourceRetrieval} from "./chat-retrieval";
import {targetQuestionPlanningHintsSchema} from "./target-retrieval";
import {missingReferencedArticles} from "../legal/referenced-article-context";

type Requirement = NonNullable<LegalChatRequest["coverageRequirements"]>[number];
const scopeFields = (scope: Omit<Requirement, "id" | "sourceIds">) => ({
  statement: scope.statement, priority: scope.priority, scopeKind: scope.scopeKind, origin: scope.origin,
  questionContext: scope.questionContext, unresolvedDimensions: scope.unresolvedDimensions,
});
const scopeIdentity = (scope: Omit<Requirement, "id" | "sourceIds">) => JSON.stringify(scopeFields(scope));

export type LegalSourceCoverageRecovery = {
  evidence: RecoveredLegalEvidence;
  retrieval: LegalChatSourceRetrieval;
  secondary: SecondaryInternetRetrieval;
};

/** A single new source-ladder pass scoped to unresolved requirements. User
 * context and temporal scope are unchanged; result indexes are never confused
 * with the original requirement identities. Discovery still authenticates all
 * candidate membership, complete bytes, references and current observations. */
export async function recoverLegalSourceCoverage(input: {
  request: LegalChatRequest;
  missingRequirementIds: readonly string[];
  initial: LegalChatSourceRetrieval;
  retrievalOptions: Parameters<typeof retrieveCorpusAwareLegalSources>[0];
  secondaryResearch: (query: string) => Promise<SecondaryInternetRetrieval>;
}): Promise<LegalSourceCoverageRecovery> {
  const original = input.request.coverageRequirements ?? [];
  const missingIds = new Set(input.missingRequirementIds);
  const selected = original.filter(requirement => missingIds.has(requirement.id));
  if (!selected.length || selected.length !== missingIds.size) throw new TypeError("RECOVERY_REQUIREMENT_UNAVAILABLE");
  const previous = await input.retrievalOptions.targetPlanningHints;
  if (!previous) throw new TypeError("RECOVERY_QUESTION_INTERPRETATION_UNAVAILABLE");
  const previousIndexes = selected.map(scope => previous.requirements.findIndex(requirement => scopeIdentity(requirement) === scopeIdentity(scope)));
  const formulations: string[] = [];
  const formulationRequirementIndexes: number[][] = [];
  for (const [index, scope] of selected.entries()) {
    const previousIndex = previousIndexes[index]!;
    const candidates = previous.formulations.filter((_, formulationIndex) => {
      const indexes = previous.formulationRequirementIndexes?.[formulationIndex];
      return previousIndex >= 0 && indexes?.includes(previousIndex) && indexes.every(value => previousIndexes.includes(value));
    });
    const references = input.request.sources.filter(source => scope.sourceIds.includes(source.id)).flatMap(source => {
      const articles = missingReferencedArticles(source, input.request.sources);
      return articles.length ? [`${source.actTitle}: ${articles.join(", ")}`] : [];
    });
    const formulation = references.length ? references.join("; ") : candidates[0] ?? scope.statement;
    const existing = formulations.indexOf(formulation);
    if (existing >= 0) formulationRequirementIndexes[existing]!.push(index);
    else {formulations.push(formulation); formulationRequirementIndexes.push([index]);}
  }
  const planningHints = targetQuestionPlanningHintsSchema.parse({...previous,
    requirements: selected.map(scopeFields),
    formulations, formulationRequirementIndexes,
    ...(input.request.applicableAt ? {comparison: undefined, temporalEndpoint: {kind: "timestamp", instant: input.request.applicableAt}}
      : input.request.temporalComparison ? {comparison: input.request.temporalComparison, temporalEndpoint: undefined} : {}),
  });
  const discovered = await retrieveCorpusAwareLegalSources({...input.retrievalOptions,
    query: input.request.question, contextualQuestion: previous.standaloneQuestion,
    targetQuestionId: `${input.request.requestId}:coverage-recovery`, targetPlanningHints: planningHints, requirePlanningHints: true,
    applicableAt: input.request.applicableAt, lexSearchQueries: formulations,
  });
  const returned = discovered.coverageRequirements ?? [];
  const recoveredSupport = new Map<string, string[]>();
  for (const [index, originalScope] of selected.entries()) {
    const recoveredScope = returned.find(scope => scope.id === `requirement-${index + 1}`);
    if (!recoveredScope || scopeIdentity(recoveredScope) !== scopeIdentity(originalScope)) throw new TypeError("RECOVERY_REQUIREMENT_SCOPE_CHANGED");
    recoveredSupport.set(originalScope.id, recoveredScope.sourceIds);
  }
  const expectedIds = new Set(selected.map((_, index) => `requirement-${index + 1}`));
  const coverageRequirements = [
    ...original.map(scope => ({...scope, sourceIds: [...new Set([...scope.sourceIds, ...(recoveredSupport.get(scope.id) ?? [])])]})),
    ...returned.filter(scope => !expectedIds.has(scope.id)).map(scope => ({...scope, id: `recovery:${scope.id}`})),
  ];
  const secondary = !input.request.applicableAt && !input.request.temporalComparison && shouldRetrieveSecondaryInternet(discovered)
    ? await input.secondaryResearch(formulations.join("\n")) : {sources: [], evidence: [], errors: []};
  const additional = [...discovered.sources, ...secondary.sources];
  const existingIds = new Set(input.request.sources.map(source => source.id));
  const combined = [...input.request.sources.map(source => additional.find(candidate => candidate.id === source.id) ?? source),
    ...additional.filter(source => !existingIds.has(source.id))];
  const evidence = retainRecoveredLegalEvidence(input.request, {sources: combined, coverageRequirements,
    legalDatabaseAsOf: discovered.sources.length ? discovered.legalDatabaseAsOf : input.request.legalDatabaseAsOf});
  const officialIds = new Set([...input.initial.sources, ...discovered.sources].map(source => source.id));
  const sources = evidence.sources.filter(source => officialIds.has(source.id));
  const sourceEvidence = [...new Map([...input.initial.evidence, ...discovered.evidence].map(item => [item.sourceId, item])).values()];
  const sourceAccessMode = !input.initial.sources.length ? discovered.sourceAccessMode
    : !discovered.sources.length || input.initial.sourceAccessMode === discovered.sourceAccessMode ? input.initial.sourceAccessMode : "mixed";
  return {evidence, secondary, retrieval: {...discovered, sources, evidence: sourceEvidence, coverageRequirements,
    legalDatabaseAsOf: evidence.legalDatabaseAsOf,
    freshness: legalDatabaseFreshnessFromAsOf(evidence.legalDatabaseAsOf, input.retrievalOptions.now),
    sourceAccessMode, sourcesRetrievedAt: discovered.sourcesRetrievedAt ?? input.initial.sourcesRetrievedAt,
    sourceValidationStatus: sources.length ? "validated" : "unavailable",
    coverageStatus: sources.length ? "partial_coverage" : "no_coverage",
    errors: [...input.initial.errors, ...discovered.errors],
  }};
}
