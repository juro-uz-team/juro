import { z } from "zod";

export const aiFeedbackTypeSchema = z.enum([
  "helpful",
  "not_helpful",
  "wrong_norm",
  "broken_link",
  "outdated",
  "incomplete",
  "language",
  "unsafe",
  "ignored_facts",
]);

export const aiFeedbackInputSchema = z.object({
  assistantMessageId: z.string().uuid(),
  feedbackType: aiFeedbackTypeSchema,
  comment: z.string().trim().max(2_000).optional().transform((value) => value || null),
}).strict();

type FeedbackInput = z.infer<typeof aiFeedbackInputSchema>;

type D1 = D1Database;

type OwnedAiResponse = {
  aiRunId: string;
  conversationId: string;
};

export class AiFeedbackError extends Error {
  constructor(readonly code: "AI_FEEDBACK_NOT_FOUND") {
    super(code);
  }
}

async function ownedAiResponse(db: D1, workspaceId: string, userId: string, assistantMessageId: string): Promise<OwnedAiResponse> {
  const row = await db.prepare(`
    SELECT run.id AS aiRunId, conversation.id AS conversationId
    FROM ai_runs run
    JOIN conversations conversation ON conversation.id=run.conversation_id
    JOIN conversation_messages message ON message.id=run.response_message_id
    WHERE run.response_message_id=?
      AND run.workspace_id=?
      AND run.user_id=?
      AND run.status='completed'
      AND conversation.workspace_id=?
      AND conversation.owner_user_id=?
      AND message.conversation_id=conversation.id
      AND message.author_type='assistant'
    LIMIT 1
  `).bind(assistantMessageId, workspaceId, userId, workspaceId, userId).first<OwnedAiResponse>();
  if (!row) throw new AiFeedbackError("AI_FEEDBACK_NOT_FOUND");
  return row;
}

export async function listAiFeedback(input: Pick<FeedbackInput, "assistantMessageId"> & { db: D1; workspaceId: string; userId: string }) {
  await ownedAiResponse(input.db, input.workspaceId, input.userId, input.assistantMessageId);
  const result = await input.db.prepare(`
    SELECT feedback_type AS feedbackType, comment, updated_at AS updatedAt
    FROM ai_feedback
    WHERE workspace_id=? AND user_id=? AND assistant_message_id=?
    ORDER BY created_at ASC
  `).bind(input.workspaceId, input.userId, input.assistantMessageId).all<{ feedbackType: z.infer<typeof aiFeedbackTypeSchema>; comment: string | null; updatedAt: string }>();
  return result.results;
}

export async function saveAiFeedback(input: FeedbackInput & { db: D1; workspaceId: string; userId: string; now: string }) {
  const response = await ownedAiResponse(input.db, input.workspaceId, input.userId, input.assistantMessageId);
  const existing = await input.db.prepare(`
    SELECT id FROM ai_feedback
    WHERE workspace_id=? AND user_id=? AND assistant_message_id=? AND feedback_type=?
    LIMIT 1
  `).bind(input.workspaceId, input.userId, input.assistantMessageId, input.feedbackType).first<{ id: string }>();
  const feedbackId = existing?.id || crypto.randomUUID();
  await input.db.batch([
    input.db.prepare(`
      INSERT INTO ai_feedback (id,workspace_id,user_id,conversation_id,assistant_message_id,ai_run_id,feedback_type,comment,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_id,user_id,assistant_message_id,feedback_type)
      DO UPDATE SET comment=excluded.comment,updated_at=excluded.updated_at
    `).bind(feedbackId, input.workspaceId, input.userId, response.conversationId, input.assistantMessageId, response.aiRunId, input.feedbackType, input.comment, input.now, input.now),
    input.db.prepare(`
      INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
      VALUES (?,?,?,'ai_feedback',?,'ai_feedback_saved',?,?)
    `).bind(crypto.randomUUID(), input.workspaceId, input.userId, feedbackId, JSON.stringify({ feedbackType: input.feedbackType, aiRunId: response.aiRunId }), input.now),
  ]);
  return { feedbackId, replay: Boolean(existing), feedbackType: input.feedbackType, updatedAt: input.now };
}

export async function removeAiFeedback(input: Pick<FeedbackInput,"assistantMessageId"|"feedbackType"> & {db:D1;workspaceId:string;userId:string;now:string}) {
  await ownedAiResponse(input.db,input.workspaceId,input.userId,input.assistantMessageId);
  await input.db.batch([
    input.db.prepare("DELETE FROM ai_feedback WHERE workspace_id=? AND user_id=? AND assistant_message_id=? AND feedback_type=?")
      .bind(input.workspaceId,input.userId,input.assistantMessageId,input.feedbackType),
    input.db.prepare("INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES (?,?,?,'ai_feedback',?,'ai_feedback_removed',?,?)")
      .bind(crypto.randomUUID(),input.workspaceId,input.userId,input.assistantMessageId,JSON.stringify({feedbackType:input.feedbackType}),input.now),
  ]);
  return {removed:true};
}
