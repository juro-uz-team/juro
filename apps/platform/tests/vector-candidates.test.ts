import assert from "node:assert/strict";
import {createServer} from "node:http";
import {once} from "node:events";
import test from "node:test";
import {createVectorCandidateReader} from "../lib/storage/vector-candidates";
import {runIndexedRetrieval} from "../lib/runtime/indexed-retrieval";

test("local vector candidates pin generation identity and abort with their parent request",async()=>{
  let mode="valid",received:any;
  const server=createServer(async(request,response)=>{
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    received=JSON.parse(Buffer.concat(chunks).toString());
    if(mode==="wait")return;
    if(mode==="oversized"){response.end(" ".repeat(700_001));return;}
    response.setHeader("content-type","application/json");
    response.end(JSON.stringify({collection:received.collection,generation:mode==="wrong"?"other":received.generation,
      sourceRevision:received.sourceRevision,groups:mode==="duplicate"?["a".repeat(64),"a".repeat(64)]:["a".repeat(64)]}));
  });
  server.listen(0,"127.0.0.1");await once(server,"listening");
  try{
    const address=server.address();assert.ok(address&&typeof address!=="string");
    const read=createVectorCandidateReader(`http://127.0.0.1:${address.port}/query`);
    const request={collection:"official",generation:crypto.randomUUID(),sourceRevision:"3",values:Array(1536).fill(1),instant:10};
    assert.deepEqual(await runIndexedRetrieval(undefined,()=>read(request)),["a".repeat(64)]);
    assert.ok(received.expiresAt>Date.now()-100 && received.expiresAt<=Date.now()+10000);
    for(mode of ["wrong","duplicate","oversized"])await assert.rejects(read(request));
    mode="wait";
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(Error("Parent cancelled")),30);
    try{await assert.rejects(runIndexedRetrieval(controller.signal,()=>read(request)),/Parent cancelled/);}finally{clearTimeout(timer);}
    for(const url of ["https://127.0.0.1/query","http://example.com/query","http://127.0.0.1/query?other=1"])
      assert.throws(()=>createVectorCandidateReader(url));
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
