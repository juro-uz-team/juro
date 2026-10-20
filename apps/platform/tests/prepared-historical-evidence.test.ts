import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {capturePreparedSource} from "../lib/legal-corpus/prepared-source-capture";
import {createPreparedHistoricalEvidenceReader} from "../lib/legal-corpus/prepared-historical-evidence";
import {classifyLegalSourceUrl} from "../lib/legal/source-fetch";
import {createCompleteArticleIndex} from "../lib/legal/article-context";
import {resolvePreparedSourceEvidence} from "../lib/legal-corpus/prepared-source-evidence";

const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
async function fixture(){
  const objects=new Map<string,Uint8Array>();
  const bucket={async get(key:string){const bytes=objects.get(key);return bytes?{key,size:bytes.length,bytes:async()=>bytes}:null;},
    async put(key:string,bytes:Uint8Array){objects.set(key,new Uint8Array(bytes));}};
  const url="https://lex.uz/en/docs/777?ONDATE=01.01.2020";
  const quote="This provision applies from 1 January 2020 until 1 January 2021.";
  const edition="This text is the official edition for the period from 1 January 2020 until 1 January 2021.";
  const bytes=new TextEncoder().encode(`<html><header id="doc_header">Действующий акт</header><main><h1>Records law</h1><p>Article 7. Records</p><p>The applicant may request a complete record from the public authority except where disclosure would reveal protected personal information.</p><p>Article 8. Commencement</p><p>${quote}</p><p>${edition}</p></main></html>`);
  const capture=await capturePreparedSource({fetched:{...classifyLegalSourceUrl(url),bytes,contentSha256:hash(bytes),
    contentType:"text/html",etag:null,lastModified:null,fetchedAt:"2026-10-20T00:00:00.000Z",robotsUrl:"https://lex.uz/robots.txt"},
    bucket,store:{namespace:"legal-prepared-"+"a".repeat(64),generationSha256:"b".repeat(64)},options:{}});
  const completeText=createCompleteArticleIndex(capture.parent.snapshot.blocks)("7").candidates[0]!.text;
  const proof={revisionId:capture.revisionId,sha256:capture.parent.sha256,officialUrl:url,quote};
  const fact={sourceRevisionId:capture.revisionId,sourceSha256:capture.parent.sha256,officialUrl:url,languageTag:"en" as const,
    completeTextSha256:hash(completeText),articleNumber:"7",
    editorial:{from:"2020-01-01T00:00:00Z",to:"2021-01-01T00:00:00Z"},editorialEvidence:{...proof,quote:edition},
    applicability:{from:"2020-01-01T00:00:00Z",to:"2021-01-01T00:00:00Z"},applicabilityEvidence:{...proof,kind:"commencement_clause" as const}};
  const publication={format:"prepared-historical-evidence-v1",packageSha256:"a".repeat(64),facts:[fact]};
  function reader(value=publication){const manifestBytes=new TextEncoder().encode(JSON.stringify(value));
    return createPreparedHistoricalEvidenceReader({manifestBytes,manifestSha256:hash(manifestBytes),packageSha256:publication.packageSha256,bucket});}
  const query={sourceRevisionId:capture.revisionId,sourceSha256:capture.parent.sha256,officialUrl:url,languageTag:"en" as const,
    completeText,articleNumber:"7",instant:"2020-06-01T00:00:00Z"};
  return {reader,publication,query,objects,capture,bucket};
}

test("historical admission authenticates exact complete rule and independent interval evidence",async()=>{
  const f=await fixture();const result=await f.reader().resolve(f.query);
  assert.equal(result.fact.completeTextSha256,hash(f.query.completeText));assert.equal(result.instant,f.query.instant);
  for(const changes of [{instant:"2019-12-31T23:59:59.9999999Z"},{instant:"2021-01-01T00:00:00Z"},
    {articleNumber:"8"},{completeText:"partial record rule"},{languageTag:"ru" as const},
    {officialUrl:"https://lex.uz/en/docs/777"}]){
    await assert.rejects(f.reader().resolve({...f.query,...changes}),/APPLICABILITY_REQUIRED/);
  }
  await assert.rejects(f.reader({...f.publication,facts:[...f.publication.facts,...f.publication.facts]}).resolve(f.query),/AMBIGUOUS/);
});

