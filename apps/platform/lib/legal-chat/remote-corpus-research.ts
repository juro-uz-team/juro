import type {CorpusSessionInput, CorpusSearchInput,CorpusStageInput} from "./corpus-session";
import type {ResearchFormulator} from "./research-formulation";
import {documentModelContext} from "./document-context";
import type {ResearchPacket,ResearchRequest} from "./research";
import {runIndexedRetrieval} from "../runtime/indexed-retrieval";

type RemoteSession={
  search(input:CorpusSearchInput):PromiseLike<ResearchPacket>;
  stage?(input:CorpusStageInput):PromiseLike<void>;
  discard?(round:number):PromiseLike<void>;
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
  formulate:ResearchFormulator;
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
      return runIndexedRetrieval(request.question.signal,async attemptSignal=>{
        let staged=false;
        const cancelAttempt=()=>{void close();};
        attemptSignal.addEventListener("abort",cancelAttempt,{once:true});
        try {
          request.question.signal?.throwIfAborted();
          if(closed)throw new Error("CORPUS_RESEARCH_SESSION_CLOSED");
          const identity=JSON.stringify([request.question.question,request.question.topics,
            request.question.temporalScope,request.question.priorTurns??[],request.question.caseFacts??[],request.question.userContext??null,
            documentModelContext(request.question.documents)]);
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
          const pendingSession=opening;
          const [active,plan]=await Promise.all([pendingSession,input.formulate(
            {...request,question:{...request.question,signal:attemptSignal}},async fragment=>{
              const capability=await pendingSession;
              attemptSignal.throwIfAborted();
              if(capability.stage){staged=true;await capability.stage({round:request.round,...fragment});}
            })]);
          attemptSignal.throwIfAborted();
          signal?.throwIfAborted();
          if(closed)throw new Error("CORPUS_RESEARCH_SESSION_CLOSED");
          const packet=await active.search({round:request.round,plan});
          signal?.throwIfAborted();
          if(closed)throw new Error("CORPUS_RESEARCH_SESSION_CLOSED");
          return packet;
        }catch(error){
          if(staged)await Promise.resolve(session?.discard?.(request.round)).catch(()=>undefined);
          throw error;
        }finally{attemptSignal.removeEventListener("abort",cancelAttempt);}
      });
    },
    close,
  };
}
