import type { LegalSourceContext } from "../legal/source-context";
import { detectArticleNumbers } from "./legal-language";

function articleNumber(value: string | null | undefined): string | undefined {
  return value ? detectArticleNumbers(value)[0] ?? (/^\d+(?:[.-]\d+)?$/u.test(value) ? value : undefined) : undefined;
}

export function sameInstrumentArticleReferences(text: string): string[] {
  const references = new Set<string>();
  for (const pattern of [
    /(?:стать(?:[её]й|[яеию])|article)\s+\d+(?:[.-]\d+)?\s+(?:(?:настоящего|этого)\s+(?:Кодекса|Закона)|of\s+this\s+(?:Code|Act|Law))/giu,
    /(?:ushbu|мазкур)\s+(?:kodeks|qonun|Кодекс|Қонун)[^.;\n]{0,45}?\d+\s*[-–]?\s*(?:modda|модда)[^\s,;.]*/giu,
  ]) for (const match of text.matchAll(pattern)) {
    for (const number of detectArticleNumbers(match[0])) references.add(number);
  }
  return [...references];
}

/** Discovery links within the verified packet help synthesis join a referring
 * rule to its operative text. They are not support mappings and do not waive
 * claim/span validation. Never join another instrument, language or revision. */
export function referencedLegalSourceIds(source: LegalSourceContext, sources: readonly LegalSourceContext[]): string[] {
  if (source.sourceType !== "lex" || (source.sourceClass && source.sourceClass !== "OFFICIAL_LEGISLATION")) return [];
  const canonical = (value: string) => { const url = new URL(value); url.hash = ""; return url.href; };
  const url = canonical(source.officialUrl);
  const references = new Set(sameInstrumentArticleReferences(
    (source.spans ?? []).map(span => span.text).join("\n") || source.excerpt || ""));
  return sources.filter(other => other.id !== source.id && other.sourceType === "lex"
    && (!other.sourceClass || other.sourceClass === "OFFICIAL_LEGISLATION")
    && canonical(other.officialUrl) === url && other.locale === source.locale
    && other.revisionDate === source.revisionDate
    && other.applicabilityStatus === source.applicabilityStatus
    && references.has(articleNumber(other.article) ?? "")
    && (other.spans ?? []).some(span => span.quality === "high" && span.text.trim().length > 40
      && !/:\s*$/u.test(span.text))).map(other => other.id);
}

/** Missing explicit same-instrument references are discovery needs, even when
 * the referring provision already supports part of a requirement. */
export function missingReferencedArticles(source: LegalSourceContext, sources: readonly LegalSourceContext[]): string[] {
  if (source.sourceType !== "lex" || (source.sourceClass && source.sourceClass !== "OFFICIAL_LEGISLATION")) return [];
  const relatedIds = new Set(referencedLegalSourceIds(source, sources));
  const available = new Set(sources.filter(item => relatedIds.has(item.id)).map(item => articleNumber(item.article)));
  if (source.spans?.some(span => span.quality === "high" && span.text.trim().length > 40 && !/:\s*$/u.test(span.text))) {
    available.add(articleNumber(source.article));
  }
  return sameInstrumentArticleReferences((source.spans ?? []).map(span => span.text).join("\n"))
    .filter(article => !available.has(article));
}

/** Follow only explicit references to this same instrument, not citations to
 * other codes that happen to share an article number. These are discovery
 * candidates; separately fetched text still goes through answer grounding. */
export function referencedArticleContextRequests(sources: readonly LegalSourceContext[], onlyIncompleteArticles = false) {
  const requests = new Map<string, { url: string; article: string }>();
  for (const source of sources) {
    if (source.sourceType !== "lex" || source.applicabilityStatus === "historical") continue;
    const url = new URL(source.officialUrl);
    url.hash = "";
    const text = (source.spans ?? []).map(span => span.text).join("\n") || source.excerpt || "";
    const own = articleNumber(source.article);
    const references = new Set<string>();
    if (own && /:\s*$/u.test(text)) references.add(own);
    if (!onlyIncompleteArticles) for (const number of sameInstrumentArticleReferences(text)) references.add(number);
    for (const article of references) {
      const covered = sources.some(other => other.actTitle === source.actTitle
        && articleNumber(other.article) === article
        && !/:\s*$/u.test((other.spans ?? []).map(span => span.text).join("\n") || other.excerpt || ""));
      if (!covered) requests.set(`${url.href}#${article}`, { url: url.href, article });
    }
  }
  return [...requests.values()].slice(0, 3);
}

export function selectReferencedArticleContext(source: LegalSourceContext, article: string): LegalSourceContext | null {
  if (source.sourceType !== "lex" || source.verificationState !== "direct_validated"
    || source.applicabilityStatus !== "current") return null;
  const spans = (source.spans ?? []).filter(span => articleNumber(span.article) === article);
  if (!spans.some(span => span.text.trim().length > 40 && !/:\s*$/u.test(span.text))) return null;
  return { ...source, id: `${source.id}:article:${article}`, article, spans,
    excerpt: spans.map(span => span.text).join(" ").slice(0, 1200) };
}
