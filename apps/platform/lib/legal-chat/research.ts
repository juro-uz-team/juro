import { z } from "zod";
import type { AnswerQuestion, LegalEvidence } from "./answer-engine";
import { assertAnswerEvidence } from "./evidence-boundary";
import { fitsLegalEvidenceBudget } from "../legal/legal-evidence-budget";
import { LEGAL_CHAT_MAX_RESEARCH_ROUNDS } from "./execution-limits";

export const researchNeedSchema = z.object({
  reason: z.enum(["missing_rule", "unresolved_reference", "ambiguous_revision", "source_unavailable", "context_budget", "search_budget"]),
  detail: z.string().trim().min(1).max(1000),
}).strict();
export type ResearchNeed = z.infer<typeof researchNeedSchema>;
export type ResearchQuestion = Omit<AnswerQuestion,"evidence"|"unresolved"|"sourceUnavailable"|"onStage"> & {topics:readonly string[]};
export type ResearchPacket = {evidence:readonly LegalEvidence[]; needs:readonly ResearchNeed[];
  resolved?:readonly {need:ResearchNeed;sourceIds:readonly string[]}[]};
export type ResearchRequest = {question:ResearchQuestion; needs:readonly ResearchNeed[]; round:number};
export type LegalResearchServices = {
  indexed(request:ResearchRequest):Promise<ResearchPacket>;
  official(request:ResearchRequest):Promise<ResearchPacket>;
  assess(request:ResearchRequest & {evidence:readonly LegalEvidence[]}):Promise<readonly ResearchNeed[]>;
};
export type LegalResearchResult = ResearchPacket & {
  sourceUnavailable:boolean;
  rounds:number;
};

/** Retrieval discovers evidence; assessment identifies unresolved coverage.
 * Neither a top-k result nor an empty candidate list establishes completeness.
 * All gap repair shares the same initial-plus-two-round budget. */
export async function researchLegalQuestion(question:ResearchQuestion, services:LegalResearchServices):Promise<LegalResearchResult> {
  let evidence:LegalEvidence[]=[];
  let needs:ResearchNeed[]=[];
  let sourceUnavailable=false;
  let rounds=0;
  const parseNeeds=(value:readonly ResearchNeed[])=>z.array(researchNeedSchema).max(40).parse(value);
  const checkCancellation=()=>question.signal?.throwIfAborted();
  const merge=async(packet:ResearchPacket)=>{
    checkCancellation();
    const incoming=parseNeeds(packet.needs);
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
      const previous=combined.get(item.source.id);
      if(previous && JSON.stringify(previous)!==JSON.stringify(item)) throw new Error("RESEARCH_EVIDENCE_IDENTITY_CONFLICT");
      combined.set(item.source.id,item);
    }
    const next=[...combined.values()];
    if(!fitsLegalEvidenceBudget(next.map(item=>item.text))) {
      needs=[...needs,...incoming,{reason:"context_budget",detail:"Complete retrieved provisions exceed the evidence context budget."}];
      return;
    }
    evidence=next;
    for(const resolution of packet.resolved??[]) {
      researchNeedSchema.parse(resolution.need);
      if(!resolution.sourceIds.length || resolution.sourceIds.some(id=>!combined.has(id))) {
        throw new Error("RESEARCH_RESOLUTION_EVIDENCE_MISSING");
      }
      needs=needs.filter(need=>need.reason!==resolution.need.reason||need.detail!==resolution.need.detail);
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
    const request={question,needs:[...needs],round};
    await search("indexed",request);
    const assess=async()=>{
      checkCancellation();
      return parseNeeds(await services.assess({...request,needs:[...needs],evidence}));
    };
    let assessed=await assess();
    needs=[...needs,...assessed];
    if(!evidence.length || needs.length || assessed.length) {
      await search("official",{...request,needs:[...needs]});
      assessed=await assess();
    }
    // No known gap disappears merely because a later assessment omits it.
    // Resolution must explicitly identify the need and authenticated evidence.
    needs=[...needs,...assessed];
    needs=[...new Map(needs.map(need=>[`${need.reason}:${need.detail}`,need])).values()];
    if(!needs.length && evidence.length) break;
  }
  checkCancellation();
  if(!evidence.length && !needs.length) needs.push({reason:"missing_rule",detail:"No authenticated official evidence was found for the question."});
  if(rounds===LEGAL_CHAT_MAX_RESEARCH_ROUNDS && needs.length) needs.push({reason:"search_budget",detail:"The bounded official research rounds are exhausted; unresolved coverage remains."});
  sourceUnavailable ||= needs.some(need=>need.reason==="source_unavailable");
  return {evidence,needs,sourceUnavailable,rounds};
}
