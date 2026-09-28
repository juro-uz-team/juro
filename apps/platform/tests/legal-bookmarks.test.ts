import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  LegalBookmarkError,
  archiveLegalBookmark,
  createLegalBookmark,
  legalBookmarkCreateSchema,
  legalBookmarkUpdateSchema,
  listLegalBookmarks,
  updateLegalBookmark,
} from "../lib/legal/user-bookmarks";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const NOW = "2026-08-04T15:00:00.000Z";
const CASE_A = "11111111-1111-4111-8111-111111111111";
const CASE_A2 = "22222222-2222-4222-8222-222222222222";
const CASE_B = "33333333-3333-4333-8333-333333333333";

test("legal bookmark contracts reject tenant fields and unbounded comments", () => {
  assert.equal(legalBookmarkCreateSchema.safeParse({ sourceId: "source-1", caseId: CASE_A, comment: "Важно" }).success, true);
  assert.equal(legalBookmarkCreateSchema.safeParse({ sourceId: "source-1", caseId: null, comment: "  " }).success, true);
  assert.equal(legalBookmarkCreateSchema.safeParse({ sourceId: "source-1", caseId: CASE_A, comment: "x".repeat(2_001) }).success, false);
  assert.equal(legalBookmarkCreateSchema.safeParse({ sourceId: "source-1", caseId: CASE_A, comment: null, workspaceId: "foreign" }).success, false);
  assert.equal(legalBookmarkUpdateSchema.safeParse({ caseId: CASE_A2, comment: null, revision: 1 }).success, true);
  assert.equal(legalBookmarkUpdateSchema.safeParse({ caseId: "foreign", comment: null, revision: 1 }).success, false);
});

