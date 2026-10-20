import type {Pool} from "pg";
import type {CorpusCompatibility} from "../../../../scripts/corpus-compatibility.mjs";
import type {PostgresDatabase} from "../storage/postgres";
import {LocalObjectStore} from "../storage/objects";
import {PreparedEvidenceStore,isPreparedPostgresEvidenceStore} from "../storage/prepared-evidence-objects";
import {PostgresVectorIndex} from "../storage/vectors";
import {createVectorCandidateReader} from "../storage/vector-candidates";
import {createPreparedMembershipReader,createPreparedOrdinalReader} from "../storage/corpus-membership";
import {readSelectedCorpus,nativeCorpusBinding,type NativeCorpusAcceptance} from "../storage/native-corpus-acceptance";
import {preparedCorpusBinding} from "../storage/prepared-corpus-qualification";
import {createAcceptedPreparedCorpusRuntime,type PreparedNativeTransport} from "./prepared-native-corpus";
import {createRuntimeEvidenceServices,createRuntimePinnedCustomSearchProvider} from "../legal-corpus/target-runtime";
import {createProviderCandidateIndex,parsePinnedCandidateRelease,type LegalCandidateProvider} from "../legal-corpus/legal-candidate-index";
import {handleCustomSearchRequest,type CustomSearchEnv} from "../legal-corpus/custom-search-service";
import {CustomRuntimeCache} from "../legal-corpus/custom-runtime-cache";
import {LegalResearchSession} from "../../worker/legal-research-session";
import type LegalCorpusService from "../../worker/legal-corpus-worker";
import {createCorpusResearch} from "../legal-chat/corpus-research";
import {createDiscoveryPrioritizer} from "../legal-chat/discovery-priority";
import {corpusSessionSchema,type CorpusSessionInput} from "../legal-chat/corpus-session";
import {CITATION_EVIDENCE_PATH,handleCitationEvidenceRequest} from "../legal-corpus/citation-evidence";
import {isRetiredCorpusObject} from "../storage/corpus-retirement";
import retainedReleases from "../../config/corpus-releases.json";

type Dependencies={pool:Pool;catalog:PostgresDatabase;observations?:PostgresDatabase;objectRoot:string;candidateUrl:string;apiKey:string};
type Configuration=Omit<NativeCorpusAcceptance,"proofs">;

/** Shared native composition. Qualification is an explicit operator mode,
 * never an HTTP option; accepted requests additionally require readiness. */
