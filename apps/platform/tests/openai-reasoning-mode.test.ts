import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {callOpenAiStructured} from "../lib/document-builder/ai/openai";

test("provider reasoning mode is opt-in and preserves the selected model and effort",async context=>{
  const previousKey=env.OPENAI_API_KEY;
  env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=previousKey;});
  const payloads:Array<{model:string;reasoning:{effort:string;mode?:string}}>=[];
  context.mock.method(globalThis,"fetch",async(_url:string|URL|Request,init?:RequestInit)=>{
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({id:"response",model:"gpt-5.6-luna",output:[{content:[{type:"output_text",text:'{"ok":true}'}]}],
      usage:{input_tokens:10,output_tokens:5}});
  });
  for(const reasoningMode of [undefined,"pro"] as const){
    await callOpenAiStructured({model:"gpt-5.6-luna",reasoningEffort:"high",reasoningMode,
      instructions:"Return the supplied value.",input:{ok:true},maxAttempts:1,schemaName:"reasoning_mode",
      schema:{type:"object",properties:{ok:{type:"boolean"}},required:["ok"],additionalProperties:false},parse:value=>value});
  }
  assert.deepEqual(payloads.map(({model,reasoning})=>({model,reasoning})),[
    {model:"gpt-5.6-luna",reasoning:{effort:"high"}},
    {model:"gpt-5.6-luna",reasoning:{effort:"high",mode:"pro"}},
  ]);
});
