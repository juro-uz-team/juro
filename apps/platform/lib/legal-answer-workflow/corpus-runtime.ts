import { legalAnswerDeadlineMs } from "./deadline";
import { parsePinnedCandidateRelease } from "../legal-corpus/legal-candidate-index";
import type { PreparedEvidenceStore } from "../storage/prepared-evidence-objects";
import { createStoredCorpus } from "./stored-corpus";
import { buildCorpusCitations } from "./corpus-citations";
import type { OfficialProvision } from "./contracts";
import { createPreparedStoredReader } from "./prepared-stored-reader";
import { parsePreparedProvisionKey } from "./prepared-provision-objects";
import { createPreparedDiscovery } from "./prepared-discovery";
import { createPreparedTransportPair } from "./prepared-transport";
import { partitionedDiscovery } from "./prepared-addition";

type Worker = Parameters<typeof createPreparedTransportPair>[0]["discovery"];
type Lane = { release: unknown; worker: Worker };
type Partition = { current: Lane; history: Lane; sources?: Worker; replacements?: ReadonlySet<string> };

/** Per-request composition over complete stored provisions; source preparation is outside chat. */
export function createCorpusRuntime(input: {
  current: Lane; history: Lane; sources?: Worker;
  additions?: Partition[];
  store: Pick<PreparedEvidenceStore, "namespace" | "get" | "put">;
  generationSha256: string; submittedAt: number; deadlineMs: number;
  automaticReadLimit?: number;
  automaticReadScope?: "provision" | "section" | "document";
  questionFirstResearch?: boolean;
  candidateReadScope?: "provision" | "section" | "document";
  researchConcurrency?: number;
  entryNavigation?: boolean;
  prefetchInitialSearch?: boolean;
  embed(query: string, signal: AbortSignal): Promise<readonly number[]>;
}) {
  const current = parsePinnedCandidateRelease(input.current.release);
  const history = parsePinnedCandidateRelease(input.history.release);
  if (current.capability !== "current" || history.capability !== "history"
    || current.environment !== history.environment) throw new Error("CORPUS_RUNTIME_RELEASE_MISMATCH");
  if (!/^[a-f0-9]{64}$/u.test(input.generationSha256)
    || input.store.namespace !== `legal-prepared-${input.generationSha256}`) throw new Error("CITATION_STORE_IDENTITY");
  if (!Number.isFinite(input.submittedAt) || !Number.isFinite(input.deadlineMs)
    || input.deadlineMs <= 0 || input.deadlineMs > legalAnswerDeadlineMs || input.submittedAt > Date.now() + 1000) {
    throw new Error("REQUEST_DEADLINE_INVALID");
  }
  const partitions: Partition[] = [input, ...(input.additions ?? [])];
  const discovery = (lane: Lane, sources?: Worker) => createPreparedDiscovery({ release: lane.release, embed: input.embed,
    transport: createPreparedTransportPair({ discovery: lane.worker, sources }) });
  const readers = partitions.map(partition => ({
    current: createPreparedStoredReader({ ...partition.current, sources: partition.sources }),
    historical: createPreparedStoredReader({ ...partition.history, sources: partition.sources }),
  }));
  const owners = { current: new Map<string, number>(), historical: new Map<string, number>() };
  function scopeDiscovery(scope: "current" | "historical") {
    const parts = partitions.map(part => ({ discovery: discovery(scope === "current" ? part.current : part.history, part.sources),
      replacements: part.replacements ?? new Set<string>() }));
    return parts.length === 1 ? parts[0].discovery
      : partitionedDiscovery(parts, (work, position) => owners[scope].set(work, position));
  }
  const forWork = (scope: keyof typeof owners, work: string) => readers[owners[scope].get(work) ?? 0][scope];
  function forParent(scope: keyof typeof owners, parent: { objectKey: string }) {
    if (readers.length === 1) return readers[0][scope];
    const key = parsePreparedProvisionKey(parent.objectKey);
    return readers.find(reader => reader[scope].packageSha256 === key?.packageSha256)?.[scope];
  }
  const corpus = createStoredCorpus({ current: scopeDiscovery("current"), history: scopeDiscovery("historical"),
    deferSourceNavigation: true,
    objects: { async get(key, signal) {
      const reference = parsePreparedProvisionKey(key);
      if (!reference) throw new Error("PREPARED_PROVISION_KEY_INVALID");
      const reader = readers.flatMap(reader => [reader.current, reader.historical])
        .find(reader => reader.packageSha256 === reference.packageSha256);
      if (!reader) throw new Error("PREPARED_PACKAGE_MISMATCH");
      return reader.get(key, signal);
    } },
    provisions: {
      findInSource: (request, signal) => forWork(request.scope.kind, request.work).provisions.findInSource!(request, signal),
      describeRange: (request, signal) => forWork(request.scope.kind, request.work).provisions.describeRange!(request, signal),
      lookup: (request, signal) => forWork(request.scope.kind, request.work).provisions.lookup(request, signal),
      async reference(request, signal) {
        const scope = request.scope.kind;
        if (readers.length === 1) return readers[0][scope].provisions.reference(request, signal);
        const origin = forParent(scope, request.parent);
        if (!origin) return null;
        // StoredCorpus authenticates this operative reference against the
        // parent receipt before resolving it in the newest available partition.
        for (const reader of readers.toReversed()) {
          const result = await reader[scope].resolveExternalReference(request.url, request.scope, signal);
          if (result.found) return result.receipt;
        }
        return origin.provisions.reference(request, signal);
      },
      introductory: (request, signal) => forParent(request.scope.kind, request.parent)?.provisions.introductory?.(request, signal) ?? Promise.resolve(null),
      adjacent: (request, signal) => forParent(request.scope.kind, request.parent)?.provisions.adjacent?.(request, signal) ?? Promise.resolve(null),
    },
  });
  return {
    // Every legal research entry acquires an initial complete source when one
    // is readable. Navigation-only legacy settings must not strand all law
    // behind repeated model navigation before the first evidence arrives.
    corpus: { ...corpus, automaticReadLimit: Math.max(1, input.automaticReadLimit ?? 1),
      candidateReadScope: input.candidateReadScope ?? "provision",
      researchConcurrency: input.researchConcurrency ?? 3,
      entryNavigation: input.entryNavigation ?? false,
      questionFirstResearch: input.questionFirstResearch ?? false,
      automaticReadScope: input.automaticReadScope ?? "provision", prefetchInitialSearch: input.prefetchInitialSearch ?? false },
    citations: (evidence: readonly OfficialProvision[]) => buildCorpusCitations(evidence, corpus,
      { namespace: input.store.namespace, generationSha256: input.generationSha256 }),
  };
}
