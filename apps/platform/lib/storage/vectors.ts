import { randomUUID } from "node:crypto";
import {beginVectorRead} from "./vector-read-snapshot";
import {compactVectorScope, supportsCompactVector} from "./vector-search-generation";
import type { Pool } from "pg";
import {acquireRetrievalClient,retrievalQuery} from "./retrieval-connection";
import type {VectorCandidateReader} from "./vector-candidates";

type Metric = "cosine" | "euclidean" | "dot-product";
type Vector = { id: string; values: number[] | Float32Array; namespace?: string; metadata?: Record<string, unknown> };
type Configuration = { dimensions: number; metric: Metric; model?: string; ready?: boolean };
type QueryOptions = { topK?: number; namespace?: string; filter?: Record<string, unknown>;
  returnMetadata?: "all" | "indexed" | "none" | boolean; returnValues?: boolean };

function vectorLiteral(values: number[] | Float32Array, dimensions: number): string {
  const array = Array.from(values);
  if (array.length !== dimensions || !array.every(Number.isFinite)) throw new Error("Invalid embedding dimensions or values");
  return `[${array.join(",")}]`;
}

/** Compile only supported filter operators; paths and values are always parameters. */
function filterSql(filter: Record<string, unknown>, parameters: unknown[], depth = 0): string {
  if (depth > 8) throw new Error("Vector filter is too deeply nested");
  const bind = (value: unknown) => { parameters.push(value); return `$${parameters.length}`; };
  const predicates: string[] = [];
  for (const [field, value] of Object.entries(filter)) {
    if (field === "$and" || field === "$or") {
      if (!Array.isArray(value) || value.length === 0 || value.length > 64) throw new Error("Invalid vector filter group");
      predicates.push(`(${value.map(item => filterSql(item, parameters, depth + 1)).join(field === "$and" ? " AND " : " OR ")})`);
      continue;
    }
    if (field.startsWith("$") || !field || field.length > 512) throw new Error("Unsupported vector filter field");
    const path = `metadata #> ${bind(field.split("."))}::text[]`;
    const operations = value !== null && typeof value === "object" && !Array.isArray(value) ? value : { $eq: value };
    for (const [operator, operand] of Object.entries(operations)) {
      const comparisons: Record<string, string> = { $eq: "=", $ne: "<>", $gt: ">", $gte: ">=", $lt: "<", $lte: "<=" };
      if (operator === "$in" || operator === "$nin") {
        if (!Array.isArray(operand) || operand.length === 0 || operand.length > 100) throw new Error("Invalid vector filter set");
        predicates.push(`${path} ${operator === "$in" ? "IN" : "NOT IN"} (${operand.map(item => `${bind(JSON.stringify(item))}::jsonb`).join(",")})`);
      } else if (comparisons[operator]) {
        if (operand === undefined || (operand !== null && !["string", "number", "boolean"].includes(typeof operand))) throw new Error("Invalid vector filter value");
        predicates.push(`${path} ${comparisons[operator]} ${bind(JSON.stringify(operand))}::jsonb`);
      } else throw new Error("Unsupported vector filter operator");
    }
  }
  return predicates.length ? `(${predicates.join(" AND ")})` : "TRUE";
}

export class PostgresVectorIndex {
  constructor(readonly pool: Pool, readonly name: string, private readonly readCandidates?:VectorCandidateReader) {}

  async isReady(): Promise<boolean> {
    const result = await retrievalQuery(this.pool,"SELECT ready FROM storage.vector_collections WHERE name=$1", [this.name]);
    return result.rows[0]?.ready === true;
  }

  async create(configuration: Configuration) {
    if (!Number.isInteger(configuration.dimensions) || configuration.dimensions < 1 || configuration.dimensions > 16000) throw new Error("Invalid vector dimensions");
    await this.pool.query(`INSERT INTO storage.vector_collections(name,dimensions,metric,model,ready)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(name) DO NOTHING`, [this.name, configuration.dimensions, configuration.metric, configuration.model ?? null, configuration.ready ?? true]);
    const actual = await this.configuration();
    if (actual.dimensions !== configuration.dimensions || actual.metric !== configuration.metric) throw new Error("Existing vector collection has incompatible configuration");
  }

  private async configuration(): Promise<Configuration> {
    const { rows } = await retrievalQuery<Configuration>(this.pool,"SELECT dimensions,metric,model,ready FROM storage.vector_collections WHERE name=$1", [this.name]);
    if (!rows[0]) throw new Error(`Vector collection is unavailable: ${this.name}`);
    return rows[0];
  }

