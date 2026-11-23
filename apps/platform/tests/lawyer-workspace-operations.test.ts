import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  activeLawyerWorkspaceParticipant,
  hasActiveLawyerDocumentGrant,
  lawyerMessageAttachmentRecipientRole,
} from "../lib/platform/lawyer-workspace-access";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const now = "2026-08-20T12:00:00.000Z";

test("lawyer workspace operations resolve only active, approved handoff participants", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seed(sqlite);
    assert.deepEqual(await activeLawyerWorkspaceParticipant(d1, "lawyer-ops", "request-ops", now), {
      requestId: "request-ops",
      workspaceId: "workspace-owner-ops",
      caseId: "case-ops",
      clientUserId: "owner-ops",
      lawyerProfileId: "profile-ops",
      lawyerUserId: "lawyer-ops",
      clientLocale: "en",
      lawyerLocale: "uz",
      role: "lawyer",
    });
    assert.equal((await activeLawyerWorkspaceParticipant(d1, "owner-ops", "request-ops", now))?.role, "client");
    assert.equal(await activeLawyerWorkspaceParticipant(d1, "outsider-ops", "request-ops", now), null);
    assert.equal(await hasActiveLawyerDocumentGrant(d1, {
      caseId: "case-ops",
      workspaceId: "workspace-owner-ops",
      ownerUserId: "owner-ops",
      lawyerUserId: "lawyer-ops",
      now,
    }), true);
    assert.equal(await hasActiveLawyerDocumentGrant(d1, {
      caseId: "case-ops",
      workspaceId: "workspace-other-ops",
      ownerUserId: "owner-ops",
      lawyerUserId: "lawyer-ops",
      now,
    }), false);
    sqlite.prepare("UPDATE lawyer_access_grants SET revoked_at=? WHERE id='grant-ops'").run(now);
    assert.equal(await activeLawyerWorkspaceParticipant(d1, "lawyer-ops", "request-ops", now), null);
    sqlite.prepare("UPDATE lawyer_access_grants SET revoked_at=NULL,expires_at='2026-08-19T12:00:00.000Z' WHERE id='grant-ops'").run();
    assert.equal(await hasActiveLawyerDocumentGrant(d1, { caseId: "case-ops", workspaceId: "workspace-owner-ops", ownerUserId: "owner-ops", lawyerUserId: "lawyer-ops", now }), false);
  } finally {
    sqlite.close();
  }
});

