import { answerFromEvidence, type AnswerModel, type AnswerOutcome, type AnswerQuestion } from "./answer-engine";
import { interpretLegalQuestion, type QuestionContext, type QuestionContextInput } from "./question-context";
import { researchLegalQuestion, type LegalResearchServices, type ResearchNeed, type ResearchObservation } from "./research";
import { runReservedLegalChat } from "./reserved-execution";
import { aiText } from "../ai/localization";
import type {LegalSourceContext} from "../legal/source-context";
import {validateAnswerSources} from "./final-source-validation";
import type {SourceObservation} from "../legal/source-observation";

export type LegalChatTerminal = (AnswerOutcome & {caseFacts?:readonly string[];research:{
  needs:readonly ResearchNeed[];rounds:number;sourceUnavailable:boolean;evidenceIds:string[];observations:readonly ResearchObservation[];
}}) | Exclude<QuestionContext,{kind:"ready"}>;
export type LegalChatStage="interpreting"|"researching"|"writing"|"verifying"|"correcting"|"saving";

/** One reserved request owns interpretation, bounded research, answer and save.
 * Storage adapters enforce tenant ownership and atomic terminal persistence;
 * adapters are supplied only after reservation/replay resolution by the route. */
export function executeLegalChat<Saved>(input:{
  context:QuestionContextInput;
  mode:AnswerQuestion["mode"];
  answerMode:AnswerQuestion["answerMode"];
  interpret:(input:QuestionContextInput)=>Promise<unknown>;
  research:LegalResearchServices;
  model:AnswerModel;
  /** Production supplies a publisher reader; frozen-evidence evaluations omit it. */
  observeSource?:(url:string)=>Promise<SourceObservation>;
  renew:()=>Promise<boolean>;
  commit:(terminal:LegalChatTerminal,sources:readonly LegalSourceContext[])=>Promise<Saved>;
  release:(reason:"cancelled"|"lease_lost"|"failed")=>Promise<void>;
  onStage?:(stage:LegalChatStage)=>void;
}):Promise<Saved> {
  return runReservedLegalChat<{terminal:LegalChatTerminal;sources:readonly LegalSourceContext[]},Saved>({signal:input.context.signal,renew:input.renew,
    commit:({terminal,sources})=>{input.onStage?.("saving");return input.commit(terminal,sources);},release:input.release,
    work:async(signal):Promise<{terminal:LegalChatTerminal;sources:readonly LegalSourceContext[]}>=>{
      input.onStage?.("interpreting");
      const context=await interpretLegalQuestion({...input.context,signal},input.interpret);
      if(context.kind!=="ready") return {terminal:context,sources:[]};
      const question={question:context.question,topics:context.topics,locale:input.context.locale,
        mode:input.mode,answerMode:input.answerMode,temporalScope:context.temporalScope,
        caseFacts:context.caseFacts,userContext:context.userContext,priorTurns:context.priorTurns,signal};
      input.onStage?.("researching");
      const research=await researchLegalQuestion(question,input.research);
      // Research feedback is not approved public legal prose. Keep detailed
      // source needs inside research; publication receives a neutral limitation.
      const unresolved=research.needs.length?[aiText(question.locale,
        "Официальные источники не позволили полностью проверить все существенные части вопроса.",
        "Rasmiy manbalar savolning barcha muhim qismlarini to‘liq tekshirish uchun yetarli bo‘lmadi.",
        "Official research could not fully verify every material part of the question.")]:[];
      let validated:ReadonlyMap<string,LegalSourceContext>=new Map();
      let sourceUnavailable=research.sourceUnavailable;
      const observe=input.observeSource;
      const answer=await answerFromEvidence({...question,evidence:research.evidence,unresolved,
        sourceUnavailable:research.sourceUnavailable,researchNeeds:research.needs,onStage:input.onStage},input.model,
        observe?{validateSources:async evidence=>{
          validated=await validateAnswerSources({evidence,observe,signal});
          sourceUnavailable ||= validated.size!==evidence.length;
          return validated;
        }}:undefined);
      signal.throwIfAborted();
      const published=new Set(answer.result.sources.map(source=>source.sourceId));
      const sources=research.evidence.filter(item=>published.has(item.source.id)).map(item=>({
        ...(validated.get(item.source.id)??item.source),
        applicabilityStatus:item.endpoint.kind==="current"?"current" as const:"historical" as const,
        spans:[{id:`${item.source.id}:complete`,article:item.source.article??null,paragraph:null,
          text:item.text,textSha256:item.textSha256,quality:"high" as const}]}));
      return {terminal:{...answer,caseFacts:context.caseFacts,research:{needs:research.needs,rounds:research.rounds,
        sourceUnavailable,evidenceIds:research.evidence.map(item=>item.source.id),observations:research.observations}},
        // Authenticated spans are ephemeral inputs to receipt persistence, not
        // part of the serializable terminal answer or its diagnostics.
        sources};
    }});
}
