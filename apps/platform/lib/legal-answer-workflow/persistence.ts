import { legalAnswerDeadlineMs } from "./deadline";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { LegalChatResponse } from "../ai/legal-chat-schema";
import { completeAiRunStatements } from "../ai/run-store";
import { citationStatements, type CitationRecord } from "./citation-storage";
import { planAnswerBranch, type BranchSelection } from "./branches";
import { withinSignal } from "./lifetime";
import { privateDocumentPublicationStatements } from "./private-documents";
import { answerVoiceStatements, type VerifiedAnswerVoice } from "./voice-input";
import { caseContextPublicationStatements, type CaseContextReceipt } from "./case-context";
import { automaticAnswerMemoryStatements } from "./automatic-memory";
import type { IdentityKeyring } from "../auth/keyring";

type SignedPublication = {
  submittedAt: number; deadlineMs: number;
  db: D1Database; workspaceId: string; userId: string; runId: string; ledgerId: string;
  idempotencyKey: string; conversationId: string | null; question: string;
  model: string; response: LegalChatResponse; signal: AbortSignal;
  citations?: readonly CitationRecord[];
  branch?: BranchSelection;
  documentIds?: readonly string[];
  voice?: VerifiedAnswerVoice;
  caseContext?: CaseContextReceipt;
  memoryKeyring?: IdentityKeyring;
  usage: { providerResponseId: string | null; inputTokens: number; outputTokens: number;
    cachedInputTokens: number; attempts: number; latencyMs: number };
};

/** Publish messages, branch, usage and replay identity in the same database transaction. */
export async function persistSignedInAnswer(input: SignedPublication) {
  input.signal.throwIfAborted();
  const deadlineAt = input.submittedAt + input.deadlineMs;
  if (!Number.isSafeInteger(input.submittedAt) || !Number.isFinite(input.deadlineMs)
    || input.deadlineMs <= 0 || input.deadlineMs > legalAnswerDeadlineMs || input.submittedAt > Date.now()
    || deadlineAt <= Date.now()) throw new Error("PUBLICATION_DEADLINE_EXCEEDED");
  const requestStartedAt = new Date(input.submittedAt).toISOString();
  const branch = await withinSignal(input.signal, () => planAnswerBranch(input));
  const citations = input.citations ?? [];
  if (input.response.sources.length !== citations.length) throw new Error("CITATION_RECEIPTS_REQUIRED");
  if (new Set(citations.map(citation => citation.source.sourceId)).size !== citations.length
    || input.response.sources.some(source => !citations.some(citation => isDeepStrictEqual(source, citation.source)))) {
    throw new Error("CITATION_PRESENTATION_MISMATCH");
  }
  const conversationId = input.conversationId ?? randomUUID();
  const requestMessageId = randomUUID();
  const responseMessageId = randomUUID();
  const branchId = randomUUID();
  const now = new Date().toISOString();
  const memoryStatements = await withinSignal(input.signal, () => automaticAnswerMemoryStatements({ ...input,
    keyring: input.memoryKeyring, conversationId, requestMessageId, now }));
  const serialized = JSON.stringify(input.response);
  const deadlineFence = () => input.db.prepare(`SELECT CASE WHEN unixepoch('subsec') * 1000 < ?
    THEN 1 ELSE json_extract('PUBLICATION_DEADLINE_EXCEEDED','$') END AS live`).bind(deadlineAt);
  const claimed = () => input.db.prepare(`SELECT CASE WHEN changes()=1 THEN 1
    ELSE json_extract('PUBLICATION_FENCE_FAILED','$') END AS owned`);
  const statements: D1PreparedStatement[] = [
    deadlineFence(),
    // A matching no-op write locks membership until commit, including against revocation.
    input.db.prepare(`UPDATE workspace_members SET updated_at=updated_at
      WHERE workspace_id=? AND user_id=? AND status='active'`)
      .bind(input.workspaceId, input.userId),
    claimed(),
    input.db.prepare(`UPDATE ai_runs SET status='finalizing',updated_at=?
      WHERE id=? AND workspace_id=? AND user_id=? AND status='reserved' AND updated_at>=?`)
      .bind(now, input.runId, input.workspaceId, input.userId, requestStartedAt),
    claimed(),
  ];
  statements.push(...privateDocumentPublicationStatements({ ...input, documentIds: input.documentIds ?? [] }));
  if (input.conversationId) {
    // Lock the conversation before assigning its next immutable version number.
    statements.push(input.db.prepare(`UPDATE conversations SET updated_at=updated_at
      WHERE id=? AND workspace_id=? AND owner_user_id=? AND status='active'`)
      .bind(conversationId, input.workspaceId, input.userId), claimed());
    if (branch.selectedBranchId) statements.push(input.db.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM message_branches WHERE id=? AND conversation_id=? AND workspace_id=? AND owner_user_id=?
    ) THEN 1 ELSE json_extract('BRANCH_SELECTION_INVALID','$') END AS owned`)
      .bind(branch.selectedBranchId, conversationId, input.workspaceId, input.userId));
  } else {
    statements.push(input.db.prepare(`INSERT INTO conversations
      (id,workspace_id,owner_user_id,title,locale,status,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?)`)
      .bind(conversationId, input.workspaceId, input.userId, input.question.slice(0, 160), input.response.language, now, now));
  }
  if (input.caseContext) statements.push(...caseContextPublicationStatements({ ...input, receipt: input.caseContext }));
  statements.push(
    input.db.prepare(`INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES(?,?,'user',?,?,?)`).bind(requestMessageId, conversationId, input.question,
        JSON.stringify({ privateContextVersion: 1, documentIds: input.documentIds ?? [] }), now),
    input.db.prepare(`INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES(?,?,'assistant',?,?,?)`).bind(responseMessageId, conversationId, input.response.answer, serialized, now),
    input.db.prepare(`INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,
      forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .bind(branchId, conversationId, input.workspaceId, input.userId, branch.parentBranchId,
        branch.forkedFromMessageId, requestMessageId, responseMessageId, branch.operation, now),
    input.db.prepare(`INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,
      created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES(?,?,?,?,?,?,?,CASE WHEN ? IS NULL THEN 1 ELSE
        (SELECT COALESCE(MAX(version_number),1)+1 FROM message_versions
          WHERE conversation_id=? AND (source_message_id=? OR message_id=?)) END,?,?)`)
      .bind(randomUUID(), conversationId, branchId, requestMessageId, branch.sourceMessageId, input.userId,
        branch.operation, branch.sourceMessageId, conversationId, branch.sourceMessageId, branch.sourceMessageId,
        createHash("sha256").update(input.question).digest("hex"), now),
    input.db.prepare("UPDATE conversations SET updated_at=? WHERE id=? AND workspace_id=? AND owner_user_id=?")
      .bind(now, conversationId, input.workspaceId, input.userId),
    ...citationStatements({ db: input.db, aiRunId: input.runId, conversationId,
      messageId: responseMessageId, now, citations }),
    ...answerVoiceStatements({ ...input, conversationId, requestMessageId, now }),
    ...memoryStatements,
    ...completeAiRunStatements({ ...input, ...input.usage, conversationId, requestMessageId, responseMessageId,
      provider: "openai", fallbackFromProvider: null, chargeable: input.response.responseKind === "answer",
      legalDatabaseAsOf: input.response.legalDatabaseAsOf }),
    deadlineFence(),
  );
  input.signal.throwIfAborted();
  await input.db.batch(statements);
  return { conversationId, requestMessageId, responseMessageId, branchId };
}
