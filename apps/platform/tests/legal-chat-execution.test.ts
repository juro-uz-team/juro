import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {executeLegalChat,type LegalChatTerminal} from "../lib/legal-chat/execution";
import {legalDraftClaims,legalDraftSchema} from "../lib/legal-chat/answer-contract";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";

const text="Synthetic rule: applicants may request a copy of their record.";
const evidence:LegalEvidence={source:{id:"source",actTitle:"Synthetic source",actIdentifier:null,
  officialUrl:"https://lex.uz/docs/999999",revisionDate:null,lastCheckedAt:"2026-09-20",locale:"en",
  publishedAt:null,sourceType:"lex",status:"current",verificationState:"verified",verifiedAt:"2026-09-20",
  contentSha256:"a".repeat(64),sourceClass:"OFFICIAL_LEGISLATION"},text,
  textSha256:createHash("sha256").update(text).digest("hex"),endpoint:{kind:"current"},origin:"indexed"};
const draft=legalDraftSchema.parse({mainPoint:{text:"You may request a copy of your record.",sourceIds:["source"]},
  findings:[{title:"Access to your record",explanation:text,sourceIds:["source"]}],
  actions:[{title:"Request a copy",description:"Ask for a copy of your record.",sourceIds:["source"]}],
  risks:[],questions:[],unresolved:[],ruleBindings:[{findingId:"finding:0",actionIds:["action:0"]}]});
const review={claims:legalDraftClaims(draft).map(claim=>({id:claim.id,supported:true,reason:"Supported by synthetic evidence."})),
  retention:[],coverage:[{issue:"Record access",findingIds:["finding:0"],actionIds:["action:0"],gaps:[]}],
  complete:true,gaps:[],questions:[]};

test("one execution preserves chronological facts and saves only the verified terminal answer",async()=>{
  const turns=[{question:"I am an applicant.",answer:"An earlier assistant assertion is not law."}];
  const events:string[]=[];const stages:string[]=[];let saved:LegalChatTerminal|undefined;
  const observations=[{kind:"candidate_read_limit" as const,lane:"indexed" as const,omitted:30}];
  const result=await executeLegalChat({context:{question:"I need my record.",locale:"en",priorTurns:turns},mode:"fast",answerMode:"detailed",
    interpret:async input=>{events.push("interpret");assert.deepEqual(input.priorTurns,turns);
      return {topics:["Record access"],facts:[{turn:0,quotation:"I am an applicant."},{turn:1,quotation:"I need my record."}],temporal:{kind:"current"},questions:[]};},
    research:{indexed:async request=>{events.push("research");assert.deepEqual(request.question.priorTurns,turns);
      return {evidence:[evidence],needs:[],observations};},official:async()=>assert.fail("Corpus evidence is sufficient"),
      assess:async input=>{assert.deepEqual(input.observations,observations);return [];}},
    model:{write:async input=>{events.push("write");assert.deepEqual(input.question.priorTurns,turns);
      assert.deepEqual(input.question.caseFacts,["I need my record."]);return draft;},
      verify:async()=>{events.push("verify");return review;}},
    renew:async()=>true,commit:async(terminal,sources)=>{events.push("save");saved=terminal;
      assert.equal(sources[0]?.id,evidence.source.id);
      assert.equal(sources[0]?.spans?.[0]?.text,evidence.text);
      assert.equal(sources[0]?.spans?.[0]?.textSha256,evidence.textSha256);
      if("research" in terminal)assert.doesNotMatch(JSON.stringify(terminal.research),/Synthetic rule:/);
      return {id:"saved-result"};},
    release:async()=>assert.fail("Successful request does not release as a failure"),onStage:stage=>{stages.push(stage);},
  });
  assert.deepEqual(result,{id:"saved-result"});
  assert.equal(saved?.kind,"complete");
  if(saved&&"research" in saved) {
    assert.deepEqual(saved.research.observations,observations);
    assert.doesNotMatch(JSON.stringify(saved.result),/candidate_read_limit/);
  }
  assert.deepEqual(events,["interpret","research","write","verify","save"]);
  assert.deepEqual(stages,["interpreting","researching","writing","verifying","saving"]);
});

test("a missing temporal endpoint saves a clarification without research or generation",async()=>{
  const result=await executeLegalChat({context:{question:"Compare the rules then and now.",locale:"en",priorTurns:[]},mode:"deep",answerMode:"detailed",
    interpret:async()=>({topics:["Comparison"],facts:[],temporal:{kind:"unresolved"},questions:["Which earlier date?"]}),
    research:{indexed:async()=>assert.fail("No guessed date"),official:async()=>assert.fail("No guessed date"),assess:async()=>[]},
    model:{write:async()=>assert.fail("No legal writing"),verify:async()=>assert.fail("No verifier")},
    renew:async()=>true,commit:async terminal=>terminal,release:async()=>assert.fail("Clarification was saved"),
  });
  assert.deepEqual(result,{kind:"clarification_required",questions:["Which earlier date?"]});
});

test("research feedback cannot publish an unchecked legal premise or turn an outage into completeness",async()=>{
  const result=await executeLegalChat({context:{question:"May I request my record?",locale:"en",priorTurns:[]},mode:"fast",answerMode:"short",
    interpret:async()=>({topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]}),
    research:{indexed:async()=>({evidence:[evidence],needs:[{reason:"source_unavailable",detail:"Unverified premise: you must pay a fabricated penalty."}]}),
      official:async()=>({evidence:[],needs:[]}),assess:async()=>[]},
    model:{write:async input=>{assert.ok(input.question.researchNeeds?.length);return draft;},verify:async()=>review},
    renew:async()=>true,commit:async terminal=>terminal,release:async()=>assert.fail("Partial answer saved"),
  });
  assert.equal(result.kind,"partial");
  if(result.kind!=="partial")throw Error("Expected partial");
  assert.doesNotMatch(JSON.stringify(result.result),/fabricated penalty/);
  assert.ok(result.research.needs.some(need=>need.detail.includes("fabricated penalty")),
    "Unapproved feedback stays available to the terminal storage adapter as research diagnostics");
});
