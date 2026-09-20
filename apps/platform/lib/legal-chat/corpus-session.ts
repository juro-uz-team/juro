import {z} from "zod";
import {interpretationSchema, type QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import {legalEnvironmentSchema, legalIdentifierSchema, utcInstantSchema} from "../legal-corpus/target-domain-schemas";
import {LEGAL_CHAT_MAX_RESEARCH_ROUNDS} from "./execution-limits";
import type {ResearchPacket, ResearchRequest} from "./research";

const endpoint=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("current")}).strict(),
  z.object({kind:z.literal("timestamp"),instant:utcInstantSchema}).strict(),
]);
export const corpusSessionSchema=z.object({
  requestId:legalIdentifierSchema,
  environment:legalEnvironmentSchema,
  temporalScope:z.union([endpoint,z.object({kind:z.literal("comparison"),left:endpoint,right:endpoint}).strict()]),
}).strict();
export type CorpusSessionInput=z.infer<typeof corpusSessionSchema>;
export type CorpusSearchInput={round:number;plan:QuestionInterpretation};
const searchSchema=z.object({
  round:z.number().int().min(0).max(LEGAL_CHAT_MAX_RESEARCH_ROUNDS-1),
  plan:interpretationSchema,
}).strict();

/** Owns a single turn's pinned reader. Only research formulations cross the
 * service boundary; case facts, conversation history and answers stay with chat.
 * A failed search consumes its round because it may already have incurred work. */
export function createCorpusSession(input:CorpusSessionInput,
  createReader:(formulate:(request:ResearchRequest)=>Promise<QuestionInterpretation>)=>
    (request:ResearchRequest)=>Promise<ResearchPacket>) {
  const scope=corpusSessionSchema.parse(input);
  const controller=new AbortController();
  let nextRound=0;
  let busy=false;
  let plan:QuestionInterpretation|undefined;
  const read=createReader(async()=>{
    controller.signal.throwIfAborted();
    if(!plan)throw new Error("CORPUS_RESEARCH_PLAN_MISSING");
    return plan;
  });
  return {
    async search(raw:CorpusSearchInput):Promise<ResearchPacket> {
      controller.signal.throwIfAborted();
      const search=searchSchema.parse(raw);
      if(busy)throw new Error("CORPUS_RESEARCH_SEARCH_IN_PROGRESS");
      // A round may fail in platform-side formulation before it reaches this
      // reader. Permit skipped rounds, but never repeat or go backwards.
      if(search.round<nextRound)throw new Error("CORPUS_RESEARCH_ROUND_MISMATCH");
      busy=true;
      nextRound=search.round+1;
      plan=search.plan;
      try {
        const packet=await read({round:search.round,needs:[],question:{
          question:scope.requestId,topics:[scope.requestId],temporalScope:scope.temporalScope,
          locale:"ru",mode:"fast",answerMode:"detailed",signal:controller.signal,
        }});
        controller.signal.throwIfAborted();
        return packet;
      } finally {busy=false;plan=undefined;}
    },
    close(){controller.abort(new DOMException("Research session closed","AbortError"));},
  };
}
