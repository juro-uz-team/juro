import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {researchLegalQuestion,type ResearchQuestion,type ResearchNeed} from "../lib/legal-chat/research";
import type {LegalEvidence} from "../lib/legal-chat/answer-engine";
import {createLegalResearchModel} from "../lib/legal-chat/research-model";
import {env} from "./helpers/runtime-env";
import {legalDraftSchema} from "../lib/legal-chat/answer-contract";

function evidence(id:string,text="Synthetic rule: an applicant may request a record."):LegalEvidence {
  return {source:{id,actTitle:"Synthetic rules",actIdentifier:null,officialUrl:"https://lex.uz/docs/999999",
    revisionDate:null,lastCheckedAt:"2026-09-20",locale:"en",publishedAt:null,sourceType:"lex",
    status:"current",verificationState:"verified",verifiedAt:"2026-09-20",contentSha256:"a".repeat(64),
    sourceClass:"OFFICIAL_LEGISLATION"},text,textSha256:createHash("sha256").update(text).digest("hex"),
    endpoint:{kind:"current"},origin:"indexed"};
}
const question:ResearchQuestion={question:"How can I request a record?",topics:["Record request"],
  locale:"en",mode:"deep",answerMode:"detailed",temporalScope:{kind:"current"}};
const missing:ResearchNeed={reason:"unresolved_reference",detail:"The rule refers to eligibility in another provision."};

for(const mode of ["fast","deep"] as const) test(`${mode} uses one acquisition pass and one assessment despite remaining gaps`,async()=>{
  const calls:string[]=[];
  const result=await researchLegalQuestion({...question,mode},{
    indexed:async input=>{assert.equal(input.round,0);calls.push("indexed");return {evidence:[evidence("first")],needs:[
      {reason:"missing_rule",detail:"A complete article could not be read."},
      {reason:"ambiguous_revision",detail:"A current revision could not be confirmed."},
    ]};},
    official:async input=>{assert.equal(input.round,0);calls.push("official");return {evidence:[evidence("second")],needs:[]};},
    assess:async input=>{calls.push("assess");assert.equal(input.evidence.length,2);return [missing];},
  });
  assert.deepEqual(calls,["indexed","official","assess"]);
  assert.equal(result.rounds,1);
  assert.ok(result.needs.some(need=>need.reason==="ambiguous_revision"));
  assert.ok(result.needs.some(need=>need.detail===missing.detail));
});

test("research discards a provisional draft when selection removes its cited evidence",async()=>{
  const draft=legalDraftSchema.parse({mainPoint:{text:"An applicant may request a record.",sourceIds:["removed"]},
    findings:[{title:"Access",explanation:"An applicant may request a record.",sourceIds:["removed"]}],
    actions:[],risks:[],questions:[],unresolved:[]});
  const result=await researchLegalQuestion({...question,mode:"fast"},{
    indexed:async()=>({evidence:[evidence("retained"),evidence("removed")],needs:[]}),
    official:async()=>{throw Error("No further search expected");},
    assess:async()=>({selectedSourceIds:["retained"],supportedAnswerAvailable:true,needs:[],resolved:[],provisionalDraft:draft}),
  });
  assert.deepEqual(result.evidence.map(item=>item.source.id),["retained"]);
  assert.equal(result.provisionalDraft,undefined);
});

test("an uncited research proposal falls back to standalone drafting",async()=>{
  const draft=legalDraftSchema.parse({mainPoint:{text:"An applicant may request a record.",sourceIds:["retained"]},
    findings:[{title:"Access",explanation:"An applicant may request a record.",sourceIds:[]}],
    actions:[],risks:[],questions:[],unresolved:[]});
  const result=await researchLegalQuestion({...question,mode:"fast"},{
    indexed:async()=>({evidence:[evidence("retained")],needs:[]}),official:async()=>({evidence:[],needs:[]}),
    assess:async()=>({selectedSourceIds:["retained"],supportedAnswerAvailable:true,needs:[],resolved:[],provisionalDraft:draft}),
  });
  assert.equal(result.provisionalDraft,undefined);
  assert.equal(result.evidence.length,1);
});

test("assessment resolution retains its complete supporting source when the selection omits it",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  context.mock.method(globalThis,"fetch",async()=>Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
    selectedSourceIds:["rule"],supportedAnswerAvailable:true,needs:[],queries:[],
    resolved:[{needIndex:0,sourceIds:["eligibility"]}],
  })}]}]}));
  const sources=[evidence("rule"),evidence("eligibility","Synthetic eligibility: the applicant must own the record."),evidence("unrelated")];
  const model=createLegalResearchModel({requestId:"resolution-dependency"});
  const result=await researchLegalQuestion({...question,mode:"fast"},{
    indexed:async()=>({evidence:sources,needs:[missing]}),
    official:async()=>({evidence:[],needs:[]}),assess:model.assess,
  });
  assert.deepEqual(result.evidence,[sources[0],sources[1]]);
  assert.deepEqual(result.needs,[]);
  assert.equal(result.rounds,1);
});

