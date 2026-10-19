import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {capturePreparedSource} from "../lib/legal-corpus/prepared-source-capture";
import {classifyLegalSourceUrl,type FetchedLegalSource} from "../lib/legal/source-fetch";
import {isCurrentSourceObservation,SOURCE_OBSERVATION_MAX_AGE_MS} from "../lib/legal/source-observation";
import {publisherTextFingerprint} from "../lib/legal/lex-document-status";
import {resolvePreparedSourceEvidence,resolvePreparedSourceReferences} from "../lib/legal-corpus/prepared-source-evidence";
import {prepareCorpusEvidence} from "../lib/legal-chat/corpus-evidence";
import {resolveCitationEvidence} from "../lib/legal-corpus/citation-evidence";

function fixture(url="https://lex.uz/ru/docs/777",html?:string){
  const bytes=new TextEncoder().encode(html??`<html><header id="doc_header">Действующий акт</header><main><h1>Официальный закон</h1><p>${"Закон устанавливает права и обязанности сторон. ".repeat(12)}</p></main></html>`);
  const fetched:FetchedLegalSource={...classifyLegalSourceUrl(url),bytes,contentSha256:createHash("sha256").update(bytes).digest("hex"),
    contentType:"text/html",etag:null,lastModified:null,fetchedAt:"2026-10-20T00:00:00.000Z",robotsUrl:"https://lex.uz/robots.txt"};
  const objects=new Map<string,Uint8Array>();
  const bucket={async get(key:string){const bytes=objects.get(key);return bytes?{key,size:bytes.length,bytes:async()=>bytes}:null;},
    async put(key:string,bytes:Uint8Array){objects.set(key,new Uint8Array(bytes));}};
  const store={namespace:"legal-prepared-"+"a".repeat(64),generationSha256:"b".repeat(64)};
  return {fetched,bucket,store,objects,options:{}};
}

test("prepared capture persists the exact parent and derives currentness from the same bytes",async()=>{
  const input=fixture();const result=await capturePreparedSource(input);
  assert.equal(input.objects.size,1);assert.deepEqual(result.store,input.store);
  assert.equal(result.parent.snapshot.source.rawContentSha256,input.fetched.contentSha256);
  const expected={officialUrl:input.fetched.canonicalUrl,normalizedTextSha256:await publisherTextFingerprint(result.parent.snapshot),now:Date.parse(input.fetched.fetchedAt)};
  assert.equal(isCurrentSourceObservation(result.observation,expected),true);
  assert.equal(isCurrentSourceObservation(result.observation,{...expected,now:expected.now+SOURCE_OBSERVATION_MAX_AGE_MS}),false);
  assert.equal((await capturePreparedSource(input)).revisionId,result.revisionId);
});

test("a historical capture cannot become a current-source observation",async()=>{
  const result=await capturePreparedSource(fixture("https://lex.uz/ru/docs/777?ONDATE=01.01.2020"));
  assert.equal(result.observation,null);
});

test("capture rejects changed source bytes before persistence and rejects acknowledged but missing writes",async()=>{
  const input=fixture();input.fetched.bytes=new Uint8Array([1]);
  await assert.rejects(capturePreparedSource(input),/CAPTURE_MISMATCH/u);assert.equal(input.objects.size,0);
  const lost=fixture();lost.bucket.put=async()=>{};
  await assert.rejects(capturePreparedSource(lost),/PINNED_SOURCE_REVISION_UNAVAILABLE/u);
});

test("a corrupt existing parent cannot be replaced under its original citation key",async()=>{
  const input=fixture();const first=await capturePreparedSource(input);
  input.objects.set(first.parent.r2Key,new Uint8Array([1,2,3]));
  await assert.rejects(capturePreparedSource(input),/PARENT_CONFLICT/u);
  assert.deepEqual(input.objects.get(first.parent.r2Key),new Uint8Array([1,2,3]));
});

const discoveryText="The applicant must identify the requested record.";
const articleHtml=`<html><header id="doc_header">Действующий акт</header><main><h1>Official records law</h1>
<p>Article 7. Access to records</p><p>${discoveryText}</p>
<p>The authority must supply the complete record within ten days, except where the record contains protected personal information about another person.</p>
<p>Article 8. Review</p><p>The applicant may ask for independent review of a refusal and submit supporting evidence with that request.</p></main></html>`;
const discovery=(text=discoveryText)=>({officialUrl:"https://lex.uz/en/docs/777",languageTag:"en" as const,text,
  textSha256:createHash("sha256").update(text).digest("hex")});

