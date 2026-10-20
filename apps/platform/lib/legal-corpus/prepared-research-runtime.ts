import {createHash} from "node:crypto";
import {parseCandidatePacket,parsePinnedCandidateRelease,type CandidatePacket,type PinnedCandidateRelease,type TemporalEndpoint} from "./legal-candidate-index";
import {preparedCandidateConfigurationSchema} from "./prepared-candidate-configuration";
import type {createPreparedDiscoveryCatalog} from "./prepared-discovery-catalog";
import type {createPreparedEvidenceSession} from "./prepared-evidence-session";
import {bindPreparedEvidenceCandidate} from "./prepared-evidence-candidate";
import {parseRevalidatedCandidates,type SelectionCandidate} from "./target-retrieval";
import type {ResearchDiscoveryCandidate} from "../legal-chat/corpus-research";
import type {ReferenceDiscoveryResult} from "./runtime-reference-discovery";
import {sameInstrumentArticleReferences} from "../legal/referenced-article-context";
import {legalReferenceKey,type LegalReferenceQuery} from "./custom-reference-lookup";

type Catalog=ReturnType<typeof createPreparedDiscoveryCatalog>;
type Session=ReturnType<typeof createPreparedEvidenceSession>;
type Evidence=Awaited<ReturnType<Session["resolve"]>>;
const hash=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const articleLabel=(label:string)=>/(?:Article|Статья|Ст\.)\s+(\d+(?:[.-]\d+)?)\s*$/iu.exec(label)?.[1];

/** Request-scoped discovery handles become legal identities only after an exact
 * official capture join. Final current-source verification remains mandatory. */
