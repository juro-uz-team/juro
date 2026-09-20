import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createOfficialResearch} from "../lib/legal-chat/official-research";
import {unavailableDirectLegalRetrieval} from "../lib/legal/direct-retrieval";
import type {LegalSourceContext} from "../lib/legal/source-context";
import type {ResearchRequest} from "../lib/legal-chat/research";
import {researchLegalQuestion} from "../lib/legal-chat/research";
const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const request:ResearchRequest={round:0,needs:[],question:{question:"Can Alice Example request a record?",topics:["Record access"],
  locale:"en",mode:"fast",answerMode:"detailed",temporalScope:{kind:"current"}}};
const fullText="Статья 7. Заявитель может получить запись. Заявление должно содержать сведения о запрашиваемой записи.";
const source=(text:string):LegalSourceContext=>({id:"direct:one",actTitle:"Правила предоставления записей",actIdentifier:"777",
  officialUrl:"https://lex.uz/ru/docs/777",revisionDate:null,lastCheckedAt:"2026-09-20T00:00:00Z",locale:"ru",publishedAt:null,
  sourceType:"lex",status:"verified",verificationState:"direct_validated",verifiedAt:"2026-09-20T00:00:00Z",
  contentSha256:"a".repeat(64),applicabilityStatus:"current",article:"Статья 7. Предоставление записей",
  spans:[{id:"span",article:"Статья 7. Предоставление записей",paragraph:null,text,textSha256:hash(text),quality:"high"}]});
function fixture() {
  let reads=0,searches=0;
  const dependencies:Parameters<typeof createOfficialResearch>[0]={
    formulate:async()=>({id:"plan",formulations:[{id:"query",text:"record access for Alice Example",privateNameSpans:["Alice Example"],
      legalTitleSpans:[],readingIds:["question"],requirementIds:["topic:0"]}]}),
    retrieve:async query=>{searches++;assert.equal(query,"record access for");
      return {...unavailableDirectLegalRetrieval(),sources:[source("Discovery fragment only.")],errors:[]};},
    fetchArticle:async(url,locale,options)=>{
      reads++;assert.equal(url,"https://lex.uz/ru/docs/777");assert.equal(locale,"ru");
      assert.equal(options?.completeArticle,true);assert.equal(options?.query,"Article 7");
      return {source:source(fullText),evidence:{sourceId:"direct:one",sourceKind:"lex",canonicalUrl:url,contentSha256:"a".repeat(64),
        retrievedAt:"2026-09-20T00:00:00Z",validatedAt:"2026-09-20T00:00:00Z",validationStatus:"validated"}};
    },
  };
  return {dependencies,counts:()=>({reads,searches})};
}

test("official discovery snippets never become evidence; complete articles are independently reopened",async()=>{
  const {dependencies,counts}=fixture();
  const packet=await createOfficialResearch(dependencies)(request);
  assert.deepEqual(counts(),{reads:1,searches:1});
  assert.equal(packet.evidence[0]!.text,fullText);
  assert.equal(packet.evidence[0]!.source.status,"current");
  assert.equal(packet.evidence[0]!.source.article,"7");
  assert.equal(packet.evidence[0]!.textSha256,hash(fullText));
  assert.equal(packet.evidence[0]!.origin,"live");
});

test("historical research never substitutes a current live document",async()=>{
  const {dependencies,counts}=fixture();
  const packet=await createOfficialResearch(dependencies)({...request,question:{...request.question,
    temporalScope:{kind:"timestamp",instant:"2025-01-01T00:00:00Z"}}});
  assert.deepEqual(counts(),{reads:0,searches:0});
  assert.deepEqual(packet.evidence,[]);
  assert.equal(packet.observations?.[0]?.kind,"historical_live_unavailable");
});

test("request-local live article identities stay stable across research rounds",async()=>{
  const {dependencies,counts}=fixture();const search=createOfficialResearch(dependencies);
  const first=await search(request),second=await search({...request,round:1});
  assert.deepEqual(first.evidence,second.evidence);
  assert.deepEqual(counts(),{reads:1,searches:2});
});

test("a changed article identity is withheld and explicitly unresolved",async()=>{
  const {dependencies}=fixture();const fetchArticle=dependencies.fetchArticle!;
  dependencies.fetchArticle=async(...args)=>{const fetched=await fetchArticle(...args);
    return {...fetched,source:{...fetched.source,officialUrl:"https://lex.uz/ru/docs/888"}};};
  const packet=await createOfficialResearch(dependencies)(request);
  assert.deepEqual(packet.evidence,[]);
  assert.ok(packet.needs.some(need=>need.reason==="ambiguous_revision"));
  assert.ok(packet.needs.every(need=>!need.detail.includes("https://")));
});

test("recovered complete live article resolves its original gap without accepting discovery fragments",async()=>{
  const {dependencies}=fixture();const fetchArticle=dependencies.fetchArticle!;let attempts=0;
  dependencies.fetchArticle=async(...args)=>{if(attempts++===0)throw Error("LEGAL_SOURCE_PROVISION_INCOMPLETE");return fetchArticle(...args);};
  const result=await researchLegalQuestion(request.question,{indexed:async()=>({evidence:[],needs:[]}),
    official:createOfficialResearch(dependencies),assess:async()=>[]});
  assert.equal(result.rounds,2);
  assert.deepEqual(result.needs,[]);
  assert.equal(result.evidence[0]!.text,fullText);
});

test("oversized official search phrases are reported instead of silently searching a prefix",async()=>{
  const {dependencies,counts}=fixture();
  dependencies.formulate=async()=>({id:"plan",formulations:[{id:"query",text:"record ".repeat(20),privateNameSpans:[],readingIds:["question"],requirementIds:["topic:0"]}]});
  const packet=await createOfficialResearch(dependencies)(request);
  assert.deepEqual(counts(),{reads:0,searches:0});
  assert.equal(packet.observations?.[0]?.kind,"search_query_limit");
});

test("live article outages stay operational and expose no source locator to assessment",async()=>{
  const {dependencies}=fixture();
  dependencies.fetchArticle=async()=>{throw Error("LEGAL_SOURCE_TIMEOUT");};
  const result=await researchLegalQuestion(request.question,{indexed:async()=>({evidence:[],needs:[]}),
    official:createOfficialResearch(dependencies),assess:async input=>{
      assert.ok(input.needs.every(need=>!need.detail.includes("https://")));return [];
    }});
  assert.equal(result.sourceUnavailable,true);
  assert.ok(result.needs.some(need=>need.reason==="source_unavailable"));
  assert.ok(!result.needs.some(need=>need.reason==="missing_rule"));
});
