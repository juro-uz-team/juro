import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {researchLegalQuestion,type ResearchQuestion,type ResearchNeed} from "../lib/legal-chat/research";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";

function evidence(id:string,text="Synthetic rule: an applicant may request a record."):LegalEvidence {
  return {source:{id,actTitle:"Synthetic rules",actIdentifier:null,officialUrl:"https://lex.uz/docs/999999",
    revisionDate:null,lastCheckedAt:"2026-09-20",locale:"en",publishedAt:null,sourceType:"lex",
    status:"current",verificationState:"verified",verifiedAt:"2026-09-20",contentSha256:"a".repeat(64),
    sourceClass:"OFFICIAL_LEGISLATION"},text,textSha256:createHash("sha256").update(text).digest("hex"),
    endpoint:{kind:"current"},origin:"indexed"};
}
const question:ResearchQuestion={question:"How can I request a record?",topics:["Record request"],
  locale:"en",mode:"fast",answerMode:"detailed",temporalScope:{kind:"current"}};
const missing:ResearchNeed={reason:"unresolved_reference",detail:"The rule refers to eligibility in another provision."};

test("assessment can explicitly close a known substantive gap using admitted evidence",async()=>{
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("eligibility")],needs:[missing]}),
    official:async()=>{throw Error("Should not run");},
    assess:async()=>({needs:[],resolved:[{need:missing,sourceIds:["eligibility"]}]}),
  });
  assert.deepEqual(result.needs,[]);
  assert.equal(result.rounds,1);
  assert.equal(result.sourceUnavailable,false);
});

test("semantic assessment cannot certify away a source outage or invent resolution evidence",async()=>{
  for(const structural of [true,false]) {
    const need:ResearchNeed=structural?{reason:"source_unavailable",detail:"The publisher could not be reached."}:missing;
    await assert.rejects(researchLegalQuestion(question,{
      indexed:async()=>({evidence:[evidence("eligibility")],needs:[need]}),
      official:async()=>({evidence:[],needs:[]}),
      assess:async()=>({needs:[],resolved:[{need,sourceIds:[structural?"eligibility":"invented"]}]}),
    }),/ASSESSMENT_RESOLUTION_INVALID/);
  }
});

test("many distinct bounded source failures preserve every gap and the useful admitted evidence",async()=>{
  const needs:ResearchNeed[]=Array.from({length:42},(_,index)=>({reason:"source_unavailable",detail:`Source ${index} was unavailable.`}));
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("useful")],needs}),
    official:async()=>({evidence:[],needs:[]}),assess:async()=>[],
  });
  assert.equal(result.evidence.length,1);
  assert.equal(result.needs.filter(need=>need.reason==="source_unavailable").length,42);
  assert.equal(result.sourceUnavailable,true);
});

test("repeated needs have a unique assessment inventory and duplicate valid resolutions apply atomically",async()=>{
  let assessment=0;
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("rule")],needs:[missing,missing]}),
    official:async()=>({evidence:[],needs:[missing]}),
    assess:async input=>{
      assert.deepEqual(input.needs,[missing]);
      return ++assessment<3?[]:{needs:[],resolved:[
        {need:missing,sourceIds:["rule"]},{need:missing,sourceIds:["rule"]}]};
    },
  });
  assert.equal(result.rounds,2);
  assert.deepEqual(result.needs,[]);
});

test("official recovery follows corpus search and explicitly resolves a referenced rule",async()=>{
  const calls:string[]=[];
  const result=await researchLegalQuestion(question,{
    indexed:async()=>{calls.push("indexed");return {evidence:[evidence("general")],needs:[missing]};},
    official:async request=>{calls.push("official");assert.deepEqual(request.needs,[missing]);
      return {evidence:[{...evidence("eligibility"),origin:"live"}],needs:[],resolved:[{need:missing,sourceIds:["eligibility"]}]};},
    assess:async()=>[],
  });
  assert.deepEqual(calls,["indexed","official"]);
  assert.equal(result.evidence.length,2);
  assert.deepEqual(result.needs,[]);
  assert.equal(result.rounds,1);
});

test("search exhaustion and empty results cannot masquerade as complete evidence",async()=>{
  let searches=0;
  const result=await researchLegalQuestion(question,{
    indexed:async()=>{searches++;return {evidence:[],needs:[missing]};},
    official:async()=>{searches++;return {evidence:[],needs:[]};},assess:async()=>[],
  });
  assert.equal(searches,6);
  assert.equal(result.rounds,3);
  assert.ok(result.needs.some(need=>need.reason==="unresolved_reference"));
  assert.ok(result.needs.some(need=>need.reason==="search_budget"));
});

test("a source outage stays distinct from missing law despite an optimistic assessment",async()=>{
  const result=await researchLegalQuestion(question,{
    indexed:async()=>{throw Error("Service down");},
    official:async()=>({evidence:[evidence("rule")],needs:[]}),assess:async()=>[],
  });
  assert.equal(result.sourceUnavailable,true);
  assert.ok(result.needs.some(need=>need.reason==="source_unavailable"));
  assert.equal(result.evidence.length,1);
});

test("evidence identity conflicts and forged resolutions fail before legal writing",async()=>{
  for(const forgedResolution of [false,true]) {
    await assert.rejects(researchLegalQuestion(question,{
      indexed:async()=>({evidence:[evidence("rule")],needs:[missing]}),
      official:async()=>forgedResolution?{evidence:[],needs:[],resolved:[{need:missing,sourceIds:["invented"]}]}:
        {evidence:[evidence("rule","Different text under the same identity.")],needs:[]},
      assess:async()=>[],
    }),/RESEARCH_(EVIDENCE_IDENTITY_CONFLICT|RESOLUTION_EVIDENCE_MISSING)/);
  }
});

test("context limits report an unresolved whole provision instead of truncating it",async()=>{
  const first=evidence("one","A".repeat(32_000)),second=evidence("two","B".repeat(33_000));
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[first],needs:[missing]}),
    official:async()=>({evidence:[second],needs:[]}),assess:async()=>[],
  });
  assert.deepEqual(result.evidence,[first]);
  assert.ok(result.needs.some(need=>need.reason==="context_budget"));
});

test("cancellation prevents starting any search",async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(researchLegalQuestion({...question,signal:controller.signal},{
    indexed:async()=>assert.fail("No search after cancellation"),official:async()=>assert.fail("No live search"),assess:async()=>[],
  }));
});

test("an individually oversized packet remains a context limit rather than crashing research",async()=>{
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("oversized","A".repeat(64_001))],needs:[]}),
    official:async()=>({evidence:[],needs:[]}),assess:async()=>[],
  });
  assert.deepEqual(result.evidence,[]);
  assert.equal(result.sourceUnavailable,false);
  assert.ok(result.needs.some(need=>need.reason==="context_budget"));
});

test("a known missing rule cannot disappear through an empty later assessment",async()=>{
  const need:ResearchNeed={reason:"missing_rule",detail:"Eligibility requires another provision."};
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("general")],needs:[need]}),
    official:async()=>({evidence:[],needs:[]}),assess:async()=>[],
  });
  assert.ok(result.needs.some(item=>item.reason===need.reason&&item.detail===need.detail));
});

test("an assessment need survives a later silent assessment after fruitless official search",async()=>{
  let assessments=0;
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("general")],needs:[]}),
    official:async request=>{assert.ok(request.needs.some(need=>need.detail===missing.detail));return {evidence:[],needs:[]};},
    assess:async()=>++assessments===1?[missing]:[],
  });
  assert.ok(result.needs.some(need=>need.detail===missing.detail));
});
