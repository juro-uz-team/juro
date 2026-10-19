import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {resolve} from "node:path";
import test from "node:test";
import {PostgresDatabase} from "../lib/storage/postgres";
import {retireNativeCorpus} from "../lib/storage/corpus-retirement";
import {reclaimRetiredCorpusBatch} from "../lib/storage/corpus-reclamation";

test("retired payload cleanup is bounded, restartable and preserves private rows and citation history",async()=>{
  const db=new PostgresDatabase(process.env.DATABASE_URL!);
  const schema=`reclaim_${randomUUID().replaceAll("-","")}`;
  const sql=(text:string)=>text.replaceAll("storage.",`${schema}.`).replaceAll("EXISTS storage;",`EXISTS ${schema};`);
  const query=(text:string,args?:unknown[])=>db.pool.query(sql(text),args);
  const pool=new Proxy(db.pool,{get(target,key){
    if(key==="query")return query;
    if(key==="connect")return async()=>{const client=await target.connect();return new Proxy(client,{get(connection,property){
      if(property==="query")return(text:string,args?:unknown[])=>connection.query(sql(text),args);
      const value=Reflect.get(connection,property);return typeof value==="function"?value.bind(connection):value;
    }});};
    const value=Reflect.get(target,key);return typeof value==="function"?value.bind(target):value;
  }});
  const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
  const vectors=[randomUUID(),randomUUID()],memberships=[randomUUID(),randomUUID()];
  try{
    for(const name of ["0004-local-object-storage.sql","0015-object-reclamation.sql","0020-vector-source-revisions.sql",
      "0021-vector-search-generations.sql","0024-prepared-corpus-membership.sql","0031-native-corpus-acceptance.sql","0062-corpus-retirement.sql"]){
      await query(await readFile(new URL(`../postgres/${name}`,import.meta.url),"utf8"));
    }
    await query("ALTER TABLE storage.vector_collections ADD COLUMN ready boolean NOT NULL DEFAULT true");
    for(const [i,name] of ["old-current","old-history"].entries()){
      await query("INSERT INTO storage.vector_collections(name,dimensions,metric) VALUES($1,3,'cosine')",[name]);
      await query("INSERT INTO storage.embeddings(collection,id,embedding) VALUES($1,'one','[1,2,3]')",[name]);
      await query("INSERT INTO storage.vector_search_generations(id,collection,source_revision,member_count,group_count) VALUES($1,$2,1,1,1)",[vectors[i],name]);
      await query("INSERT INTO storage.vector_search_groups(generation_id,digest,embedding) VALUES($1,$2,'[1,2,3]')",[vectors[i],Buffer.alloc(32,i)]);
      await query("INSERT INTO storage.vector_search_members VALUES($1,'one',$2)",[vectors[i],Buffer.alloc(32,i)]);
      await query("INSERT INTO storage.corpus_membership_generations(id,release_id,inventory_release_id,source_inventory_sha256,source_manifest,member_count) VALUES($1,$2,$2,$3,$4,1)",[memberships[i],name,hash('{}'),Buffer.from('{}')]);
      await query("INSERT INTO storage.corpus_members VALUES($1,'one',0,$2)",[memberships[i],{itemKey:"one",ordinal:0}]);
      await query("INSERT INTO storage.corpus_membership_pages VALUES($1,'00',$2)",[memberships[i],Buffer.from('page')]);
    }
    await query("INSERT INTO storage.vector_collections(name,dimensions,metric) VALUES('user-documents',3,'cosine'); INSERT INTO storage.embeddings(collection,id,embedding) VALUES('user-documents','private','[3,2,1]')");
    const accepted=hash('acceptance');
    await query("INSERT INTO storage.native_corpus_acceptances VALUES($1,$2,$3,$4,$5,$6,now())",[accepted,Buffer.from('acceptance'),...vectors,...memberships]);
    await query("INSERT INTO storage.native_corpus_selections(acceptance_sha256) VALUES($1)",[accepted]);
    for(const bucket of ["old-evidence","application","new-evidence"]){
      await query("INSERT INTO storage.objects(bucket,key,sha256,size,version) VALUES($1,'shared',$2,7,'1')",[bucket,hash('content')]);
    }
    const manifestBytes=Buffer.from(JSON.stringify({version:1,expectedAcceptance:accepted,vectorCollections:["old-current","old-history"],
      membershipReleases:["old-current","old-history"],objectNamespaces:["old-evidence"],
      objects:{count:1,sha256:hash(JSON.stringify(['old-evidence','shared',hash('content'),'7'])+'\n')},
      preservationProofSha256:'a'.repeat(64),quiescenceProofSha256:'b'.repeat(64)}));
    const input={pool,manifestBytes,objectRoots:[resolve('test-reclamation-root')],limit:1};
    await assert.rejects(reclaimRetiredCorpusBatch({...input,phase:"objects"}),/RETIREMENT_MISMATCH/);
    await retireNativeCorpus(pool,manifestBytes);
    await assert.rejects(reclaimRetiredCorpusBatch({...input,phase:"vector-groups"}),/MEMBERS_REMAIN/);
    await assert.rejects(reclaimRetiredCorpusBatch({...input,manifestBytes:Buffer.from(manifestBytes.toString()+' '),phase:"objects"}),/RETIREMENT_MISMATCH/);
    for(const phase of ["objects","vector-members","vector-groups","memberships","membership-pages","embeddings"] as const){
      let total=0;
      for(let call=0;call<4;call++){
        const result=await reclaimRetiredCorpusBatch({...input,phase});assert.ok(result.removed<=1);total+=result.removed;
        if(!result.removed)break;
      }
      assert.equal(total,phase==="objects"?1:2);
      assert.equal((await reclaimRetiredCorpusBatch({...input,phase})).removed,0);
    }
    assert.equal((await query("SELECT count(*)::int n FROM storage.objects WHERE bucket IN ('application','new-evidence')")).rows[0].n,2);
    assert.equal((await query("SELECT count(*)::int n FROM storage.embeddings WHERE collection='user-documents'")).rows[0].n,1);
    assert.equal((await query("SELECT count(*)::int n FROM storage.native_corpus_acceptances")).rows[0].n,1);
    assert.equal((await query("SELECT count(*)::int n FROM storage.retired_corpus_objects")).rows[0].n,1);
    assert.equal((await query("SELECT count(*)::int n FROM storage.object_reclamation")).rows[0].n,1);
    assert.equal((await query("SELECT count(*)::int n FROM storage.vector_search_generations WHERE state='retired'")).rows[0].n,2);
  }finally{await db.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await db.close();}
});
