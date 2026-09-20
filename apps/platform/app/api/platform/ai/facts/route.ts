import {assertSafeWrite,withApiErrors} from "../../../../../lib/document-builder/auth/api";
import {parseJsonRequest} from "../../../../../lib/auth/input";
import {legalChatOwner} from "../../../../../lib/legal-chat/http-owner";
import {legalFactUpdateSchema,updateLegalFact,LegalFactUnavailable} from "../../../../../lib/legal-chat/facts";
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",pragma:"no-cache"}});
export const POST=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const parsed=await parseJsonRequest(request,legalFactUpdateSchema,2048);
  if(!parsed.ok)return response({code:"INVALID_REQUEST"},400);
  try {return response(await updateLegalFact({...scope,...parsed.data}));}
  catch(error){if(error instanceof LegalFactUnavailable)return response({code:error.message},404);throw error;}
});
