/** Public navigation only: URLs always come from supplied sources, never from prose. */
export type ReferenceSource = { sourceId: string; actTitle: string; article?: string | null; originalUrl: string };
export type InlineReference = { start: number; end: number; label: string; articleNumber?: string; articleNumbers?: string[]; source?: ReferenceSource; href?: string; navigationOnly?: boolean };
export type ReferencePassage = { text: string; sourceIds?: readonly string[] };
export function officialReferenceUrl(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !url.port
    && ["lex.uz", "www.lex.uz"].includes(url.hostname) ? url.href : undefined; } catch { return undefined; }
}
function actKey(source: ReferenceSource) {
  const url = new URL(source.originalUrl); url.hash = "";
  url.hostname = "lex.uz";
  url.pathname = url.pathname.replace(/^\/(?:ru|uz|en)\/(docs|acts)\//u, "/$1/").replace(/^\/acts\//u, "/docs/");
  return url.href;
}
/** Use claim bindings to select an edition, then retain all its available provisions. */
export function referenceSourcesForPassage<T extends ReferenceSource>(sources: readonly T[], sourceIds?: readonly string[]): readonly T[] {
  if (!sourceIds?.length) return sources;
  const bound = sources.filter(source => sourceIds?.includes(source.sourceId) && officialReferenceUrl(source.originalUrl));
  const acts = new Set(bound.map(actKey));
  return sources.filter(source => officialReferenceUrl(source.originalUrl) && acts.has(actKey(source)));
}
function matchesArticle(source: ReferenceSource, number: string) {
  return new RegExp(`^(?:(?:статья|ст\\.?|article|art\\.?)\\s*)?${escape(number)}(?=[.\\s:—]|$)`, "iu").test(source.article ?? "")
    || new RegExp(`^${escape(number)}[-‐‑–]\\s*(?:modda|модда)`, "iu").test(source.article ?? "");
}
function rangeNumbers(number: string): string[] | undefined {
  const match = /^(\d+)[–—](\d+)$/u.exec(number);
  if (!match) return undefined;
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > 100) return undefined;
  return Array.from({length: end - start + 1}, (_, index) => String(start + index));
}
function unresolvedReferenceKey(reference: InlineReference) {
  // Inflected Russian labels describe the same provision, not separate sources.
  return reference.label.replace(/^(?:стать(?:я|и|е|ю|ями|ей|ях)|статей|ст\.?|articles?|art\.?)\s+/iu, "").toLocaleLowerCase();
}
function aliases(title: string) {
  const pairs: [RegExp, string[]][] = [
    [/трудов|mehnat|labou?r/iu, ["ТК", "МК", "Трудового кодекса", "Трудовой кодекс", "Mehnat kodeksi", "Labour Code", "Labor Code"]],
    [/гражданск(?:ий|ого) кодекс|fuqarolik kodeksi|civil code/iu, ["ГК", "ФК", "Гражданского кодекса", "Гражданский кодекс", "Fuqarolik kodeksi", "Civil Code"]],
    [/семейн|oila|family/iu, ["СК", "ОК", "Семейного кодекса", "Семейный кодекс", "Oila kodeksi", "Family Code"]],
    [/налогов|soliq|tax code/iu, ["НК", "Налогового кодекса", "Налоговый кодекс", "Soliq kodeksi", "Tax Code"]],
    [/уголовн.*процесс|jinoyat.protsess|criminal procedure/iu, ["УПК", "ЖПК"]],
    [/уголовный кодекс|уголовного кодекса|jinoyat kodeksi|criminal code/iu, ["УК", "ЖК", "Уголовного кодекса", "Уголовный кодекс", "Jinoyat kodeksi", "Criminal Code"]],
  ];
  return [title, title.replace(/\s+(?:Республики Узбекистан|Республиканинг).*$/iu, ""), ...pairs.filter(([pattern]) => pattern.test(title)).flatMap(([, values]) => values)];
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function inlineReferences(text: string, supplied: readonly ReferenceSource[]): InlineReference[] {
  const sources = supplied.filter(source => officialReferenceUrl(source.originalUrl));
  const output: InlineReference[] = [];
  const pattern = /(?:стать(?:я|и|е|ю|ями|ей|ях)|статей|ст\.?|articles?|art\.?)\s+(\d+(?:[-‐‑–]\d+)?(?:\s*(?:,|и|and|va)\s*\d+(?:[-‐‑–]\d+)?)*)|\d+(?:[-‐‑–]\d+)?\s*[-‐‑–]\s*(?:modda(?:si|ning|siga|lar)?|модда(?:си|нинг)?)/giu;
  for (const match of text.matchAll(pattern)) {
    const start = match.index!, end = start + match[0].length;
    if (start && /[\p{L}\p{N}_]/u.test(text[start - 1])) continue;
    const tail = text.slice(end, end + 180);
    const qualified = sources.flatMap(source => aliases(source.actTitle).flatMap(alias => {
      const hit = new RegExp(`^\\s+(?:of\\s+(?:the\\s+)?)?${escape(alias)}(?=$|[^\\p{L}\\p{N}_])`, "iu").exec(tail);
      return hit ? [{ source, length: hit[0].length }] : [];
    }));
    const longest = Math.max(0, ...qualified.map(item => item.length));
    // An explicit, unknown code must never fall back to a different known act.
    const unknownQualifier = /^\s+(?:[А-ЯЁ]{2,5}(?=$|[^\p{L}])|(?:of\s+(?:the\s+)?)?[\p{L}’-]+\s+(?:кодекс|code|kodeks))/u.test(tail);
    const candidates = longest ? qualified.filter(item => item.length === longest).map(item => item.source) : unknownQualifier ? [] : sources;
    const numbers = [...match[0].matchAll(/\d+(?:[-‐‑–]\d+)?/gu)];
    numbers.forEach((number, index) => {
      const articleNumber = number[0].replace(/[‐‑–]/gu, "-");
      const articleNumbers = rangeNumbers(number[0]);
      const exact = articleNumbers ? [] : candidates.filter(source => matchesArticle(source, articleNumber));
      const rangeSources = articleNumbers ? candidates.filter(source => articleNumbers.some(number => matchesArticle(source, number))) : [];
      const pool = exact.length ? exact : rangeSources.length ? rangeSources : candidates;
      const acts = new Set(pool.map(actKey));
      const source = acts.size === 1 ? pool[0] : undefined;
      const from = index === 0 ? start : start + number.index!;
      const to = index === numbers.length - 1 ? end + longest : start + number.index! + number[0].length;
      let href = source ? officialReferenceUrl(source.originalUrl) : undefined;
      if (href && !exact.length) { const url = new URL(href); url.hash = ""; href = url.href; }
      output.push({ start: from, end: to, label: text.slice(from, to), articleNumber, articleNumbers, source, href, navigationOnly: !!source && !exact.length });
    });
  }
  // Full act names are also navigable, outside already matched article references.
  for (const source of sources) for (const name of aliases(source.actTitle).filter(name => name.length > 5)) {
    for (const match of text.matchAll(new RegExp(escape(name), "giu"))) {
      const start = match.index!, end = start + match[0].length;
      if ((start && /[\p{L}\p{N}_]/u.test(text[start - 1])) || /[\p{L}\p{N}_]/u.test(text[end] ?? "")) continue;
      if (output.some(item => start < item.end && end > item.start)) continue;
      if (sources.some(other => actKey(other) !== actKey(source) && aliases(other.actTitle).includes(name))) continue;
      const url = new URL(source.originalUrl); url.hash = "";
      output.push({ start, end, label: match[0], source, href: url.href });
    }
  }
  return output.sort((a, b) => a.start - b.start);
}

/** Include each mentioned provision, even when only its containing act was retrieved. */
export function answerReferenceContext<T extends ReferenceSource>(sources: readonly T[], prose: string | readonly ReferencePassage[]) {
  const entries: Array<T & { navigationOnly?: boolean }> = [...sources];
  const unresolved: InlineReference[] = [];
  const seen = new Set<string>();
  const passages = typeof prose === "string" ? [{text: prose}] : prose;
  for (const passage of passages) for (const reference of inlineReferences(passage.text, referenceSourcesForPassage(sources, passage.sourceIds))) {
    if (!reference.source) {
      if (!unresolved.some(item => unresolvedReferenceKey(item) === unresolvedReferenceKey(reference))) unresolved.push(reference);
      continue;
    }
    if (!reference.articleNumber || !reference.navigationOnly) continue;
    if (reference.articleNumbers?.every(number => sources.some(source => officialReferenceUrl(source.originalUrl)
      && actKey(source) === actKey(reference.source!) && matchesArticle(source, number)))) continue;
    const key = `${actKey(reference.source)}#article-${reference.articleNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const original = sources.find(source => source.sourceId === reference.source!.sourceId)!;
    entries.push({ ...original, sourceId: `${original.sourceId}:article:${reference.articleNumber}`, article: reference.label,
      originalUrl: reference.href!, navigationOnly: true });
  }
  return { sources: entries, unresolved };
}

export function legalAnswerProse(value: unknown): string {
  return legalAnswerPassages(value).map(passage => passage.text).join("\n\n");
}

/** Keep each paragraph's citation bindings when collecting sidebar mentions. */
export function legalAnswerPassages(value: unknown): ReferencePassage[] {
  const publicKeys = new Set(["summary", "title", "explanation", "description", "statement", "impact", "condition", "outcome", "calculationMethod", "name", "reason", "note", "clarificationQuestions", "coverageGaps"]);
  const parts: ReferencePassage[] = [];
  const strings = (item: unknown): string[] | undefined => Array.isArray(item) ? item.filter((id): id is string => typeof id === "string") : undefined;
  const visit = (item: unknown, key = "", sourceIds?: readonly string[]) => {
    if (typeof item === "string") { if (publicKeys.has(key)) parts.push({text: item, sourceIds}); }
    else if (Array.isArray(item)) item.forEach(child => visit(child, key, sourceIds));
    else if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      const bound = strings(record.sourceIds) ?? sourceIds;
      for (const [name, child] of Object.entries(record)) {
        if (!["sources", "sourceIds", "summarySourceIds", "answer"].includes(name))
          visit(child, name, name === "summary" ? strings(record.summarySourceIds) : bound);
      }
    }
  };
  visit(value); return parts;
}
