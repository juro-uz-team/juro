import { detectArticleNumbers } from "./legal-language";
import { MAX_LEGAL_EVIDENCE_CHARACTERS } from "./legal-evidence-budget";
import type { NormalizedLegalSourceSnapshot } from "./source-parser";
import {isLegalArticleHeading,hasInlineArticleBody,isLegalAnnexHeading} from "./article-heading";

const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Some official decisions have no numbered articles. Keep their full source
 * distinct from article extraction; a failed article lookup is not permission
 * to replace a numbered instrument with arbitrary surrounding text. */
export function completeUnnumberedDocumentText(snapshot: NormalizedLegalSourceSnapshot): string | null {
  if (snapshot.blocks.some(block => block.semanticRole === "article" || isLegalArticleHeading(block))) return null;
  return completeDocumentText(snapshot);
}

/** Whole-instrument evidence retains every block and makes no article claim. */
export function completeDocumentText(snapshot: NormalizedLegalSourceSnapshot): string | null {
  if (snapshot.blocks.length < 2) return null;
  const text = normalize(snapshot.blocks.map(block => block.text).join(" "));
  return !text || text.length > MAX_LEGAL_EVIDENCE_CHARACTERS || /:\s*$/u.test(text) ? null : text;
}

/** Imported publication footers can carry spurious article numbers. Accept only
 * complete, recognizable publication metadata, never a normative fragment. */
export function isPublicationMetadataText(text: string): boolean {
  const value = normalize(text);
  const russian = /^(?:[1-9]|[12]\d|3[01]) (?:января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря) \d{4} г\.,? № [\p{L}\d-]+\.?$/u;
  const month = "(?:yanvar|fevral|mart|aprel|may|iyun|iyul|avgust|sentabr|sentyabr|oktabr|oktyabr|noyabr|dekabr)";
  const date = `\\d{4}-yil (?:[1-9]|[12]\\d|3[01])-${month}da`;
  return russian.test(value) || new RegExp(`^${date} qabul qilingan Senat tomonidan ${date} ma[ʼ‘’ʻ']qullangan\\.?$`, "u").test(value);
}

/** Extract an unambiguous article without mistaking numbered list items for
 * article boundaries. The caller authenticates the snapshot and its identity. */
export function completeArticleText(
  blocks: NormalizedLegalSourceSnapshot["blocks"],
  article: string,
  originalText?: string,
): { heading: string; text: string } | null {
  return createCompleteArticleReader(blocks)(article, originalText);
}

/** Capture one authenticated parent's article boundaries once. The returned
 * reader owns its text references; later caller mutation cannot stale the index. */
export function createCompleteArticleReader(blocks: NormalizedLegalSourceSnapshot["blocks"]) {
  const index = createCompleteArticleIndex(blocks);
  return (article: string, originalText?: string): {heading: string; text: string} | null => {
    const {candidates, occurrences} = index(article);
    if (occurrences !== 1 || candidates.length !== 1) return null;
    const context = candidates[0]!;
    if (originalText && (!context.text.startsWith(normalize(originalText))
      || context.text.length <= normalize(originalText).length)) return null;
    return context;
  };
}

/** An enacting law and its annex can reuse article numbers. Keep every complete
 * occurrence; callers must resolve one using authenticated text, never order. */
export function createCompleteArticleIndex(blocks: NormalizedLegalSourceSnapshot["blocks"]) {
  const captured = blocks.map(block => ({text: block.text, kind:block.kind, semanticRole: block.semanticRole}));
  const ranges = new Map<string, {start: number; end: number}[]>();
  let nextBoundary = captured.length;
  for (let index = captured.length - 1; index >= 0; index--) {
    const block = captured[index]!;
    if (isLegalArticleHeading(block)) {
      const article = detectArticleNumbers(block.text)[0];
      if (article !== undefined) {
        const occurrences = ranges.get(article) ?? [];
        occurrences.unshift({start: index, end: nextBoundary});
        ranges.set(article, occurrences);
      }
      nextBoundary = index;
    } else if (block.semanticRole === "chapter" || block.semanticRole === "section" || isLegalAnnexHeading(block)) nextBoundary = index;
  }
  const read = (article: string) => {
    const occurrences = ranges.get(article) ?? [];
    const candidates = occurrences.flatMap(({start, end}) => {
      if (end - start < 2 && !hasInlineArticleBody(captured[start]!)) return [];
      const text = normalize(captured.slice(start, end).map(block => block.text).join(" "));
      if (text.length > MAX_LEGAL_EVIDENCE_CHARACTERS || /:\s*$/u.test(text)) return [];
      return [{heading: captured[start]!.text.slice(0, 240), text}];
    });
    return {occurrences: occurrences.length, candidates};
  };
  return Object.assign(read, {containing(fragment:string) {
    const source=normalize(captured.map(block=>block.text).join(" "));
    const first=source.indexOf(fragment);
    if(!fragment||first<0||source.indexOf(fragment,first+1)>=0)return [];
    return [...ranges.keys()].flatMap(article=>{
      const result=read(article);
      return result.candidates.length===result.occurrences
        ?result.candidates.filter(candidate=>candidate.text.includes(fragment)).map(candidate=>({...candidate,article})):[];
    });
  }});
}
