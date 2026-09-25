import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {corpusAnswerEvidence} from "../lib/legal-chat/corpus-evidence";
import {parseResolvedOfficialEvidence} from "../lib/legal-corpus/target-evidence";
import {createNormalizedArticleEvidenceReader,createNormalizedDocumentEvidenceReader} from "../lib/legal-corpus/normalized-article-evidence";
import {resolveCitationEvidence} from "../lib/legal-corpus/citation-evidence";
import {assertAnswerEvidence} from "../lib/legal-chat/evidence-boundary";
import {MemoryEvidenceBucket} from "./helpers/legal-target";

const currentAt = "2026-09-20T10:00:00.000Z";
const url = "https://lex.uz/docs/777";
const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");

test("a complete inline article retains article evidence and exact citation reopening",async()=>{
  const {bucket,resolution}=await fixture();
  const key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  const text="7-модда. Меҳнат кодексидаги «ўн саккиз» деган сўзлар «йигирма уч» деган сўзлар билан алмаштирилсин.";
  snapshot.blocks=[{index:0,kind:"paragraph",text},...snapshot.blocks.slice(3)];
  snapshot.plainText=snapshot.blocks.map((block:{text:string})=>block.text).join(" ");
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:text,
    evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  const articleContext=await createNormalizedArticleEvidenceReader(bucket)(original,"7");assert.ok(articleContext);
  const evidence=await corpusAnswerEvidence({resolution:{controlling:original,articleContext,
    materialCitation:original.officialCitation},currentAt,endpoint:{kind:"timestamp",instant:"2020-01-01T00:00:00Z"}});
  const reopened=await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!);
  assert.equal(reopened.text,text);assert.equal(reopened.fullArticle,true);
  assert.equal(evidence.source.article,"7");
});

