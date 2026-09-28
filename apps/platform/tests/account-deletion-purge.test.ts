import assert from "node:assert/strict";
import test from "node:test";
import {
  cancelAccountDeletionRequest,
  retryAccountDeletionRequest,
} from "../lib/auth/account-deletion";
import {
  accountDeletionLifecycleStatement,
  accountDeletionSubjectHash,
  createAccountDeletionLifecycleRecord,
  type AccountDeletionMode,
} from "../lib/auth/account-deletion-lifecycle";
import {
  AccountDeletionPurgeError,
  executeAccountDeletionPurge,
} from "../lib/auth/account-deletion-purge";
import {
  expectedQueueName,
  handleQueue,
  type PlatformJobEnv,
} from "../worker/platform-jobs";
import {
  prepareStagingDeletionProbe,
  stagingDeletionProbeObjectKey,
  StagingDeletionProbeError,
} from "../worker/staging-account-deletion-probe";
import { batchBarrier, sqliteD1Fixture } from "./helpers/sqlite-d1";

const USER_ID = "purge-user";
const OTHER_USER_ID = "purge-other-user";
const WORKSPACE_ID = "purge-workspace";
const REQUEST_ID = "purge-request";
const NOW = "2026-07-30T00:00:00.000Z";

function encodedKey(seed: number): string {
  const bytes = Uint8Array.from(
    { length: 32 },
    (_, index) => (seed + index) % 256,
  );
  let raw = "";
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

const RAW_IDENTITY_KEYRING = JSON.stringify({
  active: "v2",
  versions: {
    v1: { aead: encodedKey(1), hmac: encodedKey(33) },
    v2: { aead: encodedKey(65), hmac: encodedKey(97) },
  },
});

class FakeR2Bucket {
  readonly objects = new Set<string>();
  readonly deleted: string[] = [];
  failDelete = false;

  async put(key: string): Promise<void> {
    this.objects.add(key);
  }

  async delete(keys: string | string[]): Promise<void> {
    if (this.failDelete) throw new Error("synthetic R2 failure");
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.deleted.push(key);
      this.objects.delete(key);
    }
  }
}

async function seedRequest(options: {
  deletionMode?: AccountDeletionMode;
  withOtherOwner?: boolean;
  scheduledPurgeAt?: string;
} = {}) {
  const fixture = sqliteD1Fixture();
  const mode = options.deletionMode ?? "recoverable_30d";
  const scheduledPurgeAt = options.scheduledPurgeAt ?? NOW;
  const subject = await accountDeletionSubjectHash(
    RAW_IDENTITY_KEYRING,
    USER_ID,
  );
  fixture.sqlite.prepare(
    `INSERT INTO user_profiles (
       id,email,full_name,pinfl,phone,locale,lifecycle_status,
       created_at,updated_at
     ) VALUES (?,?,?,?,?,'ru','active',?,?)`,
  ).run(
    USER_ID,
    "purge@example.test",
    "Synthetic Purge User",
    "12345678901234",
    "+998900000000",
    NOW,
    NOW,
  );
  fixture.sqlite.prepare(
    `INSERT INTO user_profiles (
       id,email,full_name,locale,lifecycle_status,created_at,updated_at
     ) VALUES (?,?,?,'ru','active',?,?)`,
  ).run(
    OTHER_USER_ID,
    "other@example.test",
    "Synthetic Other User",
    NOW,
    NOW,
  );
  fixture.sqlite.prepare(
    `INSERT INTO workspaces (
       id,type,name,full_name,short_name,locale,created_at,updated_at
     ) VALUES (?,'business','Synthetic Purge Workspace',
       'Synthetic Purge Workspace','Synthetic Purge','ru',?,?)`,
  ).run(WORKSPACE_ID, NOW, NOW);
  fixture.sqlite.prepare(
    `INSERT INTO workspace_members (
       id,workspace_id,user_id,role,status,joined_at,created_at,updated_at
     ) VALUES (?,?,?,'owner','active',?,?,?)`,
  ).run("purge-member", WORKSPACE_ID, USER_ID, NOW, NOW, NOW);
  fixture.sqlite.prepare(
    `INSERT INTO workspace_members (
       id,workspace_id,user_id,role,status,joined_at,created_at,updated_at
     ) VALUES (?,?,?,?, 'active',?,?,?)`,
  ).run(
    "purge-other-member",
    WORKSPACE_ID,
    OTHER_USER_ID,
    options.withOtherOwner === false ? "member" : "owner",
    NOW,
    NOW,
    NOW,
  );
  fixture.sqlite.prepare(
    "UPDATE user_profiles SET default_workspace_id=? WHERE id IN (?,?)",
  ).run(WORKSPACE_ID, USER_ID, OTHER_USER_ID);
  fixture.sqlite.prepare(
    `INSERT INTO account_deletion_requests (
       id,user_id,status,deletion_mode,subject_hash,subject_key_version,
       verification_method,verified_at,requested_at,scheduled_purge_at
     ) VALUES (?,?, 'scheduled',?,?,?,'email_otp',?,?,?)`,
  ).run(
    REQUEST_ID,
    USER_ID,
    mode,
    subject.hash,
    subject.keyVersion,
    NOW,
    NOW,
    scheduledPurgeAt,
  );
  const lifecycleInput = {
    requestId: REQUEST_ID,
    subjectHash: subject.hash,
    subjectKeyVersion: subject.keyVersion,
    eventType: "scheduled" as const,
    deletionMode: mode,
    summary: { scheduledPurgeAt },
    createdAt: NOW,
  };
  const lifecycle = await createAccountDeletionLifecycleRecord(
    fixture.d1,
    lifecycleInput,
  );
  await accountDeletionLifecycleStatement(
    fixture.d1,
    lifecycleInput,
    lifecycle,
  ).run();
  fixture.sqlite.prepare(
    `INSERT INTO job_outbox (
       id,queue_binding,job_type,schema_version,idempotency_key,
       subject_id,workspace_id,correlation_id,enqueued_at,available_at,
       status,dispatch_attempts,created_at,updated_at
     ) VALUES (
       'purge-outbox','DATA_RETENTION_CLEANUP_QUEUE','cleanup.run',1,
       'purge-idempotency',?,NULL,'purge-correlation',?,?,'pending',0,?,?
     )`,
  ).run(REQUEST_ID, NOW, scheduledPurgeAt, NOW, NOW);
  return { ...fixture, subject };
}

