import type {QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import type {ResearchRequest} from "./research";

/** The official publisher's search accepts a complete query of this length. */
export const MAX_OFFICIAL_RESEARCH_QUERY_CHARACTERS = 100;

export type ResearchFormulation = {interpretationId:string;
  formulation:QuestionInterpretation["formulations"][number]};
export type ResearchFormulator = (request:ResearchRequest,
  onFormulation?:(fragment:ResearchFormulation)=>Promise<void>)=>Promise<QuestionInterpretation>;


/** Stable identities shared by speculative fragments and the final plan. */
export function researchInterpretation(round:number,queries:readonly {
  text:string;topicIndices:readonly number[];privateNameSpans:string[];legalTitleSpans:string[];
}[]):QuestionInterpretation {
  return {id:`research:${round}`,formulations:queries.map((query,index)=>({
    id:`query:${round}:${index}`,text:query.text,privateNameSpans:query.privateNameSpans,
    legalTitleSpans:query.legalTitleSpans,readingIds:["question"],
    requirementIds:[...new Set(query.topicIndices)].map(index=>`topic:${index}`),
  }))};
}