export function createPreparedResearchRuntime(input:{release:PinnedCandidateRelease;catalog:Catalog;session:Session}){
  const pinned=parsePinnedCandidateRelease(input.release);
  const configuration=preparedCandidateConfigurationSchema.parse(pinned.configuration);
  if(pinned.capability!=="current"||pinned.instances.length!==1)throw Error("PREPARED_RESEARCH_CAPABILITY_UNSUPPORTED");
  const instance=pinned.instances[0]!;
  const discoveries=new Map<string,{packet:Awaited<ReturnType<Catalog["read"]>>;reference:[number,number];candidate:CandidatePacket["candidates"][number]}>();
  const evidence=new Map<string,Evidence>();
  const check=(endpoint:TemporalEndpoint,release:PinnedCandidateRelease)=>{
    if(endpoint.kind!=="current"||JSON.stringify(parsePinnedCandidateRelease(release))!==JSON.stringify(pinned)){
      throw Error("PREPARED_RESEARCH_RELEASE_MISMATCH");
    }
  };
  const candidateCatalog={async revalidate(value:CandidatePacket,endpoint:TemporalEndpoint,release:PinnedCandidateRelease,_currentAt:string){
    check(endpoint,release);const packet=parseCandidatePacket(value);
    if(packet.releaseId!==pinned.id||packet.endpoint.kind!=="current"||packet.availability!=="available"
      ||packet.partialErrors.length||packet.requiredInstanceIds.length!==1||packet.requiredInstanceIds[0]!==instance.id
      ||new Set(packet.candidates.map(row=>row.itemKey)).size!==packet.candidates.length){
      throw Error("PREPARED_RESEARCH_PACKET_INVALID");
    }
    const result:ResearchDiscoveryCandidate[]=[];
    for(let start=0;start<packet.candidates.length;start+=128){
      const candidates=packet.candidates.slice(start,start+128);
      const references=candidates.map(candidate=>{
        const prefix=`search-releases/${pinned.id}/prepared/`;
        const match=candidate.itemKey.startsWith(prefix)?/^(0|[1-9]\d*)\/(0|[1-9]\d*)$/u.exec(candidate.itemKey.slice(prefix.length)):null;
        if(!match||candidate.instanceId!==instance.id||candidate.shardId!==instance.shardId
          ||candidate.referenceOrigin)throw Error("PREPARED_RESEARCH_MEMBER_INVALID");
        const reference:[number,number]=[Number(match[1]),Number(match[2])];
        if(!reference.every(Number.isSafeInteger))throw Error("PREPARED_RESEARCH_MEMBER_INVALID");
        return reference;
      });
      const catalogPacket=await input.catalog.read(configuration,references);
      candidates.forEach((candidate,index)=>{
        const reference=references[index]!;
        const discoveryId=`prepared-discovery:${hash([pinned.id,configuration.artifacts.packageSha256,reference])}`;
        if(!discoveries.has(discoveryId)&&discoveries.size>=4096)throw Error("PREPARED_DISCOVERY_BUDGET_EXHAUSTED");
        discoveries.set(discoveryId,{packet:catalogPacket,reference,candidate});
        const record=catalogPacket.records[index]!;
        // Publisher units group discovery reads only. They do not establish a
        // legal article number or replace exact membership/evidence identity.
        const discoveryGroupId=`prepared-unit:${hash([pinned.id,configuration.artifacts.packageSha256,
          record.work,record.unit,record.chunk.language,record.chunk.script])}`;
        result.push({kind:"prepared-discovery",discoveryId,discoveryGroupId,candidate});
      });
    }
    return result;
  }};
  const evidenceResolver={
    async resolveDiscovery(id:string,endpoint:TemporalEndpoint,context:{release:PinnedCandidateRelease;currentAt:string}){
      check(endpoint,context.release);const discovery=discoveries.get(id);
      if(!discovery)throw Error("PREPARED_DISCOVERY_HANDLE_UNKNOWN");
      const resolved=await input.session.resolve(discovery.packet,discovery.reference);
      const bound=bindPreparedEvidenceCandidate(discovery.candidate,resolved);
      evidence.set(bound.candidate.provisionRenditionId,resolved);
      return {candidate:bound.candidate,resolution:bound.resolution};
    },
    async resolveControlling(id:string,endpoint:TemporalEndpoint,context:{release:PinnedCandidateRelease;currentAt:string}){
      check(endpoint,context.release);const resolved=evidence.get(id);
      if(!resolved)throw Error("PREPARED_CAPTURED_EVIDENCE_UNKNOWN");
      return resolved.source.resolution;
    },
  };
  const referenceDiscovery=async(candidates:readonly SelectionCandidate[],endpoint:TemporalEndpoint,
    release:PinnedCandidateRelease,_currentAt:string):Promise<ReferenceDiscoveryResult>=>{
    check(endpoint,release);
    const requests=new Map<string,{query:LegalReferenceQuery;origin:SelectionCandidate;resolved:Evidence;concepts:Set<string>}>();
    for(const origin of candidates){
      const resolved=evidence.get(origin.candidate.provisionRenditionId);if(!resolved)continue;
      const source=resolved.source.resolution.controlling;
      const complete=resolved.source.resolution.articleContext??resolved.source.resolution.documentContext;
      if(!complete)throw Error("PREPARED_COMPLETE_CONTEXT_UNAVAILABLE");
      for(const article of sameInstrumentArticleReferences(complete.provisionText)){
        if(candidates.some(row=>row.candidate.textRevisionId===source.textRevisionId
          &&evidence.get(row.candidate.provisionRenditionId)?.source.resolution.controlling.languageTag===source.languageTag
          &&articleLabel(row.citationLabel)===article))continue;
        const query={textRevisionId:source.textRevisionId,languageTag:source.languageTag,article};
        const key=legalReferenceKey(query);
        const request=requests.get(key)??{query,origin,resolved,concepts:new Set<string>()};
        request.concepts.add(origin.candidate.provisionConceptId);requests.set(key,request);
      }
    }
    const result:ReferenceDiscoveryResult={candidates:[],unresolved:[]};
    const ordered=[...requests.values()].sort((a,b)=>b.concepts.size-a.concepts.size);
    for(const [index,request] of ordered.entries()){
      if(index>=3){result.unresolved.push({query:request.query,reason:"lookup_budget"});continue;}
      const found=await input.session.references(request.resolved,1,[request.query.article]);
      const target=found.resolved[0];
      if(!target){result.unresolved.push({query:request.query,
        reason:found.unresolved.find(row=>row.article===request.query.article)?.reason??"reference_not_found"});continue;}
      const original=target.source.resolution.controlling;
      const identity=hash([original.textRevisionId,original.provisionRenditionId]);
      const candidate=parseRevalidatedCandidates([{candidate:{...request.origin.candidate.candidate,
        itemKey:`search-releases/${pinned.id}/prepared-reference/${identity}`,membershipProof:undefined,formulationMatches:undefined,
        referenceOrigin:{itemKey:request.origin.candidate.candidate.itemKey,article:request.query.article},
        vectorScore:0,keywordScore:0,fusionScore:0},canonicalChunkId:`prepared-reference:${identity}`,
        provisionRenditionId:original.provisionRenditionId,textRevisionId:original.textRevisionId,
        provisionConceptId:original.provisionConceptId,textualAuthority:original.textualAuthority,
        languageFamily:original.languageTag.startsWith("uz-")?"uz":original.languageTag}])[0]!;
      evidence.set(original.provisionRenditionId,{...request.resolved,source:target.source});
      result.candidates.push(candidate);
    }
    return result;
  };
  return {candidateCatalog,evidenceResolver,referenceDiscovery,verifyCurrentSource:input.session.verifyCurrentSource};
}
