import type {Pool} from "pg";
import {createHash} from "node:crypto";
import {z} from "zod";
import {retrievalQuery} from "./retrieval-connection";

/** A missing object is not evidence of deliberate retirement. */
export async function isRetiredCorpusObject(pool:Pool, namespace:string, key:string, sha256:string):Promise<boolean> {
  const result=await retrievalQuery(pool,`SELECT 1 FROM storage.retired_corpus_objects
    WHERE namespace=$1 AND object_key=$2 AND content_sha256=$3 LIMIT 1`,[namespace,key,sha256]);
  return result.rows.length===1;
}

const digest=z.string().regex(/^[a-f0-9]{64}$/u);
const names=z.array(z.string().min(1).max(700)).min(1).max(100)
  .refine(values=>new Set(values).size===values.length,"Duplicate retirement target");
export const corpusRetirementInventorySchema=z.object({
  version:z.literal(1),expectedAcceptance:digest,
  vectorCollections:names,membershipReleases:names,objectNamespaces:names,
  objects:z.object({count:z.number().int().nonnegative(),sha256:digest}).strict(),
  preservationProofSha256:digest,quiescenceProofSha256:digest,
}).strict().refine(value=>!value.objectNamespaces.includes("application")
  &&!value.vectorCollections.some(name=>["advice","lex","user-documents"].includes(name)),"Private collections cannot be retired here");

/** Operator-only transition after reviewed inventory and reader/writer drain.
 * Records exact evidence identities and disables old generations atomically.
 * It never deletes payloads; reclamation uses the committed inventory separately.
 */
export async function retireNativeCorpus(pool:Pool,manifestBytes:Uint8Array):Promise<{inventorySha256:string;objects:number}> {
  if(manifestBytes.byteLength>1048576)throw Error("CORPUS_RETIREMENT_MANIFEST_TOO_LARGE");
  const manifest=corpusRetirementInventorySchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(manifestBytes)));
  const inventorySha256=createHash("sha256").update(manifestBytes).digest("hex");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('native-corpus-selection',0))");
    const selected=(await client.query(`SELECT acceptance_sha256 FROM storage.native_corpus_selections ORDER BY id DESC LIMIT 1`)).rows[0];
    if(selected?.acceptance_sha256!==manifest.expectedAcceptance)throw Error("CORPUS_RETIREMENT_SELECTION_CHANGED");
    // Freeze ownership while checking the exact inventory; physical cleanup is later.
    await client.query("LOCK TABLE storage.objects,storage.vector_collections,storage.vector_search_generations,storage.corpus_membership_generations IN SHARE ROW EXCLUSIVE MODE");
    const vectors=(await client.query("SELECT id,collection FROM storage.vector_search_generations WHERE collection=ANY($1::text[])",[manifest.vectorCollections])).rows;
    const memberships=(await client.query("SELECT id,release_id FROM storage.corpus_membership_generations WHERE release_id=ANY($1::text[])",[manifest.membershipReleases])).rows;
    if(manifest.vectorCollections.some(name=>!vectors.some(row=>row.collection===name))
      ||manifest.membershipReleases.some(name=>!memberships.some(row=>row.release_id===name)))throw Error("CORPUS_RETIREMENT_TARGET_MISSING");
    const vectorIds=vectors.map(row=>row.id),membershipIds=memberships.map(row=>row.id);
    const affected=(await client.query(`SELECT sha256,current_vector_generation,history_vector_generation,current_membership_generation,history_membership_generation
      FROM storage.native_corpus_acceptances WHERE current_vector_generation=ANY($1::uuid[]) OR history_vector_generation=ANY($1::uuid[])
      OR current_membership_generation=ANY($2::uuid[]) OR history_membership_generation=ANY($2::uuid[])`,[vectorIds,membershipIds])).rows;
    if(!affected.some(row=>row.sha256===manifest.expectedAcceptance))throw Error("CORPUS_RETIREMENT_ACCEPTANCE_MISSING");
    for(const row of affected){
      if(![row.current_vector_generation,row.history_vector_generation].every(id=>vectorIds.includes(id))
        ||![row.current_membership_generation,row.history_membership_generation].every(id=>membershipIds.includes(id)))throw Error("CORPUS_RETIREMENT_SHARED_GENERATION");
    }
    // Hash the ordered full object identity inventory without accumulating it.
    const objectsHash=createHash("sha256");let count=0;let cursor:[string,string]|null=null;
    for(;;){
      const page:Array<{bucket:string;key:string;sha256:string;size:string}>=(await client.query(`SELECT bucket,key,sha256,size::text FROM storage.objects
        WHERE bucket=ANY($1::text[]) AND ($2::text IS NULL OR (bucket COLLATE "C",key COLLATE "C")>($2::text COLLATE "C",$3::text COLLATE "C"))
        ORDER BY bucket COLLATE "C",key COLLATE "C" LIMIT 2000`,[manifest.objectNamespaces,cursor?.[0]??null,cursor?.[1]??null])).rows;
      if(!page.length)break;
      for(const row of page){objectsHash.update(JSON.stringify([row.bucket,row.key,row.sha256,row.size])+"\n");count++;}
      cursor=[page.at(-1)!.bucket,page.at(-1)!.key];
    }
    if(count!==manifest.objects.count||objectsHash.digest("hex")!==manifest.objects.sha256)throw Error("CORPUS_RETIREMENT_OBJECTS_CHANGED");
    for(const row of affected)await client.query(`INSERT INTO storage.corpus_retirements(acceptance_sha256,inventory_sha256,inventory_manifest)
      VALUES($1,$2,$3)`,[row.sha256,inventorySha256,Buffer.from(manifestBytes)]);
    await client.query(`INSERT INTO storage.retired_corpus_objects(namespace,object_key,content_sha256,acceptance_sha256)
      SELECT bucket,key,sha256,$2 FROM storage.objects WHERE bucket=ANY($1::text[])`,[manifest.objectNamespaces,manifest.expectedAcceptance]);
    await client.query("UPDATE storage.vector_collections SET ready=false WHERE name=ANY($1::text[])",[manifest.vectorCollections]);
    await client.query("UPDATE storage.vector_search_generations SET state='retired' WHERE id=ANY($1::uuid[])",[vectorIds]);
    await client.query("UPDATE storage.corpus_membership_generations SET state='retired' WHERE id=ANY($1::uuid[])",[membershipIds]);
    for(const [kind,identities] of [["vector",manifest.vectorCollections],["object",manifest.objectNamespaces],["membership",manifest.membershipReleases]] as const)
      await client.query(`INSERT INTO storage.retired_corpus_stores(kind,identity,acceptance_sha256)
        SELECT $1,unnest($2::text[]),$3`,[kind,identities,manifest.expectedAcceptance]);
    await client.query("COMMIT");return {inventorySha256,objects:count};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
