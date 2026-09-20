import {z} from "zod";
import {assertSafeWrite,withApiErrors} from "../../../../../lib/document-builder/auth/api";
import {parseJsonRequest} from "../../../../../lib/auth/input";
import {legalChatOwner} from "../../../../../lib/legal-chat/http-owner";
import {aiFeedbackInputSchema,listAiFeedback,saveAiFeedback,AiFeedbackError} from "../../../../../lib/ai/feedback";
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",pragma:"no-cache"}});
export const GET=withApiErrors(async(request:Request)=>{
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const id=z.string().uuid().safeParse(new URL(request.url).searchParams.get("assistantMessageId"));
  if(!id.success)return response({code:"INVALID_REQUEST"},400);
  try {return response({feedback:await listAiFeedback({...scope,assistantMessageId:id.data})});}
  catch(error){if(error instanceof AiFeedbackError)return response({code:error.code},404);throw error;}
});
export const POST=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const parsed=await parseJsonRequest(request,aiFeedbackInputSchema,12288);
  if(!parsed.ok)return response({code:"INVALID_REQUEST"},400);
  try {return response(await saveAiFeedback({...scope,...parsed.data,now:new Date().toISOString()}));}
  catch(error){if(error instanceof AiFeedbackError)return response({code:error.code},404);throw error;}
});