function seedContent(
  sqlite: ReturnType<typeof sqliteD1Fixture>["sqlite"],
  bucket: FakeR2Bucket,
): void {
  sqlite.prepare(
    `INSERT INTO document_templates (
       id,key,category,active,created_at,updated_at
     ) VALUES ('purge-template','purge-template','contracts',1,?,?)`,
  ).run(NOW, NOW);
  for (const document of [
    ["purge-document", USER_ID, "Owned document"],
    ["purge-other-document", OTHER_USER_ID, "Other document"],
  ]) {
    sqlite.prepare(
      `INSERT INTO documents (
         id,workspace_id,owner_user_id,template_id,language,
         participant_mode,title,category,status,created_at,updated_at
       ) VALUES (?,?,?,'purge-template','ru','single',?,'contracts','draft',?,?)`,
    ).run(document[0], WORKSPACE_ID, document[1], document[2], NOW, NOW);
  }
  for (const file of [
    ["purge-file", "purge-document", USER_ID, "users/purge/file.pdf"],
    ["purge-other-file", "purge-other-document", OTHER_USER_ID, "users/other/file.pdf"],
  ]) {
    sqlite.prepare(
      `INSERT INTO document_files (
         id,workspace_id,document_id,owner_user_id,kind,r2_key,
         file_name,mime_type,size_bytes,created_at,updated_at
       ) VALUES (?,?,?,?,'original',?,'document.pdf','application/pdf',10,?,?)`,
    ).run(file[0], WORKSPACE_ID, file[1], file[2], file[3], NOW, NOW);
    bucket.objects.add(String(file[3]));
  }
  sqlite.prepare("UPDATE document_files SET kind='analysis_safe',sha256=? WHERE id='purge-file'")
    .run("e".repeat(64));
  sqlite.prepare(
    `INSERT INTO document_comparisons (
       id,workspace_id,owner_user_id,version_one_file_id,
       version_two_file_id,status,stage,locale,version_one_json_key,
       version_two_json_key,created_at,updated_at
     ) VALUES (
       'purge-comparison',?,?, 'purge-file','purge-other-file',
       'completed','completed','ru','comparisons/purge/one.json',
       'comparisons/purge/two.json',?,?
     )`,
  ).run(WORKSPACE_ID, OTHER_USER_ID, NOW, NOW);
  bucket.objects.add("comparisons/purge/one.json");
  bucket.objects.add("comparisons/purge/two.json");
  sqlite.prepare(
    `INSERT INTO document_analyses (
       id,workspace_id,owner_user_id,uploaded_file_id,status,summary_json,
       error_code,consent_version,created_at,updated_at
     ) VALUES ('purge-analysis',?,?, 'purge-file','completed','{}',NULL,'2026-07-31',?,?)`,
  ).run(WORKSPACE_ID, USER_ID, NOW, NOW);
  sqlite.prepare(
    `INSERT INTO file_extractions (
       id,analysis_id,file_id,workspace_id,owner_user_id,status,method,provider,model,
       source_sha256,r2_key,text_sha256,size_bytes,token_estimate,detected_mime_type,
       detected_language,text_quality,warnings_json,error_code,completed_at,created_at,updated_at
     ) VALUES ('purge-extraction','purge-analysis','purge-file',?,?,'completed',
       'workers_ai_markdown','cloudflare_workers_ai','to-markdown',?,
       'derivatives/purge-workspace/purge-analysis/purge-file.json',?,2,1,
       'application/pdf','ru','good','[]',NULL,?,?,?)`,
  ).run(WORKSPACE_ID, USER_ID, "e".repeat(64), "f".repeat(64), NOW, NOW, NOW);
  bucket.objects.add("derivatives/purge-workspace/purge-analysis/purge-file.json");
  sqlite.prepare(
    `INSERT INTO analysis_document_versions (
       id,analysis_id,workspace_id,owner_user_id,version,parent_version_id,
       source_kind,r2_key,file_name,mime_type,size_bytes,sha256,
       idempotency_key,selection_sha256,revision_ids_json,created_by_user_id,created_at
     ) VALUES ('purge-analysis-version','purge-analysis',?,?,1,NULL,'extracted',
       'analysis-versions/purge-workspace/purge-analysis/1-source.md',
       'document-v1.md','text/markdown; charset=utf-8',2,?,NULL,NULL,'[]',NULL,?)`,
  ).run(WORKSPACE_ID, USER_ID, "a".repeat(64), NOW);
  bucket.objects.add("analysis-versions/purge-workspace/purge-analysis/1-source.md");
  sqlite.prepare(
    `INSERT INTO analysis_version_object_writes (
       id,analysis_id,workspace_id,owner_user_id,target_version,source_kind,r2_key,
       size_bytes,sha256,status,version_id,attempt_count,last_error_code,created_at,updated_at,reconciled_at
      ) VALUES ('purge-pending-write','purge-analysis',?,?,2,'corrected',
        'analysis-versions/purge-workspace/purge-analysis/purge-pending-write-2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md',
        2,?,'pending',NULL,0,NULL,?,?,NULL)`,
    ).run(WORKSPACE_ID, USER_ID, "b".repeat(64), NOW, NOW);
  bucket.objects.add("analysis-versions/purge-workspace/purge-analysis/purge-pending-write-2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md");
  assert.equal(
    (sqlite.prepare("SELECT count(*) AS total FROM file_extractions WHERE owner_user_id=?").get(USER_ID) as { total: number }).total,
    1,
  );
  sqlite.prepare(
    `INSERT INTO analysis_exports (
       id,analysis_id,workspace_id,owner_user_id,format,status,r2_key,
       file_name,mime_type,size_bytes,sha256,idempotency_key,error_code,
       completed_at,created_at,updated_at
     ) VALUES ('purge-export','purge-analysis',?,?,'json','completed',
       'exports/purge-workspace/purge-analysis/purge-export.json',
       'analysis-purge-export.json','application/json',2,?,
       'purge-export-idempotency',NULL,?,?,?)`,
  ).run(WORKSPACE_ID, USER_ID, "c".repeat(64), NOW, NOW, NOW);
  bucket.objects.add("exports/purge-workspace/purge-analysis/purge-export.json");
  sqlite.prepare(
    `INSERT INTO analysis_report_exports (
       id,analysis_id,workspace_id,owner_user_id,format,status,r2_key,
       file_name,mime_type,size_bytes,sha256,idempotency_key,error_code,
       completed_at,created_at,updated_at
     ) VALUES ('purge-report-export','purge-analysis',?,?,'pdf','completed',
       'exports/purge-workspace/purge-analysis/purge-report-export.pdf',
       'analysis-purge-report.pdf','application/pdf',1200,?,
       'purge-report-export-idempotency',NULL,?,?,?)`,
  ).run(WORKSPACE_ID, USER_ID, "d".repeat(64), NOW, NOW, NOW);
  bucket.objects.add("exports/purge-workspace/purge-analysis/purge-report-export.pdf");
  sqlite.prepare(
    `INSERT INTO comparison_exports (
       id,comparison_id,workspace_id,owner_user_id,format,status,r2_key,
       file_name,mime_type,size_bytes,sha256,idempotency_key,error_code,
       completed_at,created_at,updated_at
     ) VALUES ('purge-comparison-export','purge-comparison',?,?,'docx','completed',
       'comparison-exports/purge-workspace/purge-comparison/purge-comparison-export.docx',
       'juro-comparison.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document',1200,?,
       'purge-comparison-export-idempotency',NULL,?,?,?)`,
  ).run(WORKSPACE_ID, OTHER_USER_ID, "e".repeat(64), NOW, NOW, NOW);
  bucket.objects.add("comparison-exports/purge-workspace/purge-comparison/purge-comparison-export.docx");
  sqlite.prepare(
    `INSERT INTO document_comments (
       id,document_id,author_user_id,body,created_at,updated_at
     ) VALUES ('purge-comment','purge-other-document',?,'Sensitive comment',?,?)`,
  ).run(USER_ID, NOW, NOW);
  sqlite.prepare(
    `INSERT INTO contacts (
       id,owner_user_id,label,full_name,created_at,updated_at
     ) VALUES ('purge-contact',?,'Counterparty','Sensitive person',?,?)`,
  ).run(USER_ID, NOW, NOW);
  sqlite.prepare(
    `INSERT INTO user_memory_settings (
       user_id,automatic_enabled,created_at,updated_at
     ) VALUES (?,1,?,?)`,
  ).run(USER_ID, NOW, NOW);
  sqlite.prepare(
    `INSERT INTO user_memories (
       id,user_id,workspace_id,scope,scope_key,category,ciphertext,iv,
       key_version,content_sha256,source_kind,status,created_at,updated_at
     ) VALUES ('purge-memory',?,?,'workspace',?,'legal_context',
       'encrypted-memory','memory-iv','v2',?,'manual','active',?,?)`,
  ).run(USER_ID, WORKSPACE_ID, `workspace:${WORKSPACE_ID}`, "9".repeat(64), NOW, NOW);
  sqlite.prepare(
    `INSERT INTO memory_sources (
       id,memory_id,source_type,source_ref,created_at
     ) VALUES ('purge-memory-source','purge-memory','manual','settings',?)`,
  ).run(NOW);
  sqlite.prepare(
    `INSERT INTO consents (
       id,user_id,workspace_id,type,version,scope_json,granted_at
     ) VALUES ('purge-consent',?,?,'privacy','1','{}',?)`,
  ).run(USER_ID, WORKSPACE_ID, NOW);
  sqlite.prepare(
    `INSERT INTO user_acceptances (
       id,user_id,document_key,document_version,locale,
       content_sha256,acceptance_method,auth_source,evidence_json,accepted_at
     ) VALUES ('purge-acceptance',?,'privacy','1','ru',?,
       'email_otp','local_session','{}',?)`,
  ).run(USER_ID, "a".repeat(64), NOW);
  sqlite.prepare(
    `INSERT INTO security_events (
       id,user_id,event_type,severity,previous_hash,event_hash,created_at
     ) VALUES ('purge-security',?,'account.deletion_requested','critical',?,?,?)`,
  ).run(USER_ID, "0".repeat(64), "b".repeat(64), NOW);
  sqlite.prepare(
    `INSERT INTO workspace_audit_events (
       id,workspace_id,actor_user_id,entity_type,entity_id,action,
       metadata_json,created_at
     ) VALUES ('purge-audit',?,?,'user',?,'account_deletion_requested','{}',?)`,
  ).run(WORKSPACE_ID, USER_ID, USER_ID, NOW);
}

