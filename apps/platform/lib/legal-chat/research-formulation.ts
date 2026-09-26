import type {QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import type {ResearchRequest} from "./research";

/** The official publisher's search accepts a complete query of this length. */
export const MAX_OFFICIAL_RESEARCH_QUERY_CHARACTERS = 100;

export type ResearchFormulation = {interpretationId:string;
  formulation:QuestionInterpretation["formulations"][number]};
export type ResearchFormulator = (request:ResearchRequest,
  onFormulation?:(fragment:ResearchFormulation)=>Promise<void>)=>Promise<QuestionInterpretation>;
