import {z} from "zod";

export const legalFactUpdateSchema=z.object({factId:z.string().uuid(),status:z.enum(["confirmed","rejected"])}).strict();
export class LegalFactUnavailable extends Error {constructor(){super("LEGAL_FACT_UNAVAILABLE");}}

/** Confirmation changes a case fact, never its status as legal evidence. */
export async function updateLegalFact(input:{db:D1Database;workspaceId:string;userId:string;factId:string;status:"confirmed"|"rejected"}){
  const now=new Date().toISOString();
  const result=await input.db.prepare(`UPDATE confirmed_facts SET status=?,confirmed_by_user_id=?,confirmed_at=?,updated_at=?
    WHERE id=? AND EXISTS(SELECT 1 FROM conversations c WHERE c.id=confirmed_facts.conversation_id
      AND c.workspace_id=? AND c.owner_user_id=?)`).bind(input.status,input.userId,input.status==="confirmed"?now:null,
      now,input.factId,input.workspaceId,input.userId).run();
  if(Number(result.meta.changes??0)!==1)throw new LegalFactUnavailable();
  return {factId:input.factId,status:input.status};
}