test("publication dates recover the complete numbered instrument without becoming article numbers",async()=>{
  for(const footer of ["14 января 1992 г., № 524-XII",
    "2006-yil 20-aprelda qabul qilingan Senat tomonidan 2006-yil 9-iyunda maʼqullangan"]) {
    const {bucket,resolution}=await fixture();
    const key="corpus/normalized/revision:one.json";
    const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
    snapshot.blocks.push({index:snapshot.blocks.length,kind:"paragraph",text:footer});
    snapshot.plainText=snapshot.blocks.map((block:{text:string})=>block.text).join(" ");
    const bytes=new TextEncoder().encode(JSON.stringify(snapshot));
    bucket.objects.set(key,{bytes,customMetadata:{}});
    const original={...resolution.controlling,provisionText:footer,
      evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
    const read=createNormalizedDocumentEvidenceReader(bucket);
    const documentContext=await read(original);
    assert.ok(documentContext);
    const evidence=await corpusAnswerEvidence({resolution:{controlling:original,documentContext,
      materialCitation:documentContext.officialCitation},currentAt,
      endpoint:{kind:"timestamp",instant:"2020-01-01T00:00:00Z"}});
    assert.equal(evidence.text,snapshot.plainText);
    assert.equal(evidence.source.article,null);
    const reopened=await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!);
    assert.equal(reopened.text,snapshot.plainText);
    assert.equal(reopened.fullArticle,false);
    assert.equal(await read({...original,provisionText:"Article 7. Synthetic filing rule"}),null);
    assert.equal(await read({...original,provisionText:footer+" establishes a filing requirement."}),null);
    assert.equal(await read({...original,provisionText:"15 января 1992 г., № 999-XII"}),null);
  }
});
test("an unnumbered instrument is reopened as a whole document without inventing an article",async()=>{
  const {bucket,resolution}=await fixture();
  const key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  snapshot.documentTitle="Decision on filing requirements";
  snapshot.blocks=["The application must identify the requested record and include the applicant's correspondence address.",
    "The authority shall provide a written decision explaining the applicable filing requirements and any information still required from the applicant.","16 January 1998"]
    .map((text,index)=>({index,kind:"paragraph",text}));
  snapshot.plainText=snapshot.blocks.map((block:{text:string})=>block.text).join(" ");
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));
  bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:"16 January 1998",
    officialCitation:{label:"Decision — Article 16",url},
    evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  const documentContext=await createNormalizedDocumentEvidenceReader(bucket)(original);
  assert.ok(documentContext);
  const evidence=await corpusAnswerEvidence({resolution:{controlling:original,documentContext,
    materialCitation:documentContext.officialCitation},currentAt,endpoint:{kind:"timestamp",instant:"2020-01-01T00:00:00Z"}});
  assert.equal(evidence.text,snapshot.plainText);
  assert.equal(evidence.source.article,null);
  assert.equal(evidence.source.actTitle,snapshot.documentTitle);
  assert.equal(evidence.source.citationEvidenceReceipt!.kind,"normalized-document");
  const reopened=await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!);
  assert.equal(reopened.text,evidence.text);
  assert.equal(reopened.fullArticle,false);
  await assertAnswerEvidence({question:"Filing requirements?",locale:"en",mode:"fast",answerMode:"short",
    temporalScope:{kind:"timestamp",instant:"2020-01-01T00:00:00Z"},evidence:[evidence],unresolved:[]});
  await assert.rejects(corpusAnswerEvidence({resolution:{...resolution,documentContext},currentAt,
    endpoint:{kind:"timestamp",instant:"2020-01-01T00:00:00Z"}}));
  await assert.rejects(resolveCitationEvidence(bucket,{...evidence.source.citationEvidenceReceipt!,articleNumber:"16"}));
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)({...original,provisionText:"Absent fragment"}),null);
  for(const changed of [{...original,languageTag:"ru" as const},
    {...original,officialCitation:{...original.officialCitation,url:"https://lex.uz/docs/888"}},
    {...original,evidence:{...original.evidence,sourceNormalizedSha256:"f".repeat(64)}}]) {
    assert.equal(await createNormalizedDocumentEvidenceReader(bucket)(changed),null);
  }
  for(const last of ["Required particulars:","Very long operative text. ".repeat(3000)]) {
    const bounded={...snapshot,blocks:[...snapshot.blocks,{index:3,kind:"paragraph",text:last}]};
    const boundedBytes=new TextEncoder().encode(JSON.stringify(bounded));
    bucket.objects.set(key,{bytes:boundedBytes,customMetadata:{}});
    assert.equal(await createNormalizedDocumentEvidenceReader(bucket)({...original,
      evidence:{...original.evidence,sourceNormalizedSha256:hash(boundedBytes)}}),null);
  }
  snapshot.blocks.unshift({index:3,kind:"heading",semanticRole:"article",text:"Article 7. A numbered rule"});
  const numberedBytes=new TextEncoder().encode(JSON.stringify(snapshot));
  bucket.objects.set(key,{bytes:numberedBytes,customMetadata:{}});
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)({...original,
    evidence:{...original.evidence,sourceNormalizedSha256:hash(numberedBytes)}}),null,
  "An unavailable or ambiguous numbered article cannot fall back to a whole document");
  await assert.rejects(resolveCitationEvidence(bucket,{...evidence.source.citationEvidenceReceipt!,
    byteCount:numberedBytes.length,sha256:hash(numberedBytes)}),/CITATION_EVIDENCE_TEXT_MISMATCH/);
  await assert.rejects(resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!));
});
async function fixture() {
  const blocks = ["Article 7. Synthetic filing rule", "An applicant may request a record.",
    "The application must identify the requested record.", "Article 8. Other rule",
    "This unrelated provision concerns records retained by a different authority and is not part of the requested article."]
    .map((text,index)=>({index,kind:"paragraph",text}));
  const bytes = new TextEncoder().encode(JSON.stringify({schemaVersion:1,
    parser:{name:"parse5",version:"8.0.1",profile:"juro-legal-blocks-v1"},
    source:{sourceKind:"lex",locale:"en",canonicalId:"777",canonicalUrl:url,rawContentSha256:"a".repeat(64)},
    primarySelector:"lex-document",documentTitle:"Synthetic rules",blocks,
    plainText:blocks.map(block=>block.text).join(" ")}));
  const original = parseResolvedOfficialEvidence({legalInstrumentId:"instrument:one",officialExpressionId:"expression:one",
    textRevisionId:"revision:one",provisionConceptId:"concept:one",provisionRenditionId:"rendition:one",
    languageTag:"en",script:"Latn",textualAuthority:"controlling",provisionText:blocks[1]!.text,
    officialCitation:{label:"Synthetic rules — Article 7",url},
    evidence:{provisionRenditionId:"rendition:one",r2Key:"fragment",byteCount:100,
      sha256:"b".repeat(64),sourceNormalizedSha256:hash(bytes),schemaVersion:1}});
  const bucket = new MemoryEvidenceBucket();
  bucket.objects.set("corpus/normalized/revision:one.json",{bytes,customMetadata:{}});
  const articleContext = await createNormalizedArticleEvidenceReader(bucket)(original,"7");
  assert.ok(articleContext);
  return {bucket,resolution:{controlling:original,articleContext,materialCitation:original.officialCitation},
    currentSourceStatus:{pinnedTextSha256:"c".repeat(64),observation:{version:2 as const,officialUrl:url,
      observedAt:currentAt,current:true,normalizedTextSha256:"c".repeat(64),rawContentSha256:"a".repeat(64)}}};
}

