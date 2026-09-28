import type {createRuntimeLegalEvidenceServices} from "../legal-corpus/target-runtime";
import {combineFormulationPackets,interpretationSchema,type CandidatePacket,type PinnedCandidateRelease} from "../legal-corpus/legal-candidate-index";
import type {ResearchFormulator} from "./research-formulation";
import {LEGAL_INTERPRETATION_FORMULATION_LIMIT} from "../legal/question-interpretation-limits";
import type {RevalidatedCandidate, SelectionCandidate} from "../legal-corpus/target-retrieval";
import {fitsLegalEvidenceBudget} from "../legal/legal-evidence-budget";
import type {LegalEvidence, LegalTime} from "./answer-engine";
import {prepareCorpusEvidence,type PreparedCorpusEvidence} from "./corpus-evidence";
import {timeIdentity} from "./evidence-boundary";
import type {ResearchRequest, ResearchPacket, ResearchNeed, ResearchObservation} from "./research";
import type {LegalReferenceQuery} from "../legal-corpus/custom-reference-lookup";
import {sameInstrumentArticleReferences} from "../legal/referenced-article-context";
import {runIndexedRetrieval} from "../runtime/indexed-retrieval";

type RuntimeServices = ReturnType<typeof createRuntimeLegalEvidenceServices>;
type CorpusServices = Pick<RuntimeServices,
  "releaseResolver" | "candidateIndex" | "referenceDiscovery" | "verifyCurrentSource">
  & {candidateCatalog:Pick<RuntimeServices["candidateCatalog"],"revalidate">;
    evidenceResolver:Pick<RuntimeServices["evidenceResolver"],"resolveControlling">};
type EndpointRelease = {endpoint:LegalTime;release:PinnedCandidateRelease};
export type CandidatePrioritizer = (input:{
  renditionIds:readonly string[];
  formulations:readonly string[];
  endpoint:LegalTime;
  release:PinnedCandidateRelease;
  currentAt:string;
  signal?:AbortSignal;
})=>Promise<readonly string[]>;
const MAX_CANDIDATE_READS = 48;
const RESERVED_REFERENCE_READS = 12;

/** One instance belongs to one user turn. Release pairs, current-time filters
 * and authenticated text stay pinned across the initial and repair searches.
 * The supplied formulation policy supplies queries, never legal conclusions. */
