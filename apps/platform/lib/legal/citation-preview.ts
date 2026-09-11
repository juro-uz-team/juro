type CitationPreviewSource = {
  article?: string | null;
  excerpt?: string | null;
  spans?: readonly {article?: string | null; text: string}[];
};

const articleLabel = (value: string | null | undefined) => value?.replace(/\s+/gu, " ").trim().slice(0, 240) || null;

/** Bind display metadata to the same verified provision used by the gateway.
 * A document can contain several articles; its first ranked article does not
 * identify every claim supported by that document. */
export function citationPreview(source: CitationPreviewSource, referenceArticle: string | null | undefined) {
  const article = articleLabel(referenceArticle ?? source.article);
  const span = source.spans?.find(candidate => articleLabel(candidate.article) === article);
  if (article && !span && (source.spans?.length || articleLabel(source.article) !== article)) {
    throw new Error("CITATION_ARTICLE_MISMATCH");
  }
  return {article, excerpt: (span?.text ?? source.excerpt)?.slice(0, 1_200) ?? null};
}
