export const AI_MESSAGE_OPERATIONS = ["new", "follow_up", "edit", "regenerate"] as const;

export type AiMessageOperation = (typeof AI_MESSAGE_OPERATIONS)[number];

export type AiBranchInput = {
  operation: AiMessageOperation;
  question: string;
  sourceMessageId: string | null;
  forkedFromMessageId: string | null;
  parentBranchId: string | null;
  versionNumber: number;
};

export type AiBranchSummary = {
  branchId: string;
  parentBranchId: string | null;
  requestMessageId: string;
  responseMessageId: string;
  operation: AiMessageOperation;
  versionNumber: number;
  question: string;
  createdAt: string;
};

export class AiBranchInputError extends Error {
  readonly code: "INVALID_BRANCH_OPERATION" | "SOURCE_MESSAGE_NOT_FOUND";

  constructor(code: "INVALID_BRANCH_OPERATION" | "SOURCE_MESSAGE_NOT_FOUND") {
    super(code);
    this.name = "AiBranchInputError";
    this.code = code;
  }
}

export async function listAiBranches(input: {
  db: D1Database;
  conversationId: string;
  workspaceId: string;
  userId: string;
  limit?: number;
}): Promise<AiBranchSummary[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 40, 40));
  const rows = await input.db.prepare(
    `SELECT b.id AS branchId,b.parent_branch_id AS parentBranchId,b.request_message_id AS requestMessageId,
      b.response_message_id AS responseMessageId,b.operation,mv.version_number AS versionNumber,
      request.content AS question,b.created_at AS createdAt
     FROM message_branches b
     JOIN conversations c ON c.id=b.conversation_id
     JOIN conversation_messages request ON request.id=b.request_message_id
     JOIN message_versions mv ON mv.branch_id=b.id AND mv.message_id=b.request_message_id
     WHERE b.conversation_id=? AND c.workspace_id=? AND c.owner_user_id=?
       AND b.workspace_id=c.workspace_id AND b.owner_user_id=c.owner_user_id
     ORDER BY b.created_at DESC,b.id DESC LIMIT ?`,
  ).bind(input.conversationId, input.workspaceId, input.userId, limit).all<AiBranchSummary>();
  return rows.results;
}

/**
 * Lists only the answer alternatives that belong to the selected question.
 * A normal follow-up is a new turn with its own root request and must not be
 * presented as another version of the previous answer.
 */
export async function listAiAnswerVersions(input: {
  db: D1Database;
  conversationId: string;
  workspaceId: string;
  userId: string;
  branchId: string | null;
  /** A legacy root request may predate immutable branch/version records. */
  requestMessageId?: string;
}): Promise<AiBranchSummary[]> {
  if (!input.branchId && !input.requestMessageId) return [];
  const rows = await input.db.prepare(
    `WITH RECURSIVE lineage(branchId,messageId,currentMessageId,sourceMessageId,depth) AS (
       SELECT mv.branch_id,mv.message_id,mv.message_id,mv.source_message_id,0
       FROM message_versions mv
       WHERE mv.conversation_id=?
       UNION ALL
       SELECT chain.branchId,chain.messageId,parent.message_id,parent.source_message_id,chain.depth+1
       FROM lineage chain
       JOIN message_versions parent ON parent.message_id=chain.sourceMessageId
         AND parent.conversation_id=?
       WHERE chain.sourceMessageId IS NOT NULL AND chain.depth<40
     ),
     roots(branchId,messageId,rootMessageId) AS (
       SELECT branchId,messageId,currentMessageId FROM lineage WHERE sourceMessageId IS NULL
       UNION
       SELECT branchId,messageId,sourceMessageId FROM lineage
       WHERE sourceMessageId IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM message_versions parent WHERE parent.message_id=lineage.sourceMessageId AND parent.conversation_id=?
       )
     ),
     selectedRoot(rootMessageId) AS (
       SELECT rootMessageId FROM roots WHERE branchId=?
       UNION
       SELECT ? WHERE ? IS NULL AND ? IS NOT NULL
     )
     SELECT b.id AS branchId,b.parent_branch_id AS parentBranchId,b.request_message_id AS requestMessageId,
       b.response_message_id AS responseMessageId,b.operation,mv.version_number AS versionNumber,
       request.content AS question,b.created_at AS createdAt
     FROM message_branches b
     JOIN conversations c ON c.id=b.conversation_id
     JOIN conversation_messages request ON request.id=b.request_message_id
     JOIN message_versions mv ON mv.branch_id=b.id AND mv.message_id=b.request_message_id
     JOIN roots versionRoot ON versionRoot.branchId=b.id AND versionRoot.messageId=mv.message_id
     JOIN selectedRoot ON selectedRoot.rootMessageId=versionRoot.rootMessageId
     WHERE b.conversation_id=? AND c.workspace_id=? AND c.owner_user_id=?
       AND b.workspace_id=c.workspace_id AND b.owner_user_id=c.owner_user_id
     ORDER BY mv.version_number ASC,b.created_at ASC,b.id ASC`,
  ).bind(
    input.conversationId,
    input.conversationId,
    input.conversationId,
    input.branchId,
    input.requestMessageId ?? null,
    input.branchId,
    input.requestMessageId ?? null,
    input.conversationId,
    input.workspaceId,
    input.userId,
  ).all<AiBranchSummary>();
  return rows.results;
}

