import {assertSafeWrite,requireApiUser,withApiErrors} from "../../../../../lib/document-builder/auth/api";
import {parseJsonRequest} from "../../../../../lib/auth/input";
import {requireD1} from "../../../../../lib/document-builder/storage/runtime";
import {workspaceForUser,workspaceForUserById} from "../../../../../lib/platform/workspace";
import {isWorkspaceId} from "../../../../../lib/platform/routing";
import {AI_SUGGESTED_DOCUMENT_MAX_BODY_BYTES,AiSuggestedDocumentError,aiSuggestedDocumentRequestSchema,aiSuggestedDocumentIdempotencyKeySchema,
  previewAiSuggestedDocument,createAiSuggestedDocumentDraft} from "../../../../../lib/ai/suggested-document";
import {aiText} from "../../../../../lib/ai/localization";

const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",pragma:"no-cache"}});
export const POST=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);
  const user=await requireApiUser(request);
  const selected=request.headers.get("x-juro-workspace-id");
  const workspace=selected?(isWorkspaceId(selected)?await workspaceForUserById(user.id,selected):null):await workspaceForUser(user);
  if(!workspace)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const parsed=await parseJsonRequest(request,aiSuggestedDocumentRequestSchema,AI_SUGGESTED_DOCUMENT_MAX_BODY_BYTES);
  if(!parsed.ok)return response({code:"INVALID_REQUEST"},400);
  const input={db:requireD1(),workspaceId:workspace.id,workspaceRole:workspace.role,user,...parsed.data};
  try{
    if(parsed.data.action==="preview")return response(await previewAiSuggestedDocument(input));
    const key=aiSuggestedDocumentIdempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
    if(!key.success)return response({code:"INVALID_IDEMPOTENCY_KEY"},400);
    return response(await createAiSuggestedDocumentDraft({...input,...parsed.data,idempotencyKey:key.data}));
  }catch(error){
    if(!(error instanceof AiSuggestedDocumentError))throw error;
    const sensitive=error.code==="AI_SUGGESTED_DOCUMENT_SENSITIVE_CONSENT_REQUIRED";
    const message=sensitive?aiText(parsed.data.locale,"Подтвердите сохранение выбранных конфиденциальных данных.",
      "Tanlangan maxfiy ma’lumotlarni saqlashni tasdiqlang.","Confirm saving the selected sensitive details."):
      error.code==="AI_SUGGESTED_DOCUMENT_CONFLICT"?aiText(parsed.data.locale,"Это подтверждение уже использовано с другими данными.",
        "Bu tasdiq boshqa ma’lumotlar bilan ishlatilgan.","This confirmation was already used with different details."):
        aiText(parsed.data.locale,"Предложенный документ недоступен. Откройте сохранённый ответ и повторите попытку.",
          "Taklif qilingan hujjat mavjud emas. Saqlangan javobni ochib, qayta urinib ko‘ring.","The suggested document is unavailable. Reopen the saved answer and try again.");
    return response({code:error.code,error:message},error.code==="AI_SUGGESTED_DOCUMENT_NOT_FOUND"?404:
      sensitive||error.code==="AI_SUGGESTED_DOCUMENT_INVALID"?400:409);
  }
});
