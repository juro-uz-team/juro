import { legalAnswerDeadlineMs } from "./deadline";
import { createHash } from "node:crypto";
import { retainFailedReservation } from "./reservation-failure";
import { z } from "zod";
import type { ProviderLedger } from "./provider";
import { readProviderJson, readProviderError, type ProviderErrorMetadata } from "./provider-http";
import { withinSignal } from "./lifetime";

export type EmbeddingReceipt = {
  event: "reserved" | "received" | "usage" | "settled" | "failed"; reservationId: string;
  model: "text-embedding-3-large"; dimensions: 1536 | 3072; requestSha256: string; at: string;
  inputRate: number; maximumMicrousd: number; providerRequestId?: string; inputTokens?: number;
  chargedMicrousd?: number; errorCode?: string;
  httpStatus?: number; providerError?: ProviderErrorMetadata;
};
type Configuration = {
  apiKey: string; dimensions: 1536 | 3072; inputRate: number; deadlineAt: number;
  phase: Parameters<ProviderLedger["reserve"]>[0]["phase"]; ledger: ProviderLedger;
  receipt(record: EmbeddingReceipt): Promise<void>; fetchImpl?: typeof fetch;
};
const usageSchema = z.object({ model: z.literal("text-embedding-3-large"),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative().max(8192),
    total_tokens: z.number().int().nonnegative().max(8192) }), data: z.unknown(),
});
const vectorSchema = z.array(z.object({ object: z.literal("embedding"), index: z.literal(0),
  embedding: z.array(z.number().finite()).max(3072) })).length(1);

/** Query vectors are scoped to one request and reuse only byte-identical input at the same dimensions. */
export function createQueryEmbeddings(configuration: Configuration) {
  if (!configuration.apiKey || ![1536, 3072].includes(configuration.dimensions)
    || !Number.isSafeInteger(configuration.inputRate) || configuration.inputRate <= 0
    || configuration.inputRate > 1_000_000_000_000) throw new Error("EMBEDDING_CONFIGURATION_INVALID");
  const retained = new Map<string, Promise<readonly number[]>>();
  let blocked = false;
  const totals = { inputTokens: 0, attempts: 0, cacheReuses: 0 };
  const cost = (tokens: number) => Number((BigInt(tokens) * BigInt(configuration.inputRate) + 999_999n) / 1_000_000n);
  const execute = async (query: string, caller: AbortSignal): Promise<readonly number[]> => {
    const remaining = configuration.deadlineAt - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0 || remaining > legalAnswerDeadlineMs) throw new Error("EMBEDDING_DEADLINE");
    const local = new AbortController(), signal = AbortSignal.any([local.signal, caller]);
    const timer = setTimeout(() => local.abort(new Error("EMBEDDING_DEADLINE")), remaining);
    const body = JSON.stringify({ model: "text-embedding-3-large", input: query,
      dimensions: configuration.dimensions, encoding_format: "float" });
    const requestSha256 = createHash("sha256").update(body).digest("hex"), maximumMicrousd = cost(8192);
    let id: string | undefined, dispatched = false, settled = false;
    let providerError: ProviderErrorMetadata | undefined;
    const receipt = (event: EmbeddingReceipt["event"], extra: Partial<EmbeddingReceipt> = {}) => configuration.receipt({
      event, reservationId: id!, model: "text-embedding-3-large", dimensions: configuration.dimensions,
      inputRate: configuration.inputRate, requestSha256, maximumMicrousd, at: new Date().toISOString(), ...extra,
    });
    try {
      id = await configuration.ledger.reserve({ category: "embedding", phase: configuration.phase,
        maximumMicrousd, expiresAt: configuration.deadlineAt });
      await receipt("reserved");
      signal.throwIfAborted();
      await configuration.ledger.dispatch(id);
      dispatched = true;
      signal.throwIfAborted();
      totals.attempts++;
      const clientRequestId = id;
      const response = await withinSignal(signal, () => (configuration.fetchImpl ?? fetch)("https://api.openai.com/v1/embeddings", {
        method: "POST", headers: { authorization: `Bearer ${configuration.apiKey}`, "content-type": "application/json",
          "x-client-request-id": clientRequestId }, body, signal, redirect: "error", cache: "no-store",
      }));
      const providerRequestId = response.headers.get("x-request-id");
      await receipt("received", { httpStatus: response.status, ...(providerRequestId ? { providerRequestId } : {}) });
      if (!response.ok) {
        providerError = await readProviderError(response, signal);
        throw new Error("EMBEDDING_HTTP_FAILED");
      }
      const envelope = usageSchema.parse(await readProviderJson(response, signal, 256 * 1024));
      if (envelope.usage.prompt_tokens !== envelope.usage.total_tokens) throw new Error("EMBEDDING_USAGE_INVALID");
      const chargedMicrousd = cost(envelope.usage.prompt_tokens);
      await receipt("usage", { inputTokens: envelope.usage.prompt_tokens, chargedMicrousd });
      await configuration.ledger.settle(id, chargedMicrousd);
      settled = true;
      totals.inputTokens += envelope.usage.prompt_tokens;
      await receipt("settled", { chargedMicrousd });
      const parsed = vectorSchema.safeParse(envelope.data);
      if (!parsed.success || parsed.data[0].embedding.length !== configuration.dimensions
        || !parsed.data[0].embedding.some(value => value !== 0)) throw new Error("EMBEDDING_VECTOR_INVALID");
      signal.throwIfAborted();
      return parsed.data[0].embedding;
    } catch (error) {
      const reservationBlocks = await retainFailedReservation(configuration.ledger, { id, dispatched, settled });
      blocked ||= reservationBlocks;
      const errorCode = error instanceof Error && /^(?:EMBEDDING|PROVIDER)_[A-Z_]+$/.test(error.message)
        ? error.message : "EMBEDDING_TRANSPORT_FAILED";
      if (id) await receipt("failed", { errorCode, ...(providerError ? { providerError } : {}) });
      throw new Error(errorCode);
    } finally { clearTimeout(timer); local.abort(); }
  };
  return {
    async drain() { await Promise.allSettled(retained.values()); },
    usage: () => ({ ...totals }),
    async embed(query: string, signal: AbortSignal): Promise<readonly number[]> {
      signal.throwIfAborted();
      if (blocked) throw new Error("EMBEDDING_SESSION_BLOCKED");
      if (!query.trim() || Buffer.byteLength(query) > 8191) throw new Error("EMBEDDING_INPUT_LIMIT");
      let pending = retained.get(query);
      if (!pending) {
        if (retained.size >= 18) throw new Error("EMBEDDING_CALL_LIMIT");
        pending = execute(query, signal);
        retained.set(query, pending);
      } else totals.cacheReuses++;
      return [...await withinSignal(signal, () => pending!)];
    },
  };
}
