import {emptyLegalAnswer,type AnswerQuestion} from "./answer-engine";
import type {LegalChatTerminal} from "./execution";
import {legalChatResponseSchema,type LegalChatResponse} from "../ai/legal-chat-schema";
import {questionInterpretationFailureText} from "../ai/legal-answer-failure";

/** Uses the retained public response shape for pre-research clarification and
 * operational failure. Internal verification/research records never enter it. */
export function legalChatTerminalResponse(terminal:LegalChatTerminal,
  preferences:Pick<AnswerQuestion,"locale"|"mode"|"answerMode">):LegalChatResponse {
  if("result" in terminal)return legalChatResponseSchema.parse(terminal.result);
  const empty=emptyLegalAnswer({...preferences,unresolved:[]});
  if(terminal.kind==="clarification_required") {
    return {...empty,summary:terminal.questions[0]??empty.summary,answer:terminal.questions.join("\n")||empty.answer,
      clarificationQuestions:terminal.questions};
  }
  const text=questionInterpretationFailureText(preferences.locale);
  return {...empty,summary:text,answer:text,failureReason:"question_interpretation_unavailable",sourceValidationStatus:"unavailable"};
}
