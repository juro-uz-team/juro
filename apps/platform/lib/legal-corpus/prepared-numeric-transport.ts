import {request as requestHttp,type IncomingMessage} from "node:http";
import type {PreparedNumericSearchRequest} from "./prepared-search-service";
import type {PreparedCandidateConfiguration} from "./prepared-candidate-configuration";

type WorkerQueue={active:number;waiting:Array<()=>void>};
const workerQueues=new Map<string,WorkerQueue>();
/** Across request-owned transports, bound sockets before the worker's own
 * bounded queue. Waiting consumes the caller's existing deadline and is
 * cancellable; no rejected read is retried with a new budget. */
function acquireWorker(key:string,signal:AbortSignal,limit=8):Promise<()=>void>{
  signal.throwIfAborted();
  let queue=workerQueues.get(key);
  if(!queue){queue={active:0,waiting:[]};workerQueues.set(key,queue);}
  const owner=queue;
  if(owner.waiting.length>=128)return Promise.reject(Error("PREPARED_NUMERIC_UNAVAILABLE"));
  return new Promise((resolve,reject)=>{
    const grant=()=>{
      signal.removeEventListener("abort",abort);owner.active++;
      let released=false;
      resolve(()=>{
        if(released)return;released=true;owner.active--;
        const next=owner.waiting.shift();if(next)next();
        if(!owner.active&&!owner.waiting.length)workerQueues.delete(key);
      });
    };
    const abort=()=>{
      const index=owner.waiting.indexOf(grant);if(index>=0)owner.waiting.splice(index,1);
      reject(signal.reason);
    };
    if(owner.active<limit)grant();
    else {owner.waiting.push(grant);signal.addEventListener("abort",abort,{once:true});}
  });
}

/** The worker is private loopback infrastructure, never a publisher URL. Its
 * process owns authenticated readers; admission must precede this transport. */
export function createPreparedNumericTransport(input:{url:string;token:string;workerSha256:string}){
  const base=new URL(input.url);
  if(base.protocol!=="http:"||base.hostname!=="127.0.0.1"||!base.port||base.pathname!=="/"
    ||base.search||base.hash||base.username||base.password||!/^[!-~]{32,256}$/u.test(input.token)
    ||!/^[a-f0-9]{64}$/u.test(input.workerSha256)){
    throw Error("PREPARED_NUMERIC_TRANSPORT_INVALID");
  }
  async function post(path:string,value:unknown,callerSignal?:AbortSignal){
    const signal=callerSignal??new AbortController().signal;
    const key=JSON.stringify([base.href,input.workerSha256]);
    // Search consumes CPU and must not occupy every admission slot while
    // complete-source reads wait. Acquire this lane before a shared socket,
    // preserving the caller's deadline and cancellation in both queues.
    const releaseSearch=path==="/search"?await acquireWorker(key+":search",signal,2):undefined;
    try{
      const release=await acquireWorker(key,signal);
      try{return await send(path,value,signal);}finally{release();}
    }finally{releaseSearch?.();}
  }
  async function send(path:string,value:unknown,callerSignal?:AbortSignal){
    const signal=callerSignal??new AbortController().signal;
    signal.throwIfAborted();
    const body=JSON.stringify(value);
    if(Buffer.byteLength(body)>128*1024)throw Error("PREPARED_NUMERIC_REQUEST_LIMIT");
    // Fetch's implicit header timeout can expire while this private worker is
    // queued. Use the caller's lifetime, without a second retrieval deadline.
    const response=await new Promise<IncomingMessage>((resolve,reject)=>{
      const request=requestHttp(new URL(path,base),{method:"POST",agent:false,timeout:0,signal,
        headers:{"Content-Type":"application/json","Content-Length":Buffer.byteLength(body),
          "Cache-Control":"no-store",Authorization:`Bearer ${input.token}`}},resolve);
      request.once("error",reject);request.end(body);
    });
    // The bounded socket acceptor can reject overload before a service owner
    // attaches its identity. This is unavailable capacity, never usable data.
    if(response.statusCode===503&&!response.headers["x-juro-worker-sha256"]){
      response.destroy();throw Error("PREPARED_NUMERIC_UNAVAILABLE");
    }
    if(response.headers["x-juro-worker-sha256"]!==input.workerSha256){
      response.destroy();throw Error("PREPARED_NUMERIC_WORKER_MISMATCH");
    }
    if(path==="/read-exact"&&response.statusCode===413){
      response.destroy();throw Error("PREPARED_CATALOG_PAGE_REQUIRED");
    }
    if(!response.statusCode||response.statusCode<200||response.statusCode>=300){
      response.destroy();throw Error("PREPARED_NUMERIC_UNAVAILABLE");
    }
    const maximum=path==="/search"?128*1024:64*1024*1024;
    const chunks:Uint8Array[]=[];let bytes=0;
    try{
      for await(const part of response){
        signal.throwIfAborted();bytes+=part.byteLength;
        if(bytes>maximum)throw Error("PREPARED_NUMERIC_RESPONSE_LIMIT");
        chunks.push(part);
      }
      signal.throwIfAborted();
      return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,bytes))) as unknown;
    }finally{response.destroy();}
  }
  return {
    execute:(request:PreparedNumericSearchRequest,signal?:AbortSignal)=>post("/search",request,signal),
    readExact:(request:{artifacts:PreparedCandidateConfiguration["artifacts"];references:Array<[number,number]>},
      signal?:AbortSignal)=>post("/read-exact",request,signal),
    readSources:(request:{artifacts:PreparedCandidateConfiguration["artifacts"];works:string[]},
      signal?:AbortSignal)=>post("/read-sources",request,signal),
    readAsset:(request:{artifacts:PreparedCandidateConfiguration["artifacts"];work:string},
      signal:AbortSignal)=>post("/read-asset",request,signal),
    locateSources:(request:{artifacts:PreparedCandidateConfiguration["artifacts"];urls:string[];sourceLocationsSha256:string},
      signal?:AbortSignal)=>post("/locate-sources",request,signal),
  };
}
