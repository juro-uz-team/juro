import {createHash} from "node:crypto";
import type {Pool} from "pg";
import {z} from "zod";
import {stableSourceSnapshotJson} from "../legal-corpus/source-snapshot";
import {parseCustomBm25RuntimeDescriptor} from "../legal-corpus/custom-bm25-runtime";
import retainedReleases from "../../config/corpus-releases.json";
import {retrievalQuery} from "./retrieval-connection";

const digest=z.string().regex(/^[a-f0-9]{64}$/u);
const identifier=z.string().min(1).max(700);
const artifact=z.object({bucket:identifier,key:identifier,sha256:digest,sizeBytes:z.number().int().positive().max(64*1024*1024)}).strict();
const release=z.object({releaseId:identifier,artifactNamespace:identifier,vectorCollection:identifier,
  configurationIdentity:identifier,instanceId:identifier,shardId:identifier,
  descriptor:artifact,membership:z.object({generation:z.uuid(),sha256:digest,count:z.number().int().positive()}).strict(),
  vector:z.object({generation:z.uuid(),sourceRevision:z.string().regex(/^(?:0|[1-9]\d*)$/u)}).strict(),
}).strict();
export const nativeCorpusAcceptanceSchema=z.object({version:z.literal(1),environment:z.literal("production"),
  productRevision:z.string().regex(/^[a-f0-9]{40}$/u),current:release,history:release,
  evidenceNamespace:identifier,historyEvidenceNamespace:identifier,legacyArtifactNamespace:identifier,
  gatewayIdentity:identifier,projectIdentity:identifier,
  protocol:artifact,
  proofs:z.object({dense:artifact,native:artifact,semantic:artifact,integrity:artifact,verification:artifact}).strict(),
}).strict().refine(manifest=>manifest.evidenceNamespace===retainedReleases.evidenceNamespace
  &&manifest.historyEvidenceNamespace===retainedReleases.historyEvidenceNamespace,"Accepted citation stores must preserve receipt routing");
export type NativeCorpusAcceptance=z.infer<typeof nativeCorpusAcceptanceSchema>;
type Artifact=z.infer<typeof artifact>;
const sha=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");

/** Every proof names the same implementation, configurations and source fences.
 * Proof references themselves are omitted to avoid a circular content hash. */
export function nativeCorpusBinding(manifest:NativeCorpusAcceptance):string {
  const {proofs:_,...binding}=nativeCorpusAcceptanceSchema.parse(manifest);
  return sha(stableSourceSnapshotJson(binding));
}

function exactIds(expected:readonly string[],actual:readonly string[]) {
  if(!expected.length||new Set(expected).size!==expected.length||new Set(actual).size!==actual.length
    ||expected.length!==actual.length||expected.some(id=>!actual.includes(id)))throw Error("NATIVE_CORPUS_QUALIFICATION_COVERAGE");
}
const ids=z.array(identifier).min(1);
const protocolSchema=z.object({version:z.literal("native-indexed-retrieval-v1"),
  denseQueryIds:ids,heldOutQueryIds:ids,firstTouchIds:ids,expiredObservationIds:ids,warmAttemptIds:ids,
  semanticCaseIds:ids,heldOutCaseIds:ids,requiredChecks:ids,expectedScopes:z.number().int().positive(),
  fixtureHashes:z.array(digest).min(1),sourceInventoryHashes:z.array(digest).min(2),
}).strict();
const base={bindingSha256:digest};
const denseProof=z.object({...base,expectedQueryIds:ids,heldOutQueryIds:ids,
  results:z.array(z.object({id:identifier,recall:z.number().finite().min(.95).max(1)}).strict()).min(1)}).strict();
const nativeProof=z.object({...base,expectedFirstTouchIds:ids,expectedExpiredObservationIds:ids,
  requests:z.array(z.object({id:identifier,phase:z.enum(["first_touch","expired_observation","warm"]),
    concurrency:z.number().int().positive(),milliseconds:z.number().finite().nonnegative().max(10000),
    outcome:z.literal("success")}).strict()).min(1)}).strict();
const semanticProof=z.object({...base,expectedCaseIds:ids,heldOutCaseIds:ids,
  results:z.array(z.object({id:identifier,completed:z.literal(true),passed:z.literal(true),
    unresolvedNeeds:z.literal(0),sourceUnavailable:z.literal(false)}).strict()).min(1)}).strict();
const integrityProof=z.object({...base,expectedScopes:z.number().int().positive(),verifiedScopes:z.number().int().positive(),
  failures:z.literal(0),sourceInventoryHashes:z.array(digest).min(2)}).strict();
const verificationProof=z.object({...base,requiredChecks:ids,
  results:z.array(z.object({id:identifier,passed:z.literal(true)}).strict()).min(1)}).strict();

