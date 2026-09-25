import { createCompleteArticleIndex, completeUnnumberedDocumentText, completeDocumentText, completeResolutionIntroductionContext, isPublicationMetadataText, isDraftContextFragment } from "../legal/article-context";
import {createNormalizedSourceReader, type NormalizedSourceReader} from "./normalized-source-reader";
import type { LegalEvidenceBucket, ResolvedOfficialEvidence } from "./target-evidence";
import {importedSourceContexts} from "../legal/imported-source-context";
import {documentSections} from "../legal/document-sections";

export function createNormalizedDocumentEvidenceReader(bucket: Pick<LegalEvidenceBucket, "get">,
  readParent: NormalizedSourceReader = createNormalizedSourceReader(bucket)) {
  return async (original: ResolvedOfficialEvidence,
    sourceRevisionId: string = original.textRevisionId): Promise<ResolvedOfficialEvidence | null> => {
    const parent = await readParent(sourceRevisionId, original.evidence.sourceNormalizedSha256).catch(() => null);
    if (!parent || parent.snapshot.source.sourceKind !== "lex"
      || parent.snapshot.source.canonicalUrl !== original.officialCitation.url
      || ({ru:"ru",uz:"uz-Latn",uzc:"uz-Cyrl",en:"en"} as const)[parent.snapshot.source.locale] !== original.languageTag) return null;
    const fragment = original.provisionText.replace(/\s+/gu," ").trim();
    const draft=isDraftContextFragment(parent.snapshot,fragment);
    let text = (isPublicationMetadataText(fragment)||draft)
      ? completeDocumentText(parent.snapshot) : completeUnnumberedDocumentText(parent.snapshot);
    if(draft&&!text)return null;
    if(!text)text=completeResolutionIntroductionContext(parent.snapshot,fragment);
    let section=false;
    if(!text && fragment){
      const source=parent.snapshot.blocks.map(block=>block.text).join(" ").replace(/\s+/gu," ").trim();
      const sections=documentSections(parent.snapshot);
      const matches=sections.filter(context=>context.text.includes(fragment));
      const reconstructed=matches.length===1&&matches[0]!.complete&&matches[0]!.text===fragment;
      const first=source.indexOf(fragment);
      if(first<0?!reconstructed:source.indexOf(fragment,first+1)>=0)return null;
      if(matches.length){
        if(matches.length!==1||!matches[0]!.complete)return null;
        text=matches[0]!.text;section=true;
      }
    }
    if(!text && fragment){
      const matches=importedSourceContexts(parent.snapshot).filter(context=>
        (!context.headingOnly||context.headingOnly===fragment)&&context.text.includes(fragment));
      if(matches.length===1){text=matches[0]!.text;section=true;}
    }
    if (!text || !fragment || !text.includes(fragment)) return null;
    return {...original, provisionText:text,
      officialCitation:{url:original.officialCitation.url,label:parent.snapshot.documentTitle},
      evidence:{...original.evidence,r2Key:parent.r2Key,byteCount:parent.byteCount,sha256:parent.sha256,
        ...(section?{normalizedScope:"section" as const}:{})}};
  };
}

const articleIndexes = new WeakMap<object, ReturnType<typeof createCompleteArticleIndex>>();

/** Request-local recovery from the exact accepted parent snapshot. No lookup
 * result or live page can replace the parent hash anchored by the rendition. */
export function createNormalizedArticleEvidenceReader(bucket: Pick<LegalEvidenceBucket, "get">,
  readParent: NormalizedSourceReader = createNormalizedSourceReader(bucket)) {
  return async (original: ResolvedOfficialEvidence, article: string,
    sourceRevisionId: string = original.textRevisionId): Promise<ResolvedOfficialEvidence | null> => {
    const parent = await readParent(sourceRevisionId, original.evidence.sourceNormalizedSha256).catch(() => null);
    if (!parent || parent.snapshot.source.sourceKind !== "lex"
      || parent.snapshot.source.canonicalUrl !== original.officialCitation.url
      || ({ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"} as const)[parent.snapshot.source.locale] !== original.languageTag) return null;
    let readArticle = articleIndexes.get(parent.snapshot);
    if (!readArticle) {readArticle = createCompleteArticleIndex(parent.snapshot.blocks); articleIndexes.set(parent.snapshot, readArticle);}
    const originalText = original.provisionText.replace(/\s+/gu, " ").trim();
    // A discovered provision can be a middle fragment. Its exact content must
    // occur in this uniquely identified article of the authenticated parent;
    // requiring a prefix loses earlier scope and later exceptions.
    if (!originalText||isDraftContextFragment(parent.snapshot,originalText)) return null;
    const {candidates, occurrences} = readArticle(article);
    // Imported headings sometimes used a year as an article number. Resolve
    // only a unique complete article from the same authenticated parent when
    // that claimed number has no article occurrence at all.
    if(occurrences===0){
      const matches=readArticle.containing(originalText);
      if(matches.length!==1)return null;
      const context=matches[0]!;
      return {...original,provisionText:context.text,
        officialCitation:{url:original.officialCitation.url,label:`${parent.snapshot.documentTitle} — Article ${context.article}`},
        evidence:{...original.evidence,r2Key:parent.r2Key,byteCount:parent.byteCount,sha256:parent.sha256}};
    }
    if (candidates.length !== occurrences) return null;
    const matches = candidates.filter(context => context.text.includes(originalText));
    if (matches.length !== 1) return null;
    const context = matches[0]!;
    console.info(JSON.stringify({event: "legal.article_context_resolved",
      originalCharacters: original.provisionText.length, contextCharacters: context.text.length}));
    return {...original, provisionText: context.text, evidence: {...original.evidence,
      r2Key: parent.r2Key, byteCount: parent.byteCount, sha256: parent.sha256}};
  };
}
