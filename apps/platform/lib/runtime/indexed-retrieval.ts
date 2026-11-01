import {AsyncLocalStorage} from "node:async_hooks";

type RetrievalScope = {controller:AbortController;expiresAt:number};
// Source-loaded corpus services and bundled routes share cancellation, while
// each request retains its own controller and deadline in AsyncLocalStorage.
const runtime=globalThis as typeof globalThis & {juroIndexedRetrievalV1?:AsyncLocalStorage<RetrievalScope>};
const scopes=runtime.juroIndexedRetrievalV1??=new AsyncLocalStorage<RetrievalScope>();
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
  return scope?Math.max(0,scope.expiresAt-performance.now()):Infinity;
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

async function runWithDeadline<T>(expiresAt:number,parent:AbortSignal|undefined,operation:(signal:AbortSignal)=>Promise<T>):Promise<T> {
  parent?.throwIfAborted();
  const milliseconds=expiresAt-performance.now();
  if(milliseconds<=0)throw timeout();
  const controller=new AbortController();
  const abort=()=>controller.abort(parent!.reason);
  parent?.addEventListener("abort",abort,{once:true});
  // Node truncates fractional timer delays. Round up so an early timeout cannot
  // leave a fraction of the original lifetime available to a subsequent read.
  const timer=Number.isFinite(milliseconds)?setTimeout(()=>controller.abort(timeout()),Math.ceil(milliseconds)):undefined;
  try {
    return await scopes.run({controller,expiresAt},async()=>{
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
  const deadline=Math.min(enclosing?.expiresAt??Infinity,expiresAt??Infinity);
  return runWithDeadline(deadline,signal,operation);
}

/** Token-fenced lease release must remain possible after its owner is cancelled.
 * Cleanup gets its own short budget and cannot continue retrieval work. */
export function finishIndexedRetrievalCleanup<T>(operation:()=>Promise<T>):Promise<T> {
  return scopes.getStore()?runWithDeadline(performance.now()+2000,undefined,operation):operation();
}


/** One explicit lifetime for speculative discovery across provider callbacks.
 * Closing a callback does not close the scope; its owner must close it after
 * final indexed reading, discarded interpretation, or request cancellation. */
export function openIndexedRetrievalScope(parent:AbortSignal|undefined,expiresAt:number) {
  parent?.throwIfAborted();
  const enclosing=scopes.getStore();
  const deadline=Math.min(expiresAt,enclosing?.expiresAt??Infinity);
  if(deadline<=performance.now())throw timeout();
  const controller=new AbortController();
  const signal=enclosing?AbortSignal.any([enclosing.controller.signal,...(parent?[parent]:[])]):parent;
  const abort=()=>controller.abort(signal!.reason);
  signal?.addEventListener("abort",abort,{once:true});
  if(signal?.aborted)abort();
  const timer=Number.isFinite(deadline)?setTimeout(()=>controller.abort(timeout()),Math.max(0,Math.ceil(deadline-performance.now()))):undefined;
  const scope={controller,expiresAt:deadline};
  return {
    async run<T>(operation:()=>Promise<T>):Promise<T> {
      return scopes.run(scope,async()=>{
        indexedRetrievalSignal();
        const value=await awaitIndexedRetrieval(operation(),controller.signal);
        indexedRetrievalSignal();return value;
      });
    },
    close(){clearTimeout(timer);signal?.removeEventListener("abort",abort);
      controller.abort(new DOMException("Indexed retrieval finished","AbortError"));},
  };
}
