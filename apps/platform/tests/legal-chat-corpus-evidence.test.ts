import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {corpusAnswerEvidence} from "../lib/legal-chat/corpus-evidence";
import {parseResolvedOfficialEvidence} from "../lib/legal-corpus/target-evidence";
import {createNormalizedArticleEvidenceReader} from "../lib/legal-corpus/normalized-article-evidence";
import {resolveCitationEvidence} from "../lib/legal-corpus/citation-evidence";
import {assertAnswerEvidence} from "../lib/legal-chat/evidence-boundary";
import {MemoryEvidenceBucket} from "./helpers/legal-target";

const currentAt = "2026-09-20T10:00:00.000Z";
const url = "https://lex.uz/docs/777";
const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
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
