import {indexedRetrievalSignal,indexedRetrievalRemainingMs} from "../runtime/indexed-retrieval";

export type VectorCandidateRequest = {
  collection:string; generation:string; sourceRevision:string; values:readonly number[];
  instant?:number;
};
export type VectorCandidateReader = (request:VectorCandidateRequest)=>Promise<string[]>;

/** Optional local accelerator. PostgreSQL still fences the source generation,
 * expands original identities, applies filters and computes final scores. */
export function createVectorCandidateReader(endpoint:string):VectorCandidateReader {
  const url=new URL(endpoint);
  if(url.protocol!=="http:" || url.hostname!=="127.0.0.1" || url.pathname!=="/query"
    || url.username || url.password || url.search || url.hash) throw new Error("Invalid local vector candidate endpoint");
  return async request=>{
    const signal=AbortSignal.any([AbortSignal.timeout(10_000),...[indexedRetrievalSignal()].filter((s):s is AbortSignal=>!!s)]);
    signal.throwIfAborted();
    const response=await fetch(url,{method:"POST",redirect:"error",headers:{"content-type":"application/json"},signal,
      body:JSON.stringify({...request,expiresAt:Date.now()+indexedRetrievalRemainingMs()})});
    if(!response.ok)throw new Error("Vector candidate service unavailable");
    if(!response.body)throw new Error("Vector candidate response unavailable");
    const reader=response.body.getReader(),chunks:Uint8Array[]=[];
    let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>700_000)throw new Error("Vector candidate response too large");chunks.push(value);
    }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const result=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(chunks)));
    if(result.generation!==request.generation || String(result.sourceRevision)!==request.sourceRevision
      || result.collection!==request.collection || !Array.isArray(result.groups) || result.groups.length>10_000
      || result.groups.some((value:unknown)=>typeof value!=="string" || !/^[a-f0-9]{64}$/u.test(value))
      || new Set(result.groups).size!==result.groups.length) throw new Error("Vector candidate identity mismatch");
    signal.throwIfAborted();
    return result.groups;
  };
}
