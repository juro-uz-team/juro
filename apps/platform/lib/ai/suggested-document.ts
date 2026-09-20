import { z } from "zod";
import { getDocumentByCode } from "../document-builder/registry";
import type { DocumentDefinition, QuestionnaireField } from "../document-builder/registry";
import { createQuestionnaireAnswers, localize, setAnswer } from "../document-builder/registry/engine";
import { createConfiguredDocument } from "../document-builder/storage/configured-documents";
import type { UserProfile } from "../document-builder/types";
import { requireWorkspaceContentEditor } from "../platform/permissions";
import { parseLegalChatResponse } from "./legal-chat-schema";
import type { AiOutputLocale } from "./localization";

export const resolveAiSuggestedDocumentInputSchema = z.object({
  assistantMessageId: z.string().uuid(),
  locale: z.enum(["ru", "uz", "en"]).default("uz"),
}).strict();

export const aiSuggestedDocumentSelectionSchema = z.array(z.object({
  fieldId: z.string().min(1).max(150),
  value: z.string().max(50_000),
}).strict()).max(50).superRefine((items, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.fieldId)) context.addIssue({ code: "custom", path: [index, "fieldId"], message: "Duplicate field" });
    seen.add(item.fieldId);
  });
});

export const aiSuggestedDocumentRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preview"),
    assistantMessageId: z.string().uuid(),
    locale: z.enum(["ru", "uz", "en"]),
  }).strict(),
  z.object({
    action: z.literal("confirm"),
    assistantMessageId: z.string().uuid(),
    locale: z.enum(["ru", "uz", "en"]),
    fields: aiSuggestedDocumentSelectionSchema,
    sensitiveDataConsent: z.boolean().default(false),
  }).strict(),
]);

export const aiSuggestedDocumentIdempotencyKeySchema = z.string().min(8).max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u);

export class AiSuggestedDocumentError extends Error {
  constructor(
    readonly code: "AI_SUGGESTED_DOCUMENT_NOT_FOUND" | "AI_SUGGESTED_DOCUMENT_INVALID" | "AI_SUGGESTED_DOCUMENT_UNAVAILABLE" | "AI_SUGGESTED_DOCUMENT_CONFLICT" | "AI_SUGGESTED_DOCUMENT_SENSITIVE_CONSENT_REQUIRED",
  ) {
    super(code);
    this.name = "AiSuggestedDocumentError";
  }
}

type StoredSuggestedDocumentMessage = { structuredJson: string | null; caseId: string | null; workspaceRole:string };

export type AiDocumentPrefillCandidate = {
  fieldId: string;
  label: string;
  value: string;
  source: "profile" | "workspace" | "ai_answer";
  sensitive: boolean;
};

export type AiSuggestedDocumentPreview = {
  templateCode: string;
  categorySlug: string;
  title: string;
  reason: string;
  caseId: string | null;
  candidates: AiDocumentPrefillCandidate[];
};

type SuggestedContext = {
  definition: DocumentDefinition;
  reason: string;
  caseId: string | null;
};

const selfPartyPrefixes = new Set([
  "applicant", "claimant", "employee", "creditor", "consumer", "requester", "principal", "author",
]);

type ExistingHandoff = {
  documentId: string;
  assistantMessageId: string;
  templateCode: string;
  selectionSha256: string;
};

type SuggestedScope={db:D1Database;workspaceId:string;userId:string;assistantMessageId:string;locale:AiOutputLocale};

async function storedSuggestion(input:SuggestedScope):Promise<StoredSuggestedDocumentMessage>{
  const row=await input.db.prepare(`SELECT message.structured_json AS structuredJson,conversation.case_id AS caseId,member.role AS workspaceRole
    FROM conversation_messages message JOIN conversations conversation ON conversation.id=message.conversation_id
    JOIN workspace_members member ON member.workspace_id=conversation.workspace_id AND member.user_id=conversation.owner_user_id
    WHERE message.id=? AND message.author_type='assistant' AND conversation.workspace_id=? AND conversation.owner_user_id=?
      AND member.status='active'`).bind(input.assistantMessageId,input.workspaceId,input.userId).first<StoredSuggestedDocumentMessage>();
  if(!row)throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_NOT_FOUND");
  return row;
}

