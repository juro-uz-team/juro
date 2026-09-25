import assert from "node:assert/strict";
import test from "node:test";
import {createHistoricalSourceVerifier} from "../lib/legal-corpus/historical-source-observation";
import type {SourceObservation} from "../lib/legal/source-observation";

const now=Date.parse("2026-09-25T00:00:00.000Z");
const evidence={officialCitation:{label:"Synthetic act",url:"https://lex.uz/ru/docs/777?ONDATE=01.01.1995"},languageTag:"ru" as const};
const observation:SourceObservation={version:2,officialUrl:"https://lex.uz/ru/docs/777",observedAt:new Date(now).toISOString(),
  current:false,lifecycle:{repealedOn:"1996-12-27"},normalizedTextSha256:"a".repeat(64),rawContentSha256:"b".repeat(64)};

test("historical exclusion uses the whole-act repeal boundary in Uzbekistan civil time",async()=>{
  const verify=createHistoricalSourceVerifier({now:()=>now,observe:async url=>{assert.equal(url,observation.officialUrl);return observation;}});
  for(const [instant,eligible] of [["1996-12-26T18:59:59.999Z",true],["1996-12-26T19:00:00.000Z",false],["2020-01-01T00:00:00.000Z",false]] as const){
    const result=await verify(evidence,{kind:"timestamp",instant});assert.equal(result.eligible,eligible);assert.deepEqual(result.observation,observation);
  }
});

test("unavailable, undated, stale, conflicting or redirected status cannot exclude or admit historical evidence",async()=>{
  const invalid:SourceObservation[]=[{...observation,lifecycle:{repealedOn:null}},
    {...observation,officialUrl:"https://lex.uz/ru/docs/778"},
    {...observation,observedAt:new Date(now-300000).toISOString()},
    {...observation,current:true}];
  for(const status of invalid)await assert.rejects(createHistoricalSourceVerifier({now:()=>now,observe:async()=>status})(evidence,
    {kind:"timestamp",instant:"2020-01-01T00:00:00.000Z"}),/STATUS_UNAVAILABLE/);
  await assert.rejects(createHistoricalSourceVerifier({observe:async()=>{throw Error("Publisher offline");}})(evidence,
    {kind:"timestamp",instant:"2020-01-01T00:00:00.000Z"}),/Publisher offline/);
});

test("current publisher status preserves original historical eligibility and language identity",async()=>{
  const verify=createHistoricalSourceVerifier({now:()=>now,observe:async()=>({...observation,current:true,lifecycle:{repealedOn:null}})});
  assert.equal((await verify(evidence,{kind:"timestamp",instant:"2020-01-01T00:00:00.000Z"})).eligible,true);
  await assert.rejects(verify({...evidence,languageTag:"uz-Latn"},{kind:"timestamp",instant:"2020-01-01T00:00:00.000Z"}),/IDENTITY_INVALID/);
});