test("middle-fragment retrieval delivers a complete article with an exactly reopenable receipt",async()=>{
  const {bucket,resolution,currentSourceStatus}=await fixture();
  const evidence=await corpusAnswerEvidence({resolution,currentSourceStatus,currentAt,endpoint:{kind:"current"}});
  assert.match(evidence.text,/must identify/);
  assert.doesNotMatch(evidence.text,/Article 8/);
  const reopened=await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!);
  assert.equal(reopened.text,evidence.text);
  await assertAnswerEvidence({question:"Request?",locale:"en",mode:"fast",answerMode:"short",
    temporalScope:{kind:"current"},evidence:[evidence],unresolved:[]});
});

test("missing article context and substituted parent identities cannot become answer evidence",async()=>{
  const {resolution,currentSourceStatus}=await fixture();
  await assert.rejects(corpusAnswerEvidence({resolution:{...resolution,articleContext:undefined},
    currentSourceStatus,currentAt,endpoint:{kind:"current"}}),/COMPLETE_ARTICLE_UNAVAILABLE/);
  await assert.rejects(corpusAnswerEvidence({resolution:{...resolution,articleContext:{...resolution.articleContext,
    officialCitation:{...resolution.articleContext.officialCitation,url:"https://lex.uz/docs/888"}}},
    currentSourceStatus,currentAt,endpoint:{kind:"current"}}),/ARTICLE_IDENTITY_MISMATCH/);
});

test("stale, changed and unavailable publisher observations withhold current-law evidence",async()=>{
  const {resolution,currentSourceStatus}=await fixture();
  for(const observation of [null,{...currentSourceStatus.observation,current:false},
    {...currentSourceStatus.observation,normalizedTextSha256:"d".repeat(64)},
    {...currentSourceStatus.observation,observedAt:"2026-09-20T09:00:00.000Z"}]) {
    await assert.rejects(corpusAnswerEvidence({resolution,currentSourceStatus:{...currentSourceStatus,observation},
      currentAt,endpoint:{kind:"current"}}),/CURRENT_SOURCE_UNCONFIRMED/);
  }
});

test("historical evidence preserves endpoint identity and does not require current-law observation",async()=>{
  const {resolution}=await fixture();
  const first=await corpusAnswerEvidence({resolution,currentAt,endpoint:{kind:"timestamp",instant:"2025-01-01T00:00:00Z"}});
  const second=await corpusAnswerEvidence({resolution,currentAt,endpoint:{kind:"timestamp",instant:"2024-01-01T00:00:00Z"}});
  assert.notEqual(first.source.id,second.source.id);
  assert.equal(first.source.status,"historical");
  assert.equal(first.source.citationEvidenceReceipt?.capability,"history");
  assert.equal(first.source.currentSourceStatus,undefined);
});

test("a numbered paragraph inside an authenticated article retains the parent article identity",async()=>{
  const {resolution,currentSourceStatus}=await fixture();
  const fragment="7. The application must identify the requested record.";
  const controlling={...resolution.controlling,provisionText:fragment};
  const articleContext={...resolution.articleContext,provisionText:`Article 7. Filing requirements ${fragment} The authority must respond.`};
  const evidence=await corpusAnswerEvidence({resolution:{...resolution,controlling,articleContext},currentSourceStatus,currentAt,endpoint:{kind:"current"}});
  assert.equal(evidence.source.article,"7");
  assert.equal(evidence.source.citationEvidenceReceipt?.kind,"normalized-article");
});

