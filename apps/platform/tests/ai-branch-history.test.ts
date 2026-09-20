import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  AiBranchInputError,
  deleteAiConversation,
  listAiAnswerVersions,
  listAiBranches,
} from "../lib/ai/branch-store";
import { conversationOperation as parseAiMessageOperation, readConversationContext } from "../lib/legal-chat/conversation-context";
import { loadAiConversationTurns } from "../lib/ai/conversation-branch-reader";

const resolveAiBranchInput = async (input: Parameters<typeof readConversationContext>[0]) => (await readConversationContext(input)).branch;

test("long follow-ups retain early facts and edits across context read pages",async context=>{
  const {sqlite,d1}=await branchDatabase();context.after(()=>sqlite.close());
  seedInitialBranch(sqlite);
  for(let index=2;index<=201;index++) {
    for(const author of ["user","assistant"]) {
      sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at) VALUES (?,'conversation-1',?,?,'2026-08-01')")
        .run(`${author==="user"?"request":"response"}-${index}`,author,`Turn ${index}`);
    }
    sqlite.prepare(`INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES (?,'conversation-1','workspace-1','user-1',?,NULL,?,?,?,'2026-08-01')`)
      .run(`branch-${index}`,`branch-${index-1}`,`request-${index}`,`response-${index}`,index===31?"regenerate":"follow_up");
  }
  const selected=await readConversationContext({db:d1,workspaceId:"workspace-1",userId:"user-1",conversationId:"conversation-1",
    requestedOperation:"follow_up",sourceMessageId:"response-70",question:"What should I do next?"});
  assert.equal(selected.turns.length,69);
  assert.equal(selected.turns[0]?.question,"Какой срок действует по договору?");
  assert.equal(selected.turns.some(turn=>turn.question==="Turn 30"),false);
  assert.equal(selected.turns[29]?.question,"Turn 31");
  assert.equal(selected.turns.at(-1)?.question,"Turn 70");
  await assert.rejects(readConversationContext({db:d1,workspaceId:"workspace-1",userId:"user-1",conversationId:"conversation-1",
    requestedOperation:"follow_up",sourceMessageId:"response-201",question:"What next?"}),/LEGAL_CONTEXT_CAPACITY_EXCEEDED/);
});

test("legacy follow-up context does not silently discard turns beyond the old display page",async context=>{
  const {sqlite,d1}=await branchDatabase();context.after(()=>sqlite.close());
  seedInitialBranch(sqlite);
  sqlite.exec("DELETE FROM message_versions; DELETE FROM message_branches;");
  for(let index=2;index<=26;index++) {
    const time=new Date(Date.parse("2026-08-01T00:00:00Z")+index*1000).toISOString();
    for(const author of ["user","assistant"]) {
      sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at) VALUES (?,'conversation-1',?,?,?)")
        .run(`${author==="user"?"request":"response"}-${index}`,author,`Legacy ${index}`,time);
    }
    sqlite.prepare(`INSERT INTO ai_runs(id,workspace_id,user_id,conversation_id,request_message_id,response_message_id,status,completed_at)
      VALUES (?,'workspace-1','user-1','conversation-1',?,?,'completed',?)`).run(`run-${index}`,`request-${index}`,`response-${index}`,time);
  }
  const selected=await readConversationContext({db:d1,workspaceId:"workspace-1",userId:"user-1",conversationId:"conversation-1",
    requestedOperation:"follow_up",sourceMessageId:"response-26",question:"What should I do next?"});
  assert.equal(selected.turns.length,26);
  assert.equal(selected.turns[0]?.question,"Какой срок действует по договору?");
  assert.equal(selected.turns.at(-1)?.question,"Legacy 26");
});

