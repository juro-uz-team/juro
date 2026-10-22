import {LegalResearchSession} from "../../worker/legal-research-session";
import {corpusSessionSchema,type CorpusSessionInput} from "../legal-chat/corpus-session";
import {createCorpusResearch} from "../legal-chat/corpus-research";
import {createPreparedCandidateIndex,type PreparedSearchRequest} from "../legal-corpus/prepared-candidate-index";
import {createPreparedDiscoveryCatalog} from "../legal-corpus/prepared-discovery-catalog";
import {createPreparedEvidenceSession} from "../legal-corpus/prepared-evidence-session";
import {createPreparedResearchRuntime} from "../legal-corpus/prepared-research-runtime";
import {parsePinnedCandidateRelease,type PinnedCandidateRelease,type TemporalEndpoint} from "../legal-corpus/legal-candidate-index";
import {preparedCandidateConfigurationSchema} from "../legal-corpus/prepared-candidate-configuration";
import {indexedRetrievalSignal} from "./indexed-retrieval";
import {createPreparedNumericTransport} from "../legal-corpus/prepared-numeric-transport";
import {createPreparedQueryEmbedding} from "../legal-corpus/prepared-query-embedding";
import {createPreparedSearchService} from "../legal-corpus/prepared-search-service";
import {createPreparedHistoricalEvidenceReader} from "../legal-corpus/prepared-historical-evidence";

type Capture=Parameters<typeof createPreparedEvidenceSession>[0];
type DiscoveryRequest=Parameters<Parameters<typeof createPreparedDiscoveryCatalog>[0]["readExact"]>[0];

type PreparedRuntimeInput={
  release:PinnedCandidateRelease;
  search:(request:PreparedSearchRequest,signal?:AbortSignal)=>Promise<unknown>;
  readExact:(request:DiscoveryRequest,signal?:AbortSignal)=>Promise<unknown>;
  fetch:(url:string,signal?:AbortSignal)=>ReturnType<Capture["fetch"]>;
  capture:Pick<Capture,"bucket"|"store"|"options">;
  history?:{manifestBytes:Uint8Array;manifestSha256:string};
};
type NativePreparedInput=Omit<PreparedRuntimeInput,"search"|"readExact">&{
  numeric:Parameters<typeof createPreparedNumericTransport>[0];
  embedding:Omit<Parameters<typeof createPreparedQueryEmbedding>[0],"environment"|"releaseId">;
};

function nativeDependencies(input:NativePreparedInput):PreparedRuntimeInput{
  const release=parsePinnedCandidateRelease(input.release);
  const transport=createPreparedNumericTransport(input.numeric);
  const embed=createPreparedQueryEmbedding({...input.embedding,environment:release.environment,releaseId:release.id});
  const search=createPreparedSearchService({release,embed,execute:transport.execute});
  return {...input,release,search:search.search,readExact:transport.readExact};
}

/** Compose admitted native dependencies without selecting or activating a release. */
export function createPreparedNativeResearchRuntime(input:NativePreparedInput){
  return createPreparedCorpusResearchRuntime(nativeDependencies(input));
}
export function createPreparedNativeResearchPairRuntime(input:{current:NativePreparedInput;history:NativePreparedInput}){
  return createPreparedCorpusResearchPairRuntime({current:nativeDependencies(input.current),history:nativeDependencies(input.history)});
}

export function createPreparedCorpusResearchRuntime(input:PreparedRuntimeInput){
  return preparedRuntime([input]);
}

/** The caller supplies one atomically admitted pair. It remains fixed for the
 * runtime; each answer owns separate evidence sessions for its exact endpoints. */
export function createPreparedCorpusResearchPairRuntime(input:{current:PreparedRuntimeInput;history:PreparedRuntimeInput}){
  if(input.current.release.capability!=="current"||input.history.release.capability!=="history"
    ||input.current.release.id===input.history.release.id)throw Error("PREPARED_RESEARCH_PAIR_INVALID");
  return preparedRuntime([input.current,input.history]);
}

