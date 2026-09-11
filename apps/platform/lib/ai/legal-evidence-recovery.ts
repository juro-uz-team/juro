import {fitsLegalEvidenceBudget} from "../legal/legal-evidence-budget";
import {LEGAL_EXPANDED_REQUIREMENT_LIMIT} from "../legal/question-interpretation-limits";
import type {LegalChatRequest, LegalSourceContext} from "./provider";

/** Server-owned, authenticated retrieval output. It is never provider output. */
export type RecoveredLegalEvidence = {
  sources: LegalSourceContext[];
  coverageRequirements: NonNullable<LegalChatRequest["coverageRequirements"]>;
  legalDatabaseAsOf: string;
};

const evidenceIdentity = (source: LegalSourceContext) => JSON.stringify({
  id: source.id, officialUrl: source.officialUrl, article: source.article, locale: source.locale,
  contentSha256: source.contentSha256, revisionDate: source.revisionDate, effectiveDate: source.effectiveDate,
  applicabilityStatus: source.applicabilityStatus, sourceClass: source.sourceClass,
  spans: source.spans, citationEvidenceReceipt: source.citationEvidenceReceipt,
});

/** Keep the original scope order and pinned bytes; discovery cannot silently
 * replace a question, discard a validated provision or narrow the context. */
export function retainRecoveredLegalEvidence(input: LegalChatRequest, recovered: RecoveredLegalEvidence): RecoveredLegalEvidence {
  const byId = new Map(recovered.sources.map(source => [source.id, source]));
  if (byId.size !== recovered.sources.length) throw new TypeError("RECOVERY_DUPLICATE_SOURCE");
  for (const source of input.sources) {
    const proposed = byId.get(source.id);
    if (!proposed || evidenceIdentity(proposed) !== evidenceIdentity(source)) throw new TypeError("RECOVERY_PINNED_EVIDENCE_CHANGED");
    byId.set(source.id, source);
  }
  const originalIds = new Set(input.sources.map(source => source.id));
  const sources = [...input.sources, ...recovered.sources.filter(source => !originalIds.has(source.id))];
  if (!fitsLegalEvidenceBudget(sources.map(source => source.spans?.map(span => span.text).join("\n") ?? ""))) {
    throw new TypeError("RECOVERY_EVIDENCE_CONTEXT_EXCEEDED");
  }
  const requirements = recovered.coverageRequirements;
  if (requirements.length < (input.coverageRequirements?.length ?? 0)
    || requirements.length > LEGAL_EXPANDED_REQUIREMENT_LIMIT
    || new Set(requirements.map(scope => scope.id)).size !== requirements.length) {
    throw new TypeError("RECOVERY_REQUIREMENT_INVENTORY_CHANGED");
  }
  for (const [index, original] of (input.coverageRequirements ?? []).entries()) {
    const {sourceIds: originalSources, ...originalScope} = original;
    const {sourceIds: proposedSources, ...proposedScope} = requirements[index]!;
    if (JSON.stringify(originalScope) !== JSON.stringify(proposedScope)
      || originalSources.some(id => !proposedSources.includes(id))) throw new TypeError("RECOVERY_REQUIREMENT_SCOPE_CHANGED");
  }
  if (requirements.some(scope => scope.sourceIds.some(id => !byId.has(id)))) throw new TypeError("RECOVERY_EVIDENCE_UNAVAILABLE");
  if (!Number.isFinite(Date.parse(recovered.legalDatabaseAsOf))) throw new TypeError("RECOVERY_EVIDENCE_DATE_UNAVAILABLE");
  const legalDatabaseAsOf = Number.isFinite(Date.parse(input.legalDatabaseAsOf))
    && Date.parse(input.legalDatabaseAsOf) < Date.parse(recovered.legalDatabaseAsOf)
    ? input.legalDatabaseAsOf : recovered.legalDatabaseAsOf;
  return {sources, coverageRequirements: requirements, legalDatabaseAsOf};
}