export async function createNativeCorpusResearchRuntime(input:Dependencies&{
  configuration:Configuration;mode:"accepted"|"qualification";
}) {
  const config=input.configuration;
  const membershipPins=new Map([config.current,config.history].map(release=>[release.releaseId,release.membership]));
  const bucket=(name:string)=>new LocalObjectStore(input.pool,input.objectRoot,name,true);
  const providers=new Map<string,LegalCandidateProvider>();
  const releases=new Map<string,ReturnType<typeof parsePinnedCandidateRelease>>();
  const artifactStores=new Map<string,LocalObjectStore>();
  for(const capability of ["current","history"] as const){
    const selected=config[capability],cache=new CustomRuntimeCache(512*1024*1024);
    const artifacts=bucket(selected.artifactNamespace);
    artifactStores.set(`search-releases/${selected.releaseId}/`,artifacts);
    const index=(input.mode==="accepted"?PostgresVectorIndex.forAccepted:PostgresVectorIndex.forQualification)(
      input.pool,selected.vectorCollection,selected.vector,createVectorCandidateReader(input.candidateUrl));
    const service={async fetch(request:RequestInfo|URL,init?:RequestInit){
      if(!await index.isReady())return Response.json({code:"CORPUS_IMPORT_NOT_VERIFIED"},{status:503});
      return handleCustomSearchRequest(new Request(request,init),{
        APP_ENV:config.environment,AI_GATEWAY_ID:config.gatewayIdentity,CUSTOM_SEARCH_CAPABILITY:capability,
        CUSTOM_SEARCH_RELEASE_ID:selected.releaseId,CUSTOM_SEARCH_PHYSICAL_RELEASE_ID:selected.releaseId,
        CUSTOM_SEARCH_INSTANCE_ID:selected.instanceId,CUSTOM_SEARCH_SHARD_ID:selected.shardId,
        CUSTOM_RUNTIME_DESCRIPTOR_KEY:selected.descriptor.key,CUSTOM_RUNTIME_DESCRIPTOR_SHA256:selected.descriptor.sha256,
        OPENAI_API_KEY:input.apiKey,CATALOG_DB:input.catalog,BUDGET_DB:input.observations??input.catalog,ARTIFACTS:artifacts,RUNTIME_CACHE:cache,
        CUSTOM_QUERY_BUDGET_MODE:input.mode==="accepted"?"metered":"capped",
        SPARSE_TRAVERSAL_CONCURRENCY:2,
        PREPARED_ORDINALS:createPreparedOrdinalReader(input.pool,membershipPins),DENSE:index,
      } as unknown as CustomSearchEnv);
    }};
    const provider=createRuntimePinnedCustomSearchProvider({environment:config.environment,releaseId:selected.releaseId,
      configurationIdentity:selected.configurationIdentity,capability,service:service as unknown as Fetcher,
      gatewayIdentity:config.gatewayIdentity,projectIdentity:config.projectIdentity});
    providers.set(selected.instanceId,provider);
    releases.set(capability,parsePinnedCandidateRelease({id:selected.releaseId,environment:config.environment,capability,
      instances:[{id:selected.instanceId,shardId:selected.shardId}],configuration:await provider.attest(selected.instanceId,selected.releaseId)}));
  }
  const providerFor=(ids:readonly string[])=>{const provider=ids.length===1?providers.get(ids[0]!):undefined;
    if(!provider)throw Error("NATIVE_CORPUS_INSTANCE_INVALID");return provider;};
  const candidateIndex=createProviderCandidateIndex({attest:(id,release)=>providerFor([id]).attest(id,release),
    search:request=>providerFor(request.instanceIds).search(request),
    searchMany:request=>providerFor(request.instanceIds).searchMany!(request)},{});
  const legacy=bucket(config.legacyArtifactNamespace);
  const artifactReader={get:(key:string,options?:Parameters<LocalObjectStore["get"]>[1])=>{
    for(const [prefix,store] of artifactStores)if(key.startsWith(prefix))return store.get(key,options);
    return legacy.get(key,options);
  }};
  const pinned=(endpoint:{kind:string})=>structuredClone(releases.get(endpoint.kind==="current"?"current":"history")!);
  return {async openLegalResearch(sessionInput:CorpusSessionInput){
    const scope=corpusSessionSchema.parse(sessionInput);
    if(scope.environment!==config.environment)throw Error("CORPUS_RESEARCH_ENVIRONMENT_MISMATCH");
    const services=createRuntimeEvidenceServices({environment:config.environment,db:input.catalog as unknown as D1Database,
        observationDb: (input.observations ?? input.catalog) as unknown as D1Database,
        evidenceBucket:bucket(config.evidenceNamespace),historyEvidenceBucket:bucket(config.historyEvidenceNamespace),
        customArtifactBucket:artifactReader as unknown as R2Bucket,preparedMembership:createPreparedMembershipReader(input.pool,membershipPins),
        sharedSourceObservationsEnabled:true},candidateIndex,
      {resolve:async endpoint=>pinned(endpoint),resolveComparison:async(left,right)=>({left:pinned(left),right:pinned(right)})});
    const prioritize=createDiscoveryPrioritizer({requestId:scope.requestId,mode:scope.mode,
      readMetadata:services.evidenceResolver.readDiscoveryMetadata,
      onAttemptFinished:observation=>{console.info(JSON.stringify({event:"legal.discovery_priority_attempt",requestId:scope.requestId,...observation}));},
    });
    return new LegalResearchSession(scope,formulate=>createCorpusResearch({formulate,services,prioritize,
    }));
  }};
}

/** Fetch/citation paths retain their original evidence stores. Each new turn
 * selects both retrieval endpoints once; its repairs keep that same selection. */