test("an oversized selection with resolution dependencies preserves the unresolved gap",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const initial=Array.from({length:24},(_,index)=>evidence(`rule-${index}`));
  context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>{
    const input=JSON.parse(JSON.parse(String(init?.body)).input);
    const hasDependency=input.evidence.some((item:{id:string})=>item.id==="eligibility");
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
      selectedSourceIds:initial.map(item=>item.source.id),supportedAnswerAvailable:false,needs:[],queries:[],
      resolved:hasDependency?[{needIndex:0,sourceIds:["eligibility"]}]:[],
    })}]}]});
  });
  const model=createLegalResearchModel({requestId:"oversized-resolution-dependency"});
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:initial,needs:[missing]}),
    official:async()=>({evidence:[evidence("eligibility")],needs:[]}),assess:model.assess,
  });
  assert.deepEqual(result.evidence,initial);
  assert.ok(result.needs.some(need=>need.detail===missing.detail));
  assert.ok(result.needs.some(need=>need.reason==="context_budget"));
});

test("fast research preserves context and gaps after one acquisition pass",async()=>{
  let officialCalls=0;
  const result=await researchLegalQuestion({...question,mode:"fast"},{
    indexed:async()=>({evidence:[evidence("rule")],needs:[missing]}),
    official:async()=>{officialCalls++;return {evidence:[],needs:[]};},
    assess:async()=>({needs:[],resolved:[],supportedAnswerAvailable:true,selectedSourceIds:["rule"]}),
  });
  assert.equal(result.rounds,1);
  assert.equal(officialCalls,1);
  assert.deepEqual(result.evidence,[evidence("rule")]);
  assert.ok(result.needs.some(need=>need.detail===missing.detail));
  assert.ok(result.needs.some(need=>need.reason==="search_budget"));
});

test("fast research still tries official discovery when related context cannot support the requested decision",async()=>{
  let officialCalls=0;
  const result=await researchLegalQuestion({...question,mode:"fast"},{
    indexed:async()=>({evidence:[evidence("related")],needs:[missing]}),
    official:async()=>{officialCalls++;return {evidence:[evidence("useful")],needs:[]};},
    assess:async({evidence:items})=>({needs:[],resolved:[],supportedAnswerAvailable:items.some(item=>item.source.id==="useful"),selectedSourceIds:items.some(item=>item.source.id==="useful")?["useful"]:["related"]}),
  });
  assert.equal(officialCalls,1);
  assert.equal(result.rounds,1);
  assert.deepEqual(result.evidence,[evidence("useful")]);
  assert.ok(result.needs.some(need=>need.detail===missing.detail));
});

test("an unanswerable assessment records a gap without starting semantic recovery",async()=>{
  let officialCalls=0;
  const result=await researchLegalQuestion({...question,mode:"fast"},{
    indexed:async()=>({evidence:[evidence("related")],needs:[]}),
    official:async()=>{officialCalls++;return {evidence:[evidence("useful")],needs:[]};},
    assess:async({evidence:items,needs})=>{
      const useful=items.some(item=>item.source.id==="useful");
      return {needs:[],resolved:useful?needs.map(need=>({need,sourceIds:["useful"]})):[],
        supportedAnswerAvailable:useful,selectedSourceIds:useful?["useful"]:["related"]};
    },
  });
  assert.equal(officialCalls,0);
  assert.deepEqual(result.evidence,[evidence("related")]);
  assert.ok(result.needs.some(need=>need.reason==="missing_rule"));
});

test("assessment retains useful complete provisions and admits new repair evidence at capacity",async()=>{
  const initial=Array.from({length:24},(_,index)=>evidence(`background-${index}`));
  const repair=Array.from({length:24},(_,index)=>evidence(`repair-${index}`));
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:initial,needs:[missing]}),
    official:async()=>({evidence:repair,needs:[]}),
    assess:async({evidence:items})=>items.some(item=>item.source.id==="repair-0")
      ?{needs:[],resolved:[{need:missing,sourceIds:["repair-0"]}],selectedSourceIds:["background-0","repair-0"]}
      :{needs:[],resolved:[],selectedSourceIds:["background-0"]},
  });
  assert.deepEqual(result.evidence,[initial[0],repair[0]]);
  assert.deepEqual(result.needs,[]);
});

test("selection cannot resolve a gap using an excluded provision",async()=>{
  await assert.rejects(researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("kept"),evidence("excluded")],needs:[missing]}),
    official:async()=>({evidence:[],needs:[]}),
    assess:async()=>({needs:[],resolved:[{need:missing,sourceIds:["excluded"]}],selectedSourceIds:["kept"]}),
  }),/ASSESSMENT_RESOLUTION_INVALID/);
});

