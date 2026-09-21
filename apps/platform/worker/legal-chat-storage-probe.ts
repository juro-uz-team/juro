import {z} from "zod";
import {reserveAiRun,sha256Json} from "../lib/ai/run-store";
import {emptyLegalAnswer} from "../lib/legal-chat/answer-engine";
import {saveSignedInLegalAnswer} from "../lib/legal-chat/answer-persistence";
import {readSavedLegalAnswer} from "../lib/legal-chat/saved-answer";
import {openAiChatModel} from "../lib/ai/provider-models";
import {legalChatResponseSchema} from "../lib/ai/legal-chat-schema";

/** Exercises storage compatibility, allowance release and replay independently
 * of answer quality. Synthetic identities are removed even after a failed save. */
export async function runLegalChatStorageProbe(input:{
  db:D1Database;environment:string;enabled:string;executionId:string;locale:"ru"|"uz";signal?:AbortSignal;
}):Promise<void> {
  if(input.environment!=="staging"||input.enabled!=="true")throw new Error("PROBE_DISABLED");
  const executionId=z.string().uuid().parse(input.executionId);
  input.signal?.throwIfAborted();
  const prefix=`legal-chat-probe-${executionId}`,userId=`${prefix}-user`,workspaceId=`${prefix}-workspace`;
  const idempotencyKey=`${prefix}-request`,registryKey=`legal-chat:${workspaceId}:${userId}:${idempotencyKey}`;
  const now=new Date().toISOString();
  const owner={db:input.db,workspaceId,userId};
  const hash=await sha256Json({kind:"synthetic_storage_clarification",locale:input.locale,executionId});
  const reservation={...owner,idempotencyKey,requestHash:hash,conversationId:null,provider:"openai" as const,model:openAiChatModel("fast"),
    answerMode:"short" as const,reasoningMode:"fast" as const,legalDatabaseAsOf:"unavailable",instructionHash:hash,sourceVersionHash:hash};
  let created=false;
  try {
    // Plain INSERT prevents accidental adoption of a pre-existing identity.
    await input.db.batch([
      input.db.prepare("INSERT INTO user_profiles(id,email,locale,created_at,updated_at) VALUES (?,?,?,?,?)")
        .bind(userId,`${prefix}@synthetic.invalid`,input.locale,now,now),
      input.db.prepare("INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,?,?,?)")
        .bind(workspaceId,"Synthetic chat storage check",input.locale,now,now),
    ]);
    created=true;
    input.signal?.throwIfAborted();
    const run=await reserveAiRun(reservation);
    if(run.kind!=="reserved")throw new Error("PROBE_RESERVATION_FAILED");
    const result=legalChatResponseSchema.parse(emptyLegalAnswer({locale:input.locale,mode:"fast",answerMode:"short",unresolved:[]}));
    const saved=await saveSignedInLegalAnswer({...reservation,runId:run.runId,ledgerId:run.ledgerId,result,sources:[],
      providerResponseId:null,fallbackFromProvider:null,inputTokens:0,outputTokens:0,cachedInputTokens:0,attempts:0,latencyMs:0,
      branch:{operation:"new",question:"Synthetic storage clarification",sourceMessageId:null,forkedFromMessageId:null,parentBranchId:null,versionNumber:1}});
    input.signal?.throwIfAborted();
    const replay=await reserveAiRun(reservation);
    const reopened=await readSavedLegalAnswer({...owner,conversationId:saved.conversationId});
    const ledger=await input.db.prepare("SELECT status FROM ai_usage_ledger WHERE id=?").bind(run.ledgerId).first<{status:string}>();
    if(replay.kind!=="completed"||JSON.stringify(reopened?.result)!==JSON.stringify(result)||ledger?.status!=="released") {
      throw new Error("PROBE_STORAGE_CONTRACT_FAILED");
    }
  } finally {
    if(created)await input.db.batch([
      input.db.prepare("DELETE FROM idempotency_keys WHERE key=?").bind(registryKey),
      input.db.prepare("DELETE FROM workspaces WHERE id=?").bind(workspaceId),
      input.db.prepare("DELETE FROM user_profiles WHERE id=? AND email=?").bind(userId,`${prefix}@synthetic.invalid`),
    ]);
  }
}
