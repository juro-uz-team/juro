import { z } from "zod";
import type { CandidateRanking, Interpretation, WorkflowPorts } from "./contracts";
import { maximumCandidateDescriptionBatch, researchConcurrencySchema } from "./contracts";
import type { EvidenceScope } from "./evidence";
import { withinSignal } from "./lifetime";

const previewSchema = z.object({ identity: z.string().min(1).max(512), sourceUrl: z.url().max(2048),
  text: z.string().min(1).max(1200), truncated: z.boolean(), title: z.string().max(400).optional(),
  hierarchy: z.array(z.string().max(160)).max(3).optional(),
  language: z.string().optional(),
  selectedEditions: z.array(z.string()).optional(),
  requestedEdition: z.string().nullable().optional(),
  descriptionFailure: z.string().max(120).optional(),
  sourceNotes: z.array(z.string()).optional(),
  publisherContents: z.array(z.object({ position: z.string().regex(/^-?\d+$/u), title: z.string().min(1) }).strict()).optional(),
  readRange: z.object({ key: z.string(), kind: z.enum(["provision", "section", "document"]), language: z.string(),
    textByteCount: z.number().int().nonnegative().optional(), unitCount: z.number().int().positive().optional(),
    sourceNotes: z.array(z.string()).optional(),
    sourceSections: z.array(z.object({ position: z.string(), title: z.string(), key: z.string(), textByteCount: z.number().int().nonnegative().optional(), unitCount: z.number().int().positive().optional() })).optional(),
    sections: z.array(z.object({ position: z.string(), title: z.string(), key: z.string(), textByteCount: z.number().int().nonnegative().optional(), unitCount: z.number().int().positive().optional() })).optional() }).optional() }).strict();
export type CandidateDescription = z.infer<typeof previewSchema>;
export type ReadCandidate = CandidateDescription & { id: string; scope: EvidenceScope; query: string; queries: string[];
  ranks: ({ query: string; rank: number } & Partial<CandidateRanking>)[] };
export const candidateSearchKey = (query: string, scope: EvidenceScope) =>
  JSON.stringify([query.normalize("NFKC").trim().replace(/\s+/gu, " ").toLowerCase(), scope]);

export { publisherNavigationPriority as automaticReadPriority } from "./publisher-notices";

/** Several provisions can share one pending document fetch; spread workers across documents first. */
export function interleaveCandidateReads<T extends { sourceUrl: string; scope: EvidenceScope }>(candidates: readonly T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const item of candidates) {
    const key = JSON.stringify([item.sourceUrl, item.scope]);
    const group = groups.get(key) ?? []; group.push(item); groups.set(key, group);
  }
  const ordered: T[] = [];
  for (let index = 0; ordered.length < candidates.length; index++) {
    for (const group of groups.values()) if (index < group.length) ordered.push(group[index]);
  }
  return ordered;
}

/** Retain discovery before describing it; failed metadata reads never erase returned matches. */
export async function discoverReadCandidates(input: {
  interpretation: Pick<Interpretation, "queries" | "scopes"> | Interpretation; corpus: WorkflowPorts["corpus"]; signal: AbortSignal; searches: Set<string>;
  failures: { candidate: string; scope: EvidenceScope; code: string }[];
  limits: { query: string; scope: EvidenceScope; omittedCandidates: number }[];
  retained?: ReadCandidate[];
}): Promise<ReadCandidate[]> {
  const candidates = input.retained ?? [];
  const pending = input.interpretation.queries.flatMap(query => input.interpretation.scopes.map(scope => ({ query, scope })));
  let cursor = 0;
  const worker = async () => {
    while (cursor < pending.length) {
      const { query, scope } = pending[cursor++];
      input.signal.throwIfAborted();
      const key = candidateSearchKey(query, scope);
      if (input.searches.has(key)) continue;
      input.searches.add(key);
      let hits: string[];
      let ranking: Record<string, CandidateRanking> | undefined;
      try {
        const packet = await withinSignal(input.signal, () => input.corpus.search(query, scope, input.signal));
        hits = z.array(z.string().min(1).max(512)).parse(packet.candidates);
        ranking = packet.ranking;
        // Even partial lane results remain discoverable, with availability explicitly recorded.
        if (!packet.sparseAvailable || !packet.denseAvailable) input.failures.push({ candidate: `query:${query}`, scope, code: "CANDIDATE_LANE_UNAVAILABLE" });
      } catch {
        input.signal.throwIfAborted();
        input.failures.push({ candidate: `query:${query}`, scope, code: "CORPUS_SEARCH_UNAVAILABLE" }); continue;
      }
      const added: ReadCandidate[] = [];
      for (const [rank, identity] of hits.entries()) {
        let item = candidates.find(value => value.identity === identity && JSON.stringify(value.scope) === JSON.stringify(scope));
        if (!item) {
          item = { identity, id: `c${candidates.length + 1}`, sourceUrl: "https://lex.uz/", text: "Description unavailable; complete read required.",
            truncated: true, query, queries: [], ranks: [], scope: structuredClone(scope) };
          candidates.push(item); added.push(item);
        }
        if (!item.queries.includes(query)) item.queries.push(query);
        item.ranks.push({ query, rank, ...ranking?.[identity] });
      }
      const describe = input.corpus.describeCandidates;
      if (!describe) continue;
      for (let index = 0; index < added.length; index += maximumCandidateDescriptionBatch) {
        const batch = added.slice(index, index + maximumCandidateDescriptionBatch), ids = batch.map(item => item.identity);
        try {
          const described = z.array(previewSchema).parse(await withinSignal(input.signal, () => describe(ids, scope, input.signal)));
          if (described.length !== ids.length || new Set(described.map(item => item.identity)).size !== ids.length
            || described.some(item => !ids.includes(item.identity))) throw new Error("CANDIDATE_DESCRIPTION_IDENTITY");
          for (const item of batch) {
            const metadata = described.find(value => value.identity === item.identity)!;
            Object.assign(item, metadata);
            if (metadata.descriptionFailure) input.failures.push({ candidate: item.identity, scope, code: metadata.descriptionFailure });
          }
        } catch {
          input.signal.throwIfAborted();
          for (const identity of ids) input.failures.push({ candidate: identity, scope, code: "CATALOG_READ_UNAVAILABLE" });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(researchConcurrencySchema.parse(input.corpus.researchConcurrency), pending.length) }, worker));
  return candidates;
}
