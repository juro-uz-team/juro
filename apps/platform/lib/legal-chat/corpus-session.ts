import {z} from "zod";
import {interpretationSchema, type QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import {legalEnvironmentSchema, legalIdentifierSchema, utcInstantSchema} from "../legal-corpus/target-domain-schemas";
import {LEGAL_CHAT_MAX_RESEARCH_ROUNDS} from "./execution-limits";
import {LEGAL_INTERPRETATION_FORMULATION_LIMIT} from "../legal/question-interpretation-limits";
import type {ResearchFormulation, ResearchFormulator} from "./research-formulation";
import type {ResearchPacket, ResearchRequest} from "./research";

const endpoint=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("current")}).strict(),
  z.object({kind:z.literal("timestamp"),instant:utcInstantSchema}).strict(),
]);
export const corpusSessionSchema=z.object({
  requestId:legalIdentifierSchema,
  environment:legalEnvironmentSchema,
  mode:z.enum(["fast","deep"]).optional(),
  temporalScope:z.union([endpoint,z.object({kind:z.literal("comparison"),left:endpoint,right:endpoint}).strict()]),
}).strict();
export type CorpusSessionInput=z.infer<typeof corpusSessionSchema>;
export type CorpusSearchInput={round:number;plan:QuestionInterpretation};
export type CorpusStageInput=ResearchFormulation&{round:number};
const searchSchema=z.object({
  round:z.number().int().min(0).max(LEGAL_CHAT_MAX_RESEARCH_ROUNDS-1),
  plan:interpretationSchema,
}).strict();

/** Owns a single turn's pinned reader. Only research formulations cross the
 * service boundary; case facts, conversation history and answers stay with chat.
 * A failed search consumes its round because it may already have incurred work. */
export function createCorpusSession(input:CorpusSessionInput,
  createReader:(formulate:ResearchFormulator)=>(request:ResearchRequest)=>Promise<ResearchPacket>) {
  const scope=corpusSessionSchema.parse(input);
  const controller=new AbortController();
  let nextRound=0;
  type Active={round:number;finalized:boolean;fragments:ResearchFormulation[];
    emit?:NonNullable<Parameters<ResearchFormulator>[1]>;emitted:number;draining:Promise<void>;
    complete:ReturnType<typeof Promise.withResolvers<QuestionInterpretation>>;result:Promise<ResearchPacket>};
  let active:Active|undefined;
  const drain=(round:Active)=>{
    round.draining=round.draining.then(async()=>{
      while(round.emit&&round.emitted<round.fragments.length){
        controller.signal.throwIfAborted();
        await round.emit(round.fragments[round.emitted++]!);
      }
    });
    return round.draining;
  };
  const read=createReader(async(request,emit)=>{
    controller.signal.throwIfAborted();
    const round=active;
    if(!round||round.round!==request.round)throw new Error("CORPUS_RESEARCH_PLAN_MISSING");
    round.emit=emit;
    await drain(round);
    return round.complete.promise;
  });
  const start=(round:number):Active=>{
    if(active)throw new Error("CORPUS_RESEARCH_SEARCH_IN_PROGRESS");
    if(round<nextRound)throw new Error("CORPUS_RESEARCH_ROUND_MISMATCH");
    nextRound=round+1;
    const complete=Promise.withResolvers<QuestionInterpretation>();
    void complete.promise.catch(()=>undefined);
    const result=Promise.resolve().then(()=>read({round,needs:[],question:{
      question:scope.requestId,topics:[scope.requestId],temporalScope:scope.temporalScope,
      locale:"ru",mode:scope.mode??"fast",answerMode:"detailed",signal:controller.signal,
    }})).then(packet=>{controller.signal.throwIfAborted();return packet;});
    void result.catch(()=>undefined);
    active={round,complete,result,finalized:false,fragments:[],emitted:0,draining:Promise.resolve()};
    return active;
  };
  return {
    async stage(raw:CorpusStageInput):Promise<void>{
      controller.signal.throwIfAborted();
      const value=z.object({round:searchSchema.shape.round,interpretationId:interpretationSchema.shape.id,
        formulation:interpretationSchema.shape.formulations.element}).strict().parse(raw);
      const round=active??start(value.round);
      if(round.round!==value.round||round.finalized)throw new Error("CORPUS_RESEARCH_SEARCH_IN_PROGRESS");
      if(round.fragments.length>=LEGAL_INTERPRETATION_FORMULATION_LIMIT||round.fragments.some(item=>item.formulation.id===value.formulation.id)
        ||round.fragments.some(item=>item.interpretationId!==value.interpretationId))throw new Error("CORPUS_RESEARCH_FRAGMENT_INVALID");
      round.fragments.push({interpretationId:value.interpretationId,formulation:value.formulation});
      await drain(round);
    },
    async search(raw:CorpusSearchInput):Promise<ResearchPacket> {
      controller.signal.throwIfAborted();
      const search=searchSchema.parse(raw);
      const round=active??start(search.round);
      if(round.round!==search.round||round.finalized)throw new Error("CORPUS_RESEARCH_SEARCH_IN_PROGRESS");
      round.finalized=true;
      try {
        if(round.fragments.some(fragment=>fragment.interpretationId!==search.plan.id
          ||JSON.stringify(search.plan.formulations.find(item=>item.id===fragment.formulation.id))!==JSON.stringify(fragment.formulation))) {
          throw new Error("CORPUS_RESEARCH_FRAGMENT_INVALID");
        }
        await drain(round);
        round.complete.resolve(search.plan);
        return await round.result;
      } catch(error){round.complete.reject(error);throw error;}
      finally{if(active===round)active=undefined;}
    },
    discard(round:number){
      if(active?.round===round&&!active.finalized){
        active.complete.reject(new Error("CORPUS_RESEARCH_PLAN_DISCARDED"));active=undefined;
      }
    },
    close(){
      controller.abort(new DOMException("Research session closed","AbortError"));
      active?.complete.reject(controller.signal.reason);
    },
  };
}
