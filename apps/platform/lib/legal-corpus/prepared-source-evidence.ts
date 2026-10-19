import {createHash} from "node:crypto";
import {createCompleteArticleIndex,isDraftContextFragment} from "../legal/article-context";
import {classifyLegalSourceUrl} from "../legal/source-fetch";
import {sameInstrumentArticleReferences} from "../legal/referenced-article-context";
import {createNormalizedDocumentEvidenceReader} from "./normalized-article-evidence";
import {parseResolvedOfficialEvidence,parseControllingEvidenceResolution,type LegalEvidenceBucket} from "./target-evidence";
import type {capturePreparedSource} from "./prepared-source-capture";

const hash=(text:string)=>createHash("sha256").update(text).digest("hex");
const normalized=(text:string)=>text.replace(/\s+/gu," ").trim();

/** Join authenticated discovery text to a separately captured, durable parent.
 * The caller must authenticate package membership before calling this boundary.
 * It returns complete evidence, never treating a publisher locator as an article.
 * Currentness is still admitted by prepareCorpusEvidence.finalize. Historical
 * admission requires a separate applicability proof and is not inferred here.
 */
export async function resolvePreparedSourceEvidence(input:{
  capture:Awaited<ReturnType<typeof capturePreparedSource>>;
  discovery:{officialUrl:string;text:string;textSha256:string;languageTag:"ru"|"uz-Latn"|"uz-Cyrl"|"en"};
  bucket:Pick<LegalEvidenceBucket,"get">;
}){
  const {capture,discovery}=input;
  if(hash(discovery.text)!==discovery.textSha256)throw Error("PREPARED_DISCOVERY_TEXT_MISMATCH");
  const reference=classifyLegalSourceUrl(discovery.officialUrl);
  const snapshot=capture.parent.snapshot;
  const languageTag=({ru:"ru",uz:"uz-Latn",uzc:"uz-Cyrl",en:"en"} as const)[snapshot.source.locale];
  if(reference.canonicalUrl!==snapshot.source.canonicalUrl||discovery.languageTag!==languageTag){
    throw Error("PREPARED_DISCOVERY_SOURCE_MISMATCH");
  }
  if(reference.revisionDate||!capture.observation)throw Error("PREPARED_HISTORICAL_APPLICABILITY_REQUIRED");
  const fragment=normalized(discovery.text);
  const source=normalized(snapshot.blocks.map(block=>block.text).join(" "));
  const first=source.indexOf(fragment);
  if(!fragment||first<0)throw Error("PREPARED_DISCOVERY_SPAN_STALE");
  if(source.indexOf(fragment,first+1)>=0||isDraftContextFragment(snapshot,fragment)){
    throw Error("PREPARED_DISCOVERY_SPAN_AMBIGUOUS");
  }
  const articles=createCompleteArticleIndex(snapshot.blocks).containing(fragment);
  if(articles.length>1)throw Error("PREPARED_DISCOVERY_SPAN_AMBIGUOUS");
  const article=articles[0];
  // Source-local identities make no unsupported equivalence claim between
  // languages, editions or different publisher documents.
  const document=hash(JSON.stringify([snapshot.source.canonicalUrl,languageTag]));
  const rendition=hash(JSON.stringify([capture.parent.sha256,discovery.textSha256]));
  const original=parseResolvedOfficialEvidence({
    legalInstrumentId:`prepared-source:${document}`,officialExpressionId:`prepared-expression:${document}`,
    textRevisionId:capture.revisionId,provisionConceptId:`prepared-span:${rendition}`,
    provisionRenditionId:`prepared-rendition:${rendition}`,languageTag,
    script:languageTag==="ru"||languageTag==="uz-Cyrl"?"Cyrl":"Latn",textualAuthority:"unknown",
    provisionText:fragment,officialCitation:{url:snapshot.source.canonicalUrl,
      label:article?`${snapshot.documentTitle} — Article ${article.article}`:snapshot.documentTitle},
    evidence:{provisionRenditionId:`prepared-rendition:${rendition}`,r2Key:capture.parent.r2Key,
      byteCount:capture.parent.byteCount,sha256:capture.parent.sha256,sourceNormalizedSha256:capture.parent.sha256,
      sourceRevisionId:capture.revisionId,schemaVersion:1,store:capture.store},
  });
  const complete=article?{...original,provisionText:article.text}:
    await createNormalizedDocumentEvidenceReader(input.bucket)(original,capture.revisionId);
  if(!complete)throw Error("PREPARED_COMPLETE_CONTEXT_UNAVAILABLE");
  return {resolution:parseControllingEvidenceResolution({controlling:original,
    ...(article?{articleContext:complete}:{documentContext:complete}),materialCitation:complete.officialCitation}),
    correspondence:{discoveryTextSha256:discovery.textSha256,sourceNormalizedSha256:capture.parent.sha256,
      sourceRevisionId:capture.revisionId,transform:"collapse-whitespace-v1" as const}};
}

/** Bounded same-source reference expansion. References are extracted from the
 * already recovered complete rule, and resolved only in that captured parent.
 * The runtime must count these reads against its reserved reference budget.
 */
export async function resolvePreparedSourceReferences(input:{
  capture:Awaited<ReturnType<typeof capturePreparedSource>>;
  source:Awaited<ReturnType<typeof resolvePreparedSourceEvidence>>;
  bucket:Pick<LegalEvidenceBucket,"get">;
  limit?:number;
}){
  const limit=input.limit??3;
  if(!Number.isSafeInteger(limit)||limit<0||limit>3)throw Error("PREPARED_REFERENCE_BUDGET_INVALID");
  const original=input.source.resolution.controlling;
  const {capture}=input;
  if(original.evidence.sourceNormalizedSha256!==capture.parent.sha256
    ||original.textRevisionId!==capture.revisionId||original.officialCitation.url!==capture.parent.snapshot.source.canonicalUrl
    ||original.evidence.store?.namespace!==capture.store.namespace||original.evidence.store?.generationSha256!==capture.store.generationSha256){
    throw Error("PREPARED_REFERENCE_SOURCE_MISMATCH");
  }
  const complete=input.source.resolution.articleContext??input.source.resolution.documentContext;
  if(!complete)throw Error("PREPARED_COMPLETE_CONTEXT_UNAVAILABLE");
  const references=sameInstrumentArticleReferences(complete.provisionText);
  const index=createCompleteArticleIndex(capture.parent.snapshot.blocks);
  const resolved:Array<{article:string;source:Awaited<ReturnType<typeof resolvePreparedSourceEvidence>>}>=[];
  const unresolved:Array<{article:string;reason:"lookup_budget"|"reference_not_found"|"reference_ambiguous"}>=[];
  for(const [position,article] of references.entries()){
    if(position>=limit){unresolved.push({article,reason:"lookup_budget"});continue;}
    const found=index(article);
    if(found.occurrences!==1||found.candidates.length!==1){
      unresolved.push({article,reason:found.occurrences>1?"reference_ambiguous":"reference_not_found"});continue;
    }
    const text=found.candidates[0]!.text;
    const source=await resolvePreparedSourceEvidence({capture,bucket:input.bucket,
      discovery:{officialUrl:original.officialCitation.url,languageTag:original.languageTag,text,textSha256:hash(text)}});
    resolved.push({article,source});
  }
  return {resolved,unresolved};
}
