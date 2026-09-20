import type {IdentityKeyring} from "../auth/keyring";
import {listUserMemories,UserMemoryError,type UserMemory} from "../ai/user-memory";

export type LegalUserContext={
  confirmedFacts:readonly string[];
  rejectedFacts:readonly string[];
  memories:readonly Pick<UserMemory,"id"|"category"|"statement">[];
};

/** User-owned context is distinct from official evidence. Active scope and
 * deletion state are enforced before any private memory reaches the model. */
export async function readLegalUserContext(input:{db:D1Database;workspaceId:string;userId:string;conversationId:string|null;keyring:IdentityKeyring|null}):Promise<LegalUserContext>{
  const facts=input.conversationId?await input.db.prepare(`SELECT f.statement,f.status FROM confirmed_facts f
    JOIN conversations c ON c.id=f.conversation_id WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=?
      AND f.status IN ('confirmed','rejected') ORDER BY f.updated_at DESC,f.id DESC LIMIT 101`)
    .bind(input.conversationId,input.workspaceId,input.userId).all<{statement:string;status:string}>():{results:[]};
  if(facts.results.length>100||facts.results.some(fact=>fact.statement.length>4000))throw new Error("LEGAL_CONTEXT_CAPACITY_EXCEEDED");
  const count=await input.db.prepare(`SELECT COUNT(*) AS total FROM user_memories WHERE user_id=? AND status='active'
    AND (scope='global' OR (scope='workspace' AND workspace_id=?))`).bind(input.userId,input.workspaceId).first<{total:number}>();
  if(Number(count?.total??0)>100)throw new Error("LEGAL_CONTEXT_CAPACITY_EXCEEDED");
  let memories:UserMemory[]=[];
  if(input.keyring)memories=await listUserMemories({...input,keyring:input.keyring});
  else {
    if(Number(count?.total??0)>0)throw new UserMemoryError("MEMORY_ENCRYPTION_UNAVAILABLE");
  }
  const rejectedFacts=facts.results.filter(fact=>fact.status==="rejected").map(fact=>fact.statement);
  return {confirmedFacts:facts.results.filter(fact=>fact.status==="confirmed").map(fact=>fact.statement),rejectedFacts,
    memories:memories.filter(memory=>!rejectedFacts.includes(memory.statement)).map(({id,category,statement})=>({id,category,statement}))};
}
