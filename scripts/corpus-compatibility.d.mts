export type CorpusCompatibility = {version: 1; environment: "production" | "staging"; revision: string; acceptedRevision: string; acceptanceSha256: string; reviewSha256: string};
export function validateCorpusCompatibility(value: unknown, environment: string, revision: string): CorpusCompatibility;
export function readCorpusCompatibility(environment: string | undefined, revision: string): CorpusCompatibility | undefined;