test("legacy-root regeneration advances versions across sibling and descendant selections", async () => {
  const {sqlite,d1}=await branchDatabase();
  seedInitialBranch(sqlite);
  sqlite.exec("DELETE FROM message_versions; DELETE FROM message_branches;");
  const owner={db:d1,workspaceId:"workspace-1",userId:"user-1",conversationId:"conversation-1"};
  for(const version of [2,3]) {
    const selected=await readConversationContext({...owner,requestedOperation:"regenerate",sourceMessageId:"response-1"});
    assert.equal(selected.branch.versionNumber,version);
    for(const [id,author] of [[`request-${version}`,"user"],[`response-${version}`,"assistant"]]) {
      sqlite.prepare("INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at) VALUES (?,'conversation-1',?,?,'2026-08-01')").run(id,author,"Version content");
    }
    sqlite.prepare(`INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES (?,'conversation-1','workspace-1','user-1',NULL,'response-1',?,?,'regenerate','2026-08-01')`).run(`branch-${version}`,`request-${version}`,`response-${version}`);
    sqlite.prepare(`INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES (?,'conversation-1',?,?,'request-1','user-1','regenerate',?,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-08-01')`).run(`version-${version}`,`branch-${version}`,`request-${version}`,version);
  }
  assert.deepEqual((await listAiAnswerVersions({...owner,branchId:"branch-2"})).map(row=>row.versionNumber),[2,3]);
  const next=await readConversationContext({...owner,requestedOperation:"regenerate",sourceMessageId:"response-2"});
  assert.equal(next.branch.versionNumber,4);
  assert.deepEqual(next.turns,[]);
  sqlite.close();
});

test("legacy conversations without branch rows retain owner-scoped follow-up context", async () => {
  const {sqlite,d1} = await branchDatabase();
  seedInitialBranch(sqlite);
  sqlite.exec("DELETE FROM message_versions; DELETE FROM message_branches;");
  const input = {db:d1,workspaceId:"workspace-1",userId:"user-1",conversationId:"conversation-1",
    requestedOperation:"follow_up",question:"What should I do next?"};
  const selected = await readConversationContext(input);
  assert.deepEqual(selected.turns.map(turn=>turn.question), ["Какой срок действует по договору?"]);
  assert.equal(selected.branch.parentBranchId,null);
  await assert.rejects(readConversationContext({...input,userId:"user-2"}), AiBranchInputError);
  const regenerated=await readConversationContext({...input,requestedOperation:"regenerate",sourceMessageId:"response-1"});
  assert.deepEqual(regenerated.turns,[]);
  assert.equal(regenerated.branch.question,"Какой срок действует по договору?");
  sqlite.exec(`
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at)
      VALUES ('request-next','conversation-1','user','I am the employer.','2026-08-01T00:00:00Z');
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,created_at)
      VALUES ('response-next','conversation-1','assistant','Unverified response.','2026-08-01T00:00:01Z');
    INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES ('branch-next','conversation-1','workspace-1','user-1',NULL,'response-1','request-next','response-next','follow_up','2026-08-01T00:00:02Z');
    INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES ('version-next','conversation-1','branch-next','request-next',NULL,'user-1','follow_up',1,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-08-01T00:00:03Z');
  `);
  const continued=await readConversationContext({...input,sourceMessageId:"response-next"});
  assert.deepEqual(continued.turns.map(turn=>turn.question),["Какой срок действует по договору?","I am the employer."]);
  sqlite.close();
});

test("AI message operations reject impossible new/existing conversation combinations", () => {
  assert.equal(parseAiMessageOperation(undefined, false), "new");
  assert.equal(parseAiMessageOperation(undefined, true), "follow_up");
  assert.throws(() => parseAiMessageOperation("new", true), AiBranchInputError);
  assert.throws(() => parseAiMessageOperation("regenerate", false), AiBranchInputError);
  assert.throws(() => parseAiMessageOperation("delete", true), AiBranchInputError);
});

test("edit and regenerate resolve only tenant-owned source messages", async () => {
  const { sqlite, d1 } = await branchDatabase();
  seedInitialBranch(sqlite);

  const edited = await resolveAiBranchInput({
    db: d1,
    workspaceId: "workspace-1",
    userId: "user-1",
    conversationId: "conversation-1",
    requestedOperation: "edit",
    sourceMessageId: "request-1",
    question: "Исправленный вопрос о сроке договора",
  });
  assert.deepEqual(edited, {
    operation: "edit",
    question: "Исправленный вопрос о сроке договора",
    sourceMessageId: "request-1",
    forkedFromMessageId: "request-1",
    parentBranchId: "branch-1",
    versionNumber: 2,
  });

  const regenerated = await resolveAiBranchInput({
    db: d1,
    workspaceId: "workspace-1",
    userId: "user-1",
    conversationId: "conversation-1",
    requestedOperation: "regenerate",
    sourceMessageId: "response-1",
    question: "Эта строка не должна заменить серверный вопрос",
  });
  assert.equal(regenerated.question, "Какой срок действует по договору?");
  assert.equal(regenerated.sourceMessageId, "request-1");
  assert.equal(regenerated.forkedFromMessageId, "response-1");
  assert.equal(regenerated.parentBranchId, "branch-1");
  assert.equal(regenerated.versionNumber, 2);

  await assert.rejects(
    resolveAiBranchInput({
      db: d1,
      workspaceId: "workspace-2",
      userId: "user-2",
      conversationId: "conversation-2",
      requestedOperation: "edit",
      sourceMessageId: "request-1",
      question: "Попытка чтения чужого сообщения",
    }),
    (error: unknown) => error instanceof AiBranchInputError && error.code === "SOURCE_MESSAGE_NOT_FOUND",
  );

  const branches = await listAiBranches({
    db: d1,
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  });
  assert.equal(branches.length, 1);
  assert.equal(branches[0]?.question, "Какой срок действует по договору?");
});