export function createNativeCorpusService(input:Dependencies&{environment:string;productRevision:string;compatibility?:CorpusCompatibility;
  preparedTransport?:PreparedNativeTransport;
  fallback:Pick<LegalCorpusService,"fetch"|"openLegalResearch">}) {
  let cached:{binding:string;runtime:ReturnType<typeof createNativeCorpusResearchRuntime>}|undefined;
  return {
    async fetch(requestInput:RequestInfo|URL,init?:RequestInit){
      const request=new Request(requestInput,init);
      if(new URL(request.url).pathname===CITATION_EVIDENCE_PATH){
        // Existing v1 receipts are permanently routed to their original stores.
        // Replacement receipts must use an explicit, versioned store binding.
        return handleCitationEvidenceRequest(request,{
          APP_ENV:input.environment,
          LEGAL_EVIDENCE_BUCKET:new LocalObjectStore(input.pool,input.objectRoot,retainedReleases.evidenceNamespace,true),
          LEGAL_HISTORY_EVIDENCE_BUCKET:new LocalObjectStore(input.pool,input.objectRoot,retainedReleases.historyEvidenceNamespace,true),
          isRetiredEvidence:receipt=>isRetiredCorpusObject(input.pool,
            receipt.store?.namespace??(receipt.capability==="history"?retainedReleases.historyEvidenceNamespace:retainedReleases.evidenceNamespace),
            receipt.r2Key,receipt.sha256),
          resolveEvidenceStore:async store=>{
            const known=await input.pool.query(`SELECT manifest FROM storage.corpus_evidence_stores WHERE generation_sha256=$1 AND namespace=$2`,[store.generationSha256,store.namespace]);
            if(known.rows.length!==1)return null;
            return isPreparedPostgresEvidenceStore(known.rows[0].manifest)
              ?new PreparedEvidenceStore(input.pool,store.namespace,true)
              :new LocalObjectStore(input.pool,input.objectRoot,store.namespace,true);
          },
        });
      }
      // A retired selected release must never fall back into the old corpus.
      try{
        const selected=await readSelectedCorpus(input.pool,input.productRevision,input.compatibility);
        if(selected?.version==="prepared-pgvector-v1"){
          return Response.json({code:"PREPARED_CORPUS_SESSION_REQUIRED"},{status:503,headers:{"cache-control":"no-store"}});
        }
      }
      catch(error){
        if(error instanceof Error&&error.message==="NATIVE_CORPUS_RETIRED")return Response.json({code:"NATIVE_CORPUS_RETIRED"},{status:503,headers:{"cache-control":"no-store"}});
        throw error;
      }
      return input.fallback.fetch(request);
    },
    async openLegalResearch(scope:CorpusSessionInput){
      const selected=await readSelectedCorpus(input.pool,input.productRevision,input.compatibility);
      if(!selected)return input.fallback.openLegalResearch(scope);
      if(selected.version==="prepared-pgvector-v1"){
        if(!input.preparedTransport)throw Error("PREPARED_WORKER_DEPLOYMENT_MISSING");
        const binding=preparedCorpusBinding(selected);
        if(cached?.binding!==binding)cached={binding,runtime:createAcceptedPreparedCorpusRuntime({
          pool:input.pool,objectRoot:input.objectRoot,budgetDatabase:input.observations??input.catalog,
          apiKey:input.apiKey,configuration:selected,transport:input.preparedTransport})};
      }else{
        if(!input.candidateUrl)throw Error("NATIVE_CORPUS_CANDIDATE_SERVICE_MISSING");
        const binding=nativeCorpusBinding(selected);
        if(cached?.binding!==binding)cached={binding,runtime:createNativeCorpusResearchRuntime({...input,configuration:selected,mode:"accepted"})};
      }
      const pending=cached;
      let runtime:Awaited<typeof pending.runtime>;
      try{runtime=await pending.runtime;}catch(error){
        if(cached===pending)cached=undefined;
        throw error;
      }
      return runtime.openLegalResearch(scope);
    },
  };
}
