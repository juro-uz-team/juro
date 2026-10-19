import {createHash} from "node:crypto";
import {isAbsolute,resolve} from "node:path";
import type {Pool} from "pg";
import {corpusRetirementInventorySchema} from "./corpus-retirement";

const phases=["objects","vector-members","vector-groups","memberships","membership-pages","embeddings"] as const;
export type CorpusReclamationPhase=typeof phases[number];

/** Operator-only bounded deletion after committed retirement and process drain.
 * Keep acceptance/generation headers and exact citation tombstones permanently.
 * Object hashes are queued for the existing reference-aware reclaimer; this
 * operation does not unlink files or claim physical disk reclamation.
 */
export async function reclaimRetiredCorpusBatch(input:{pool:Pool;manifestBytes:Uint8Array;
  phase:CorpusReclamationPhase;objectRoots:string[];limit?:number}){
  const {pool,manifestBytes,phase}=input,limit=input.limit??1000;
  if(!phases.includes(phase)||!Number.isSafeInteger(limit)||limit<1||limit>2000
    ||manifestBytes.byteLength>1048576)throw Error("CORPUS_RECLAMATION_REQUEST_INVALID");
  const manifest=corpusRetirementInventorySchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(manifestBytes)));
  const inventorySha256=createHash("sha256").update(manifestBytes).digest("hex");
  if(input.objectRoots.length<1||input.objectRoots.length>8||input.objectRoots.some(root=>!isAbsolute(root)||resolve(root)!==root)
    ||new Set(input.objectRoots).size!==input.objectRoots.length)throw Error("CORPUS_RECLAMATION_ROOT_INVALID");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout='10s'");
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('native-corpus-selection',0))");
    const retired=(await client.query(`SELECT inventory_sha256 FROM storage.corpus_retirements WHERE acceptance_sha256=$1`,[manifest.expectedAcceptance])).rows[0];
    if(retired?.inventory_sha256!==inventorySha256)throw Error("CORPUS_RECLAMATION_RETIREMENT_MISMATCH");
    const stores=(await client.query("SELECT kind,identity FROM storage.retired_corpus_stores WHERE acceptance_sha256=$1",[manifest.expectedAcceptance])).rows;
    for(const [kind,names] of [["vector",manifest.vectorCollections],["membership",manifest.membershipReleases],["object",manifest.objectNamespaces]] as const){
      if(names.some(name=>!stores.some(row=>row.kind===kind&&row.identity===name)))throw Error("CORPUS_RECLAMATION_STORE_MISMATCH");
    }
    const vectors=(await client.query(`SELECT id,state FROM storage.vector_search_generations WHERE collection=ANY($1::text[]) FOR SHARE`,[manifest.vectorCollections])).rows;
    const memberships=(await client.query(`SELECT id,state FROM storage.corpus_membership_generations WHERE release_id=ANY($1::text[]) FOR SHARE`,[manifest.membershipReleases])).rows;
    if([...vectors,...memberships].some(row=>row.state!=="retired"))throw Error("CORPUS_RECLAMATION_GENERATION_ACTIVE");
    let removed:number;
    if(phase==="objects"){
      // A surviving namespace may reference the same hash. Physical deletion
      // is separately fenced and checks all surviving catalog references.
      const rows=(await client.query(`WITH selected AS (
        SELECT o.bucket,o.key FROM storage.objects o JOIN storage.retired_corpus_objects r
          ON r.namespace=o.bucket AND r.object_key=o.key AND r.content_sha256=o.sha256
        WHERE o.bucket=ANY($1::text[]) AND r.acceptance_sha256=$2
        ORDER BY o.bucket,o.key LIMIT $3 FOR UPDATE OF o
      ) DELETE FROM storage.objects o USING selected s WHERE o.bucket=s.bucket AND o.key=s.key RETURNING o.sha256`,
      [manifest.objectNamespaces,manifest.expectedAcceptance,limit])).rows;
      removed=rows.length;
      if(!removed&&(await client.query("SELECT 1 FROM storage.objects WHERE bucket=ANY($1::text[]) LIMIT 1",[manifest.objectNamespaces])).rows.length){
        throw Error("CORPUS_RECLAMATION_OBJECT_IDENTITY_MISMATCH");
      }
      if(rows.length)await client.query(`INSERT INTO storage.object_reclamation(root,sha256)
        SELECT root,sha FROM unnest($1::text[]) root CROSS JOIN unnest($2::text[]) sha
        ON CONFLICT(root,sha256) DO NOTHING`,[input.objectRoots,[...new Set(rows.map(row=>row.sha256))]]);
    }else{
      const tables={"vector-members":"vector_search_members","vector-groups":"vector_search_groups",
        memberships:"corpus_members","membership-pages":"corpus_membership_pages",embeddings:"embeddings"} as const;
      const table=tables[phase],embedding=phase==="embeddings";
      const ids=embedding?manifest.vectorCollections:(phase.startsWith("vector-")?vectors:memberships).map(row=>row.id);
      // Groups must follow member deletion: otherwise FK cascading would make
      // a nominally bounded group batch delete an unbounded number of members.
      if(phase==="vector-groups"&&(await client.query("SELECT 1 FROM storage.vector_search_members WHERE generation_id=ANY($1::uuid[]) LIMIT 1",[ids])).rows.length){
        throw Error("CORPUS_RECLAMATION_MEMBERS_REMAIN");
      }
      const result=await client.query(`WITH selected AS (
        SELECT ctid FROM storage.${table} WHERE ${embedding?"collection=ANY($1::text[])":"generation_id=ANY($1::uuid[])"} LIMIT $2 FOR UPDATE
      ) DELETE FROM storage.${table} t USING selected s WHERE t.ctid=s.ctid`,[ids,phase==="membership-pages"?1:limit]);
      removed=result.rowCount??0;
    }
    await client.query("COMMIT");return {phase,removed,inventorySha256};
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
