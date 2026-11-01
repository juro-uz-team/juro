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

type Worker = Parameters<typeof createPreparedTransportPair>[0]["discovery"];
type Lane = { release: unknown; worker: Worker };

/** Per-request composition over complete stored provisions; source preparation is outside chat. */
export function createCorpusRuntime(input: {
  current: Lane; history: Lane; sources?: Worker;
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
  const discovery = (lane: Lane) => createPreparedDiscovery({ release: lane.release, embed: input.embed,
    transport: createPreparedTransportPair({ discovery: lane.worker, sources: input.sources }) });
  const readers = { current: createPreparedStoredReader({ ...input.current, sources: input.sources }),
    historical: createPreparedStoredReader({ ...input.history, sources: input.sources }) };
  const corpus = createStoredCorpus({ current: discovery(input.current), history: discovery(input.history),
    deferSourceNavigation: true,
    objects: { async get(key, signal) {
      const reference = parsePreparedProvisionKey(key);
      if (!reference) throw new Error("PREPARED_PROVISION_KEY_INVALID");
      const reader = Object.values(readers).find(reader => reader.packageSha256 === reference.packageSha256);
      if (!reader) throw new Error("PREPARED_PACKAGE_MISMATCH");
      return reader.get(key, signal);
    } },
    provisions: {
      findInSource: (request, signal) => readers[request.scope.kind].provisions.findInSource!(request, signal),
      describeRange: (request, signal) => readers[request.scope.kind].provisions.describeRange!(request, signal),
      lookup: (request, signal) => readers[request.scope.kind].provisions.lookup(request, signal),
      reference: (request, signal) => readers[request.scope.kind].provisions.reference(request, signal),
      introductory: (request, signal) => readers[request.scope.kind].provisions.introductory?.(request, signal) ?? Promise.resolve(null),
      adjacent: (request, signal) => readers[request.scope.kind].provisions.adjacent?.(request, signal) ?? Promise.resolve(null),
    },
  });
  return {
    corpus: { ...corpus, automaticReadLimit: input.automaticReadLimit ?? 0,
      candidateReadScope: input.candidateReadScope ?? "provision",
      researchConcurrency: input.researchConcurrency ?? 3,
      entryNavigation: input.entryNavigation ?? false,
      questionFirstResearch: input.questionFirstResearch ?? false,
      automaticReadScope: input.automaticReadScope ?? "provision", prefetchInitialSearch: input.prefetchInitialSearch ?? false },
    citations: (evidence: readonly OfficialProvision[]) => buildCorpusCitations(evidence, corpus,
      { namespace: input.store.namespace, generationSha256: input.generationSha256 }),
  };
}
