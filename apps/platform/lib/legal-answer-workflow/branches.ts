import { ensureSavedConversationBranches } from "./legacy-history";

export type BranchSelection = {
  operation: "follow_up" | "edit" | "regenerate";
  responseMessageId: string;
};

export async function planAnswerBranch(input: {
  db: D1Database; workspaceId: string; userId: string; conversationId: string | null;
  question: string; branch?: BranchSelection;
}) {
  if (!input.branch) return { operation: "new" as const, parentBranchId: null,
    sourceMessageId: null, forkedFromMessageId: null, selectedBranchId: null };
  if (!input.conversationId) throw new Error("BRANCH_SELECTION_INVALID");
  const selection = input.branch;
  const readSelection = () => input.db.prepare(`SELECT b.id AS branchId,b.parent_branch_id AS parentBranchId,
    b.request_message_id AS requestMessageId,b.response_message_id AS responseMessageId,
    v.source_message_id AS sourceMessageId,m.content AS question
    FROM message_branches b JOIN conversations c ON c.id=b.conversation_id
    JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=c.owner_user_id AND member.status='active'
    JOIN message_versions v ON v.branch_id=b.id AND v.message_id=b.request_message_id
    JOIN conversation_messages m ON m.id=b.request_message_id AND m.conversation_id=c.id
    WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.status='active'
      AND b.workspace_id=? AND b.owner_user_id=? AND b.response_message_id=?`)
    .bind(input.conversationId, input.workspaceId, input.userId, input.workspaceId,
      input.userId, selection.responseMessageId)
    .first<{ branchId: string; parentBranchId: string | null; requestMessageId: string;
      responseMessageId: string; sourceMessageId: string | null; question: string }>();
  let selected = await readSelection();
  if (!selected) {
    await ensureSavedConversationBranches({ ...input, conversationId: input.conversationId,
      selectedMessageId: selection.responseMessageId });
    selected = await readSelection();
  }
  if (!selected) throw new Error("BRANCH_SELECTION_INVALID");
  if (input.branch.operation === "regenerate" && input.question !== selected.question) {
    throw new Error("REGENERATION_QUESTION_CHANGED");
  }
  return input.branch.operation === "follow_up"
    ? { operation: input.branch.operation, parentBranchId: selected.branchId,
      forkedFromMessageId: selected.responseMessageId, sourceMessageId: null, selectedBranchId: selected.branchId }
    : { operation: input.branch.operation, parentBranchId: selected.parentBranchId,
      forkedFromMessageId: selected.requestMessageId,
      sourceMessageId: selected.sourceMessageId ?? selected.requestMessageId, selectedBranchId: selected.branchId };
}
