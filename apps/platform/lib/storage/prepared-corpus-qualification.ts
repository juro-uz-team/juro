import {createHash} from "node:crypto";
import {z} from "zod";
import {pinnedReleaseSchema} from "../legal-corpus/legal-candidate-index";
import {preparedCandidateConfigurationSchema} from "../legal-corpus/prepared-candidate-configuration";
import {stableSourceSnapshotJson} from "../legal-corpus/source-snapshot";
import {nativeChatProofSchema,verifyNativeChatProof} from "./native-chat-qualification";

const hash=(bytes:Uint8Array|string)=>createHash("sha256").update(bytes).digest("hex");
const sha=z.string().regex(/^[a-f0-9]{64}$/u),id=z.string().min(1).max(700);
const ids=z.array(id).min(1).refine(values=>new Set(values).size===values.length);
export const preparedQualificationArtifactSchema=z.object({bucket:id,key:id,sha256:sha,
  sizeBytes:z.number().int().positive().max(64*1024*1024)}).strict();
const artifact=preparedQualificationArtifactSchema;
const selected=z.object({release:pinnedReleaseSchema.safeExtend({configuration:preparedCandidateConfigurationSchema})
  .refine(value=>value.instances.length===1),worker:artifact,
  evidenceStore:z.object({namespace:z.string().regex(/^legal-prepared-[a-f0-9]{64}$/u),generationSha256:sha}).strict()}).strict();
export const preparedCorpusAcceptanceSchema=z.object({version:z.literal("prepared-pgvector-v1"),environment:z.literal("production"),
  productRevision:z.string().regex(/^[a-f0-9]{40}$/u),current:selected,history:selected,
  historicalEvidence:artifact,protocol:artifact,
  population:z.object({vectors:z.number().int().positive(),memberships:z.number().int().positive(),shards:z.number().int().positive()}).strict(),
  proofs:z.object({storage:artifact,dense:artifact,retrieval:artifact,chat:artifact,evidence:artifact,checks:artifact}).strict(),
}).strict().superRefine((value,context)=>{
  const current=value.current.release,history=value.history.release;
  if(current.capability!=="current"||history.capability!=="history"||current.id===history.id
    ||current.environment!==value.environment||history.environment!==value.environment
    ||current.configuration.categoryRanking.mode!=="disabled"||history.configuration.categoryRanking.mode!=="disabled"
    ||stableSourceSnapshotJson(current.configuration.artifacts)!==stableSourceSnapshotJson(history.configuration.artifacts)
    ||current.configuration.gatewayIdentity!==history.configuration.gatewayIdentity
    ||current.configuration.providerProjectIdentity!==history.configuration.providerProjectIdentity
    ||value.historicalEvidence.bucket!==value.history.evidenceStore.namespace){
    context.addIssue({code:"custom",message:"Prepared release pair must bind one corpus, its historical evidence store and supported ranking"});
  }
});
export type PreparedCorpusAcceptance=z.infer<typeof preparedCorpusAcceptanceSchema>;
type Artifact=z.infer<typeof artifact>;
export function preparedCorpusBinding(value:PreparedCorpusAcceptance){
  const {proofs:_,...binding}=preparedCorpusAcceptanceSchema.parse(value);
  return hash(stableSourceSnapshotJson(binding));
}
const requiredChecks=["tests","typecheck","build","browser","model_only_modes","no_model_verification",
  "citation_integrity","tenant_isolation","saved_replay","historical_questions","comparison_questions","private_context",
  "retired_citations","complementary_provisions","classification_provenance","category_ranking","original_coordinates",
  "worker_generation","private_data_preserved","historical_applicability"] as const;
const protocolSchema=z.object({version:z.literal("prepared-pgvector-qualification-v1"),
  latencyPolicy:z.literal("measured").optional(),
  tuningQueryIds:ids,heldOutQueryIds:ids,firstTouchIds:ids,warmIds:ids,
  chatCaseIds:ids,heldOutChatCaseIds:ids,workloadSha256:sha,evidenceCaseIds:ids,requiredChecks:ids}).strict();
const bound={bindingSha256:sha};
const storageSchema=z.object({...bound,completionSha256:sha,navigationSha256:sha,vectorIdentitySha256:sha,
  membershipSha256:sha,sparseSha256:sha,packageSha256:sha,workIndexSha256:sha,
  vectorRows:z.number().int().positive(),membershipRows:z.number().int().positive(),verifiedShards:z.number().int().positive(),
  originalCoordinatesAuthenticated:z.literal(true),roundTripVerified:z.literal(true),sealedReadRoleVerified:z.literal(true),
  importReceiptSha256:sha,peakBytes:z.number().int().positive(),freeBytesAfterBuild:z.number().int().min(60*1024**3)}).strict();
const denseSchema=z.object({...bound,goldSha256:sha,completionSha256:sha,
  results:z.array(z.object({id,heldOut:z.boolean(),recallAt50:z.number().finite().min(.95).max(1)}).strict()).min(1)}).strict();
const retrievalSchema=z.object({...bound,results:z.array(z.object({id,phase:z.enum(["first_touch","warm"]),
  concurrency:z.number().int().positive(),milliseconds:z.number().finite().nonnegative(),
  dense:z.literal("complete"),sparse:z.literal("complete"),originalRerank:z.literal(true)}).strict()).min(1)}).strict();
