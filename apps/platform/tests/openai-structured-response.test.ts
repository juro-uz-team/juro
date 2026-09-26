import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {callOpenAiStructured} from "../lib/document-builder/ai/openai";

const message=(phase:string|null,text:string)=>({type:"message",role:"assistant",phase,
  content:[{type:"output_text",text}]});
const options={model:"test-model",schemaName:"phase_selection",instructions:"Return the structured result.",input:{},
  schema:{type:"object",properties:{value:{type:"string"}},required:["value"],additionalProperties:false},
  parse:(value:unknown)=>{
    assert.ok(value && typeof value==="object" && "value" in value && typeof value.value==="string");
    return {value:value.value};
  },maxAttempts:1 as const};

for(const streaming of [false,true]) {
  test(`structured ${streaming?"stream":"JSON"} responses use the final answer after commentary`,async context=>{
    const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-test-key";
    context.after(()=>{env.OPENAI_API_KEY=oldKey;});
    let commentary="I will check the supplied evidence.";
    context.mock.method(globalThis,"fetch",async()=>{
      const payload={status:"completed",output:[message("commentary",commentary),
        message("final_answer",JSON.stringify({value:"final"}))],usage:{input_tokens:10,output_tokens:20}};
      return streaming?new Response(`data: ${JSON.stringify({type:"response.completed",response:payload})}\n\n`,
        {headers:{"content-type":"text/event-stream"}}):Response.json(payload);
    });
    const invoke=()=>callOpenAiStructured({...options,...(streaming?{onProgress:()=>{}}:{})});
    assert.deepEqual((await invoke()).data,{value:"final"});
    commentary=JSON.stringify({value:"intermediate"});
    assert.deepEqual((await invoke()).data,{value:"final"},"Even schema-valid commentary cannot replace the final answer");
  });
}

test("structured response selection preserves legacy output and fails closed without a usable final answer",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="offline-test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let output=[message(null,JSON.stringify({value:"legacy"}))];
  context.mock.method(globalThis,"fetch",async()=>Response.json({status:"completed",output}));
  assert.deepEqual((await callOpenAiStructured(options)).data,{value:"legacy"});
  output=[message("commentary",JSON.stringify({value:"not final"}))];
  await assert.rejects(callOpenAiStructured(options),{code:"INVALID_AI_OUTPUT"});
  output=[message("commentary",JSON.stringify({value:"not final"})),message("final_answer","broken JSON")];
  await assert.rejects(callOpenAiStructured(options),{code:"INVALID_AI_OUTPUT"});
  output=[message("commentary",JSON.stringify({value:"not final"})),message("final_answer","")];
  await assert.rejects(callOpenAiStructured(options),{code:"INVALID_AI_OUTPUT"});
});
