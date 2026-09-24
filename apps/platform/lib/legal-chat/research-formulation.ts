import type {QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import type {ResearchRequest} from "./research";

export type ResearchFormulation = {interpretationId:string;
  formulation:QuestionInterpretation["formulations"][number]};
export type ResearchFormulator = (request:ResearchRequest,
  onFormulation?:(fragment:ResearchFormulation)=>Promise<void>)=>Promise<QuestionInterpretation>;
