import {openAiChatModel} from "../ai/provider-models";

type ChatModelStage="interpreting"|"formulating"|"assessing"|"writing"|"verifying";

/** Execution cost differs by task; all drafts still require verification. */
export function legalChatModelProfile(mode:"fast"|"deep",stage:ChatModelStage) {
  const model=openAiChatModel(mode);
  if(mode==="deep")return {model,timeoutMs:120_000,
    ...(["writing","verifying"].includes(stage)?{reasoningEffort:"max" as const,reasoningMode:"pro" as const}:{})};
  return {model,reasoningMode:"standard" as const,
    // Fast audits and assessments use changing evidence/schema prefixes.
    // Avoid automatic cache writes for this usually one-use request context.
    ...(["assessing","verifying"].includes(stage)?{promptCacheMode:"explicit" as const}:{}),
    reasoningEffort:stage==="writing"||stage==="formulating"?"none" as const:"medium" as const,
    timeoutMs:({interpreting:15_000,formulating:45_000,assessing:45_000,writing:60_000,verifying:60_000})[stage]};
}