const evidenceSchema=z.object({...bound,historicalManifestSha256:sha,results:z.array(z.object({id,
  capability:z.enum(["current","history","comparison"]),passed:z.literal(true),
  completeRules:z.literal(true),applicabilityVerified:z.literal(true),complementaryProvisionsVerified:z.literal(true),
  citationReloadVerified:z.literal(true)}).strict()).min(3)}).strict();
const checksSchema=z.object({...bound,results:z.array(z.object({id,passed:z.literal(true),evidenceSha256:sha}).strict()).min(1)}).strict();
function exact(expected:readonly string[],actual:readonly string[]){
  if(new Set(actual).size!==actual.length||expected.length!==actual.length||expected.some(value=>!actual.includes(value))){
    throw Error("PREPARED_QUALIFICATION_COVERAGE");
  }
}

/** Authenticate operator-produced measurements before any activation mutation.
 * Pins make evidence reproducible; the trusted qualification runner remains
 * responsible for measuring the real corpus rather than fabricating receipts. */
export async function verifyPreparedCorpusQualification(value:PreparedCorpusAcceptance,read:(reference:Artifact)=>Promise<Uint8Array>){
  const manifest=preparedCorpusAcceptanceSchema.parse(value),binding=preparedCorpusBinding(manifest);
  async function load<T>(reference:Artifact,schema:z.ZodType<T>,boundProof=true){
    const bytes=await read(reference);
    if(bytes.byteLength!==reference.sizeBytes||hash(bytes)!==reference.sha256)throw Error("PREPARED_QUALIFICATION_ARTIFACT_CORRUPT");
    const parsed=schema.parse(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
    if(boundProof&&(parsed as {bindingSha256:string}).bindingSha256!==binding)throw Error("PREPARED_QUALIFICATION_BINDING");
    return parsed;
  }
  const protocol=await load(manifest.protocol,protocolSchema,false);
  if(requiredChecks.some(check=>!protocol.requiredChecks.includes(check))
    ||protocol.heldOutQueryIds.some(query=>protocol.tuningQueryIds.includes(query)))throw Error("PREPARED_QUALIFICATION_PROTOCOL");
  const pins=manifest.current.release.configuration.artifacts;
  const storage=await load(manifest.proofs.storage,storageSchema);
  if(storage.completionSha256!==pins.vectorCompletionSha256||storage.vectorRows!==manifest.population.vectors
    ||storage.membershipRows!==manifest.population.memberships||storage.verifiedShards!==manifest.population.shards
    ||(["packageSha256","navigationSha256","vectorIdentitySha256","membershipSha256","sparseSha256","workIndexSha256"] as const)
      .some(key=>storage[key]!==pins[key]))throw Error("PREPARED_QUALIFICATION_STORAGE");
  const dense=await load(manifest.proofs.dense,denseSchema);
  if(dense.completionSha256!==pins.vectorCompletionSha256)throw Error("PREPARED_QUALIFICATION_STORAGE");
  exact(protocol.tuningQueryIds,dense.results.filter(row=>!row.heldOut).map(row=>row.id));
  exact(protocol.heldOutQueryIds,dense.results.filter(row=>row.heldOut).map(row=>row.id));
  const retrieval=await load(manifest.proofs.retrieval,retrievalSchema);
  // An explicitly pinned measurement policy records latency without making it
  // an activation threshold. Existing protocols retain their original gate.
  if(protocol.latencyPolicy!=="measured"&&retrieval.results.some(row=>row.milliseconds>10000)){
    throw Error("PREPARED_RETRIEVAL_LATENCY_NOT_QUALIFIED");
  }
  exact(protocol.firstTouchIds,retrieval.results.filter(row=>row.phase==="first_touch").map(row=>row.id));
  const warm=retrieval.results.filter(row=>row.phase==="warm");exact(protocol.warmIds,warm.map(row=>row.id));
  if(warm.length<30||warm.some(row=>row.concurrency!==5))throw Error("PREPARED_QUALIFICATION_CONCURRENCY");
  const chat=await load(manifest.proofs.chat,nativeChatProofSchema);
  exact(protocol.chatCaseIds,chat.expectedCaseIds);exact(protocol.heldOutChatCaseIds,chat.heldOutCaseIds);
  exact(protocol.chatCaseIds,chat.results.map(row=>row.id));
  verifyNativeChatProof(chat,protocol.requiredChecks,protocol.workloadSha256,4,
    protocol.latencyPolicy==="measured"?"measured":"required");
  const evidence=await load(manifest.proofs.evidence,evidenceSchema);
  exact(protocol.evidenceCaseIds,evidence.results.map(row=>row.id));
  if(evidence.historicalManifestSha256!==manifest.historicalEvidence.sha256
    ||new Set(evidence.results.map(row=>row.capability)).size!==3)throw Error("PREPARED_QUALIFICATION_EVIDENCE");
  const checks=await load(manifest.proofs.checks,checksSchema);
  exact(protocol.requiredChecks,checks.results.map(row=>row.id));
}