function suggestionContext(row:StoredSuggestedDocumentMessage):SuggestedContext{
  let result:ReturnType<typeof parseLegalChatResponse>;
  try{result=parseLegalChatResponse(JSON.parse(row.structuredJson??"null"));}
  catch{throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_INVALID");}
  const suggested=result.suggestedDocument;
  if(result.responseKind!=="answer"||!suggested?.templateCode)throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_UNAVAILABLE");
  const definition=getDocumentByCode(suggested.templateCode);
  if(!definition||definition.status!=="published")throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_UNAVAILABLE");
  return {definition,reason:suggested.reason,caseId:row.caseId};
}

function resolvedSuggestion(context:SuggestedContext,locale:AiOutputLocale){
  return {templateCode:context.definition.code,categorySlug:context.definition.categorySlug,
    title:locale==="uz"?context.definition.titleUz:context.definition.titleRu,reason:context.reason};
}

export async function resolveAiSuggestedDocument(input:SuggestedScope){
  return resolvedSuggestion(suggestionContext(await storedSuggestion(input)),input.locale);
}

function profileCandidate(field:QuestionnaireField,user:UserProfile,locale:AiOutputLocale):AiDocumentPrefillCandidate|null{
  const [party,property,...rest]=field.id.split(".");
  if(!selfPartyPrefixes.has(party)||rest.length)return null;
  const values:Record<string,string|null|undefined>={fullName:user.fullName,birthDate:user.birthDate,
    pinfl:user.pinfl,passport:user.idDocumentNumber,idDocumentNumber:user.idDocumentNumber,
    address:user.registeredAddress,registeredAddress:user.registeredAddress,phone:user.phone,email:user.email};
  const value=Object.hasOwn(values,property)?values[property]:null;
  if(typeof value!=="string"||!value)return null;
  return {fieldId:field.id,label:localize(field.label,locale==="uz"?"uz":"ru"),value,source:"profile",sensitive:property!=="fullName"};
}

function suggestedPreview(context:SuggestedContext,user:UserProfile,locale:AiOutputLocale):AiSuggestedDocumentPreview{
  const candidates=new Map<string,AiDocumentPrefillCandidate>();
  for(const step of context.definition.questionnaire)for(const field of step.fields){
    const candidate=profileCandidate(field,user,locale);if(candidate)candidates.set(field.id,candidate);
  }
  return {...resolvedSuggestion(context,locale),caseId:context.caseId,candidates:[...candidates.values()]};
}

export async function previewAiSuggestedDocument(input:Omit<SuggestedScope,"userId">&{user:UserProfile}):Promise<AiSuggestedDocumentPreview>{
  return suggestedPreview(suggestionContext(await storedSuggestion({...input,userId:input.user.id})),input.user,input.locale);
}

async function sha256(value:string):Promise<string>{
  const bytes=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
  return Array.from(bytes,byte=>byte.toString(16).padStart(2,"0")).join("");
}

/** Confirmation copies only fields offered by the server. Values remain in
 * the deletable draft; the handoff retains only scoped hashes and field IDs. */
export async function createAiSuggestedDocumentDraft(input:Omit<SuggestedScope,"userId">&{
  user:UserProfile;workspaceRole:string;fields:z.infer<typeof aiSuggestedDocumentSelectionSchema>;
  idempotencyKey:string;sensitiveDataConsent?:boolean;
}):Promise<{documentId:string;replayed:boolean}>{
  const fields=aiSuggestedDocumentSelectionSchema.safeParse(input.fields);
  if(!fields.success||!aiSuggestedDocumentIdempotencyKeySchema.safeParse(input.idempotencyKey).success)
    throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_INVALID");
  const scope={...input,userId:input.user.id};
  const row=await storedSuggestion(scope);
  const selected=[...fields.data].sort((left,right)=>left.fieldId.localeCompare(right.fieldId,"en"));
  const idempotencyKeySha256=await sha256(input.idempotencyKey);
  const selectionSha256=await sha256(JSON.stringify({assistantMessageId:input.assistantMessageId,locale:input.locale,
    fields:selected,sensitiveDataConsent:input.sensitiveDataConsent??false}));
  const replay=async()=>{
    const existing=await input.db.prepare(`SELECT document_id AS documentId,assistant_message_id AS assistantMessageId,
      template_code AS templateCode,selection_sha256 AS selectionSha256 FROM ai_document_prefill_handoffs
      WHERE workspace_id=? AND user_id=? AND idempotency_key_sha256=?`).bind(input.workspaceId,input.user.id,idempotencyKeySha256).first<ExistingHandoff>();
    if(!existing)return null;
    if(existing.assistantMessageId!==input.assistantMessageId||existing.selectionSha256!==selectionSha256)
      throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_CONFLICT");
    return {documentId:existing.documentId,replayed:true};
  };
  const existing=await replay();if(existing)return existing;
  const context=suggestionContext(row),preview=suggestedPreview(context,input.user,input.locale);
  if(preview.caseId){
    requireWorkspaceContentEditor(row.workspaceRole);
    const caseRow=await input.db.prepare("SELECT id FROM cases WHERE id=? AND workspace_id=? AND archived_at IS NULL")
      .bind(preview.caseId,input.workspaceId).first();
    if(!caseRow)throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_NOT_FOUND");
  }
  const offered=new Map(preview.candidates.map(candidate=>[candidate.fieldId,candidate]));
  if(selected.some(field=>!offered.has(field.fieldId)))throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_INVALID");
  if(!input.sensitiveDataConsent&&selected.some(field=>offered.get(field.fieldId)?.sensitive))
    throw new AiSuggestedDocumentError("AI_SUGGESTED_DOCUMENT_SENSITIVE_CONSENT_REQUIRED");
  let answers=createQuestionnaireAnswers(context.definition);
  for(const field of selected)answers=setAnswer(answers,field.fieldId,field.value);
  try{
    const document=await createConfiguredDocument(input.user,{definition:context.definition,language:input.locale==="uz"?"uz":"ru",answers,
      ...(preview.caseId?{caseId:preview.caseId}:{}),aiHandoff:{id:crypto.randomUUID(),assistantMessageId:input.assistantMessageId,
        idempotencyKeySha256,selectionSha256,selectedFieldIds:selected.map(field=>field.fieldId),locale:input.locale==="uz"?"uz":"ru"}},
      {db:input.db,workspace:{id:input.workspaceId}});
    return {documentId:document.id,replayed:false};
  }catch(error){const concurrent=await replay();if(concurrent)return concurrent;throw error;}
}