function purgeEnv(
  d1: D1Database,
  bucket: FakeR2Bucket,
): Parameters<typeof executeAccountDeletionPurge>[0] {
  return {
    DB: d1,
    BUCKET: bucket as unknown as R2Bucket,
    ACCOUNT_DELETION_PURGE_ENABLED: "true",
    IDENTITY_KEYRING: RAW_IDENTITY_KEYRING,
  };
}

test("purge removes the closing lawyer's profile photo and keeps another lawyer's photo", async () => {
  const { sqlite, d1 } = await seedRequest();
  const bucket = new FakeR2Bucket();
  try {
    for (const [user, key] of [[USER_ID, "lawyer-photos/closing.jpg"], [OTHER_USER_ID, "lawyer-photos/other.jpg"]]) {
      sqlite.prepare(`INSERT INTO lawyer_profiles(id,user_id,display_name,profile_photo_key,created_at,updated_at)
        VALUES (?,?,?,?,?,?)`).run(`profile-${user}`, user, "Synthetic lawyer", key, NOW, NOW);
      bucket.objects.add(key);
    }
    const result = await executeAccountDeletionPurge(purgeEnv(d1, bucket), REQUEST_ID, { now: () => new Date(NOW) });
    assert.equal(result.status, "completed");
    assert.equal(result.r2DeletedCount, 1);
    assert.deepEqual(bucket.deleted, ["lawyer-photos/closing.jpg"]);
    assert.equal(bucket.objects.has("lawyer-photos/other.jpg"), true);
  } finally {
    sqlite.close();
  }
});

