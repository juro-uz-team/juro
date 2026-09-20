import {z} from "zod";
import {reserveGuestAiRun,renewGuestAiReservation,failGuestAiRun,revealGuestAiRunResult,revealGuestAiRunQuestion,
  guestAiClarificationRuns,GuestAiError,type GuestAiSession} from "../ai/guest-session";
import {sha256Json} from "../ai/run-store";
import {openAiChatModel} from "../ai/provider-models";
import type {AiRuntimeSettings} from "../ai/runtime-settings";
import type {IdentityKeyring} from "../auth/keyring";
import {decodeSavedLegalAnswer} from "./saved-answer";
import {executeRuntimeLegalChat} from "./runtime-execution";
import {createLegalChatAccounting} from "./provider-accounting";
import {saveGuestLegalAnswer} from "./answer-persistence";
import {legalChatTerminalResponse} from "./terminal-response";
import type {CorpusResearchService} from "./remote-corpus-research";
import {legalChatRequestSchema} from "./request-schema";
import type {LegalChatStage} from "./execution";
import type {LegalChatDelivery} from "./delivery-stream";

const shared=legalChatRequestSchema.shape;
export const guestLegalChatRequestSchema=z.object({locale:shared.locale,answerMode:shared.answerMode,reasoningMode:shared.reasoningMode,
  legalContextDate:shared.legalContextDate,idempotencyKey:shared.idempotencyKey,question:z.string().trim().min(1).max(4000)}).strict();

/** Session resolution and anti-abuse checks precede this boundary. Both guests
 * and signed-in users execute the same research, writer and verifier. */
export async function deliverGuestLegalChat(input:{
  db:D1Database;keyring:IdentityKeyring;session:GuestAiSession;request:z.infer<typeof guestLegalChatRequestSchema>;
  settings:AiRuntimeSettings;configured:boolean;service?:CorpusResearchService;retrievalEnvironment:AiRuntimeSettings["environment"];
  signal?:AbortSignal;onStage?:(stage:LegalChatStage)=>void;
}):Promise<LegalChatDelivery> {
  input.signal?.throwIfAborted();
  const request=input.request;
  const model=openAiChatModel(request.reasoningMode);
  const safetyIdentifier=await sha256Json({guestSessionId:input.session.id});
  const previous=await guestAiClarificationRuns(input.db,input.session);
  const priorTurns=await Promise.all(previous.map(async run=>({
    question:await revealGuestAiRunQuestion({keyring:input.keyring,run}),
    answer:decodeSavedLegalAnswer(await revealGuestAiRunResult({keyring:input.keyring,run})).answer,
  })));
  const reservation=await reserveGuestAiRun({...input,idempotencyKey:request.idempotencyKey,
    requestHash:await sha256Json(request),question:request.question,provider:"openai",model,legalDatabaseAsOf:"unavailable",
    instructionHash:await sha256Json({policy:"qualified-legal-answer",model,configHash:input.settings.configHash}),
    sourceVersionHash:await sha256Json({status:"research_pending"})});
  if(reservation.kind==="completed")return {runId:reservation.run.id,
    result:decodeSavedLegalAnswer(await revealGuestAiRunResult({keyring:input.keyring,run:reservation.run}))};
  if(reservation.kind!=="created")throw new GuestAiError(reservation.kind==="processing"?"GUEST_RUN_PROCESSING":"GUEST_RUN_FAILED");
  const run=reservation.run;
  if(!input.configured||!input.service){
    await failGuestAiRun({db:input.db,run,errorCode:"GUEST_CONFIGURATION_UNAVAILABLE"});
    throw new GuestAiError("GUEST_CONFIGURATION_UNAVAILABLE");
  }
  const started=Date.now();
  const accounting=createLegalChatAccounting({db:input.db,workspaceId:null,userId:null,environment:input.settings.environment,feature:"guest_legal_chat"});
  return executeRuntimeLegalChat({service:input.service,environment:input.retrievalEnvironment,requestId:run.id,safetyIdentifier,
    responseTone:input.settings.responseTone,context:{question:request.question,locale:request.locale,priorTurns,
      legalContextDate:request.legalContextDate,signal:input.signal},mode:request.reasoningMode,answerMode:request.answerMode,
    onStage:input.onStage,onAttempt:accounting.onAttempt,onAttemptFinished:accounting.onAttemptFinished,
    renew:()=>renewGuestAiReservation({db:input.db,session:input.session,runId:run.id}),
    release:reason=>failGuestAiRun({db:input.db,run,errorCode:reason==="cancelled"?"AI_CANCELLED":reason==="lease_lost"?"GUEST_RESERVATION_LOST":"GUEST_RUN_FAILED"}),
    commit:(terminal,sources)=>saveGuestLegalAnswer({db:input.db,keyring:input.keyring,run,sources,
      result:legalChatTerminalResponse(terminal,{locale:request.locale,mode:request.reasoningMode,answerMode:request.answerMode}),
      provider:"openai",providerResponseId:null,fallbackFromProvider:null,model,...accounting.totals(),latencyMs:Date.now()-started}),
  });
}
