import assert from "node:assert/strict";
import test from "node:test";
import {privateDocumentContext} from "./helpers/private-document-context";
import {createHash} from "node:crypto";
import {executeLegalChat,type LegalChatTerminal} from "../lib/legal-chat/execution";
import {legalDraftClaims,legalDraftSchema} from "../lib/legal-chat/answer-contract";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";
import type {SourceObservation} from "../lib/legal/source-observation";

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

for(const scenario of ["unchanged","changed","unavailable","historical","cancelled"] as const) {
  test(`final source validation before saving: ${scenario}`,async()=>{
    const controller=new AbortController();
    const old=new Date(Date.now()-600_000).toISOString();
    const observation:SourceObservation={version:2,officialUrl:evidence.source.officialUrl,observedAt:old,
      current:true,normalizedTextSha256:"b".repeat(64),rawContentSha256:"c".repeat(64)};
    const historical=scenario==="historical";
    const item:LegalEvidence={...evidence,endpoint:historical?{kind:"timestamp",instant:"2024-12-31T19:00:00.000Z"}:{kind:"current"},
      source:{...evidence.source,status:historical?"historical":"current",verifiedAt:old,
        // Applicability is derived from the authenticated endpoint, not optional metadata.
        currentSourceStatus:historical?undefined:{pinnedTextSha256:observation.normalizedTextSha256!,observation}}};
    let reads=0,saves=0;
    const run=()=>executeLegalChat({context:{question:"May I request my record?",locale:"en",priorTurns:[],signal:controller.signal},
      mode:"fast",answerMode:"short",
      interpret:async()=>({topics:["Record access"],facts:[],temporal:historical?{kind:"date",date:"2025-01-01"}:{kind:"current"},questions:[]}),
      research:{indexed:async()=>({evidence:[item],needs:[]}),official:async()=>({evidence:[],needs:[]}),assess:async()=>[]},
      model:{write:async()=>draft,verify:async()=>review},renew:async()=>true,
      observeSource:async()=>{reads++;
        if(scenario==="unavailable")throw new Error("Publisher unavailable");
        if(scenario==="cancelled")controller.abort(new Error("Request cancelled"));
        return {...observation,observedAt:new Date().toISOString(),normalizedTextSha256:scenario==="changed"?"d".repeat(64):"b".repeat(64)};},
      commit:async(terminal,sources)=>{saves++;
        if(scenario==="unchanged"||historical) {
          assert.equal(terminal.kind,"complete");assert.ok("result" in terminal);
          assert.equal(sources[0]?.spans?.[0]?.text,text);
          assert.equal(terminal.result.sources[0]?.verifiedAt,sources[0]?.verifiedAt);
          assert.equal(terminal.result.legalDatabaseAsOf,sources[0]?.verifiedAt);
          if(historical)assert.equal(sources[0]?.verifiedAt,old);
          else assert.notEqual(sources[0]?.verifiedAt,old);
        } else {
          assert.equal(terminal.kind,"unavailable");assert.ok("result" in terminal);
          assert.equal(terminal.result.failureReason,"official_research_unavailable");
          assert.deepEqual(terminal.result.confirmedFindings,[]);assert.deepEqual(sources,[]);
          assert.equal(terminal.research.sourceUnavailable,true);
        }
        return terminal;},release:async()=>{},
    });
    if(scenario==="cancelled")await assert.rejects(run(),/Request cancelled/);else await run();
    assert.equal(reads,historical?0:1);assert.equal(saves,scenario==="cancelled"?0:1);
  });
}

test("one stale source withholds dependent claims while preserving an independent supported topic",async()=>{
  const old=new Date(Date.now()-600_000).toISOString();
  const packet=["source","other"].map(id=>({...evidence,source:{...evidence.source,id,
    officialUrl:`https://lex.uz/docs/${id==="source"?"999999":"888888"}`,verifiedAt:old,
    currentSourceStatus:{pinnedTextSha256:"b".repeat(64),observation:null}}}));
  const mixed=legalDraftSchema.parse({...draft,mainPoint:{text:"Both topics are supported.",sourceIds:["source","other"]},
    findings:[...draft.findings,{title:"Other topic",explanation:"Other supported rule.",sourceIds:["other"]},
      {title:"Dependent rule",explanation:"Subject to the other rule.",sourceIds:["source"]}],
    actions:[...draft.actions,{title:"Other step",description:"Apply the other rule.",sourceIds:["other"]},
      {title:"Dependent step",description:"Use the qualified dependent rule.",sourceIds:["source"]}],
    ruleBindings:[0,1,2].map(index=>({findingId:`finding:${index}`,actionIds:[`action:${index}`]}))});
  const checked={...review,claims:legalDraftClaims(mixed).map(claim=>({id:claim.id,supported:true,reason:"Supported",
    dependsOn:claim.id==="finding:2"?["finding:1"]:[]})),
    coverage:[0,1,2].map(index=>({issue:`Topic ${index}`,findingIds:[`finding:${index}`],actionIds:[`action:${index}`],gaps:[]}))};
  let writes=0;
  const result=await executeLegalChat({context:{question:"Explain both topics.",locale:"en",priorTurns:[]},mode:"fast",answerMode:"detailed",
    interpret:async()=>({topics:["Both topics"],facts:[],temporal:{kind:"current"},questions:[]}),
    research:{indexed:async()=>({evidence:packet,needs:[]}),official:async()=>({evidence:[],needs:[]}),assess:async()=>[]},
    model:{write:async()=>{writes++;return mixed;},verify:async()=>checked},renew:async()=>true,
    observeSource:async officialUrl=>{
      if(officialUrl.endsWith("888888"))throw new Error("Publisher unavailable");
      return {version:2,officialUrl,observedAt:new Date().toISOString(),current:true,
        normalizedTextSha256:"b".repeat(64),rawContentSha256:"c".repeat(64)};
    },commit:async(terminal,sources)=>{assert.deepEqual(sources.map(source=>source.id),["source"]);return terminal;},release:async()=>{},
  });
  assert.equal(writes,1,"A final source outage does not start another model correction");
  assert.equal(result.kind,"partial");assert.ok("result" in result);
  assert.equal(result.research.sourceUnavailable,true);
  assert.deepEqual(result.result.confirmedFindings,draft.findings);
  assert.deepEqual(result.result.actionPlan,draft.actions);
  assert.notEqual(result.result.summary,mixed.mainPoint.text);
  assert.ok(result.result.coverageGaps?.length);
});