  async upsert(vectors: Vector[]) {
    const configuration = await this.configuration();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const vector of vectors) {
        await client.query(`INSERT INTO storage.embeddings(collection,namespace,id,embedding,metadata)
          VALUES($1,$2,$3,$4::vector,$5::jsonb) ON CONFLICT(collection,id) DO UPDATE
          SET namespace=excluded.namespace,embedding=excluded.embedding,metadata=excluded.metadata`,
        [this.name, vector.namespace ?? "", vector.id, vectorLiteral(vector.values, configuration.dimensions), JSON.stringify(vector.metadata ?? {})]);
      }
      await client.query("COMMIT");
      return { mutationId: randomUUID(), count: vectors.length };
    } catch (error) {
      await client.query("ROLLBACK"); throw error;
    } finally { client.release(); }
  }

  async query(values: number[] | Float32Array, options: QueryOptions = {}) {
    const lease = await acquireRetrievalClient(this.pool);
    const client = lease.client;
    try {
    await beginVectorRead(client);
    const configuration = (await client.query<Configuration>("SELECT dimensions,metric,model,ready FROM storage.vector_collections WHERE name=$1", [this.name])).rows[0];
    if (!configuration) throw new Error(`Vector collection is unavailable: ${this.name}`);
    if (!configuration.ready) throw new Error("Vector collection import has not been verified");
    const literal = vectorLiteral(values, configuration.dimensions);
    if (configuration.metric === "cosine" && Array.from(values).every(value => value === 0)) throw new Error("Cosine query requires a nonzero vector");
    const topK = options.topK ?? 10;
    if (!Number.isInteger(topK) || topK < 1 || topK > 1000) throw new Error("Invalid vector result limit");
    const parameters: unknown[] = [this.name, literal];
    const where = ["collection=$1"];
    if (options.namespace !== undefined) { parameters.push(options.namespace); where.push(`namespace=$${parameters.length}`); }
    if (options.filter) where.push(filterSql(options.filter, parameters));
    const operator = { cosine: "<=>", euclidean: "<->", "dot-product": "<#>" }[configuration.metric];
    const operand = `embedding::vector(${configuration.dimensions})`;
    const distance = `${operand} ${operator} $2::vector(${configuration.dimensions})`;
    const score = configuration.metric === "cosine" ? `1 - (${distance})`
      : configuration.metric === "dot-product" ? `-(${distance})` : `(${distance})`;
    parameters.push(topK);
    let rows: Array<{ id: string; namespace: string; score: number; metadata?: Record<string, unknown>; values?: string }>;
      await client.query("SET LOCAL statement_timeout = '15s'");
      // Short retrieval queries spend more time compiling JIT expressions than
      // executing them, especially when several formulations run together.
      await client.query("SET LOCAL jit = off");
      await client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
      await client.query("SET LOCAL hnsw.ef_search = 1000");
      await client.query("SET LOCAL hnsw.max_scan_tuples = 100000");
      const select = `SELECT id,namespace,${score} AS score${options.returnMetadata && options.returnMetadata !== "none" ? ",metadata" : ""}
        ${options.returnValues ? ",embedding::text AS values" : ""} FROM storage.embeddings
        WHERE ${where.join(" AND ")}`;
      // Small eligible sets are faster and complete with exact distances. Probe
      // IDs only, avoiding vector decompression while estimating selectivity.
      // Temporal probes follow the metadata index instead of repeatedly scanning
      // the historical heap. Order does not affect the small-set count or IDs;
      // large sets discard these probe IDs and perform their own ANN search.
      const probeOrder=options.filter && Object.hasOwn(options.filter,"valid_from_epoch")
        && Object.hasOwn(options.filter,"valid_to_epoch")
        ? " ORDER BY metadata #> '{valid_to_epoch}',metadata #> '{valid_from_epoch}'" : "";
      const eligible = where.length > 1 ? (await client.query(
        `SELECT id FROM storage.embeddings WHERE ${where.join(" AND ")} AND $2::text IS NOT NULL${probeOrder} LIMIT 10001`, parameters.slice(0, -1))).rows : null;
      if (eligible && eligible.length <= 10000) {
        const exactParameters = [...parameters, eligible.map(row => row.id)];
        rows = (await client.query(`${select} AND id=ANY($${exactParameters.length}::text[])
          ORDER BY (${distance}) + 0,id LIMIT $${parameters.length}`, exactParameters)).rows;
      } else {
        const scope = configuration.metric === "cosine" && configuration.dimensions === 1536 && topK <= 50 && supportsCompactVector(values)
          ? compactVectorScope(options.filter, options.namespace) : null;
        const generation = scope ? (await client.query<{id: string; current: boolean; source_revision:string}>(`SELECT g.id,g.source_revision,c.source_revision=g.source_revision AS current
          FROM storage.vector_search_generations g JOIN storage.vector_collections c
          ON c.name=g.collection
          WHERE g.collection=$1 AND g.state='verified'
          ORDER BY (c.source_revision=g.source_revision) DESC,g.created_at DESC,g.id LIMIT 1`, [this.name])).rows[0] : undefined;
        if (generation && !generation.current) {
          // A stale prepared graph cannot silently lower recall. Exhaustive
          // original-vector fallback remains subject to the shared deadline.
          rows = (await client.query(`${select} ORDER BY (${distance}) + 0,id LIMIT $${parameters.length}`, parameters)).rows;
        } else if (generation && scope) {
          await client.query("SET LOCAL hnsw.ef_search = 200");
          // PostgreSQL can underestimate selective temporal sorting and scan
          // every toasted vector instead of using the compact graph.
          await client.query("SET LOCAL enable_sort = off");
          const groupParameters = [...parameters, generation.id];
          const generationParameter = `$${groupParameters.length}::uuid`;
          let temporalPredicate = "";
          if (scope.instant !== undefined) {
            groupParameters.push(scope.instant);
            temporalPredicate = `AND (g.coverage IS NULL OR g.coverage @> $${groupParameters.length}::numeric)`;
          }
          let candidateSelection="ORDER BY g.embedding::halfvec(1536) <=> $2::text::halfvec(1536) LIMIT 250";
          if(this.readCandidates){
            const digests=await this.readCandidates({collection:this.name,generation:generation.id,
              sourceRevision:String(generation.source_revision),values:Array.from(values),instant:scope.instant});
            groupParameters.push(digests.map(digest=>Buffer.from(digest,"hex")));
            candidateSelection=`AND g.digest=ANY($${groupParameters.length}::bytea[])`;
          }
          // Group selection is approximate; original identities, filters,
          // full-precision scores and returned values remain authoritative.
          // Materialize identity sets before reading originals. Freshly built
          // generations may be absent from statistics; a join can otherwise
          // scan the entire collection once for each duplicate member.
          // Publication proves bit-identical full-precision group vectors.
          // Score each group once, avoiding repeated original-vector TOAST
          // reads; identities, filters, metadata and returned vectors are original.
          rows = (await client.query(`WITH nearest AS MATERIALIZED (
            SELECT g.digest,g.embedding FROM storage.vector_search_groups g
            WHERE g.generation_id=${generationParameter} ${temporalPredicate}
            ${candidateSelection}
          ), scores AS MATERIALIZED (
            SELECT digest,1-(embedding::vector(1536) <=> $2::text::vector(1536)) AS score FROM nearest
          ), members AS MATERIALIZED (
            SELECT id,(SELECT score FROM scores WHERE scores.digest=storage.vector_search_members.digest) AS score
            FROM storage.vector_search_members
            WHERE generation_id=${generationParameter}
              AND digest=ANY(ARRAY(SELECT digest FROM nearest))
          ), score_map AS MATERIALIZED (
            SELECT jsonb_object_agg(id,score) AS values FROM members
          ) SELECT id,namespace,((SELECT values FROM score_map)->>id)::double precision AS score
          ${options.returnMetadata && options.returnMetadata !== "none" ? ",metadata" : ""}
          ${options.returnValues ? ",embedding::text AS values" : ""} FROM storage.embeddings
          WHERE ${where.join(" AND ")} AND id=ANY(ARRAY(SELECT id FROM members))
            ORDER BY score DESC,id LIMIT $${parameters.length}`, groupParameters)).rows;
          await client.query("SET LOCAL enable_sort = on");
        } else {
        // JSON metadata selectivity estimates can otherwise prefer an expensive
        // exact sort even when most of the collection is eligible.
        await client.query("SET LOCAL enable_sort = off");
        // Relaxed iterative scans improve filtered recall. Fetch a bounded
        // candidate pool, then rank by the original vector distances below.
        const candidateParameters=[...parameters.slice(0,-1),Math.min(1000,topK*10)];
        rows = (await client.query(`${select} ORDER BY ${distance} LIMIT $${parameters.length}`, candidateParameters)).rows;
        await client.query("SET LOCAL enable_sort = on");
        }
      }
      // Selective filters can exhaust an ANN scan's budget. An exact fallback
      // distinguishes genuinely small result sets from missed eligible rows.
      if ((!eligible || eligible.length > 10000) && rows.length < topK) rows = (await client.query(
        `${select} ORDER BY (${distance}) + 0,id LIMIT $${parameters.length}`, parameters)).rows;
      await client.query("COMMIT");
    rows.sort((left,right) => (configuration.metric === "euclidean" ? left.score-right.score : right.score-left.score) || left.id.localeCompare(right.id));
    rows=rows.slice(0,topK);
    return { count: rows.length, matches: rows.map(row => ({ ...row, ...(row.values ? { values: JSON.parse(row.values) as number[] } : {}) })) };
    } catch (error) { await client.query("ROLLBACK").catch(()=>undefined); throw error; }
    finally { lease.release(); }
  }

  async getByIds(ids: string[]) {
    const { rows } = await this.pool.query("SELECT id,namespace,embedding::text AS values,metadata FROM storage.embeddings WHERE collection=$1 AND id=ANY($2::text[])", [this.name, ids]);
    return rows.map(row => ({ ...row, values: JSON.parse(row.values) as number[] }));
  }

  async deleteByIds(ids: string[]) {
    const result = await this.pool.query("DELETE FROM storage.embeddings WHERE collection=$1 AND id=ANY($2::text[])", [this.name, ids]);
    return { mutationId: randomUUID(), count: result.rowCount ?? 0 };
  }

  async describe() {
    const configuration = await this.configuration();
    const result = await this.pool.query("SELECT count(*)::integer AS count FROM storage.embeddings WHERE collection=$1", [this.name]);
    return { name: this.name, dimensions: configuration.dimensions, metric: configuration.metric, vectorCount: result.rows[0].count };
  }
}
