import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {checkLegalDraft} from "../lib/legal-chat/answer-checks";
import {createLegalAnswerModel} from "../lib/legal-chat/answer-model";
import {answerFromEvidence, type AnswerQuestion} from "../lib/legal-chat/answer-engine";
import {legalDraftClaims, legalDraftSchema} from "../lib/legal-chat/answer-contract";
import {decodeSavedLegalAnswer} from "../lib/legal-chat/saved-answer";

const text = "Synthetic rule: an applicant may request a record.";
const question: AnswerQuestion = {question:"May I request a record?", locale:"en",mode:"fast",answerMode:"short",
  temporalScope:{kind:"current"},unresolved:[],evidence:[{text,
    textSha256:createHash("sha256").update(text).digest("hex"),endpoint:{kind:"current"},origin:"indexed",
    source:{id:"source",actTitle:"Synthetic rule",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
      revisionDate:null,lastCheckedAt:"2026-09-28",locale:"en",publishedAt:null,sourceType:"lex",
      status:"current",verificationState:"verified",verifiedAt:"2026-09-28",contentSha256:"a".repeat(64),
      sourceClass:"OFFICIAL_LEGISLATION"}}]};
function draft() {return legalDraftSchema.parse({mainPoint:{text,sourceIds:["source"]},
  findings:[{title:"Access",explanation:text,sourceIds:["source"]}],
  actions:[{title:"Request",description:"Request your record.",sourceIds:["source"]}],
  risks:[],questions:[],unresolved:[],ruleBindings:[{findingId:"finding:0",actionIds:["action:0"]}]});}

test("both modes check every draft without any provider calls, including unbound drafts",async context=>{
  context.mock.method(globalThis,"fetch",()=>{throw new Error("Unexpected provider call");});
  const model=createLegalAnswerModel({requestId:"checks"});
  for(const mode of ["fast","deep"] as const) {
    const value=draft();
    const checked=await model.verify({question:{...question,mode},draft:value,claims:[],previous:null});
    assert.deepEqual(checked,await checkLegalDraft(question,value),"Caller inventory cannot omit claims");
    await assert.rejects(model.verify({question:{...question,mode},draft:{...value,ruleBindings:[]},
      claims:legalDraftClaims(value),previous:null}),/INCOMPLETE_ISSUE_BINDINGS/);
  }
});

test("citation checks reject unknown, duplicate and absent references",async()=>{
  for(const sourceIds of [["invented"],["source","source"],[]]) {
    const value=draft();value.mainPoint.sourceIds=sourceIds;
    const checked=await checkLegalDraft(question,value);
    assert.equal(checked.claims.find(item=>item.id==="mainPoint")?.supported,false);
    assert.equal(checked.complete,false);
  }
});

test("issue membership rejects invented, duplicated and orphaned bindings",async()=>{
  for(const ruleBindings of [[],[{findingId:"finding:9",actionIds:["action:0"]}],
    [{findingId:"finding:0",actionIds:[]}],
    [{findingId:"finding:0",actionIds:["action:0","action:0"]}],
    [{findingId:"finding:0",actionIds:["action:0"]},{findingId:"finding:0",actionIds:[]}]]) {
    await assert.rejects(checkLegalDraft(question,{...draft(),ruleBindings}),/BINDING/);
  }
});

test("source text integrity and temporal identity remain enforced",async()=>{
  await assert.rejects(checkLegalDraft({...question,evidence:question.evidence.map(item=>({...item,text:"Altered"}))},draft()),/HASH_MISMATCH/);
  await assert.rejects(checkLegalDraft({...question,temporalScope:{kind:"timestamp",instant:"2020-01-01T00:00:00Z"}},draft()),/IDENTITY_INVALID/);
});

test("programmatic delivery and saved decoding do not claim semantic verification or good coverage",async()=>{
  const value=draft();
  // Deliberately false: reference membership cannot establish entailment.
  value.mainPoint.text="Every applicant must wait exactly 999 days.";
  const model=createLegalAnswerModel({requestId:"checks"});
  const outcome=await answerFromEvidence(question,{...model,write:async()=>value},{correction:"never"});
  assert.equal(outcome.kind,"answered");
  assert.equal(outcome.verification?.complete,false);
  assert.equal(outcome.result.summary,value.mainPoint.text);
  assert.equal(outcome.result.validationMethod,"programmatic");
  assert.equal(outcome.result.coverageStatus,undefined);
  assert.deepEqual(decodeSavedLegalAnswer(JSON.stringify(outcome.result)),outcome.result);
});

test("invalid finding citations withhold their dependent actions",async()=>{
  const value=draft();value.findings[0]!.sourceIds=["invented"];
  const model=createLegalAnswerModel({requestId:"checks"});
  const outcome=await answerFromEvidence(question,{...model,write:async()=>value},{correction:"never"});
  assert.equal(outcome.kind,"insufficient_evidence");
  assert.deepEqual(outcome.result.actionPlan,[]);
});

test("known gaps remain partial without another model call",async()=>{
  let writes=0;
  const model=createLegalAnswerModel({requestId:"checks"});
  const outcome=await answerFromEvidence({...question,unresolved:["A referenced provision was unavailable."]},
    {...model,write:async()=>{writes++;return draft();}});
  assert.equal(writes,1);
  assert.equal(outcome.kind,"partial");
  assert.equal(outcome.result.coverageStatus,"partial_coverage");
  assert.ok(outcome.result.coverageGaps?.includes("A referenced provision was unavailable."));
});
