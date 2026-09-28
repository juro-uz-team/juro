import {AsyncLocalStorage} from "node:async_hooks";

export const INDEXED_RETRIEVAL_TIMEOUT_MS=10_000;

type RetrievalScope = {controller:AbortController;expiresAt:number};
const scopes=new AsyncLocalStorage<RetrievalScope>();
const timeout=()=>new DOMException("Indexed retrieval deadline exceeded", "TimeoutError");

/** The same budget follows native service calls and database queueing. */
export function indexedRetrievalSignal():AbortSignal|undefined {
  const scope=scopes.getStore();
  if(scope&&performance.now()>=scope.expiresAt&&!scope.controller.signal.aborted) scope.controller.abort(timeout());
  scope?.controller.signal.throwIfAborted();
  return scope?.controller.signal;
}

/** Remaining request budget for a native child service, including its queue. */
export function indexedRetrievalRemainingMs():number {
  indexedRetrievalSignal();
  const scope=scopes.getStore();
  return scope?Math.max(0,Math.min(INDEXED_RETRIEVAL_TIMEOUT_MS,scope.expiresAt-performance.now())):INDEXED_RETRIEVAL_TIMEOUT_MS;
}

export function awaitIndexedRetrieval<T>(operation:Promise<T>,signal=indexedRetrievalSignal()):Promise<T> {
  if(!signal)return operation;
  return new Promise<T>((resolve,reject)=>{
    const abort=()=>reject(signal.reason);
    signal.addEventListener("abort",abort,{once:true});
    operation.then(value=>{
      signal.removeEventListener("abort",abort);
      if(signal.aborted)reject(signal.reason);else resolve(value);
    },error=>{signal.removeEventListener("abort",abort);reject(error);});
    if(signal.aborted)abort();
  });
}

async function runWithDeadline<T>(milliseconds:number,parent:AbortSignal|undefined,operation:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  parent?.throwIfAborted();
  if(milliseconds<=0)throw timeout();
  const controller=new AbortController();
  const abort=()=>controller.abort(parent!.reason);
  parent?.addEventListener("abort",abort,{once:true});
  const timer=setTimeout(()=>controller.abort(timeout()),milliseconds);
  try {
    return await scopes.run({controller,expiresAt:performance.now()+milliseconds},async()=>{
      const result=await awaitIndexedRetrieval(operation(controller.signal),controller.signal);
      indexedRetrievalSignal();
      return result;
    });
  }finally{
    controller.abort(new DOMException("Indexed retrieval finished", "AbortError"));
    clearTimeout(timer);
    parent?.removeEventListener("abort",abort);
  }
}

/** expiresAt is a monotonic deadline from request interpretation, when available. */
export function runIndexedRetrieval<T>(parent:AbortSignal|undefined,operation:(signal:AbortSignal)=>Promise<T>,
  expiresAt?:number):Promise<T> {
  const enclosing=scopes.getStore();
  const signal=enclosing?AbortSignal.any([enclosing.controller.signal,...(parent?[parent]:[])]):parent;
  const remaining=Math.max(0,Math.min(INDEXED_RETRIEVAL_TIMEOUT_MS,
    (enclosing?.expiresAt??Infinity)-performance.now(),(expiresAt??Infinity)-performance.now()));
  return runWithDeadline(remaining,signal,operation);
}

/** Token-fenced lease release must remain possible after its owner is cancelled.
 * Cleanup gets its own short budget and cannot continue retrieval work. */
export function finishIndexedRetrievalCleanup<T>(operation:()=>Promise<T>):Promise<T> {
  return scopes.getStore()?runWithDeadline(2000,undefined,operation):operation();
}
