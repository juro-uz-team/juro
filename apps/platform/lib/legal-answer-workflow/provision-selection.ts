import { articleNumberFromHeading, normalizedArticleRange, readNormalizedSnapshot } from "./normalized-document";
import type { normalizePublisherHtml } from "./publisher-html";

/** An unanchored operative reference requires the complete document, including every extraction gap. */
export function selectPublisherDocument(document: ReturnType<typeof normalizePublisherHtml>) {
  if (document.gaps.length) throw new Error("PROVISION_EXTRACTION_GAP");
  return { kind: "normalized-document" as const, articleNumber: null, start: 0, end: document.snapshot.blocks.length,
    text: readNormalizedSnapshot(document.snapshot, document.snapshot.source.canonicalUrl), links: document.links };
}

/** A search position locates a complete provision; its passage never supplies the legal text. */
export function selectPublisherProvision(document: ReturnType<typeof normalizePublisherHtml>, position: string) {
  const indices = document.positions[position];
  if (!indices?.length) throw new Error("PUBLISHER_POSITION_MISSING");
  if (indices.length !== 1) throw new Error("PUBLISHER_POSITION_AMBIGUOUS");
  const index = indices[0], { snapshot } = document;
  if (index >= snapshot.blocks.length) throw new Error("PUBLISHER_POSITION_MISSING");
  const heading = snapshot.blocks.slice(0, index + 1).findLast(block => block.semanticRole === "article");
  let articleNumber = heading ? articleNumberFromHeading(heading.text) : undefined;
  let range = articleNumber ? normalizedArticleRange(snapshot, articleNumber) : { start: 0, end: snapshot.blocks.length };
  if (index >= range.end) { articleNumber = undefined; range = { start: 0, end: snapshot.blocks.length }; }
  // Include an unread node directly at the closing boundary: it can belong to
  // the preceding provision even when it produced no normalized text block.
  if (document.gaps.some(gap => gap.blockIndex === null || (gap.blockIndex >= range.start && gap.blockIndex <= range.end))) {
    throw new Error("PROVISION_EXTRACTION_GAP");
  }
  return { kind: articleNumber ? "normalized-article" as const : "normalized-document" as const,
    articleNumber: articleNumber ?? null, start: range.start, end: range.end,
    text: readNormalizedSnapshot(snapshot, snapshot.source.canonicalUrl, articleNumber),
    links: document.links.filter(link => link.blockIndex >= range.start && link.blockIndex < range.end),
  };
}
