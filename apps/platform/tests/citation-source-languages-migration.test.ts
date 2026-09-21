import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {sqliteD1Fixture} from "./helpers/sqlite-d1";

test("citation language migration preserves saved rows, structure, indexes and foreign keys",()=>{
  const {sqlite}=sqliteD1Fixture();
  try {
    sqlite.exec(readFileSync(new URL("../drizzle/0155_citation_evidence_receipts.sql",import.meta.url),"utf8"));
    const now=new Date().toISOString();
    sqlite.prepare("INSERT INTO user_profiles(id,email,locale,created_at,updated_at) VALUES (?,?,?,?,?)").run("owner","owner@example.test","ru",now,now);
    sqlite.prepare("INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,'ru',?,?)").run("workspace","Workspace",now,now);
    sqlite.prepare(`INSERT INTO ai_runs(id,workspace_id,user_id,idempotency_key,correlation_id,provider,model,answer_mode,reasoning_mode,status,
      legal_database_as_of,instruction_hash,source_version_hash,started_at,created_at,updated_at)
      VALUES ('run','workspace','owner','key','correlation','openai','synthetic','detailed','fast','completed','unavailable',?,?,?, ?,?)`)
      .run("a".repeat(64),"b".repeat(64),now,now,now);
    const insert=sqlite.prepare(`INSERT INTO legal_source_references(id,ai_run_id,source_kind,source_locale,source_url,canonical_url,title,
      retrieved_at,validated_at,content_sha256,fetch_status,citation_validation_status,created_at,evidence_receipt_json)
      VALUES (?,'run','lex',?,'https://lex.uz/docs/7','https://lex.uz/docs/7','Synthetic',?,?,?,'success','validated',?,?)`);
    insert.run("old","ru",now,now,"a".repeat(64),now,'{"retained":"exact receipt"}');
    const rows=sqlite.prepare("SELECT * FROM legal_source_references").all();
    const columns=sqlite.prepare("PRAGMA table_info(legal_source_references)").all();
    const foreignKeys=sqlite.prepare("PRAGMA foreign_key_list(legal_source_references)").all();
    const indexes=()=>sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='index' AND tbl_name='legal_source_references' AND sql IS NOT NULL ORDER BY name").all();
    const originalIndexes=indexes();
    sqlite.exec("BEGIN");
    sqlite.exec(readFileSync(new URL("../drizzle/0157_citation_source_languages.sql",import.meta.url),"utf8"));
    sqlite.exec("COMMIT");
    assert.deepEqual(sqlite.prepare("SELECT * FROM legal_source_references").all(),rows);
    assert.deepEqual(sqlite.prepare("PRAGMA table_info(legal_source_references)").all(),columns);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_list(legal_source_references)").all(),foreignKeys);
    assert.deepEqual(indexes(),originalIndexes);
    for(const locale of ["ru","uz","uzc","en"]){
      sqlite.prepare("UPDATE legal_source_references SET source_locale=? WHERE id='old'").run(locale);
    }
    assert.throws(()=>sqlite.prepare("UPDATE legal_source_references SET source_locale='invented'").run(),/locale_check/);
    const beforePrivateMigration=sqlite.prepare("SELECT * FROM legal_source_references").all();
    sqlite.exec(readFileSync(new URL("../drizzle/0158_private_document_citation_languages.sql",import.meta.url),"utf8"));
    assert.deepEqual(sqlite.prepare("SELECT * FROM legal_source_references").all(),beforePrivateMigration);
    assert.deepEqual(sqlite.prepare("PRAGMA table_info(legal_source_references)").all(),columns);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_list(legal_source_references)").all(),foreignKeys);
    assert.deepEqual(indexes(),originalIndexes);
    assert.throws(()=>sqlite.prepare("UPDATE legal_source_references SET source_locale='mixed'").run(),/locale_check/);
    sqlite.prepare("UPDATE legal_source_references SET source_kind='internal',source_locale='mixed'").run();
    sqlite.prepare("UPDATE legal_source_references SET source_locale='unknown'").run();
    assert.throws(()=>sqlite.prepare("UPDATE legal_source_references SET source_kind='lex'").run(),/locale_check/);
    assert.throws(()=>sqlite.prepare("UPDATE legal_source_references SET source_locale='invented'").run(),/locale_check/);
    assert.equal(sqlite.prepare("PRAGMA foreign_key_check").all().length,0);
  } finally {sqlite.close();}
});
