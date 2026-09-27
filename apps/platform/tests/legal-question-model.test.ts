import assert from "node:assert/strict";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {createQuestionInterpreter} from "../lib/legal-chat/question-model";
import {interpretLegalQuestion} from "../lib/legal-chat/question-context";

test("Fast plans research with interpretation while Deep retains its existing interpretation contract",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const interpretation={topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]};
  const queries=[{text:"record access",topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]}];
  const input={question:"Can I request my record?",locale:"en" as const,priorTurns:[],now:new Date("2026-09-27T00:00:00Z")};
  const requests:{model:string;reasoning?:unknown;schema:string}[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    requests.push({model:body.model,reasoning:body.reasoning,schema:body.text.format.name});
    assert.deepEqual(JSON.parse(body.input),{question:input.question,locale:"en",priorTurns:[],userContext:null,
      privateDocuments:[],legalContextDate:null,now:input.now.toISOString()});
    const output=body.text.format.name==="legal_question_research"?{interpretation,research:{queries}}:interpretation;
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  for(const mode of ["fast","deep"] as const) {
    const result=await interpretLegalQuestion(input,createQuestionInterpreter({mode,requestId:mode}));
    assert.equal(result.kind,"ready");
    if(result.kind!=="ready")throw Error("Expected ready");
    assert.deepEqual(result.initialQueries,mode==="fast"?queries:undefined);
  }
  assert.deepEqual(requests,[
    {model:"gpt-6-luna",reasoning:{effort:"medium",mode:"standard"},schema:"legal_question_research"},
    {model:"gpt-5.6-terra",reasoning:undefined,schema:"legal_question_context"},
  ]);
});
