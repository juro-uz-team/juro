import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { executeAccountDeletionPurge } from "../lib/auth/account-deletion-purge";
import { accountDeletionSubjectHash, accountDeletionLifecycleStatement, createAccountDeletionLifecycleRecord } from "../lib/auth/account-deletion-lifecycle";
import { withPostgresRollback } from "./helpers/postgres-rollback";

test("native account completion redacts owned history while preserving other profiles and immutable audit identities", async () => {
  await withPostgresRollback(async db => {
    const user = randomUUID(), other = randomUUID(), workspace = randomUUID(), request = randomUUID();
    const profile = randomUUID(), otherProfile = randomUUID();
    const now = new Date().toISOString();
    const keyring = JSON.stringify({ active: "test", versions: { test: {
      aead: randomBytes(32).toString("base64url"), hmac: randomBytes(32).toString("base64url"),
    } } });
    const run = async (sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();
    for (const id of [user, other]) {
      await run("INSERT INTO user_profiles(id,email,created_at,updated_at) VALUES (?,?,?,?)", id, `${id}@example.test`, now, now);
    }
    await run(`INSERT INTO workspaces(id,type,name,full_name,short_name,created_at,updated_at)
      VALUES (?,'business','Synthetic workspace','Synthetic workspace','Synthetic',?,?)`, workspace, now, now);
    for (const id of [user, other]) {
      await run(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
        VALUES (?,?,?,'owner','active',?,?,?)`, randomUUID(), workspace, id, now, now, now);
    }
    const revisions: string[] = [];
    for (const [owner, profileId] of [[user, profile], [other, otherProfile]]) {
      const revision = randomUUID(); revisions.push(revision);
      await run(`INSERT INTO lawyer_profiles(id,user_id,display_name,bio,profile_photo_key,created_at,updated_at)
        VALUES (?,?,?,'Private biography',?,?,?)`, profileId, owner, `Private name ${owner}`, `lawyer-photos/${owner}.jpg`, now, now);
      await run(`INSERT INTO lawyer_profile_revisions(id,lawyer_profile_id,previous_revision,next_revision,
        actor_user_id,previous_snapshot_json,next_snapshot_json,reason,created_at)
        VALUES (?,?,0,1,?,'{"private":"before"}','{"private":"after"}','Private revision reason',?)`, revision, profileId, owner, now);
      await run(`INSERT INTO lawyer_profile_deletion_requests(id,lawyer_profile_id,requested_by_user_id,status,
        reason,decision_reason,reviewed_by_user_id,requested_at,reviewed_at,created_at,updated_at)
        VALUES (?,?,?,'rejected','Private request','Private decision',?,?,?,?,?)`,
      randomUUID(), profileId, owner, other, now, now, now, now);
      await run(`INSERT INTO lawyer_knowledge_items(id,lawyer_user_id,workspace_id,kind,title,content,folder,created_at,updated_at)
        VALUES (?,?,?,'note','Private note','Private content','Personal',?,?)`, randomUUID(), owner, workspace, now, now);
    }
    await assert.rejects(db.batch([db.prepare("UPDATE lawyer_profile_revisions SET reason='[deleted by account closure]',previous_snapshot_json='{}',next_snapshot_json='{}' WHERE id=?").bind(revisions[0])]), { code: "23514" });
    const subject = await accountDeletionSubjectHash(keyring, user);
    await run(`INSERT INTO account_deletion_requests(id,user_id,status,deletion_mode,subject_hash,subject_key_version,
      verification_method,verified_at,requested_at,scheduled_purge_at)
      VALUES (?,?,'scheduled','immediate',?,?,'email_otp',?,?,?)`, request, user, subject.hash, subject.keyVersion, now, now, now);
    const input = { requestId: request, subjectHash: subject.hash, subjectKeyVersion: subject.keyVersion,
      eventType: "scheduled" as const, deletionMode: "immediate" as const, summary: { scheduledPurgeAt: now }, createdAt: now };
    const runtimeDb = db as unknown as D1Database;
    await accountDeletionLifecycleStatement(runtimeDb, input, await createAccountDeletionLifecycleRecord(runtimeDb, input)).run();
    const removed: string[] = [];
    const outcome = await executeAccountDeletionPurge({ DB: runtimeDb,
      BUCKET: { delete: async (keys: string | string[]) => { removed.push(...(Array.isArray(keys) ? keys : [keys])); } } as unknown as R2Bucket,
      ACCOUNT_DELETION_PURGE_ENABLED: "true", IDENTITY_KEYRING: keyring,
    }, request, { now: () => new Date(now) });
    assert.equal(outcome.status, "completed");
    assert.deepEqual(removed, [`lawyer-photos/${user}.jpg`]);
    assert.deepEqual(await db.prepare("SELECT display_name,bio,profile_photo_key,marketplace_status,accepting_new_requests FROM lawyer_profiles WHERE id=?").bind(profile).first(),
      { display_name: "Closed JURO account", bio: null, profile_photo_key: null, marketplace_status: "archived", accepting_new_requests: 0 });
    assert.deepEqual(await db.prepare("SELECT id,actor_user_id,previous_revision,next_revision,reason,previous_snapshot_json,next_snapshot_json FROM lawyer_profile_revisions WHERE id=?").bind(revisions[0]).first(),
      { id: revisions[0], actor_user_id: user, previous_revision: 0, next_revision: 1, reason: "[deleted by account closure]", previous_snapshot_json: "{}", next_snapshot_json: "{}" });
    assert.deepEqual(await db.prepare("SELECT status,reason,decision_reason FROM lawyer_profile_deletion_requests WHERE lawyer_profile_id=?").bind(profile).first(),
      { status: "rejected", reason: null, decision_reason: null });
    assert.equal(await db.prepare("SELECT id FROM lawyer_knowledge_items WHERE lawyer_user_id=?").bind(user).first(), null);
    assert.equal(await db.prepare("SELECT count(*) FROM lawyer_knowledge_items WHERE lawyer_user_id=?").bind(other).first("count"), 1);
    assert.deepEqual(await db.prepare("SELECT display_name,bio,profile_photo_key FROM lawyer_profiles WHERE id=?").bind(otherProfile).first(),
      { display_name: `Private name ${other}`, bio: "Private biography", profile_photo_key: `lawyer-photos/${other}.jpg` });
    assert.equal(await db.prepare("SELECT reason FROM lawyer_profile_revisions WHERE id=?").bind(revisions[1]).first("reason"), "Private revision reason");
    assert.equal(await db.prepare("SELECT current_setting('juro.completed_account_erasure',true) AS context").first("context"), "");
    // Knowing a completed request ID never grants direct redaction authority.
    await run("SELECT set_config('juro.completed_account_erasure',?,true)", request);
    await assert.rejects(db.batch([db.prepare("UPDATE lawyer_profile_revisions SET reason='replacement' WHERE id=?").bind(revisions[0])]), { code: "23514" });
    await assert.rejects(db.batch([db.prepare("UPDATE lawyer_profile_revisions SET reason='[deleted by account closure]',previous_snapshot_json='{}',next_snapshot_json='{}' WHERE id=?").bind(revisions[1])]), { code: "23514" });
  });
});