test("historical source evidence does not require a textual authority classification",async()=>{
  const {resolution,bucket}=await fixture();
  const original={...resolution.controlling,textualAuthority:"unknown" as const};
  const articleContext={...resolution.articleContext,textualAuthority:"unknown" as const};
  const evidence=await corpusAnswerEvidence({resolution:{...resolution,controlling:original,articleContext},
    currentAt,endpoint:{kind:"timestamp",instant:"2025-01-01T00:00:00Z"}});
  assert.equal(evidence.source.status,"historical");
  assert.equal(evidence.text,articleContext.provisionText);
  assert.equal(original.textualAuthority,"unknown");
  assert.equal((await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!)).text,evidence.text);
  await assert.rejects(corpusAnswerEvidence({resolution:{...resolution,controlling:original,articleContext:undefined},
    currentAt,endpoint:{kind:"timestamp",instant:"2025-01-01T00:00:00Z"}}),/COMPLETE_ARTICLE_UNAVAILABLE/);
});

test("different chunks of the same authenticated article share one evidence identity",async()=>{
  const {resolution,currentSourceStatus}=await fixture();
  const first=await corpusAnswerEvidence({resolution,currentSourceStatus,currentAt,endpoint:{kind:"current"}});
  const other=parseResolvedOfficialEvidence({...resolution.controlling,provisionRenditionId:"rendition:two",
    provisionConceptId:"concept:two",provisionText:"The application must identify the requested record.",
    evidence:{...resolution.controlling.evidence,provisionRenditionId:"rendition:two"}});
  const second=await corpusAnswerEvidence({resolution:{controlling:other,materialCitation:other.officialCitation,
    articleContext:{...other,provisionText:resolution.articleContext.provisionText,evidence:{...resolution.articleContext.evidence,
      provisionRenditionId:other.provisionRenditionId}}},currentSourceStatus,currentAt,endpoint:{kind:"current"}});
  assert.deepEqual(first,second);
});


test("incorrect imported article numbers recover only a unique complete parent article",async()=>{
  const {bucket,resolution}=await fixture();
  const original={...resolution.controlling,officialCitation:{url,label:"Synthetic rules — Article 2025"}};
  const reader=createNormalizedArticleEvidenceReader(bucket),articleContext=await reader(original,"2025");
  assert.ok(articleContext);
  const evidence=await corpusAnswerEvidence({resolution:{controlling:original,articleContext,materialCitation:articleContext.officialCitation},currentAt,endpoint:{kind:"timestamp",instant:currentAt}});
  assert.equal(evidence.source.article,"7");
  assert.equal((await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!)).text,evidence.text);
  assert.equal(await reader(original,"8"),null,"an existing but mismatching article number is not replaced");
  const key="corpus/normalized/revision:one.json",snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  snapshot.blocks.push({index:5,kind:"paragraph",text:"Article 9. "+original.provisionText});
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  assert.equal(await createNormalizedArticleEvidenceReader(bucket)({...original,evidence:{...original.evidence,sourceNormalizedSha256:hash(bytes)}},"2025"),null,"an incomplete duplicate must prevent false uniqueness");
});

test("imported chapter headings and annex adoption tails reopen complete source scopes",async()=>{
  const adoption="Oʻzbekiston Respublikasi Prezidentining 2025-yil 21-fevraldagi PF-26-son Farmoniga";
  for(const [texts,fragment] of [
    [["Instrument introduction.","1-боб. Rules","Article 7. Filing","The complete filing requirement applies.","2-боб. Other rules","Article 8. Other","The other rule applies."],"1-боб. Rules"],
    [["Instrument introduction.","1. Schedules are adopted.","An unrelated complete condition. ".repeat(2300),adoption+"\n1-ILOVA","The first complete schedule applies.",adoption+"\n2-ILOVA","The second complete schedule applies."],"The first complete schedule applies. "+adoption],
  ] as const){
    const {bucket,resolution}=await fixture(),key="corpus/normalized/revision:one.json";
    const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
    snapshot.blocks=texts.map((text,index)=>({index,kind:"paragraph",text}));
    const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
    const original={...resolution.controlling,provisionText:fragment,evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
    const documentContext=await createNormalizedDocumentEvidenceReader(bucket)(original);assert.ok(documentContext);
    const evidence=await corpusAnswerEvidence({resolution:{controlling:original,documentContext,materialCitation:documentContext.officialCitation},currentAt,endpoint:{kind:"timestamp",instant:currentAt}});
    assert.equal(evidence.source.article,null);
    assert.equal((await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!)).text,evidence.text);
    snapshot.blocks.push({index:99,kind:"paragraph",text:fragment});
    const duplicate=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes:duplicate,customMetadata:{}});
    assert.equal(await createNormalizedDocumentEvidenceReader(bucket)({...original,evidence:{...original.evidence,sourceNormalizedSha256:hash(duplicate)}}),null);
  }
});


