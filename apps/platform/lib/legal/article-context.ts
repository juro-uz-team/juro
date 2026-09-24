import { detectArticleNumbers } from "./legal-language";
import { MAX_LEGAL_EVIDENCE_CHARACTERS } from "./legal-evidence-budget";
import type { NormalizedLegalSourceSnapshot } from "./source-parser";
import {isLegalArticleHeading} from "./article-heading";

const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Some official decisions have no numbered articles. Keep their full source
 * distinct from article extraction; a failed article lookup is not permission
 * to replace a numbered instrument with arbitrary surrounding text. */
export function completeUnnumberedDocumentText(snapshot: NormalizedLegalSourceSnapshot): string | null {
  if (snapshot.blocks.some(block => block.semanticRole === "article" || isLegalArticleHeading(block))) return null;
  if (snapshot.blocks.length < 2) return null;
  const text = normalize(snapshot.blocks.map(block => block.text).join(" "));
  return !text || text.length > MAX_LEGAL_EVIDENCE_CHARACTERS || /:\s*$/u.test(text) ? null : text;
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
  const captured = blocks.map(block => ({text: block.text, kind:block.kind, semanticRole: block.semanticRole}));
  const ranges = new Map<string, {start: number; end: number} | null>();
  let nextBoundary = captured.length;
  for (let index = captured.length - 1; index >= 0; index--) {
    const block = captured[index]!;
    if (isLegalArticleHeading(block)) {
      const article = detectArticleNumbers(block.text)[0];
      if (article !== undefined) ranges.set(article, ranges.has(article) ? null : {start: index, end: nextBoundary});
      nextBoundary = index;
    } else if (block.semanticRole === "chapter" || block.semanticRole === "section") nextBoundary = index;
  }
  return (article: string, originalText?: string): {heading: string; text: string} | null => {
  const range = ranges.get(article);
  if (!range) return null;
  const {start, end} = range;
  if (end - start < 2) return null;
  const text = normalize(captured.slice(start, end).map(block => block.text).join(" "));
  if (text.length > MAX_LEGAL_EVIDENCE_CHARACTERS || /:\s*$/u.test(text)) return null;
  if (originalText && (!text.startsWith(normalize(originalText))
    || text.length <= normalize(originalText).length)) return null;
  return { heading: captured[start]!.text.slice(0, 240), text };
  };
}
