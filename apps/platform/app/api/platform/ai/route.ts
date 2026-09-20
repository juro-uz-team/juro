import {LegalContextCapacityError} from "../../../../lib/legal-chat/context-capacity";
import {runtimeIdentityProtection} from "../../../../lib/auth/identity-runtime";
import {legalChatOwner} from "../../../../lib/legal-chat/http-owner";
import {z} from "zod";
import {withApiErrors,assertSafeWrite} from "../../../../lib/document-builder/auth/api";
import {runtimeEnv} from "../../../../lib/document-builder/storage/runtime";
import {parseJsonRequest} from "../../../../lib/auth/input";
import {hasAiConfiguration} from "../../../../lib/document-builder/ai/openai";
import {workspaceEntitlements,resolveAiAnswerCycleLimit} from "../../../../lib/billing/entitlements";
import {resolveAiRuntimeSettings} from "../../../../lib/ai/runtime-settings";
import {openAiChatModel} from "../../../../lib/ai/provider-models";
import {AiRunConflictError,readAiRunStatus} from "../../../../lib/ai/run-store";
import {AiBranchInputError,listAiBranches,deleteAiConversation} from "../../../../lib/ai/branch-store";
import {legalChatRequestSchema} from "../../../../lib/legal-chat/request-schema";
import {deliverSignedInLegalChat} from "../../../../lib/legal-chat/signed-in-delivery";
import {readSavedLegalAnswer,publicConversationTurn} from "../../../../lib/legal-chat/saved-answer";
import {readSavedConversationTurns} from "../../../../lib/legal-chat/conversation-context";
import {legalChatStream,LegalChatDeliveryError} from "../../../../lib/legal-chat/delivery-stream";
import {legalRetrievalEnvironment} from "../../../../lib/legal-corpus/environment";

const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",pragma:"no-cache"}});


export const GET=withApiErrors(async(request:Request)=>{
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const query=new URL(request.url).searchParams;
  const idempotencyKey=query.get("idempotencyKey");
  if(idempotencyKey){
    if(!/^[A-Za-z0-9._:-]{8,128}$/.test(idempotencyKey))return response({code:"INVALID_REQUEST"},400);
    const status=await readAiRunStatus({...scope,idempotencyKey});
    if(status.kind!=="completed")return response({status});
    const saved=await readSavedLegalAnswer({...scope,conversationId:status.conversationId,responseMessageId:status.responseMessageId});
    return saved?response({status,answer:saved}):response({code:"AI_RUN_REPLAY_UNAVAILABLE"},404);
  }
  const conversationId=query.get("conversationId");
  if(conversationId){
    const selected=z.object({conversationId:z.string().uuid(),branchId:z.string().uuid().nullable(),responseMessageId:z.string().uuid().nullable()})
      .safeParse({conversationId,branchId:query.get("branchId"),responseMessageId:query.get("messageId")});
    if(!selected.success)return response({code:"INVALID_REQUEST"},400);
    const saved=await readSavedLegalAnswer({...scope,...selected.data});
    if(!saved)return response({code:"CONVERSATION_UNAVAILABLE"},404);
    const [branches,facts,storedTurns]=await Promise.all([
      listAiBranches({...scope,conversationId}),
      scope.db.prepare(`SELECT f.id,f.statement,f.status FROM confirmed_facts f JOIN conversations c ON c.id=f.conversation_id
        WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? ORDER BY f.created_at,f.id`)
        .bind(conversationId,scope.workspaceId,scope.userId).all(),
      readSavedConversationTurns({...scope,conversationId,responseMessageId:saved.messageId}),
    ]);
    return response({...saved,branches,facts:facts.results,
      turns:storedTurns.map(publicConversationTurn)});
  }
  const now=new Date();
  const periodStart=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1)).toISOString();
  const periodEnd=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()+1,1)).toISOString();
  const before=query.get("before"),beforeId=query.get("beforeId");
  if((before||beforeId)&&(!z.iso.datetime().safeParse(before).success||!z.string().uuid().safeParse(beforeId).success)) {
    return response({code:"INVALID_REQUEST"},400);
  }
  const [entitlements,usage,conversations,cases]=await Promise.all([
    workspaceEntitlements(scope.db,scope.workspaceId),
    scope.db.prepare(`SELECT COALESCE(SUM(units),0) AS used FROM ai_usage_ledger
      WHERE workspace_id=? AND user_id=? AND feature='legal_chat' AND period_start=? AND status IN ('reserved','consumed')`)
      .bind(scope.workspaceId,scope.userId,periodStart).first<{used:number}>(),
    scope.db.prepare(`SELECT c.id,c.title,c.locale,c.status,c.updated_at AS updatedAt,
      (SELECT m.content FROM conversation_messages m WHERE m.conversation_id=c.id AND m.author_type='assistant'
        ORDER BY m.created_at DESC,m.id DESC LIMIT 1) AS lastAnswer
      FROM conversations c WHERE c.workspace_id=? AND c.owner_user_id=?
        AND (? IS NULL OR c.updated_at<? OR (c.updated_at=? AND c.id<?))
      ORDER BY c.updated_at DESC,c.id DESC LIMIT 51`).bind(scope.workspaceId,scope.userId,before,before,before,beforeId)
      .all<{id:string;title:string;locale:string;status:string;updatedAt:string;lastAnswer:string|null}>(),
    scope.db.prepare("SELECT id,title,status,updated_at AS updatedAt FROM cases WHERE workspace_id=? AND archived_at IS NULL ORDER BY updated_at DESC,id DESC LIMIT 100")
      .bind(scope.workspaceId).all(),
  ]);
  const page=conversations.results.slice(0,50),last=page.at(-1);
  return response({provider:{configured:hasAiConfiguration()&&Boolean(runtimeEnv().LEGAL_RETRIEVAL_SERVICE),provider:"openai",model:openAiChatModel("fast"),fallbackConfigured:false},
    usage:{used:Number(usage?.used??0),limit:resolveAiAnswerCycleLimit(runtimeEnv().APP_ENV,entitlements.aiAnswerCyclesMonthly),periodEnd},
    conversations:page,cases:cases.results,next:conversations.results.length>50&&last?{before:last.updatedAt,beforeId:last.id}:null});
});

