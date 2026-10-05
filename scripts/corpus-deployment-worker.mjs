// Root-installed worker; launched only by the privileged wrapper with scoped credentials.
import assert from "node:assert/strict";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {digest,runDeploymentPhase} from "./corpus-deployment-contract.mjs";
assert(process.send && process.getuid()!==0,"Dedicated unprivileged executor required");
const disconnected=()=>process.exit(1);process.on("disconnect",disconnected);
let sequence=0;const pending=new Map();
process.on("message",message=>{if(message.type==="guard-result"){const task=pending.get(message.id);pending.delete(message.id);message.ok?task.resolve():task.reject(Error("Deployment guard changed"));}});
const guard=services=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});process.send({type:"guard",id,services});});
process.once("message",async input=>{
 if(input.type!=="start")return;
 const {request,bundle,settings,manifestText}=input,bytes=Buffer.from(manifestText);
 let stage="load-product";
 try{
 const imported=async path=>{const value=await import(pathToFileURL(join(request.release,path)).href);return value.default??value;};
 const api=await imported("apps/platform/lib/storage/native-corpus-acceptance.ts");
 const {stableSourceSnapshotJson}=await imported("apps/platform/lib/legal-corpus/source-snapshot.ts");
 const {parseCustomBm25RuntimeDescriptor}=await imported("apps/platform/lib/legal-corpus/custom-bm25-runtime.ts");
 const {LocalObjectStore}=await imported("apps/platform/lib/storage/objects.ts");
 const pg=await imported("apps/platform/node_modules/pg/lib/index.js");
 stage="parse-manifest";
 const manifest=api.nativeCorpusAcceptanceSchema.parse(JSON.parse(bytes.toString()));assert.equal(manifest.productRevision,bundle.mode==="retain"?bundle.acceptedRevision:request.revision);assert.equal(manifest.environment,bundle.mode==="retain"?"production":request.environment);assert.equal(digest(stableSourceSnapshotJson(manifest)),bundle.acceptanceSha256);
 const pool=new pg.Pool({connectionString:settings.CORPUS_DATABASE_URL,max:2,connectionTimeoutMillis:10000,statement_timeout:30000,idle_in_transaction_session_timeout:15000});
 const stores=new Map();const read=async ref=>{if(!stores.has(ref.bucket))stores.set(ref.bucket,new LocalObjectStore(pool,settings.CORPUS_OBJECT_STORAGE_PATH,ref.bucket,true));const object=await stores.get(ref.bucket).get(ref.key);assert(object,"Prepublished proof/object missing");const value=await object.bytes();assert.equal(value.length,ref.sizeBytes);assert.equal(digest(value),ref.sha256);return value;};
 const selected=async()=> {stage="selection-read";return (await pool.query("SELECT acceptance_sha256 FROM storage.native_corpus_selections ORDER BY id DESC LIMIT 1")).rows[0]?.acceptance_sha256;};
 try{
  const result=await runDeploymentPhase(request,bundle,{guard,selected,
   qualify:async()=>{stage="qualify-proofs";await api.verifyNativeCorpusQualification(manifest,read);for(const lane of [manifest.current,manifest.history]){const descriptor=parseCustomBm25RuntimeDescriptor(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await read(lane.descriptor))));assert.equal(descriptor.releaseId,lane.releaseId);assert.equal(descriptor.statistics.documentCount,lane.membership.count);assert.equal(descriptor.denseMetadataReleaseId??descriptor.releaseId,lane.releaseId);}},
   fences:async()=>{stage="prepare-fences";const client=await pool.connect();try{await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    for(const capability of ["current","history"]){
      const selected=manifest[capability];
      const vectors=(await client.query(`SELECT g.collection,g.source_revision::text,g.state,g.member_count,c.source_revision::text AS live_revision
        FROM storage.vector_search_generations g JOIN storage.vector_collections c ON c.name=g.collection
        WHERE g.id=$1`,[selected.vector.generation])).rows[0];
      if(!vectors||vectors.collection!==selected.vectorCollection||vectors.state!=="verified"
        ||vectors.source_revision!==selected.vector.sourceRevision||vectors.live_revision!==selected.vector.sourceRevision
        ||Number(vectors.member_count)!==selected.membership.count)throw Error("NATIVE_CORPUS_VECTOR_CHANGED");
      const membership=(await client.query(`SELECT release_id,source_inventory_sha256,member_count,state
        FROM storage.corpus_membership_generations WHERE id=$1`,[selected.membership.generation])).rows[0];
      if(!membership||membership.release_id!==selected.releaseId||membership.source_inventory_sha256!==selected.membership.sha256
        ||Number(membership.member_count)!==selected.membership.count||membership.state!=="verified")throw Error("NATIVE_CORPUS_MEMBERSHIP_CHANGED");
      const ledger=(await client.query(`SELECT r.capability,r.environment,r.configuration_identity,
        x.runtime_descriptor_r2_key,x.runtime_descriptor_sha256,x.mapping_inventory_sha256,x.mapping_count
        FROM legal.legal_search_releases r JOIN legal.legal_custom_search_r2_runtime_roots x ON x.search_release_id=r.id
        WHERE r.id=$1`,[selected.releaseId])).rows[0];
      if(!ledger||ledger.capability!==capability||ledger.environment!==manifest.environment
        ||ledger.configuration_identity!==selected.configurationIdentity||ledger.runtime_descriptor_r2_key!==selected.descriptor.key
        ||ledger.runtime_descriptor_sha256!==selected.descriptor.sha256||ledger.mapping_inventory_sha256!==selected.membership.sha256
        ||Number(ledger.mapping_count)!==selected.membership.count||selected.descriptor.bucket!==selected.artifactNamespace)throw Error("NATIVE_CORPUS_RELEASE_CHANGED");
    }

    await client.query("ROLLBACK");}finally{client.release();}},
   activate:async()=>{stage="activate";
    const guardedPool={connect:async()=>{const client=await pool.connect();return {release:()=>client.release(),query:async(...args)=>{
     const sql=String(args[0]).trim();if(sql==="BEGIN"){const value=await client.query(...args);await client.query("SET LOCAL lock_timeout='5s'");await client.query("SET LOCAL statement_timeout='30s'");await client.query("SELECT pg_advisory_xact_lock(hashtextextended('native-corpus-selection',0))");const actual=(await client.query("SELECT acceptance_sha256 FROM storage.native_corpus_selections ORDER BY id DESC LIMIT 1")).rows[0]?.acceptance_sha256;assert.equal(actual,bundle.expectedParent);await guard(true);return value;}if(sql==="COMMIT")await guard(true);return client.query(...args);
    }};}};
    assert.equal(await api.activateNativeCorpus({pool:guardedPool,manifest,productRevision:request.revision,read}),bundle.acceptanceSha256);
   }});process.send({type:"result",result});
 }finally{await pool.end();}
 process.removeListener("disconnect",disconnected);process.disconnect();
 }catch(error){const code=String(error?.code??"OPERATOR_FAILURE");process.send({type:"failure",stage,code:/^[A-Za-z0-9_]{1,64}$/.test(code)?code:"OPERATOR_FAILURE"});process.disconnect();process.exitCode=1;}
});
