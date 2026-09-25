import { createCompleteArticleIndex, completeUnnumberedDocumentText, completeDocumentText, completeResolutionIntroductionContext, isPublicationMetadataText } from "../legal/article-context";
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
    let text = isPublicationMetadataText(fragment)
      ? completeDocumentText(parent.snapshot) : completeUnnumberedDocumentText(parent.snapshot);
    if(!text)text=completeResolutionIntroductionContext(parent.snapshot,fragment);
    let section=false;
    if(!text && fragment){
      const source=parent.snapshot.blocks.map(block=>block.text).join(" ").replace(/\s+/gu," ").trim();
      const first=source.indexOf(fragment);
      if(first<0||source.indexOf(fragment,first+1)>=0)return null;
      const matches=documentSections(parent.snapshot).filter(context=>context.text.includes(fragment));
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

/** Request-local recovery from the exact accepted parent snapshot. No lookup
 * result or live page can replace the parent hash anchored by the rendition. */
export function createNormalizedArticleEvidenceReader(bucket: Pick<LegalEvidenceBucket, "get">,
  readParent: NormalizedSourceReader = createNormalizedSourceReader(bucket)) {
  const articles = new WeakMap<object, ReturnType<typeof createCompleteArticleIndex>>();
  return async (original: ResolvedOfficialEvidence, article: string,
    sourceRevisionId: string = original.textRevisionId): Promise<ResolvedOfficialEvidence | null> => {
    const parent = await readParent(sourceRevisionId, original.evidence.sourceNormalizedSha256).catch(() => null);
    if (!parent || parent.snapshot.source.sourceKind !== "lex"
      || parent.snapshot.source.canonicalUrl !== original.officialCitation.url
      || ({ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"} as const)[parent.snapshot.source.locale] !== original.languageTag) return null;
    let readArticle = articles.get(parent);
    if (!readArticle) {readArticle = createCompleteArticleIndex(parent.snapshot.blocks); articles.set(parent, readArticle);}
    const originalText = original.provisionText.replace(/\s+/gu, " ").trim();
    // A discovered provision can be a middle fragment. Its exact content must
    // occur in this uniquely identified article of the authenticated parent;
    // requiring a prefix loses earlier scope and later exceptions.
    if (!originalText) return null;
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
