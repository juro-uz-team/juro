import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresDatabase } from "../lib/storage/postgres";

test("case history cascades require an irreversible purge with a live owner lease", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!, "app");
  const client = await db.pool.connect();
  const user = randomUUID(), other = randomUUID(), workspace = randomUUID();
  const request = randomUUID(), lease = randomUUID();
  const now = new Date(Date.now() - 600_000).toISOString();
  const future = new Date(Date.now() + 300_000).toISOString();
  const past = new Date(Date.now() - 300_000).toISOString();
  const cases = [randomUUID(), randomUUID(), randomUUID()];
  async function rejected(sql: string, parameters: unknown[] = []) {
    await client.query("SAVEPOINT rejected_mutation");
    try {
      await assert.rejects(client.query(sql, parameters), { code: "23514" });
    } finally {
      await client.query("ROLLBACK TO SAVEPOINT rejected_mutation");
      await client.query("RELEASE SAVEPOINT rejected_mutation");
    }
  }
  try {
    await client.query("BEGIN");
    for (const id of [user, other]) {
      await client.query(`INSERT INTO user_profiles(id,email,created_at,updated_at)
        VALUES ($1,$2,$3,$3)`, [id, `${id}@example.test`, now]);
    }
    await client.query(`INSERT INTO workspaces(id,type,name,full_name,short_name,created_at,updated_at)
      VALUES ($1,'business','Synthetic erasure workspace','Synthetic erasure workspace','Synthetic',$2,$2)`, [workspace, now]);
    for (const id of [user, other]) {
      await client.query(`INSERT INTO workspace_members(id,workspace_id,user_id,role,status,joined_at,created_at,updated_at)
        VALUES ($1,$2,$3,'owner','active',$4,$4,$4)`, [randomUUID(), workspace, id, now]);
    }
    for (const [index, id] of cases.entries()) {
      const owner = index === 2 ? other : user;
      const task = randomUUID();
      await client.query(`INSERT INTO cases(id,owner_user_id,workspace_id,account_type,locale,title,legal_area,created_at,updated_at)
        VALUES ($1,$2,$3,'individual','ru','Synthetic case','civil',$4,$4)`, [id, owner, workspace, now]);
      await client.query(`INSERT INTO tasks(id,workspace_id,case_id,owner_user_id,title,created_at,updated_at)
        VALUES ($1,$2,$3,$4,'Synthetic task',$5,$5)`, [task, workspace, id, owner, now]);
      await client.query(`INSERT INTO lawyer_task_comments(id,task_id,author_user_id,body,created_at,updated_at)
        VALUES ($1,$2,$3,'Synthetic comment',$4,$4)`, [randomUUID(), task, owner, now]);
      await client.query(`INSERT INTO case_lifecycle_events(id,case_id,workspace_id,actor_user_id,action,
        from_status,to_status,unresolved_task_count,unresolved_plan_step_count,idempotency_key,
        lifecycle_revision,previous_hash,event_hash,created_at)
        VALUES ($1,$2,$3,$4,'complete','open','completed',1,0,$5,1,$6,$7,$8)`,
      [randomUUID(), id, workspace, owner, randomUUID(), "0".repeat(64),
        randomUUID().replaceAll("-", "").repeat(2), now]);
    }
    await rejected("DELETE FROM cases WHERE id=$1", [cases[0]]);
    await client.query(`INSERT INTO account_deletion_requests(id,user_id,status,deletion_mode,
      subject_hash,subject_key_version,verification_method,verified_at,requested_at,scheduled_purge_at)
      VALUES ($1,$2,'scheduled','immediate',$3,'test','email_otp',$4,$4,$4)`,
    [request, user, "a".repeat(64), now]);
    await rejected("DELETE FROM cases WHERE id=$1", [cases[0]]);
    await client.query(`UPDATE account_deletion_requests SET status='purging',purge_started_at=$2,
      purge_lease_owner=$3,purge_lease_expires_at=$4 WHERE id=$1`, [request, now, lease, future]);
    await rejected("DELETE FROM cases WHERE id=$1", [cases[0]]);
    await client.query("UPDATE account_deletion_requests SET purge_irreversible_at=$2,purge_lease_expires_at=$3 WHERE id=$1",
      [request, now, past]);
    await rejected("DELETE FROM cases WHERE id=$1", [cases[0]]);
    await client.query("UPDATE account_deletion_requests SET purge_lease_expires_at=$2 WHERE id=$1", [request, future]);
    await rejected("DELETE FROM cases WHERE id=$1", [cases[2]]);
    // Even a forged session setting cannot turn a direct history delete into a cascade.
    await client.query("SELECT set_config('juro.account_erasure_cases',$1,true)",
      [JSON.stringify({ [cases[0]]: { request, user, lease } })]);
    await rejected("DELETE FROM case_lifecycle_events WHERE case_id=$1", [cases[0]]);
    await client.query("SELECT set_config('juro.account_erasure_cases','',true)");
    const deleted = await client.query("DELETE FROM cases WHERE owner_user_id=$1", [user]);
    assert.equal(deleted.rowCount, 2);
    assert.equal((await client.query("SELECT 1 FROM case_lifecycle_events WHERE case_id=ANY($1)", [cases.slice(0, 2)])).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM lawyer_task_comments WHERE author_user_id=$1", [user])).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM case_lifecycle_events WHERE case_id=$1", [cases[2]])).rowCount, 1);
    assert.equal((await client.query("SELECT 1 FROM lawyer_task_comments WHERE author_user_id=$1", [other])).rowCount, 1);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await db.close();
  }
});