test("purge removes D1/R2 content, redacts shared comments, and retains immutable evidence", async () => {
  const { sqlite, d1 } = await seedRequest();
  const bucket = new FakeR2Bucket();
  try {
    seedContent(sqlite, bucket);
    const result = await executeAccountDeletionPurge(
      purgeEnv(d1, bucket),
      REQUEST_ID,
      { now: () => new Date(NOW) },
    );
    assert.deepEqual(result, {
      status: "completed",
      requestId: REQUEST_ID,
      r2DeletedCount: 9,
    });
    assert.deepEqual(bucket.deleted.sort(), [
      "analysis-versions/purge-workspace/purge-analysis/1-source.md",
      "analysis-versions/purge-workspace/purge-analysis/purge-pending-write-2-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md",
      "comparison-exports/purge-workspace/purge-comparison/purge-comparison-export.docx",
      "comparisons/purge/one.json",
      "comparisons/purge/two.json",
      "derivatives/purge-workspace/purge-analysis/purge-file.json",
      "exports/purge-workspace/purge-analysis/purge-export.json",
      "exports/purge-workspace/purge-analysis/purge-report-export.pdf",
      "users/purge/file.pdf",
    ]);
    assert.equal(bucket.objects.has("users/other/file.pdf"), true);
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM documents WHERE owner_user_id=?").get(USER_ID) as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM document_comparisons WHERE id='purge-comparison'").get() as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM file_extractions WHERE id='purge-extraction'").get() as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM analysis_exports WHERE id='purge-export'").get() as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM analysis_report_exports WHERE id='purge-report-export'").get() as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM comparison_exports WHERE id='purge-comparison-export'").get() as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM analysis_document_versions WHERE id='purge-analysis-version'").get() as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM contacts WHERE owner_user_id=?").get(USER_ID) as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM user_memories WHERE user_id=?").get(USER_ID) as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM user_memory_settings WHERE user_id=?").get(USER_ID) as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM memory_sources WHERE id='purge-memory-source'").get() as { total: number }).total,
      0,
    );
    assert.equal(
      (sqlite.prepare("SELECT body FROM document_comments WHERE id='purge-comment'").get() as { body: string }).body,
      "[deleted by account closure]",
    );
    const profile = sqlite.prepare(
      `SELECT email,full_name AS fullName,pinfl,phone,
         lifecycle_status AS lifecycleStatus,
         deletion_completed_at AS deletionCompletedAt
       FROM user_profiles WHERE id=?`,
    ).get(USER_ID) as Record<string, unknown>;
    assert.match(String(profile.email), /^deleted\.[a-f0-9]{32}@invalid\.juro$/);
    assert.equal(profile.fullName, null);
    assert.equal(profile.pinfl, null);
    assert.equal(profile.phone, null);
    assert.equal(profile.lifecycleStatus, "deleted");
    assert.equal(profile.deletionCompletedAt, NOW);
    for (const table of ["consents", "user_acceptances", "security_events", "workspace_audit_events"]) {
      assert.equal(
        (sqlite.prepare(`SELECT count(*) AS total FROM ${table} WHERE ${table === "workspace_audit_events" ? "actor_user_id" : "user_id"}=?`).get(USER_ID) as { total: number }).total,
        1,
      );
    }
    const evidence = sqlite.prepare(
      `SELECT subject_hash AS subjectHash,r2_deleted_count AS r2DeletedCount,
         redacted_count AS redactedCount,evidence_hash AS evidenceHash
       FROM account_deletion_purge_evidence WHERE request_id=?`,
    ).get(REQUEST_ID) as {
      subjectHash: string;
      r2DeletedCount: number;
      redactedCount: number;
      evidenceHash: string;
    };
    assert.match(evidence.subjectHash, /^[a-f0-9]{64}$/);
    assert.equal(evidence.r2DeletedCount, 9);
    assert.equal(evidence.redactedCount, 1);
    assert.match(evidence.evidenceHash, /^[a-f0-9]{64}$/);
    const lifecycleRows = sqlite.prepare(
      `SELECT event_type AS eventType,previous_hash AS previousHash,
         event_hash AS eventHash
       FROM account_deletion_lifecycle_events WHERE request_id=?`,
    ).all(REQUEST_ID) as Array<{
      eventType: string;
      previousHash: string;
      eventHash: string;
    }>;
    const lifecycleOrder: string[] = [];
    let previousHash = "0".repeat(64);
    while (lifecycleOrder.length < lifecycleRows.length) {
      const next = lifecycleRows.find(row => row.previousHash === previousHash);
      assert.ok(next, "lifecycle hash chain must remain connected");
      lifecycleOrder.push(next.eventType);
      previousHash = next.eventHash;
    }
    assert.deepEqual(lifecycleOrder, ["scheduled", "purge_started", "completed"]);
    assert.throws(
      () => sqlite.prepare(
        "UPDATE account_deletion_purge_evidence SET redacted_count=0 WHERE request_id=?",
      ).run(REQUEST_ID),
      /APPEND_ONLY_ACCOUNT_DELETION_PURGE_EVIDENCE/,
    );
    assert.throws(
      () => sqlite.prepare(
        "DELETE FROM account_deletion_lifecycle_events WHERE request_id=?",
      ).run(REQUEST_ID),
      /APPEND_ONLY_ACCOUNT_DELETION_LIFECYCLE/,
    );
    assert.deepEqual(
      await executeAccountDeletionPurge(
        purgeEnv(d1, bucket),
        REQUEST_ID,
        { now: () => new Date("2026-07-30T00:01:00.000Z") },
      ),
      { status: "already_completed", requestId: REQUEST_ID },
    );
  } finally {
    sqlite.close();
  }
});