test("verified legal bookmarks are version-pinned, tenant-bound, idempotent and removable", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seedTenants(sqlite);
    seedVerifiedSource(sqlite);

    const created = await createLegalBookmark({
      db: d1, workspaceId: "workspace-a", userId: "user-a", sourceId: "source-legal-001",
      caseId: CASE_A, comment: "Использовать при подготовке претензии.",
      idempotencyKey: "legal-bookmark-create-first-001",
    });
    assert.equal(created.changed, true);
    assert.equal(created.versionId, "source-version-001");
    assert.equal(created.caseId, CASE_A);
    assert.equal(created.revision, 1);

    const replay = await createLegalBookmark({
      db: d1, workspaceId: "workspace-a", userId: "user-a", sourceId: "source-legal-001",
      caseId: CASE_A, comment: "Использовать при подготовке претензии.",
      idempotencyKey: "legal-bookmark-create-first-001",
    });
    assert.equal(replay.replay, true);
    assert.equal(count(sqlite, "user_legal_bookmarks"), 1);
    assert.equal(count(sqlite, "user_legal_bookmark_events"), 1);
    assert.equal(caseEventCount(sqlite, CASE_A, "legal_bookmark_saved"), 1);

    const eventEvidence = sqlite.prepare(
      "SELECT comment_sha256 AS commentSha256,request_hash AS requestHash FROM user_legal_bookmark_events WHERE bookmark_id=?",
    ).get(created.bookmarkId) as { commentSha256: string; requestHash: string };
    assert.match(eventEvidence.commentSha256, /^[0-9a-f]{64}$/);
    assert.match(eventEvidence.requestHash, /^[0-9a-f]{64}$/);
    const audit = sqlite.prepare(
      "SELECT metadata_json AS metadataJson FROM workspace_audit_events WHERE entity_type='legal_bookmark' AND entity_id=?",
    ).get(created.bookmarkId) as { metadataJson: string };
    assert.doesNotMatch(audit.metadataJson, /подготовке|претензии/i);

    const listed = await listLegalBookmarks({ db: d1, workspaceId: "workspace-a", userId: "user-a", caseId: CASE_A });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.comment, "Использовать при подготовке претензии.");
    assert.equal(listed[0]?.isCurrentVersion, true);

    await assert.rejects(
      createLegalBookmark({ db: d1, workspaceId: "workspace-a", userId: "user-a", sourceId: "source-legal-001", caseId: CASE_B, comment: null, idempotencyKey: "legal-bookmark-foreign-case-01" }),
      (error: unknown) => error instanceof LegalBookmarkError && error.code === "CASE_UNAVAILABLE",
    );
    await assert.rejects(
      createLegalBookmark({ db: d1, workspaceId: "workspace-a", userId: "user-a", sourceId: "source-unverified", caseId: null, comment: null, idempotencyKey: "legal-bookmark-unverified-0001" }),
      (error: unknown) => error instanceof LegalBookmarkError && error.code === "SOURCE_UNAVAILABLE",
    );
    await assert.rejects(
      archiveLegalBookmark({ db: d1, workspaceId: "workspace-b", userId: "user-b", bookmarkId: created.bookmarkId, revision: 1, idempotencyKey: "legal-bookmark-idor-archive-01" }),
      (error: unknown) => error instanceof LegalBookmarkError && error.code === "BOOKMARK_UNAVAILABLE",
    );

    const moved = await updateLegalBookmark({
      db: d1, workspaceId: "workspace-a", userId: "user-a", bookmarkId: created.bookmarkId,
      caseId: CASE_A2, comment: "Связать с новым делом.", revision: 1,
      idempotencyKey: "legal-bookmark-update-second-01",
    });
    assert.equal(moved.revision, 2);
    assert.equal(caseEventCount(sqlite, CASE_A, "legal_bookmark_removed"), 1);
    assert.equal(caseEventCount(sqlite, CASE_A2, "legal_bookmark_saved"), 1);
    assert.equal((await listLegalBookmarks({ db: d1, workspaceId: "workspace-a", userId: "user-a", caseId: CASE_A })).length, 0);
    assert.equal((await listLegalBookmarks({ db: d1, workspaceId: "workspace-a", userId: "user-a", caseId: CASE_A2 }))[0]?.comment, "Связать с новым делом.");

    const archived = await archiveLegalBookmark({
      db: d1, workspaceId: "workspace-a", userId: "user-a", bookmarkId: created.bookmarkId,
      revision: 2, idempotencyKey: "legal-bookmark-archive-third-01",
    });
    assert.equal(archived.archived, true);
    assert.equal(archived.revision, 3);
    assert.equal((await listLegalBookmarks({ db: d1, workspaceId: "workspace-a", userId: "user-a" })).length, 0);
    assert.throws(
      () => sqlite.prepare("UPDATE user_legal_bookmark_events SET request_hash=? WHERE bookmark_id=?").run("f".repeat(64), created.bookmarkId),
      /user_legal_bookmark_event_immutable/,
    );
    sqlite.prepare("DELETE FROM user_profiles WHERE id='user-a'").run();
    assert.equal(count(sqlite, "user_legal_bookmarks"), 0);
    assert.equal(count(sqlite, "user_legal_bookmark_events"), 0);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("bookmark routes and RU/UZ controls preserve server scope and user agency", async () => {
  const [collectionRoute, itemRoute, aiClient, caseClient, css] = await Promise.all([
    readFile(new URL("../app/api/platform/legal-bookmarks/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/platform/legal-bookmarks/[bookmarkId]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/AiLawyerClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/CaseWorkspaceClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/ai-evidence.css", import.meta.url), "utf8"),
  ]);
  for (const route of [collectionRoute, itemRoute]) {
    assert.match(route, /requireApiUser\(\)/);
    assert.match(route, /workspaceForUser\(user\)/);
  }
  assert.match(collectionRoute, /assertSafeWrite\(request\)/);
  assert.match(collectionRoute, /idempotency-key/);
  assert.doesNotMatch(collectionRoute, /workspaceId:\s*parsed\.data|userId:\s*parsed\.data/);
  assert.match(itemRoute, /assertSafeWrite\(request\)/);
  assert.match(aiClient, /SourceBookmarkControl/);
  assert.match(aiClient, /Сохранить ответ/);
  assert.match(aiClient, /Javobni saqlash/);
  assert.match(aiClient, /aria-live="polite"/);
  assert.match(caseClient, /CaseSourcesPanel/);
  assert.match(caseClient, /сохранённая историческая версия/);
  assert.match(caseClient, /legal_bookmark_removed/);
  assert.match(css, /min-height:44px/);
  assert.doesNotMatch(aiClient, /dangerouslySetInnerHTML/);
});