test("selection rejects unknown or duplicate identities and preserves operational failures",async()=>{
  for(const selectedSourceIds of [["invented"],["real","real"]]) {
    await assert.rejects(researchLegalQuestion(question,{
      indexed:async()=>({evidence:[evidence("real")],needs:[]}),official:async()=>({evidence:[],needs:[]}),
      assess:async()=>({needs:[],resolved:[],selectedSourceIds}),
    }),/SELECTION_EVIDENCE_INVALID/);
  }
  const outage:ResearchNeed={reason:"source_unavailable",detail:"A separate publisher read failed."};
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("real"),evidence("background")],needs:[outage]}),
    official:async()=>({evidence:[],needs:[]}),
    assess:async()=>({needs:[],resolved:[],selectedSourceIds:["real"]}),
  });
  assert.equal(result.sourceUnavailable,true);
  assert.ok(result.needs.some(need=>need.detail===outage.detail));
});

test("discarded identities remain immutable and identical candidate sets are assessed once",async()=>{
  let assessments=0;
  const services={
    indexed:async()=>({evidence:[evidence("real"),evidence("background")],needs:[missing]}),
    official:async()=>({evidence:[],needs:[]}),
    assess:async()=>{assessments++;return {needs:[],resolved:[],selectedSourceIds:["real"]};},
  };
  await researchLegalQuestion(question,services);
  assert.equal(assessments,1);
  await assert.rejects(researchLegalQuestion(question,{...services,
    official:async()=>({evidence:[evidence("background","Changed previously excluded text.")],needs:[]}),
  }),/EVIDENCE_IDENTITY_CONFLICT/);
});

test("selection retains transitive references without importing another revision",async()=>{
  const article=(id:string,number:string,text:string)=>({...evidence(id,text),source:{...evidence(id).source,article:number}});
  const one=article("one","1","Eligibility is determined by article 2 of this Code.");
  const two=article("two","2","The limits in article 3 of this Code also apply.");
  const three=article("three","3","A request must be made within the prescribed period.");
  const old={...three,source:{...three.source,id:"old",contentSha256:"b".repeat(64)}};
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[one,two,three,old],needs:[]}),official:async()=>({evidence:[],needs:[]}),
    assess:async()=>({needs:[],resolved:[],selectedSourceIds:["one"]}),
  });
  assert.deepEqual(result.evidence,[one,two,three]);
});

test("a new referring provision restores a previously excluded dependency",async()=>{
  const dependency={...evidence("dependency"),source:{...evidence("dependency").source,article:"2"}};
  const referring=evidence("referring","Eligibility is determined by article 2 of this Code.");
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("general"),dependency],needs:[missing]}),
    official:async()=>({evidence:[referring],needs:[]}),
    assess:async({evidence:items})=>items.some(item=>item.source.id==="referring")
      ?{needs:[],resolved:[{need:missing,sourceIds:["referring"]}],selectedSourceIds:["referring"]}
      :{needs:[],resolved:[],selectedSourceIds:["general"]},
  });
  assert.deepEqual(result.evidence,[dependency,referring]);
});

test("fruitless repair preserves gaps without repeatedly assessing the same evidence",async()=>{
  let assessments=0;
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("general")],needs:[missing]}),
    official:async()=>({evidence:[],needs:[]}),
    assess:async()=>{assessments++;return [];},
  });
  assert.equal(assessments,1);
  assert.equal(result.rounds,1);
  assert.deepEqual(result.evidence,[evidence("general")]);
  assert.ok(result.needs.some(need=>need.detail===missing.detail));
  assert.ok(result.needs.some(need=>need.reason==="search_budget"));
});

test("even productive candidates cannot start a second research round",async()=>{
  const result=await researchLegalQuestion(question,{
    indexed:async({round})=>({evidence:[evidence(`rule-${round}`)],needs:[missing]}),
    official:async()=>({evidence:[],needs:[]}),
    assess:async({round})=>round===2?{needs:[],resolved:[{need:missing,sourceIds:["rule-2"]}]}:[],
  });
  assert.equal(result.rounds,1);
  assert.equal(result.evidence.length,1);
  assert.ok(result.needs.some(need=>need.detail===missing.detail));
});

test("assessment can explicitly close a known substantive gap using admitted evidence",async()=>{
  const result=await researchLegalQuestion(question,{
    indexed:async()=>({evidence:[evidence("eligibility")],needs:[missing]}),
    official:async()=>({evidence:[],needs:[]}),
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
  const result=await researchLegalQuestion(question,{
    indexed:async({round})=>({evidence:[evidence(round?"eligibility":"rule")],needs:[missing,missing]}),
    official:async()=>({evidence:[],needs:[missing]}),
    assess:async input=>{
      assert.deepEqual(input.needs,[missing]);
      return {needs:[],resolved:[
        {need:missing,sourceIds:["rule"]},{need:missing,sourceIds:["rule"]}]};
    },
  });
  assert.equal(result.rounds,1);
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
  assert.equal(searches,2);
  assert.equal(result.rounds,1);
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
