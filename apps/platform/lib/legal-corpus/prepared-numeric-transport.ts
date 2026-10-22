import {request as requestHttp,type IncomingMessage} from "node:http";
import type {PreparedNumericSearchRequest} from "./prepared-search-service";
import type {PreparedCandidateConfiguration} from "./prepared-candidate-configuration";

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
    if(!response.statusCode||response.statusCode<200||response.statusCode>=300){
      response.destroy();throw Error("PREPARED_NUMERIC_UNAVAILABLE");
    }
    if(response.headers["x-juro-worker-sha256"]!==input.workerSha256){
      response.destroy();throw Error("PREPARED_NUMERIC_WORKER_MISMATCH");
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
  };
}