function seedTenants(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]) {
  for (const userId of ["user-a", "user-b", "publisher"]) {
    sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES (?,?,?,?)").run(userId, `${userId}@example.test`, NOW, NOW);
  }
  for (const workspaceId of ["workspace-a", "workspace-b"]) {
    sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES (?,?,?,?,?)").run(workspaceId, "individual", workspaceId, NOW, NOW);
  }
  sqlite.prepare("INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES ('member-a','workspace-a','user-a','owner','active',?,?,?)").run(NOW, NOW, NOW);
  sqlite.prepare("INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES ('member-b','workspace-b','user-b','owner','active',?,?,?)").run(NOW, NOW, NOW);
  for (const [caseId, workspaceId, userId] of [[CASE_A, "workspace-a", "user-a"], [CASE_A2, "workspace-a", "user-a"], [CASE_B, "workspace-b", "user-b"]]) {
    sqlite.prepare(`INSERT INTO cases
      (id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,current_revision,created_at,updated_at)
      VALUES (?,?,?,'individual','ru','Test case','contracts','open',1,?,?)`).run(caseId, workspaceId, userId, NOW, NOW);
  }
}

function seedVerifiedSource(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]) {
  const hash = "a".repeat(64);
  sqlite.prepare(`INSERT INTO legal_sources
    (id,canonical_id,official_url,act_title,act_identifier,locale,source_type,status,verification_state,content_sha256,verified_at,verified_by_user_id,last_checked_at,created_at,updated_at)
    VALUES ('source-legal-001','lex:001','https://lex.uz/docs/001','Тестовый действующий акт','№ 001','ru','lex','verified','verified',?,?,?, ?,?,?)`)
    .run(hash, NOW, "publisher", NOW, NOW, NOW);
  sqlite.prepare(`INSERT INTO legal_source_versions
    (id,source_id,language,status,content_sha256,raw_object_key,parsed_object_key,fetched_at,verified_at,verified_by_user_id,metadata_json,created_at,updated_at)
    VALUES ('source-version-001','source-legal-001','ru','verified',?,'legal/raw','legal/parsed',?,?,?,'{}',?,?)`)
    .run(hash, NOW, NOW, "publisher", NOW, NOW);
  sqlite.prepare(`INSERT INTO legal_sources
    (id,official_url,act_title,locale,source_type,status,verification_state,last_checked_at,created_at,updated_at)
    VALUES ('source-unverified','https://lex.uz/docs/draft','Draft','ru','lex','draft','draft',?,?,?)`).run(NOW, NOW, NOW);

  // This fixture tests the bookmark boundary, not the publication workflow;
  // publication/lifecycle guards have their own exhaustive tests.
  sqlite.exec("DROP TRIGGER legal_source_publications_insert_guard");
  sqlite.exec("DROP TRIGGER legal_source_current_activations_insert_guard");
  sqlite.prepare(`INSERT INTO legal_review_queue
    (id,source_id,version_id,reason_code,confidence,status,created_at,updated_at)
    VALUES ('review-001','source-legal-001','source-version-001','fixture','high','pending',?,?)`).run(NOW, NOW);
  sqlite.prepare(`INSERT INTO legal_source_publications
    (id,review_id,source_id,version_id,review_evidence_sha256,raw_content_sha256,parsed_content_sha256,published_by_user_id,publication_evidence_json,publication_evidence_sha256,published_at,created_at)
    VALUES ('publication-001','review-001','source-legal-001','source-version-001',?,?,?,?,? ,?,?,?)`)
    .run(hash, hash, hash, "publisher", "{}", hash, NOW, NOW);
  sqlite.prepare(`INSERT INTO legal_source_current_activations
    (source_id,publication_id,version_id,activated_by_user_id,activated_at,updated_at)
    VALUES ('source-legal-001','publication-001','source-version-001','publisher',?,?)`).run(NOW, NOW);
}

function count(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"], table: string): number {
  return (sqlite.prepare(`SELECT count(*) AS value FROM ${table}`).get() as { value: number }).value;
}

function caseEventCount(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"], caseId: string, eventType: string): number {
  return (sqlite.prepare("SELECT count(*) AS value FROM case_events WHERE case_id=? AND event_type=?").get(caseId, eventType) as { value: number }).value;
}
