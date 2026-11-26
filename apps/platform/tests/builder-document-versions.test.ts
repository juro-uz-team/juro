import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyProjectedDocumentContentVersion, createDocumentVersion, DocumentVersionError, listDocumentVersions, restoreDocumentVersion } from "../lib/document-builder/document-versions";
import { reconcileBuilderVersionObjectWrites } from "../lib/document-builder/document-version-object-write";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";

const now = "2026-08-05T14:00:00.000Z";
const documentId = "00000000-0000-4000-8000-000000000001";

class FakeR2Bucket {
  readonly objects = new Map<string, { bytes: Uint8Array; sha256: string }>();
  putCalls = 0;
  failPut = false;
  async head(key: string) { const value = this.objects.get(key); return value ? this.metadata(key, value) : null; }
  async get(key: string) {
    const value = this.objects.get(key); if (!value) return null;
    return { ...this.metadata(key, value), body: new ReadableStream(), bodyUsed: false, arrayBuffer: async () => value.bytes.slice().buffer, text: async () => new TextDecoder().decode(value.bytes), json: async () => JSON.parse(new TextDecoder().decode(value.bytes)), blob: async () => new Blob([value.bytes.slice().buffer as ArrayBuffer]) };
  }
  async put(key: string, value: unknown, options?: { onlyIf?: Headers; sha256?: string }) {
    this.putCalls += 1; if (this.failPut) throw new Error("synthetic R2 failure");
    if (options?.onlyIf?.get("if-none-match") === "*" && this.objects.has(key)) return null;
    assert.ok(value instanceof Uint8Array); const bytes = value.slice(); const sha256 = await sha256Hex(bytes); assert.equal(options?.sha256, sha256);
    const stored = { bytes, sha256 }; this.objects.set(key, stored); return this.metadata(key, stored);
  }
  async delete(key: string) { this.objects.delete(key); }
  private metadata(key: string, value: { bytes: Uint8Array; sha256: string }) { return { key, version: "synthetic", size: value.bytes.byteLength, etag: value.sha256, httpEtag: `"${value.sha256}"`, uploaded: new Date(now), httpMetadata: { contentType: "application/json; charset=utf-8" }, customMetadata: {}, range: undefined, checksums: { sha256: hexArrayBuffer(value.sha256) }, storageClass: "Standard", ssecKeyMd5: undefined, writeHttpMetadata() {} }; }
}

test("Builder checkpoints are immutable, owner-scoped, idempotent and restorable", async () => {
  const { sqlite, d1 } = seed(); const bucket = new FakeR2Bucket();
  const base = { db: d1, bucket: bucket as unknown as R2Bucket, documentId, workspaceId: "workspace-a", ownerUserId: "user-a" };
  try {
    const created = await createDocumentVersion({ ...base, revision: 1, idempotencyKey: "builder-version-test-0001" });
    assert.equal(created.replayed, false); assert.equal(created.version.status, "ready"); assert.equal(bucket.putCalls, 1);
    const replay = await createDocumentVersion({ ...base, revision: 1, idempotencyKey: "builder-version-test-0001" });
    assert.equal(replay.replayed, true); assert.equal(replay.version.id, created.version.id); assert.equal(bucket.putCalls, 1);
    assert.equal((await listDocumentVersions({ db: d1, documentId, workspaceId: "workspace-a", ownerUserId: "user-a" })).length, 1);

    sqlite.prepare("UPDATE documents SET title='Changed',revision=2,updated_at=? WHERE id=?").run(now, documentId);
    sqlite.prepare("UPDATE document_current_content SET final_content='Changed legal text',manually_edited=1,updated_at=? WHERE document_id=?").run(now, documentId);
    const restored = await restoreDocumentVersion({ ...base, versionId: created.version.id, revision: 2, idempotencyKey: "builder-restore-test-0001" });
    assert.equal(restored.revision, 3); assert.equal(restored.replayed, false);
    const current = sqlite.prepare("SELECT title,revision FROM documents WHERE id=?").get(documentId) as { title: string; revision: number };
    const content = sqlite.prepare("SELECT final_content AS finalContent FROM document_current_content WHERE document_id=?").get(documentId) as { finalContent: string };
    assert.deepEqual({ ...current }, { title: "Original", revision: 3 }); assert.equal(content.finalContent, "Original legal text");
    const restoreReplay = await restoreDocumentVersion({ ...base, versionId: created.version.id, revision: 2, idempotencyKey: "builder-restore-test-0001" });
    assert.equal(restoreReplay.replayed, true); assert.equal((sqlite.prepare("SELECT count(*) AS total FROM builder_document_version_restore_events").get() as { total: number }).total, 1);
    assert.equal((sqlite.prepare("SELECT source FROM document_revisions WHERE document_id=? AND revision=3").get(documentId) as { source: string }).source, "restore_version");
    const signingCheckpoint = await createDocumentVersion({ ...base, revision: 3, source: "signature", idempotencyKey: "builder-auto-signature-test-0001" });
    assert.equal(signingCheckpoint.version.source, "signature");
    assert.equal(signingCheckpoint.version.documentRevision, 3);
  } finally { sqlite.close(); }
});

