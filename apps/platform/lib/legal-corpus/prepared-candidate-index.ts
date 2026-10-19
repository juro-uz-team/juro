import {createHash} from "node:crypto";
import {z} from "zod";
import {createCallbackCandidateIndex,type TemporalEndpoint} from "./legal-candidate-index";
import {preparedCandidateConfigurationSchema,type PreparedCandidateConfiguration} from "./prepared-candidate-configuration";
import {legalEnvironmentSchema,searchReleaseIdSchema,sha256Schema} from "./target-domain-schemas";

export type PreparedSearchRequest={
  version:"prepared-search-v1";releaseId:string;environment:z.infer<typeof legalEnvironmentSchema>;
  configuration:PreparedCandidateConfiguration;endpoint:TemporalEndpoint;query:string;
  requestSha256:string;limit:50;
};
const responseSchema=z.object({
  version:z.literal("prepared-search-v1"),releaseId:searchReleaseIdSchema,
  environment:legalEnvironmentSchema,requestSha256:sha256Schema,
  configuration:preparedCandidateConfigurationSchema,
  lanes:z.object({dense:z.literal("complete"),sparse:z.literal("complete")}).strict(),
  hits:z.array(z.object({
    membershipOrdinal:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    vectorRank:z.number().int().positive(),vectorScore:z.number().finite(),
    keywordRank:z.number().int().positive(),keywordScore:z.number().finite(),fusionScore:z.number().finite(),
  }).strict()).max(50),
}).strict();

/** Prepared search uses generation-pinned discovery artifacts. This adapter
 * admits neither temporal applicability nor source evidence; the catalog and
 * complete-evidence reader independently authenticate each membership later. */
export function createPreparedCandidateIndex(transport:{search(request:PreparedSearchRequest):Promise<unknown>}){
  let active=0;const waiting:Array<()=>void>=[];
  return createCallbackCandidateIndex(async(formulation,endpoint,release)=>{
    const configuration=preparedCandidateConfigurationSchema.parse(release.configuration);
    if(release.instances.length!==1||(release.capability==="current")!==(endpoint.kind==="current")){
      throw Error("PREPARED_SEARCH_RELEASE_INVALID");
    }
    const request={version:"prepared-search-v1" as const,releaseId:release.id,environment:release.environment,
      configuration,endpoint,query:formulation.text,limit:50 as const};
    const requestSha256=createHash("sha256").update(JSON.stringify(request)).digest("hex");
    if(active<2)active++;else await new Promise<void>(resolve=>waiting.push(resolve));
    let response:z.infer<typeof responseSchema>;
    try{response=responseSchema.parse(await transport.search({...request,requestSha256}));}
    finally{const next=waiting.shift();if(next)next();else active--;}
    if(response.releaseId!==release.id||response.environment!==release.environment
      ||response.requestSha256!==requestSha256
      ||JSON.stringify(response.configuration)!==JSON.stringify(configuration)
      ||new Set(response.hits.map(hit=>hit.membershipOrdinal)).size!==response.hits.length){
      throw Error("PREPARED_SEARCH_RESPONSE_MISMATCH");
    }
    const instance=release.instances[0]!;
    return response.hits.map(({membershipOrdinal,...scores})=>({
      itemKey:`search-releases/${release.id}/prepared/${membershipOrdinal}`,
      instanceId:instance.id,shardId:instance.shardId,...scores,
    }));
  });
}