test("one execution preserves chronological facts and saves only the verified terminal answer",async()=>{
  const documents=[privateDocumentContext()];
  const turns=[{question:"I am an applicant.",answer:"An earlier assistant assertion is not law."}];
  const events:string[]=[];const stages:string[]=[];let saved:LegalChatTerminal|undefined;
  const observations=[{kind:"candidate_read_limit" as const,lane:"indexed" as const,omitted:30}];
  const result=await executeLegalChat({context:{question:"I need my record.",locale:"en",priorTurns:turns,documents},mode:"fast",answerMode:"detailed",
    interpret:async input=>{events.push("interpret");assert.deepEqual(input.priorTurns,turns);
      return {topics:["Record access"],facts:[{turn:0,quotation:"I am an applicant."},{turn:1,quotation:"I need my record."}],temporal:{kind:"current"},questions:[],selectedDocumentIds:[documents[0]!.source.id]};},
    research:{indexed:async request=>{events.push("research");assert.deepEqual(request.question.priorTurns,turns);
      assert.deepEqual(request.question.documents,documents);
      return {evidence:[evidence],needs:[],observations};},official:async()=>assert.fail("Corpus evidence is sufficient"),
      assess:async input=>{assert.deepEqual(input.observations,observations);return [];}},
    model:{write:async input=>{events.push("write");assert.deepEqual(input.question.priorTurns,turns);
      assert.deepEqual(input.question.documents,documents);
      assert.deepEqual(input.question.caseFacts,["I need my record."]);return draft;},
      verify:async()=>{events.push("verify");return review;}},
    renew:async()=>true,commit:async(terminal,sources)=>{events.push("save");saved=terminal;
      assert.equal(sources[0]?.id,evidence.source.id);
      assert.equal(sources.length,2);
      assert.equal(sources[1]?.sourceClass,"USER_TRUSTED_PRIVATE","Document citation retains its private class");
      assert.equal(sources[0]?.spans?.[0]?.text,evidence.text);
      assert.equal(sources[0]?.spans?.[0]?.textSha256,evidence.textSha256);
      if("research" in terminal)assert.doesNotMatch(JSON.stringify(terminal.research),/Synthetic rule:/);
      return {id:"saved-result"};},
    release:async()=>assert.fail("Successful request does not release as a failure"),onStage:stage=>{stages.push(stage);},
  });
  assert.deepEqual(result,{id:"saved-result"});
  assert.equal(saved?.kind,"complete");
  if(saved&&"research" in saved) {
    assert.deepEqual(saved.caseFacts,["I need my record."]);
    assert.deepEqual(saved.research.observations,observations);
    assert.doesNotMatch(JSON.stringify(saved.result),/candidate_read_limit/);
  }
  assert.deepEqual(events,["interpret","research","write","verify","save"]);
  assert.deepEqual(stages,["interpreting","researching","writing","verifying","saving"]);
});

test("unavailable official research preserves attributed private excerpts without a legal conclusion",async()=>{
  const document=privateDocumentContext();
  const result=await executeLegalChat({context:{question:"What does my agreement say?",locale:"en",priorTurns:[],documents:[document]},
    mode:"fast",answerMode:"detailed",interpret:async()=>({topics:["Agreement terms"],facts:[],temporal:{kind:"current"},
      questions:[],selectedDocumentIds:[document.source.id]}),
    research:{indexed:async()=>{throw Error("Source unavailable");},official:async()=>{throw Error("Source unavailable");},assess:async()=>[]},
    model:{write:async()=>assert.fail("Private documents cannot replace legal evidence"),verify:async()=>assert.fail("No fabricated law")},
    renew:async()=>true,commit:async(terminal,sources)=>{
      assert.deepEqual(sources,[document.source]);return terminal;
    },release:async()=>assert.fail("Useful private context can be saved with the explicit official-source failure")});
  assert.equal(result.kind,"unavailable");
  if(!("result" in result))throw Error("Expected result");
  assert.equal(result.result.failureReason,"official_research_unavailable");
  assert.equal(result.result.evidenceMode,"private_only");
  assert.deepEqual(result.result.confirmedFindings,[]);
  assert.deepEqual(result.result.actionPlan,[]);
  assert.ok(result.result.referenceNotes![0]!.note.includes(document.text));
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
