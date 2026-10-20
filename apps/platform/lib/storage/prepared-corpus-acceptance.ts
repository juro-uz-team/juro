import {createHash} from "node:crypto";
import type {Pool} from "pg";
import {z} from "zod";
import {stableSourceSnapshotJson} from "../legal-corpus/source-snapshot";
import {createPreparedHistoricalEvidenceReader} from "../legal-corpus/prepared-historical-evidence";
import {preparedCorpusAcceptanceSchema,preparedQualificationArtifactSchema,verifyPreparedCorpusQualification,
  type PreparedCorpusAcceptance} from "./prepared-corpus-qualification";

const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
type Artifact=z.infer<typeof preparedQualificationArtifactSchema>;
const absolutePath=z.string().min(1).max(4096).startsWith("/");
const digest=z.string().regex(/^[a-f0-9]{64}$/u);
const workerSchema=z.object({format:z.literal("prepared-numeric-worker-v1"),release:z.unknown(),
  paths:z.object({package:absolutePath,vectors:absolutePath,identities:absolutePath,works:absolutePath,
    memberships:absolutePath,profiles:absolutePath,sparse:absolutePath,navigation:absolutePath}).strict(),
  profilesSha256:digest,analyzerSha256:digest,probes:z.number().int().min(1).max(32768),
  candidates:z.number().int().min(50).max(20000)}).strict();

/** Admission validates the artifacts whose pins were measured. The worker
 * independently authenticates their on-disk dependencies before listening. */
export async function readPreparedAdmissionArtifacts(manifest:PreparedCorpusAcceptance,
  read:(reference:Artifact)=>Promise<Uint8Array>){
  async function bytes(reference:Artifact,maximum:number){
    if(reference.sizeBytes>maximum)throw Error("PREPARED_ADMISSION_ARTIFACT_LIMIT");
    const value=await read(reference);
    if(value.byteLength!==reference.sizeBytes||hash(value)!==reference.sha256)throw Error("PREPARED_ADMISSION_ARTIFACT_CORRUPT");
    return value;
  }
  for(const selected of [manifest.current,manifest.history]){
    const worker=workerSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await bytes(selected.worker,65536))));
    if(stableSourceSnapshotJson(worker.release)!==stableSourceSnapshotJson(selected.release)){
      throw Error("PREPARED_ADMISSION_WORKER_MISMATCH");
    }
  }
  const historicalBytes=await bytes(manifest.historicalEvidence,16*1024*1024);
  // Parse publication and package binding now; physical proofs are checked by
  // the reader per evidence request and by the bound qualification workload.
  createPreparedHistoricalEvidenceReader({manifestBytes:historicalBytes,manifestSha256:manifest.historicalEvidence.sha256,
    packageSha256:manifest.history.release.configuration.artifacts.packageSha256,bucket:{get:async()=>null}});
  return {historicalBytes};
}

/** Trusted operator action. A failed check leaves the previous complete pair
 * selected. Evidence-store registrations predate selection so saved citations
 * keep an immutable address independently of future corpus choices. */
export async function activatePreparedCorpus(input:{pool:Pool;manifest:PreparedCorpusAcceptance;productRevision:string;
  read:(reference:Artifact)=>Promise<Uint8Array>}){
  const manifest=preparedCorpusAcceptanceSchema.parse(input.manifest);
  if(manifest.productRevision!==input.productRevision)throw Error("NATIVE_CORPUS_PRODUCT_CHANGED");
  await verifyPreparedCorpusQualification(manifest,input.read);
  await readPreparedAdmissionArtifacts(manifest,input.read);
  const bytes=Buffer.from(stableSourceSnapshotJson(manifest)),sha256=hash(bytes);
  if(bytes.length>1048576)throw Error("PREPARED_ADMISSION_ARTIFACT_LIMIT");
  const client=await input.pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('native-corpus-selection',0))");
    for(const selected of [manifest.current,manifest.history]){
      const store=(await client.query(`SELECT namespace,manifest FROM storage.corpus_evidence_stores
        WHERE generation_sha256=$1 FOR SHARE`,[selected.evidenceStore.generationSha256])).rows[0];
      if(!store||store.namespace!==selected.evidenceStore.namespace||hash(store.manifest)!==selected.evidenceStore.generationSha256){
        throw Error("PREPARED_EVIDENCE_STORE_UNREGISTERED");
      }
    }
    await client.query(`INSERT INTO storage.prepared_corpus_acceptances
      (sha256,manifest_bytes,current_evidence_generation,history_evidence_generation) VALUES($1,$2,$3,$4)
      ON CONFLICT(sha256) DO NOTHING`,[sha256,bytes,manifest.current.evidenceStore.generationSha256,
      manifest.history.evidenceStore.generationSha256]);
    await client.query("INSERT INTO storage.native_corpus_selections(prepared_acceptance_sha256) VALUES($1)",[sha256]);
    await client.query("COMMIT");
    return sha256;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}
