import type { RenderedParagraph, RenderedReceipt } from "../types";

const paragraphBreak = /(\r?\n(?:[ \t]*\r?\n)+)/;

function paragraphsByText(paragraphs: RenderedParagraph[]) {
  const index = new Map<string, RenderedParagraph[]>();
  for (const paragraph of paragraphs) {
    if (!paragraph.text) continue;
    const group = index.get(paragraph.text);
    if (group) group.push(paragraph);
    else index.set(paragraph.text, [paragraph]);
  }
  return index;
}

function countTextChunks(text: string) {
  const index = new Map<string, number>();
  for (const [position, chunk] of text.split(paragraphBreak).entries()) {
    if (position % 2 === 0) index.set(chunk, (index.get(chunk) ?? 0) + 1);
  }
  return index;
}

const shape = (paragraph: RenderedParagraph) => JSON.stringify([paragraph.kind, paragraph.parts?.map(part => part.field ?? part.text)]);

function matchingBinding(group: RenderedParagraph[] | undefined, count: number | undefined) {
  if (!group || group.length !== count) return undefined;
  const first = group[0];
  return group.every(paragraph => shape(paragraph) === shape(first)) ? first : undefined;
}

export function previewWithWording(generated: RenderedReceipt, text: string): RenderedReceipt {
  if (generated.plainText === text) return generated;
  const originals = paragraphsByText(generated.paragraphs);
  const counts = countTextChunks(text);
  const paragraphs = text.split(paragraphBreak).filter((_part, index) => index % 2 === 0).map((chunk, index) => {
    const original = matchingBinding(originals.get(chunk), counts.get(chunk));
    const kind = original?.kind ?? (index === 0 ? "title" : "body");
    return { ...original, id: `wording-${index}`, text: chunk, kind } satisfies RenderedParagraph;
  });
  return { ...generated, plainText: text, paragraphs };
}

export function refreshLinkedWording(text: string, before: RenderedReceipt, after: RenderedReceipt): string {
  if (text === before.plainText) return after.plainText;
  const originals = paragraphsByText(before.paragraphs);
  const updated = new Map(after.paragraphs.map(paragraph => [paragraph.id, paragraph]));
  const counts = countTextChunks(text);
  // The same words can represent different form fields, so identical lines must agree on their bindings and count.
  return text.split(paragraphBreak).map((chunk, index) => {
    if (index % 2 !== 0) return chunk;
    const group = originals.get(chunk);
    const previous = matchingBinding(group, counts.get(chunk));
    if (!group || !previous?.parts?.some(part => part.field)) return chunk;
    const next = updated.get(previous.id);
    if (!next || shape(previous) !== shape(next)) return chunk;
    return group.every(paragraph => updated.get(paragraph.id)?.text === next.text) ? next.text : chunk;
  }).join("");
}
