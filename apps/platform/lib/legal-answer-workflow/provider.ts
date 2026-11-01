import { legalAnswerDeadlineMs } from "./deadline";
import { createHash } from "node:crypto";
import { z } from "zod";
import { maximumGenerationCalls, type ModelOperation } from "./contracts";
import { withinSignal } from "./lifetime";
import { readProviderError, type ProviderErrorMetadata } from "./provider-http";
import { readProviderResponse } from "./provider-stream";
import { createWritingProjection } from "./writing-stream";
import type { SpendingPhase } from "../ai/category-spending-ledger";
import { retainFailedReservation } from "./reservation-failure";
import { providerSourceFiles } from "./provider-files";
import { compactEvidenceOperation, createEvidenceCompactor } from "./model-identities";
import { ProviderResearchSession } from "./provider-research-session";
import { emitResearchDiagnostic } from "./diagnostics";
import { countProviderInput } from "./provider-input-count";

type MaybePromise<T> = T | Promise<T>;
type TokenRates = { input: number; cachedInput: number; output: number };
export type GenerationPricing = TokenRates & { longContext?: TokenRates };
export type ProviderLedger = {
  assertReconciled?(): MaybePromise<void>;
  reserve(input: {category: string; phase: SpendingPhase; maximumMicrousd: number; expiresAt: number}): MaybePromise<string>;
  dispatch(id: string): MaybePromise<void>;
  settle(id: string, charged: number | null): MaybePromise<void>;
  cancel(id: string): MaybePromise<void>;
};
export type GenerationReceipt = {
  event: "reserved" | "received" | "usage" | "settled" | "failed"; reservationId: string; model: string;
  stage: ModelOperation["stage"]; requestSha256: string; at: string; maximumMicrousd: number;
  responseId?: string; inputTokens?: number; outputTokens?: number; reasoningTokens?: number; cachedInputTokens?: number;
  cacheWrite30mTokens?: number; cacheWrite12hTokens?: number;
  providerRequestId?: string;
  httpStatus?: number; providerError?: ProviderErrorMetadata;
  rates: { input: number; cachedInput: number; output: number };
  requestedServiceTier?: "default" | "fast";
  serviceTier?: "default" | "fast";
  chargedMicrousd?: number; errorCode?: string;
  countedInputTokens?: number;
};
type Configuration = {
  apiKey: string; model: string; purpose: "production" | "qualification"; phase: SpendingPhase;
  deadlineAt: number; rates: GenerationPricing;
  maximumRequestMicrousd?: number;
  inputTokenCounting?: boolean;
  countInputAfterWriting?: boolean;
  issueWriting?: boolean;
  continuationReasoningEffort?: "none" | "low" | "medium" | "high";
  serviceTier?: "default" | "fast";
  continuationServiceTier?: "default" | "fast";
  fastRates?: GenerationPricing;
  reasoningEffort?: Partial<Record<ModelOperation["stage"], "none" | "low" | "medium" | "high">>;
  ledger: ProviderLedger; receipt(record: GenerationReceipt): Promise<void>; fetchImpl?: typeof fetch;
};
const count = z.number().int().nonnegative().max(10_000_000);
const envelopeSchema = z.object({ id: z.string().min(1).max(240), model: z.string(), service_tier: z.string(),
  status: z.string(), usage: z.object({ input_tokens: count, output_tokens: count,
    input_tokens_details: z.object({ cached_tokens: count, cache_write_tokens: count.optional(),
      cache_write_tokens_details: z.object({ ttl_30m_tokens: count, ttl_12h_tokens: count }).optional(),
    }).passthrough(),
  }).passthrough(), output: z.array(z.unknown()),
});
const messageSchema = z.object({ type: z.literal("message"), role: z.literal("assistant"),
  phase: z.enum(["commentary", "final_answer"]).nullish(),
  content: z.array(z.discriminatedUnion("type", [
    z.object({ type: z.literal("output_text"), text: z.string() }),
    z.object({ type: z.literal("refusal"), refusal: z.string() }),
  ])),
});
const outputLimits = { interpret: 3000, select: 2000, assess: 5000, write: 10_000 };
// Standard GPT-6 / GPT-5.6 pricing changes above 272K input tokens.
const shortContextCeiling = 272_000;
function cost(input: number, cached: number, output: number, rates: TokenRates, write30m = 0, write12h = 0) {
  const amount = BigInt(input - cached - write30m - write12h) * BigInt(rates.input) * 4n
    + BigInt(cached) * BigInt(rates.cachedInput) * 4n + BigInt(output) * BigInt(rates.output) * 4n
    + BigInt(write30m) * BigInt(rates.input) * 5n + BigInt(write12h) * BigInt(rates.input) * 10n;
  const rounded = Number((amount + 3_999_999n) / 4_000_000n);
  if (!Number.isSafeInteger(rounded)) throw new Error("PROVIDER_COST_INVALID");
  return rounded;
}