test("0143 keeps task comments immutable and document requests terminal", () => {
  const { sqlite } = sqliteD1Fixture();
  try {
    seed(sqlite);
    sqlite.prepare(`INSERT INTO tasks
      (id,workspace_id,case_id,owner_user_id,title,status,created_at,updated_at)
      VALUES ('task-ops','workspace-owner-ops','case-ops','lawyer-ops','Review evidence','planned',?,?)`).run(now, now);
    sqlite.prepare(`INSERT INTO lawyer_task_comments
      (id,task_id,author_user_id,body,created_at,updated_at)
      VALUES ('comment-ops','task-ops','lawyer-ops','Client-safe note',?,?)`).run(now, now);
    assert.throws(() => sqlite.prepare("UPDATE lawyer_task_comments SET body='changed' WHERE id='comment-ops'").run(), /immutable/u);
    assert.throws(() => sqlite.prepare("DELETE FROM lawyer_task_comments WHERE id='comment-ops'").run(), /append-only/u);
    sqlite.prepare(`INSERT INTO lawyer_document_requests
      (id,lawyer_request_id,workspace_id,case_id,lawyer_user_id,client_user_id,title,description,status,created_at,updated_at)
      VALUES ('document-request-ops','request-ops','workspace-owner-ops','case-ops','lawyer-ops','owner-ops','Bank statement','Provide the latest statement','requested',?,?)`).run(now, now);
    sqlite.prepare("UPDATE lawyer_document_requests SET status='cancelled',updated_at=? WHERE id='document-request-ops'").run(now);
    assert.throws(() => sqlite.prepare("UPDATE lawyer_document_requests SET status='requested' WHERE id='document-request-ops'").run(), /terminal/u);
    assert.throws(() => sqlite.prepare("DELETE FROM lawyer_document_requests WHERE id='document-request-ops'").run(), /append-only/u);
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("0144 keeps request messages immutable and scopes document delivery to the exact recipient", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  try {
    seed(sqlite);
    sqlite.prepare(`INSERT INTO documents
      (id,workspace_id,case_id,owner_user_id,template_id,template_code,template_version,language,participant_mode,title,category,status,revision,created_at,updated_at)
      VALUES ('lawyer-result-ops','workspace-lawyer-ops',NULL,'lawyer-ops','template-a','1234567','1','ru','configurable','Lawyer result','contracts','Черновик',1,?,?)`).run(now, now);
    sqlite.prepare(`INSERT INTO documents
      (id,workspace_id,case_id,owner_user_id,template_id,template_code,template_version,language,participant_mode,title,category,status,revision,created_at,updated_at)
      VALUES ('client-evidence-ops','workspace-owner-ops','case-ops','owner-ops','template-a','1234567','1','ru','configurable','Client evidence','contracts','Черновик',1,?,?)`).run(now, now);
    sqlite.prepare(`INSERT INTO lawyer_request_messages
      (id,lawyer_request_id,author_user_id,author_role,body,created_at)
      VALUES ('message-lawyer-ops','request-ops','lawyer-ops','lawyer','Result attached',?)`).run(now);
    sqlite.prepare(`INSERT INTO lawyer_request_message_attachments
      (id,message_id,lawyer_request_id,document_id,shared_by_user_id,recipient_user_id,status,created_at,updated_at)
      VALUES ('attachment-lawyer-ops','message-lawyer-ops','request-ops','lawyer-result-ops','lawyer-ops','owner-ops','sent',?,?)`).run(now, now);
    sqlite.prepare(`INSERT INTO lawyer_request_messages
      (id,lawyer_request_id,author_user_id,author_role,body,created_at)
      VALUES ('message-client-ops','request-ops','owner-ops','owner','Evidence attached',?)`).run(now);
    sqlite.prepare(`INSERT INTO lawyer_request_message_attachments
      (id,message_id,lawyer_request_id,document_id,shared_by_user_id,recipient_user_id,status,created_at,updated_at)
      VALUES ('attachment-client-ops','message-client-ops','request-ops','client-evidence-ops','owner-ops','lawyer-ops','sent',?,?)`).run(now, now);

    assert.throws(() => sqlite.prepare(`INSERT INTO lawyer_request_message_attachments
      (id,message_id,lawyer_request_id,document_id,shared_by_user_id,recipient_user_id,status,created_at,updated_at)
      VALUES ('attachment-forged-ops','message-client-ops','request-ops','client-evidence-ops','owner-ops','outsider-ops','sent',?,?)`).run(now, now), /scope is invalid/u);

    assert.equal(await lawyerMessageAttachmentRecipientRole(d1, {
      documentId: "lawyer-result-ops",
      recipientUserId: "owner-ops",
      now,
    }), "client");
    assert.equal(await lawyerMessageAttachmentRecipientRole(d1, {
      documentId: "client-evidence-ops",
      recipientUserId: "lawyer-ops",
      now,
    }), "lawyer");
    assert.equal(await lawyerMessageAttachmentRecipientRole(d1, {
      documentId: "lawyer-result-ops",
      recipientUserId: "outsider-ops",
      now,
    }), null);
    sqlite.prepare("UPDATE lawyer_request_messages SET read_at=? WHERE id='message-lawyer-ops'").run(now);
    assert.throws(() => sqlite.prepare("UPDATE lawyer_request_messages SET read_at=NULL WHERE id='message-lawyer-ops'").run(), /read lawyer request message is terminal/u);
    assert.throws(() => sqlite.prepare("UPDATE lawyer_request_messages SET body='changed' WHERE id='message-lawyer-ops'").run(), /content is immutable/u);
    sqlite.prepare("UPDATE lawyer_request_message_attachments SET status='viewed',updated_at=? WHERE id='attachment-lawyer-ops'").run(now);
    assert.throws(() => sqlite.prepare("UPDATE lawyer_request_message_attachments SET status='sent' WHERE id='attachment-lawyer-ops'").run(), /terminal/u);
    assert.throws(() => sqlite.prepare("DELETE FROM lawyer_request_message_attachments WHERE id='attachment-lawyer-ops'").run(), /append-only/u);
    sqlite.prepare(`INSERT INTO lawyer_request_messages
      (id,lawyer_request_id,author_user_id,author_role,body,created_at)
      VALUES ('message-cascade-ops','request-ops','owner-ops','owner','Cascade-safe evidence',?)`).run(now);
    sqlite.prepare(`INSERT INTO lawyer_request_message_attachments
      (id,message_id,lawyer_request_id,document_id,shared_by_user_id,recipient_user_id,status,created_at,updated_at)
      VALUES ('attachment-cascade-ops','message-cascade-ops','request-ops','client-evidence-ops','owner-ops','lawyer-ops','sent',?,?)`).run(now, now);
    sqlite.prepare("DELETE FROM lawyer_request_messages WHERE id='message-cascade-ops'").run();
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS count FROM lawyer_request_message_attachments WHERE id='attachment-cascade-ops'").get() as { count: number } | undefined)?.count,
      0,
    );
    sqlite.prepare("UPDATE lawyer_access_grants SET revoked_at=? WHERE id='grant-ops'").run(now);
    assert.equal(await lawyerMessageAttachmentRecipientRole(d1, {
      documentId: "client-evidence-ops",
      recipientUserId: "lawyer-ops",
      now,
    }), null);
    assert.equal(await lawyerMessageAttachmentRecipientRole(d1, {
      documentId: "lawyer-result-ops",
      recipientUserId: "owner-ops",
      now,
    }), "client");
    assert.deepEqual(sqlite.prepare("PRAGMA foreign_key_check").all(), []);
  } finally {
    sqlite.close();
  }
});

test("lawyer task and document request routes stay CSRF, grant, tenant and audit scoped", () => {
  const taskRoute = readFileSync(new URL("../app/api/platform/lawyer-tasks/route.ts", import.meta.url), "utf8");
  const documentRoute = readFileSync(new URL("../app/api/platform/lawyer-document-requests/route.ts", import.meta.url), "utf8");
  const messageRoute = readFileSync(new URL("../app/api/platform/lawyer-requests/[requestId]/messages/route.ts", import.meta.url), "utf8");
  const consultationRoute = readFileSync(new URL("../app/api/platform/lawyer-consultations/route.ts", import.meta.url), "utf8");
  const workspaceRoute = readFileSync(new URL("../app/api/platform/lawyer-workspace/route.ts", import.meta.url), "utf8");
  const caseTasksRoute = readFileSync(new URL("../app/api/platform/cases/[caseId]/tasks/route.ts", import.meta.url), "utf8");
  const permissions = readFileSync(new URL("../lib/document-builder/permissions/index.ts", import.meta.url), "utf8");
  for (const route of [taskRoute, documentRoute]) {
    assert.match(route, /assertSafeWrite\(request\)/u);
    assert.match(route, /activeLawyerWorkspaceParticipant/u);
    assert.match(route, /workspace_audit_events/u);
    assert.match(route, /case_events/u);
  }
  assert.match(taskRoute, /owner_user_id=\?/u);
  assert.match(taskRoute, /plan_step_id IS NULL/u);
  assert.match(taskRoute, /lawyer_task_comments/u);
  assert.match(documentRoute, /owner_user_id=\? AND workspace_id=\? AND case_id=\?/u);
  assert.match(documentRoute, /status='provided'/u);
  assert.match(messageRoute, /action === "mark_read"/u);
  assert.match(messageRoute, /lawyer_request_message_attachments/u);
  assert.match(messageRoute, /owner_user_id=\? AND workspace_id=\? AND case_id=\?/u);
  assert.match(messageRoute, /recipient_user_id=\?/u);
  assert.match(messageRoute, /workspace_audit_events/u);
  assert.match(messageRoute, /case_events/u);
  assert.match(consultationRoute, /transition === "start"/u);
  assert.match(consultationRoute, /\? "in_progress"/u);
  assert.match(consultationRoute, /case_events/u);
  assert.match(consultationRoute, /INSERT INTO notifications/u);
  assert.match(workspaceRoute, /CASE WHEN t\.owner_user_id=\? AND t\.plan_step_id IS NULL/u);
  assert.match(workspaceRoute, /lawyer_task_comments/u);
  assert.match(workspaceRoute, /ownDocuments/u);
  assert.match(workspaceRoute, /u\.default_workspace_id=d\.workspace_id/u);
  assert.match(workspaceRoute, /SELECT DISTINCT c\.id/u);
  assert.match(caseTasksRoute, /JOIN tasks t ON t\.id=c\.task_id AND t\.case_id=\? AND t\.workspace_id=\?/u);
  assert.match(caseTasksRoute, /comments: commentsByTask/u);
  assert.match(permissions, /hasActiveLawyerDocumentGrant/u);
  assert.match(permissions, /lawyerMessageAttachmentRecipientRole/u);
  assert.match(permissions, /ROLE_PERMISSIONS\["legal-reviewer"\]/u);
});

test("lawyer workspace UI exposes real task actions, document requests and document review links", () => {
  const workspace = readFileSync(new URL("../app/_platform/LawyerWorkspaceClient.tsx", import.meta.url), "utf8");
  const documentRequests = readFileSync(new URL("../app/_platform/LawyerDocumentRequests.tsx", import.meta.url), "utf8");
  const assigned = readFileSync(new URL("../app/_platform/LawyerRequestsClient.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/_platform/LawyerHandoffClient.tsx", import.meta.url), "utf8");
  const clientCase = readFileSync(new URL("../app/_platform/CaseWorkspaceClient.tsx", import.meta.url), "utf8");
  const messages = readFileSync(new URL("../app/_platform/LawyerRequestMessages.tsx", import.meta.url), "utf8");
  const consultation = readFileSync(new URL("../app/_platform/LawyerConsultationPanel.tsx", import.meta.url), "utf8");
  assert.match(workspace, /action: "create"/u);
  assert.match(workspace, /action: "update"/u);
  assert.match(workspace, /action: "comment"/u);
  assert.match(workspace, /documents\/\$\{encodeURIComponent\(item\.id\)\}/u);
  assert.match(documentRequests, /action: "request"/u);
  assert.match(documentRequests, /action: "provide"/u);
  assert.match(documentRequests, /action: "cancel"/u);
  assert.match(assigned, /role="lawyer"/u);
  assert.match(client, /role="client"/u);
  assert.match(workspace, /<DateTimePicker\b/u);
  assert.match(clientCase, /case-workspace-task-comments/u);
  assert.match(clientCase, /comment\.authorName/u);
  assert.match(messages, /action: "mark_read"/u);
  assert.match(messages, /documentId: documentId \|\| undefined/u);
  assert.match(messages, /message\.readAt/u);
  assert.match(consultation, /action: "start"/u);
  assert.match(workspace, /document-builder/u);
  assert.match(workspace, /data\?\.ownDocuments\.slice\([^)]*\)\.map/u);
  assert.doesNotMatch(workspace, /demo(?:Client|Task|Matter)|fake(?:Client|Task|Matter)/iu);
});

