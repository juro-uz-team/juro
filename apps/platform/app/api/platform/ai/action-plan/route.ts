import {assertSafeWrite,withApiErrors} from "../../../../../lib/document-builder/auth/api";
import {parseJsonRequest} from "../../../../../lib/auth/input";
import {legalChatOwner} from "../../../../../lib/legal-chat/http-owner";
import {AiActionPlanSaveError,saveAiActionPlanInputSchema,saveAiActionPlanToCase} from "../../../../../lib/ai/action-plan-save";
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",pragma:"no-cache"}});
export const POST=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const parsed=await parseJsonRequest(request,saveAiActionPlanInputSchema,2048);
  if(!parsed.ok)return response({code:"INVALID_REQUEST"},400);
  try{return response(await saveAiActionPlanToCase({...scope,...parsed.data}));}
  catch(error){if(error instanceof AiActionPlanSaveError)return response({code:error.code},error.code.endsWith("NOT_FOUND")?404:409);throw error;}
});