/** Request-owned bounded transport beneath the request controller. */
export function createResponsesModel(configuration: Configuration) {
  if (configuration.maximumRequestMicrousd !== undefined && (!Number.isSafeInteger(configuration.maximumRequestMicrousd)
    || configuration.maximumRequestMicrousd <= 0)) throw new Error("PROVIDER_CONFIGURATION_INVALID");
  if (!configuration.apiKey || !["gpt-6-luna", "gpt-6.1-terra"].includes(configuration.model)) throw new Error("PROVIDER_CONFIGURATION_INVALID");
  if (Object.entries(configuration.reasoningEffort ?? {}).some(([stage, effort]) =>
    !["interpret", "select", "assess", "write"].includes(stage) || !["none", "low", "medium", "high"].includes(effort)))
    throw new Error("PROVIDER_CONFIGURATION_INVALID");
  if (configuration.continuationReasoningEffort !== undefined
    && !["none", "low", "medium", "high"].includes(configuration.continuationReasoningEffort)) throw new Error("PROVIDER_CONFIGURATION_INVALID");
  const initialServiceTier = configuration.serviceTier ?? "default";
  const serviceTiers = [initialServiceTier, configuration.continuationServiceTier ?? initialServiceTier];
  if (serviceTiers.some(tier => !["default", "fast"].includes(tier))
    || (serviceTiers.includes("fast") && (!configuration.fastRates
      || Boolean(configuration.rates.longContext) !== Boolean(configuration.fastRates.longContext))))
    throw new Error("PROVIDER_CONFIGURATION_INVALID");
  const pricing = [configuration.rates, ...(serviceTiers.includes("fast") ? [configuration.fastRates!] : [])];
  const tiers = pricing.flatMap(rates => [rates, ...(rates.longContext ? [rates.longContext] : [])]);
  for (const tier of tiers) {
    for (const rate of [tier.input, tier.cachedInput, tier.output]) {
      if (!Number.isSafeInteger(rate) || rate < 0 || rate > 1_000_000_000_000) throw new Error("PROVIDER_RATE_INVALID");
    }
    if (tier.cachedInput > tier.input) throw new Error("PROVIDER_RATE_INVALID");
  }
  const textInputTokenCeiling = configuration.rates.longContext ? 1_050_000 : shortContextCeiling;
  const upperRates: TokenRates = {
    input: Math.max(...tiers.map(tier => tier.input)),
    cachedInput: Math.max(...tiers.map(tier => tier.cachedInput)),
    output: Math.max(...tiers.map(tier => tier.output)),
  };
  let calls = 0, blocked = false;
  let allocatedMicrousd = 0;
  const compactResearch = createEvidenceCompactor();
  const researchSession = new ProviderResearchSession();
  const totals = { providerResponseId: null as string | null, inputTokens: 0, outputTokens: 0,
    cachedInputTokens: 0, attempts: 0, latencyMs: 0 };
  return {
    issueWriting: configuration.issueWriting === true,
    capacity: () => {
      // Conservative native/file envelope, including unexpected cache writes.
      const perCall = Math.max(1, cost(1_050_000, 0, 0, upperRates, 0, 1_050_000),
        cost(1_040_000, 0, 10_000, upperRates, 0, 1_040_000));
      return { remainingCalls: maximumGenerationCalls - calls, canReserveResearchAndComposition: !blocked
        && (configuration.maximumRequestMicrousd === undefined || allocatedMicrousd + perCall < configuration.maximumRequestMicrousd) };
    },
    usage: () => ({ ...totals }),
    async complete(operation: ModelOperation): Promise<unknown> {
      operation.signal.throwIfAborted();
      if (blocked) throw new Error("PROVIDER_SESSION_BLOCKED");
      if (calls >= maximumGenerationCalls) throw new Error("PROVIDER_CALL_LIMIT");
      const remaining = configuration.deadlineAt - Date.now();
      if (!Number.isFinite(remaining) || remaining <= 0 || remaining > legalAnswerDeadlineMs) throw new Error("PROVIDER_DEADLINE");
      const compact = operation.researchSession ? compactResearch(operation) : compactEvidenceOperation(operation);
      operation = compact.operation;
      const files = providerSourceFiles(operation);
      if (operation.researchSession && !configuration.rates.longContext) throw new Error("PROVIDER_CONTINUATION_PRICING");
      if (files.length && (!configuration.rates.longContext
        || !["gpt-6-luna", "gpt-6.1-terra"].includes(configuration.model))) throw new Error("PROVIDER_FILE_PRICING");
      // Both supported production models document a 1,050,000-token context window.
      // Reserve the entire window for visual inputs; disable API truncation explicitly.
      // Encrypted reasoning is opaque: its encoded length cannot establish its
      // rendered token count. Native sessions reserve the full shared window.
      const sharedContextWindow = Boolean(configuration.rates.longContext) || files.length > 0 || operation.researchSession === true;
      const inputTokenCeiling = sharedContextWindow ? 1_050_000 : textInputTokenCeiling;
      const content = files.length ? [{ type: "input_text", text: JSON.stringify(operation.input) }, ...files]
        : JSON.stringify(operation.input);
      const session = operation.researchSession ? researchSession.prepare(operation, content) : null;
      const packet = z.record(z.string(), z.unknown()).parse(operation.input);
      const continuation = operation.researchSession && operation.stage === "write" && packet.issueWriting === true
        && Array.isArray(packet.publishedIssues) && packet.publishedIssues.length > 0;
      const continuationEffort = continuation ? configuration.continuationReasoningEffort : undefined;
      const requestedServiceTier = continuation ? configuration.continuationServiceTier ?? initialServiceTier : initialServiceTier;
      const reservationRatesFor = (inputBound: number | null): TokenRates => {
        // Exact counts include a framing margin. Only a bound wholly within
        // the short tier can exclude long-context prices; unknown counts fund
        // the full window. Premium requests also fund standard fallback.
        const allowedPricing = requestedServiceTier === "fast" ? pricing : [configuration.rates];
        const allowedTiers = allowedPricing.flatMap(rates => inputBound !== null && inputBound <= shortContextCeiling
          ? [rates] : [rates, ...(rates.longContext ? [rates.longContext] : [])]);
        return {
          input: Math.max(...allowedTiers.map(tier => tier.input)),
          cachedInput: Math.max(...allowedTiers.map(tier => tier.cachedInput)),
          output: Math.max(...allowedTiers.map(tier => tier.output)),
        };
      };
      const request = { model: configuration.model, store: false, stream: Boolean(operation.onWriting), truncation: "disabled",
        service_tier: requestedServiceTier, prompt_cache_options: { mode: "explicit" },
        reasoning: { effort: continuationEffort ?? configuration.reasoningEffort?.[operation.stage] ?? "low" },
        max_output_tokens: outputLimits[operation.stage],
        instructions: session?.instruction ?? operation.instruction,
        input: session?.input ?? [{ role: "user", content }],
        ...(session ? { tools: session.tools, parallel_tool_calls: session.parallel_tool_calls,
          ...(session.tool_choice ? { tool_choice: session.tool_choice } : {}) } : {}),
        text: { verbosity: operation.stage === "write" && packet.format === "detailed" ? "high" : "medium",
          format: { type: "json_schema", name: `legal_${operation.stage}`, strict: true, schema: session?.schema ?? operation.schema } },
      };
      // Byte-level upper bound for supplied text plus framing; no silent input truncation.
      const boundedInputTokens = Buffer.byteLength(JSON.stringify(request,
        (key, value) => key === "file_data" ? "[visual input reserved separately]" : value)) + 4096;
      const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value ?? null));
      const body = JSON.stringify(request);
      await configuration.ledger.assertReconciled?.();
      const countBeforeAdmission = configuration.inputTokenCounting || (configuration.countInputAfterWriting
        && Array.isArray(packet.publishedIssues) && packet.publishedIssues.length > 0);
      let countedInputTokens = countBeforeAdmission
        ? await countProviderInput(request, configuration.apiKey, operation.signal, configuration.fetchImpl ?? fetch) : null;
      // Bytes are only a conservative fallback. Rejecting by bytes before an
      // exact processed count can discard complete multibyte law that fits.
      // Without an exact native count, fund the full window and let the provider
      // enforce capacity with truncation disabled; byte size is not token capacity.
      const inputRejected = countedInputTokens === null ? !sharedContextWindow && boundedInputTokens > textInputTokenCeiling
        : countedInputTokens + (sharedContextWindow ? outputLimits[operation.stage] : 0) > inputTokenCeiling;
      emitResearchDiagnostic({ event: "provider_packet", serializedBytes: boundedInputTokens - 4096,
        evidenceBytes: size(packet.evidence), navigationBytes: size([packet.unreadCandidates, packet.availableEvidence, packet.retainedResults]),
        contextBytes: size([packet.question, packet.history, packet.privateDocuments, packet.caseContext, packet.coverageRecords]),
        schemaBytes: size(request.text), fileCount: files.length, rejected: inputRejected });
      if (inputRejected) throw new Error("PROVIDER_INPUT_LIMIT");
      // Visual input and generated output share the model context window. Cost
      // is linear, so its maximum is at one of the two feasible endpoints.
      // Include the highest cache-write rate even though writes violate policy.
      const outputCeiling = outputLimits[operation.stage];
      const inputAtMaximumOutput = sharedContextWindow ? inputTokenCeiling - outputCeiling : inputTokenCeiling;
      let countedCeiling = countedInputTokens === null ? null : Math.min(inputTokenCeiling, countedInputTokens + 4096);
      let reservationRates = reservationRatesFor(countedCeiling);
      let maximumMicrousd = countedCeiling !== null
        ? Math.max(1, cost(countedCeiling, 0, outputCeiling, reservationRates, 0, countedCeiling)) : Math.max(1,
        cost(inputTokenCeiling, 0, 0, reservationRates, 0, inputTokenCeiling),
        cost(inputAtMaximumOutput, 0, outputCeiling, reservationRates, 0, inputAtMaximumOutput));
      const terminalMaximum = Math.max(1, cost(1_050_000, 0, 0, upperRates, 0, 1_050_000),
        cost(1_040_000, 0, 10_000, upperRates, 0, 1_040_000));
      if (configuration.maximumRequestMicrousd !== undefined && operation.researchSession && operation.stage !== "interpret"
        && (packet.canResearch === true || packet.canSelectEvidence === true)
        && allocatedMicrousd + maximumMicrousd + terminalMaximum > configuration.maximumRequestMicrousd)
        throw new Error("PROVIDER_COMPOSITION_RESERVE");
      // Counting yields to other admitted calls; recheck before the synchronous reservation claim.
      if (calls >= maximumGenerationCalls) throw new Error("PROVIDER_CALL_LIMIT");
      if (configuration.maximumRequestMicrousd !== undefined
        && allocatedMicrousd + maximumMicrousd > configuration.maximumRequestMicrousd) throw new Error("PROVIDER_REQUEST_BUDGET");
      allocatedMicrousd += maximumMicrousd;
      const requestSha256 = createHash("sha256").update(body).digest("hex");
      const local = new AbortController(), signal = AbortSignal.any([operation.signal, local.signal]);
      const timer = setTimeout(() => local.abort(new Error("PROVIDER_DEADLINE")), remaining);
      const started = performance.now();
      let id: string | undefined, dispatched = false, settled = false;
      let accepted = false;
      let responseId: string | undefined;
      let providerError: ProviderErrorMetadata | undefined;
      let appliedRates: TokenRates = reservationRates;
      let serviceTier: "default" | "fast" | undefined;
      const receipt = (event: GenerationReceipt["event"], extra: Partial<GenerationReceipt> = {}) =>
        configuration.receipt({ event, reservationId: id!, model: configuration.model, stage: operation.stage,
          requestSha256, maximumMicrousd, rates: { ...appliedRates }, requestedServiceTier,
          ...(serviceTier ? { serviceTier } : {}), ...(countedInputTokens !== null ? { countedInputTokens } : {}),
          at: new Date().toISOString(), ...extra });
      calls++;
      try {
        const reserve = () => configuration.ledger.reserve({ category: "generation", phase: configuration.phase,
          maximumMicrousd, expiresAt: configuration.deadlineAt });
        try { id = await reserve(); }
        catch (error) {
          if (countBeforeAdmission || countedInputTokens !== null
            || !(error instanceof Error) || error.message !== "PROVIDER_SPENDING_CAP") throw error;
          // A refused conservative hold is not permission to dispatch. Count
          // the unchanged complete request, then seek admission once more.
          countedInputTokens = await countProviderInput(request, configuration.apiKey, signal, configuration.fetchImpl ?? fetch);
          if (countedInputTokens === null) throw error;
          if (countedInputTokens + (sharedContextWindow ? outputCeiling : 0) > inputTokenCeiling) throw new Error("PROVIDER_INPUT_LIMIT");
          countedCeiling = Math.min(inputTokenCeiling, countedInputTokens + 4096);
          reservationRates = reservationRatesFor(countedCeiling);
          appliedRates = reservationRates;
          const refinedMaximum = Math.max(1, cost(countedCeiling, 0, outputCeiling, reservationRates, 0, countedCeiling));
          if (refinedMaximum >= maximumMicrousd) throw error;
          allocatedMicrousd -= maximumMicrousd - refinedMaximum;
          maximumMicrousd = refinedMaximum;
          id = await reserve();
        }
        await receipt("reserved");
        signal.throwIfAborted();
        await configuration.ledger.dispatch(id);
        dispatched = true;
        signal.throwIfAborted();
        totals.attempts++;
        const clientRequestId = id;
        const response = await withinSignal(signal, () => (configuration.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
          method: "POST", headers: { authorization: `Bearer ${configuration.apiKey}`, "content-type": "application/json",
            "x-client-request-id": clientRequestId },
          body, signal, redirect: "error", cache: "no-store",
        }));
        const providerRequestId = response.headers.get("x-request-id");
        await receipt("received", { httpStatus: response.status, ...(providerRequestId ? { providerRequestId } : {}) });
        if (!response.ok) {
          providerError = await readProviderError(response, signal);
          throw new Error("PROVIDER_HTTP_FAILED");
        }
        const envelope = envelopeSchema.parse(await readProviderResponse(response, signal,
          operation.onWriting && !session?.privateReview ? createWritingProjection(operation.onWriting, session?.normalizeProse) : undefined,
          metadata => { providerError = metadata; }, session?.onArguments));
        responseId = envelope.id;
        const usage = envelope.usage, cached = usage.input_tokens_details.cached_tokens;
        // Optional diagnostics must not invalidate an otherwise billable response.
        const reasoning = z.object({ reasoning_tokens: count }).safeParse(usage.output_tokens_details);
        const writes = usage.input_tokens_details.cache_write_tokens ?? 0;
        const write30m = usage.input_tokens_details.cache_write_tokens_details?.ttl_30m_tokens ?? 0;
        const write12h = usage.input_tokens_details.cache_write_tokens_details?.ttl_12h_tokens ?? 0;
        const servedFast = envelope.service_tier === "fast" || envelope.service_tier === "priority";
        if (envelope.model !== configuration.model || !(envelope.service_tier === "default" || (servedFast && requestedServiceTier === "fast"))
          || writes !== write30m + write12h || cached + writes > usage.input_tokens || usage.input_tokens > inputTokenCeiling
          || (countedCeiling !== null && usage.input_tokens > countedCeiling)
          || (sharedContextWindow && usage.input_tokens + usage.output_tokens > inputTokenCeiling)
          || usage.output_tokens > outputLimits[operation.stage]) throw new Error("PROVIDER_USAGE_INVALID");
        const servedPricing = servedFast ? configuration.fastRates! : configuration.rates;
        const tier = usage.input_tokens > shortContextCeiling ? servedPricing.longContext! : servedPricing;
        serviceTier = servedFast ? "fast" : "default";
        appliedRates = { input: tier.input, cachedInput: tier.cachedInput, output: tier.output };
        const chargedMicrousd = cost(usage.input_tokens, cached, usage.output_tokens, appliedRates, write30m, write12h);
        await receipt("usage", { responseId, inputTokens: usage.input_tokens, outputTokens: usage.output_tokens,
          ...(reasoning.success ? { reasoningTokens: reasoning.data.reasoning_tokens } : {}),
          cachedInputTokens: cached, cacheWrite30mTokens: write30m, cacheWrite12hTokens: write12h, chargedMicrousd });
        signal.throwIfAborted();
        await configuration.ledger.settle(id, chargedMicrousd);
        allocatedMicrousd -= maximumMicrousd - chargedMicrousd;
        settled = true;
        totals.providerResponseId = responseId;
        totals.inputTokens += usage.input_tokens; totals.outputTokens += usage.output_tokens; totals.cachedInputTokens += cached;
        await receipt("settled", { responseId, chargedMicrousd });
        if (writes) throw new Error("PROVIDER_CACHE_POLICY_MISMATCH");
        if (envelope.status !== "completed") throw new Error("PROVIDER_OUTPUT_INCOMPLETE");
        signal.throwIfAborted();
        const toolResult = await session?.accept(envelope.output, signal);
        if (toolResult) {
          signal.throwIfAborted();
          const restored = compact.restore(toolResult);
          accepted = true;
          return restored;
        }
        const rawMessages = envelope.output.filter(item => typeof item === "object" && item !== null
          && "type" in item && item.type === "message");
        const messages = rawMessages.map(item => messageSchema.safeParse(item));
        if (messages.some(item => !item.success)) throw new Error("PROVIDER_OUTPUT_INVALID");
        const finals = messages.filter(item => item.success && item.data.phase !== "commentary");
        if (finals.length !== 1 || !finals[0].success) throw new Error("PROVIDER_OUTPUT_INVALID");
        const content = finals[0].data.content;
        if (content.some(item => item.type === "refusal")) throw new Error("PROVIDER_REFUSAL");
        if (content.length !== 1 || content[0].type !== "output_text") throw new Error("PROVIDER_OUTPUT_INVALID");
        signal.throwIfAborted();
        const parsed = JSON.parse(content[0].text);
        const result = compact.restore(session ? await session.restore(parsed, signal) : parsed);
        signal.throwIfAborted();
        const final = session ? session.finish(result) : result;
        accepted = true;
        return final;
      } catch (error) {
        const reservationBlocks = await retainFailedReservation(configuration.ledger, { id, dispatched, settled });
        blocked ||= reservationBlocks || dispatched;
        const errorCode = error instanceof Error && /^PROVIDER_[A-Z_]+$/.test(error.message)
          ? error.message : error instanceof z.ZodError || error instanceof SyntaxError
            || error instanceof Error && /^ISSUE_[A-Z_]+$/u.test(error.message)
            ? "PROVIDER_OUTPUT_INVALID"
            : error instanceof Error && /^SPENDING_[A-Z_]+$/u.test(error.message) ? "PROVIDER_LEDGER_FAILED"
              : !dispatched ? "PROVIDER_ADMISSION_FAILED"
                : signal.aborted ? "PROVIDER_DEADLINE" : "PROVIDER_TRANSPORT_FAILED";
        if (id) await receipt("failed", { ...(responseId ? { responseId } : {}), ...(providerError ? { providerError } : {}), errorCode });
        throw new Error(errorCode);
      } finally {
        emitResearchDiagnostic({ event: "provider_completion", durationMs: performance.now() - started,
          category: signal.aborted ? "cancelled" : accepted ? "accepted" : "rejected" });
        totals.latencyMs += Math.round(performance.now() - started);
        clearTimeout(timer);
        local.abort();
      }
    },
  };
}
