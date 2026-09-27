import { parseLegalChatResponse, type LegalChatResponse } from "../ai/legal-chat-schema";
import { selectAiConversationMessage, type AiConversationTurn } from "../ai/conversation-branch-reader";

export function decodeSavedLegalAnswer(structuredJson: string): LegalChatResponse {
  return parseLegalChatResponse(JSON.parse(structuredJson));
}

/** Public content is conversation context, never fresh official evidence.
 * Preserve ordered options and questions so a follow-up can refer to them;
 * omit citation receipts and internal research/verification metadata. */
export function legalAnswerConversationText(result: LegalChatResponse): string {
  return JSON.stringify({
    mainPoint: result.summary, answer: result.answer,
    ...(result.issues ? {issues:result.issues.map(issue=>{
      const {title,explanation}=result.confirmedFindings[issue.findingIndex]!;
      return {rule:{title,explanation},actions:issue.actionIndices.map(index=>{
        const {title,description}=result.actionPlan[index]!;return {title,description};
      })};
    })} : {
      findings: result.confirmedFindings.map(({title, explanation}) => ({title, explanation})),
      actions: result.actionPlan.map(({title, description}) => ({title, description})),
    }),
    risks: result.risks.map(({level, title, explanation}) => ({level, title, explanation})),
    questions: result.clarificationQuestions, unresolved: result.coverageGaps ?? [],
    conditionalBranches: result.conditionalBranches ?? [], assumptions: result.assumptions,
    requiredDocuments: result.requiredDocuments, deadlines: result.deadlines,
    referenceNotes: result.referenceNotes?.map(({title, note}) => ({title, note})) ?? [],
    suggestedDocument: result.suggestedDocument,
  });
}

export async function readSavedLegalAnswer(input: {
  db: D1Database;
  userId: string;
  workspaceId: string;
  conversationId: string;
  branchId?: string | null;
  responseMessageId?: string | null;
}) {
  const saved = await selectAiConversationMessage(input);
  if (!saved?.structuredJson) return null;
  return {
    conversationId: saved.conversationId,
    messageId: saved.messageId,
    requestMessageId: saved.requestMessageId,
    branchId: saved.branchId,
    operation: saved.operation,
    question: saved.question ?? "",
    result: decodeSavedLegalAnswer(saved.structuredJson),
  };
}


/** History exposes only display content; stored metadata is not a public API. */
export function publicConversationTurn(turn:AiConversationTurn){
  let result:LegalChatResponse|null=null;
  if(turn.structuredJson){try{result=decodeSavedLegalAnswer(turn.structuredJson);}catch{/* Older unstructured answers retain their stored display text. */}}
  return {branchId:turn.branchId,requestMessageId:turn.requestMessageId,responseMessageId:turn.responseMessageId,
    question:turn.question,answer:turn.answer,createdAt:turn.createdAt,result};
}
