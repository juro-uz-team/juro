import { createCompleteArticleReader } from "../legal/article-context";
import {createNormalizedSourceReader, type NormalizedSourceReader} from "./normalized-source-reader";
import type { LegalEvidenceBucket, ResolvedOfficialEvidence } from "./target-evidence";

/** Request-local recovery from the exact accepted parent snapshot. No lookup
 * result or live page can replace the parent hash anchored by the rendition. */
export function createNormalizedArticleEvidenceReader(bucket: Pick<LegalEvidenceBucket, "get">,
  readParent: NormalizedSourceReader = createNormalizedSourceReader(bucket)) {
  const articles = new WeakMap<object, ReturnType<typeof createCompleteArticleReader>>();
  return async (original: ResolvedOfficialEvidence, article: string,
    sourceRevisionId: string = original.textRevisionId): Promise<ResolvedOfficialEvidence | null> => {
    const parent = await readParent(sourceRevisionId, original.evidence.sourceNormalizedSha256).catch(() => null);
    if (!parent || parent.snapshot.source.sourceKind !== "lex"
      || parent.snapshot.source.canonicalUrl !== original.officialCitation.url
      || ({ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"} as const)[parent.snapshot.source.locale] !== original.languageTag) return null;
    let readArticle = articles.get(parent);
    if (!readArticle) {readArticle = createCompleteArticleReader(parent.snapshot.blocks); articles.set(parent, readArticle);}
    const context = readArticle(article);
    const originalText = original.provisionText.replace(/\s+/gu, " ").trim();
    // A discovered provision can be a middle fragment. Its exact content must
    // occur in this uniquely identified article of the authenticated parent;
    // requiring a prefix loses earlier scope and later exceptions.
    if (!context || !originalText || !context.text.includes(originalText)) return null;
    console.info(JSON.stringify({event: "legal.article_context_resolved",
      originalCharacters: original.provisionText.length, contextCharacters: context.text.length}));
    return {...original, provisionText: context.text, evidence: {...original.evidence,
      r2Key: parent.r2Key, byteCount: parent.byteCount, sha256: parent.sha256}};
  };
}
