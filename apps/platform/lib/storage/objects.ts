import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdir, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Pool } from "pg";

type HttpMetadata = { contentType?: string; contentLanguage?: string; contentDisposition?: string;
  contentEncoding?: string; cacheControl?: string; cacheExpiry?: Date };
type Conditions = { etagMatches?: string; etagDoesNotMatch?: string };
type PutOptions = { onlyIf?: Headers | Conditions; customMetadata?: Record<string, string>;
  httpMetadata?: HttpMetadata | Headers; sha256?: string | ArrayBuffer };
type ObjectRow = { key: string; sha256: string; size: string | number; version: string; uploaded: Date;
  http_metadata: HttpMetadata; custom_metadata: Record<string, string> };
type Range = { offset?: number; length?: number; suffix?: number };

function conditions(input?: Headers | Conditions): Conditions {
  return input instanceof Headers ? {
    etagMatches: input.get("if-match")?.replaceAll('"', "") || undefined,
    etagDoesNotMatch: input.get("if-none-match")?.replaceAll('"', "") || undefined,
  } : input ?? {};
}

const headerNames = { contentType: "content-type", contentLanguage: "content-language",
  contentDisposition: "content-disposition", contentEncoding: "content-encoding", cacheControl: "cache-control" } as const;

/** Object keys are database identities; only content hashes become filesystem paths. */
export class LocalObjectStore {
  readonly root: string;
  constructor(readonly pool: Pool, root: string, readonly bucket: string) { this.root = resolve(root); }

  private path(digest: string) {
    if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error("Invalid stored object digest");
    return join(this.root, digest.slice(0, 2), digest);
  }

  private describe(row: ObjectRow) {
    return { key: row.key, version: row.version, size: Number(row.size), etag: row.sha256,
      httpEtag: `"${row.sha256}"`, uploaded: row.uploaded, storageClass: "Standard",
      checksums: { sha256: Uint8Array.from(Buffer.from(row.sha256, "hex")).buffer },
      customMetadata: row.custom_metadata, httpMetadata: row.http_metadata,
      writeHttpMetadata(headers: Headers) {
        for (const [key, header] of Object.entries(headerNames)) {
          const value = row.http_metadata[key as keyof typeof headerNames];
          if (value !== undefined) headers.set(header, value);
        }
      },
    };
  }

  async head(key: string) {
    const { rows } = await this.pool.query<ObjectRow>("SELECT * FROM storage.objects WHERE bucket=$1 AND key=$2", [this.bucket, key]);
    return rows[0] ? this.describe(rows[0]) : null;
  }

