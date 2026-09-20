import { detectArticleNumbers } from "./legal-language";
import { MAX_LEGAL_EVIDENCE_CHARACTERS } from "./legal-evidence-budget";
import type { NormalizedLegalSourceSnapshot } from "./source-parser";

const ARTICLE_HEADING = /^(?:(?:статья|модда|modda|article)\s+\d+(?:[.-]\d+)?|\d+(?:[.-]\d+)?\s*(?:-\s*)?(?:modda|модда)(?!\p{L}))/iu;
const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();

/** Extract an unambiguous article without mistaking numbered list items for
 * article boundaries. The caller authenticates the snapshot and its identity. */
export function completeArticleText(
  blocks: NormalizedLegalSourceSnapshot["blocks"],
  article: string,
  originalText?: string,
): { heading: string; text: string } | null {
  const starts = blocks.flatMap((block, index) => ARTICLE_HEADING.test(block.text.trim())
    && detectArticleNumbers(block.text)[0] === article ? [index] : []);
  if (starts.length !== 1) return null;
  const start = starts[0]!;
  let end = start + 1;
  while (end < blocks.length && !ARTICLE_HEADING.test(blocks[end]!.text.trim())
    && blocks[end]!.semanticRole !== "chapter" && blocks[end]!.semanticRole !== "section") end++;
  if (end - start < 2) return null;
  const text = normalize(blocks.slice(start, end).map(block => block.text).join(" "));
  if (text.length > MAX_LEGAL_EVIDENCE_CHARACTERS || /:\s*$/u.test(text)) return null;
  if (originalText && (!text.startsWith(normalize(originalText))
    || text.length <= normalize(originalText).length)) return null;
  return { heading: blocks[start]!.text.slice(0, 240), text };
}
