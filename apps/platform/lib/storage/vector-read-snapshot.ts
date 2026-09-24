import type {PoolClient} from "pg";

/** Pin original vectors before establishing the metadata/generation snapshot.
 * TRUNCATE is not MVCC-safe: an old collection revision alone cannot protect
 * a transaction which has not yet locked the original-vector relation. */
export async function beginVectorRead(client: Pick<PoolClient, "query">) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("LOCK TABLE storage.embeddings IN ACCESS SHARE MODE");
}
