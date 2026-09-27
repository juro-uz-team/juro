import { z } from "zod";
import type { AnswerQuestion, LegalEvidence } from "./answer-engine";
import { assertAnswerEvidence } from "./evidence-boundary";
import { fitsLegalEvidenceBudget } from "../legal/legal-evidence-budget";
import {selectResearchEvidence} from "./research-evidence";
import { LEGAL_CHAT_MAX_RESEARCH_ROUNDS } from "./execution-limits";
import type {InitialResearchQueries} from "./initial-research-plan";

export const researchNeedSchema = z.object({
  reason: z.enum(["missing_rule", "unresolved_reference", "ambiguous_revision", "source_unavailable", "context_budget", "search_budget"]),
  detail: z.string().trim().min(1).max(1000),
}).strict();
export type ResearchNeed = z.infer<typeof researchNeedSchema>;
export const researchObservationSchema=z.object({
  kind:z.enum(["candidate_read_limit","candidate_context_limit","search_query_limit","historical_live_unavailable"]),
  lane:z.enum(["indexed","official"]),omitted:z.number().int().positive(),
}).strict();
export type ResearchObservation=z.infer<typeof researchObservationSchema>;
export type ResearchQuestion = Omit<AnswerQuestion,"evidence"|"unresolved"|"sourceUnavailable"|"onStage"> & {topics:readonly string[];initialQueries?:InitialResearchQueries};
export type ResearchPacket = {evidence:readonly LegalEvidence[]; needs:readonly ResearchNeed[];
  observations?:readonly ResearchObservation[];
  resolved?:readonly {need:ResearchNeed;sourceIds:readonly string[]}[]};
export type ResearchRequest = {question:ResearchQuestion; needs:readonly ResearchNeed[]; round:number};
export type ResearchAssessment = {
  selectedSourceIds?:readonly string[];
  supportedAnswerAvailable?:boolean;
  needs:readonly ResearchNeed[];
  resolved:readonly {need:ResearchNeed;sourceIds:readonly string[]}[];
};
export type LegalResearchServices = {
  indexed(request:ResearchRequest):Promise<ResearchPacket>;
  official(request:ResearchRequest):Promise<ResearchPacket>;
  assess(request:ResearchRequest & {evidence:readonly LegalEvidence[];observations?:readonly ResearchObservation[]}):Promise<readonly ResearchNeed[]|ResearchAssessment>;
};
export type LegalResearchResult = ResearchPacket & {
  sourceUnavailable:boolean;
  rounds:number;
  observations:readonly ResearchObservation[];
};

/** Retrieval discovers evidence; assessment identifies unresolved coverage.
 * Neither a top-k result nor an empty candidate list establishes completeness.
 * All gap repair shares the same initial-plus-two-round budget. */
