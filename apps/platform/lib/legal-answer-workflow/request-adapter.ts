import { z } from "zod";
import type { BranchSelection } from "./branches";
import { withinSignal } from "./lifetime";
import { ensureSavedConversationBranches } from "./legacy-history";

const identifier = z.string().trim().min(1).max(240);
const payloadSchema = z.object({
  question: z.string().trim().max(12_000).optional(),
  locale: z.enum(["en", "ru", "uz"]), answerMode: z.enum(["short", "detailed"]).default("detailed"),
  reasoningMode: z.enum(["fast", "deep"]).default("fast"),
  idempotencyKey: identifier, conversationId: identifier.nullish(), sourceMessageId: identifier.nullish(),
  operation: z.enum(["new", "follow_up", "edit", "regenerate"]).default("new"),
  legalContextDate: z.iso.date().optional(), voiceRecordingId: identifier.optional(),
  documentIds: z.array(identifier).max(12).default([]),
}).strict();

/** Translate the retained UI wire contract using authenticated actor context, never payload ownership fields. */
export async function prepareSignedAnswerRequest(input: {
  payload: unknown; db: D1Database; workspaceId: string; userId: string; signal: AbortSignal;
}) {
  input.signal.throwIfAborted();
  const payload = payloadSchema.parse(input.payload);
  if (new Set(payload.documentIds).size !== payload.documentIds.length) throw new Error("DOCUMENT_SELECTION_DUPLICATE");
  let question = payload.question ?? "";
  let branch: BranchSelection | undefined;
  if (payload.operation === "new") {
    if (payload.conversationId || payload.sourceMessageId) throw new Error("BRANCH_SELECTION_INVALID");
  } else {
    if (!payload.conversationId || !payload.sourceMessageId) throw new Error("BRANCH_SELECTION_INVALID");
    const readSelection = () => withinSignal(input.signal, () => input.db.prepare(`SELECT
      b.response_message_id AS responseMessageId,q.content AS question
      FROM message_branches b
      JOIN conversations c ON c.id=b.conversation_id AND c.workspace_id=b.workspace_id AND c.owner_user_id=b.owner_user_id
      JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=c.owner_user_id AND member.status='active'
      JOIN conversation_messages q ON q.id=b.request_message_id AND q.conversation_id=c.id AND q.author_type='user'
      JOIN conversation_messages a ON a.id=b.response_message_id AND a.conversation_id=c.id AND a.author_type='assistant'
      WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.status='active'
        AND ((?='edit' AND b.request_message_id=?) OR (?<>'edit' AND b.response_message_id=?)) LIMIT 2`)
      .bind(payload.conversationId, input.workspaceId, input.userId, payload.operation, payload.sourceMessageId,
        payload.operation, payload.sourceMessageId).all<{responseMessageId: string; question: string}>());
    let selected = await readSelection();
    if (!selected.results.length) {
      await withinSignal(input.signal, () => ensureSavedConversationBranches({ ...input,
        conversationId: payload.conversationId!, selectedMessageId: payload.sourceMessageId! }));
      selected = await readSelection();
    }
    if (selected.results.length !== 1) throw new Error("BRANCH_SELECTION_INVALID");
    const turn = selected.results[0];
    branch = { operation: payload.operation, responseMessageId: turn.responseMessageId };
    if (payload.operation === "regenerate") {
      if (question && question !== turn.question) throw new Error("REGENERATION_QUESTION_CHANGED");
      question = turn.question;
    }
  }
  if (!question.trim()) throw new Error("QUESTION_REQUIRED");
  return { question, language: payload.locale, format: payload.answerMode, mode: payload.reasoningMode,
    conversationId: payload.conversationId ?? null, idempotencyKey: payload.idempotencyKey,
    documentIds: payload.documentIds, ...(branch ? { branch } : {}),
    ...(payload.legalContextDate ? { legalContextDate: payload.legalContextDate } : {}),
    ...(payload.voiceRecordingId ? { voiceRecordingId: payload.voiceRecordingId } : {}),
  };
}
