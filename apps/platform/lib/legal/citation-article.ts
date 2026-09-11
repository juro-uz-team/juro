/** Use the authenticated citation label, never the first cross-reference in
 * the body. Legacy list-item labels cannot establish article precision. */
export function citationArticleNumber(label: string, quotation: string): string | null {
  const article = label.match(/(?:article|статья|ст\.?|modda|модда)\s*(\d+(?:[.-]\d+)?)/iu)?.[1] ?? null;
  const itemNumber = quotation.match(/^\s*(\d+(?:[.-]\d+)?)[).]\s/u)?.[1];
  return itemNumber && itemNumber === article ? null : article;
}
