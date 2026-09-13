import type {LegalAiRunOptions} from "./provider";
import {recordProviderUsage, ProviderUsageControlError, type ProviderUsageInput} from "./provider-usage";

type Observation = Parameters<NonNullable<LegalAiRunOptions["onProviderAttemptFinished"]>>[0];
type Receipt = {observation: Observation; completedAt: string; startedAt: string};

/** One request owns all receipts, including concurrent synthesis and repair.
 * Completion order identifies physical attempts without guessing from model names. */
export function createLegalProviderUsageCollector(input: Pick<ProviderUsageInput,
  "db" | "environment" | "workspaceId" | "userId" | "feature"> & {runId: string}) {
  const receipts: Receipt[] = [];
  let persisted = 0;
  let pending: Promise<void> | undefined;
  return {
    observe(observation: Observation): void {
      const completed = Date.now();
      const elapsed = Number.isFinite(observation.elapsedMs)
        ? Math.max(0, Math.min(completed, observation.elapsedMs)) : 0;
      receipts.push({observation: {...observation, usage: observation.usage ? {...observation.usage} : null},
        completedAt: new Date(completed).toISOString(),
        // Derived from the adapter's elapsed time, not a separate dispatch observation.
        startedAt: new Date(completed - elapsed).toISOString()});
    },
    knownUsage() {
      return receipts.reduce((sum, {observation}) => ({
        inputTokens: sum.inputTokens + (observation.usage?.inputTokens ?? 0),
        outputTokens: sum.outputTokens + (observation.usage?.outputTokens ?? 0),
        cachedInputTokens: sum.cachedInputTokens + (observation.usage?.cachedInputTokens ?? 0),
      }), {inputTokens: 0, outputTokens: 0, cachedInputTokens: 0});
    },
    attemptCount() {return receipts.length;},
    async persist(): Promise<void> {
      if (pending) return pending;
      pending = (async () => {
        while (persisted < receipts.length) {
          const {observation, startedAt, completedAt} = receipts[persisted]!;
          try {await recordProviderUsage({...input, provider: observation.provider, model: observation.model,
            operation: observation.provider === "openai" ? "responses" : "messages",
            inputTokens: observation.usage?.inputTokens ?? 0, outputTokens: observation.usage?.outputTokens ?? 0,
            cachedInputTokens: observation.usage?.cachedInputTokens ?? 0, usageObserved: observation.usage !== null,
            status: observation.outcome === "completed" ? "succeeded" : "failed",
            errorCode: observation.errorCode, startedAt, completedAt,
            eventId: `provider_usage_${input.runId}_receipt_${persisted}`});
          } catch (error) {
            if (!(error instanceof ProviderUsageControlError)) throw error;
            // Never replay an already committed event or prevent later receipts.
            console.warn(JSON.stringify({event: "ai.provider_usage_control_deferred"}));
          }
          persisted += 1;
        }
      })();
      try {await pending;} finally {pending = undefined;}
    },
  };
}
