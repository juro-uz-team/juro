import {openAiChatModel} from "../ai/provider-models";
import {LEGAL_CHAT_PROVIDER_TIMEOUT_MS} from "./execution-limits";

type ChatModelStage="interpreting"|"formulating"|"assessing"|"writing";

/** Execution cost differs by task; all drafts receive programmatic checks. */
export function legalChatModelProfile(mode:"fast"|"deep",stage:ChatModelStage) {
  const model=openAiChatModel(mode);
  if(mode==="deep")return {model,timeoutMs:LEGAL_CHAT_PROVIDER_TIMEOUT_MS,
    ...(stage === "writing"?{reasoningEffort:"max" as const,reasoningMode:"pro" as const}:{})};
  return {model,reasoningMode:"standard" as const,
    // Fast assessments use changing evidence/schema prefixes.
    // Avoid automatic cache writes for this usually one-use request context.
    ...(stage === "assessing"?{promptCacheMode:"explicit" as const}:{}),
    reasoningEffort:stage==="writing"||stage==="formulating"?"none" as const:"medium" as const,
    timeoutMs:({interpreting:15_000,formulating:45_000,assessing:45_000,writing:60_000})[stage]};
}