test("cleanup queue executes the real purge and completes durable job evidence", async () => {
  const { sqlite, d1 } = await seedRequest({
    scheduledPurgeAt: "2000-01-01T00:00:00.000Z",
  });
  const bucket = new FakeR2Bucket();
  try {
    seedContent(sqlite, bucket);
    let acknowledgements = 0;
    let retries = 0;
    const message = {
      id: "purge-queue-message",
      timestamp: new Date(NOW),
      attempts: 1,
      body: {
        schemaVersion: 1,
        jobId: "purge-queue-job",
        kind: "cleanup.run",
        idempotencyKey: "purge-queue-idempotency",
        subjectId: REQUEST_ID,
        correlationId: "purge-queue-correlation",
        enqueuedAt: NOW,
      },
      ack() { acknowledgements += 1; },
      retry() { retries += 1; },
    } as unknown as Message<unknown>;
    const batch = {
      queue: expectedQueueName("cleanup.run", "development"),
      messages: [message],
      ackAll() {},
      retryAll() { retries += 1; },
    } as unknown as MessageBatch<unknown>;
    const env = {
      DB: d1,
      BUCKET: bucket,
      APP_ENV: "development",
      ASYNC_RUNTIME_ENABLED: "true",
      CRON_ENABLED: "false",
      ACCOUNT_DELETION_PURGE_ENABLED: "true",
      LEGAL_ADVICE_INGESTION_ENABLED: "false",
      JOB_SCHEMA_VERSION: "1",
      IDENTITY_KEYRING: RAW_IDENTITY_KEYRING,
      PLATFORM_ANALYTICS: { writeDataPoint() {} },
    } as unknown as PlatformJobEnv;

    await handleQueue(batch, env);
    assert.equal(acknowledgements, 1);
    assert.equal(retries, 0);
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT status,error_code AS errorCode
        FROM job_runs WHERE idempotency_key='purge-queue-idempotency'
      `).get() },
      { status: "completed", errorCode: null },
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT status FROM account_deletion_requests WHERE id=?",
      ).get(REQUEST_ID) as { status: string }).status,
      "completed",
    );
  } finally {
    sqlite.close();
  }
});
test("staging-only cleanup probe creates secret-derived evidence and purges D1/R2", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const bucket = new FakeR2Bucket();
  const requestId = "staging-probe-20260730-queue-runtime";
  let acknowledgements = 0;
  let retries = 0;
  try {
    const message = {
      id: "staging-probe-message",
      timestamp: new Date(NOW),
      attempts: 1,
      body: {
        schemaVersion: 1,
        jobId: "staging-probe-job",
        kind: "cleanup.run",
        idempotencyKey: "staging-probe-idempotency",
        subjectId: requestId,
        correlationId: "staging-probe-correlation",
        enqueuedAt: NOW,
      },
      ack() { acknowledgements += 1; },
      retry() { retries += 1; },
    } as unknown as Message<unknown>;
    const batch = {
      queue: expectedQueueName("cleanup.run", "staging"),
      messages: [message],
      ackAll() {},
      retryAll() { retries += 1; },
    } as unknown as MessageBatch<unknown>;
    const env = {
      DB: d1,
      BUCKET: bucket,
      APP_ENV: "staging",
      ASYNC_RUNTIME_ENABLED: "true",
      CRON_ENABLED: "true",
      ACCOUNT_DELETION_PURGE_ENABLED: "true",
      STAGING_SYNTHETIC_PROBES_ENABLED: "true",
      LEGAL_ADVICE_INGESTION_ENABLED: "false",
      JOB_SCHEMA_VERSION: "1",
      IDENTITY_KEYRING: RAW_IDENTITY_KEYRING,
      PLATFORM_ANALYTICS: { writeDataPoint() {} },
    } as unknown as PlatformJobEnv;

    await handleQueue(batch, env);

    assert.equal(acknowledgements, 1);
    assert.equal(retries, 0);
    assert.equal(
      bucket.objects.has(stagingDeletionProbeObjectKey(requestId)),
      false,
    );
    assert.deepEqual(
      { ...sqlite.prepare(`
        SELECT request.status,evidence.r2_deleted_count AS r2DeletedCount,
          profile.lifecycle_status AS lifecycleStatus
        FROM account_deletion_requests request
        JOIN account_deletion_purge_evidence evidence ON evidence.request_id=request.id
        JOIN user_profiles profile ON profile.id=request.user_id
        WHERE request.id=?
      `).get(requestId) },
      { status: "completed", r2DeletedCount: 1, lifecycleStatus: "deleted" },
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM account_deletion_lifecycle_events WHERE request_id=?",
      ).get(requestId) as { total: number }).total,
      3,
    );
  } finally {
    sqlite.close();
  }
});
test("synthetic deletion probe fails closed outside explicitly enabled staging", async () => {
  const { sqlite, d1 } = sqliteD1Fixture();
  const bucket = new FakeR2Bucket();
  const requestId = "staging-probe-production-denied";
  try {
    await assert.rejects(
      prepareStagingDeletionProbe({
        APP_ENV: "production",
        DB: d1,
        BUCKET: bucket as unknown as R2Bucket,
        IDENTITY_KEYRING: RAW_IDENTITY_KEYRING,
        STAGING_SYNTHETIC_PROBES_ENABLED: "true",
      }, requestId, NOW),
      (error: unknown) => error instanceof StagingDeletionProbeError
        && error.code === "STAGING_SYNTHETIC_PROBE_DISABLED",
    );
    assert.equal(bucket.objects.size, 0);
    assert.equal(
      (sqlite.prepare(
        "SELECT count(*) AS total FROM account_deletion_requests WHERE id=?",
      ).get(requestId) as { total: number }).total,
      0,
    );
  } finally {
    sqlite.close();
  }
});
test("recoverable deletion cancellation is atomic and terminal for its outbox row", async () => {
  const { sqlite, d1 } = await seedRequest({
    scheduledPurgeAt: "2026-08-29T00:00:00.000Z",
  });
  try {
    const result = await cancelAccountDeletionRequest(d1, {
      requestId: REQUEST_ID,
      userId: USER_ID,
      sessionId: "fresh-session",
      workspaceId: WORKSPACE_ID,
      identityKeyring: RAW_IDENTITY_KEYRING,
      assuranceLevel: "primary",
      now: "2026-07-30T00:05:00.000Z",
    });
    assert.deepEqual(result, { status: "cancelled", requestId: REQUEST_ID });
    assert.equal(
      (sqlite.prepare("SELECT status FROM account_deletion_requests WHERE id=?").get(REQUEST_ID) as { status: string }).status,
      "cancelled",
    );
    assert.deepEqual(
      { ...sqlite.prepare("SELECT status,error_code AS errorCode FROM job_outbox WHERE subject_id=?").get(REQUEST_ID) },
      { status: "rejected", errorCode: "ACCOUNT_DELETION_CANCELLED" },
    );
    assert.deepEqual(
      await executeAccountDeletionPurge(
        purgeEnv(d1, new FakeR2Bucket()),
        REQUEST_ID,
        { now: () => new Date("2026-08-30T00:00:00.000Z") },
      ),
      { status: "cancelled", requestId: REQUEST_ID },
    );
    assert.deepEqual(
      await cancelAccountDeletionRequest(d1, {
        requestId: REQUEST_ID,
        userId: USER_ID,
        sessionId: "fresh-session",
        workspaceId: WORKSPACE_ID,
        identityKeyring: RAW_IDENTITY_KEYRING,
        assuranceLevel: "primary",
        now: "2026-07-30T00:06:00.000Z",
      }),
      { status: "already_cancelled" },
    );
  } finally {
    sqlite.close();
  }
});

test("recoverable deletion cannot be cancelled after its irreversible boundary", async () => {
  const { sqlite, d1 } = await seedRequest({
    scheduledPurgeAt: "2026-08-29T00:00:00.000Z",
  });
  try {
    sqlite.prepare(
      "UPDATE account_deletion_requests SET purge_irreversible_at=? WHERE id=?",
    ).run("2026-08-29T00:00:01.000Z", REQUEST_ID);
    assert.deepEqual(
      await cancelAccountDeletionRequest(d1, {
        requestId: REQUEST_ID,
        userId: USER_ID,
        sessionId: "fresh-session",
        workspaceId: WORKSPACE_ID,
        identityKeyring: RAW_IDENTITY_KEYRING,
        assuranceLevel: "primary",
        now: "2026-08-29T00:00:02.000Z",
      }),
      { status: "not_cancelable" },
    );
    assert.equal(
      (sqlite.prepare(
        "SELECT status FROM account_deletion_requests WHERE id=?",
      ).get(REQUEST_ID) as { status: string }).status,
      "scheduled",
    );
  } finally {
    sqlite.close();
  }
});
test("R2 failure preserves D1 and releases the purge lease for a real retry", async () => {
  const { sqlite, d1 } = await seedRequest();
  const bucket = new FakeR2Bucket();
  try {
    seedContent(sqlite, bucket);
    bucket.failDelete = true;
    await assert.rejects(
      executeAccountDeletionPurge(
        purgeEnv(d1, bucket),
        REQUEST_ID,
        { now: () => new Date(NOW) },
      ),
      (error: unknown) =>
        error instanceof AccountDeletionPurgeError
        && error.code === "ACCOUNT_DELETION_R2_FAILED"
        && error.retryable,
    );
    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT status,failure_code AS failureCode,
           purge_lease_owner AS leaseOwner
         FROM account_deletion_requests WHERE id=?`,
      ).get(REQUEST_ID) },
      {
        status: "scheduled",
        failureCode: "ACCOUNT_DELETION_R2_FAILED",
        leaseOwner: null,
      },
    );
    assert.equal(
      (sqlite.prepare("SELECT count(*) AS total FROM documents WHERE owner_user_id=?").get(USER_ID) as { total: number }).total,
      1,
    );
    bucket.failDelete = false;
    assert.equal(
      (
        await executeAccountDeletionPurge(
          purgeEnv(d1, bucket),
          REQUEST_ID,
          { now: () => new Date("2026-07-30T00:00:01.000Z") },
        )
      ).status,
      "completed",
    );
  } finally {
    sqlite.close();
  }
});

