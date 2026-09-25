import type {PoolClient} from "pg";

/** Derive conservative date coverage from the original members in the caller's
 * verified, source-fenced snapshot. Missing or invalid bounds stay universal. */
export async function readVectorCandidateCoverage(client:Pick<PoolClient,"query">,
  generation:string,collection:string,digests:readonly string[]) {
  if(!digests.length)return new Map<string,string|null>();
  const rows=(await client.query<{digest:string;members:number;originals:number;coverage:string|null}>(`
    WITH wanted AS MATERIALIZED (
      SELECT id,digest FROM storage.vector_search_members
      WHERE generation_id=$1 AND digest=ANY($3::bytea[])
    ), originals AS MATERIALIZED (
      SELECT id,metadata FROM storage.embeddings
      WHERE collection=$2 AND id=ANY(ARRAY(SELECT id FROM wanted))
    ), bounds AS (
      SELECT m.digest,e.id,
        CASE WHEN jsonb_typeof(e.metadata->'valid_from_epoch')='number'
          THEN (e.metadata->>'valid_from_epoch')::numeric END AS lower_bound,
        CASE WHEN jsonb_typeof(e.metadata->'valid_to_epoch')='number'
          THEN (e.metadata->>'valid_to_epoch')::numeric END AS upper_bound
      FROM wanted m LEFT JOIN originals e USING(id)
    ) SELECT encode(digest,'hex') AS digest,count(*)::integer AS members,
      count(id)::integer AS originals,
      CASE WHEN bool_and(coalesce(lower_bound<upper_bound,false))
        THEN range_agg(CASE WHEN lower_bound<upper_bound
          THEN numrange(lower_bound,upper_bound,'[)') END)::text END AS coverage
    FROM bounds GROUP BY digest`,[generation,collection,digests.map(value=>Buffer.from(value,"hex"))])).rows;
  if(rows.length!==digests.length||rows.some(row=>row.members!==row.originals)) {
    throw Error("VECTOR_CANDIDATE_MEMBER_COVERAGE_INCOMPLETE");
  }
  return new Map(rows.map(row=>[row.digest,row.coverage]));
}