  async get(key: string, options?: { range?: Range; onlyIf?: Headers | Conditions }) {
    const { rows } = await this.pool.query<ObjectRow>("SELECT * FROM storage.objects WHERE bucket=$1 AND key=$2", [this.bucket, key]);
    const row = rows[0];
    if (!row) return null;
    const gate = conditions(options?.onlyIf);
    if ((gate.etagMatches && gate.etagMatches !== "*" && gate.etagMatches !== row.sha256)
      || gate.etagDoesNotMatch === "*" || gate.etagDoesNotMatch === row.sha256) return null;
    const size = Number(row.size);
    const requested = options?.range;
    const offset = requested?.suffix !== undefined ? Math.max(0, size - requested.suffix) : requested?.offset ?? 0;
    const length = Math.min(requested?.length ?? size - offset, size - offset);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
      throw new RangeError("Invalid object byte range");
    }
    const stream = length === 0 ? Readable.from([]) : createReadStream(this.path(row.sha256), { start: offset, end: offset + length - 1 });
    const body = Readable.toWeb(stream) as ReadableStream<Uint8Array>;
    const response = new Response(body);
    return { ...this.describe(row), body,
      get bodyUsed() { return response.bodyUsed; },
      range: requested ? { offset, length } : undefined,
      arrayBuffer: () => response.arrayBuffer(), text: () => response.text(),
      json: <T>() => response.json() as Promise<T>, blob: () => response.blob(),
    };
  }

  async put(key: string, value: string | ArrayBuffer | ArrayBufferView | Blob | ReadableStream | null, options: PutOptions = {}) {
    if (!key || Buffer.byteLength(key) > 1024) throw new Error("Invalid object key");
    await mkdir(this.root, { recursive: true });
    const temporary = join(this.root, `.write-${randomUUID()}`);
    const hash = createHash("sha256");
    let size = 0;
    const source = value instanceof ReadableStream ? Readable.fromWeb(value as import("node:stream/web").ReadableStream)
      : value instanceof Blob ? Readable.fromWeb(value.stream() as import("node:stream/web").ReadableStream)
      : Readable.from([value === null ? Buffer.alloc(0) : typeof value === "string" ? Buffer.from(value)
        : ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength) : Buffer.from(value)]);
    try {
      await pipeline(source, new Transform({ transform(chunk, _encoding, callback) {
        size += chunk.length; hash.update(chunk); callback(null, chunk);
      } }), createWriteStream(temporary, { flags: "wx", mode: 0o600 }));
      const digest = hash.digest("hex");
      const expected = typeof options.sha256 === "string" ? options.sha256 : options.sha256 ? Buffer.from(options.sha256).toString("hex") : null;
      if (expected && expected !== digest) throw new Error("Object SHA-256 mismatch");
      const target = this.path(digest);
      await mkdir(join(this.root, digest.slice(0, 2)), { recursive: true });
      try { await link(temporary, target); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const metadata = options.httpMetadata instanceof Headers
        ? Object.fromEntries(Object.entries(headerNames).flatMap(([name, header]) => {
          const value = (options.httpMetadata as Headers).get(header); return value === null ? [] : [[name, value]];
        })) : options.httpMetadata ?? {};
      const gate = conditions(options.onlyIf);
      const values = [this.bucket, key, digest, size, randomUUID(), JSON.stringify(metadata), JSON.stringify(options.customMetadata ?? {})];
      let sql = `INSERT INTO storage.objects(bucket,key,sha256,size,version,http_metadata,custom_metadata)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`;
      if (gate.etagDoesNotMatch === "*") sql += " ON CONFLICT(bucket,key) DO NOTHING";
      else if (gate.etagMatches) {
        // Conditional replacement must not create a missing object.
        const result = await this.pool.query<ObjectRow>(`UPDATE storage.objects SET sha256=$3,size=$4,version=$5,
          http_metadata=$6::jsonb,custom_metadata=$7::jsonb,uploaded=now()
          WHERE bucket=$1 AND key=$2 AND ($8='*' OR sha256=$8) RETURNING *`, [...values, gate.etagMatches]);
        return result.rows[0] ? this.describe(result.rows[0]) : null;
      } else {
        sql += ` ON CONFLICT(bucket,key) DO UPDATE SET sha256=excluded.sha256,size=excluded.size,
          version=excluded.version,http_metadata=excluded.http_metadata,custom_metadata=excluded.custom_metadata,uploaded=now()`;
        if (gate.etagDoesNotMatch) {
          values.push(gate.etagDoesNotMatch);
          sql += " WHERE storage.objects.sha256<>$8";
        }
      }
      const result = await this.pool.query<ObjectRow>(sql + " RETURNING *", values);
      return result.rows[0] ? this.describe(result.rows[0]) : null;
    } finally {
      await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  }

  async delete(keys: string | string[]) {
    await this.pool.query("DELETE FROM storage.objects WHERE bucket=$1 AND key=ANY($2::text[])", [this.bucket, typeof keys === "string" ? [keys] : keys]);
    // Bytes remain immutable for concurrent readers and are reclaimed by reference-aware maintenance.
  }

  async list(options: { prefix?: string; cursor?: string; limit?: number } = {}) {
    const limit = Math.min(1000, Math.max(1, options.limit ?? 1000));
    const after = options.cursor ? Buffer.from(options.cursor, "base64url").toString("utf8") : "";
    const prefix = (options.prefix ?? "").replace(/[\\%_]/g, "\\$&") + "%";
    const { rows } = await this.pool.query<ObjectRow>(`SELECT * FROM storage.objects
      WHERE bucket=$1 AND key LIKE $2 AND key COLLATE "C">$3 COLLATE "C" ORDER BY key COLLATE "C" LIMIT $4`, [this.bucket, prefix, after, limit + 1]);
    const selected = rows.slice(0, limit);
    return { objects: selected.map(row => this.describe(row)), truncated: rows.length > limit,
      cursor: rows.length > limit ? Buffer.from(selected.at(-1)!.key).toString("base64url") : undefined,
      delimitedPrefixes: [] };
  }
}