test("an imported resolution introduction authenticates its entire bounded instrument without claiming an article",async()=>{
 const {bucket,resolution}=await fixture(),key="corpus/normalized/revision:one.json";
 const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
 const fragment="2022-yil adopted rules require clarification; the court qaror qiladi:";
 snapshot.blocks=["Resolution title",fragment,"1. The first complete rule applies. "+"Further complete conditions apply. ".repeat(2100),"2. The final rule applies."]
  .map((text,index)=>({index,kind:"paragraph",text}));
 const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
 const original={...resolution.controlling,provisionText:fragment,evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
 const documentContext=await createNormalizedDocumentEvidenceReader(bucket)(original);assert.ok(documentContext);
 const evidence=await corpusAnswerEvidence({resolution:{controlling:original,documentContext,materialCitation:documentContext.officialCitation},currentAt,endpoint:{kind:"timestamp",instant:currentAt}});
 assert.ok(evidence.text.length>64_000);assert.equal(evidence.source.article,null);
 assert.equal((await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!)).text,evidence.text);
 snapshot.blocks.push({index:4,kind:"paragraph",text:"Article 7. An incomplete statutory article"});
 const changed=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes:changed,customMetadata:{}});
 assert.equal(await createNormalizedDocumentEvidenceReader(bucket)({...original,evidence:{...original.evidence,sourceNormalizedSha256:hash(changed)}}),null);
});


test("an attached draft article retains its draft label and complete enclosing decision",async()=>{
  const {bucket,resolution}=await fixture();
  const key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  const fragment="Article 7. The proposed filing rule applies to written requests.";
  snapshot.documentTitle="Decision to submit a proposed law";
  snapshot.blocks=["The authority decides to submit the attached proposal.","Draft",fragment,
    "The proposal requires legislative adoption.","Article 8. Proposed commencement",
    "This proposed law would commence on publication."].map((text,index)=>({index,kind:"paragraph",text}));
  snapshot.plainText=snapshot.blocks.map((block:{text:string})=>block.text).join(" ");
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:fragment,
    evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  assert.equal(await createNormalizedArticleEvidenceReader(bucket)(original,"7"),null);
  const documentContext=await createNormalizedDocumentEvidenceReader(bucket)(original);assert.ok(documentContext);
  const evidence=await corpusAnswerEvidence({resolution:{controlling:original,documentContext,
    materialCitation:original.officialCitation},currentAt,endpoint:{kind:"timestamp",instant:"2020-01-01T00:00:00Z"}});
  assert.equal(evidence.text,snapshot.plainText);
  assert.equal(evidence.source.article,null);
  assert.equal(evidence.source.actTitle,snapshot.documentTitle);
  const reopened=await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!);
  assert.equal(reopened.text,evidence.text);assert.equal(reopened.fullArticle,false);
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)({...original,provisionText:"Absent fragment"}),null);
  snapshot.blocks.push({index:snapshot.blocks.length,kind:"paragraph",text:"Additional context. ".repeat(4000)});
  const oversizedBytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes:oversizedBytes,customMetadata:{}});
  const oversized={...original,evidence:{...original.evidence,sourceNormalizedSha256:hash(oversizedBytes)}};
  assert.equal(await createNormalizedArticleEvidenceReader(bucket)(oversized,"7"),null);
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)(oversized),null);

});


test("quoted replacement articles retain their enclosing amendment clause rather than absorbing later amendments",async()=>{
  const {bucket,resolution}=await fixture(),key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  const fragment="2. Replace the first part of Article 80: “The annual leave minimum is twenty-four working days”.";
  snapshot.documentTitle="Law amending the employment legislation";
  snapshot.blocks=["The following amendments are adopted:",
    "1. Articles 51-1 and 51-3 shall read:","“Article 51-1. Employment guarantees",
    "The employment guarantees apply.","Article 51-3. Compensation",
    "The compensation rule applies”.",fragment,"3. Repeal Article 90."]
    .map((text,index)=>({index,kind:"paragraph",text}));
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:fragment,evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  assert.equal(await createNormalizedArticleEvidenceReader(bucket)(original,"1992"),null);
  assert.equal(await createNormalizedArticleEvidenceReader(bucket)(original,"51-3"),null);
  const documentContext=await createNormalizedDocumentEvidenceReader(bucket)(original);assert.ok(documentContext);
  const evidence=await corpusAnswerEvidence({resolution:{controlling:original,documentContext,materialCitation:original.officialCitation},
    currentAt,endpoint:{kind:"timestamp",instant:currentAt}});
  assert.equal(evidence.source.article,null);
  assert.equal(evidence.text,"The following amendments are adopted: "+fragment);
  assert.equal((await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!)).text,evidence.text);
});


