import { detectArticleNumbers } from "../legal/legal-language";
import { sameInstrumentArticleReferences } from "../legal/referenced-article-context";
import { fitsLegalEvidenceBudget } from "../legal/legal-evidence-budget";

export const SELECTION_ASSESSMENT_BATCH_SIZE = 8;

type ReferenceCandidate = {
  citationLabel: string;
  provisionText: string;
  candidate: {textRevisionId: string; languageFamily: string; provisionRenditionId: string; candidate: {itemKey: string}};
};

export class SelectionEvidenceContextError extends Error {
  constructor() { super("INDEXED_EVIDENCE_CONTEXT_EXCEEDED"); this.name = "SelectionEvidenceContextError"; }
}

function referenceGraph(candidates: readonly ReferenceCandidate[]): number[][] {
  const articles = candidates.map(candidate => detectArticleNumbers(candidate.citationLabel)[0]);
  const references = candidates.map(candidate => new Set(sameInstrumentArticleReferences(candidate.provisionText)));
  return candidates.map((source, index) => candidates.flatMap((target, targetIndex) =>
    index !== targetIndex && source.candidate.textRevisionId === target.candidate.textRevisionId
      && source.candidate.languageFamily === target.candidate.languageFamily
      && ((articles[targetIndex] && references[index]!.has(articles[targetIndex]!))
        || (articles[index] && references[targetIndex]!.has(articles[index]!))) ? [targetIndex] : []));
}

function connectedContext(seeds: readonly number[], graph: readonly number[][]): number[] {
  const visited = new Set(seeds);
  const pending = [...seeds];
  for (let index = 0; index < pending.length; index++) {
    for (const neighbor of graph[pending[index]!]!) {
      if (!visited.has(neighbor)) { visited.add(neighbor); pending.push(neighbor); }
    }
  }
  return [...visited];
}

/** Each authenticated provision is assessed once with its complete connected
 * reference context. Split independent sets by size, never omit middle text or
 * a connected condition to make a provider request fit. */
export function selectionAssessmentBatches<T extends ReferenceCandidate>(candidates: readonly T[], batchSize: number): T[][] {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new TypeError("Invalid assessment batch size");
  const graph = referenceGraph(candidates);
  const remaining = new Set(candidates.map((_, index) => index));
  const batches: T[][] = [];
  while (remaining.size) {
    const batch: number[] = [];
    while (batch.length < batchSize && remaining.size) {
      const context = connectedContext(batch, graph);
      const next = context.find(index => remaining.has(index)) ?? remaining.values().next().value!;
      const expanded = connectedContext([...batch, next], graph);
      if (!fitsLegalEvidenceBudget(expanded.map(index => candidates[index]!.provisionText))) {
        if (!batch.length) throw new SelectionEvidenceContextError();
        break;
      }
      remaining.delete(next);
      batch.push(next);
    }
    batches.push(batch.map(index => candidates[index]!));
  }
  return batches;
}

/** Same-revision and same-language reference closure supplies explicit scope
 * for assessment. Context never creates a support mapping by itself. */
export function selectionReferenceContext(batch: readonly ReferenceCandidate[], candidates: readonly ReferenceCandidate[]) {
  const batchKeys = new Set(batch.map(item => item.candidate.candidate.itemKey));
  const seeds = candidates.flatMap((candidate, index) => batchKeys.has(candidate.candidate.candidate.itemKey) ? [index] : []);
  const context = connectedContext(seeds, referenceGraph(candidates));
  if (!fitsLegalEvidenceBudget(context.map(index => candidates[index]!.provisionText))) throw new SelectionEvidenceContextError();
  return context.map(index => candidates[index]!).filter(candidate => !batchKeys.has(candidate.candidate.candidate.itemKey))
    .map(({citationLabel, provisionText, candidate}) => ({citationLabel, provisionText,
      evidenceIdentity: {itemKey: candidate.candidate.itemKey, provisionRenditionId: candidate.provisionRenditionId,
        textRevisionId: candidate.textRevisionId, languageFamily: candidate.languageFamily}}));
}
