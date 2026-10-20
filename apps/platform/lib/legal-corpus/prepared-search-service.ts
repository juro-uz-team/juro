import {createHash} from "node:crypto";
import {analyzeCustomWordTerms} from "./custom-bm25";
import {parsePinnedCandidateRelease,type PinnedCandidateRelease} from "./legal-candidate-index";
import {preparedCandidateConfigurationSchema} from "./prepared-candidate-configuration";
import {preparedSearchRequestSchema,preparedSearchRequestHash,preparedSearchResponseSchema,
  type PreparedSearchRequest} from "./prepared-candidate-index";

export type PreparedNumericSearchRequest=Omit<PreparedSearchRequest,"query">&{
  embedding:number[];termHashes:string[];
};

/** The application owns the production analyzer and embedding gateway. The
 * numeric service authenticates artifacts and returns both completed lanes.
 * Neither query text nor query vectors are logged or cached here. The caller
 * supplies admitted dependencies and enforces the embedding spending budget. */
export function createPreparedSearchService(input:{release:PinnedCandidateRelease;
  embed:(query:string,signal:AbortSignal)=>Promise<readonly number[]>;
  execute:(request:PreparedNumericSearchRequest,signal:AbortSignal)=>Promise<unknown>;
}){
  const release=parsePinnedCandidateRelease(input.release);
  const configuration=preparedCandidateConfigurationSchema.parse(release.configuration);
  if(release.instances.length!==1)throw Error("PREPARED_SEARCH_RELEASE_INVALID");
  return {async search(raw:unknown,callerSignal?:AbortSignal){
    const request=preparedSearchRequestSchema.parse(raw);
    if(request.releaseId!==release.id||request.environment!==release.environment
      ||JSON.stringify(request.configuration)!==JSON.stringify(configuration)
      ||(release.capability==="current")!==(request.endpoint.kind==="current")
      ||request.requestSha256!==preparedSearchRequestHash(request)){
      throw Error("PREPARED_SEARCH_REQUEST_MISMATCH");
    }
    // The chat caller owns cancellation and Admin Center controls its limits.
    const signal=callerSignal??new AbortController().signal;
    signal.throwIfAborted();
    const terms=[...new Set(analyzeCustomWordTerms(request.query))];
    // Never silently drop terms: the numeric sparse reader has this bound.
    if(terms.length>64)throw Error("PREPARED_SEARCH_TERM_LIMIT");
    const embedding=Array.from(await input.embed(request.query,signal));
    signal.throwIfAborted();
    if(embedding.length!==3072||embedding.some(value=>!Number.isFinite(value)||!Number.isFinite(Math.fround(value)))
      ||!embedding.some(value=>Math.fround(value)!==0))throw Error("PREPARED_SEARCH_EMBEDDING_INVALID");
    const {query:_,...identity}=request;
    const response=preparedSearchResponseSchema.parse(await input.execute({...identity,embedding,
      termHashes:terms.map(term=>createHash("sha256").update(`word-v1\0${term}`).digest("hex")).sort()},signal));
    signal.throwIfAborted();
    if(response.releaseId!==release.id||response.environment!==release.environment
      ||response.requestSha256!==request.requestSha256
      ||JSON.stringify(response.configuration)!==JSON.stringify(configuration)
      ||new Set(response.hits.map(hit=>hit.membershipOrdinal)).size!==response.hits.length){
      throw Error("PREPARED_SEARCH_RESPONSE_MISMATCH");
    }
    return response;
  }};
}