test("Builder versions fail closed across tenants and retry R2 with the same key", async () => {
  const { sqlite, d1 } = seed(); const bucket = new FakeR2Bucket(); bucket.failPut = true;
  try {
    await assert.rejects(createDocumentVersion({ db: d1, bucket: bucket as unknown as R2Bucket, documentId, workspaceId: "workspace-b", ownerUserId: "user-b", revision: 1, idempotencyKey: "builder-version-foreign-0001" }), (error: unknown) => error instanceof DocumentVersionError && error.code === "DOCUMENT_NOT_FOUND");
    const input = { db: d1, bucket: bucket as unknown as R2Bucket, documentId, workspaceId: "workspace-a", ownerUserId: "user-a", revision: 1, idempotencyKey: "builder-version-retry-0001" };
    await assert.rejects(createDocumentVersion(input), (error: unknown) => error instanceof DocumentVersionError && error.code === "VERSION_STORAGE_FAILED");
    assert.deepEqual({ ...(sqlite.prepare("SELECT status,attempt_count AS attempts,last_error_code AS code FROM builder_document_versions").get() as object) }, { status: "pending", attempts: 1, code: "R2_WRITE_FAILED" });
    bucket.failPut = false; const retry = await createDocumentVersion(input); assert.equal(retry.replayed, true); assert.equal(retry.version.status, "ready");
  } finally { sqlite.close(); }
});

test("accepted Builder proposal atomically advances content and attaches its projected immutable version", async () => {
  const { sqlite, d1 } = seed(); const bucket = new FakeR2Bucket();
  try {
    sqlite.prepare(
      `INSERT INTO document_change_proposals
       (id,document_id,author_user_id,old_text,new_text,owner_accepted,collaborator_accepted,status,created_at,updated_at)
       VALUES ('proposal-a',?,'user-a','Original','Updated',1,0,'pending',?,?)`,
    ).run(documentId, now, now);
    const input = {
      db: d1,
      bucket: bucket as unknown as R2Bucket,
      documentId,
      workspaceId: "workspace-a",
      ownerUserId: "user-a",
      actorUserId: "user-a",
      revision: 1,
      source: "suggestion" as const,
      sourceEntityId: "proposal-a",
      idempotencyKey: "builder-proposal-apply-proposal-a",
      finalContent: "Updated legal text",
      nextStatus: "Готов",
      revisionSource: "suggestion",
      changes: { proposalId: "proposal-a" },
      mutationStatements: (appliedAt: string) => [d1.prepare(
        `UPDATE document_change_proposals
         SET owner_accepted=1,collaborator_accepted=1,status='applied',updated_at=?
         WHERE id='proposal-a' AND document_id=? AND status='pending'`,
      ).bind(appliedAt, documentId)],
    };
    const applied = await applyProjectedDocumentContentVersion(input);
    assert.equal(applied.replayed, false);
    assert.equal(applied.revision, 2);
    assert.equal(applied.version.source, "suggestion");
    assert.equal(applied.version.status, "ready");
    assert.deepEqual(
      { ...(sqlite.prepare("SELECT revision,status FROM documents WHERE id=?").get(documentId) as object) },
      { revision: 2, status: "Готов" },
    );
    assert.equal((sqlite.prepare("SELECT final_content AS content FROM document_current_content WHERE document_id=?").get(documentId) as { content: string }).content, "Updated legal text");
    assert.deepEqual(
      { ...(sqlite.prepare("SELECT status,owner_accepted AS ownerAccepted,collaborator_accepted AS collaboratorAccepted FROM document_change_proposals WHERE id='proposal-a'").get() as object) },
      { status: "applied", ownerAccepted: 1, collaboratorAccepted: 1 },
    );
    assert.deepEqual(
      { ...(sqlite.prepare("SELECT status,version_id AS versionId FROM builder_document_version_object_writes").get() as object) },
      { status: "attached", versionId: applied.version.id },
    );
    const replay = await applyProjectedDocumentContentVersion(input);
    assert.equal(replay.replayed, true);
    assert.equal(replay.version.id, applied.version.id);
    assert.equal(bucket.putCalls, 1);
  } finally { sqlite.close(); }
});

