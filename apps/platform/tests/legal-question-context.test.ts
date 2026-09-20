import assert from "node:assert/strict";
import test from "node:test";
import { interpretLegalQuestion } from "../lib/legal-chat/question-context";

const input = {question:"Compare 2020-01-01 with today. I am 27.", locale:"en" as const,
  priorTurns:[{question:"I am 17.",answer:"The law requires eleven days."}],
  now:new Date("2026-09-14T12:00:00Z")};

test("question context keeps independent topics and exact user facts without promoting assistant claims", async () => {
  const result = await interpretLegalQuestion(input, async () => ({
    topics:["Employment protection", "Filing period"],
    facts:[{turn:1,quotation:"I am 27."}],
    temporal:{kind:"comparison",left:"2020-01-01",right:"current"},questions:[],
  }));
  assert.equal(result.kind,"ready");
  if(result.kind!=="ready") return;
  assert.deepEqual(result.caseFacts,["I am 27."]);
  assert.deepEqual(result.topics,["Employment protection","Filing period"]);
  assert.deepEqual(result.temporalScope,{kind:"comparison",left:{kind:"timestamp",instant:"2019-12-31T19:00:00.000Z"},right:{kind:"current"}});
  const forged = await interpretLegalQuestion(input,async()=>({topics:["Filing"],
    facts:[{turn:0,quotation:"The law requires eleven days."}],temporal:{kind:"current"},questions:[]}));
  assert.equal(forged.kind,"unavailable");
});

test("an explicit date selection cannot silently become current law", async () => {
  const result=await interpretLegalQuestion({...input,question:"Which rule applies?",legalContextDate:"2020-02-29"},async()=>({
    topics:["Employment"],facts:[],temporal:{kind:"current"},questions:[],
  }));
  assert.equal(result.kind,"ready");
  if(result.kind==='ready') assert.deepEqual(result.temporalScope,{kind:"timestamp",instant:"2020-02-28T19:00:00.000Z"});
  const invalid=await interpretLegalQuestion({...input,legalContextDate:"2020-02-30"},async()=>assert.fail("Invalid date must not reach interpretation"));
  assert.equal(invalid.kind,"clarification_required");
});

test("unresolved temporal intent and interpretation failures remain explicit", async () => {
  const unresolved=await interpretLegalQuestion(input,async()=>({topics:["Employment"],facts:[],
    temporal:{kind:"unresolved"},questions:["Which date applies?"]}));
  assert.equal(unresolved.kind,"clarification_required");
  const failure=await interpretLegalQuestion(input,async()=>{throw Error("Provider unavailable");});
  assert.equal(failure.kind,"unavailable");
});

test("prior user statements retain their chronology instead of becoming current asserted facts", async () => {
  const result=await interpretLegalQuestion(input,async()=>({topics:["Employment"],
    facts:[{turn:0,quotation:"I am 17."},{turn:1,quotation:"I am 27."}],temporal:{kind:"current"},questions:[]}));
  assert.equal(result.kind,"ready");
  if(result.kind==='ready') {
    assert.deepEqual(result.caseFacts,["I am 27."]);
    assert.deepEqual(result.priorTurns,input.priorTurns);
  }
});


test("memory selection cannot invent identities or promote private context into official evidence",async()=>{
  const userContext={confirmedFacts:["A confirmed case circumstance"],rejectedFacts:["An explicitly rejected circumstance"],
    memories:[{id:"relevant",category:"answer_style" as const,statement:"Prefer plain language"},
      {id:"unrelated",category:"company" as const,statement:"An unrelated private company"}]};
  const interpreted={topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[],selectedMemoryIds:["relevant"]};
  const result=await interpretLegalQuestion({...input,userContext},async()=>interpreted);
  assert.equal(result.kind,"ready");
  if(result.kind!=="ready")throw new Error("Expected ready");
  assert.deepEqual(result.userContext?.memories,[userContext.memories[0]]);
  assert.deepEqual(result.userContext?.rejectedFacts,userContext.rejectedFacts);
  assert.deepEqual(result.caseFacts,[]);
  const invented=await interpretLegalQuestion({...input,userContext},async()=>({...interpreted,selectedMemoryIds:["invented"]}));
  assert.equal(invented.kind,"unavailable");
});