export async function deleteAiConversation(input: {
  db: D1Database;
  conversationId: string;
  workspaceId: string;
  userId: string;
}): Promise<"deleted" | "busy" | "unavailable"> {
  const existing = await input.db.prepare(
    `SELECT EXISTS(
       SELECT 1 FROM conversations WHERE id=? AND workspace_id=? AND owner_user_id=?
     ) AS owned,
     EXISTS(
       SELECT 1 FROM ai_runs
       WHERE conversation_id=? AND workspace_id=? AND user_id=?
         AND status IN ('reserved','finalizing')
     ) AS busy`,
  ).bind(
    input.conversationId,
    input.workspaceId,
    input.userId,
    input.conversationId,
    input.workspaceId,
    input.userId,
  ).first<{ owned: number; busy: number }>();
  if (!existing?.owned) return "unavailable";
  if (existing.busy) return "busy";

  // message_versions.source_message_id and message_branches.forked_from_message_id
  // use ON DELETE SET NULL, while both tables intentionally reject updates.
  // Remove those immutable dependants first so the conversation cascade never
  // attempts a forbidden FK-driven update. D1 batch keeps the sequence atomic.
  const claimed = () => input.db.prepare(`SELECT CASE WHEN changes()=1 THEN 1
    ELSE json_extract('CONVERSATION_DELETE_FENCE_FAILED','$') END AS owned`);
  try { await input.db.batch([
    // Lock active membership through commit so revocation cannot race deletion.
    input.db.prepare(`UPDATE workspace_members SET updated_at=updated_at
      WHERE workspace_id=? AND user_id=? AND status='active'`).bind(input.workspaceId, input.userId),
    claimed(),
    input.db.prepare(`UPDATE conversations SET updated_at=updated_at
      WHERE id=? AND workspace_id=? AND owner_user_id=? AND status='active'`)
      .bind(input.conversationId, input.workspaceId, input.userId),
    claimed(),
    input.db.prepare(
      `DELETE FROM message_versions
       WHERE conversation_id=? AND EXISTS (
         SELECT 1 FROM conversations c
         WHERE c.id=message_versions.conversation_id AND c.workspace_id=? AND c.owner_user_id=?
       ) AND NOT EXISTS (
         SELECT 1 FROM ai_runs
         WHERE conversation_id=message_versions.conversation_id AND workspace_id=? AND user_id=?
           AND status IN ('reserved','finalizing')
       )`,
    ).bind(
      input.conversationId,
      input.workspaceId,
      input.userId,
      input.workspaceId,
      input.userId,
    ),
    input.db.prepare(
      `DELETE FROM message_branches
       WHERE conversation_id=? AND workspace_id=? AND owner_user_id=?
         AND NOT EXISTS (
           SELECT 1 FROM ai_runs
           WHERE conversation_id=message_branches.conversation_id AND workspace_id=? AND user_id=?
             AND status IN ('reserved','finalizing')
         )`,
    ).bind(
      input.conversationId,
      input.workspaceId,
      input.userId,
      input.workspaceId,
      input.userId,
    ),
    // Keep run links through dependent-row deletion so the final busy fence
    // observes a newly admitted run. Detach terminal content references together
    // just before PostgreSQL's conversation/message cascading actions.
    input.db.prepare(`UPDATE ai_runs
      SET conversation_id=NULL,request_message_id=NULL,response_message_id=NULL
      WHERE conversation_id=? AND workspace_id=? AND user_id=?
        AND status NOT IN ('reserved','finalizing')`)
      .bind(input.conversationId, input.workspaceId, input.userId),
    input.db.prepare(
      `DELETE FROM conversations
       WHERE id=? AND workspace_id=? AND owner_user_id=?
         AND NOT EXISTS (
           SELECT 1 FROM ai_runs
           WHERE conversation_id=conversations.id AND workspace_id=? AND user_id=?
             AND status IN ('reserved','finalizing')
         )`,
    ).bind(input.conversationId, input.workspaceId, input.userId, input.workspaceId, input.userId),
    // A newly reserved run must roll back earlier dependent-row deletions too.
    claimed(),
  ]); } catch (error) {
    // A run admitted after the initial read rolls back the complete delete.
    // Preserve the public busy result while allowing unrelated DB failures out.
    const busy = await input.db.prepare(`SELECT 1 AS busy FROM ai_runs r
      JOIN conversations c ON c.id=r.conversation_id AND c.workspace_id=r.workspace_id AND c.owner_user_id=r.user_id
      JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=c.owner_user_id
      WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.status='active'
        AND member.status='active' AND r.status IN ('reserved','finalizing') LIMIT 1`)
      .bind(input.conversationId, input.workspaceId, input.userId).first();
    if (busy) return "busy";
    throw error;
  }
  // D1 batch metadata is not a reliable deletion acknowledgement across all
  // runtimes. Read the tenant-owned row after the atomic batch instead.
  const remaining = await input.db.prepare(
    `SELECT EXISTS(
       SELECT 1 FROM conversations WHERE id=? AND workspace_id=? AND owner_user_id=?
     ) AS owned,
     EXISTS(
       SELECT 1 FROM ai_runs
       WHERE conversation_id=? AND workspace_id=? AND user_id=?
         AND status IN ('reserved','finalizing')
     ) AS busy`,
  ).bind(
    input.conversationId,
    input.workspaceId,
    input.userId,
    input.conversationId,
    input.workspaceId,
    input.userId,
  ).first<{ owned: number; busy: number }>();
  if (!remaining?.owned) return "deleted";
  return remaining.busy ? "busy" : "unavailable";
}