test("follow-ups can continue the selected branch and expose only its linear turn history", async () => {
  const { sqlite, d1 } = await branchDatabase();
  seedInitialBranch(sqlite);
  sqlite.exec(`
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('request-2','conversation-1','user','Это работодатель.','{}','2026-07-31T00:01:00.000Z');
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('response-2','conversation-1','assistant','Тогда нужно проверить трудовой договор.','{}','2026-07-31T00:01:01.000Z');
    INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES ('branch-2','conversation-1','workspace-1','user-1','branch-1',NULL,'request-2','response-2','follow_up','2026-07-31T00:01:02.000Z');
    INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES ('version-2','conversation-1','branch-2','request-2',NULL,'user-1','follow_up',1,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-07-31T00:01:03.000Z');
  `);

  const selectedFollowUp = await resolveAiBranchInput({
    db: d1,
    workspaceId: "workspace-1",
    userId: "user-1",
    conversationId: "conversation-1",
    requestedOperation: "follow_up",
    sourceMessageId: "response-1",
    question: "А если срок уже прошёл?",
  });
  assert.equal(selectedFollowUp.parentBranchId, "branch-1");
  assert.equal(selectedFollowUp.forkedFromMessageId, "response-1");

  const turns = await loadAiConversationTurns({
    db: d1,
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    leafBranchId: "branch-2",
  });
  assert.deepEqual(turns.map((turn) => turn.branchId), ["branch-1", "branch-2"]);
  assert.deepEqual(turns.map((turn) => turn.question), ["Какой срок действует по договору?", "Это работодатель."]);
  assert.deepEqual((await listAiAnswerVersions({
    db: d1,
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    branchId: "branch-2",
  })).map((branch) => branch.branchId), ["branch-2"]);
  assert.deepEqual(await loadAiConversationTurns({
    db: d1,
    conversationId: "conversation-1",
    workspaceId: "workspace-2",
    userId: "user-2",
    leafBranchId: "branch-2",
  }), []);
});

test("answer versions exclude ordinary follow-up turns", async () => {
  const { sqlite, d1 } = await branchDatabase();
  seedInitialBranch(sqlite);
  sqlite.exec(`
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('request-edit','conversation-1','user','Исправленный вопрос',NULL,'2026-07-31T00:01:00.000Z');
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('response-edit','conversation-1','assistant','Исправленный ответ','{}','2026-07-31T00:01:01.000Z');
    INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES ('branch-edit','conversation-1','workspace-1','user-1','branch-1','request-1','request-edit','response-edit','edit','2026-07-31T00:01:02.000Z');
    INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES ('version-edit','conversation-1','branch-edit','request-edit','request-1','user-1','edit',2,'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','2026-07-31T00:01:03.000Z');
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('request-follow-up','conversation-1','user','Обычное уточнение',NULL,'2026-07-31T00:02:00.000Z');
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('response-follow-up','conversation-1','assistant','Ответ на уточнение','{}','2026-07-31T00:02:01.000Z');
    INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES ('branch-follow-up','conversation-1','workspace-1','user-1','branch-edit',NULL,'request-follow-up','response-follow-up','follow_up','2026-07-31T00:02:02.000Z');
    INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES ('version-follow-up','conversation-1','branch-follow-up','request-follow-up',NULL,'user-1','follow_up',1,'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','2026-07-31T00:02:03.000Z');
  `);

  const versions = await listAiAnswerVersions({
    db: d1,
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    branchId: "branch-edit",
  });
  assert.deepEqual(versions.map((branch) => branch.branchId), ["branch-1", "branch-edit"]);
  assert.deepEqual(versions.map((branch) => branch.versionNumber), [1, 2]);

  const followUpVersions = await listAiAnswerVersions({
    db: d1,
    conversationId: "conversation-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    branchId: "branch-follow-up",
  });
  assert.deepEqual(followUpVersions.map((branch) => branch.branchId), ["branch-follow-up"]);
});