export function createCorpusResearch(input: {
  services:CorpusServices;
  formulate:ResearchFormulator;
  prioritize?:CandidatePrioritizer;
  now?:()=>number;
}):(request:ResearchRequest)=>Promise<ResearchPacket> {
  const now=input.now??Date.now;
  const currentAt=new Date(now()).toISOString();
  let owner:string|undefined;
  let pinned:Promise<EndpointRelease[]>|undefined;
  type CurrentVerifier={key:string;detail:string;verify:()=>ReturnType<CorpusServices["verifyCurrentSource"]>};
  const saved=new Map<string,Promise<{prepared:PreparedCorpusEvidence;verifier?:CurrentVerifier}>>();
  const currentVerifiers=new Map<string,CurrentVerifier>();
  const articles=new Map<string,PreparedCorpusEvidence>();
  const verifiedArticles=new Map<string,LegalEvidence>();
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
    const staged=new Map<string,{fragment:string;packets:Promise<CandidatePacket>[]} >();
    let interpretationId:string|undefined;
    const interpretation=interpretationSchema.parse(await input.formulate(request,async fragment=>{
      check();
      const partial=interpretationSchema.parse({id:fragment.interpretationId,formulations:[fragment.formulation]});
      if(staged.size>=LEGAL_INTERPRETATION_FORMULATION_LIMIT||staged.has(fragment.formulation.id)
        ||(interpretationId!==undefined&&interpretationId!==partial.id))throw new Error("CORPUS_RESEARCH_FRAGMENT_INVALID");
      interpretationId=partial.id;
      const packets=releases.map(({endpoint,release})=>input.services.candidateIndex.retrieve(partial,endpoint,release,{currentAt}));
      for(const packet of packets)void packet.catch(()=>undefined);
      staged.set(fragment.formulation.id,{fragment:JSON.stringify(partial.formulations[0]),packets});
    }));
    if(new Set(interpretation.formulations.map(item=>item.id)).size!==interpretation.formulations.length)throw new Error("CORPUS_RESEARCH_FRAGMENT_INVALID");
    if(staged.size&&(interpretation.id!==interpretationId
      ||[...staged].some(([id,item])=>JSON.stringify(interpretation.formulations.find(formulation=>formulation.id===id))!==item.fragment))) {
      throw new Error("CORPUS_RESEARCH_FRAGMENT_INVALID");
    }
    check();
    const needs:ResearchNeed[]=[];
    const resolutions:NonNullable<ResearchPacket["resolved"]>[number][]=[];
    const evidence=new Map<string,PreparedCorpusEvidence>();
    const primaryEvidence=new Set<string>();
    const dependencies=new Map<string,Set<string>>();
    const readEvidence=new Map<string,PreparedCorpusEvidence>();
    const seen=new Set<string>();
    const resolved:SelectionCandidate[][]=releases.map(()=>[]);
    const queues:RevalidatedCandidate[][]=[];
    let discoveryOmitted=0;
    // Both comparison endpoints share the deadline. Start their independent
    // candidate searches together, then preserve endpoint order for admission.
    for(const {endpoint,release} of releases) {
      if((release.capability==="current")!==(endpoint.kind==="current"))throw new Error("CORPUS_RELEASE_TEMPORAL_MISMATCH");
    }
    const candidatePackets=releases.map(async({endpoint,release},releaseIndex)=>staged.size
      ?combineFormulationPackets(interpretation,endpoint,release,
        await Promise.all(interpretation.formulations.map(formulation=>staged.get(formulation.id)?.packets[releaseIndex]
          ??input.services.candidateIndex.retrieve({id:interpretation.id,formulations:[formulation]},endpoint,release,{currentAt}))))
      :input.services.candidateIndex.retrieve(interpretation,endpoint,release,{currentAt}));
    for(const packet of candidatePackets)void packet.catch(()=>undefined);
    // Metadata validation and selection are independent for each endpoint too.
    // Preserve the pinned endpoint order when merging, not completion order.
    const selections=await Promise.all(releases.map(async({endpoint,release},releaseIndex)=>{
      check();
      if((release.capability==="current")!==(endpoint.kind==="current")) {
        throw new Error("CORPUS_RELEASE_TEMPORAL_MISMATCH");
      }
      try {
        const packet=await candidatePackets[releaseIndex]!;
        check();
        if(packet.availability!=="available"||packet.partialErrors.length
          || packet.releaseId!==release.id || timeIdentity(packet.endpoint)!==timeIdentity(endpoint)) {
          throw new Error("CORPUS_SEARCH_INCOMPLETE");
        }
        const candidates=await input.services.candidateCatalog.revalidate(packet,endpoint,release,currentAt);
        check();
        // Interleave each formulation's ranked candidates. A multi-part
        // question must not allocate all source reads to its first topic.
        const byFormulation=interpretation.formulations.map(formulation=>{
          const seenProvisions=new Set<string>();
          return candidates
          .filter(item=>item.candidate.formulationIds.includes(formulation.id))
          .sort((a,b)=>{
            const rank=(item:RevalidatedCandidate)=>item.candidate.formulationMatches
              ?.find(match=>match.formulationId===formulation.id)?.rank??Number.MAX_SAFE_INTEGER;
            return rank(a)-rank(b)||b.candidate.fusionScore-a.candidate.fusionScore;
          }).filter(item=>{
            // Rank complete provisions, not repeated chunks of one provision.
            // Preserve the first (best-ranked) representative in each query.
            if(seenProvisions.has(item.provisionRenditionId))return false;
            seenProvisions.add(item.provisionRenditionId);return true;
          });
        });
        const ordered=new Map<string,RevalidatedCandidate>();
        for(let rank=0;byFormulation.some(items=>rank<items.length);rank++) {
          for(const items of byFormulation) {
            const candidate=items[rank];
            if(candidate&&!ordered.has(candidate.provisionRenditionId)) ordered.set(candidate.provisionRenditionId,candidate);
          }
        }
        const priority=await input.prioritize?.({renditionIds:[...ordered.keys()],
          formulations:interpretation.formulations.map(formulation=>formulation.text),endpoint,release,currentAt,signal})??[];
        check();
        if(priority.some(id=>!ordered.has(id)))throw new Error("CORPUS_DISCOVERY_PRIORITY_INVALID");
        // Read the discovery selection and then its explicit references.
        // Empty selection retains deterministic fallback discovery. Selection
        // never establishes legal support or completeness.
        const prioritized=new Set(priority);
        return {queue:prioritized.size?[...prioritized].map(id=>ordered.get(id)!):[...ordered.values()],
          omitted:prioritized.size?ordered.size-prioritized.size:0};
      } catch {
        check();
        return {queue:[],omitted:0,
          need:{reason:"source_unavailable" as const,detail:`Indexed search was incomplete for ${timeIdentity(endpoint)}.`}};
      }
    }));
    for(const selection of selections){
      queues.push(selection.queue);discoveryOmitted+=selection.omitted;
      if(selection.need)needs.push(selection.need);
    }
    let reads=0;
    let unreadCandidates=0;
    // Start authenticated publication checks while complete reading continues.
    // A request-local queue caps I/O; results never affect discovery or ordering.
    // Repaired rounds refresh their observations rather than reuse old verdicts.
    const sourceChecks=new Map<string,ReturnType<CurrentVerifier["verify"]>>();
    const publicationChecks=new Map<string,Promise<unknown>>();
    const waitingChecks:Array<()=>void>=[];
    let activeChecks=0;
    const checkCurrentSource=(id:string,publication:string,verifier:CurrentVerifier)=>{
      const existing=sourceChecks.get(id);
      if(existing)return existing;
      const previous=publicationChecks.get(publication);
      const pending=(async()=>{
        if(previous)await previous;
        if(activeChecks<4)activeChecks++;
        else await new Promise<void>(resolve=>waitingChecks.push(resolve));
        try {check();return await verifier.verify();}
        finally {
          const next=waitingChecks.shift();
          if(next)next();else activeChecks--;
        }
      })();
      sourceChecks.set(id,pending);
      publicationChecks.set(publication,pending.catch(()=>undefined));
      // A speculative read may be excluded by the context budget. Its failure
      // is handled here; admitted sources still consume the rejecting promise.
      void pending.catch(()=>undefined);
      return pending;
    };
    const prepareRead=(candidate:RevalidatedCandidate,index:number,reference=false):(()=>Promise<void>)=>{
      check();
      const {endpoint,release}=releases[index]!;
      const key=JSON.stringify([release.id,timeIdentity(endpoint),candidate.provisionRenditionId]);
      if(seen.has(key)) {
        return async()=>{
          const item=readEvidence.get(key);
          if(!reference&&item)primaryEvidence.add(item.source.id);
        };
      }
      if(!saved.has(key)&&reads>=(reference?MAX_CANDIDATE_READS:MAX_CANDIDATE_READS-RESERVED_REFERENCE_READS)) {
        return async()=>{
        if(reference) {
          const need:ResearchNeed={reason:"unresolved_reference",detail:`${candidate.provisionRenditionId} at ${timeIdentity(endpoint)}: The source read budget did not cover this explicitly referenced provision.`};
          needs.push(need);
          pendingReads.set(key,[...new Map([...(pendingReads.get(key)??[]),need].map(value=>[JSON.stringify(value),value])).values()]);
        }
        else unreadCandidates++;
        };
      }
      seen.add(key);
        let pending=saved.get(key);
        if(!pending) {
          reads++;
          pending=(async()=>{
            const resolution=await input.services.evidenceResolver.resolveControlling(candidate.provisionRenditionId,endpoint,{release,currentAt});
            check();
            const prepared=await prepareCorpusEvidence({resolution,endpoint});
            return {prepared,...(endpoint.kind==="current"?{verifier:{key,
              detail:`${candidate.provisionRenditionId} at ${timeIdentity(endpoint)}`,
              verify:()=>input.services.verifyCurrentSource(resolution.controlling)}}:{})};
          })();
          saved.set(key,pending);
          // A transient reader failure may recover in a later bounded round.
          void pending.catch(()=>{if(saved.get(key)===pending)saved.delete(key);});
        }
      // Capture failures immediately while earlier ranked reads are pending.
      const outcome=pending.then(item=>({item}),error=>({error}));
      return async()=>{try {
        const result=await outcome;
        if("error" in result)throw result.error;
        check();
        const item=articles.get(result.item.prepared.source.id)??result.item.prepared;
        if(!articles.has(item.source.id)&&result.item.verifier)currentVerifiers.set(item.source.id,result.item.verifier);
        articles.set(item.source.id,item);
        const verifier=currentVerifiers.get(item.source.id);
        if(verifier)checkCurrentSource(item.source.id,item.source.officialUrl,verifier);
        readEvidence.set(key,item);
        resolved[index]!.push({candidate,citationLabel:item.source.actTitle,provisionText:item.text});
        evidence.set(item.source.id,item);
        if(!reference) primaryEvidence.add(item.source.id);
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
      }};
    };
    // Reserve reads in rank order, overlap only their I/O, and commit in the
    // same order. Completion timing cannot choose canonical articles or spend
    // another candidate's reserved read/context allowance.
    const readOrdered=async(entries:Iterable<{candidate:RevalidatedCandidate;index:number}>,reference=false)=>{
      const iterator=entries[Symbol.iterator]();
      const pending:(()=>Promise<void>)[]=[];
      let exhausted=false;
      while(!exhausted||pending.length) {
        check();
        while(!exhausted&&pending.length<4) {
          const entry=iterator.next();
          if(entry.done)exhausted=true;
          else pending.push(prepareRead(entry.value.candidate,entry.value.index,reference));
        }
        if(pending.length)await pending.shift()!();
      }
    };
    function* rankedCandidates() {
    for(let rank=0;queues.some(queue=>rank<queue.length);rank++) {
      for(let index=0;index<queues.length;index++) {
        const candidate=queues[index]![rank];
        if(candidate)yield {candidate,index};
      }
    }
    }
    await readOrdered(rankedCandidates());
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
        await readOrdered(references.candidates.map(candidate=>({candidate,index})),true);
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
            &&(articles.includes(item.source.article??"")
              ||target.candidate.candidate.referenceOrigin?.itemKey===referring.candidate.candidate.itemKey)) {
            const targets=dependencies.get(source.source.id)??new Set<string>();
            if(item.source.id!==source.source.id)targets.add(item.source.id);
            dependencies.set(source.source.id,targets);
          }
        }
      }
    }
    const admitted:PreparedCorpusEvidence[]=[];
    let excludedCandidates=0;
    const admittedIds=new Set<string>();
    // Preserve the interleaved primary order. A reference has no independent
    // priority: reserve its complete context together with the referring rule.
    // Shared dependencies are charged once, including transitive/cyclic links.
    for(const id of primaryEvidence) {
      if(admittedIds.has(id))continue;
      const group=new Map<string,PreparedCorpusEvidence>();
      const visit=(sourceId:string)=>{
        if(group.has(sourceId)||admittedIds.has(sourceId))return;
        const item=evidence.get(sourceId);if(!item)return;
        group.set(sourceId,item);
        for(const target of dependencies.get(sourceId)??[])visit(target);
      };
      visit(id);
      if(fitsLegalEvidenceBudget([...admitted,...group.values()].map(item=>item.text))) {
        for(const item of group.values()){admitted.push(item);admittedIds.add(item.source.id);}
      } else {
        excludedCandidates++;
        if(!fitsLegalEvidenceBudget([...group.values()].map(item=>item.text))) {
          needs.push({reason:"context_budget",detail:`Complete connected context for source ${id} did not fit the answer evidence budget.`});
        }
      }
    }
    const observations:ResearchObservation[]=[];
    if(discoveryOmitted)observations.push({kind:"candidate_discovery_selection",lane:"indexed",omitted:discoveryOmitted});
    if(unreadCandidates)observations.push({kind:"candidate_read_limit",lane:"indexed",omitted:unreadCandidates});
    if(excludedCandidates)observations.push({kind:"candidate_context_limit",lane:"indexed",omitted:excludedCandidates});
    // Selection is independent of publisher results. Every selected source must
    // pass; a failed current observation cannot be replaced by a lower-ranked hit.
    const answerEvidence:LegalEvidence[]=[];
    const verifyItem=async(item:PreparedCorpusEvidence)=>{
        check();
        const verifier=currentVerifiers.get(item.source.id);
        try {
          const currentSourceStatus=verifier?await checkCurrentSource(item.source.id,item.source.officialUrl,verifier):undefined;
          check();
          const verified=item.finalize({currentAt:new Date(now()).toISOString(),currentSourceStatus});
          const canonical=verifiedArticles.get(verified.source.id)??verified;
          verifiedArticles.set(canonical.source.id,canonical);
          return {item:canonical};
        } catch(error) {
          check();
          const unconfirmed=error instanceof Error&&error.message==="CORPUS_CURRENT_SOURCE_UNCONFIRMED";
          const need:ResearchNeed={reason:unconfirmed?"ambiguous_revision":"source_unavailable",
            detail:`${verifier?.detail??item.source.id}: `+(unconfirmed
              ?"A retrieved revision could not be confirmed against the current official publication."
              :"The admitted source could not be verified against the current official publication.")};
          return {need,key:verifier?.key};
        }
    };
    // I/O is already queued independently. Finalize in admission order so
    // completion timing cannot change citations or replace a failed source.
    for(const item of admitted){
      const result=await verifyItem(item);
      if(result.item)answerEvidence.push(result.item);
      else {
        needs.push(result.need);
        if(result.key)pendingReads.set(result.key,[...new Map([...(pendingReads.get(result.key)??[]),result.need]
          .map(value=>[JSON.stringify(value),value])).values()]);
      }
    }
    check();
    return {evidence:answerEvidence,needs:[...new Map(needs.map(need=>[JSON.stringify(need),need])).values()],
      observations,
      resolved:[...new Map(resolutions.filter(resolution=>resolution.sourceIds.every(id=>answerEvidence.some(item=>item.source.id===id)))
        .map(resolution=>[JSON.stringify(resolution.need),resolution])).values()]};
  };
  return request=>runIndexedRetrieval(request.question.signal,signal=>
    research({...request,question:{...request.question,signal}}));
}
