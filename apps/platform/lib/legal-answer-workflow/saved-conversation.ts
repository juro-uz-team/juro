import { listAiBranches, listAiAnswerVersions } from "../ai/branch-store";
import { withinSignal } from "./lifetime";

type Input = { db: D1Database; workspaceId: string; userId: string; conversationId: string;
  branchId?: string; signal: AbortSignal };
type Turn = { branchId: string | null; parentBranchId: string | null; requestMessageId: string;
  responseMessageId: string; question: string; answer: string; resultJson: string | null; createdAt: string;
  operation: "new" | "follow_up" | "edit" | "regenerate" };
const unavailable = () => new Error("SAVED_CONVERSATION_UNAVAILABLE");

async function assertAccess(input: Input) {
  const row = await withinSignal(input.signal, () => input.db.prepare(`SELECT c.id FROM conversations c
    JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=c.owner_user_id
    WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.status='active' AND member.status='active'`)
    .bind(input.conversationId, input.workspaceId, input.userId).first());
  if (!row) throw unavailable();
}

async function readTurn(input: Input, branchId: string): Promise<Turn> {
  const row = await withinSignal(input.signal, () => input.db.prepare(`SELECT b.id AS branchId,
    b.parent_branch_id AS parentBranchId,b.request_message_id AS requestMessageId,b.response_message_id AS responseMessageId,
    q.content AS question,a.content AS answer,a.structured_json AS resultJson,b.created_at AS createdAt,b.operation
    FROM message_branches b JOIN conversations c ON c.id=b.conversation_id
    JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=c.owner_user_id AND member.status='active'
    JOIN conversation_messages q ON q.id=b.request_message_id AND q.conversation_id=c.id AND q.author_type='user'
    JOIN conversation_messages a ON a.id=b.response_message_id AND a.conversation_id=c.id AND a.author_type='assistant'
    WHERE b.id=? AND c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.status='active'
      AND b.workspace_id=c.workspace_id AND b.owner_user_id=c.owner_user_id`)
    .bind(branchId, input.conversationId, input.workspaceId, input.userId).first<Turn>());
  if (!row) throw unavailable();
  return row;
}

async function readLinearSavedTurns(input: Input): Promise<Turn[]> {
  const branch = await withinSignal(input.signal, () => input.db.prepare(
    "SELECT id FROM message_branches WHERE conversation_id=? LIMIT 1").bind(input.conversationId).first());
  if (branch) throw new Error("SAVED_HISTORY_ANCESTRY_INVALID");
  const { results } = await withinSignal(input.signal, () => input.db.prepare(`SELECT id,author_type AS role,
    content,structured_json AS resultJson,created_at AS createdAt FROM conversation_messages
    WHERE conversation_id=? ORDER BY created_at,CASE WHEN author_type='user' THEN 0 ELSE 1 END,id`)
    .bind(input.conversationId).all<{id: string; role: string; content: string; resultJson: string | null; createdAt: string}>());
  if (!results.length || results.length % 2) throw new Error("SAVED_HISTORY_AMBIGUOUS");
  const turns: Turn[] = [];
  for (let index = 0; index < results.length; index += 2) {
    const question = results[index], answer = results[index + 1];
    const start = Date.parse(question.createdAt), end = Date.parse(answer.createdAt);
    if (question.role !== "user" || answer.role !== "assistant" || !Number.isFinite(start) || !Number.isFinite(end)
      || start > end || (index > 0 && start <= Date.parse(results[index - 1].createdAt))) throw new Error("SAVED_HISTORY_AMBIGUOUS");
    turns.push({ branchId: null, parentBranchId: null, requestMessageId: question.id, responseMessageId: answer.id,
      question: question.content, answer: answer.content, resultJson: answer.resultJson, createdAt: answer.createdAt,
      operation: index ? "follow_up" : "new" });
  }
  return turns;
}

/** Saved answer bytes retain their historical presentation; reopening does not validate them as current law. */
export async function readSavedAnswerConversation(input: Input) {
  await assertAccess(input);
  const branches = await withinSignal(input.signal, () => listAiBranches(input));
  const selectedId = input.branchId ?? branches[0]?.branchId;
  let turns: Turn[] = [];
  if (selectedId) {
    const visited = new Set<string>();
    let next: string | null = selectedId;
    while (next) {
      if (visited.has(next)) throw new Error("SAVED_HISTORY_ANCESTRY_INVALID");
      visited.add(next);
      const turn = await readTurn(input, next);
      turns.push(turn);
      next = turn.parentBranchId;
    }
    turns.reverse();
  } else turns = await readLinearSavedTurns(input);
  const selected = turns.at(-1);
  if (!selected?.resultJson) throw new Error("SAVED_ANSWER_UNAVAILABLE");
  const facts = await withinSignal(input.signal, () => input.db.prepare(`SELECT id,statement,status FROM confirmed_facts
    WHERE conversation_id=? ORDER BY created_at,id LIMIT 200`).bind(input.conversationId)
    .all<{id: string; statement: string; status: string}>());
  const publicTurns = await Promise.all(turns.map(async turn => ({ branchId: turn.branchId, requestMessageId: turn.requestMessageId,
    responseMessageId: turn.responseMessageId, question: turn.question, answer: turn.answer, createdAt: turn.createdAt,
    result: turn.resultJson ? JSON.parse(turn.resultJson) as unknown : null,
    versions: await withinSignal(input.signal, () => listAiAnswerVersions({ ...input, branchId: turn.branchId, requestMessageId: turn.requestMessageId })) })));
  await assertAccess(input);
  return { conversationId: input.conversationId, messageId: selected.responseMessageId,
    requestMessageId: selected.requestMessageId, branchId: selected.branchId, operation: selected.operation,
    question: selected.question, result: JSON.parse(selected.resultJson) as unknown,
    branches, turns: publicTurns, facts: facts.results };
}
