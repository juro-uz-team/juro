import { searchReleaseIdSchema } from "../lib/legal-corpus/target-domain-schemas";
import assert from "node:assert/strict";
import test from "node:test";
import {createRuntimeEvaluationEvidenceServices} from "../lib/legal-corpus/target-runtime";
import {createCorpusResearch} from "../lib/legal-chat/corpus-research";
import {activationEvaluationReportSha256,activationSetEvaluationEnv} from "./helpers/activation-evaluation-env";

const selection={activationSetId:"activation:staging:evaluation-v1",
  historyReconciliationRunId:"history-evaluation:staging:custom-v1",historyReportSha256:activationEvaluationReportSha256};
const current={kind:"current" as const};
const earlier={kind:"timestamp" as const,instant:"2020-01-01T00:00:00.000Z"};
const later={kind:"timestamp" as const,instant:"2025-01-01T00:00:00.000Z"};
const currentId="release:staging:current:evaluation-v1",historyId="release:staging:history:evaluation-v1";

test("candidate evaluation pins the exact off-side release pair across every temporal matrix",async()=>{
  const evaluation=await createRuntimeEvaluationEvidenceServices({env:activationSetEvaluationEnv(),...selection});
  for(const [left,right] of [[current,later],[earlier,current],[earlier,later],[current,current]]){
    const pair=await evaluation.services.releaseResolver.resolveComparison!(left,right);
    assert.equal(pair!.left.id,left.kind==="current"?currentId:historyId);
    assert.equal(pair!.right.id,right.kind==="current"?currentId:historyId);
  }
  assert.equal((await evaluation.services.releaseResolver.resolve(later))!.id,historyId);
  assert.equal((await evaluation.services.releaseResolver.resolve(current))!.id,currentId);
  const mutable=await evaluation.services.releaseResolver.resolve(current);
  mutable!.id=searchReleaseIdSchema.parse("release:staging:foreign");
  assert.equal((await evaluation.services.releaseResolver.resolve(current))!.id,currentId);
  const observed=evaluation.observation();
  assert.equal(observed.activationSetId,selection.activationSetId);
  assert.equal(observed.historyReportSha256,selection.historyReportSha256);
  assert.equal(observed.resolutions.length,8);
  observed.resolutions.length=0;
  assert.equal(evaluation.observation().resolutions.length,8,"External receipt edits cannot erase request observations");
});

test("a caller cannot substitute another release after candidate-pair resolution",async()=>{
  const env=activationSetEvaluationEnv();let requests=0;
  const network={fetch:async()=>{requests++;throw Error("Must reject before transport");}} as unknown as Fetcher;
  env.LEGAL_CUSTOM_SEARCH_SERVICE=network;env.LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE=network;
  const evaluation=await createRuntimeEvaluationEvidenceServices({env,...selection});
  const release=(await evaluation.services.releaseResolver.resolve(current))!;
  release.id=searchReleaseIdSchema.parse("release:staging:foreign");
  const result=await evaluation.services.candidateIndex.retrieve({id:"plan",formulations:[{id:"query",text:"Synthetic rule",
    privateNameSpans:[],readingIds:["topic"],requirementIds:["topic"]}]},current,release,
    {currentAt:"2026-09-21T00:00:00.000Z"});
  assert.equal(result.availability,"unavailable");assert.equal(requests,0);
});

test("replacement corpus research searches only candidate releases and reports unavailable endpoints",async()=>{
  const env=activationSetEvaluationEnv(),requests:Array<{releaseId:string;endpoint:{kind:string}}>=[];
  const unavailable={fetch:async(_url:unknown,init?:RequestInit)=>{
    requests.push(JSON.parse(String(init?.body)));return Response.json({code:"UNAVAILABLE"},{status:503});
  }} as unknown as Fetcher;
  env.LEGAL_CUSTOM_SEARCH_SERVICE=unavailable;env.LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE=unavailable;
  const evaluation=await createRuntimeEvaluationEvidenceServices({env,...selection});
  const search=createCorpusResearch({services:evaluation.services,formulate:async()=>({id:"plan",formulations:[{
    id:"query",text:"Synthetic record rule",privateNameSpans:[],readingIds:["topic"],requirementIds:["topic"]}]}),
    now:()=>Date.parse("2026-09-21T00:00:00Z")});
  const result=await search({round:0,needs:[],question:{question:"How did the record rule change?",topics:["Record rule"],
    locale:"en",mode:"fast",answerMode:"detailed",temporalScope:{kind:"comparison",left:current,right:later}}});
  assert.deepEqual(result.evidence,[]);
  assert.ok(result.needs.some(need=>need.reason==="source_unavailable"));
  assert.deepEqual(new Set(requests.map(request=>request.releaseId)),new Set([currentId,historyId]));
  assert.equal(evaluation.observation().resolutions.length,1);
});

test("candidate evaluation rejects production, disabled shadow mode and mismatched reconciliation",async()=>{
  for(const patch of [{APP_ENV:"production"},{LEGAL_CORPUS_SHADOW_MODE:"false"},{LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE:undefined}]){
    await assert.rejects(createRuntimeEvaluationEvidenceServices({env:{...activationSetEvaluationEnv(),...patch},...selection}),/EVALUATION_UNAVAILABLE/);
  }
  await assert.rejects(createRuntimeEvaluationEvidenceServices({env:activationSetEvaluationEnv(),...selection,historyReportSha256:"0".repeat(64)}));
});
