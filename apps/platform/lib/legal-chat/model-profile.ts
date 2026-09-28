import {openAiChatModel} from "../ai/provider-models";

type ChatModelStage="interpreting"|"formulating"|"assessing"|"writing";

/** Mode selects only the model; each task has the same effort and deadline in both modes. */
export function legalChatModelProfile(mode:"fast"|"deep",stage:ChatModelStage) {
  const model=openAiChatModel(mode);
  return {model,reasoningMode:"standard" as const,
    // Assessments use changing evidence/schema prefixes.
    // Avoid automatic cache writes for this usually one-use request context.
    ...(stage === "assessing"?{promptCacheMode:"explicit" as const}:{}),
    reasoningEffort:stage==="assessing"?"medium" as const:stage==="formulating"?"none" as const:"low" as const,
    timeoutMs:({interpreting:15_000,formulating:45_000,assessing:45_000,writing:60_000})[stage]};
}
