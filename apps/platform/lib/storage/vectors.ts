import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

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
  constructor(readonly pool: Pool, readonly name: string) {}

  async isReady(): Promise<boolean> {
    const result = await this.pool.query("SELECT ready FROM storage.vector_collections WHERE name=$1", [this.name]);
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
    const { rows } = await this.pool.query<Configuration>("SELECT dimensions,metric,model,ready FROM storage.vector_collections WHERE name=$1", [this.name]);
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
    const configuration = await this.configuration();
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
    const score = configuration.metric === "cosine" ? `1 - (embedding ${operator} $2::vector)`
      : configuration.metric === "dot-product" ? `-(embedding ${operator} $2::vector)` : `(embedding ${operator} $2::vector)`;
    parameters.push(topK);
    const { rows } = await this.pool.query<{ id: string; namespace: string; score: number; metadata?: Record<string, unknown>; values?: string }>(
      `SELECT id,namespace,${score} AS score${options.returnMetadata && options.returnMetadata !== "none" ? ",metadata" : ""}
      ${options.returnValues ? ",embedding::text AS values" : ""} FROM storage.embeddings
      WHERE ${where.join(" AND ")} ORDER BY embedding ${operator} $2::vector,id LIMIT $${parameters.length}`, parameters);
    return { count: rows.length, matches: rows.map(row => ({ ...row, ...(row.values ? { values: JSON.parse(row.values) as number[] } : {}) })) };
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
