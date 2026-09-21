import assert from "node:assert/strict";
import test from "node:test";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";
import {runLegalChatStorageProbe} from "../worker/legal-chat-storage-probe";

test("storage probe verifies current clarification, replay and cleanup in isolated staging tenants",async()=>{
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));
  try {
    const input={db:d1,environment:"staging",enabled:"true",executionId:crypto.randomUUID(),locale:"ru" as const};
    for(const environment of ["development","production"])
      await assert.rejects(runLegalChatStorageProbe({...input,environment}),/PROBE_DISABLED/);
    await assert.rejects(runLegalChatStorageProbe({...input,enabled:"false"}),/PROBE_DISABLED/);
    await assert.rejects(runLegalChatStorageProbe({...input,executionId:"unsafe"}));
    for(const locale of ["ru","uz"] as const) {
      await runLegalChatStorageProbe({...input,executionId:crypto.randomUUID(),locale});
      for(const table of ["user_profiles","workspaces","conversations","conversation_messages","ai_runs","ai_usage_ledger","idempotency_keys"])
        assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0,table);
    }
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(),[]);
  } finally {sqlite.close();}
});

test("storage probe cleans its isolated data after save failure",async()=>{
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));
  try {
    sqlite.exec("CREATE TRIGGER probe_save_failure BEFORE INSERT ON conversation_messages BEGIN SELECT RAISE(ABORT,'SYNTHETIC_SAVE_FAILURE'); END");
    await assert.rejects(runLegalChatStorageProbe({db:d1,environment:"staging",enabled:"true",executionId:crypto.randomUUID(),locale:"uz"}),/SYNTHETIC_SAVE_FAILURE/);
    for(const table of ["user_profiles","workspaces","conversations","ai_runs","ai_usage_ledger","idempotency_keys"])
      assert.equal(sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n,0,table);
  } finally {sqlite.close();}
});
