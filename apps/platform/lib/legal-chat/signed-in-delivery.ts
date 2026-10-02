import {readLegalUserContext} from "./user-context";
import type {LegalDocumentContext} from "./document-context";
import {assertVoiceTranscriptMatches} from "../ai/voice-recording";
import type {IdentityKeyring} from "../auth/keyring";
import {reserveAiRun,renewAiRunReservation,failAiRun,readAiRunStatus,sha256Json} from "../ai/run-store";
import {openAiChatModel} from "../ai/provider-models";
import type {AiRuntimeSettings} from "../ai/runtime-settings";
import {readConversationContext} from "./conversation-context";
import {readSavedLegalAnswer} from "./saved-answer";
import {executeRuntimeLegalChat} from "./runtime-execution";
import {createLegalChatAccounting} from "./provider-accounting";
import {saveSignedInLegalAnswer} from "./answer-persistence";
import {legalChatTerminalResponse} from "./terminal-response";
import type {CorpusResearchService} from "./remote-corpus-research";
import type {LegalChatRequest} from "./request-schema";
import type {LegalChatStage} from "./execution";
import {LegalChatDeliveryError,type LegalChatDelivery} from "./delivery-stream";

/** Owner/workspace resolution precedes this seam. Idempotency is bound to the
 * explicit request, not a mutable latest branch or runtime configuration, so a
 * replay never becomes a fresh model invocation after the first save. */
export async function deliverSignedInLegalChat(input:{
  db:D1Database;workspaceId:string;userId:string;request:LegalChatRequest;
  settings:AiRuntimeSettings;memoryKeyring?:IdentityKeyring|null;monthlyLimit:number|null;configured:boolean;
  service?:CorpusResearchService;retrievalEnvironment:AiRuntimeSettings["environment"];
  readDocuments?:(query:string,conversationId:string|null,signal?:AbortSignal)=>Promise<readonly LegalDocumentContext[]>;
  signal?:AbortSignal;onStage?:(stage:LegalChatStage)=>void;
}):Promise<LegalChatDelivery> {
  input.signal?.throwIfAborted();
  const owner={db:input.db,workspaceId:input.workspaceId,userId:input.userId};
  const request=input.request;
  const readContext=()=>readConversationContext({...owner,conversationId:request.conversationId,
    requestedOperation:request.operation,sourceMessageId:request.sourceMessageId,question:request.question});
  const prior=await readAiRunStatus({...owner,idempotencyKey:request.idempotencyKey});
  // Fresh input is checked before creating durable reservation state. Existing
  // keys go through hash validation/replay without rereading mutable context.
  let selected=prior.kind==="missing"?await readContext():null;
  const model=openAiChatModel(request.reasoningMode);
  const safetyIdentifier=await sha256Json({userId:input.userId});
  const reservation=await reserveAiRun({...owner,idempotencyKey:request.idempotencyKey,
    requestHash:await sha256Json(request),conversationId:request.conversationId,provider:"openai",model,
    answerMode:request.answerMode,reasoningMode:request.reasoningMode,legalDatabaseAsOf:"unavailable",
    instructionHash:await sha256Json({policy:"qualified-legal-answer",model,configHash:input.settings.configHash}),
    sourceVersionHash:await sha256Json({status:"research_pending"}),monthlyLimit:input.monthlyLimit});
  if(reservation.kind==="completed") {
    const saved=await readSavedLegalAnswer({...owner,conversationId:reservation.conversationId,responseMessageId:reservation.responseMessageId});
    if(!saved)throw new LegalChatDeliveryError("AI_RUN_FAILED",409,reservation.runId);
    return {runId:reservation.runId,conversationId:saved.conversationId,messageId:saved.messageId,
      requestMessageId:saved.requestMessageId??undefined,branchId:saved.branchId??undefined,result:saved.result};
  }
  if(reservation.kind!=="reserved") {
    throw new LegalChatDeliveryError(reservation.kind==="processing"?"AI_RUN_PROCESSING":reservation.kind==="expired"?"AI_RUN_EXPIRED":"AI_RUN_FAILED",
      409,reservation.runId);
  }
  const run={...owner,runId:reservation.runId,ledgerId:reservation.ledgerId,idempotencyKey:request.idempotencyKey};
  if(!input.configured||!input.service){
    await failAiRun({...run,errorCode:"LEGAL_CHAT_UNAVAILABLE"});
    throw new LegalChatDeliveryError("LEGAL_CHAT_UNAVAILABLE",503,reservation.runId);
  }
  selected??=await readContext()
    .catch(async error=>{await failAiRun({...run,errorCode:"LEGAL_CONTEXT_UNAVAILABLE"});throw error;});
  const voiceRecording=request.voiceRecordingId?await (async()=>{
    if(!input.memoryKeyring)throw new Error("VOICE_ENCRYPTION_UNAVAILABLE");
    return assertVoiceTranscriptMatches({...owner,keyring:input.memoryKeyring,recordingId:request.voiceRecordingId!,question:selected.branch.question});
  })().catch(async error=>{await failAiRun({...run,errorCode:"VOICE_TRANSCRIPT_INVALID"});throw error;}):undefined;
  const userContext=await readLegalUserContext({...owner,conversationId:request.conversationId,keyring:input.memoryKeyring??null})
    .catch(async error=>{await failAiRun({...run,errorCode:"LEGAL_CONTEXT_UNAVAILABLE"});throw error;});
  const documents=await (input.readDocuments?.(selected.branch.question,request.conversationId,input.signal)??Promise.resolve([]))
    .catch(async error=>{await failAiRun({...run,errorCode:"PRIVATE_DOCUMENT_CONTEXT_UNAVAILABLE"});throw error;});
  const started=Date.now();
  const accounting=createLegalChatAccounting({...owner,environment:input.settings.environment,feature:"legal_chat"});
  return executeRuntimeLegalChat({service:input.service,environment:input.retrievalEnvironment,requestId:reservation.runId,
    safetyIdentifier,responseTone:input.settings.responseTone,systemInstructions:input.settings.systemInstructions,
    context:{question:selected.branch.question,locale:request.locale,userContext,documents,
      priorTurns:selected.turns.map(turn=>({question:turn.question,answer:turn.answer})),
      legalContextDate:request.legalContextDate,signal:input.signal},mode:request.reasoningMode,answerMode:request.answerMode,
    onStage:input.onStage,onAttempt:accounting.onAttempt,onAttemptFinished:accounting.onAttemptFinished,
    renew:()=>renewAiRunReservation(run),
    release:reason=>failAiRun({...run,errorCode:reason==="cancelled"?"AI_CANCELLED":reason==="lease_lost"?"AI_RUN_LEASE_LOST":"AI_RUN_FAILED"}),
    commit:(terminal,sources)=>saveSignedInLegalAnswer({...run,conversationId:request.conversationId,branch:selected.branch,sources,voiceRecording,memoryKeyring:input.memoryKeyring,
      proposedFacts:"caseFacts" in terminal?terminal.caseFacts:[],
      result:legalChatTerminalResponse(terminal,{locale:request.locale,mode:request.reasoningMode,answerMode:request.answerMode}),
      provider:"openai",providerResponseId:null,fallbackFromProvider:null,model,...accounting.totals(),latencyMs:Date.now()-started}),
  });
}
