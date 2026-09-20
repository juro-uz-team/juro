import type {CorpusSessionInput, CorpusSearchInput} from "./corpus-session";
import type {QuestionInterpretation} from "../legal-corpus/legal-candidate-index";
import type {ResearchPacket,ResearchRequest} from "./research";
import {privateResearchQueries} from "./research-query";

type RemoteSession={
  search(input:CorpusSearchInput):PromiseLike<ResearchPacket>;
  cancel():PromiseLike<void>;
  [Symbol.dispose]():void;
};
export type CorpusResearchService={
  openLegalResearch(input:CorpusSessionInput):PromiseLike<RemoteSession>;
};

/** The caller must close this capability when execution ends, including when
 * persistence fails. A signal never crosses RPC; cancellation closes the remote
 * session and late results are discarded locally as well. */
export function createRemoteCorpusResearch(input:{
  service:CorpusResearchService;
  requestId:string;
  environment:CorpusSessionInput["environment"];
  formulate:(request:ResearchRequest)=>Promise<QuestionInterpretation>;
}) {
  let opening:Promise<RemoteSession>|undefined;
  let session:RemoteSession|undefined;
  let closed=false;
  let owner:string|undefined;
  let signal:AbortSignal|undefined;
  let closing:Promise<void>|undefined;
  const abort=()=>{void close();};
  const close=()=>{
    if(closing)return closing;
    closed=true;
    signal?.removeEventListener("abort",abort);
    const active=session;
    session=undefined;
    closing=(async()=>{
      if(!active)return;
      try {await active.cancel();}
      catch { /* A disconnected capability is already unusable. */ }
      finally {active[Symbol.dispose]();}
    })();
    return closing;
  };
  return {
    async indexed(request:ResearchRequest):Promise<ResearchPacket> {
      request.question.signal?.throwIfAborted();
      if(closed)throw new Error("CORPUS_RESEARCH_SESSION_CLOSED");
      const identity=JSON.stringify([request.question.question,request.question.topics,
        request.question.temporalScope,request.question.priorTurns??[],request.question.caseFacts??[]]);
      if(owner!==undefined&&owner!==identity)throw new Error("CORPUS_RESEARCH_REQUEST_MISMATCH");
      owner=identity;
      if(!opening){
        signal=request.question.signal;
        signal?.addEventListener("abort",abort,{once:true});
        opening=Promise.resolve(input.service.openLegalResearch({requestId:input.requestId,
          environment:input.environment,temporalScope:request.question.temporalScope})).then(value=>{
          if(closed){value[Symbol.dispose]();throw new Error("CORPUS_RESEARCH_SESSION_CLOSED");}
          session=value;
          return value;
        });
        // Opening is read-only and has not spent a search round. A transient
        // binding failure may recover on the next bounded coordinator round.
        const pending=opening;
        void pending.catch(()=>{if(opening===pending&&!session)opening=undefined;});
      }
      const active=await opening;
      const plan=await privateResearchQueries(await input.formulate(request),[]);
      signal?.throwIfAborted();
      if(closed)throw new Error("CORPUS_RESEARCH_SESSION_CLOSED");
      const packet=await active.search({round:request.round,plan});
      signal?.throwIfAborted();
      if(closed)throw new Error("CORPUS_RESEARCH_SESSION_CLOSED");
      return packet;
    },
    close,
  };
}
