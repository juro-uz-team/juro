import type {Pool} from "pg";
import type {PostgresDatabase} from "../storage/postgres";
import {LocalObjectStore} from "../storage/objects";
import {readPreparedAdmissionArtifacts} from "../storage/prepared-corpus-acceptance";
import type {PreparedCorpusAcceptance} from "../storage/prepared-corpus-qualification";
import {fetchLegalSource} from "../legal/source-fetch";
import {indexedRetrievalSignal} from "./indexed-retrieval";
import {createPreparedNativeResearchPairRuntime} from "./prepared-corpus";

export type PreparedNativeTransport={
  current:{url:string;token:string;workerSha256:string};
  history:{url:string;token:string;workerSha256:string};
};

/** Deployments bind private listeners to the exact measured worker manifests.
 * Each result still authenticates its release and corpus artifact identities. */
export async function createAcceptedPreparedCorpusRuntime(input:{pool:Pool;objectRoot:string;budgetDatabase:PostgresDatabase;
  apiKey:string;configuration:PreparedCorpusAcceptance;transport:PreparedNativeTransport}){
  const manifest=input.configuration;
  for(const capability of ["current","history"] as const){
    if(input.transport[capability].workerSha256!==manifest[capability].worker.sha256)throw Error("PREPARED_WORKER_DEPLOYMENT_MISMATCH");
  }
  const bucket=(namespace:string)=>new LocalObjectStore(input.pool,input.objectRoot,namespace);
  const {historicalBytes}=await readPreparedAdmissionArtifacts(manifest,async reference=>{
    const object=await bucket(reference.bucket).get(reference.key);
    if(!object||object.size!==reference.sizeBytes)throw Error("PREPARED_ADMISSION_ARTIFACT_CORRUPT");
    return object.bytes();
  });
  const fetchImpl:typeof fetch=(url,init)=>{
    const signal=indexedRetrievalSignal();
    return fetch(url,{...init,...(signal?{signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])}:{})});
  };
  const endpoint=(capability:"current"|"history")=>{
    const selected=manifest[capability];
    // Complete code pages exceed the generic fetch default. Match the bounded
    // publisher observation fetch; normalized citation parents retain their
    // separate eight-million-byte admission limit.
    const sourceOptions={adviceEnabled:false,crawlDelayMode:"proceed" as const,maxBytes:16*1024*1024};
    return {release:selected.release,numeric:input.transport[capability],
      embedding:{apiKey:input.apiKey,budgetDatabase:input.budgetDatabase as unknown as D1Database,budgetMode:"metered" as const},
      fetch:(url:string,signal?:AbortSignal)=>fetchLegalSource(url,{...sourceOptions,
        fetchImpl:(request,init)=>fetchImpl(request,{...init,...(signal?{signal:AbortSignal.any([signal,...(init?.signal?[init.signal]:[])])}:{})})}),
      capture:{bucket:bucket(selected.evidenceStore.namespace),store:selected.evidenceStore,
        options:{...sourceOptions,fetchImpl}},
      ...(capability==="history"?{history:{manifestBytes:historicalBytes,manifestSha256:manifest.historicalEvidence.sha256}}:{})};
  };
  return createPreparedNativeResearchPairRuntime({current:endpoint("current"),history:endpoint("history")});
}
