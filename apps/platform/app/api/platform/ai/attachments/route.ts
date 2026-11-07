import {authenticateSignedAnswer} from "../../../../../lib/legal-answer-workflow/platform-auth";
export async function GET(request:Request){
 const headers={"cache-control":"no-store"};
 try {const actor=await authenticateSignedAnswer(request,AbortSignal.any([request.signal,AbortSignal.timeout(10000)]));const id=new URL(request.url).searchParams.get("analysisId");if(!id)return Response.json({error:"Missing analysis"},{status:400,headers});
 const row=await actor.db.prepare(`SELECT a.status,a.error_code AS errorCode,(SELECT v.id FROM analysis_document_versions v WHERE v.analysis_id=a.id AND v.workspace_id=a.workspace_id AND v.owner_user_id=a.owner_user_id ORDER BY v.created_at DESC LIMIT 1) AS documentId FROM document_analyses a JOIN document_files f ON f.id=a.uploaded_file_id AND f.workspace_id=a.workspace_id AND f.owner_user_id=a.owner_user_id WHERE a.id=? AND a.workspace_id=? AND a.owner_user_id=? AND a.deletion_requested_at IS NULL AND f.archived_at IS NULL AND f.mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','text/plain','text/html','application/json')`).bind(id,actor.workspaceId,actor.userId).first();
 return Response.json(row||{error:"Unavailable"},{status:row?200:404,headers});
 }catch{return Response.json({error:"Unavailable"},{status:403,headers});}
}
