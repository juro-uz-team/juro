import {createHash} from "node:crypto";
import {resolveCitationEvidence} from "../lib/legal-corpus/citation-evidence";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile, link } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {setTimeout as pause} from "node:timers/promises";
import {objectStorageLock,reclaimObjects} from "../lib/storage/object-reclamation";
import { PostgresDatabase } from "../lib/storage/postgres";
import { LocalObjectStore } from "../lib/storage/objects";

test("concurrent immutable evidence writes create one object and retain exact ranged bytes", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const root = await mkdtemp(join(tmpdir(), "juro-objects-"));
  const bucket = `test-${crypto.randomUUID()}`;
  const store = new LocalObjectStore(db.pool, root, bucket);
  try {
    const writes = await Promise.all([
      store.put("../evidence/legal.txt", "abcdef", { onlyIf: { etagDoesNotMatch: "*" } }),
      store.put("../evidence/legal.txt", "uvwxyz", { onlyIf: { etagDoesNotMatch: "*" } }),
    ]);
    assert.equal(writes.filter(Boolean).length, 1);
    const whole = await store.get("../evidence/legal.txt");
    const content = await whole!.text();
    assert.ok(content === "abcdef" || content === "uvwxyz");
    const range = await store.get("../evidence/legal.txt", { range: { offset: 1, length: 3 } });
    assert.equal(await range!.text(), content.slice(1, 4));
    const sha256 = createHash("sha256").update(content).digest("hex");
    const citation = await resolveCitationEvidence(store, {
      version: 1, capability: "current", kind: "provision", r2Key: "../evidence/legal.txt",
      byteCount: Buffer.byteLength(content), sha256, textSha256: sha256,
      officialUrl: "https://lex.uz/docs/1234567", languageTag: "uz-Latn", articleNumber: null,
    });
    assert.equal(citation.text, content);
    assert.equal(await store.get("absent"), null);
  } finally {
    await db.pool.query("DELETE FROM storage.objects WHERE bucket=$1", [bucket]);
    await db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("deleting the last reference removes bytes while shared evidence remains readable", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const root = await mkdtemp(join(tmpdir(), "juro-reclaim-"));
  const bucket = `test-${crypto.randomUUID()}`;
  const store = new LocalObjectStore(db.pool, root, bucket);
  try {
    const first = await store.put("first", crypto.randomUUID());
    const text = await (await store.get("first"))!.text();
    await store.put("second", text);
    const path = join(root, first!.etag.slice(0,2), first!.etag);
    await store.delete("first");
    assert.equal(await (await store.get("second"))!.text(), text);
    await store.delete("second");
    await assert.rejects(stat(path), {code:"ENOENT"});
    await store.delete("second");
    const previous = await store.put("replace", "synthetic-"+crypto.randomUUID());
    await store.put("replace", "new-"+crypto.randomUUID());
    await assert.rejects(stat(join(root,previous!.etag.slice(0,2),previous!.etag)),{code:"ENOENT"});
  } finally {
    await store.delete(["first","second","replace"]);
    await db.close(); await rm(root,{recursive:true,force:true});
  }
});

test("backup pins delay reclamation and interrupted deletions resume from durable candidates", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const root = await mkdtemp(join(tmpdir(), "juro-backup-pin-"));
  const bucket = `test-${crypto.randomUUID()}`;
  const store = new LocalObjectStore(db.pool,root,bucket);
  const backup = await db.pool.connect();
  let deletion: Promise<void> | undefined;
  try {
    const object = await store.put("private",crypto.randomUUID());
    const path=join(root,object!.etag.slice(0,2),object!.etag);
    await backup.query("SELECT pg_advisory_lock_shared(hashtextextended($1,0))",[objectStorageLock(root)]);
    assert.deepEqual(await reclaimObjects(db.pool,root,undefined,{wait:false}),{removed:0,processed:0});
    let completed=false;
    deletion=store.delete("private").then(()=>{completed=true;});
    await pause(100);
    assert.equal(completed,false);
    // A waiting deletion must not prevent a new backup-compatible reader.
    const probe=await db.pool.connect();
    try {
      const lock=await probe.query("SELECT pg_try_advisory_lock_shared(hashtextextended($1,0)) AS acquired",[objectStorageLock(root)]);
      assert.equal(lock.rows[0].acquired,true);
      await probe.query("SELECT pg_advisory_unlock_shared(hashtextextended($1,0))",[objectStorageLock(root)]);
    } finally {probe.release();}
    assert.ok((await stat(path)).size>0);
    await backup.query("SELECT pg_advisory_unlock_shared(hashtextextended($1,0))",[objectStorageLock(root)]);
    await deletion;
    await assert.rejects(stat(path),{code:"ENOENT"});
    const orphan=await store.put("interrupted",crypto.randomUUID());
    // Model a process dying after metadata removal and durable candidate commit.
    await db.pool.query("INSERT INTO storage.object_reclamation(root,sha256) VALUES($1,$2)",[root,orphan!.etag]);
    await db.pool.query("DELETE FROM storage.objects WHERE bucket=$1 AND key='interrupted'",[bucket]);
    await store.delete("interrupted");
    await assert.rejects(stat(join(root,orphan!.etag.slice(0,2),orphan!.etag)),{code:"ENOENT"});
    assert.equal((await reclaimObjects(db.pool,root)).processed,0);
  } finally {
    await backup.query("SELECT pg_advisory_unlock_all()"); backup.release();
    await deletion;
    await store.delete(["private","interrupted"]);
    await db.close();await rm(root,{recursive:true,force:true});
  }
});

test("open readers survive deletion and abandoned write links are reclaimed", async () => {
  const db = new PostgresDatabase(process.env.DATABASE_URL!);
  const root = await mkdtemp(join(tmpdir(), "juro-reader-"));
  const store = new LocalObjectStore(db.pool,root,`test-${crypto.randomUUID()}`);
  try {
    const value="synthetic-"+crypto.randomUUID();
    const object=await store.put("source",value);
    const read=await store.get("source");
    const abandoned=join(root,`.write-${crypto.randomUUID()}`);
    const partial=join(root,`.write-${crypto.randomUUID()}`);
    await link(join(root,object!.etag.slice(0,2),object!.etag),abandoned);
    await writeFile(partial,"interrupted private stream");
    await store.delete("source");
    assert.equal(await read!.text(),value);
    await assert.rejects(stat(abandoned),{code:"ENOENT"});
    await assert.rejects(stat(partial),{code:"ENOENT"});
  } finally { await store.delete("source");await db.close();await rm(root,{recursive:true,force:true}); }
});
