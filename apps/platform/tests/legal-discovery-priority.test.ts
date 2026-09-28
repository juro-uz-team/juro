import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {createDiscoveryPrioritizer} from "../lib/legal-chat/discovery-priority";
import {parsePinnedCandidateRelease} from "../lib/legal-corpus/legal-candidate-index";
import {awaitIndexedRetrieval,runIndexedRetrieval} from "../lib/runtime/indexed-retrieval";

const release=parsePinnedCandidateRelease({id:"release:current",environment:"development",capability:"current",
  instances:[{id:"instance:one",shardId:"shard:one"}],configuration:{identity:"config:one",embeddingModel:"openai/text-embedding-3-large",
    dimensions:1536,keywordTokenizer:"porter",metadataSchema:["language","document_type","valid_from","valid_to"],
    gatewayIdentity:"gateway:one",providerProjectIdentity:"project:one",gatewayPayloadLogging:false,gatewayCaching:false,similarityCaching:false}});
const input={renditionIds:["rendition:a","rendition:b","rendition:c"],formulations:["Synthetic record procedure"],
  endpoint:{kind:"current" as const},release,currentAt:"2026-06-01T00:00:00.000Z"};

test("discovery modes differ only by provider model",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const requests:Record<string,unknown>[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    requests.push(JSON.parse(String(init?.body)));
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({priority:["c1"]})}]}]});
  });
  for(const mode of ["fast","deep"] as const){
    const prioritize=createDiscoveryPrioritizer({requestId:"mode-parity",mode,readMetadata:async id=>({
      actTitle:"Synthetic rules",articleTitle:id,languageTag:"en",
    })});
    assert.deepEqual(await prioritize(input),["rendition:b"]);
  }
  assert.deepEqual(requests.map(body=>body.model),["gpt-6-luna","gpt-5.6-terra"]);
  assert.deepEqual({...requests[0],model:requests[1]!.model},requests[1]);
});

test("discovery maps bounded heading hints to authenticated identities without transporting case context",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.input);
    assert.deepEqual(Object.keys(payload).sort(),["candidates","researchFormulations"]);
    assert.deepEqual(payload.researchFormulations,input.formulations);
    assert.deepEqual(payload.candidates.map((c:{id:string})=>c.id),["c0","c1","c2"]);
    assert.equal(body.reasoning.effort,"none");
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({priority:["c2","c2"]})}]}]});
  });
  const prioritize=createDiscoveryPrioritizer({requestId:"discovery-test",readMetadata:async(id,endpoint,scope)=>{
    assert.equal(endpoint,input.endpoint);assert.equal(scope.release,input.release);
    return {actTitle:"Synthetic rules",articleTitle:id,languageTag:"en"};
  }});
  assert.deepEqual(await prioritize(input),["rendition:c"]);
});

test("repeated act titles retain every candidate heading and language through compact transport",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const title="Synthetic rules governing administrative records, preservation, inspection and correction, including retention schedules, release restrictions and correction requests";
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.input);
    assert.deepEqual(payload.actTitles,[title]);
    assert.deepEqual(payload.candidates.map((candidate:{id:string;actTitleIndex:number;articleTitle:string|null;language:string})=>({
      id:candidate.id,actTitle:payload.actTitles[candidate.actTitleIndex],articleTitle:candidate.articleTitle,language:candidate.language,
    })),[
      {id:"c0",actTitle:title,articleTitle:"Record inspection",language:"en"},
      {id:"c1",actTitle:title,articleTitle:null,language:"ru"},
      {id:"c2",actTitle:title,articleTitle:"Record correction",language:"en"},
    ]);
    assert.deepEqual(payload.researchFormulations,input.formulations);
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({priority:["c2","c0"]})}]}]});
  });
  const prioritize=createDiscoveryPrioritizer({requestId:"discovery-titles",readMetadata:async id=>({
    actTitle:title,articleTitle:id==="rendition:a"?"Record inspection":id==="rendition:c"?"Record correction":null,
    languageTag:id==="rendition:b"?"ru":"en",
  })});
  assert.deepEqual(await prioritize(input),["rendition:c","rendition:a"]);
});

test("unavailable metadata and invalid model identities leave original discovery available",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let calls=0;
  context.mock.method(globalThis,"fetch",async()=>{
    calls++;
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({priority:["invented"]})}]}]});
  });
  const prioritize=createDiscoveryPrioritizer({requestId:"discovery-failure",readMetadata:async id=>{
    if(id==="rendition:a")throw new Error("unavailable");
    return {actTitle:"Synthetic rules",articleTitle:id,languageTag:"en"};
  }});
  assert.deepEqual(await prioritize(input),[]);
  assert.equal(calls,1,"Optional ordering must not retry invalid model output");
  const unavailable=createDiscoveryPrioritizer({requestId:"discovery-empty",readMetadata:async()=>null});
  assert.deepEqual(await unavailable(input),[]);
  assert.equal(calls,1,"Unavailable hints must not start a model request");
});

test("cancellation during heading reads stops discovery without a model request",async context=>{
  const controller=new AbortController(),reason=new Error("cancelled by user");
  let calls=0;
  context.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("Unexpected model request");});
  const prioritize=createDiscoveryPrioritizer({requestId:"discovery-cancelled",readMetadata:async()=>{
    controller.abort(reason);
    return {actTitle:"Synthetic rules",articleTitle:"Synthetic procedure",languageTag:"en"};
  }});
  await assert.rejects(prioritize({...input,signal:controller.signal}),error=>error===reason);
  assert.equal(calls,0);
});

test("the shared retrieval deadline expires during metadata reading and starts no model work",async context=>{
  let calls=0;
  context.mock.method(globalThis,"fetch",async()=>{calls++;throw new Error("Unexpected model request");});
  const prioritize=createDiscoveryPrioritizer({requestId:"discovery-deadline",readMetadata:async()=>
    awaitIndexedRetrieval(new Promise(()=>{}))});
  await assert.rejects(runIndexedRetrieval(undefined,signal=>prioritize({...input,signal})),
    {name:"TimeoutError",message:"Indexed retrieval deadline exceeded"});
  assert.equal(calls,0);
});

test("large discovery pools bound metadata work and omit whole oversized headings",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const read:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body)),payload=JSON.parse(body.input);
    assert.ok(body.input.length<=64_000);
    assert.equal(payload.candidates.length,119);
    assert.equal(payload.candidates[0].articleTitle,"Heading 1");
    assert.equal(payload.candidates.at(-1).articleTitle,"Heading 119");
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({priority:["c0"]})}]}]});
  });
  const prioritize=createDiscoveryPrioritizer({requestId:"discovery-bounds",readMetadata:async id=>{
    read.push(id);
    return {actTitle:"Synthetic rules",articleTitle:id==="0"?"X".repeat(65_000):`Heading ${id}`,languageTag:"en"};
  }});
  assert.deepEqual(await prioritize({...input,renditionIds:Array.from({length:125},(_,i)=>String(i))}),["1"]);
  assert.equal(read.length,120);
});