test("workspace ownership and active staff access block purge without touching content", async () => {
  for (const blocker of ["workspace", "staff"] as const) {
    const { sqlite, d1 } = await seedRequest({
      withOtherOwner: blocker !== "workspace",
    });
    const bucket = new FakeR2Bucket();
    try {
      seedContent(sqlite, bucket);
      if (blocker === "staff") {
        sqlite.prepare(
          `INSERT INTO platform_staff_assignments (
             id,user_id,role,grant_source,grant_reason,granted_at,expires_at,
             created_at,updated_at
           ) VALUES ('purge-staff',?,'support','operator_bootstrap',
             'Synthetic active assignment',?,'2027-07-30T00:00:00.000Z',?,?)`,
        ).run(USER_ID, NOW, NOW, NOW);
      }
      const expected = blocker === "workspace"
        ? "WORKSPACE_OWNERSHIP_TRANSFER_REQUIRED"
        : "PRIVILEGED_ACCOUNT_REVIEW_REQUIRED";
      await assert.rejects(
        executeAccountDeletionPurge(
          purgeEnv(d1, bucket),
          REQUEST_ID,
          { now: () => new Date(NOW) },
        ),
        (error: unknown) =>
          error instanceof AccountDeletionPurgeError
          && error.code === expected
          && !error.retryable,
      );
      assert.deepEqual(
        { ...sqlite.prepare(
          `SELECT status,failure_code AS failureCode,
             purge_irreversible_at AS purgeIrreversibleAt
           FROM account_deletion_requests WHERE id=?`,
        ).get(REQUEST_ID) },
        {
          status: "blocked",
          failureCode: expected,
          purgeIrreversibleAt: null,
        },
      );
      assert.equal(
        (sqlite.prepare("SELECT count(*) AS total FROM documents WHERE owner_user_id=?").get(USER_ID) as { total: number }).total,
        1,
      );
      assert.deepEqual(bucket.deleted, []);
      assert.deepEqual(
        await cancelAccountDeletionRequest(d1, {
          requestId: REQUEST_ID,
          userId: USER_ID,
          sessionId: "fresh-session",
          workspaceId: WORKSPACE_ID,
          identityKeyring: RAW_IDENTITY_KEYRING,
          assuranceLevel: "primary",
          now: "2026-07-30T00:00:01.000Z",
        }),
        { status: "cancelled", requestId: REQUEST_ID },
      );    } finally {
      sqlite.close();
    }
  }
});
test("a corrected blocker can be retried once without forking durable evidence", async () => {
  const { sqlite, d1 } = await seedRequest({ withOtherOwner: false });
  const bucket = new FakeR2Bucket();
  try {
    seedContent(sqlite, bucket);
    await assert.rejects(
      executeAccountDeletionPurge(
        purgeEnv(d1, bucket),
        REQUEST_ID,
        { now: () => new Date(NOW) },
      ),
      (error: unknown) =>
        error instanceof AccountDeletionPurgeError
        && error.code === "WORKSPACE_OWNERSHIP_TRANSFER_REQUIRED"
        && !error.retryable,
    );
    sqlite.prepare(
      `UPDATE workspace_members SET role='owner',updated_at=?
       WHERE workspace_id=? AND user_id=?`,
    ).run("2026-07-30T00:00:01.000Z", WORKSPACE_ID, OTHER_USER_ID);

    const synchronized = batchBarrier(d1);
    const results = await Promise.all([
      retryAccountDeletionRequest(synchronized, {
        requestId: REQUEST_ID,
        userId: USER_ID,
        sessionId: "fresh-session-a",
        workspaceId: WORKSPACE_ID,
        identityKeyring: RAW_IDENTITY_KEYRING,
        assuranceLevel: "primary",
        now: "2026-07-30T00:00:02.000Z",
      }),
      retryAccountDeletionRequest(synchronized, {
        requestId: REQUEST_ID,
        userId: USER_ID,
        sessionId: "fresh-session-b",
        workspaceId: WORKSPACE_ID,
        identityKeyring: RAW_IDENTITY_KEYRING,
        assuranceLevel: "primary",
        now: "2026-07-30T00:00:02.000Z",
      }),
    ]);
    assert.equal(results.filter(result => result.status === "retried").length, 1);
    assert.equal(
      results.filter(result => result.status === "already_queued").length,
      1,
    );
    assert.deepEqual(
      { ...sqlite.prepare(
        `SELECT status,failure_code AS failureCode,
           purge_lease_owner AS leaseOwner
         FROM account_deletion_requests WHERE id=?`,
      ).get(REQUEST_ID) },
      { status: "scheduled", failureCode: null, leaseOwner: null },
    );
    assert.equal(
      (sqlite.prepare(
        `SELECT count(*) AS total FROM job_outbox
         WHERE subject_id=? AND idempotency_key LIKE '%_retry_%'`,
      ).get(REQUEST_ID) as { total: number }).total,
      1,
    );
    assert.equal(
      (sqlite.prepare(
        `SELECT count(*) AS total FROM account_deletion_lifecycle_events
         WHERE request_id=? AND event_type='scheduled'`,
      ).get(REQUEST_ID) as { total: number }).total,
      2,
    );
    assert.equal(
      (
        await executeAccountDeletionPurge(
          purgeEnv(d1, bucket),
          REQUEST_ID,
          { now: () => new Date("2026-07-30T00:00:03.000Z") },
        )
      ).status,
      "completed",
    );
  } finally {
    sqlite.close();
  }
});

