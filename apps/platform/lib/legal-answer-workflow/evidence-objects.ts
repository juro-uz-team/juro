import { legalAnswerDeadlineMs } from "./deadline";
import { createHash } from "node:crypto";
import type { PreparedEvidenceStore } from "../storage/prepared-evidence-objects";
import { runIndexedRetrieval } from "../runtime/indexed-retrieval";

type Store = Pick<PreparedEvidenceStore, "namespace" | "get" | "put">;
export const evidenceObjectMaximum = (key: string) => (key.startsWith("legal-evidence/raw/") ? 16 : 8) * 1024 * 1024;

function expectedDigest(key: string) {
  const match = /^legal-evidence\/(?:raw\/([a-f0-9]{64})|(?:normalized|observations)\/([a-f0-9]{64})\.json)$/u.exec(key);
  if (!match) throw new Error("EVIDENCE_OBJECT_IDENTITY");
  return match[1] ?? match[2];
}

function verify(key: string, bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > evidenceObjectMaximum(key)
    || createHash("sha256").update(bytes).digest("hex") !== expectedDigest(key)) {
    throw new Error("EVIDENCE_OBJECT_IDENTITY");
  }
}

/** Immutable public evidence under one registered generation and the original request deadline. */
export function createEvidenceObjects(store: Store, deadlineAt: number) {
  if (!/^legal-prepared-[a-f0-9]{64}$/u.test(store.namespace)) throw new Error("EVIDENCE_STORE_IDENTITY");
  const remaining = deadlineAt - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > legalAnswerDeadlineMs) throw new Error("REQUEST_DEADLINE_INVALID");
  const expiresAt = performance.now() + remaining;
  let timeout: Error | undefined;
  const run = async <T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> => {
    if (timeout) throw timeout;
    try { return await runIndexedRetrieval(signal, operation, expiresAt); }
    catch (error) {
      // Retained timer rounding may report expiry just before the local clock does.
      // Once observed, that request deadline cannot admit another storage read.
      if (error instanceof Error && error.name === "TimeoutError") timeout = error;
      throw error;
    }
  };
  return {
    async put(key: string, value: Uint8Array, signal: AbortSignal): Promise<void> {
      signal.throwIfAborted();
      const bytes = Buffer.from(value);
      verify(key, bytes);
      await run(signal, async () => {
        const saved = await store.put(key, bytes);
        if (saved.key !== key || saved.size !== bytes.byteLength) throw new Error("EVIDENCE_OBJECT_IDENTITY");
      });
    },
    async get(key: string, signal?: AbortSignal): Promise<Uint8Array | null> {
      signal?.throwIfAborted();
      expectedDigest(key);
      return run(signal, async () => {
        const object = await store.get(key);
        if (!object) return null;
        if (object.key !== key || object.size < 1 || object.size > evidenceObjectMaximum(key)) throw new Error("EVIDENCE_OBJECT_IDENTITY");
        const bytes = Buffer.from(await object.bytes());
        if (bytes.byteLength !== object.size) throw new Error("EVIDENCE_OBJECT_IDENTITY");
        verify(key, bytes);
        return bytes;
      });
    },
  };
}
