import assert from "node:assert/strict";
import {createServer} from "node:http";
import test from "node:test";
import {createPreparedNumericTransport} from "../lib/legal-corpus/prepared-numeric-transport";

test("numeric transport authenticates loopback requests and rejects error or oversized responses",async()=>{
  let mode:"normal"|"error"|"oversized"|"other-worker"="normal";
  const server=createServer(async(request,response)=>{
    assert.equal(request.headers.authorization,`Bearer ${"t".repeat(32)}`);
    assert.equal(request.url,"/read-exact");
    const chunks=[];for await(const chunk of request)chunks.push(chunk);
    const value=JSON.parse(Buffer.concat(chunks).toString());
    response.setHeader("X-Juro-Worker-Sha256",(mode==="other-worker"?"b":"a").repeat(64));
    if(mode==="error"){response.writeHead(503);response.end("private details");return;}
    if(mode==="oversized"){
      response.writeHead(200);response.end(Buffer.alloc(64*1024*1024+1,32));return;
    }
    response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify(value));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const transport=createPreparedNumericTransport({url:`http://127.0.0.1:${address.port}`,token:"t".repeat(32),workerSha256:"a".repeat(64)});
  const request={artifacts:{packageSha256:"a".repeat(64),vectorCompletionSha256:"b".repeat(64),
    vectorIdentitySha256:"c".repeat(64),membershipSha256:"d".repeat(64),workIndexSha256:"e".repeat(64),
    navigationSha256:"f".repeat(64),sparseSha256:"1".repeat(64)},references:[[1,2] as [number,number]]};
  try{
    assert.deepEqual(await transport.readExact(request),request);
    mode="other-worker";await assert.rejects(transport.readExact(request),/PREPARED_NUMERIC_WORKER_MISMATCH/u);
    mode="error";await assert.rejects(transport.readExact(request),/PREPARED_NUMERIC_UNAVAILABLE/u);
    mode="oversized";await assert.rejects(transport.readExact(request),/PREPARED_NUMERIC_RESPONSE_LIMIT/u);
    await assert.rejects(transport.readExact(request,AbortSignal.abort()));
  }finally{
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
});

test("numeric transport cannot target remote hosts, credential-bearing URLs or weak tokens",()=>{
  for(const url of ["https://127.0.0.1:8000","http://localhost:8000","http://example.com:8000",
    "http://127.0.0.1:8000/search","http://user:pass@127.0.0.1:8000"]){
    assert.throws(()=>createPreparedNumericTransport({url,token:"t".repeat(32),workerSha256:"a".repeat(64)}));
  }
  assert.throws(()=>createPreparedNumericTransport({url:"http://127.0.0.1:8000",token:"short",workerSha256:"a".repeat(64)}));
});

test("numeric transport waits for queued headers until its caller cancels",async()=>{
  let started!:()=>void;const received=new Promise<void>(resolve=>{started=resolve;});
  let disconnected!:()=>void;const closed=new Promise<void>(resolve=>{disconnected=resolve;});
  const server=createServer((request)=>{request.resume();request.socket.once("close",disconnected);started();});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const transport=createPreparedNumericTransport({url:`http://127.0.0.1:${address.port}`,token:"t".repeat(32),workerSha256:"a".repeat(64)});
  const controller=new AbortController();
  try{
    const pending=transport.readExact({artifacts:{} as never,references:[]},controller.signal);
    const rejected=assert.rejects(pending,{name:"AbortError"});
    await received;controller.abort();await rejected;await closed;
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