test("projected Builder mutation remains unchanged on attach conflict and stale orphan is reconciled", async () => {
  const { sqlite, d1 } = seed(); const bucket = new FakeR2Bucket();
  try {
    sqlite.prepare(
      `INSERT INTO document_change_proposals
       (id,document_id,author_user_id,old_text,new_text,owner_accepted,collaborator_accepted,status,created_at,updated_at)
       VALUES ('proposal-b',?,'user-a','Original','Updated',1,0,'pending',?,?)`,
    ).run(documentId, now, now);
    await assert.rejects(
      applyProjectedDocumentContentVersion({
        db: d1,
        bucket: bucket as unknown as R2Bucket,
        documentId,
        workspaceId: "workspace-a",
        ownerUserId: "user-a",
        actorUserId: "user-a",
        revision: 1,
        source: "suggestion",
        sourceEntityId: "proposal-b",
        idempotencyKey: "builder-proposal-attach-conflict-b",
        finalContent: "Updated legal text",
        nextStatus: "Готов",
        revisionSource: "suggestion",
        changes: { proposalId: "proposal-b" },
      }),
      (error: unknown) => error instanceof DocumentVersionError && error.code === "REVISION_CONFLICT",
    );
    assert.equal((sqlite.prepare("SELECT revision FROM documents WHERE id=?").get(documentId) as { revision: number }).revision, 1);
    assert.equal((sqlite.prepare("SELECT final_content AS content FROM document_current_content WHERE document_id=?").get(documentId) as { content: string }).content, "Original legal text");
    assert.deepEqual(
      { ...(sqlite.prepare("SELECT status,attempt_count AS attempts,last_error_code AS code FROM builder_document_version_object_writes").get() as object) },
      { status: "pending", attempts: 1, code: "D1_ATTACH_CONFLICT" },
    );
    const writeUpdatedAt = (sqlite.prepare("SELECT updated_at AS updatedAt FROM builder_document_version_object_writes").get() as { updatedAt: string }).updatedAt;
    const cleanupAt = new Date(Date.parse(writeUpdatedAt) + 20 * 60 * 1_000).toISOString();
    const cleanup = await reconcileBuilderVersionObjectWrites({
      db: d1,
      bucket: bucket as unknown as R2Bucket,
      now: cleanupAt,
      graceMs: 60_000,
    });
    assert.deepEqual(cleanup, { eligible: 1, claimed: 1, attached: 0, deleted: 1, retrying: 0 });
    assert.equal(bucket.objects.size, 0);
    assert.equal((sqlite.prepare("SELECT status FROM builder_document_version_object_writes").get() as { status: string }).status, "deleted");
  } finally { sqlite.close(); }
});

