import {z} from "zod";
import {assertSafeWrite,withApiErrors} from "../../../../lib/document-builder/auth/api";
import {requireD1,runtimeEnv} from "../../../../lib/document-builder/storage/runtime";
import {hasAiConfiguration} from "../../../../lib/document-builder/ai/openai";
import {runtimeIdentityProtection} from "../../../../lib/auth/identity-runtime";
import {parseJsonRequest} from "../../../../lib/auth/input";
import {validateTurnstile,guestAiTurnstileAction} from "../../../../lib/auth/turnstile";
import {guestAiEnabled,resolveGuestAiSession,createGuestAiSession,guestSessionCookie,clearGuestSessionCookie,
  latestGuestAiRun,revealGuestAiRunResult,GuestAiError,type GuestAiSession} from "../../../../lib/ai/guest-session";
import {resolveAiRuntimeSettings} from "../../../../lib/ai/runtime-settings";
import {deliverGuestLegalChat,guestLegalChatRequestSchema} from "../../../../lib/legal-chat/guest-delivery";
import {decodeSavedLegalAnswer} from "../../../../lib/legal-chat/saved-answer";
import {legalChatStream,LegalChatDeliveryError} from "../../../../lib/legal-chat/delivery-stream";
import {legalRetrievalEnvironment} from "../../../../lib/legal-corpus/environment";

const requestSchema=guestLegalChatRequestSchema.extend({turnstileToken:z.string().max(2048).optional()});
const response=(body:unknown,status=200,cookie?:string)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",pragma:"no-cache",...(cookie?{"set-cookie":cookie}:{})}});
const publicSession=(session:GuestAiSession)=>({state:session.state,requestCount:session.requestCount,answerCount:session.answerCount,expiresAt:session.expiresAt});
function statusFor(error:GuestAiError){
  return error.code==="GUEST_RATE_LIMIT"||error.code==="GUEST_REQUEST_LIMIT"?429:
    error.code==="GUEST_CONFIGURATION_UNAVAILABLE"?503:error.code==="GUEST_AI_DISABLED"?404:
    error.code==="GUEST_RUN_PROCESSING"||error.code==="GUEST_RUN_CONFLICT"||error.code==="GUEST_SESSION_CONSUMED"?409:400;
}

export const GET=withApiErrors(async(request:Request)=>{
  const env=runtimeEnv();
  if(!guestAiEnabled(env))return response({enabled:false,code:"GUEST_AI_DISABLED"},404);
  const keyring=runtimeIdentityProtection().keyring;
  if(!keyring)return response({code:"GUEST_CONFIGURATION_UNAVAILABLE"},503);
  const db=requireD1();
  const base={enabled:true,providerConfigured:hasAiConfiguration()&&Boolean(env.LEGAL_RETRIEVAL_SERVICE),siteKey:env.TURNSTILE_SITE_KEY??null};
  try {
    const session=await resolveGuestAiSession({db,keyring,request});
    const run=await latestGuestAiRun(db,session.id);
    const result=run?decodeSavedLegalAnswer(await revealGuestAiRunResult({keyring,run})):null;
    return response({...base,session:publicSession(session),result});
  } catch(error){
    if(error instanceof GuestAiError&&["GUEST_SESSION_REQUIRED","GUEST_SESSION_INVALID","GUEST_SESSION_EXPIRED"].includes(error.code)){
      return response({...base,session:null,result:null},200,error.code==="GUEST_SESSION_REQUIRED"?undefined:clearGuestSessionCookie(request.url));
    }
    return response({code:"GUEST_CONFIGURATION_UNAVAILABLE"},503);
  }
});

export const POST=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);
  const env=runtimeEnv();
  if(!guestAiEnabled(env))return response({code:"GUEST_AI_DISABLED"},404);
  const parsed=await parseJsonRequest(request,requestSchema,24_576);
  if(!parsed.ok)return response({code:parsed.error==="payload_too_large"?"GUEST_AI_PAYLOAD_TOO_LARGE":"INVALID_REQUEST"},parsed.error==="payload_too_large"?413:400);
  const keyring=runtimeIdentityProtection().keyring;
  if(!keyring)return response({code:"GUEST_CONFIGURATION_UNAVAILABLE"},503);
  const db=requireD1();
  let session:GuestAiSession;
  let cookie:string|undefined;
  try {
    try {session=await resolveGuestAiSession({db,keyring,request});}
    catch(error){
      if(!(error instanceof GuestAiError)||!["GUEST_SESSION_REQUIRED","GUEST_SESSION_INVALID","GUEST_SESSION_EXPIRED"].includes(error.code))throw error;
      if(!env.TURNSTILE_SECRET_KEY||!env.TURNSTILE_SITE_KEY)return response({code:"GUEST_CONFIGURATION_UNAVAILABLE"},503);
      const connectingIp=request.headers.get("cf-connecting-ip")?.trim()||null;
      const challenge=await validateTurnstile({secretKey:env.TURNSTILE_SECRET_KEY,token:parsed.data.turnstileToken??"",
        remoteIp:connectingIp,expectedHostname:new URL(request.url).hostname,expectedAction:guestAiTurnstileAction});
      if(challenge.status!=="verified")return response({code:challenge.status==="unavailable"?"TURNSTILE_UNAVAILABLE":"TURNSTILE_INVALID"},challenge.status==="unavailable"?503:400);
      const created=await createGuestAiSession({db,keyring,connectingIp,locale:parsed.data.locale});
      session=created.session;cookie=guestSessionCookie(session.id,created.token,request.url);
    }
    const settings=await resolveAiRuntimeSettings({db,env});
    const chatRequest=guestLegalChatRequestSchema.strip().parse(parsed.data);
    const work:Parameters<typeof legalChatStream>[0]["work"]=async(signal,onStage)=>{
      try {return await deliverGuestLegalChat({db,keyring,session,request:chatRequest,settings,
        configured:hasAiConfiguration(),service:env.LEGAL_RETRIEVAL_SERVICE,retrievalEnvironment:legalRetrievalEnvironment(env),signal,onStage});}
      catch(error){if(error instanceof GuestAiError)throw new LegalChatDeliveryError(error.code,statusFor(error));throw error;}
    };
    if(request.headers.get("accept")?.includes("text/event-stream")){
      const stream=legalChatStream({signal:request.signal,work});if(cookie)stream.headers.set("set-cookie",cookie);return stream;
    }
    return response(await work(request.signal,()=>{}),200,cookie);
  } catch(error){
    if(error instanceof GuestAiError)return response({code:error.code},statusFor(error),cookie);
    if(error instanceof LegalChatDeliveryError)return response({code:error.code},error.status,cookie);
    return response({code:request.signal.aborted?"AI_CANCELLED":"LEGAL_CHAT_UNAVAILABLE"},request.signal.aborted?499:503,cookie);
  }
});
