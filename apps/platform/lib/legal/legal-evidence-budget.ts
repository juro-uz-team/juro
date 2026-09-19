/** Bound complete verified context, rather than rejecting many short rules. */
export const MAX_LEGAL_EVIDENCE_SOURCES = 24;
export const MAX_LEGAL_EVIDENCE_CHARACTERS = 64_000;

export function fitsLegalEvidenceBudget(texts: readonly string[]): boolean {
  return texts.length <= MAX_LEGAL_EVIDENCE_SOURCES
    && texts.reduce((total, text) => total + text.length, 0) <= MAX_LEGAL_EVIDENCE_CHARACTERS;
}
