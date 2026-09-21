import {legalChatResponseSchema,deriveLegalEvidenceMode,type LegalChatResponse} from "../ai/legal-chat-schema";
import {aiText} from "../ai/localization";
import {parsePrivateDocumentLocator} from "../document-analysis/private-document-locator";
import {LegalContextCapacityError} from "./context-capacity";
import type {LegalDocumentContext} from "./document-context";

/** Publication uses exact excerpts, not model-authored assertions about a private
 * document. The official answer and its limitations remain independently intact. */
export function appendPrivateDocumentExcerpts(result:LegalChatResponse,documents:readonly LegalDocumentContext[]):LegalChatResponse {
  if(!documents.length)return result;
  const sources=[...result.sources],notes=[...(result.referenceNotes??[])];
  const ids=new Set(sources.map(source=>source.sourceId));
  for(const document of documents) {
    const {source,text}=document;
    if(document.kind!=="private_document"||source.sourceType!=="internal"||source.verificationState!=="user_supplied"
      ||!["USER_TRUSTED_PRIVATE","TENANT_TRUSTED_PRIVATE"].includes(source.sourceClass??"")
      ||parsePrivateDocumentLocator(source.officialUrl)!==source.id||ids.has(source.id)||!text.trim()) {
      throw new Error("PRIVATE_DOCUMENT_IDENTITY_INVALID");
    }
    ids.add(source.id);
    const parts:string[]=[];
    for(let start=0;start<text.length;) {
      let end=Math.min(start+2600,text.length);
      if(end<text.length&&/[\uD800-\uDBFF]/u.test(text[end-1]!))end--;
      parts.push(text.slice(start,end));start=end;
    }
    const title=aiText(result.language,"Фрагмент документа","Hujjatdan parcha","Document excerpt");
    const label=aiText(result.language,"Содержимое документа, не правовой вывод",
      "Hujjat mazmuni, huquqiy xulosa emas","Document content, not a legal conclusion");
    parts.forEach((part,index)=>notes.push({title:`${title}${parts.length>1?` (${index+1}/${parts.length})`:""}: ${source.actTitle}`.slice(0,240),
      note:`${label}: «${part}»`,sourceIds:[source.id]}));
    sources.push({sourceId:source.id,actTitle:source.actTitle,actIdentifier:null,article:null,excerpt:null,
      originalUrl:source.officialUrl,status:"unconfirmed",effectiveDate:null,verifiedAt:source.verifiedAt,
      documentType:"uploaded_document",sourceClass:source.sourceClass});
  }
  const projected=legalChatResponseSchema.safeParse({...result,responseKind:"answer",sources,referenceNotes:notes,
    evidenceMode:deriveLegalEvidenceMode({sources})});
  if(!projected.success)throw new LegalContextCapacityError();
  return projected.data;
}
