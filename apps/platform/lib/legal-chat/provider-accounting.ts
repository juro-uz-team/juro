import {assertProviderCallAllowed,type ProviderEnvironment} from "../ai/provider-cost-control";
import {recordProviderUsage} from "../ai/provider-usage";
import type {AiProviderAttemptObservation} from "../document-builder/ai/openai";

/** Each model attempt retains the shared circuit and cost-accounting boundary.
 * Unknown token usage is recorded as unknown, never invented as measured zero. */
export function createLegalChatAccounting(input:{
  db:D1Database;environment:ProviderEnvironment;workspaceId:string|null;userId:string|null;
  feature:"legal_chat"|"guest_legal_chat";
}) {
  let attempts=0,inputTokens=0,outputTokens=0,cachedInputTokens=0;
  return {
    async onAttempt(){
      await assertProviderCallAllowed({...input,provider:"openai"});
      attempts++;
    },
    async onAttemptFinished(observation:AiProviderAttemptObservation){
      const completed=Date.now();
      if(observation.usage){
        inputTokens+=observation.usage.inputTokens;
        outputTokens+=observation.usage.outputTokens;
        cachedInputTokens+=observation.usage.cachedInputTokens;
      }
      await recordProviderUsage({...input,provider:"openai",operation:"responses",model:observation.model,
        inputTokens:observation.usage?.inputTokens??0,outputTokens:observation.usage?.outputTokens??0,
        cachedInputTokens:observation.usage?.cachedInputTokens??0,usageObserved:observation.usage!==null,
        status:observation.outcome==="completed"?"succeeded":"failed",errorCode:observation.errorCode,
        startedAt:new Date(completed-observation.elapsedMs).toISOString(),completedAt:new Date(completed).toISOString()});
    },
    totals(){return {attempts,inputTokens,outputTokens,cachedInputTokens};},
  };
}
