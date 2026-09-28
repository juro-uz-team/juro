import assert from "node:assert/strict";
import test from "node:test";
import {aiDatabase} from "./helpers/ai-run-database";
import {reserveAiRun,renewAiRunReservation,beginAiRunFinalization,completeAiRunStatements} from "../lib/ai/run-store";
import {LEGAL_CHAT_PROVIDER_TIMEOUT_MS,LEGAL_CHAT_RESERVATION_TTL_MS} from "../lib/legal-chat/execution-limits";

test("renewal preserves a long running reservation and cannot revive expired or foreign work",async()=>{
  const {sqlite,d1}=aiDatabase();
  try {
    const input={db:d1,workspaceId:"workspace",userId:"user",idempotencyKey:"long-request",
      requestHash:"hash",conversationId:null,provider:"openai",model:"gpt-5.6-luna",
      answerMode:"detailed" as const,reasoningMode:"fast" as const,legalDatabaseAsOf:"unavailable",
      instructionHash:"instruction",sourceVersionHash:"source",monthlyLimit:2};
    const reserved=await reserveAiRun(input);
    assert.equal(reserved.kind,"reserved");
    if(reserved.kind!=="reserved")throw Error("Reservation required");
    const owner={db:d1,runId:reserved.runId,workspaceId:input.workspaceId,userId:input.userId};
    const now=Date.now();
    const activeAt=new Date(now-LEGAL_CHAT_PROVIDER_TIMEOUT_MS).toISOString();
    sqlite.prepare("UPDATE ai_runs SET updated_at=? WHERE id=?").run(activeAt,reserved.runId);
    sqlite.prepare("UPDATE idempotency_keys SET updated_at=?").run(activeAt);
    assert.equal((await reserveAiRun(input)).kind,"processing");
    assert.equal(await renewAiRunReservation({...owner,userId:"foreign",now}),false);
    assert.equal(await renewAiRunReservation({...owner,now}),true);
    assert.equal(sqlite.prepare("SELECT updated_at FROM idempotency_keys").get()?.updated_at,new Date(now).toISOString());
    assert.equal(await renewAiRunReservation({...owner,now:now+LEGAL_CHAT_RESERVATION_TTL_MS+1}),false);
    sqlite.prepare("UPDATE ai_runs SET updated_at=? WHERE id=?")
      .run(new Date(now-LEGAL_CHAT_RESERVATION_TTL_MS-1).toISOString(),reserved.runId);
    assert.equal(await beginAiRunFinalization(owner),false);
    sqlite.prepare("UPDATE idempotency_keys SET updated_at=?")
      .run(new Date(now-LEGAL_CHAT_RESERVATION_TTL_MS-1).toISOString());
    assert.equal((await reserveAiRun(input)).kind,"expired");
    assert.equal(await renewAiRunReservation(owner),false);
    sqlite.exec("CREATE TABLE saved_lease_marker(value TEXT)");
    const completion={...owner,ledgerId:reserved.ledgerId,idempotencyKey:input.idempotencyKey,
      conversationId:"conversation",requestMessageId:"request",responseMessageId:"response",providerResponseId:null,
      provider:"openai" as const,fallbackFromProvider:null,model:"synthetic-model",inputTokens:0,outputTokens:0,
      cachedInputTokens:0,attempts:1,latencyMs:0,chargeable:true};
    await assert.rejects(d1.batch([d1.prepare("INSERT INTO saved_lease_marker VALUES ('late')"),
      ...completeAiRunStatements(completion)]));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM saved_lease_marker").get()?.count,0);
  } finally {sqlite.close();}
});