test("an inline unmatched quote does not suppress subsequent independent article headings",async()=>{
  const {bucket,resolution}=await fixture(),key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  snapshot.blocks=["Article 1. First rule","The first rule includes an unmatched “quotation.",
    "Article 2. Second rule","The second independent rule applies."]
    .map((text,index)=>({index,kind:"paragraph",text}));
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:snapshot.blocks[0].text,evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  const article=await createNormalizedArticleEvidenceReader(bucket)(original,"1");assert.ok(article);
  assert.equal(article.provisionText,snapshot.blocks.slice(0,2).map((block:{text:string})=>block.text).join(" "));
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)(original),null);
});


test("an unterminated quote cannot disguise article-bearing annexes as complete document scopes",async()=>{
  const {bucket,resolution}=await fixture(),key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  const fragment="The annex begins with an unmatched “quotation.";
  snapshot.blocks=["The law adopts the annex.","Article 1. Adoption","The complete adoption rule applies.",
    "Oʻzbekiston Respublikasi Qonuniga\n1-ILOVA",fragment,"Article 2. Annex rule","The annex rule applies."]
    .map((text,index)=>({index,kind:"paragraph",text}));
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:fragment,evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)(original),null);
});


test("an unterminated replacement-article quotation remains unavailable",async()=>{
  const {bucket,resolution}=await fixture(),key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  const fragment="The replacement rule applies.";
  snapshot.blocks=["Article 1. Amendments","The following articles replace the former provisions:",
    "“Article 2. Replacement",fragment,"Article 3. Another rule","Its body cannot establish where the quotation ends."]
    .map((text,index)=>({index,kind:"paragraph",text}));
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:fragment,evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  assert.equal(await createNormalizedArticleEvidenceReader(bucket)(original,"1"),null);
  assert.equal(await createNormalizedArticleEvidenceReader(bucket)(original,"2"),null);
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)(original),null);
});


test("replacement-article quotations may begin after their amendment instruction in the same block",async()=>{
  const {bucket,resolution}=await fixture(),key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  const fragment="Article 3. Second replacement";
  snapshot.blocks=["Article 1. Amendments","Replace the following articles: “Article 2. First replacement",
    "The first replacement body applies.",fragment,"The second replacement body applies”.","Article 4. Commencement","The act takes effect on publication."]
    .map((text,index)=>({index,kind:"paragraph",text}));
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:fragment,evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  const context=await createNormalizedArticleEvidenceReader(bucket)(original,"3");assert.ok(context);
  assert.match(context.officialCitation.label,/Article 1$/u);
  assert.equal(context.provisionText,snapshot.blocks.slice(0,5).map((block:{text:string})=>block.text).join(" "));
});


test("successive replacement quotations in one block retain their enclosing article",async()=>{
  const {bucket,resolution}=await fixture(),key="corpus/normalized/revision:one.json";
  const snapshot=JSON.parse(new TextDecoder().decode(bucket.objects.get(key)!.bytes));
  const fragment="Article 4. Second continued replacement";
  snapshot.blocks=["Article 1. Amendments",
    "Replace Article 2 with “Article 2. Complete replacement.”; replace Articles 3–4 with “Article 3. Continued replacement",
    "The first continued replacement applies.",fragment,"The second continued replacement applies”.",
    "Article 5. Commencement","The act takes effect on publication."]
    .map((text,index)=>({index,kind:"paragraph",text}));
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot));bucket.objects.set(key,{bytes,customMetadata:{}});
  const original={...resolution.controlling,provisionText:fragment,evidence:{...resolution.controlling.evidence,sourceNormalizedSha256:hash(bytes)}};
  const context=await createNormalizedArticleEvidenceReader(bucket)(original,"4");assert.ok(context);
  assert.match(context.officialCitation.label,/Article 1$/u);
  assert.equal(context.provisionText,snapshot.blocks.slice(0,5).map((block:{text:string})=>block.text).join(" "));
});