test("historical discovery resolves complete evidence only with its matching applicability publication",async()=>{
  const f=await fixture();
  const input={capture:f.capture,bucket:f.bucket,discovery:{officialUrl:f.query.officialUrl,
    languageTag:f.query.languageTag,text:f.query.completeText,textSha256:hash(f.query.completeText)}};
  await assert.rejects(resolvePreparedSourceEvidence(input),/APPLICABILITY_REQUIRED/);
  const result=await resolvePreparedSourceEvidence({...input,history:{instant:f.query.instant,reader:f.reader()}});
  assert.equal(result.resolution.articleContext!.provisionText,f.query.completeText);
  assert.equal(result.historicalApplicability!.instant,f.query.instant);
  await assert.rejects(resolvePreparedSourceEvidence({...input,history:{instant:"2021-01-01T00:00:00Z",reader:f.reader()}}),/APPLICABILITY_REQUIRED/);
});

test("ONDATE and pinned text cannot replace missing or corrupted applicability evidence",async()=>{
  const f=await fixture();const invalid=structuredClone(f.publication);
  invalid.facts[0]!.applicabilityEvidence.quote="An unsupported commencement assertion that does not occur in the source.";
  await assert.rejects(f.reader(invalid).resolve(f.query),/PROOF_UNAVAILABLE/);
  const wrongScope=structuredClone(f.publication);wrongScope.facts[0]!.completeTextSha256=hash("fragment");
  await assert.rejects(f.reader(wrongScope).resolve({...f.query,completeText:"fragment"}),/RULE_MISMATCH/);
  f.objects.set(f.capture.parent.r2Key,new Uint8Array([1,2,3]));
  await assert.rejects(f.reader().resolve(f.query),/REVISION_INVALID/);
});

test("historical half-open intervals preserve sub-millisecond precision",async()=>{
  const f=await fixture();const precise=structuredClone(f.publication);
  precise.facts[0]!.applicability={from:"2020-06-01T00:00:00.1234567Z",to:"2020-06-01T00:00:00.1234569Z"};
  const reader=f.reader(precise);
  await reader.resolve({...f.query,instant:"2020-06-01T00:00:00.12345670Z"});
  await assert.rejects(reader.resolve({...f.query,instant:"2020-06-01T00:00:00.1234566Z"}),/APPLICABILITY_REQUIRED/);
  await assert.rejects(reader.resolve({...f.query,instant:"2020-06-01T00:00:00.1234569Z"}),/APPLICABILITY_REQUIRED/);
});

test("manifest pins and editorial validity are independent admission requirements",async()=>{
  const f=await fixture();const manifestBytes=new TextEncoder().encode(JSON.stringify(f.publication));
  const input={manifestBytes,manifestSha256:hash(manifestBytes),packageSha256:f.publication.packageSha256,bucket:f.bucket};
  assert.throws(()=>createPreparedHistoricalEvidenceReader({...input,manifestSha256:"0".repeat(64)}),/MANIFEST_MISMATCH/);
  assert.throws(()=>createPreparedHistoricalEvidenceReader({...input,packageSha256:"0".repeat(64)}),/PACKAGE_MISMATCH/);
  const otherEdition=structuredClone(f.publication);
  otherEdition.facts[0]!.editorial.to="2020-05-01T00:00:00Z";
  await assert.rejects(f.reader(otherEdition).resolve(f.query),/APPLICABILITY_REQUIRED/);
  await f.reader().resolve({...f.query,instant:"2020-06-01T00:00Z"});
});
