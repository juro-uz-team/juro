import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { documentVisibilityScope } from "../lib/document-builder/permissions/document-visibility";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const now = "2026-09-01T00:00:00.000Z";

function source(relativePath: string): string {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function seedDocumentVisibility(
  sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"],
): void {
  for (const userId of ["owner", "viewer", "collaborator", "lawyer"]) {
    sqlite.prepare(
      "INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES (?,?,?,?)",
    ).run(userId, `${userId}@example.invalid`, now, now);
  }
  sqlite.prepare(
    "INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES ('workspace','individual','Workspace',?,?)",
  ).run(now, now);
  sqlite.prepare(
    "INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES ('lawyer-workspace','lawyer','Lawyer workspace',?,?)",
  ).run(now, now);
  sqlite.prepare("UPDATE user_profiles SET default_workspace_id='workspace' WHERE id<>'lawyer'").run();
  sqlite.prepare("UPDATE user_profiles SET default_workspace_id='lawyer-workspace' WHERE id='lawyer'").run();
  for (const [userId, role] of [
    ["owner", "owner"],
    ["viewer", "viewer"],
    ["collaborator", "external"],
    ["lawyer", "lawyer"],
  ]) {
    sqlite.prepare(`INSERT INTO workspace_members
      (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
      VALUES (?, 'workspace', ?, ?, 'active', ?, ?, ?)`)
      .run(`member-${userId}`, userId, role, now, now, now);
  }
  sqlite.prepare(`INSERT INTO workspace_members
    (id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
    VALUES ('member-lawyer-own', 'lawyer-workspace', 'lawyer', 'owner', 'active', ?, ?, ?)`)
    .run(now, now, now);
  sqlite.prepare(
    "INSERT INTO document_templates(id,key,category,active,created_at,updated_at) VALUES ('template','template','contracts',1,?,?)",
  ).run(now, now);
  sqlite.prepare(`INSERT INTO cases
    (id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,current_revision,created_at,updated_at)
    VALUES ('case','workspace','owner','individual','ru','Case','contracts','open',1,?,?)`)
    .run(now, now);

  const document = sqlite.prepare(`INSERT INTO documents
    (id,workspace_id,case_id,owner_user_id,template_id,language,participant_mode,title,category,status,revision,created_at,updated_at)
    VALUES (?,'workspace',? ,?,'template','ru','self',?,'contracts','Черновик',1,?,?)`);
  document.run("private", null, "owner", "Private", now, now);
  document.run("shared", null, "owner", "Shared", now, now);
  document.run("no-view", null, "owner", "No view", now, now);
  document.run("invited", null, "owner", "Invited", now, now);
  document.run("granted", "case", "owner", "Granted", now, now);
  sqlite.prepare(`INSERT INTO documents
    (id,workspace_id,case_id,owner_user_id,template_id,language,participant_mode,title,category,status,revision,created_at,updated_at)
    VALUES ('lawyer-result','lawyer-workspace',NULL,'lawyer','template','ru','self','Lawyer result','contracts','Черновик',1,?,?)`)
    .run(now, now);

  const collaborator = sqlite.prepare(`INSERT INTO document_collaborators
    (id,document_id,user_id,invited_by_user_id,role,party_number,
      permission_set_json,invitation_status,approval_status,can_view,can_download,
      status,opened_at,confirmed_at,joined_at,revoked_at,created_at,updated_at)
    VALUES (?,?,?,?, 'viewer',NULL,?,?,?,?,? ,?,NULL,NULL,?,NULL,?,?)`);
  collaborator.run(
    "collaborator-shared", "shared", "collaborator", "owner",
    null, "accepted", "not_required", 1, 0, "active", now, now, now,
  );
  collaborator.run(
    "collaborator-no-view", "no-view", "collaborator", "owner",
    '["add_comment"]', "accepted", "not_required", 1, 0, "active", now, now, now,
  );
  collaborator.run(
    "collaborator-invited", "invited", "collaborator", "owner",
    null, "invited", "pending", 1, 0, "invited", now, now, now,
  );

  sqlite.prepare(`INSERT INTO lawyer_profiles
    (id,user_id,display_name,specialties_json,languages_json,status,marketplace_status,public_approved_at,created_at,updated_at)
    VALUES ('profile','lawyer','Lawyer','[]','["ru"]','public_approved','public_approved',?,?,?)`)
    .run(now, now, now);
  sqlite.prepare(`INSERT INTO lawyer_requests
    (id,workspace_id,case_id,requester_user_id,lawyer_profile_id,status,anonymized_summary,requested_scope_json,created_at,updated_at)
    VALUES ('request','workspace','case','owner','profile','access_granted','Summary','{}',?,?)`)
    .run(now, now);
  sqlite.prepare(`INSERT INTO lawyer_access_grants
    (id,lawyer_request_id,case_id,lawyer_user_id,granted_by_user_id,created_at)
    VALUES ('grant','request','case','lawyer','owner',?)`)
    .run(now);
  sqlite.prepare(`INSERT INTO lawyer_request_messages
    (id,lawyer_request_id,author_user_id,author_role,body,created_at)
    VALUES ('message','request','lawyer','lawyer','Result',?)`)
    .run(now);
  sqlite.prepare(`INSERT INTO lawyer_request_message_attachments
    (id,message_id,lawyer_request_id,document_id,shared_by_user_id,recipient_user_id,status,created_at,updated_at)
    VALUES ('attachment','message','request','lawyer-result','lawyer','owner','sent',?,?)`)
    .run(now, now);
}

function visibleDocumentIds(
  sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"],
  userId: string,
  workspaceId = "workspace",
): string[] {
  const scope = documentVisibilityScope(userId, workspaceId, now);
  return (sqlite.prepare(
    `SELECT d.id FROM documents d WHERE ${scope.sql} ORDER BY d.id`,
  ).all(...scope.bindings) as Array<{ id: string }>).map((row) => row.id);
}

test("document metadata visibility matches owner, collaborator, attachment, and active lawyer grants", () => {
  const { sqlite } = sqliteD1Fixture();
  try {
    seedDocumentVisibility(sqlite);
    assert.deepEqual(visibleDocumentIds(sqlite, "viewer"), []);
    assert.deepEqual(visibleDocumentIds(sqlite, "collaborator"), ["shared"]);
    assert.deepEqual(visibleDocumentIds(sqlite, "owner"), [
      "granted",
      "invited",
      "no-view",
      "private",
      "shared",
    ]);
    assert.deepEqual(visibleDocumentIds(sqlite, "owner", "lawyer-workspace"), ["lawyer-result"]);
    assert.deepEqual(visibleDocumentIds(sqlite, "lawyer"), ["granted"]);
    sqlite.prepare("UPDATE lawyer_access_grants SET revoked_at=? WHERE id='grant'").run(now);
    assert.deepEqual(visibleDocumentIds(sqlite, "lawyer"), []);
  } finally {
    sqlite.close();
  }
});

test("global search keeps document ACLs for recent, exact, and fuzzy queries", () => {
  const route = source("app/api/platform/search/route.ts");
  const query = route.match(/`(SELECT d\.id,d\.title,d\.category[\s\S]*?)`/);
  assert.ok(query);
  assert.match(route, /bind\(\.\.\.documentVisibility\.bindings, searchFlag, like, fuzzyLike\)/);
  const { sqlite } = sqliteD1Fixture();
  try {
    seedDocumentVisibility(sqlite);
    for (const userId of ["viewer", "collaborator"]) {
      const visibility = documentVisibilityScope(userId, "workspace", now);
      const statement = sqlite.prepare(query[1]!
        .replace("${documentVisibility.sql}", visibility.sql)
        .replaceAll("\\\\", "\\"));
      for (const bindings of [[0, "%", "%"], [1, "%Shared%", "%missing%"], [1, "%missing%", "%Shar%"]] as const) {
        const rows = statement.all(...visibility.bindings, ...bindings) as Array<{ id: string }>;
        assert.deepEqual(rows.map((row) => row.id), userId === "collaborator" ? ["shared"] : []);
      }
      assert.deepEqual(statement.all(...visibility.bindings, 1, "%Private%", "%Priv%"), []);
    }
  } finally {
    sqlite.close();
  }
});

test("metadata routes enforce ACLs before counts, ordering, limits, and case-event output", () => {
  const dashboard = source("app/api/platform/dashboard/route.ts");
  const search = source("app/api/platform/search/route.ts");
  const caseWorkspace = source("app/api/platform/cases/[caseId]/workspace/route.ts");
  for (const route of [dashboard, search, caseWorkspace]) {
    assert.match(route, /documentVisibilityScope\(user\.id, workspace\.id\)/);
  }
  assert.match(dashboard, /count\(\*\) FROM documents d WHERE \$\{documentVisibility\.sql\}/);
  assert.match(search, /FROM documents d WHERE \$\{documentVisibility\.sql\}/);
  assert.match(caseWorkspace, /eventDocumentId/);
  assert.match(caseWorkspace, /d\.id=\$\{eventDocumentId\} AND \$\{documentVisibility\.sql\}/);
});

test("consultation reads remain member-visible while booking requires a content editor", () => {
  const route = source("app/api/platform/consultations/route.ts");
  const get = route.slice(route.indexOf("export const GET"), route.indexOf("export const POST"));
  const post = route.slice(route.indexOf("export const POST"));
  assert.match(get, /workspaceForUser\(user\)/);
  assert.doesNotMatch(get, /workspaceForContentEditor\(user\)/);
  assert.match(post, /workspaceForContentEditor\(user\)/);
  assert.doesNotMatch(post, /workspaceForUser\(user\)/);
  assert.ok(post.indexOf("workspaceForContentEditor(user)") < post.indexOf("parseJsonRequest(request"));
});

test("every comparison result surface checks current source scan evidence before use", () => {
  const processRoute = source("app/api/platform/document-comparisons/[comparisonId]/process/route.ts");
  const detailRoute = source("app/api/platform/document-comparisons/[comparisonId]/route.ts");
  const fileRoute = source("app/api/platform/document-comparisons/[comparisonId]/files/[version]/route.ts");
  const decisionRoute = source("app/api/platform/document-comparisons/[comparisonId]/changes/[changeId]/route.ts");
  const exportRoute = source("app/api/platform/document-comparisons/[comparisonId]/export/route.ts");
  const exportDownload = source("app/api/platform/document-comparisons/exports/[exportId]/file/route.ts");
  const exporter = source("lib/document-comparison/exporter.ts");

  assert.ok(processRoute.indexOf("sourceFiles = await assertComparisonSourceFilesClean(db") < processRoute.indexOf('comparison.status === "completed"'));
  assert.ok(detailRoute.indexOf("await assertComparisonSourceFilesClean(db") < detailRoute.indexOf("const changes = await comparisonChanges(db"));
  assert.ok(fileRoute.indexOf("assertStoredComparisonFileIsClean(file)") < fileRoute.indexOf("const object = await getPrivateObject(file.r2Key)"));
  assert.ok(decisionRoute.indexOf("await assertComparisonSourceFilesClean(db") < decisionRoute.indexOf("await decideComparisonChange(db"));
  assert.ok(exportRoute.indexOf("await assertComparisonSourceFilesClean(db") < exportRoute.indexOf("const result = await requestComparisonExport"));
  assert.ok(exportDownload.indexOf("assertComparisonSourceFilesCleanById(db") < exportDownload.indexOf("const object = await verifyComparisonExportObject"));
  assert.ok(exporter.indexOf("await assertComparisonSourceFilesClean(env.DB") < exporter.indexOf('if (row.status === "completed")'));
});

test("alternate metadata routes retain the canonical document ACL boundary", () => {
  const history = source("app/api/platform/history/route.ts");
  const archive = source("app/api/platform/archive/route.ts");
  const lawyerWorkspace = source("app/api/platform/lawyer-workspace/route.ts");

  for (const route of [history, archive]) {
    assert.match(route, /documentVisibilityScope\(user\.id, workspace\.id\)/);
  }
  assert.match(history, /d\.id=\$\{eventDocumentId\} AND \$\{documentVisibility\.sql\}/);
  assert.match(history, /FROM activity_events e JOIN documents d ON d\.id=e\.document_id\s+WHERE \$\{documentVisibility\.sql\}/);
  assert.match(history, /audit_event\.entity_type <> 'document'/);
  assert.match(history, /d\.id=\$\{auditDocumentId\} AND \$\{documentVisibility\.sql\}/);
  assert.doesNotMatch(archive, /c\.status<>'revoked'/);
  assert.match(lawyerWorkspace, /r\.workspace_id=d\.workspace_id AND r\.requester_user_id=d\.owner_user_id/);
});

test("document visibility uses the same newest attachment rule as canonical access", () => {
  const visibility = source("lib/document-builder/permissions/document-visibility.ts");
  const canonical = source("lib/platform/lawyer-workspace-access.ts");
  assert.match(visibility, /attachment\.id = \([\s\S]*latest_attachment\.document_id = d\.id[\s\S]*latest_attachment\.recipient_user_id = \?[\s\S]*ORDER BY latest_attachment\.created_at DESC, latest_attachment\.id DESC[\s\S]*LIMIT 1/);
  assert.match(canonical, /ORDER BY a\.created_at DESC,a\.id DESC LIMIT 1/);
});

test("sandbox payment webhook bounds chunked bodies before signature work", () => {
  const route = source("app/api/webhooks/payment/sandbox/route.ts");
  const bodyGate = route.indexOf("readBoundedRequestBody(request, 8_192)");
  const signature = route.indexOf("if (!await verifySandboxWebhook");
  assert.ok(bodyGate >= 0 && signature > bodyGate);
  assert.doesNotMatch(route, /request\.text\(\)/);
});