export async function researchLegalQuestion(question:ResearchQuestion, services:LegalResearchServices):Promise<LegalResearchResult> {
  let evidence:LegalEvidence[]=[];
  let needs:ResearchNeed[]=[];
  let sourceUnavailable=false;
  let rounds=0;
  let pending:LegalEvidence[]=[];
  let packetResolutions:NonNullable<ResearchPacket["resolved"]>=[];
  const known=new Map<string,LegalEvidence>();
  let supportedAnswerAvailable=false;
  const selections=new Map<string,{sourceIds:readonly string[];supportedAnswerAvailable:boolean|undefined}>();
  const signature=(items:readonly LegalEvidence[])=>JSON.stringify(items.map(item=>item.source.id).sort());
  let stalled=false;
  const observations:ResearchObservation[]=[];
  // Structural readers may report one failure per bounded source read. Their
  // inventory is not the model's 40-item response schema; preserve these gaps
  // without discarding otherwise authenticated, useful evidence.
  const parseNeeds=(value:readonly ResearchNeed[])=>z.array(researchNeedSchema).parse(value);
  const checkCancellation=()=>question.signal?.throwIfAborted();
  const finishFastResearch=()=>{
    if(question.mode!=="fast"||!supportedAnswerAvailable||!evidence.length||!needs.length)return false;
    needs.push({reason:"search_budget",detail:"Fast research retained the available relevant evidence; unresolved coverage requires further research."});
    return true;
  };
  const merge=async(packet:ResearchPacket)=>{
    checkCancellation();
    const incoming=parseNeeds(packet.needs);
    observations.push(...z.array(researchObservationSchema).parse(packet.observations??[]));
    if(!fitsLegalEvidenceBudget(packet.evidence.map(item=>item.text))) {
      // This packet is not admitted at all. Do not truncate it, attempt to
      // authenticate an arbitrary prefix, or turn a size limit into an outage.
      needs=[...needs,...incoming,{reason:"context_budget",detail:"Complete retrieved provisions exceed the evidence context budget."}];
      return;
    }
    // Authenticate before accepting, deduplicating or assessing any legal text.
    await assertAnswerEvidence({...question,evidence:packet.evidence,unresolved:[]});
    const combined=new Map(evidence.map(item=>[item.source.id,item]));
    for(const item of packet.evidence) {
      const previous=known.get(item.source.id);
      if(previous && JSON.stringify(previous)!==JSON.stringify(item)) throw new Error("RESEARCH_EVIDENCE_IDENTITY_CONFLICT");
      combined.set(item.source.id,item);
      known.set(item.source.id,item);
    }
    pending=[...combined.values()];
    packetResolutions=packet.resolved??[];
    for(const resolution of packetResolutions) {
      researchNeedSchema.parse(resolution.need);
      if(!resolution.sourceIds.length||resolution.sourceIds.some(id=>!combined.has(id))) {
        throw new Error("RESEARCH_RESOLUTION_EVIDENCE_MISSING");
      }
    }
    needs=[...needs,...incoming];
  };
  const search=async(lane:"indexed"|"official",request:ResearchRequest)=>{
    checkCancellation();
    let packet:ResearchPacket;
    try {packet=await services[lane](request);}
    catch {
      checkCancellation();
      sourceUnavailable=true;
      needs.push({reason:"source_unavailable",detail:`The ${lane} official-source search could not be completed.`});
      return;
    }
    await merge(packet);
  };
  for(let round=0;round<LEGAL_CHAT_MAX_RESEARCH_ROUNDS;round++) {
    checkCancellation();
    rounds=round+1;
    const initialKnownCount=known.size;
    const request={question,needs:[...needs],round};
    await search("indexed",request);
    const assess=async()=>{
      checkCancellation();
      const candidates=pending;
      const key=signature(candidates);
      needs=[...new Map(needs.map(need=>[JSON.stringify(need),need])).values()];
      let assessment:ResearchAssessment={needs:[],resolved:[]};
      const cached=selections.get(key);
      if(!cached) {
        const result=await services.assess({...request,needs:[...needs],evidence:candidates,observations:[...observations]});
        checkCancellation();
        assessment=Array.isArray(result)?{needs:parseNeeds(result),resolved:[]}:result as ResearchAssessment;
      }
      const next=parseNeeds(assessment.needs);
      const selected=selectResearchEvidence(candidates,cached?.sourceIds??assessment.selectedSourceIds??candidates.map(item=>item.source.id),[...known.values()]);
      if(!fitsLegalEvidenceBudget(selected.map(item=>item.text))) {
        // The assessor sees at most two authenticated bounded packets. If the
        // relevant complete provisions still do not fit, keep the prior set.
        pending=evidence;packetResolutions=[];
        return [...next,{reason:"context_budget" as const,detail:"Complete retrieved provisions exceed the evidence context budget."}];
      }
      for(const resolution of assessment.resolved) {
        researchNeedSchema.parse(resolution.need);
        // Coverage assessment cannot certify operational failures, nor resolve
        // a gap using text excluded from the evidence sent to the writer.
        if(!["missing_rule","unresolved_reference"].includes(resolution.need.reason)
          || !needs.some(need=>need.reason===resolution.need.reason&&need.detail===resolution.need.detail)
          || !resolution.sourceIds.length || resolution.sourceIds.some(id=>!selected.some(item=>item.source.id===id))) {
          throw new Error("RESEARCH_ASSESSMENT_RESOLUTION_INVALID");
        }
      }
      const retainedPacketResolutions=packetResolutions.filter(resolution=>
        resolution.sourceIds.every(id=>selected.some(item=>item.source.id===id)));
      needs=needs.filter(need=>![...assessment.resolved,...retainedPacketResolutions].some(resolution=>
        need.reason===resolution.need.reason&&need.detail===resolution.need.detail));
      evidence=selected;pending=selected;packetResolutions=[];
      const answerable=cached?cached.supportedAnswerAvailable:assessment.supportedAnswerAvailable;
      supportedAnswerAvailable=answerable===true;
      // A negative answerability verdict is itself an unresolved coverage fact.
      // Missing prose must not turn related evidence into successful research.
      if(answerable===false&&!needs.length&&!next.length)next.push({reason:"missing_rule",
        detail:"The selected evidence does not yet support a substantive answer to the requested decision."});
      selections.set(key,{sourceIds:selected.filter(item=>candidates.some(candidate=>candidate.source.id===item.source.id)).map(item=>item.source.id),supportedAnswerAvailable:answerable});
      selections.set(signature(selected),{sourceIds:selected.map(item=>item.source.id),supportedAnswerAvailable:answerable});
      return next;
    };
    let assessed=await assess();
    needs=[...needs,...assessed];
    // Partial publication still requires the whole draft's independent audit.
    // Preserve every gap rather than spending Fast latency on repair rounds.
    if(finishFastResearch())break;
    if(!evidence.length || needs.length || assessed.length) {
      await search("official",{...request,needs:[...needs]});
      assessed=await assess();
    }
    // No known gap disappears merely because a later assessment omits it.
    // Resolution must explicitly identify the need and authenticated evidence.
    needs=[...needs,...assessed];
    needs=[...new Map(needs.map(need=>[`${need.reason}:${need.detail}`,need])).values()];
    if(!needs.length && evidence.length) break;
    if(finishFastResearch())break;
    // Keep one recovery round for transient article or publisher read failures,
    // including when the initial attempt admitted no evidence at all.
    if(round>0 && known.size===initialKnownCount) {stalled=true;break;}
  }
  checkCancellation();
  if(!evidence.length && !needs.length) needs.push({reason:"missing_rule",detail:"No authenticated official evidence was found for the question."});
  if(rounds===LEGAL_CHAT_MAX_RESEARCH_ROUNDS && needs.length) needs.push({reason:"search_budget",detail:"The bounded official research rounds are exhausted; unresolved coverage remains."});
  else if(stalled && needs.length) needs.push({reason:"search_budget",detail:"Research stopped after both search lanes added no authenticated evidence; unresolved coverage remains."});
  sourceUnavailable ||= needs.some(need=>need.reason==="source_unavailable");
  return {evidence,needs,sourceUnavailable,rounds,observations};
}
