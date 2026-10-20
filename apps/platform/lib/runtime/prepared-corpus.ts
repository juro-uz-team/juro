import {LegalResearchSession} from "../../worker/legal-research-session";
import {corpusSessionSchema,type CorpusSessionInput} from "../legal-chat/corpus-session";
import {createCorpusResearch} from "../legal-chat/corpus-research";
import {createPreparedCandidateIndex,type PreparedSearchRequest} from "../legal-corpus/prepared-candidate-index";
import {createPreparedDiscoveryCatalog} from "../legal-corpus/prepared-discovery-catalog";
import {createPreparedEvidenceSession} from "../legal-corpus/prepared-evidence-session";
import {createPreparedResearchRuntime} from "../legal-corpus/prepared-research-runtime";
import {parsePinnedCandidateRelease,type PinnedCandidateRelease} from "../legal-corpus/legal-candidate-index";
import {preparedCandidateConfigurationSchema} from "../legal-corpus/prepared-candidate-configuration";
import {indexedRetrievalSignal} from "./indexed-retrieval";
import {createPreparedNumericTransport} from "../legal-corpus/prepared-numeric-transport";
import {createPreparedQueryEmbedding} from "../legal-corpus/prepared-query-embedding";
import {createPreparedSearchService} from "../legal-corpus/prepared-search-service";
import {createPreparedHistoricalEvidenceReader} from "../legal-corpus/prepared-historical-evidence";

type Capture=Parameters<typeof createPreparedEvidenceSession>[0];
type DiscoveryRequest=Parameters<Parameters<typeof createPreparedDiscoveryCatalog>[0]["readExact"]>[0];

/** Compose the native query gateway and private worker after release admission.
 * The selected-release controller still owns qualification and activation. */
export function createPreparedNativeResearchRuntime(input:
  Omit<Parameters<typeof createPreparedCorpusResearchRuntime>[0],"search"|"readExact">&{
    numeric:Parameters<typeof createPreparedNumericTransport>[0];
    embedding:Omit<Parameters<typeof createPreparedQueryEmbedding>[0],"environment"|"releaseId">;
  }){
  const release=parsePinnedCandidateRelease(input.release);
  const transport=createPreparedNumericTransport(input.numeric);
  const embed=createPreparedQueryEmbedding({...input.embedding,environment:release.environment,releaseId:release.id});
  const search=createPreparedSearchService({release,embed,execute:transport.execute});
  return createPreparedCorpusResearchRuntime({...input,release,search:search.search,readExact:transport.readExact});
}

/** The native request/session boundary for an explicitly selected prepared
 * release. Admission and activation belong to the caller; this constructor
 * does not infer readiness from artifact pins or claim historical coverage. */
export function createPreparedCorpusResearchRuntime(input:{
  release:PinnedCandidateRelease;
  search:(request:PreparedSearchRequest,signal?:AbortSignal)=>Promise<unknown>;
  readExact:(request:DiscoveryRequest,signal?:AbortSignal)=>Promise<unknown>;
  fetch:(url:string,signal?:AbortSignal)=>ReturnType<Capture["fetch"]>;
  capture:Pick<Capture,"bucket"|"store"|"options"|"captureLimit">;
  history?:{manifestBytes:Uint8Array;manifestSha256:string};
}){
  const release=parsePinnedCandidateRelease(input.release);
  const configuration=preparedCandidateConfigurationSchema.parse(release.configuration);
  if(release.instances.length!==1||(release.capability==="history"&&!input.history))throw Error("PREPARED_RESEARCH_CAPABILITY_UNSUPPORTED");
  return {async openLegalResearch(value:CorpusSessionInput){
    const scope=corpusSessionSchema.parse(value);
    if(scope.environment!==release.environment)throw Error("CORPUS_RESEARCH_ENVIRONMENT_MISMATCH");
    if(scope.temporalScope.kind==="comparison"||(scope.temporalScope.kind==="current")!==(release.capability==="current")){
      throw Error("PREPARED_HISTORICAL_APPLICABILITY_REQUIRED");
    }
    const endpoint=scope.temporalScope;
    return new LegalResearchSession(scope,formulate=>{
      let read:ReturnType<typeof createCorpusResearch>|undefined;
      return request=>{
        if(!read){
          const signal=()=>indexedRetrievalSignal()??request.question.signal;
          const session=createPreparedEvidenceSession({...input.capture,configuration,
            ...(endpoint.kind==="timestamp"?{history:{instant:endpoint.instant,
              reader:createPreparedHistoricalEvidenceReader({...input.history!,packageSha256:configuration.artifacts.packageSha256,
                bucket:input.capture.bucket})}}:{}),
            fetch:url=>input.fetch(url,signal()),options:{...input.capture.options,get signal(){return signal();}}});
          const catalog=createPreparedDiscoveryCatalog({readExact:query=>input.readExact(query,signal())});
          const candidateIndex=createPreparedCandidateIndex({search:query=>input.search(query,signal())});
          const runtime=createPreparedResearchRuntime({release,catalog,session});
          read=createCorpusResearch({formulate,services:{...runtime,candidateIndex,
            releaseResolver:{resolve:async requested=>requested.kind===endpoint.kind
              &&(requested.kind!=="timestamp"||endpoint.kind!=="timestamp"||requested.instant===endpoint.instant)?structuredClone(release):null}}});
        }
        return read(request);
      };
    });
  }};
}