test("Builder version routes and RU/UZ UI retain owner, CSRF and recovery contracts", async () => {
  const root = new URL("../", import.meta.url);
  const [versionsRoute, restoreRoute, component, configured, statusRoute, receiptGenerate, configuredGenerate, collaboration, signedFile, responses] = await Promise.all([
    readFile(new URL("app/api/document-builder/documents/[id]/versions/route.ts", root), "utf8"),
    readFile(new URL("app/api/document-builder/documents/[id]/versions/[versionId]/restore/route.ts", root), "utf8"),
    readFile(new URL("app/_document-builder/_components/BuilderVersionHistory.tsx", root), "utf8"),
    readFile(new URL("app/_document-builder/_components/ConfigurableDocumentBuilder.tsx", root), "utf8"),
    readFile(new URL("app/api/document-builder/documents/[id]/route.ts", root), "utf8"),
    readFile(new URL("app/api/document-builder/documents/[id]/generate/route.ts", root), "utf8"),
    readFile(new URL("app/api/document-builder/configured-documents/[id]/generate/route.ts", root), "utf8"),
    readFile(new URL("app/api/document-builder/documents/[id]/collaboration/route.ts", root), "utf8"),
    readFile(new URL("app/api/document-builder/documents/[id]/signed-file/route.ts", root), "utf8"),
    readFile(new URL("lib/document-builder/auth/responses.ts", root), "utf8"),
  ]);
  for (const route of [versionsRoute, restoreRoute]) {
    assert.match(route, /assertSafeWrite/);
    assert.match(route, /requireApiUser/);
    assert.match(route, /requireOwner/);
    assert.match(route, /idempotency-key/);
  }
  assert.match(component, /Versiyalar tarixi/);
  assert.match(component, /История версий/);
  assert.match(component, /aria-live="polite"/);
  assert.match(component, /<dialog/);
  assert.match(component, /showModal\(\)/);
  assert.match(component, /onCancel=/);
  assert.doesNotMatch(component, /window\.confirm/);
  assert.match(configured, /saveQueue/);
  assert.match(configured, /if \(content === savedContent\.current\) return/);
  assert.ok(statusRoute.indexOf('source: "approval"') < statusRoute.indexOf("SET status = 'Согласован'"));
  assert.ok(statusRoute.indexOf('source: "signature"') < statusRoute.indexOf("SET status = 'Подписан'"));
  for (const route of [receiptGenerate, configuredGenerate]) {
    assert.match(route, /source: "finalize"/);
    const checkpointIndex = route.indexOf('source: "finalize"');
    assert.ok(checkpointIndex < route.indexOf("UPDATE documents SET status = 'Готов'"));
    assert.ok(checkpointIndex < route.indexOf("await Promise.all([", checkpointIndex));
  }
  assert.ok(collaboration.indexOf('source: "approval"') < collaboration.indexOf("INSERT INTO document_approvals"));
  assert.match(collaboration, /applyProjectedDocumentContentVersion/);
  assert.match(collaboration, /source: "suggestion"/);
  assert.doesNotMatch(collaboration, /UPDATE document_current_content SET final_content = \?, manually_edited = 1/);
  assert.ok(signedFile.indexOf('source: "signature"') < signedFile.indexOf("await quarantineScanAndStorePrivateObject"));
  assert.match(signedFile, /quarantineScanAndStorePrivateObject/);
  assert.ok(signedFile.indexOf('source: "signature"') < signedFile.indexOf("SET signed_file_id"));
  assert.match(signedFile, /await bucket\.delete\(key\)\.catch/);
  assert.match(responses, /VERSION_STORAGE_FAILED/);
  assert.match(responses, /Изменение не применено/);
});

function seed() {
  const fixture = sqliteD1Fixture(); const { sqlite } = fixture;
  sqlite.prepare("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES ('user-a','a@example.invalid',?,?),('user-b','b@example.invalid',?,?)").run(now, now, now, now);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,created_at,updated_at) VALUES ('workspace-a','individual','A',?,?),('workspace-b','individual','B',?,?)").run(now, now, now, now);
  sqlite.prepare("INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at) VALUES ('member-a','workspace-a','user-a','owner','active',?,?,?),('member-b','workspace-b','user-b','owner','active',?,?,?)").run(now, now, now, now, now, now);
  sqlite.prepare("INSERT INTO document_templates(id,key,category,active,created_at,updated_at) VALUES ('template-a','template-a','contracts',1,?,?)").run(now, now);
  sqlite.prepare(`INSERT INTO documents (id,workspace_id,owner_user_id,template_id,template_code,template_version,language,participant_mode,title,category,status,revision,created_at,updated_at) VALUES (?,'workspace-a','user-a','template-a','1234567','1','ru','configurable','Original','contracts','Черновик',1,?,?)`).run(documentId, now, now);
  sqlite.prepare("INSERT INTO document_answers(document_id,answers_json,updated_at) VALUES (?,?,?)").run(documentId, JSON.stringify({ "employee.fullName": "Alice", "employer.name": "Acme" }), now);
  sqlite.prepare("INSERT INTO document_current_content(document_id,auto_content,final_content,manually_edited,updated_at) VALUES (?,'Original legal text','Original legal text',0,?)").run(documentId, now);
  return fixture;
}
async function sha256Hex(value: Uint8Array) { const digest = await crypto.subtle.digest("SHA-256", value.slice().buffer); return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
function hexArrayBuffer(value: string) { const bytes = new Uint8Array(value.length / 2); for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16); return bytes.buffer; }
