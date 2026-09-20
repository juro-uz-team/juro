import {z} from "zod";
import {assertSafeWrite,withApiErrors} from "../../../../../lib/document-builder/auth/api";
import {runtimeEnv} from "../../../../../lib/document-builder/storage/runtime";
import {parseJsonRequest} from "../../../../../lib/auth/input";
import {legalChatOwner} from "../../../../../lib/legal-chat/http-owner";
import {listUserMemories,memorySettings,memoryKeyring,memoryCategorySchema,memoryStatementSchema,
  saveUserMemory,updateUserMemory,deleteUserMemory,clearUserMemories,setAutomaticMemory,UserMemoryError} from "../../../../../lib/ai/user-memory";
import {aiText,type AiOutputLocale} from "../../../../../lib/ai/localization";

const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{"cache-control":"private, no-store",pragma:"no-cache"}});
const localeSchema=z.enum(["ru","uz","en"]).default("ru");
const statementFields={category:memoryCategorySchema,statement:memoryStatementSchema,confirmSensitive:z.boolean().default(false)};
const mutationSchema=z.discriminatedUnion("action",[
  z.object({action:z.literal("create"),locale:localeSchema,...statementFields,scope:z.enum(["global","workspace"])}).strict(),
  z.object({action:z.literal("update"),locale:localeSchema,...statementFields,memoryId:z.string().uuid()}).strict(),
  z.object({action:z.literal("delete"),locale:localeSchema,memoryId:z.string().uuid()}).strict(),
  z.object({action:z.literal("clear"),locale:localeSchema,confirmation:z.literal("CLEAR")}).strict(),
  z.object({action:z.literal("settings"),locale:localeSchema,automaticEnabled:z.boolean()}).strict(),
]);

function memoryErrorText(code:UserMemoryError["code"],locale:AiOutputLocale):string {
  if(code==="MEMORY_ENCRYPTION_UNAVAILABLE")return aiText(locale,"Зашифрованная память временно недоступна.",
    "Shifrlangan xotira vaqtincha mavjud emas.","Encrypted memory is temporarily unavailable.");
  if(code==="MEMORY_CREDENTIAL_FORBIDDEN")return aiText(locale,"Пароли, коды и платёжные данные нельзя сохранять в памяти.",
    "Parollar, kodlar va to‘lov ma’lumotlarini xotirada saqlab bo‘lmaydi.","Passwords, verification codes and payment details cannot be saved in memory.");
  if(code==="MEMORY_SENSITIVE_CONFIRMATION_REQUIRED")return aiText(locale,"Подтвердите сохранение чувствительных обстоятельств.",
    "Maxfiy holatlarni saqlashga roziligingizni tasdiqlang.","Confirm that you want to save sensitive circumstances.");
  if(code==="MEMORY_NOT_FOUND"||code==="MEMORY_ACCESS_DENIED")return aiText(locale,"Запись памяти недоступна.",
    "Xotira yozuvi mavjud emas.","The memory entry is unavailable.");
  if(code==="MEMORY_DUPLICATE")return aiText(locale,"Такая запись уже сохранена.","Bunday yozuv allaqachon saqlangan.","This entry is already saved.");
  return aiText(locale,"Проверьте категорию и текст записи.","Yozuv toifasi va matnini tekshiring.","Check the entry category and text.");
}

function memoryFailure(error:unknown,locale:AiOutputLocale):Response {
  if(!(error instanceof UserMemoryError))throw error;
  const status=error.code==="MEMORY_NOT_FOUND"?404:error.code==="MEMORY_ACCESS_DENIED"?403:
    error.code==="MEMORY_ENCRYPTION_UNAVAILABLE"?503:error.code==="MEMORY_DUPLICATE"?409:400;
  return response({code:error.code,error:memoryErrorText(error.code,locale)},status);
}

export const GET=withApiErrors(async(request:Request)=>{
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const locale=localeSchema.safeParse(new URL(request.url).searchParams.get("locale")??undefined);
  if(!locale.success)return response({code:"INVALID_REQUEST"},400);
  const settings=await memorySettings(scope.db,scope.userId);
  try {
    const keyring=memoryKeyring(runtimeEnv().IDENTITY_KEYRING);
    return response({available:true,settings,memories:await listUserMemories({...scope,keyring})});
  } catch(error){
    if(error instanceof UserMemoryError&&error.code==="MEMORY_ENCRYPTION_UNAVAILABLE")return response({available:false,settings,memories:[],
      code:error.code,error:memoryErrorText(error.code,locale.data)});
    return memoryFailure(error,locale.data);
  }
});

export const POST=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);
  const scope=await legalChatOwner(request);if(!scope)return response({code:"WORKSPACE_UNAVAILABLE"},404);
  const parsed=await parseJsonRequest(request,mutationSchema,4096);
  if(!parsed.ok)return response({code:"INVALID_REQUEST"},400);
  const mutation=parsed.data;
  try {
    if(mutation.action==="settings"){
      if(mutation.automaticEnabled)memoryKeyring(runtimeEnv().IDENTITY_KEYRING);
      await setAutomaticMemory(scope.db,scope.userId,scope.workspaceId,mutation.automaticEnabled);return response({ok:true});
    }
    if(mutation.action==="clear")return response({deleted:await clearUserMemories(scope)});
    if(mutation.action==="delete"){
      await deleteUserMemory({...scope,memoryId:mutation.memoryId});return response({ok:true});
    }
    const keyring=memoryKeyring(runtimeEnv().IDENTITY_KEYRING);
    if(mutation.action==="update"){
      await updateUserMemory({...scope,...mutation,keyring});return response({ok:true});
    }
    return response(await saveUserMemory({...scope,...mutation,keyring,sourceKind:"manual",sourceType:"manual"}));
  } catch(error){return memoryFailure(error,mutation.locale);}
});
