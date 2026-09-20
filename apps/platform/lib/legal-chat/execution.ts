import { answerFromEvidence, type AnswerModel, type AnswerOutcome, type AnswerQuestion } from "./answer-engine";
import { interpretLegalQuestion, type QuestionContext, type QuestionContextInput } from "./question-context";
import { researchLegalQuestion, type LegalResearchServices, type ResearchNeed } from "./research";
import { runReservedLegalChat } from "./reserved-execution";
import { aiText } from "../ai/localization";

export type LegalChatTerminal = (AnswerOutcome & {research:{
  needs:readonly ResearchNeed[];rounds:number;sourceUnavailable:boolean;evidenceIds:string[];
}}) | Exclude<QuestionContext,{kind:"ready"}>;

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
  renew:()=>Promise<boolean>;
  commit:(terminal:LegalChatTerminal)=>Promise<Saved>;
  release:(reason:"cancelled"|"lease_lost"|"failed")=>Promise<void>;
}):Promise<Saved> {
  return runReservedLegalChat({signal:input.context.signal,renew:input.renew,
    commit:input.commit,release:input.release,work:async signal=>{
      const context=await interpretLegalQuestion({...input.context,signal},input.interpret);
      if(context.kind!=="ready") return context;
      const question={question:context.question,topics:context.topics,locale:input.context.locale,
        mode:input.mode,answerMode:input.answerMode,temporalScope:context.temporalScope,
        caseFacts:context.caseFacts,priorTurns:context.priorTurns,signal};
      const research=await researchLegalQuestion(question,input.research);
      // Research feedback is not approved public legal prose. Keep detailed
      // source needs inside research; publication receives a neutral limitation.
      const unresolved=research.needs.length?[aiText(question.locale,
        "Официальные источники не позволили полностью проверить все существенные части вопроса.",
        "Rasmiy manbalar savolning barcha muhim qismlarini to‘liq tekshirish uchun yetarli bo‘lmadi.",
        "Official research could not fully verify every material part of the question.")]:[];
      const answer=await answerFromEvidence({...question,evidence:research.evidence,unresolved,
        sourceUnavailable:research.sourceUnavailable,researchNeeds:research.needs},input.model);
      return {...answer,research:{needs:research.needs,rounds:research.rounds,
        sourceUnavailable:research.sourceUnavailable,evidenceIds:research.evidence.map(item=>item.source.id)}};
    }});
}
