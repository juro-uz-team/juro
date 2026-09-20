import { LEGAL_CHAT_HEARTBEAT_MS, LEGAL_CHAT_EXECUTION_TIMEOUT_MS } from "./execution-limits";

/** The storage adapter's commit must atomically fence ownership, persist the
 * terminal result and settle usage. A late worker must never save after losing
 * its reservation, even when a provider ignores cancellation. */
export async function runReservedLegalChat<T, Saved>(input:{
  signal?:AbortSignal;
  renew:()=>Promise<boolean>;
  work:(signal:AbortSignal)=>Promise<T>;
  commit:(result:T)=>Promise<Saved>;
  release:(reason:"cancelled"|"lease_lost"|"failed")=>Promise<void>;
  heartbeatMs?:number;
  timeoutMs?:number;
}):Promise<Saved> {
  const heartbeatMs=input.heartbeatMs??LEGAL_CHAT_HEARTBEAT_MS;
  if(!Number.isFinite(heartbeatMs)||heartbeatMs<=0) throw new TypeError("Invalid heartbeat interval");
  const timeoutMs=input.timeoutMs??LEGAL_CHAT_EXECUTION_TIMEOUT_MS;
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0) throw new TypeError("Invalid execution timeout");
  const controller=new AbortController();
  const deadline=setTimeout(()=>controller.abort(new Error("LEGAL_CHAT_EXECUTION_TIMEOUT")),timeoutMs);
  let leaseLost=false;
  let renewing:Promise<void>|undefined;
  let timer:ReturnType<typeof setInterval>|undefined;
  const cancel=()=>controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort",cancel,{once:true});
  if(input.signal?.aborted) cancel();
  const renew=async()=>{
    try {
      if(!await input.renew()) throw new Error("LEGAL_CHAT_LEASE_LOST");
    } catch(error) {
      leaseLost=true;
      controller.abort(error);
      throw error;
    }
  };
  let rejectAbort: (()=>void)|undefined;
  try {
    controller.signal.throwIfAborted();
    await renew();
    controller.signal.throwIfAborted();
    timer=setInterval(()=>{
      if(!renewing) renewing=renew().catch(()=>undefined).finally(()=>{renewing=undefined;});
    },heartbeatMs);
    const aborted=new Promise<never>((_,reject)=>{
      rejectAbort=()=>reject(controller.signal.reason??new Error("AI_CANCELLED"));
      controller.signal.addEventListener("abort",rejectAbort,{once:true});
      if(controller.signal.aborted) rejectAbort();
    });
    const result=await Promise.race([input.work(controller.signal),aborted]);
    clearInterval(timer);timer=undefined;
    await renewing;
    controller.signal.throwIfAborted();
    await renew();
    controller.signal.throwIfAborted();
    clearTimeout(deadline);
    // Once atomic commit begins, report its result truthfully even if the
    // client disconnects. Never report cancellation after a successful save.
    return await input.commit(result);
  } catch(error) {
    controller.abort(error);
    if(timer) clearInterval(timer);
    await renewing;
    await input.release(leaseLost?"lease_lost":input.signal?.aborted?"cancelled":"failed");
    throw error;
  } finally {
    clearTimeout(deadline);
    if(timer) clearInterval(timer);
    if(rejectAbort) controller.signal.removeEventListener("abort",rejectAbort);
    input.signal?.removeEventListener("abort",cancel);
  }
}
