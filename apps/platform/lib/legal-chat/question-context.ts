import type {LegalUserContext} from "./user-context";
import {containsExactQuotation} from "./quoted-text";
import { z } from "zod";
import { parseLegalApplicabilityDate } from "../legal/applicability-date";
import { aiText } from "../ai/localization";
import type { LegalTemporalScope, LegalTime } from "./answer-engine";

const endpoint = z.union([z.literal("current"),z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]);
export const questionContextSchema = z.object({
  selectedMemoryIds:z.array(z.string().min(1).max(160)).max(20).default([]),
  topics:z.array(z.string().min(1).max(1000)).min(1).max(24),
  facts:z.array(z.object({turn:z.number().int().nonnegative(),quotation:z.string().min(1).max(2000)}).strict()).max(40),
  temporal:z.discriminatedUnion("kind",[
    z.object({kind:z.literal("current")}).strict(),
    z.object({kind:z.literal("date"),date:endpoint}).strict(),
    z.object({kind:z.literal("comparison"),left:endpoint,right:endpoint}).strict(),
    z.object({kind:z.literal("unresolved")}).strict(),
  ]),
  questions:z.array(z.string().min(1).max(500)).max(8),
}).strict();

export type QuestionContextInput = {
  question:string;locale:"ru"|"uz"|"en";priorTurns:readonly{question:string;answer:string}[];
  userContext?:LegalUserContext;legalContextDate?:string;now?:Date;signal?:AbortSignal;
};
export type QuestionContext =
  | {kind:"ready";question:string;topics:string[];caseFacts:string[];priorTurns:QuestionContextInput["priorTurns"];temporalScope:LegalTemporalScope;questions:string[];userContext?:LegalUserContext}
  | {kind:"clarification_required";questions:string[]}
  | {kind:"unavailable";errorCode:"QUESTION_INTERPRETATION_UNAVAILABLE"|"AI_CANCELLED"};

/** Interpret intent once. Facts must quote user messages exactly; prior legal
 * claims cannot become facts merely because an assistant previously stated them. */
export async function interpretLegalQuestion(input:QuestionContextInput,
  interpret:(input:QuestionContextInput)=>Promise<unknown>):Promise<QuestionContext> {
  const clarify = ():QuestionContext => ({kind:"clarification_required",questions:[aiText(input.locale,
    "На какую дату нужно проверить закон? Для сравнения укажите обе даты.",
    "Qonunni qaysi sana uchun tekshirish kerak? Taqqoslash uchun ikkala sanani ko‘rsating.",
    "Which date should the law be checked for? For a comparison, specify both dates.")]});
  const selectedDate = input.legalContextDate ? parseLegalApplicabilityDate(input.legalContextDate,input.now) : null;
  if(input.legalContextDate && !selectedDate) return clarify();
  if(input.signal?.aborted) return {kind:"unavailable",errorCode:"AI_CANCELLED"};
  try {
    const value=questionContextSchema.parse(await interpret(input));
    if(input.signal?.aborted) return {kind:"unavailable",errorCode:"AI_CANCELLED"};
    const selectedIds=new Set(value.selectedMemoryIds);
    if(value.selectedMemoryIds.some(id=>!input.userContext?.memories.some(memory=>memory.id===id))) {
      return {kind:"unavailable",errorCode:"QUESTION_INTERPRETATION_UNAVAILABLE"};
    }
    const userContext=input.userContext?{...input.userContext,memories:input.userContext.memories.filter(memory=>selectedIds.has(memory.id))}:undefined;
    const userMessages=[...input.priorTurns.map(turn=>turn.question),input.question];
    if(value.facts.some(fact=>!containsExactQuotation(userMessages[fact.turn],fact.quotation))) {
      return {kind:"unavailable",errorCode:"QUESTION_INTERPRETATION_UNAVAILABLE"};
    }
    if(value.temporal.kind==="unresolved") return value.questions.length
      ? {kind:"clarification_required",questions:value.questions} : clarify();
    const time=(value:string):LegalTime|null => {
      if(value==='current') return {kind:"current"};
      const parsed=parseLegalApplicabilityDate(value,input.now);
      return parsed ? {kind:"timestamp",instant:parsed.toISOString()} : null;
    };
    let temporalScope:LegalTemporalScope;
    if(value.temporal.kind==='comparison') {
      const left=time(value.temporal.left),right=time(value.temporal.right);
      if(!left||!right) return clarify();
      if(selectedDate && ![left,right].some(endpoint=>endpoint.kind==='timestamp'&&endpoint.instant===selectedDate.toISOString())) return clarify();
      temporalScope={kind:"comparison",left,right};
    } else if(selectedDate) temporalScope={kind:"timestamp",instant:selectedDate.toISOString()};
    else {
      const endpoint=time(value.temporal.kind==='current'?'current':value.temporal.date);
      if(!endpoint) return clarify();
      temporalScope=endpoint;
    }
    return {kind:"ready",question:input.question,topics:value.topics,
      caseFacts:[...new Set(value.facts.filter(fact=>fact.turn===input.priorTurns.length).map(fact=>fact.quotation))],
      priorTurns:input.priorTurns,temporalScope,questions:value.questions,userContext};
  } catch { return {kind:"unavailable",errorCode:input.signal?.aborted?"AI_CANCELLED":"QUESTION_INTERPRETATION_UNAVAILABLE"}; }
}