export async function verifyNativeCorpusQualification(manifest:NativeCorpusAcceptance,
  read:(reference:Artifact)=>Promise<Uint8Array>):Promise<void> {
  const binding=nativeCorpusBinding(manifest);
  const protocolBytes=await read(manifest.protocol);
  if(protocolBytes.length!==manifest.protocol.sizeBytes||sha(protocolBytes)!==manifest.protocol.sha256)throw Error("NATIVE_CORPUS_PROTOCOL_CORRUPT");
  const protocol=protocolSchema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(protocolBytes)));
  const load=async<T>(reference:Artifact,schema:z.ZodType<T>)=>{
    const bytes=await read(reference);
    if(bytes.length!==reference.sizeBytes||sha(bytes)!==reference.sha256)throw Error("NATIVE_CORPUS_PROOF_CORRUPT");
    const parsed=schema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
    if((parsed as {bindingSha256:string}).bindingSha256!==binding)throw Error("NATIVE_CORPUS_PROOF_BINDING");
    return parsed;
  };
  const dense=await load(manifest.proofs.dense,denseProof);
  exactIds(protocol.denseQueryIds,dense.expectedQueryIds);
  exactIds(protocol.heldOutQueryIds,dense.heldOutQueryIds);
  exactIds(dense.expectedQueryIds,dense.results.map(result=>result.id));
  if(dense.heldOutQueryIds.some(id=>!dense.expectedQueryIds.includes(id)))throw Error("NATIVE_CORPUS_HELD_OUT_MISSING");
  const native=await load(manifest.proofs.native,nativeProof);
  exactIds(protocol.firstTouchIds,native.expectedFirstTouchIds);
  exactIds(protocol.expiredObservationIds,native.expectedExpiredObservationIds);
  exactIds(native.expectedFirstTouchIds,native.requests.filter(r=>r.phase==="first_touch").map(r=>r.id));
  exactIds(native.expectedExpiredObservationIds,native.requests.filter(r=>r.phase==="expired_observation").map(r=>r.id));
  const warm=native.requests.filter(r=>r.phase==="warm");
  exactIds(protocol.warmAttemptIds,warm.map(r=>r.id));
  if(warm.length<30||warm.some(r=>r.concurrency!==5))throw Error("NATIVE_CORPUS_CONCURRENCY_NOT_QUALIFIED");
  const times=warm.map(r=>r.milliseconds).sort((a,b)=>a-b);
  if(times[Math.ceil(times.length*.95)-1]!>5000)throw Error("NATIVE_CORPUS_LATENCY_NOT_QUALIFIED");
  const semantic=await load(manifest.proofs.semantic,semanticProof);
  exactIds(protocol.semanticCaseIds,semantic.expectedCaseIds);
  exactIds(protocol.heldOutCaseIds,semantic.heldOutCaseIds);
  exactIds(semantic.expectedCaseIds,semantic.results.map(result=>result.id));
  if(semantic.heldOutCaseIds.some(id=>!semantic.expectedCaseIds.includes(id)))throw Error("NATIVE_CORPUS_HELD_OUT_MISSING");
  const integrity=await load(manifest.proofs.integrity,integrityProof);
  if(integrity.expectedScopes!==integrity.verifiedScopes||integrity.expectedScopes!==protocol.expectedScopes
    ||[manifest.current,manifest.history].some(r=>!integrity.sourceInventoryHashes.includes(r.membership.sha256)))throw Error("NATIVE_CORPUS_INTEGRITY_INCOMPLETE");
  exactIds(protocol.sourceInventoryHashes,integrity.sourceInventoryHashes);
  const checks=await load(manifest.proofs.verification,verificationProof);
  exactIds(protocol.requiredChecks,checks.requiredChecks);
  exactIds(checks.requiredChecks,checks.results.map(result=>result.id));
}

/** Trusted operator action; there is no request-controlled activation switch.
 * Proof bytes are verified before one transaction changes both readiness flags
 * and appends the complete selection. Failed publication leaves neither active. */
