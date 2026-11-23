import type { StoredDiscovery } from "./stored-corpus";
import type { EvidenceScope } from "./evidence";
import { maximumCandidateDescriptionBatch, type CandidateRanking } from "./contracts";

/**
 * Treat additions as another partition of the same prepared corpus. Candidate
 * ranks are fused across partitions without comparing their raw scores.
 */
export function partitionedDiscovery(partitions: {
  discovery: StoredDiscovery;
  replacements: ReadonlySet<string>;
}[], registerWork: (work: string, partition: number) => void): StoredDiscovery {
  const owners = new Map<string, number>();
  const retained = new Map<string, Awaited<ReturnType<StoredDiscovery["readCandidate"]>>>();

  function owner(identity: string) {
    const position = owners.get(identity);
    if (position === undefined) throw new Error("CANDIDATE_NOT_DISCOVERED");
    return position;
  }

  async function read(position: number, identity: string, signal: AbortSignal) {
    const result = retained.get(identity) ?? await partitions[position].discovery.readCandidate(identity, signal);
    retained.set(identity, result);
    registerWork(result.work, position);
    return result;
  }

  function key(candidate: Awaited<ReturnType<StoredDiscovery["readCandidate"]>>, scope: EvidenceScope) {
    const { inventory } = candidate.source;
    const url = new URL(String(inventory.url));
    const attached = inventory.kind === "asset" || inventory.kind === "member";
    const context = attached ? inventory.context as { source?: string; edition?: string | null } | undefined : undefined;
    const source = context?.source ?? /^\/docs\/(-?\d+)$/u.exec(url.pathname)?.[1];
    const edition = attached ? context?.edition ?? null : url.searchParams.get("ONDATE");
    return source && (scope.kind === "current" ? !edition : Boolean(edition))
      ? JSON.stringify([source, edition]) : null;
  }

  return {
    async search(query, scope, signal) {
      const results = await Promise.all(partitions.map(partition => partition.discovery.search(query, scope, signal)));
      const candidates: { identity: string; rank: number; partition: number; ranking: CandidateRanking | undefined }[] = [];
      const overridden = new Set<string>();
      for (let position = partitions.length - 1; position >= 0; position--) {
        const found = results[position];
        if (overridden.size) {
          for (let start = 0; start < found.candidates.length; start += maximumCandidateDescriptionBatch) {
            const batch = found.candidates.slice(start, start + maximumCandidateDescriptionBatch);
            await partitions[position].discovery.prepareCandidates?.(batch, signal);
          }
        }
        for (const [rank, identity] of found.candidates.entries()) {
          if (overridden.size) {
            const candidate = await read(position, identity, signal);
            const source = key(candidate, scope);
            if (source && overridden.has(source)) continue;
          }
          owners.set(identity, position);
          candidates.push({ identity, rank, partition: position, ranking: found.ranking?.[identity] });
        }
        for (const source of partitions[position].replacements) overridden.add(source);
      }
      const ranked = candidates.sort((left, right) => left.rank - right.rank || right.partition - left.partition).slice(0, 50);
      return { candidates: ranked.map(item => item.identity),
        ranking: Object.fromEntries(ranked.flatMap(item => item.ranking ? [[item.identity, item.ranking]] : [])),
        sparseAvailable: results.every(result => result.sparseAvailable),
        denseAvailable: results.every(result => result.denseAvailable) };
    },
    async prepareCandidates(identities, signal) {
      const groups = Map.groupBy(identities, owner);
      await Promise.all([...groups].map(([position, ids]) => partitions[position].discovery.prepareCandidates?.(ids, signal)));
    },
    readCandidate: (identity, signal) => read(owner(identity), identity, signal),
  };
}
