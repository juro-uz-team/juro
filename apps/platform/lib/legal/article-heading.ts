const PREFIX = /^(?:(?:статья|модда|modda|article)\s+\d+(?:[.-]\d+)?|\d+(?:[.-]\d+)?\s*(?:-\s*)?(?:modda|модда)(?!\p{L}))/iu;
const REFERENCE_PROSE = /^статья\s+\d+(?:[.-]\d+)?[⁰¹²³⁴⁵⁶⁷⁸⁹]*\s+(?:(?:ГК|УК|НК|УПК|ГПК|ЭПК)(?:\s+РУз)?|(?:\p{L}+\s+){0,6}(?:кодекса|закона|конституции)(?:\s+Республики\s+Узбекистан)?)\s+(?:предусматривает|устанавливает|установила|определяет|регулирует|содержит|гласит|носит|провозглашает)(?!\p{L})/iu;

/** Retained sources include punctuationless paragraph headings. Preserve those
 * boundaries unless the text explicitly cites another enactment and predicates
 * what that article provides. Publisher heading metadata remains authoritative. */
export function isLegalArticleHeading(block: {text:string;kind?:string;semanticRole?:string}): boolean {
  const text=block.text.trim();
  return PREFIX.test(text) && (block.semanticRole==="article" || block.kind==="heading" || !REFERENCE_PROSE.test(text));
}
