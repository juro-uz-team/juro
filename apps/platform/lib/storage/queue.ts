import { randomUUID } from "node:crypto";
import type { Pool } from "pg";

export interface QueueClaim<T = unknown> {
  id: string;
  body: T;
  attempts: number;
  timestamp: Date;
  leaseOwner: string;
}

function delay(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 604_800) throw new RangeError("Invalid queue delay");
  return value;
}

/** Durable delivery with fenced leases; handlers remain responsible for idempotency. */
export class PostgresQueue<T = unknown> {
  constructor(private readonly pool: Pool, readonly name: string) {}

  async send(body: T, options: { delaySeconds?: number; contentType?: string } = {}): Promise<void> {
    await this.sendBatch([{ body, ...options }]);
  }

  async sendBatch(messages: readonly { body: T; delaySeconds?: number; contentType?: string }[]): Promise<void> {
    const rows = messages.map(message => ({ id: randomUUID(), body: message.body, delay: delay(message.delaySeconds ?? 0) }));
    await this.pool.query(`INSERT INTO storage.queue_messages(id,queue,body,available_at)
      SELECT (item->>'id')::uuid,$1,item->'body',clock_timestamp()+(item->>'delay')::double precision*interval '1 second'
      FROM jsonb_array_elements($2::jsonb) item`, [this.name, JSON.stringify(rows)]);
  }

  async claim(options: { leaseMilliseconds?: number } = {}): Promise<QueueClaim<T> | null> {
    const duration = options.leaseMilliseconds ?? 120_000;
    if (!Number.isFinite(duration) || duration < 1) throw new RangeError("Invalid queue lease");
    const owner = randomUUID();
    const result = await this.pool.query(`WITH candidate AS (
      SELECT id FROM storage.queue_messages WHERE queue=$1 AND dead_letter_at IS NULL
      AND available_at <= clock_timestamp() AND (lease_expires_at IS NULL OR lease_expires_at <= clock_timestamp())
      ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE storage.queue_messages m SET lease_owner=$2,lease_expires_at=clock_timestamp()+$3*interval '1 millisecond',
      attempts=attempts+1 FROM candidate WHERE m.id=candidate.id
      RETURNING m.id,m.body,m.attempts,m.created_at`, [this.name, owner, duration]);
    const row = result.rows[0];
    return row ? { id: row.id, body: row.body, attempts: row.attempts, timestamp: row.created_at, leaseOwner: owner } : null;
  }

  async acknowledge(claim: QueueClaim<T>): Promise<boolean> {
    const result = await this.pool.query(`DELETE FROM storage.queue_messages
      WHERE queue=$1 AND id=$2 AND lease_owner=$3 AND lease_expires_at>clock_timestamp()`, [this.name, claim.id, claim.leaseOwner]);
    return result.rowCount === 1;
  }

  async metrics() {
    const { rows } = await this.pool.query(`SELECT count(*)::integer AS count,
      coalesce(sum(octet_length(body::text)),0)::bigint AS bytes,min(created_at) AS oldest
      FROM storage.queue_messages WHERE queue=$1`, [this.name]);
    return { backlogCount: rows[0].count, backlogBytes: Number(rows[0].bytes),
      ...(rows[0].oldest ? { oldestMessageTimestamp: rows[0].oldest as Date } : {}) };
  }

  async park(claim: QueueClaim<T>): Promise<boolean> {
    const result = await this.pool.query(`UPDATE storage.queue_messages SET dead_letter_at=clock_timestamp(),
      lease_owner=NULL,lease_expires_at=NULL WHERE queue=$1 AND id=$2 AND lease_owner=$3
      AND lease_expires_at>clock_timestamp()`, [this.name, claim.id, claim.leaseOwner]);
    return result.rowCount === 1;
  }

  async renew(claim: QueueClaim<T>, milliseconds = 120_000): Promise<boolean> {
    if (!Number.isFinite(milliseconds) || milliseconds < 1) throw new RangeError("Invalid queue lease");
    const result = await this.pool.query(`UPDATE storage.queue_messages SET lease_expires_at=clock_timestamp()+$4*interval '1 millisecond'
      WHERE queue=$1 AND id=$2 AND lease_owner=$3 AND lease_expires_at>clock_timestamp()`, [this.name, claim.id, claim.leaseOwner, milliseconds]);
    return result.rowCount === 1;
  }

  async retry(claim: QueueClaim<T>, delaySeconds = 30): Promise<boolean> {
    const result = await this.pool.query(`UPDATE storage.queue_messages SET lease_owner=NULL,lease_expires_at=NULL,
      available_at=clock_timestamp()+$4*interval '1 second'
      WHERE queue=$1 AND id=$2 AND lease_owner=$3 AND lease_expires_at>clock_timestamp()`, [this.name, claim.id, claim.leaseOwner, delay(delaySeconds)]);
    return result.rowCount === 1;
  }

  async deadLetter(claim: QueueClaim<T>): Promise<boolean> {
    const result = await this.pool.query(`UPDATE storage.queue_messages SET queue=queue||'-dlq',attempts=0,
      lease_owner=NULL,lease_expires_at=NULL,available_at=clock_timestamp()
      WHERE queue=$1 AND id=$2 AND lease_owner=$3 AND lease_expires_at>clock_timestamp()`, [this.name, claim.id, claim.leaseOwner]);
    return result.rowCount === 1;
  }
}