test("conversation deletion is tenant-scoped and waits for active AI runs", async () => {
  const { sqlite, d1 } = await branchDatabase();
  seedInitialBranch(sqlite);
  sqlite.exec(`
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('request-delete-edit','conversation-1','user','Исправленная версия',NULL,'2026-07-31T00:01:00.000Z');
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('response-delete-edit','conversation-1','assistant','Исправленный ответ','{}','2026-07-31T00:01:01.000Z');
    INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES ('branch-delete-edit','conversation-1','workspace-1','user-1','branch-1','request-1','request-delete-edit','response-delete-edit','edit','2026-07-31T00:01:02.000Z');
    INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES ('version-delete-edit','conversation-1','branch-delete-edit','request-delete-edit','request-1','user-1','edit',2,'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd','2026-07-31T00:01:03.000Z');
  `);

  assert.equal(await deleteAiConversation({ db: d1, conversationId: "conversation-1", workspaceId: "workspace-2", userId: "user-2" }), "unavailable");
  assert.ok(sqlite.prepare("SELECT id FROM conversations WHERE id='conversation-1'").get());

  const racingD1 = {
    ...d1,
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      sqlite.prepare("INSERT INTO ai_runs(id,workspace_id,user_id,conversation_id,status) VALUES (?,?,?,?,?)")
        .run("run-active", "workspace-1", "user-1", "conversation-1", "reserved");
      return d1.batch<T>(statements);
    },
  } as D1Database;
  assert.equal(await deleteAiConversation({ db: racingD1, conversationId: "conversation-1", workspaceId: "workspace-1", userId: "user-1" }), "busy");
  assert.ok(sqlite.prepare("SELECT id FROM message_branches WHERE id='branch-1'").get());

  sqlite.prepare("UPDATE ai_runs SET status='completed' WHERE id='run-active'").run();
  assert.equal(await deleteAiConversation({ db: d1, conversationId: "conversation-1", workspaceId: "workspace-1", userId: "user-1" }), "deleted");
  assert.equal(sqlite.prepare("SELECT id FROM conversations WHERE id='conversation-1'").get(), undefined);
  assert.equal(sqlite.prepare("SELECT id FROM conversation_messages WHERE conversation_id='conversation-1'").get(), undefined);
});

