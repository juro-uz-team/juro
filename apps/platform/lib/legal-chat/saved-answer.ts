import { parseLegalChatResponse, type LegalChatResponse } from "../ai/legal-chat-schema";
import { selectAiConversationMessage } from "../ai/conversation-branch-reader";

export function decodeSavedLegalAnswer(structuredJson: string): LegalChatResponse {
  return parseLegalChatResponse(JSON.parse(structuredJson));
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