export async function activateNativeCorpus(input:{pool:Pool;manifest:NativeCorpusAcceptance;
  productRevision:string;read:(reference:Artifact)=>Promise<Uint8Array>}):Promise<string> {
  const manifest=nativeCorpusAcceptanceSchema.parse(input.manifest);
  if(manifest.productRevision!==input.productRevision)throw Error("NATIVE_CORPUS_PRODUCT_CHANGED");
  await verifyNativeCorpusQualification(manifest,input.read);
  for(const selected of [manifest.current,manifest.history]){
    const bytes=await input.read(selected.descriptor);
    if(bytes.length!==selected.descriptor.sizeBytes||sha(bytes)!==selected.descriptor.sha256)throw Error("NATIVE_CORPUS_DESCRIPTOR_CORRUPT");
    const descriptor=parseCustomBm25RuntimeDescriptor(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
    if(descriptor.releaseId!==selected.releaseId||descriptor.statistics.documentCount!==selected.membership.count
      ||(descriptor.denseMetadataReleaseId??descriptor.releaseId)!==selected.releaseId)throw Error("NATIVE_CORPUS_DESCRIPTOR_CHANGED");
  }
  const bytes=Buffer.from(stableSourceSnapshotJson(manifest)),hash=sha(bytes),client=await input.pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('native-corpus-selection',0))");
    for(const capability of ["current","history"] as const){
      const selected=manifest[capability];
      const vectors=(await client.query(`SELECT g.collection,g.source_revision::text,g.state,g.member_count,c.source_revision::text AS live_revision
        FROM storage.vector_search_generations g JOIN storage.vector_collections c ON c.name=g.collection
        WHERE g.id=$1 FOR SHARE OF g,c`,[selected.vector.generation])).rows[0];
      if(!vectors||vectors.collection!==selected.vectorCollection||vectors.state!=="verified"
        ||vectors.source_revision!==selected.vector.sourceRevision||vectors.live_revision!==selected.vector.sourceRevision
        ||Number(vectors.member_count)!==selected.membership.count)throw Error("NATIVE_CORPUS_VECTOR_CHANGED");
      const membership=(await client.query(`SELECT release_id,source_inventory_sha256,member_count,state
        FROM storage.corpus_membership_generations WHERE id=$1 FOR SHARE`,[selected.membership.generation])).rows[0];
      if(!membership||membership.release_id!==selected.releaseId||membership.source_inventory_sha256!==selected.membership.sha256
        ||Number(membership.member_count)!==selected.membership.count||membership.state!=="verified")throw Error("NATIVE_CORPUS_MEMBERSHIP_CHANGED");
      const ledger=(await client.query(`SELECT r.capability,r.environment,r.configuration_identity,
        x.runtime_descriptor_r2_key,x.runtime_descriptor_sha256,x.mapping_inventory_sha256,x.mapping_count
        FROM legal.legal_search_releases r JOIN legal.legal_custom_search_r2_runtime_roots x ON x.search_release_id=r.id
        WHERE r.id=$1 FOR SHARE OF r,x`,[selected.releaseId])).rows[0];
      if(!ledger||ledger.capability!==capability||ledger.environment!==manifest.environment
        ||ledger.configuration_identity!==selected.configurationIdentity||ledger.runtime_descriptor_r2_key!==selected.descriptor.key
        ||ledger.runtime_descriptor_sha256!==selected.descriptor.sha256||ledger.mapping_inventory_sha256!==selected.membership.sha256
        ||Number(ledger.mapping_count)!==selected.membership.count||selected.descriptor.bucket!==selected.artifactNamespace)throw Error("NATIVE_CORPUS_RELEASE_CHANGED");
    }
    await client.query(`INSERT INTO storage.native_corpus_acceptances(sha256,manifest_bytes,current_vector_generation,
      history_vector_generation,current_membership_generation,history_membership_generation) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(sha256) DO NOTHING`,[hash,bytes,manifest.current.vector.generation,manifest.history.vector.generation,
      manifest.current.membership.generation,manifest.history.membership.generation]);
    await client.query("UPDATE storage.vector_collections SET ready=true WHERE name=ANY($1::text[])",
      [[manifest.current.vectorCollection,manifest.history.vectorCollection]]);
    await client.query("INSERT INTO storage.native_corpus_selections(acceptance_sha256) VALUES($1)",[hash]);
    await client.query("COMMIT");return hash;
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
}

/** A single MVCC read pins both endpoints, including their rollback identity. */
export async function readSelectedNativeCorpus(pool:Pool,productRevision:string):Promise<NativeCorpusAcceptance|null> {
  const row=(await retrievalQuery(pool,`SELECT a.sha256,a.manifest_bytes FROM storage.native_corpus_selections s
    JOIN storage.native_corpus_acceptances a ON a.sha256=s.acceptance_sha256 ORDER BY s.id DESC LIMIT 1`)).rows[0];
  if(!row)return null;
  if(sha(row.manifest_bytes)!==row.sha256)throw Error("NATIVE_CORPUS_ACCEPTANCE_CORRUPT");
  const manifest=nativeCorpusAcceptanceSchema.parse(JSON.parse(Buffer.from(row.manifest_bytes).toString("utf8")));
  if(manifest.productRevision!==productRevision)throw Error("NATIVE_CORPUS_PRODUCT_CHANGED");
  return manifest;
}
