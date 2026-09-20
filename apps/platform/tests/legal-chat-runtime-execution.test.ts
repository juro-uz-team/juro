import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {env} from "cloudflare:workers";
import {executeRuntimeLegalChat} from "../lib/legal-chat/runtime-execution";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";

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
    const body=JSON.parse(String(init?.body));models.push(body.model);
    const query={text:"record access",topicIndices:[0],privateNameSpans:[],legalTitleSpans:[]};
    const output=models.length===1
      ?{topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]}
      :models.length===2?{queries:[query]}
      :models.length===3?{needs:[],resolved:[],queries:[query]}
      :null;
    if(output===null)return Response.json({error:{code:"unavailable",message:"Synthetic writer failure"}},{status:503});
    return Response.json({id:"response",model:body.model,output:[{content:[{type:"output_text",text:JSON.stringify(output)}]}]});
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
  assert.deepEqual(models,["gpt-5.6-terra","gpt-5.6-terra","gpt-5.6-terra","gpt-5.6-terra"]);
  assert.equal(opened,1);assert.equal(reads,1);assert.equal(disposed,1);
  assert.equal(renewed,2);assert.equal(released,1);
});
