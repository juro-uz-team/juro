import { createHash } from "node:crypto";

type Actor = { db: D1Database; workspaceId: string; userId: string; conversationId: string };
type Message = { id: string; role: string; content: string; createdAt: string };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Add ancestry for a bounded, unambiguous linear saved conversation. Never rewrite saved messages. */
export async function ensureSavedConversationBranches(input: Actor & { selectedMessageId: string }) {
  const access = await input.db.prepare(`SELECT c.id FROM conversations c
    JOIN workspace_members m ON m.workspace_id=c.workspace_id AND m.user_id=c.owner_user_id AND m.status='active'
    WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.status='active'`)
    .bind(input.conversationId, input.workspaceId, input.userId).first();
  if (!access) throw new Error("BRANCH_SELECTION_INVALID");
  const existing = await input.db.prepare("SELECT id FROM message_branches WHERE conversation_id=? LIMIT 1")
    .bind(input.conversationId).first();
  if (existing) return;
  const { results: messages } = await input.db.prepare(`SELECT id,author_type AS role,content,created_at AS createdAt
    FROM conversation_messages WHERE conversation_id=? ORDER BY created_at,
      CASE WHEN author_type='user' THEN 0 ELSE 1 END,id`)
    .bind(input.conversationId).all<Message>();
  if (!messages.length || messages.length % 2
    || !messages.some(message => message.id === input.selectedMessageId)) throw new Error("SAVED_HISTORY_AMBIGUOUS");
  for (let index = 0; index < messages.length; index += 2) {
    const question = messages[index], answer = messages[index + 1];
    const start = Date.parse(question.createdAt), end = Date.parse(answer.createdAt);
    if (question.role !== "user" || answer.role !== "assistant" || !Number.isFinite(start) || !Number.isFinite(end)
      || start > end || (index > 0 && start <= Date.parse(messages[index - 1].createdAt))) {
      throw new Error("SAVED_HISTORY_AMBIGUOUS");
    }
  }
  const claimed = () => input.db.prepare(`SELECT CASE WHEN changes()=1 THEN 1
    ELSE json_extract('SAVED_HISTORY_ACCESS_CHANGED','$') END AS owned`);
  const statements = [
    input.db.prepare(`UPDATE workspace_members SET updated_at=updated_at
      WHERE workspace_id=? AND user_id=? AND status='active'`).bind(input.workspaceId, input.userId), claimed(),
    input.db.prepare(`UPDATE conversations SET updated_at=updated_at
      WHERE id=? AND workspace_id=? AND owner_user_id=? AND status='active'`)
      .bind(input.conversationId, input.workspaceId, input.userId), claimed(),
    input.db.prepare(`SELECT CASE WHEN (SELECT count(*) FROM conversation_messages WHERE conversation_id=?)=?
      THEN 1 ELSE json_extract('SAVED_HISTORY_CHANGED','$') END AS unchanged`).bind(input.conversationId, messages.length),
  ];
  let parent: string | null = null;
  for (let index = 0; index < messages.length; index += 2) {
    const question = messages[index], answer = messages[index + 1];
    const id = digest(JSON.stringify(["saved-conversation-branch", input.conversationId, question.id, answer.id]));
    const operation = parent ? "follow_up" : "new";
    // Deterministic identities make simultaneous first use idempotent under the conversation lock.
    for (const message of [question, answer]) statements.push(input.db.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM conversation_messages WHERE id=? AND conversation_id=? AND author_type=? AND content=? AND created_at=?
    ) THEN 1 ELSE json_extract('SAVED_HISTORY_CHANGED','$') END AS unchanged`)
      .bind(message.id, input.conversationId, message.role, message.content, message.createdAt));
    statements.push(input.db.prepare(`INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,
      parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(id, input.conversationId, input.workspaceId, input.userId, parent,
        index ? messages[index - 1].id : null, question.id, answer.id, operation, answer.createdAt),
    input.db.prepare(`INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,
      created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES(?,?,?,?,NULL,?,?,1,?,?) ON CONFLICT(id) DO NOTHING`)
      .bind(digest(`saved-conversation-version:${id}`), input.conversationId, id, question.id,
        input.userId, operation, digest(question.content), question.createdAt));
    parent = id;
  }
  await input.db.batch(statements);
}
