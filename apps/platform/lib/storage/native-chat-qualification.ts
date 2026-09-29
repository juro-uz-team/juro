import {z} from "zod";
import {nativeChatWorkload,nativeChatWorkloadSha256} from "./native-chat-workload";

const id=z.string().min(1).max(700);
export const nativeChatProofSchema=z.object({bindingSha256:z.string().regex(/^[a-f0-9]{64}$/u),
  expectedCaseIds:z.array(id).min(1),heldOutCaseIds:z.array(id).min(1),
  results:z.array(z.object({id,inputSha256:z.string().regex(/^[a-f0-9]{64}$/u),mode:z.enum(["fast","deep"]),locale:z.enum(["en","ru","uz"]),
    actor:z.enum(["guest","signed"]),concurrency:z.literal(5),milliseconds:z.number().finite().nonnegative(),
    outcome:z.enum(["answered","partial"]),gapCount:z.number().int().nonnegative(),
    findingCount:z.number().int().positive(),sourceCount:z.number().int().positive(),
    validationMethod:z.literal("programmatic"),interpretationIndependentlyReviewed:z.literal(false),
    sourceChecksPassed:z.literal(true),reloadPassed:z.literal(true),verificationModelCalls:z.literal(0),
    modelCalls:z.array(z.object({stage:z.enum(["interpreting","formulating","assessing","writing"]),
      model:z.enum(["gpt-6-luna","gpt-5.6-terra"])}).strict()).min(2),
  }).strict()).min(40),
}).strict();

/** Programmatic delivery evidence never certifies legal entailment or completeness. */
export function verifyNativeChatProof(proof:z.infer<typeof nativeChatProofSchema>,checks:readonly string[],workloadSha256:string,version:2|3=2):void {
  const heldOut=nativeChatWorkload.filter(row=>row.heldOut).map(row=>row.id);
  if(workloadSha256!==nativeChatWorkloadSha256||proof.results.length!==nativeChatWorkload.length
    ||proof.heldOutCaseIds.length!==heldOut.length||heldOut.some(id=>!proof.heldOutCaseIds.includes(id))) {
    throw Error("NATIVE_CHAT_WORKLOAD_CHANGED");
  }
  const required=["tests","typecheck","build","browser","model_only_modes","no_model_verification",
    "citation_integrity","tenant_isolation","saved_replay","historical_questions","comparison_questions","private_context"];
  if(required.some(id=>!checks.includes(id)))throw Error("NATIVE_CHAT_CHECK_MISSING");
  for(const row of proof.results){
    const input=nativeChatWorkload.find(input=>input.id===row.id);
    if(!input||input.inputSha256!==row.inputSha256||input.mode!==row.mode
      ||input.locale!==row.locale||input.actor!==row.actor||input.concurrency!==row.concurrency) {
      throw Error("NATIVE_CHAT_WORKLOAD_CHANGED");
    }
    if((row.outcome==="partial")!==(row.gapCount>0))throw Error("NATIVE_CHAT_GAPS_NOT_VISIBLE");
    const model=row.mode==="fast"?"gpt-6-luna":"gpt-5.6-terra";
    if(row.modelCalls.some(call=>call.model!==model)
      ||!["interpreting","writing"].every(stage=>row.modelCalls.some(call=>call.stage===stage)))throw Error("NATIVE_CHAT_MODEL_ROUTING");
  }
  for(const mode of ["fast","deep"] as const){
    const rows=proof.results.filter(row=>row.mode===mode);
    if(rows.length<20||new Set(rows.map(row=>row.locale)).size!==3||new Set(rows.map(row=>row.actor)).size!==2
      ||!rows.some(row=>proof.heldOutCaseIds.includes(row.id)))throw Error("NATIVE_CHAT_WORKLOAD_INCOMPLETE");
    const times=rows.map(row=>row.milliseconds).sort((a,b)=>a-b),middle=Math.floor(times.length/2);
    const median=times.length%2?times[middle]!:(times[middle-1]!+times[middle]!)/2;
    if(median>(version===2?15000:45000)||times[Math.ceil(times.length*.95)-1]!>(version===2?30000:90000))throw Error("NATIVE_CHAT_LATENCY_NOT_QUALIFIED");
  }
}
