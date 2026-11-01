import assert from "node:assert/strict";
import {runDeploymentPhase} from "./corpus-deployment-contract.mjs";

/** Retain a trusted prepared corpus without loading proofs or publishing a selection.
 * The privileged wrapper binds this operator configuration to the release. */
export async function retainPreparedCorpus({request,bundle,manifest,pool,guard}) {
  assert.equal(bundle.mode,"retain");
  assert.equal(bundle.expectedParent,bundle.acceptanceSha256);
  assert.equal(manifest.version,"prepared-pgvector-v1");
  assert.equal(manifest.productRevision,bundle.acceptedRevision);
  const lanes=[manifest.current,manifest.history];
  for(const lane of lanes) {
    assert(/^[a-f0-9]{64}$/.test(lane?.evidenceStore?.generationSha256));
    assert(/^legal-prepared-[a-f0-9]{64}$/.test(lane.evidenceStore.namespace));
  }
  return runDeploymentPhase(request,bundle,{
    guard,
    selected:async()=> (await pool.query("SELECT coalesce(acceptance_sha256,to_jsonb(s)->>'prepared_acceptance_sha256') AS acceptance_sha256 FROM storage.native_corpus_selections s ORDER BY id DESC LIMIT 1")).rows[0]?.acceptance_sha256,
    fences:async()=>{
      const client=await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
        for(const lane of lanes) {
          const store=(await client.query("SELECT namespace,manifest FROM storage.corpus_evidence_stores WHERE generation_sha256=$1",[lane.evidenceStore.generationSha256])).rows[0];
          assert.equal(store?.namespace,lane.evidenceStore.namespace,"Retained namespace unavailable");
          const descriptor=JSON.parse(Buffer.from(store.manifest).toString("utf8"));
          assert.equal(descriptor.format,"prepared-postgres-evidence-store-v1","Unsupported retained storage format");
        }
        // Verify role access and the projection used by the reader without reading content.
        await client.query("SELECT namespace,key,sha256,content FROM storage.prepared_evidence_objects LIMIT 0");
      } finally {
        try { await client.query("ROLLBACK"); } finally { client.release(); }
      }
    },
    activate:async()=>{throw Error("Retained corpus must not be published");},
  });
}