function preparedRuntime(inputs:PreparedRuntimeInput[]){
  const selections=inputs.map(input=>{
    const release=parsePinnedCandidateRelease(input.release);
    const configuration=preparedCandidateConfigurationSchema.parse(release.configuration);
    if(release.instances.length!==1||(release.capability==="history"&&!input.history))throw Error("PREPARED_RESEARCH_CAPABILITY_UNSUPPORTED");
    return {...input,release,configuration,history:input.history?{...input.history,manifestBytes:new Uint8Array(input.history.manifestBytes)}:undefined};
  });
  const environment=selections[0]!.release.environment;
  if(selections.some(input=>input.release.environment!==environment))throw Error("PREPARED_RESEARCH_PAIR_INVALID");
  const key=(endpoint:TemporalEndpoint)=>endpoint.kind==="current"?"current":`timestamp:${endpoint.instant}`;
  return {async openLegalResearch(value:CorpusSessionInput){
    const scope=corpusSessionSchema.parse(value);
    if(scope.environment!==environment)throw Error("CORPUS_RESEARCH_ENVIRONMENT_MISMATCH");
    const endpoints=scope.temporalScope.kind==="comparison"?[scope.temporalScope.left,scope.temporalScope.right]:[scope.temporalScope];
    const selected=new Map(endpoints.map(endpoint=>{
      const selection=selections.find(input=>(input.release.capability==="current")===(endpoint.kind==="current"));
      if(!selection)throw Error("PREPARED_HISTORICAL_APPLICABILITY_REQUIRED");
      return [key(endpoint),{endpoint,selection}] as const;
    }));
    return new LegalResearchSession(scope,formulate=>{
      let read:ReturnType<typeof createCorpusResearch>|undefined;
      return request=>{
        if(!read){
          const signal=()=>indexedRetrievalSignal()??request.question.signal;
          const services=new Map([...selected].map(([identity,{endpoint,selection:input}])=>{
            const {release,configuration}=input;
            const session=createPreparedEvidenceSession({...input.capture,configuration,
              ...(endpoint.kind==="timestamp"?{history:{instant:endpoint.instant,
                reader:createPreparedHistoricalEvidenceReader({...input.history!,packageSha256:configuration.artifacts.packageSha256,
                  bucket:input.capture.bucket})}}:{}),
              fetch:url=>input.fetch(url,signal()),options:{...input.capture.options,get signal(){return signal();}}});
            const catalog=createPreparedDiscoveryCatalog({readExact:query=>input.readExact(query,signal())});
            const candidateIndex=createPreparedCandidateIndex({search:query=>input.search(query,signal())});
            return [identity,{...createPreparedResearchRuntime({release,catalog,session}),candidateIndex,release}] as const;
          }));
          const at=(endpoint:TemporalEndpoint)=>{
            const service=services.get(key(endpoint));
            if(!service)throw Error("PREPARED_RESEARCH_ENDPOINT_MISMATCH");
            return service;
          };
          read=createCorpusResearch({formulate,services:{
            releaseResolver:{resolve:async endpoint=>structuredClone(at(endpoint).release),
              resolveComparison:async(left,right)=>({left:structuredClone(at(left).release),right:structuredClone(at(right).release)})},
            candidateIndex:{retrieve:(plan,endpoint,release,context)=>at(endpoint).candidateIndex.retrieve(plan,endpoint,release,context)},
            candidateCatalog:{revalidate:(packet,endpoint,release,currentAt)=>at(endpoint).candidateCatalog.revalidate(packet,endpoint,release,currentAt)},
            evidenceResolver:{
              resolveDiscovery:(id,endpoint,context)=>at(endpoint).evidenceResolver.resolveDiscovery(id,endpoint,context),
              resolveControlling:(id,endpoint,context)=>at(endpoint).evidenceResolver.resolveControlling(id,endpoint,context),
            },
            referenceDiscovery:(candidates,endpoint,release,currentAt)=>at(endpoint).referenceDiscovery(candidates,endpoint,release,currentAt),
            verifyCurrentSource:evidence=>at({kind:"current"}).verifyCurrentSource(evidence),
          }});
        }
        return read(request);
      };
    });
  }};
}
