import {normalizedLegalSourceSnapshotSchema} from "../legal/source-parser";
import type {LegalEvidenceBucket} from "./target-evidence";

/** A reader belongs to one request, never to a process-wide cache. Every new
 * request authenticates physical parent bytes before using their projection. */
export function createNormalizedSourceReader(bucket: Pick<LegalEvidenceBucket, "get">) {
  type Parent = {snapshot: ReturnType<typeof normalizedLegalSourceSnapshotSchema.parse>;
    r2Key: string; byteCount: number; sha256: string};
  const cached = new Map<string, Parent>();
  const pending = new Map<string, Promise<Parent>>();
  const lanes = [Promise.resolve(), Promise.resolve()];
  let nextLane = 0;
  let cachedBytes = 0;
  return (revision: string, sha256: string): Promise<Parent> => {
    const r2Key = `corpus/normalized/${revision}.json`;
    const key = JSON.stringify([r2Key, sha256]);
    const previous = cached.get(key);
    if (previous) {cached.delete(key); cached.set(key, previous); return Promise.resolve(previous);}
    const active = pending.get(key);
    if (active) return active;
    const lane = nextLane++ % lanes.length;
    const read = lanes[lane]!.then(async () => {
      const object = await bucket.get(r2Key);
      // Match the existing citation envelope: authenticated retained parents
      // can exceed four MB even when each individual article is small.
      if (!object || object.size > 8_000_000) throw new TypeError("PINNED_SOURCE_REVISION_UNAVAILABLE");
      const bytes = await object.bytes();
      const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
      const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      if (bytes.byteLength !== object.size || actual !== sha256) throw new TypeError("PINNED_SOURCE_REVISION_INVALID");
      const snapshot = normalizedLegalSourceSnapshotSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
      const parent = {snapshot, r2Key, byteCount: bytes.byteLength, sha256};
      while (cached.size >= 3 || cachedBytes + parent.byteCount > 8_000_000) {
        const oldest = cached.entries().next().value;
        if (!oldest) break;
        cached.delete(oldest[0]); cachedBytes -= oldest[1].byteCount;
      }
      cached.set(key, parent); cachedBytes += parent.byteCount;
      return parent;
    }).finally(() => {pending.delete(key);});
    pending.set(key, read);
    lanes[lane] = read.then(() => undefined, () => undefined);
    return read;
  };
}
export type NormalizedSourceReader = ReturnType<typeof createNormalizedSourceReader>;
