import test from "node:test";
import assert from "node:assert/strict";
import {retainPreparedCorpus} from "./retained-corpus-deployment.mjs";

function fixture(phase="prepare") {
  const digest="a".repeat(64),revision="b".repeat(40),namespace=`legal-prepared-${digest}`;
  const lane={evidenceStore:{generationSha256:digest,namespace}};
  const manifest={version:"prepared-pgvector-v1",productRevision:revision,current:lane,history:lane};
  const bundle={mode:"retain",acceptedRevision:revision,expectedParent:digest,acceptanceSha256:digest};
  const calls=[];let selection=digest,released=false;
  const client={query:async(sql,args)=>{
    calls.push(sql);
    if(sql.startsWith("SELECT namespace,manifest")){
      assert.deepEqual(args,[digest]);
      return {rows:[{namespace,manifest:Buffer.from(JSON.stringify({format:"prepared-postgres-evidence-store-v1"}))}]};
    }
    assert(["BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY","ROLLBACK","SELECT namespace,key,sha256,content FROM storage.prepared_evidence_objects LIMIT 0"].includes(sql),"No corpus contents or proofs may be read");
    return {rows:[]};
  },release:()=>{released=true;}};
  const pool={query:async sql=>{assert(sql.startsWith("SELECT coalesce(acceptance_sha256"));return {rows:[{acceptance_sha256:selection}]};},connect:async()=>client};
  return {input:{request:{phase},bundle,manifest,pool,guard:async services=>calls.push(services?"services":"guard")},calls,client,setSelection:value=>{selection=value;},released:()=>released};
}

test("retention checks configuration/access without proof reads or publication",async()=>{
  for(const phase of ["prepare","activate","verify"]) {
    const f=fixture(phase);
    const result=await retainPreparedCorpus(f.input);
    assert.equal(result.selectionState,phase==="prepare"?"original":"committed");
    assert(f.released());
    assert(f.calls.includes("SELECT namespace,key,sha256,content FROM storage.prepared_evidence_objects LIMIT 0"));
  }
});
test("retention refuses selection races and service drift",async()=>{
  const raced=fixture();raced.input.guard=async()=>raced.setSelection("c".repeat(64));
  await assert.rejects(retainPreparedCorpus(raced.input),/reviewed parent/);
  const drift=fixture("activate");drift.input.guard=async services=>{if(services)throw Error("process drift");};
  await assert.rejects(retainPreparedCorpus(drift.input),/process drift/);
});
test("inaccessible or incompatible retained projections fail and release the lease",async()=>{
  const f=fixture();f.client.query=async sql=>{
    if(sql==="ROLLBACK")return {rows:[]};
    if(sql.startsWith("BEGIN"))return {rows:[]};
    return {rows:[]};
  };
  await assert.rejects(retainPreparedCorpus(f.input),/namespace unavailable/);
  assert(f.released());
  const unsupported=fixture();unsupported.input.manifest.version="unknown";
  await assert.rejects(retainPreparedCorpus(unsupported.input));
});
