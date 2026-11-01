import type { LegalRequest } from "./contracts";
import { withinSignal } from "./lifetime";
import { requirePrivateDocumentAccess } from "./private-documents";
import { z } from "zod";

const contextSchema = z.object({ privateContextVersion: z.literal(1),
  documentIds: z.array(z.string().min(1).max(240)) }).strict();

type HistoryInput = {
  db: D1Database; workspaceId: string; userId: string; conversationId: string | null;
  parentBranchId: string | null; signal: AbortSignal;
};

/** Read only the chosen ancestry; saved answers are untrusted context, never current legal evidence. */
export async function loadAnswerHistory(input: HistoryInput): Promise<LegalRequest["history"]> {
  return (await loadAnswerContext(input)).history;
}

export async function loadAnswerContext(input: HistoryInput): Promise<{ history: LegalRequest["history"]; documentIds: string[] }> {
  const access = await withinSignal(input.signal, () => input.db.prepare(`SELECT 1 AS allowed
    FROM workspace_members WHERE workspace_id=? AND user_id=? AND status='active'
      AND (? IS NULL OR EXISTS (SELECT 1 FROM conversations
        WHERE id=? AND workspace_id=? AND owner_user_id=? AND status='active'))`)
    .bind(input.workspaceId, input.userId, input.conversationId, input.conversationId,
      input.workspaceId, input.userId).first());
  if (!access) throw new Error("HISTORY_ACCESS_DENIED");
  const turns: { question: string; answer: string }[] = [];
  const visited = new Set<string>();
  const documents = new Set<string>();
  let branchId = input.parentBranchId;
  while (branchId) {
    if (visited.has(branchId)) throw new Error("HISTORY_ANCESTRY_CYCLE");
    visited.add(branchId);
    const selected = branchId;
    const turn = await withinSignal(input.signal, () => input.db.prepare(`SELECT
      b.parent_branch_id AS parentBranchId,q.content AS question,q.structured_json AS privateContext,
      a.id AS responseMessageId,
      COALESCE(a.structured_json,a.content) AS answer
      FROM message_branches b JOIN conversations c ON c.id=b.conversation_id
      JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=c.owner_user_id
      JOIN conversation_messages q ON q.id=b.request_message_id AND q.conversation_id=c.id AND q.author_type='user'
      JOIN conversation_messages a ON a.id=b.response_message_id AND a.conversation_id=c.id AND a.author_type='assistant'
      WHERE b.id=? AND c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.status='active'
        AND b.workspace_id=c.workspace_id AND b.owner_user_id=c.owner_user_id AND member.status='active'`)
      .bind(selected, input.conversationId, input.workspaceId, input.userId)
      .first<{ parentBranchId: string | null; question: string; answer: string;
        privateContext: string | null; responseMessageId: string }>());
    if (!turn) throw new Error("HISTORY_ACCESS_DENIED");
    if (turn.privateContext) {
      const context = contextSchema.parse(JSON.parse(turn.privateContext));
      for (const id of context.documentIds) documents.add(id);
    }
    // Retained answers can predate dependency metadata. Resolve their saved
    // private references; deleted/missing chunks must not silently lose provenance.
    const references = await withinSignal(input.signal, () => input.db.prepare(`SELECT v.id AS documentId
      FROM legal_source_references r
      LEFT JOIN user_document_vector_chunks chunk ON r.canonical_url='juro-private://document/' || chunk.vector_id
        AND chunk.status='submitted' AND chunk.deleted_at IS NULL
      LEFT JOIN user_document_index_jobs job ON job.id=chunk.job_id AND job.workspace_id=?
        AND job.status='submitted' AND job.deleted_at IS NULL
      LEFT JOIN analysis_document_versions v ON v.id=job.document_version_id AND v.workspace_id=job.workspace_id
        AND v.owner_user_id=job.owner_user_id AND v.sha256=job.source_hash
      WHERE r.message_id=? AND r.conversation_id=? AND r.source_kind='internal'
        AND r.canonical_url LIKE 'juro-private://%'`)
      .bind(input.workspaceId, turn.responseMessageId, input.conversationId).all<{documentId: string | null}>());
    for (const reference of references.results) {
      if (!reference.documentId) throw new Error("HISTORY_PRIVATE_CONTEXT_UNAVAILABLE");
      documents.add(reference.documentId);
    }
    turns.push(turn);
    branchId = turn.parentBranchId;
  }
  const documentIds = [...documents];
  await requirePrivateDocumentAccess({ ...input, documentIds });
  return { documentIds, history: turns.reverse().flatMap(turn => [
    { role: "user" as const, content: turn.question },
    { role: "assistant" as const, content: turn.answer },
  ]) };
}