test("account deletion purges dedicated quarantine objects from the quarantine bucket", async () => {
  const { sqlite, d1 } = await seedRequest();
  const primary = new FakeR2Bucket();
  const quarantine = new FakeR2Bucket();
  const quarantineKey = "quarantine-v2/purge-workspace/purge-analysis/purge-file";
  try {
    sqlite.prepare(`
      INSERT INTO document_files (
        id,workspace_id,document_id,owner_user_id,kind,r2_key,
        file_name,mime_type,size_bytes,sha256,created_at,updated_at
      ) VALUES (?,?,NULL,?,'analysis_quarantined',?,'upload.pdf','application/pdf',10,?,?,?)
    `).run(
      "purge-quarantine-file", WORKSPACE_ID, USER_ID, quarantineKey,
      "a".repeat(64), NOW, NOW,
    );
    quarantine.objects.add(quarantineKey);
    const result = await executeAccountDeletionPurge({
      DB: d1,
      BUCKET: primary as unknown as R2Bucket,
      QUARANTINE_BUCKET: quarantine as unknown as R2Bucket,
      ACCOUNT_DELETION_PURGE_ENABLED: "true",
      IDENTITY_KEYRING: RAW_IDENTITY_KEYRING,
    }, REQUEST_ID, { now: () => new Date(NOW) });
    assert.equal(result.status, "completed");
    assert.equal(result.r2DeletedCount, 1);
    assert.deepEqual(quarantine.deleted, [quarantineKey]);
    assert.equal(quarantine.objects.has(quarantineKey), false);
  } finally {
    sqlite.close();
  }
});
