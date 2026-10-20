import type {PreparedNumericSearchRequest} from "./prepared-search-service";
import type {PreparedCandidateConfiguration} from "./prepared-candidate-configuration";

/** The worker is private loopback infrastructure, never a publisher URL. Its
 * process owns authenticated readers; admission must precede this transport. */
export function createPreparedNumericTransport(input:{url:string;token:string}){
  const base=new URL(input.url);
  if(base.protocol!=="http:"||base.hostname!=="127.0.0.1"||!base.port||base.pathname!=="/"
    ||base.search||base.hash||base.username||base.password||!/^[!-~]{32,256}$/u.test(input.token)){
    throw Error("PREPARED_NUMERIC_TRANSPORT_INVALID");
  }
  async function post(path:string,value:unknown,callerSignal?:AbortSignal){
    const signal=AbortSignal.any([AbortSignal.timeout(10_000),...(callerSignal?[callerSignal]:[])]);
    signal.throwIfAborted();
    const body=JSON.stringify(value);
    if(Buffer.byteLength(body)>128*1024)throw Error("PREPARED_NUMERIC_REQUEST_LIMIT");
    const response=await fetch(new URL(path,base),{method:"POST",redirect:"error",cache:"no-store",signal,
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${input.token}`},body});
    if(!response.ok||!response.body){
      await response.body?.cancel();throw Error("PREPARED_NUMERIC_UNAVAILABLE");
    }
    const maximum=path==="/search"?128*1024:64*1024*1024;
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
    try{
      while(true){
        signal.throwIfAborted();const part=await reader.read();if(part.done)break;
        bytes+=part.value.byteLength;
        if(bytes>maximum)throw Error("PREPARED_NUMERIC_RESPONSE_LIMIT");
        chunks.push(part.value);
      }
      signal.throwIfAborted();
      return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks,bytes))) as unknown;
    }finally{await reader.cancel();reader.releaseLock();}
  }
  return {
    execute:(request:PreparedNumericSearchRequest,signal?:AbortSignal)=>post("/search",request,signal),
    readExact:(request:{artifacts:PreparedCandidateConfiguration["artifacts"];references:Array<[number,number]>},
      signal?:AbortSignal)=>post("/read-exact",request,signal),
  };
}
