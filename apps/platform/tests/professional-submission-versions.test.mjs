import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

test('public profile versions follow submitted review cycles, not draft edits', {skip: !process.env.DATABASE_URL}, async () => {
  const client = new pg.Client({connectionString: process.env.DATABASE_URL});
  await client.connect();
  const schema = `submission_test_${randomUUID().replaceAll('-','')}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}; SET LOCAL search_path=${schema},public;
      CREATE TABLE lawyer_profiles(id text PRIMARY KEY, profile_revision bigint, status text DEFAULT 'pending', marketplace_status text DEFAULT 'profile_incomplete', updated_at text DEFAULT '2026-02-03');
      CREATE TABLE workspace_audit_events(id text PRIMARY KEY,entity_id text,entity_type text,action text,metadata_json text,created_at text);
      CREATE TABLE lawyer_profile_moderation(id text PRIMARY KEY,lawyer_profile_id text,profile_revision bigint,created_at text);
      INSERT INTO lawyer_profiles(id,profile_revision) VALUES ('existing',12),('new',1),('legacy',9);
      INSERT INTO workspace_audit_events VALUES ('before','existing','lawyer_profile','lawyer_profile_submitted','{"profileRevision":2}','2026-01-01');
      INSERT INTO lawyer_profile_moderation VALUES ('approved','existing',2,'2026-01-02'),('legacy-approval','legacy',9,'2026-01-02');`);
    const migration = (await readFile(new URL('../postgres/0057-professional-submission-versions.sql', import.meta.url),'utf8')).replaceAll('app, public',`${schema}, public`);
    await client.query(migration);
    const versions = async id => (await client.query('SELECT profile_revision::integer AS revision,submission_version AS version FROM lawyer_profile_submission_versions WHERE lawyer_profile_id=$1 ORDER BY submission_version',[id])).rows;
    assert.deepEqual(await versions('existing'),[{revision:2,version:1}]);
    assert.deepEqual(await versions('legacy'),[{revision:9,version:1}]);
    await client.query("UPDATE lawyer_profiles SET profile_revision=17 WHERE id='new'");
    assert.deepEqual(await versions('new'),[]);
    const submit = async (id,revision,eventId) => client.query("INSERT INTO workspace_audit_events VALUES ($1,$2,'lawyer_profile','lawyer_profile_submitted',$3,'2026-02-01')",[eventId,id,JSON.stringify({profileRevision:revision})]);
    await submit('new',17,'first');
    await submit('new',17,'retry');
    await client.query("INSERT INTO lawyer_profile_moderation VALUES ('new-approval','new',17,'2026-02-02')");
    assert.deepEqual(await versions('new'),[{revision:17,version:1}]);
    await client.query("UPDATE lawyer_profiles SET profile_revision=24 WHERE id='new'");
    assert.deepEqual(await versions('new'),[{revision:17,version:1}]);
    await client.query('SAVEPOINT failed_submission');
    await submit('new',24,'rolled-back');
    await client.query('ROLLBACK TO SAVEPOINT failed_submission');
    assert.deepEqual(await versions('new'),[{revision:17,version:1}]);
    await submit('new',24,'second');
    await client.query("INSERT INTO lawyer_profile_moderation VALUES ('second-approval','new',24,'2026-02-03')");
    assert.deepEqual(await versions('new'),[{revision:17,version:1},{revision:24,version:2}]);
    // Execute the route's revision selection against an unchanged, decided profile.
    const route = await readFile(new URL('../app/api/platform/lawyer-profile/submit/route.ts', import.meta.url),'utf8');
    const selection = route.match(/CASE WHEN EXISTS \(SELECT 1 FROM lawyer_profile_moderation[\s\S]*?AS submissionRevision/)[0];
    const next = (await client.query(`SELECT ${selection} FROM lawyer_profiles p WHERE id='new'`)).rows[0].submissionrevision;
    assert.equal(Number(next),25);
    // Existing stuck reviews are repaired, while old decisions and versions survive.
    await client.query("UPDATE lawyer_profiles SET marketplace_status='pending_review' WHERE id='new'");
    const repair = (await readFile(new URL('../postgres/0058-professional-resubmission-revisions.sql', import.meta.url),'utf8')).replaceAll('app.',`${schema}.`).replaceAll('app, public',`${schema}, public`);
    await client.query(repair);
    assert.deepEqual(await versions('new'),[{revision:17,version:1},{revision:24,version:2},{revision:25,version:3}]);
    // Re-running the repair must not consume another version.
    await client.query(repair);
    assert.equal((await versions('new')).length,3);
    await client.query("INSERT INTO lawyer_profile_moderation VALUES ('resubmission-approved','new',25,'2026-02-04')");
    assert.equal((await versions('new')).length,3);
    await client.query("DELETE FROM lawyer_profiles WHERE id='new'");
    assert.deepEqual(await versions('new'),[]);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
});
