import type {LegalSourceContext} from "../legal/source-context";

/** Fences the exact read identity against revocation, deletion, replacement and
 * case movement in the same transaction as messages, citations and usage. */
export function privateDocumentCitationGuards(input:{
  db:D1Database;workspaceId:string;userId:string;conversationId:string;sources:readonly LegalSourceContext[];
}):D1PreparedStatement[] {
  return input.sources.filter(source=>source.sourceType==="internal").map(source=>{
    const receipt=source.privateDocumentReceipt;
    if(!receipt||receipt.workspaceId!==input.workspaceId)throw new Error("PRIVATE_DOCUMENT_RECEIPT_INVALID");
    return input.db.prepare(`SELECT CASE WHEN EXISTS(
      SELECT 1 FROM user_document_vector_chunks chunk
      JOIN user_document_index_jobs job ON job.id=chunk.job_id AND job.status='submitted'
      JOIN analysis_document_versions version ON version.id=job.document_version_id
        AND version.analysis_id=job.analysis_id AND version.workspace_id=job.workspace_id
        AND version.owner_user_id=job.owner_user_id AND version.sha256=job.source_hash
      JOIN document_analyses analysis ON analysis.id=job.analysis_id
        AND analysis.workspace_id=job.workspace_id AND analysis.owner_user_id=job.owner_user_id
      JOIN workspace_members member ON member.workspace_id=job.workspace_id AND member.user_id=? AND member.status='active'
      JOIN conversations conversation ON conversation.id=? AND conversation.workspace_id=job.workspace_id AND conversation.owner_user_id=?
      WHERE chunk.vector_id=? AND chunk.status='submitted' AND job.workspace_id=?
        AND job.analysis_id=? AND job.document_version_id=? AND job.owner_user_id=? AND job.source_hash=?
        AND job.access_scope=? AND (job.access_scope='workspace' OR job.owner_user_id=?)
        AND analysis.status='completed' AND analysis.case_id IS ?
        AND (conversation.case_id IS NULL OR conversation.case_id=analysis.case_id)
        AND version.version=(SELECT max(latest.version) FROM analysis_document_versions latest
          WHERE latest.analysis_id=job.analysis_id AND latest.workspace_id=job.workspace_id)
      ) THEN 1 ELSE json_extract('PRIVATE_DOCUMENT_CONTEXT_CHANGED','$') END`)
      .bind(input.userId,input.conversationId,input.userId,source.id,input.workspaceId,receipt.analysisId,
        receipt.documentVersionId,receipt.ownerUserId,source.contentSha256,receipt.accessScope,input.userId,receipt.caseId);
  });
}
