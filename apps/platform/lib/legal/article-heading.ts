const PREFIX = /^(?:(?:статья|модда|modda|article)\s+\d+(?:[.-]\d+)?[⁰¹²³⁴⁵⁶⁷⁸⁹]*|\d+(?:[.-]\d+)?[⁰¹²³⁴⁵⁶⁷⁸⁹]*\s*(?:-\s*)?(?:modda|модда)(?!\p{L}))/iu;
const REFERENCE_PROSE = /^статья\s+\d+(?:[.-]\d+)?[⁰¹²³⁴⁵⁶⁷⁸⁹]*\s+(?:(?:ГК|УК|НК|УПК|ГПК|ЭПК)(?:\s+РУз)?|(?:\p{L}+\s+){0,6}(?:кодекса|закона|конституции)(?:\s+Республики\s+Узбекистан)?)\s+(?:предусматривает|устанавливает|установила|определяет|регулирует|содержит|гласит|носит|провозглашает)(?!\p{L})/iu;

/** Retained sources include punctuationless paragraph headings. Preserve those
 * boundaries unless the text explicitly cites another enactment and predicates
 * what that article provides. Publisher heading metadata remains authoritative. */
export function isLegalArticleHeading(block: {text:string;kind?:string;semanticRole?:string}): boolean {
  const text=block.text.trim();
  return PREFIX.test(text) && (block.semanticRole==="article" || block.kind==="heading" || !REFERENCE_PROSE.test(text));
}

/** Some amending laws put the article label and its entire operative sentence
 * in one publisher paragraph. A title alone cannot establish completeness. */
export function hasInlineArticleBody(block: {text:string;kind?:string}): boolean {
  if(block.kind!=="paragraph")return false;
  const prefix=block.text.trim().match(PREFIX);
  if(!prefix)return false;
  const body=block.text.trim().slice(prefix[0].length).replace(/^\s*[.:—-]\s*/u,"").trim();
  if(!body.endsWith("."))return false;
  return /^Внести\s+в\s+.+\s+(?:изменения|дополнения)(?!\p{L})/iu.test(body)
    || /(?:^|\s)(?:алмаштирилсин|кучга киради|almashtirilsin|kuchga kiradi)\.$/iu.test(body);
}
