export function proposalExcerpt(source: string, selection: string): string | null {
  const selected = selection.trim();
  if (!selected) return null;
  const exact = source.indexOf(selected);
  if (exact !== -1) return exact === source.lastIndexOf(selected) ? selected : null;

  // The browser can represent line and paragraph breaks differently from the saved draft.
  const compact = source.replace(/\s+/g, " ");
  const excerpt = selected.replace(/\s+/g, " ");
  const start = compact.indexOf(excerpt);
  if (start === -1 || start !== compact.lastIndexOf(excerpt)) return null;
  const end = start + excerpt.length;
  let position = 0;
  let sourceStart = 0;
  for (const match of source.matchAll(/\s+|\S+/g)) {
    const whitespace = /^\s/.test(match[0]);
    const next = position + (whitespace ? 1 : match[0].length);
    if (position <= start && start < next) sourceStart = match.index + (whitespace ? 0 : start - position);
    if (end <= next) return source.slice(sourceStart, whitespace ? match.index + match[0].length : match.index + end - position);
    position = next;
  }
  return null;
}
