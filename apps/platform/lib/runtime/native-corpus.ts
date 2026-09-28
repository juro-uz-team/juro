import type {Pool} from "pg";
import type {PostgresDatabase} from "../storage/postgres";
import {LocalObjectStore} from "../storage/objects";
import {PostgresVectorIndex} from "../storage/vectors";
import {createVectorCandidateReader} from "../storage/vector-candidates";
import {createPreparedMembershipReader,createPreparedOrdinalReader} from "../storage/corpus-membership";
import {readSelectedNativeCorpus,nativeCorpusBinding,type NativeCorpusAcceptance} from "../storage/native-corpus-acceptance";
import {createRuntimeEvidenceServices,createRuntimePinnedCustomSearchProvider} from "../legal-corpus/target-runtime";
import {createProviderCandidateIndex,parsePinnedCandidateRelease,type LegalCandidateProvider} from "../legal-corpus/legal-candidate-index";
import {handleCustomSearchRequest,type CustomSearchEnv} from "../legal-corpus/custom-search-service";
import {CustomRuntimeCache} from "../legal-corpus/custom-runtime-cache";
import {LegalResearchSession} from "../../worker/legal-research-session";
import type LegalCorpusService from "../../worker/legal-corpus-worker";
import {createCorpusResearch} from "../legal-chat/corpus-research";
import {createDiscoveryPrioritizer} from "../legal-chat/discovery-priority";
import {corpusSessionSchema,type CorpusSessionInput} from "../legal-chat/corpus-session";

type Dependencies={pool:Pool;catalog:PostgresDatabase;objectRoot:string;candidateUrl:string;apiKey:string};
type Configuration=Omit<NativeCorpusAcceptance,"proofs">;

/** Shared native composition. Qualification is an explicit operator mode,
 * never an HTTP option; accepted requests additionally require readiness. */
export async function createNativeCorpusResearchRuntime(input:Dependencies&{
  configuration:Configuration;mode:"accepted"|"qualification";
}) {
  const config=input.configuration;
  const membershipPins=new Map([config.current,config.history].map(release=>[release.releaseId,release.membership]));
  const bucket=(name:string)=>new LocalObjectStore(input.pool,input.objectRoot,name);
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
        OPENAI_API_KEY:input.apiKey,CATALOG_DB:input.catalog,ARTIFACTS:artifacts,RUNTIME_CACHE:cache,
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
export function createNativeCorpusService(input:Dependencies&{productRevision:string;
  fallback:Pick<LegalCorpusService,"fetch"|"openLegalResearch">}) {
  let cached:{binding:string;runtime:ReturnType<typeof createNativeCorpusResearchRuntime>}|undefined;
  return {
    fetch:input.fallback.fetch.bind(input.fallback),
    async openLegalResearch(scope:CorpusSessionInput){
      const selected=await readSelectedNativeCorpus(input.pool,input.productRevision);
      if(!selected)return input.fallback.openLegalResearch(scope);
      if(!input.candidateUrl)throw Error("NATIVE_CORPUS_CANDIDATE_SERVICE_MISSING");
      const binding=nativeCorpusBinding(selected);
      if(cached?.binding!==binding)cached={binding,runtime:createNativeCorpusResearchRuntime({...input,configuration:selected,mode:"accepted"})};
      const runtime=await cached.runtime;
      return runtime.openLegalResearch(scope);
    },
  };
}
