import { legalAnswerDeadlineMs } from "./deadline";
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { PreparedEvidenceStore, isPreparedPostgresEvidenceStore } from "../storage/prepared-evidence-objects";
import { retrievalQuery } from "../storage/retrieval-connection";
import { runIndexedRetrieval } from "../runtime/indexed-retrieval";

/** Registry metadata must authenticate the exact generation before generation can incur spending. */
export function verifyEvidenceStoreRegistration(value: {
  namespace: string; manifest: Uint8Array; canAppend: boolean;
} | null, generationSha256: string, options: { readOnly?: boolean } = {}) {
  if (!/^[a-f0-9]{64}$/u.test(generationSha256) || !value
    || value.namespace !== `legal-prepared-${generationSha256}` || (!options.readOnly && value.canAppend !== true)
    || !(value.manifest instanceof Uint8Array) || value.manifest.byteLength < 1 || value.manifest.byteLength > 1048576
    || createHash("sha256").update(value.manifest).digest("hex") !== generationSha256
    || !isPreparedPostgresEvidenceStore(value.manifest)) throw new Error("EVIDENCE_STORE_REGISTRATION_INVALID");
  return value.namespace;
}

export async function openRegisteredEvidenceStore(pool: Pool, generationSha256: string, deadlineAt: number, signal: AbortSignal,
  options: { readOnly?: boolean } = {}) {
  signal.throwIfAborted();
  const remaining = deadlineAt - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > legalAnswerDeadlineMs) throw new Error("REQUEST_DEADLINE_INVALID");
  return runIndexedRetrieval(signal, async () => {
    const { rows } = await retrievalQuery<{ namespace: string; manifest: Buffer; canAppend: boolean }>(pool,
      `SELECT namespace,manifest,${options.readOnly ? "false" : "has_function_privilege(current_user, 'storage.append_prepared_evidence(text,text,bytea)','EXECUTE')"} AS "canAppend"
       FROM storage.corpus_evidence_stores WHERE generation_sha256=$1`, [generationSha256]);
    const namespace = verifyEvidenceStoreRegistration(rows.length === 1 ? rows[0] : null, generationSha256, options);
    return { store: new PreparedEvidenceStore(pool, namespace, options.readOnly ?? false), manifest: rows[0].manifest };
  }, performance.now() + remaining);
}
