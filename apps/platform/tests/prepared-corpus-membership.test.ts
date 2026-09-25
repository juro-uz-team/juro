import assert from "node:assert/strict";
import test from "node:test";
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {PostgresDatabase} from "../lib/storage/postgres";
import {createPreparedMembershipReader,createPreparedOrdinalReader} from "../lib/storage/corpus-membership";

test("prepared membership authenticates every source page and member before immutable publication",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!);
  const schema=`membership_${randomUUID().replaceAll("-","")}`;
  const sql=(statement:string)=>statement.replaceAll("storage.",`${schema}.`);
  const query=(statement:string,values?:unknown[])=>db.pool.query(sql(statement),values);
  const id=randomUUID(),release="release",physical="physical-release";
  const members=[{itemKey:"retrieval-chunk-v1:"+"a".repeat(64),ordinal:1,legalIdentitySha256:"c".repeat(64)},
    {itemKey:"retrieval-chunk-v1:"+"a".repeat(63)+"b",ordinal:2,legalIdentitySha256:"d".repeat(64)}];
  const page=Buffer.from(JSON.stringify({schemaVersion:1,releaseId:physical,partition:"2a",items:members}));
  const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
  const manifest=Buffer.from(JSON.stringify({schemaVersion:1,releaseId:physical,partitions:[{
    partition:"2a",key:"source-page",sha256:hash(page),sizeBytes:page.length,count:2}]}));
  const publish=()=>query("UPDATE storage.corpus_membership_generations SET state='verified' WHERE id=$1",[id]);
  const pool=new Proxy(db.pool,{get(target,key){
    if(key==="query")return (statement:string,values?:unknown[])=>target.query(sql(statement),values);
    const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
  }});
  const read=createPreparedMembershipReader(pool);
  const readOrdinals=createPreparedOrdinalReader(pool);
  const input={releaseId:release,sourceInventorySha256:hash(manifest),memberCount:2,itemKeys:members.map(m=>m.itemKey)};
  try {
    await db.pool.query(`CREATE SCHEMA ${schema}`);
    await query(await readFile(new URL("../postgres/0024-prepared-corpus-membership.sql",import.meta.url),"utf8"));
    await query(`INSERT INTO storage.corpus_membership_generations
      (id,release_id,inventory_release_id,source_inventory_sha256,source_manifest,member_count) VALUES($1,$2,$3,$4,$5,2)`,
      [id,release,physical,hash(manifest),manifest]);
    assert.equal(await read(input),null,"Unpublished data cannot replace the accepted inventory");
    assert.equal(await readOrdinals({...input,ordinals:[1,2]}),null);
    await assert.rejects(publish,/PAGE_COUNT_INVALID/);
    await query("INSERT INTO storage.corpus_membership_pages VALUES($1,'2a',$2)",[id,Buffer.from("corrupt")]);
    await assert.rejects(publish,/PAGE_INVALID/);
    await query("UPDATE storage.corpus_membership_pages SET content=$2 WHERE generation_id=$1",[id,page]);
    await assert.rejects(publish,/PARITY_INVALID/);
    for(const member of members)await query("INSERT INTO storage.corpus_members VALUES($1,$2,$3,$4)",[id,member.itemKey,member.ordinal,member]);
    await query("UPDATE storage.corpus_members SET member=jsonb_set(member,'{legalIdentitySha256}',to_jsonb($2::text)) WHERE generation_id=$1 AND ordinal=2",[id,"e".repeat(64)]);
    await assert.rejects(publish,/PARITY_INVALID/);
    await query("UPDATE storage.corpus_members SET member=$2 WHERE generation_id=$1 AND ordinal=2",[id,members[1]]);
    const misplacedId=randomUUID();
    const misplacedPage=Buffer.from(JSON.stringify({...JSON.parse(page.toString()),partition:"00"}));
    const misplacedManifest=Buffer.from(JSON.stringify({schemaVersion:1,releaseId:physical,partitions:[{
      partition:"00",key:"misplaced-page",sha256:hash(misplacedPage),sizeBytes:misplacedPage.length,count:2}]}));
    await query(`INSERT INTO storage.corpus_membership_generations
      (id,release_id,inventory_release_id,source_inventory_sha256,source_manifest,member_count) VALUES($1,$2,$3,$4,$5,2)`,
      [misplacedId,release,physical,hash(misplacedManifest),misplacedManifest]);
    await query("INSERT INTO storage.corpus_membership_pages VALUES($1,'00',$2)",[misplacedId,misplacedPage]);
    for(const member of members)await query("INSERT INTO storage.corpus_members VALUES($1,$2,$3,$4)",[misplacedId,member.itemKey,member.ordinal,member]);
    await assert.rejects(()=>query("UPDATE storage.corpus_membership_generations SET state='verified' WHERE id=$1",[misplacedId]),/PARTITION_INVALID/);
    const stale=await db.pool.connect();
    try {
      await stale.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await assert.rejects(()=>stale.query(sql("UPDATE storage.corpus_membership_generations SET state='verified' WHERE id=$1"),[id]),/REQUIRES_READ_COMMITTED/);
    } finally {await stale.query("ROLLBACK");stale.release();}
    await publish();
    const pins=new Map([[release,{generation:id,sha256:hash(manifest),count:2}]]);
    const pinnedRead=createPreparedMembershipReader(pool,pins),pinnedOrdinals=createPreparedOrdinalReader(pool,pins);
    assert.deepEqual(await pinnedRead(input),await read(input));
    assert.deepEqual(await pinnedOrdinals({...input,ordinals:[1]}),[members[0]!.itemKey]);
    await assert.rejects(pinnedRead({...input,memberCount:3}),/PIN_MISMATCH/);
    const wrong=createPreparedMembershipReader(pool,new Map([[release,{generation:randomUUID(),sha256:hash(manifest),count:2}]]));
    await assert.rejects(wrong(input),/GENERATION_UNAVAILABLE/);
    assert.deepEqual(await read(input),new Map(members.map(member=>[member.itemKey,{ordinal:member.ordinal,legalIdentitySha256:member.legalIdentitySha256}])));
    assert.deepEqual(await readOrdinals({...input,ordinals:[2,1,2]}),[members[1]!.itemKey,members[0]!.itemKey,members[1]!.itemKey]);
    assert.equal(await readOrdinals({...input,sourceInventorySha256:"f".repeat(64),ordinals:[1]}),null);
    assert.equal(await readOrdinals({...input,memberCount:3,ordinals:[1]}),null);
    await assert.rejects(readOrdinals({...input,ordinals:[1,99]}),/CORPUS_ORDINAL_MISSING/);
    await assert.rejects(readOrdinals({...input,ordinals:[-1]}));
    assert.equal(await read({...input,sourceInventorySha256:"f".repeat(64)}),null,"Changed accepted inventory cannot use an old projection");
    assert.equal(await read({...input,releaseId:"different"}),null,"Release identity is independently pinned");
    assert.equal((await read({...input,itemKeys:["missing"]}))!.size,0,"A verified generation cannot hide a missing identity via fallback");
    await assert.rejects(()=>query("UPDATE storage.corpus_members SET member=member WHERE generation_id=$1",[id]),/IMMUTABLE/);
    await assert.rejects(()=>query("DELETE FROM storage.corpus_membership_pages WHERE generation_id=$1",[id]),/IMMUTABLE/);
    await assert.rejects(()=>query("TRUNCATE storage.corpus_members"),/TRUNCATE_FORBIDDEN/);
    await assert.rejects(()=>query("TRUNCATE storage.corpus_membership_generations CASCADE"),/TRUNCATE_FORBIDDEN/);
    await assert.rejects(()=>query("DELETE FROM storage.corpus_membership_generations WHERE id=$1",[id]),/MUST_RETIRE/);
    await query("UPDATE storage.corpus_membership_generations SET state='retired' WHERE id=$1",[id]);
    await assert.rejects(pinnedRead(input),/GENERATION_UNAVAILABLE/);
    await assert.rejects(pinnedOrdinals({...input,ordinals:[1]}),/GENERATION_UNAVAILABLE/);
    assert.equal(await read(input),null);
    assert.equal(await readOrdinals({...input,ordinals:[1]}),null);
    await query("DELETE FROM storage.corpus_membership_generations WHERE id=$1",[id]);
  } finally {await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.close();}
});
