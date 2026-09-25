import {normalizedLegalSourceSnapshotSchema} from "../legal/source-parser";
import type {LegalEvidenceBucket} from "./target-evidence";

type Snapshot=ReturnType<typeof normalizedLegalSourceSnapshotSchema.parse>;
const parsedSnapshots=new Map<string,{snapshot:Snapshot;estimatedBytes:number}>();
let parsedBytes=0;
const PARSED_BUDGET=128*1024*1024;

/** Estimate retained JS strings/containers while making shared derived state
 * immutable. Physical source bytes are never retained by this cache. */
function freezeSnapshot(value:unknown):number {
  if(typeof value==="string")return 32+value.length*2;
  if(value===null||typeof value!=="object")return 8;
  let bytes=Array.isArray(value)?64+value.length*8:128;
  for(const [key,item] of Object.entries(value))bytes+=key.length*2+freezeSnapshot(item);
  Object.freeze(value);return bytes;
}
function parsedSnapshot(sha256:string,bytes:Uint8Array):Snapshot {
  const cached=parsedSnapshots.get(sha256);
  if(cached){parsedSnapshots.delete(sha256);parsedSnapshots.set(sha256,cached);return cached.snapshot;}
  const snapshot=normalizedLegalSourceSnapshotSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
  const estimatedBytes=freezeSnapshot(snapshot);
  if(estimatedBytes<=PARSED_BUDGET){
    while(parsedSnapshots.size>=64||parsedBytes+estimatedBytes>PARSED_BUDGET){
      const oldest=parsedSnapshots.entries().next().value;if(!oldest)break;
      parsedSnapshots.delete(oldest[0]);parsedBytes-=oldest[1].estimatedBytes;
    }
    parsedSnapshots.set(sha256,{snapshot,estimatedBytes});parsedBytes+=estimatedBytes;
  }
  return snapshot;
}

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
      // Reuse only derived, frozen state after this request authenticates
      // the current physical object. A warm cache cannot hide corruption.
      const snapshot = parsedSnapshot(actual,bytes);
      const parent = {snapshot, r2Key, byteCount: bytes.byteLength, sha256};
      // A turn can read dozens of provisions from several large codes.
      // Keep their authenticated parents for the turn instead of repeatedly
      // parsing an evicted code. This remains bounded and request-local.
      while (cached.size >= 24 || cachedBytes + parent.byteCount > 32_000_000) {
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
