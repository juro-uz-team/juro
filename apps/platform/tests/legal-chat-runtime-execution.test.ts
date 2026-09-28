import {structuredResponse} from "./helpers/structured-response";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {env} from "./helpers/runtime-env";
import {executeRuntimeLegalChat} from "../lib/legal-chat/runtime-execution";
import type {CorpusStageInput} from "../lib/legal-chat/corpus-session";
import {indexedRetrievalRemainingMs} from "../lib/runtime/indexed-retrieval";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";

test("runtime refuses to publish an answer whose source freshness cannot be established",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let monotonic=Math.floor(performance.now());
  context.mock.method(performance,"now",()=>monotonic);
  const calls:string[]=[];const staged:CorpusStageInput[]=[];let searched:unknown,remainingBudget=Infinity;
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));const schema=body.text.format.name;calls.push(schema);
    if(schema==="legal_question_research")monotonic+=6500;
    const query={text:"record access",topicIndices:[0]};
    assert.ok(!["legal_research_coverage","legal_research_answer","legal_issue_verification","legal_verification"].includes(schema),"Bounded evidence goes directly to writing and programmatic checks");
    if(schema==="legal_answer"||schema==="legal_issue_verification") {
      assert.equal(JSON.parse(body.input).context.evidence[0].passages[0].text,text);
    }
    const output=schema==="legal_question_research"?{
      interpretation:{topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]},research:{directQueries:[query],underlyingRuleQueries:[]}}
      :schema==="legal_answer"?{
        answer:{mainPoint:{text,sourceIds:["source"]},issues:[{finding:{title:"Access",explanation:text,sourceIds:["source"]},
          actions:[{title:"Request",instruction:text,sourceIds:["source"]}]}],risks:[],questions:[],unresolved:[]}}
      :{
        claims:Object.fromEntries(["mainPoint","finding:0","action:0"].map(id=>[id,{supported:true,reason:null,dependsOn:[]}])),
        coverage:[{issue:"Record access",actionRequired:true,findingIds:["finding:0"],actionIds:["action:0"],gaps:[]}],
        complete:true,gaps:[],questions:[]};
    return structuredResponse(body,{id:"response",model:body.model,output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  const stale={...evidence,source:{...evidence.source,verifiedAt:new Date(Date.now()-600_000).toISOString()}};
  const result=await executeRuntimeLegalChat({requestId:"stale",environment:"staging",mode:"fast",answerMode:"short",
    context:{question:"May I request my record?",locale:"en",priorTurns:[]},
    service:{async openLegalResearch(){return {async stage(fragment){staged.push(fragment);},async search(input){
      searched=input.plan.formulations;
      remainingBudget=indexedRetrievalRemainingMs();
      assert.deepEqual(input.plan.formulations.map(item=>item.text),["record access"],"Initial generated queries survive runtime composition unchanged");
      return {evidence:[stale],needs:[]};},async cancel(){},[Symbol.dispose](){}};}},
    renew:async()=>true,commit:async(terminal,sources)=>{assert.deepEqual(sources,[]);return terminal;},release:async()=>{},
  });
  assert.equal(staged.length,1,"Initial interpretation starts indexed work before final research");
  assert.ok(remainingBudget<=3500,`Initial interpretation consumes the shared retrieval budget: ${remainingBudget}`);
  assert.deepEqual(searched,staged.map(fragment=>fragment.formulation),"Runtime reuses exactly the initial streamed formulations");
  assert.deepEqual(calls,["legal_question_research","legal_answer"]);
  assert.equal(result.kind,"unavailable");assert.ok("result" in result);
  assert.equal(result.result.failureReason,"official_research_unavailable");
  assert.deepEqual(result.result.confirmedFindings,[]);
});

const text="Synthetic rule: applicants may request a record.";
const evidence:LegalEvidence={source:{id:"source",actTitle:"Synthetic source",actIdentifier:null,
  officialUrl:"https://lex.uz/docs/999999",revisionDate:null,lastCheckedAt:"2026-09-20",locale:"en",
  publishedAt:null,sourceType:"lex",status:"current",verificationState:"verified",verifiedAt:"2026-09-20",
  contentSha256:"a".repeat(64),sourceClass:"OFFICIAL_LEGISLATION"},text,
  textSha256:createHash("sha256").update(text).digest("hex"),endpoint:{kind:"current"},origin:"indexed"};

test("runtime composition uses the reserved flow and disposes corpus state even when saving fails",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const models:string[]=[];
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));models.push(body.model);const schema=body.text.format.name;
    const query={text:"record access",topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]};
    const output=schema==="legal_question_context"
      ?{topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]}
      :schema==="legal_research_coverage"?{needs:[],resolved:null,queries:[query]}
      :null;
    if(output===null)return Response.json({error:{code:"unavailable",message:"Synthetic writer failure"}},{status:503});
    return structuredResponse(body,{id:"response",model:body.model,output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
  });
  let disposed=0,opened=0,reads=0,renewed=0,released=0;
  await assert.rejects(executeRuntimeLegalChat({
    requestId:"one",environment:"staging",mode:"deep",answerMode:"detailed",
    context:{question:"May I request my record?",locale:"en",priorTurns:[]},
    service:{async openLegalResearch(input){
      opened++;assert.equal(input.environment,"staging");
      return {async search(input){reads++;assert.equal(input.round,0);return {evidence:[evidence],needs:[]};},
        async cancel(){},[Symbol.dispose](){disposed++;}};
    }},
    renew:async()=>{renewed++;return true;},
    commit:async terminal=>{assert.equal(terminal.kind,"unavailable");throw new Error("synthetic save failure");},
    release:async reason=>{assert.equal(reason,"failed");released++;},
  }),/synthetic save failure/);
  assert.deepEqual(models,["gpt-5.6-terra","gpt-5.6-terra"]);
  assert.equal(opened,1);assert.equal(reads,1);assert.equal(disposed,1);
  assert.equal(renewed,2);assert.equal(released,1);
});