function seed(sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"]): void {
  for (const id of ["owner-ops", "lawyer-ops", "outsider-ops"]) {
    sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES (?,?,?,?)").run(id, `${id}@example.invalid`, now, now);
  }
  sqlite.prepare("UPDATE user_profiles SET locale='en' WHERE id='owner-ops'").run();
  sqlite.prepare("UPDATE user_profiles SET locale='uz' WHERE id='lawyer-ops'").run();
  for (const id of ["workspace-owner-ops", "workspace-lawyer-ops", "workspace-other-ops"]) {
    sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES (?,'individual',?,?,?)").run(id, id, now, now);
  }
  sqlite.prepare("UPDATE user_profiles SET default_workspace_id='workspace-owner-ops' WHERE id='owner-ops'").run();
  sqlite.prepare("UPDATE user_profiles SET default_workspace_id='workspace-lawyer-ops' WHERE id='lawyer-ops'").run();
  sqlite.prepare("UPDATE user_profiles SET default_workspace_id='workspace-other-ops' WHERE id='outsider-ops'").run();
  sqlite.prepare("INSERT INTO document_templates(id,key,category,active,created_at,updated_at) VALUES ('template-a','template-a','contracts',1,?,?)").run(now, now);
  sqlite.prepare(`INSERT INTO cases
    (id,workspace_id,owner_user_id,account_type,locale,title,legal_area,status,current_revision,created_at,updated_at)
    VALUES ('case-ops','workspace-owner-ops','owner-ops','individual','ru','Case','contracts','open',1,?,?)`).run(now, now);
  sqlite.prepare(`INSERT INTO lawyer_profiles
    (id,user_id,display_name,specialties_json,languages_json,status,marketplace_status,public_approved_at,created_at,updated_at)
    VALUES ('profile-ops','lawyer-ops','Lawyer','[]','["ru"]','public_approved','public_approved',?,?,?)`).run(now, now, now);
  sqlite.prepare(`INSERT INTO lawyer_requests
    (id,workspace_id,case_id,requester_user_id,lawyer_profile_id,status,anonymized_summary,requested_scope_json,created_at,updated_at)
    VALUES ('request-ops','workspace-owner-ops','case-ops','owner-ops','profile-ops','access_granted','Anonymized summary','{}',?,?)`).run(now, now);
  sqlite.prepare(`INSERT INTO lawyer_access_grants
    (id,lawyer_request_id,case_id,lawyer_user_id,granted_by_user_id,created_at)
    VALUES ('grant-ops','request-ops','case-ops','lawyer-ops','owner-ops',?)`).run(now);
}
