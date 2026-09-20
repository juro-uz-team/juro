import {z} from "zod";
import {callOpenAiStructured} from "../lib/document-builder/ai/openai";
import {callAnthropicStructured} from "../lib/document-builder/ai/anthropic";
import {openAiChatModel} from "../lib/ai/provider-models";

const outputSchema=z.object({status:z.literal("ok")}).strict();

/** Provider connectivity and structured-output validation only. Legal Answer
 * correctness is measured by the separate chat acceptance checks. */
export async function probeProviderContract(provider:"openai"|"anthropic",options:{timeoutMs:number;deadlineAt?:number}){
  const request={instructions:"This is a technical connectivity check. Return the required status exactly.",
    input:{check:"structured_output"},schema:z.toJSONSchema(outputSchema),parse:(value:unknown)=>outputSchema.parse(value),
    timeoutMs:options.timeoutMs,deadlineAt:options.deadlineAt,requestId:crypto.randomUUID(),maxAttempts:1 as const};
  const result=provider==="openai"
    ?await callOpenAiStructured({...request,schemaName:"provider_connectivity",model:openAiChatModel("fast"),reasoningEffort:"none",maxOutputTokens:256})
    :await callAnthropicStructured({...request,maxTokens:256});
  return {provider,fallbackFromProvider:null,status:result.data.status};
}
