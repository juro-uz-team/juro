import assert from "node:assert/strict";
import test from "node:test";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";
import {parseIdentityKeyring} from "../lib/auth/keyring";
import {saveUserMemory,deleteUserMemory} from "../lib/ai/user-memory";
import {readLegalUserContext} from "../lib/legal-chat/user-context";
import {updateLegalFact} from "../lib/legal-chat/facts";

test("context includes only active owned memories and distinguishes confirmed from rejected facts",async()=>{
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));
  try {
    const now=new Date().toISOString();
    sqlite.prepare("INSERT INTO user_profiles(id,email,locale,created_at,updated_at) VALUES (?,?,?,?,?)").run("owner","owner@example.test","en",now,now);
    for(const id of ["workspace","other-workspace"]){sqlite.prepare("INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,'en',?,?)").run(id,id,now,now);}
    sqlite.prepare("INSERT INTO conversations(id,workspace_id,owner_user_id,title,locale,created_at,updated_at) VALUES ('conversation','workspace','owner','Synthetic','en',?,?)").run(now,now);
    const keyring=parseIdentityKeyring(JSON.stringify({active:"test",versions:{test:{aead:Buffer.alloc(32,1).toString("base64url"),hmac:Buffer.alloc(32,2).toString("base64url")}}}));
    const scope={db:d1,keyring,userId:"owner",workspaceId:"workspace"};
    const create=(statement:string,workspaceId="workspace")=>saveUserMemory({...scope,workspaceId,statement,category:"legal_context",scope:"workspace",sourceKind:"manual",sourceType:"manual"});
    await create("A relevant private circumstance");
    await create("A different workspace circumstance","other-workspace");
    const deleted=await create("A deleted circumstance");await deleteUserMemory({...scope,memoryId:deleted.id});
    await create("A rejected circumstance");
    for(const [id,statement] of [["confirmed","A confirmed circumstance"],["rejected","A rejected circumstance"]]){
      sqlite.prepare("INSERT INTO confirmed_facts(id,conversation_id,statement,status,created_at,updated_at) VALUES (?,'conversation',?,'proposed',?,?)").run(id!,statement!,now,now);
    }
    await updateLegalFact({...scope,factId:"confirmed",status:"confirmed"});
    await updateLegalFact({...scope,factId:"rejected",status:"rejected"});
    const read=await readLegalUserContext({...scope,conversationId:"conversation"});
    assert.deepEqual(read.confirmedFacts,["A confirmed circumstance"]);
    assert.deepEqual(read.rejectedFacts,["A rejected circumstance"]);
    assert.deepEqual(read.memories.map(memory=>memory.statement),["A relevant private circumstance"]);
    await assert.rejects(updateLegalFact({...scope,workspaceId:"other-workspace",factId:"confirmed",status:"rejected"}),/LEGAL_FACT_UNAVAILABLE/);
    const foreign=await readLegalUserContext({...scope,userId:"foreign",conversationId:"conversation"});
    assert.deepEqual(foreign,{confirmedFacts:[],rejectedFacts:[],memories:[]});
    await assert.rejects(readLegalUserContext({...scope,keyring:null,conversationId:"conversation"}),/MEMORY_ENCRYPTION_UNAVAILABLE/);
    for(let index=0;index<100;index++)sqlite.prepare("INSERT INTO confirmed_facts(id,conversation_id,statement,status,created_at,updated_at) VALUES (?,'conversation',?,'confirmed',?,?)")
      .run(`new-${index}`,`Newer circumstance ${index}`,now,"2099-01-01T00:00:00.000Z");
    await assert.rejects(readLegalUserContext({...scope,conversationId:"conversation"}),/LEGAL_CONTEXT_CAPACITY_EXCEEDED/);
  } finally {sqlite.close();}
});
