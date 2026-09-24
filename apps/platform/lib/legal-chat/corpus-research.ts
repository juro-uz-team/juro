import type {createRuntimeLegalEvidenceServices} from "../legal-corpus/target-runtime";
import type {PinnedCandidateRelease, QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import type {RevalidatedCandidate, SelectionCandidate} from "../legal-corpus/target-retrieval";
import {fitsLegalEvidenceBudget} from "../legal/legal-evidence-budget";
import type {LegalEvidence, LegalTime} from "./answer-engine";
import {corpusAnswerEvidence} from "./corpus-evidence";
import {timeIdentity} from "./evidence-boundary";
import type {ResearchRequest, ResearchPacket, ResearchNeed, ResearchObservation} from "./research";
import type {LegalReferenceQuery} from "../legal-corpus/custom-reference-lookup";
import {sameInstrumentArticleReferences} from "../legal/referenced-article-context";
import {runIndexedRetrieval} from "../runtime/indexed-retrieval";

type RuntimeServices = ReturnType<typeof createRuntimeLegalEvidenceServices>;
type CorpusServices = Pick<RuntimeServices,
  "releaseResolver" | "candidateIndex" | "evidenceResolver" | "referenceDiscovery" | "verifyCurrentSource">
  & {candidateCatalog:Pick<RuntimeServices["candidateCatalog"],"revalidate">};
type EndpointRelease = {endpoint:LegalTime;release:PinnedCandidateRelease};
const MAX_CANDIDATE_READS = 48;
const RESERVED_REFERENCE_READS = 12;

/** One instance belongs to one user turn. Release pairs, current-time filters
 * and authenticated text stay pinned across the initial and repair searches.
 * The supplied formulation policy supplies queries, never legal conclusions. */
export function createCorpusResearch(input: {
  services:CorpusServices;
  formulate:(request:ResearchRequest)=>Promise<QuestionInterpretation>;
  now?:()=>number;
}):(request:ResearchRequest)=>Promise<ResearchPacket> {
  const now=input.now??Date.now;
  const currentAt=new Date(now()).toISOString();
  let owner:string|undefined;
  let pinned:Promise<EndpointRelease[]>|undefined;
  const saved=new Map<string,Promise<LegalEvidence>>();
  const articles=new Map<string,LegalEvidence>();
  const pendingReads=new Map<string,ResearchNeed[]>();
  const pendingReferences=new Map<string,{query:LegalReferenceQuery;endpoint:LegalTime;need:ResearchNeed}>();
  const research=async(request:ResearchRequest):Promise<ResearchPacket>=>{
    const signal=request.question.signal;
    const check=()=>signal?.throwIfAborted();
    check();
    const identity=JSON.stringify([request.question.question,request.question.topics,
      request.question.temporalScope,request.question.priorTurns??[],request.question.caseFacts??[]]);
    if(owner!==undefined&&owner!==identity) throw new Error("CORPUS_RESEARCH_REQUEST_MISMATCH");
    owner=identity;
    pinned??=(async()=>{
      const scope=request.question.temporalScope;
      if(scope.kind==="comparison") {
        // Resolve the pair together so activation changes cannot mix releases.
        const pair=await input.services.releaseResolver.resolveComparison?.(scope.left,scope.right);
        if(!pair) throw new Error("CORPUS_COMPARISON_RELEASE_UNAVAILABLE");
        return [{endpoint:scope.left,release:pair.left},{endpoint:scope.right,release:pair.right}];
      }
      const release=await input.services.releaseResolver.resolve(scope);
      if(!release) throw new Error("CORPUS_RELEASE_UNAVAILABLE");
      return [{endpoint:scope,release}];
    })();
    const releases=await pinned;
    check();
    // ADR 0007: both indexed candidate lanes receive the same unmodified
    // request-local formulation. Public-site discovery has a separate policy.
    const interpretation=await input.formulate(request);
    check();
    const needs:ResearchNeed[]=[];
    const resolutions:NonNullable<ResearchPacket["resolved"]>[number][]=[];
    const evidence=new Map<string,LegalEvidence>();
    const referenceEvidence=new Set<string>();
    const readEvidence=new Map<string,LegalEvidence>();
    const seen=new Set<string>();
    const resolved:SelectionCandidate[][]=releases.map(()=>[]);
    const queues:RevalidatedCandidate[][]=[];
    for(const {endpoint,release} of releases) {
      check();
      if((release.capability==="current")!==(endpoint.kind==="current")) {
        throw new Error("CORPUS_RELEASE_TEMPORAL_MISMATCH");
      }
      try {
        const packet=await input.services.candidateIndex.retrieve(interpretation,endpoint,release,{currentAt});
        check();
        if(packet.availability!=="available"||packet.partialErrors.length
          || packet.releaseId!==release.id || timeIdentity(packet.endpoint)!==timeIdentity(endpoint)) {
          throw new Error("CORPUS_SEARCH_INCOMPLETE");
        }
        const candidates=await input.services.candidateCatalog.revalidate(packet,endpoint,release,currentAt);
        check();
        // Interleave each formulation's ranked candidates. A multi-part
        // question must not allocate all source reads to its first topic.
        const byFormulation=interpretation.formulations.map(formulation=>candidates
          .filter(item=>item.candidate.formulationIds.includes(formulation.id))
          .sort((a,b)=>{
            const rank=(item:RevalidatedCandidate)=>item.candidate.formulationMatches
              ?.find(match=>match.formulationId===formulation.id)?.rank??Number.MAX_SAFE_INTEGER;
            return rank(a)-rank(b)||b.candidate.fusionScore-a.candidate.fusionScore;
          }));
        const ordered=new Map<string,RevalidatedCandidate>();
        for(let rank=0;byFormulation.some(items=>rank<items.length);rank++) {
          for(const items of byFormulation) {
            const candidate=items[rank];
            if(candidate) ordered.set(candidate.provisionRenditionId,candidate);
          }
        }
        queues.push([...ordered.values()]);
      } catch {
        check();
        queues.push([]);
        needs.push({reason:"source_unavailable",detail:`Indexed search was incomplete for ${timeIdentity(endpoint)}.`});
      }
    }
    let reads=0;
    let unreadCandidates=0;
    const read=async(candidate:RevalidatedCandidate,index:number,reference=false)=>{
      check();
      const {endpoint,release}=releases[index]!;
      const key=JSON.stringify([release.id,timeIdentity(endpoint),candidate.provisionRenditionId]);
      if(seen.has(key)) {
        const item=readEvidence.get(key);
        if(reference&&item)referenceEvidence.add(item.source.id);
        return;
      }
      if(!saved.has(key)&&reads>=(reference?MAX_CANDIDATE_READS:MAX_CANDIDATE_READS-RESERVED_REFERENCE_READS)) {
        if(reference) {
          const need:ResearchNeed={reason:"unresolved_reference",detail:`${candidate.provisionRenditionId} at ${timeIdentity(endpoint)}: The source read budget did not cover this explicitly referenced provision.`};
          needs.push(need);
          pendingReads.set(key,[...new Map([...(pendingReads.get(key)??[]),need].map(value=>[JSON.stringify(value),value])).values()]);
        }
        else unreadCandidates++;
        return;
      }
      seen.add(key);
      try {
        let pending=saved.get(key);
        if(!pending) {
          reads++;
          pending=(async()=>{
            const resolution=await input.services.evidenceResolver.resolveControlling(candidate.provisionRenditionId,endpoint,{release,currentAt});
            check();
            const currentSourceStatus=endpoint.kind==="current"&&resolution.controlling.textualAuthority==="controlling"
              ?await input.services.verifyCurrentSource(resolution.controlling):undefined;
            check();
            const item=await corpusAnswerEvidence({resolution,endpoint,currentAt:new Date(now()).toISOString(),currentSourceStatus});
            const canonical=articles.get(item.source.id)??item;
            articles.set(item.source.id,canonical);
            return canonical;
          })();
          saved.set(key,pending);
          // A transient reader failure may recover in a later bounded round.
          void pending.catch(()=>{if(saved.get(key)===pending)saved.delete(key);});
        }
        const item=await pending;
        check();
        readEvidence.set(key,item);
        resolved[index]!.push({candidate,citationLabel:item.source.actTitle,provisionText:item.text});
        evidence.set(item.source.id,item);
        if(reference) referenceEvidence.add(item.source.id);
        for(const need of pendingReads.get(key)??[]) resolutions.push({need,sourceIds:[item.source.id]});
        for(const pending of pendingReferences.values()) {
          const language={ru:"ru",uz:"uz-Latn",uzc:"uz-Cyrl",en:"en"}[item.source.locale];
          if(timeIdentity(pending.endpoint)===timeIdentity(endpoint)
            && pending.query.textRevisionId===candidate.textRevisionId
            && pending.query.languageTag===language && pending.query.article===item.source.article) {
            resolutions.push({need:pending.need,sourceIds:[item.source.id]});
          }
        }
      } catch(error) {
        check();
        const code=error instanceof Error?error.message:"";
        const need:ResearchNeed={reason:code==="CORPUS_COMPLETE_ARTICLE_UNAVAILABLE"?"missing_rule":
          code==="CORPUS_CURRENT_SOURCE_UNCONFIRMED"?"ambiguous_revision":"source_unavailable",
        detail:`${candidate.provisionRenditionId} at ${timeIdentity(endpoint)}: `+(code==="CORPUS_COMPLETE_ARTICLE_UNAVAILABLE"
          ?"A retrieved article fragment could not be expanded to its authenticated complete article."
          :code==="CORPUS_CURRENT_SOURCE_UNCONFIRMED"
            ?"A retrieved revision could not be confirmed against the current official publication."
            :"A retrieved candidate could not be authenticated as complete official evidence.")};
        needs.push(need);
        pendingReads.set(key,[...new Map([...(pendingReads.get(key)??[]),need].map(value=>[JSON.stringify(value),value])).values()]);
      }
    };
    for(let rank=0;queues.some(queue=>rank<queue.length);rank++) {
      for(let index=0;index<queues.length;index++) {
        const candidate=queues[index]![rank];
        if(candidate) await read(candidate,index);
      }
    }
    // References are resolved from authenticated complete text, and all added
    // candidates pass the same reader and capacity checks as search results.
    for(let index=0;index<releases.length;index++) {
      check();
      if(!resolved[index]!.length) continue;
      const {endpoint,release}=releases[index]!;
      if(!input.services.referenceDiscovery) {
        needs.push({reason:"unresolved_reference",detail:"Official cross-reference discovery is unavailable."});
        continue;
      }
      try {
        const references=await input.services.referenceDiscovery(resolved[index]!,endpoint,release,currentAt);
        check();
        for(const gap of references.unresolved) {
          const need:ResearchNeed={reason:"unresolved_reference",
            detail:`Article ${gap.query.article} in revision ${gap.query.textRevisionId} (${gap.query.languageTag}) at ${timeIdentity(endpoint)} remains unresolved: ${gap.reason}.`};
          needs.push(need);
          pendingReferences.set(JSON.stringify(need),{need,query:gap.query,endpoint});
        }
        for(const candidate of references.candidates) await read(candidate,index,true);
      } catch {
        check();
        needs.push({reason:"unresolved_reference",detail:"Official cross-reference lookup could not be completed."});
      }
    }
    check();
    // Reference discovery does not return targets it already saw in the
    // candidate pool. Preserve those dependencies before deduplication/context
    // selection too, using the same instrument, revision, language and endpoint.
    for(let index=0;index<releases.length;index++) {
      const {endpoint,release}=releases[index]!;
      const itemFor=(candidate:SelectionCandidate)=>readEvidence.get(JSON.stringify([
        release.id,timeIdentity(endpoint),candidate.candidate.provisionRenditionId]));
      for(const referring of resolved[index]!) {
        const source=itemFor(referring);
        if(!source)continue;
        const articles=sameInstrumentArticleReferences(referring.provisionText);
        for(const target of resolved[index]!) {
          const item=itemFor(target);
          if(item&&item.source.officialUrl===source.source.officialUrl&&item.source.locale===source.source.locale
            &&target.candidate.textRevisionId===referring.candidate.textRevisionId
            &&articles.includes(item.source.article??"")) referenceEvidence.add(item.source.id);
        }
      }
    }
    const admitted:LegalEvidence[]=[];
    let excludedCandidates=0;
    // Reserve context for explicit dependencies as well as their source reads.
    // Ranked discovery hits alone must not crowd all referenced rules out.
    for(const item of [...evidence.values()].sort((left,right)=>
      Number(referenceEvidence.has(right.source.id))-Number(referenceEvidence.has(left.source.id)))) {
      if(fitsLegalEvidenceBudget(admitted.map(value=>value.text).concat(item.text))) admitted.push(item);
      else if(referenceEvidence.has(item.source.id)) needs.push({reason:"context_budget",detail:"A complete explicitly referenced provision did not fit the answer evidence budget."});
      else excludedCandidates++;
    }
    const observations:ResearchObservation[]=[];
    if(unreadCandidates)observations.push({kind:"candidate_read_limit",lane:"indexed",omitted:unreadCandidates});
    if(excludedCandidates)observations.push({kind:"candidate_context_limit",lane:"indexed",omitted:excludedCandidates});
    return {evidence:admitted,needs:[...new Map(needs.map(need=>[JSON.stringify(need),need])).values()],
      observations,
      resolved:[...new Map(resolutions.filter(resolution=>resolution.sourceIds.every(id=>admitted.some(item=>item.source.id===id)))
        .map(resolution=>[JSON.stringify(resolution.need),resolution])).values()]};
  };
  return request=>runIndexedRetrieval(request.question.signal,signal=>
    research({...request,question:{...request.question,signal}}));
}