test("prepared discovery recovers complete article exceptions and reopens the generation-bound receipt",async()=>{
  const input=fixture("https://lex.uz/en/docs/777",articleHtml);
  const capture=await capturePreparedSource(input);
  const joined=await resolvePreparedSourceEvidence({capture,discovery:discovery(),bucket:input.bucket});
  assert.match(joined.resolution.articleContext!.provisionText,/except where/);
  assert.doesNotMatch(joined.resolution.articleContext!.provisionText,/Article 8/);
  const evidence=await prepareCorpusEvidence({resolution:joined.resolution,endpoint:{kind:"current"}});
  const answerEvidence=evidence.finalize({currentAt:input.fetched.fetchedAt,currentSourceStatus:{observation:capture.observation!,
    pinnedTextSha256:await publisherTextFingerprint(capture.parent.snapshot)}});
  const receipt=answerEvidence.source.citationEvidenceReceipt!;
  assert.equal(receipt.version,2);assert.deepEqual(receipt.store,input.store);
  assert.equal(receipt.articleNumber,"7");
  assert.equal((await resolveCitationEvidence(input.bucket,receipt)).text,answerEvidence.text);
});

test("prepared discovery rejects stale, ambiguous, mismatched and historical source claims",async()=>{
  const input=fixture("https://lex.uz/en/docs/777",articleHtml);
  const capture=await capturePreparedSource(input);
  const resolve=(value:ReturnType<typeof discovery>)=>resolvePreparedSourceEvidence({capture,discovery:value,bucket:input.bucket});
  await assert.rejects(resolve({...discovery(),text:"Modified"}),/TEXT_MISMATCH/);
  await assert.rejects(resolve(discovery("An obsolete rule has been removed.")),/SPAN_STALE/);
  await assert.rejects(resolve({...discovery(),officialUrl:"https://lex.uz/en/docs/778"}),/SOURCE_MISMATCH/);
  const duplicate=fixture("https://lex.uz/en/docs/777",articleHtml.replace("</main>",`<p>${discoveryText}</p></main>`));
  await assert.rejects(resolvePreparedSourceEvidence({capture:await capturePreparedSource(duplicate),discovery:discovery(),bucket:duplicate.bucket}),/SPAN_AMBIGUOUS/);
  const historical=fixture("https://lex.uz/en/docs/777?ONDATE=01.01.2020",articleHtml);
  await assert.rejects(resolvePreparedSourceEvidence({capture:await capturePreparedSource(historical),
    discovery:{...discovery(),officialUrl:historical.fetched.canonicalUrl},bucket:historical.bucket}),/HISTORICAL_APPLICABILITY_REQUIRED/);
});

test("prepared reference expansion recovers complementary provisions from the same revision with explicit budget gaps",async()=>{
  const html=articleHtml.replace("The authority must supply", "The review procedure follows Article 8 of this Law, subject to Article 9 of this Law. The authority must supply");
  const input=fixture("https://lex.uz/en/docs/777",html),capture=await capturePreparedSource(input);
  const source=await resolvePreparedSourceEvidence({capture,discovery:discovery(),bucket:input.bucket});
  const result=await resolvePreparedSourceReferences({capture,source,bucket:input.bucket});
  assert.equal(result.resolved.length,1);assert.equal(result.resolved[0]!.article,"8");
  assert.match(result.resolved[0]!.source.resolution.articleContext!.provisionText,/independent review/);
  assert.equal(result.resolved[0]!.source.resolution.controlling.textRevisionId,capture.revisionId);
  assert.deepEqual(result.unresolved,[{article:"9",reason:"reference_not_found"}]);
  const bounded=await resolvePreparedSourceReferences({capture,source,bucket:input.bucket,limit:0});
  assert.equal(bounded.resolved.length,0);assert.deepEqual(bounded.unresolved.map(row=>row.reason),["lookup_budget","lookup_budget"]);
  const other=await capturePreparedSource(fixture("https://lex.uz/en/docs/777",articleHtml));
  await assert.rejects(resolvePreparedSourceReferences({capture:other,source,bucket:input.bucket}),/REFERENCE_SOURCE_MISMATCH/);
});

