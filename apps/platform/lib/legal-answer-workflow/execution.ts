import type { LegalRequest, OfficialProvision } from "./contracts";
import { createCorpusRuntime } from "./corpus-runtime";
import { createQueryEmbeddings, type EmbeddingReceipt } from "./embeddings";
import { createResponsesModel, type GenerationReceipt, type ProviderLedger } from "./provider";

type CorpusConfiguration = Omit<Parameters<typeof createCorpusRuntime>[0], "embed" | "submittedAt" | "deadlineMs">;
type GenerationConfiguration = Pick<Parameters<typeof createResponsesModel>[0], "rates" | "purpose" | "phase" | "fetchImpl" | "maximumRequestMicrousd" | "reasoningEffort" | "continuationReasoningEffort" | "inputTokenCounting" | "countInputAfterWriting" | "issueWriting" | "serviceTier" | "continuationServiceTier" | "fastRates">;
export type AttributedReceipt = { runId: string; category: "generation"; receipt: GenerationReceipt }
  | { runId: string; category: "embedding"; receipt: EmbeddingReceipt };

/** The reserved application run owns all model calls, query vectors, source reads and spending receipts. */
export function createAnswerExecution(input: {
  request: LegalRequest; runId: string; model: string; apiKey: string;
  corpus: CorpusConfiguration; generation: GenerationConfiguration; embeddingInputRate: number;
  ledger: ProviderLedger; receipt(record: AttributedReceipt): Promise<void>;
  fetchEmbedding?: typeof fetch;
}) {
  input.request.signal?.throwIfAborted();
  if (!input.runId.trim() || input.runId.length > 240) throw new Error("EXECUTION_RUN_ID_INVALID");
  const deadlineAt = input.request.submittedAt + input.request.deadlineMs;
  const model = createResponsesModel({ ...input.generation, model: input.model, apiKey: input.apiKey,
    inputTokenCounting: input.generation.inputTokenCounting ?? true,
    deadlineAt, ledger: input.ledger,
    receipt: receipt => input.receipt({ runId: input.runId, category: "generation", receipt }),
  });
  const embeddings = createQueryEmbeddings({ apiKey: input.apiKey, dimensions: 3072,
    deadlineAt, inputRate: input.embeddingInputRate, phase: input.generation.phase, ledger: input.ledger,
    fetchImpl: input.fetchEmbedding,
    receipt: receipt => input.receipt({ runId: input.runId, category: "embedding", receipt }),
  });
  const runtime = createCorpusRuntime({ ...input.corpus, submittedAt: input.request.submittedAt,
    deadlineMs: input.request.deadlineMs, embed: embeddings.embed });
  const pending = new Set<Promise<unknown>>();
  const complete: typeof model.complete = operation => {
    const result = model.complete(operation);
    pending.add(result);
    void result.then(() => pending.delete(result), () => pending.delete(result));
    return result;
  };
  return {
    model: { ...model, complete, recover: complete },
    async drain() { await Promise.allSettled([...pending, embeddings.drain()]); },
    corpus: runtime.corpus,
    async citations(evidence: readonly OfficialProvision[], signal: AbortSignal) {
      signal.throwIfAborted();
      return runtime.citations(evidence);
    },
    usage: model.usage,
    embeddingUsage: embeddings.usage,
  };
}