export const POST=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const parsed=await parseJsonRequest(request,legalChatRequestSchema,40_960);
  if(!parsed.ok)return response({code:parsed.error==="payload_too_large"?"AI_PAYLOAD_TOO_LARGE":"INVALID_REQUEST"},parsed.error==="payload_too_large"?413:400);
  const env=runtimeEnv();
  const [settings,entitlements]=await Promise.all([resolveAiRuntimeSettings({db:scope.db,env}),workspaceEntitlements(scope.db,scope.workspaceId)]);
  const work:Parameters<typeof legalChatStream>[0]["work"]=async(signal,onStage)=>{
    try {
      return await deliverSignedInLegalChat({...scope,request:parsed.data,settings,memoryKeyring:runtimeIdentityProtection().keyring,
        monthlyLimit:resolveAiAnswerCycleLimit(env.APP_ENV,entitlements.aiAnswerCyclesMonthly),configured:hasAiConfiguration(),
        service:env.LEGAL_RETRIEVAL_SERVICE,retrievalEnvironment:legalRetrievalEnvironment(env),signal,onStage});
    } catch(error){
      if(error instanceof AiRunConflictError)throw new LegalChatDeliveryError(error.code,error.code==="PLAN_LIMIT"?429:409);
      if(error instanceof LegalContextCapacityError)throw new LegalChatDeliveryError(error.code,422);
      if(error instanceof AiBranchInputError)throw new LegalChatDeliveryError(error.code,404);
      throw error;
    }
  };
  if(request.headers.get("accept")?.includes("text/event-stream"))return legalChatStream({signal:request.signal,work});
  try {return response(await work(request.signal,()=>{}));}
  catch(error){return error instanceof LegalChatDeliveryError?response({code:error.code,runId:error.runId},error.status)
    :response({code:request.signal.aborted?"AI_CANCELLED":"LEGAL_CHAT_UNAVAILABLE"},request.signal.aborted?499:503);}
});

export const DELETE=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const parsed=await parseJsonRequest(request,z.object({conversationId:z.string().uuid()}).strict(),2_048);
  if(!parsed.ok)return response({code:"INVALID_REQUEST"},400);
  const deleted=await deleteAiConversation({...scope,conversationId:parsed.data.conversationId});
  return deleted==="deleted"?response({deleted:true}):response({code:deleted==="busy"?"CONVERSATION_BUSY":"CONVERSATION_UNAVAILABLE"},deleted==="busy"?409:404);
});
