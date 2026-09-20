import {legalChatResponseSchema,type LegalChatResponse} from "../ai/legal-chat-schema";
import {beginAiRunFinalization,completeAiRunStatements,sha256Json,type CompleteAiRunInput} from "../ai/run-store";
import type {AiBranchInput} from "../ai/branch-store";
import {legalCitationStatements} from "../legal/direct-citation-store";
import type {LegalSourceContext} from "../legal/source-context";
import {completeGuestAiRun} from "../ai/guest-session";

type Completion=Pick<CompleteAiRunInput,"db"|"runId"|"ledgerId"|"workspaceId"|"userId"|"idempotencyKey"
  |"providerResponseId"|"provider"|"fallbackFromProvider"|"model"|"inputTokens"|"outputTokens"
  |"cachedInputTokens"|"attempts"|"latencyMs">;

function prepareCitations(input:Parameters<typeof legalCitationStatements>[0]) {
  const published=new Set(input.citations.map(source=>source.sourceId));
  // Preserve the source language exactly; an unsupported identity is never relabeled.
  if(input.sources.some(source=>published.has(source.id)&&!["ru","uz","uzc","en"].includes(source.locale))) {
    throw new Error("LEGAL_CHAT_CITATION_LOCALE_UNSUPPORTED");
  }
  const statements=legalCitationStatements(input);
  const expected=new Set(input.citations.map(source=>JSON.stringify([source.sourceId,source.article]))).size;
  if(statements.length!==expected)throw new Error("LEGAL_CHAT_CITATION_PERSISTENCE_INCOMPLETE");
  return statements;
}

function citationVersionHash(result:LegalChatResponse,sources:readonly LegalSourceContext[]) {
  return sha256Json(result.sources.map(source=>{
    const context=sources.find(item=>item.id===source.sourceId)!;
    return {id:context.id,sha256:context.contentSha256,receipt:context.citationEvidenceReceipt??null};
  }));
}

/** Saves the public projection and receipt metadata in the same transaction as
 * usage settlement. Source bodies are used only for citation validation and
 * never serialized into messages, versions or diagnostics. */
export async function saveSignedInLegalAnswer(input:Completion&{
  conversationId:string|null;
  branch:AiBranchInput;
  result:LegalChatResponse;
  sources:readonly LegalSourceContext[];
}) {
  const result=legalChatResponseSchema.parse(input.result);
  if((input.conversationId===null)!==(input.branch.operation==="new"))throw new Error("INVALID_BRANCH_OPERATION");
  const conversationId=input.conversationId??crypto.randomUUID();
  const requestMessageId=crypto.randomUUID(),messageId=crypto.randomUUID(),branchId=crypto.randomUUID();
  const now=new Date().toISOString();
  const structuredJson=JSON.stringify(result);
  const citations=prepareCitations({db:input.db,sources:input.sources,citations:result.sources,
    aiRunId:input.runId,conversationId,messageId,now,sourceAccessMode:"mixed"});
  const sourceVersionHash=await citationVersionHash(result,input.sources);
  const contentSha256=[...new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(input.branch.question)))].map(byte=>byte.toString(16).padStart(2,"0")).join("");
  const statements:D1PreparedStatement[]=[];
  if(input.conversationId===null) {
    statements.push(input.db.prepare(`INSERT INTO conversations
      (id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at)
      VALUES (?,?,?,?,?,'active',?,?)`).bind(conversationId,input.workspaceId,input.userId,
        input.branch.question.slice(0,160),result.language,now,now));
  } else {
    statements.push(input.db.prepare(`SELECT CASE WHEN EXISTS(
      SELECT 1 FROM conversations WHERE id=? AND workspace_id=? AND owner_user_id=?
      ) THEN 1 ELSE json_extract('LEGAL_CHAT_CONVERSATION_NOT_OWNED','$') END AS owned`)
      .bind(conversationId,input.workspaceId,input.userId));
    statements.push(input.db.prepare(`UPDATE conversations SET updated_at=?
      WHERE id=? AND workspace_id=? AND owner_user_id=?`).bind(now,conversationId,input.workspaceId,input.userId));
  }
  statements.push(
    input.db.prepare(`INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at)
      VALUES (?,?,'user',?,?)`).bind(requestMessageId,conversationId,input.branch.question,now),
    input.db.prepare(`INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES (?,?,'assistant',?,?,?)`).bind(messageId,conversationId,result.answer,structuredJson,now),
    input.db.prepare(`INSERT INTO message_branches
      (id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(branchId,conversationId,input.workspaceId,input.userId,
        input.branch.parentBranchId,input.branch.forkedFromMessageId,requestMessageId,messageId,input.branch.operation,now),
    input.db.prepare(`INSERT INTO message_versions
      (id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),conversationId,branchId,requestMessageId,input.branch.sourceMessageId,
        input.userId,input.branch.operation,input.branch.versionNumber,contentSha256,now),
    ...citations,
    ...completeAiRunStatements({...input,conversationId,requestMessageId,responseMessageId:messageId,
      chargeable:result.responseKind==="answer"&&!result.failureReason,sourceVersionHash,legalDatabaseAsOf:result.legalDatabaseAsOf}),
  );
  if(!await beginAiRunFinalization(input))throw new Error("AI_RUN_FINALIZATION_CLAIM_FAILED");
  await input.db.batch(statements);
  return {runId:input.runId,conversationId,requestMessageId,messageId,branchId,result};
}

/** Guest results keep their existing encrypted, session-owned storage format.
 * The retained completion transaction fences reservation ownership and batches
 * citation receipts with encrypted result and allowance state. */
export async function saveGuestLegalAnswer(input:
  Omit<Parameters<typeof completeGuestAiRun>[0],"resultJson"|"responseKind"|"additionalStatements"|"sourceVersionHash"|"legalDatabaseAsOf">&{
    result:LegalChatResponse;sources:readonly LegalSourceContext[];
  }) {
  const result=legalChatResponseSchema.parse(input.result);
  const now=new Date(input.now??Date.now()).toISOString();
  const citations=prepareCitations({db:input.db,sources:input.sources,citations:result.sources,
    guestRunId:input.run.id,now,sourceAccessMode:"mixed"});
  await completeGuestAiRun({...input,resultJson:JSON.stringify(result),responseKind:result.responseKind,
    sourceVersionHash:await citationVersionHash(result,input.sources),legalDatabaseAsOf:result.legalDatabaseAsOf,
    additionalStatements:citations,now});
  return {runId:input.run.id,result};
}