test("migration 0039 guards tenant links, hashes, and immutable branch evidence", async () => {
  const { sqlite } = await branchDatabase();
  seedInitialBranch(sqlite);

  assert.throws(() => sqlite.prepare(
    "INSERT INTO message_branches (id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at) VALUES (?,?,?,?,NULL,NULL,?,?,?,?)",
  ).run("branch-cross-tenant", "conversation-1", "workspace-2", "user-2", "request-1", "response-1", "edit", "2026-07-31T00:01:00.000Z"), /MESSAGE_BRANCH_TENANT_MISMATCH/);

  assert.throws(() => sqlite.prepare("UPDATE message_branches SET operation='edit' WHERE id='branch-1'").run(), /MESSAGE_BRANCH_IMMUTABLE/);

  sqlite.prepare("INSERT INTO conversation_messages (id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,?, ?,NULL,?)")
    .run("request-2", "conversation-1", "user", "Новая версия", "2026-07-31T00:02:00.000Z");
  sqlite.prepare("INSERT INTO conversation_messages (id,conversation_id,author_type,content,structured_json,created_at) VALUES (?,?,?, ?,?,?)")
    .run("response-2", "conversation-1", "assistant", "Ответ 2", "{}", "2026-07-31T00:02:01.000Z");
  sqlite.prepare(
    "INSERT INTO message_branches (id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run("branch-2", "conversation-1", "workspace-1", "user-1", "branch-1", "request-1", "request-2", "response-2", "edit", "2026-07-31T00:02:02.000Z");

  assert.throws(() => sqlite.prepare(
    "INSERT INTO message_versions (id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run("version-bad-hash", "conversation-1", "branch-2", "request-2", "request-1", "user-1", "edit", 2, "not-a-sha256", "2026-07-31T00:02:03.000Z"), /MESSAGE_VERSION_HASH_INVALID/);

  assert.throws(() => sqlite.prepare("UPDATE message_versions SET version_number=3 WHERE id='version-1'").run(), /MESSAGE_VERSION_IMMUTABLE/);
});

async function branchDatabase(): Promise<{ sqlite: DatabaseSync; d1: D1Database }> {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
    CREATE TABLE user_profiles (id TEXT PRIMARY KEY);
    CREATE TABLE workspaces (id TEXT PRIMARY KEY);
    CREATE TABLE conversations (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,owner_user_id TEXT NOT NULL,FOREIGN KEY(workspace_id) REFERENCES workspaces(id),FOREIGN KEY(owner_user_id) REFERENCES user_profiles(id));
    CREATE TABLE conversation_messages (id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL,author_type TEXT NOT NULL,content TEXT NOT NULL,structured_json TEXT,created_at TEXT NOT NULL,FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE);
    CREATE TABLE ai_runs (id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,conversation_id TEXT,request_message_id TEXT,response_message_id TEXT,status TEXT NOT NULL,completed_at TEXT);
  `);
  const migration = await readFile(new URL("../drizzle/0039_lame_killer_shrike.sql", import.meta.url), "utf8");
  sqlite.exec(migration);
  sqlite.exec(`
    INSERT INTO user_profiles(id) VALUES ('user-1'),('user-2');
    INSERT INTO workspaces(id) VALUES ('workspace-1'),('workspace-2');
    INSERT INTO conversations(id,workspace_id,owner_user_id) VALUES ('conversation-1','workspace-1','user-1'),('conversation-2','workspace-2','user-2');
  `);
  return { sqlite, d1: sqliteD1(sqlite) };
}

function seedInitialBranch(sqlite: DatabaseSync) {
  sqlite.exec(`
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('request-1','conversation-1','user','Какой срок действует по договору?',NULL,'2026-07-31T00:00:00.000Z');
    INSERT INTO conversation_messages(id,conversation_id,author_type,content,structured_json,created_at)
      VALUES ('response-1','conversation-1','assistant','Структурированный ответ','{}','2026-07-31T00:00:01.000Z');
    INSERT INTO ai_runs(id,workspace_id,user_id,conversation_id,request_message_id,response_message_id,status,completed_at)
      VALUES ('run-1','workspace-1','user-1','conversation-1','request-1','response-1','completed','2026-07-31T00:00:02.000Z');
    INSERT INTO message_branches(id,conversation_id,workspace_id,owner_user_id,parent_branch_id,forked_from_message_id,request_message_id,response_message_id,operation,created_at)
      VALUES ('branch-1','conversation-1','workspace-1','user-1',NULL,NULL,'request-1','response-1','new','2026-07-31T00:00:03.000Z');
    INSERT INTO message_versions(id,conversation_id,branch_id,message_id,source_message_id,created_by_user_id,operation,version_number,content_sha256,created_at)
      VALUES ('version-1','conversation-1','branch-1','request-1',NULL,'user-1','new',1,'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','2026-07-31T00:00:04.000Z');
  `);
}

class SqliteStatement {
  constructor(private readonly sqlite: DatabaseSync, private readonly sql: string, private readonly values: unknown[] = []) {}
  bind(...values: unknown[]) { return new SqliteStatement(this.sqlite, this.sql, values); }
  first<T>(): T | null { return (this.sqlite.prepare(this.sql).get(...this.bindings()) as T | undefined) ?? null; }
  all<T>() { return { results: this.sqlite.prepare(this.sql).all(...this.bindings()) as T[], success: true, meta: {} }; }
  run() { const result = this.sqlite.prepare(this.sql).run(...this.bindings()); return { results: [], success: true, meta: { changes: Number(result.changes) } }; }
  private bindings() { return this.values as Array<null | number | bigint | string>; }
}

function sqliteD1(sqlite: DatabaseSync): D1Database {
  return {
    prepare(sql: string) { return new SqliteStatement(sqlite, sql); },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => (statement as unknown as SqliteStatement).run());
        sqlite.exec("COMMIT");
        // Production D1 batch responses may omit per-statement change counts.
        return results.map((result) => ({ ...result, meta: {} })) as T[];
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
}
