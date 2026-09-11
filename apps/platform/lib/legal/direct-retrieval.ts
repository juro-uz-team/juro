import type { LegalSourceContext, LegalSourceSpan } from "../ai/provider";
import { detectArticleNumbers } from "./legal-language";
import { completeArticleText } from "./article-context";
import { legalDatabaseFreshnessFromAsOf, type LegalDatabaseFreshness } from "./verified-retrieval";
import { lexDocumentIsRepealed } from "./lex-document-status";
import {
  classifyLegalSourceUrl,
  fetchLegalSource,
  LegalSourceFetchError,
  type LegalSourceFetchErrorCode,
} from "./source-fetch";
import {
  containsLegalSourceUiNoise,
  normalizeLegalSourceHtml,
  removeLegalSourceUiNoise,
  type NormalizedLegalSourceSnapshot,
} from "./source-parser";

/**
 * Bounded salvage, reranking and request-scoped article chunks adapt concepts
 * from toxirerkinov70-commits/huquq-ai@1bce500c69b8213373d8ce0b40d56be7d83f6aec.
 * MIT License, Copyright (c) 2026 Toxir Erkinov. Reimplemented for direct-live
 * Lex.uz with no local corpus, vectors, embeddings or retained legal text.
 */

type DirectLegalSourceKind = "lex";

/**
 * Query-scoped official-source retrieval.
 *
 * This deliberately has no D1, R2, Queue, or Vectorize dependency: official
 * pages are fetched only for the current question and the caller decides which
 * short citation metadata to persist with a completed AI run.
 */
const SEARCH_TIMEOUT_MS = 1_500;
const SEARCH_MAX_BYTES = 512 * 1024;
const SEARCH_MAX_REDIRECTS = 2;
// The current Civil, Labour, Civil Procedure and Tax codes are multi-megabyte
// HTML documents on Lex.uz. This remains a strict request-memory ceiling and
// the bytes are discarded after parsing; it is not a corpus or cache.
const DOCUMENT_MAX_BYTES = 8_500_000;
/** A live, user-initiated Lex lookup must leave the request budget to the AI. */
export const DIRECT_RETRIEVAL_BUDGET_MS = 2_750;
const MAX_CANDIDATES_PER_PROVIDER = 3;
const MAX_CONCURRENT_DOCUMENT_FETCHES = 3;
// Six focused spans keep fast-mode structured generation inside the shared
// 30-second request budget while still covering a base rule plus formation
// steps. Ranking, not truncation order, decides which spans survive.
const MAX_SOURCE_SPANS = 6;
const MAX_SPAN_CHARACTERS = 2_400;
/**
 * Words that frame a request instead of naming its legal subject: grammar,
 * politeness, the requested answer format, the jurisdiction and the platform
 * itself. Excluding them is a precision boundary, not a topic vocabulary — no
 * entry may name an actor, an act, a right, an obligation or a procedure, so
 * retrieval stays able to reach any subject the query-understanding step asks
 * for. The jurisdiction entries earn their place structurally: virtually every
 * Uzbek act repeats "Республики Узбекистан" and the word "официальный", so
 * matching them distinguishes nothing.
 */
const REQUEST_FRAME_TERMS = new Set([
  // Grammar and discourse.
  "about", "after", "and", "are", "before", "could", "for", "from", "have", "into",
  "need", "should", "that", "the", "this", "what", "which", "with",
  "быть", "есть", "его", "ему", "или", "как", "какие", "какой", "когда", "мне", "они",
  "нужны", "нужно", "основные", "главные", "почему", "при", "сейчас", "также",
  "чем", "что", "чтобы", "это", "этом", "для", "где",
  "bilan", "bo‘yicha", "boyicha", "bu", "ham", "kerak", "keyin", "oldin", "qanday",
  "qayerda", "shu", "uchun", "uni", "va", "yoki",
  // Requested answer format.
  "дайте", "кратко", "обычно", "ответ", "ответьте", "подробно", "после", "шаги",
  "javob", "qisqa",
  // Jurisdiction, source framing and the product name.
  "официальные", "официальный", "официальными", "источник", "источники",
  "республика", "республики", "узбекистан", "узбекистана", "узбекистане",
  "manba", "o‘zbekiston", "ozbekiston", "rasmiy", "respublikasi", "respublikasining",
  "juro", "smoke", "staging",
]);
/**
 * A stem shorter than this carries too little signal for prefix matching: the
 * four letters of "прав" would make a question about "право" match every
 * "правовое" in the corpus. Such terms must occur as a whole word instead.
 */
const MIN_PREFIX_STEM_LENGTH = 5;
/**
 * A candidate span that repeats an already selected one adds no evidence. Lex
 * acts carry long runs of near-identical amendment and registration wording,
 * and without this they crowd out the provisions that answer the question.
 */
const MAX_SPAN_OVERLAP = 0.8;

type FetchLike = typeof fetch;

export type DirectLegalSourceEvidence = {
  sourceId: string;
  sourceKind: DirectLegalSourceKind;
  canonicalUrl: string;
  contentSha256: string;
  retrievedAt: string;
  validatedAt: string;
  validationStatus: "validated";
};

export type DirectLegalRetrieval = {
  sources: LegalSourceContext[];
  evidence: DirectLegalSourceEvidence[];
  freshness: LegalDatabaseFreshness;
  legalDatabaseAsOf: string;
  sourceAccessMode: "direct";
  sourcesRetrievedAt: string | null;
  sourceValidationStatus: "validated" | "unavailable";
  errors: Array<{ provider: DirectLegalSourceKind; code: string }>;
};

export function unavailableDirectLegalRetrieval(
  now = new Date(),
  code = "LEGAL_SOURCE_DIRECT_RETRIEVAL_DISABLED",
): DirectLegalRetrieval {
  const freshness = legalDatabaseFreshnessFromAsOf("unavailable", now);
  return {
    sources: [], evidence: [], freshness, legalDatabaseAsOf: freshness.asOf,
    sourceAccessMode: "direct", sourcesRetrievedAt: null,
    sourceValidationStatus: "unavailable",
    errors: [{ provider: "lex", code }],
  };
}

export interface LegalSourceProvider {
  readonly kind: DirectLegalSourceKind;
  search(query: string, locale: "ru" | "uz"): Promise<string[]>;
  fetchDocument(url: string): Promise<{
    source: LegalSourceContext;
    evidence: DirectLegalSourceEvidence;
  }>;
}

function directSearchUrl(query: string, locale: "ru" | "uz"): URL {
  // Lex separates act-title search (`search/all?searchtitle=`) from national
  // legislation full-text search. Legal query understanding produces
  // provision wording, so sending it to the title-only endpoint silently
  // returned no candidates for ordinary provision-focused questions. The
  // public advanced-search form uses this exact national-law
  // route and `query` parameter for words and phrases inside legal texts.
  const url = new URL(`https://lex.uz/${locale}/search/nat`);
  url.searchParams.set("query", query.slice(0, 100));
  return url;
}

function isSafeSearchRedirect(url: URL): boolean {
  const expectedHost = "lex.uz";
  return url.protocol === "https:"
    && url.port === ""
    && url.username === ""
    && url.password === ""
    && (url.hostname === expectedHost || url.hostname === `www.${expectedHost}`);
}

async function boundedSearchHtml(
  url: URL,
  fetchImpl: FetchLike,
  signal?: AbortSignal,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  const requestSignal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal;
  try {
    let searchUrl = url;
    let response: Response | null = null;
    for (let redirects = 0; redirects <= SEARCH_MAX_REDIRECTS; redirects += 1) {
      response = await fetchImpl(searchUrl, {
        method: "GET",
        redirect: "manual",
        credentials: "omit",
        cache: "no-store",
        signal: requestSignal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9",
          "user-agent": "JURO-LegalSourceDirect/1.0 (+https://juro.uz)",
        },
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get("location");
      try { await response.body?.cancel(); } catch { /* best effort */ }
      if (!location || redirects === SEARCH_MAX_REDIRECTS) {
        throw new Error("LEGAL_SOURCE_SEARCH_REDIRECT_REJECTED");
      }
      const nextUrl = new URL(location, searchUrl);
      if (!isSafeSearchRedirect(nextUrl)) {
        throw new Error("LEGAL_SOURCE_SEARCH_REDIRECT_REJECTED");
      }
      searchUrl = nextUrl;
    }
    if (!response) throw new Error("LEGAL_SOURCE_SEARCH_UNAVAILABLE");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const length = Number(response.headers.get("content-length") ?? "0");
    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* best effort */ }
      throw new Error(`LEGAL_SOURCE_SEARCH_HTTP_${response.status}`);
    }
    if (!contentType.includes("text/html")) {
      try { await response.body?.cancel(); } catch { /* best effort */ }
      throw new Error("LEGAL_SOURCE_SEARCH_CONTENT_TYPE_REJECTED");
    }
    if (length && length > SEARCH_MAX_BYTES) {
      try { await response.body?.cancel(); } catch { /* best effort */ }
      throw new Error("LEGAL_SOURCE_SEARCH_TOO_LARGE");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("LEGAL_SOURCE_SEARCH_UNAVAILABLE");
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > SEARCH_MAX_BYTES) throw new Error("LEGAL_SOURCE_SEARCH_TOO_LARGE");
        parts.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("LEGAL_SOURCE_SEARCH_")) throw error;
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new Error("LEGAL_SOURCE_SEARCH_TIMEOUT");
    }
    throw new Error("LEGAL_SOURCE_SEARCH_UNAVAILABLE");
  } finally {
    clearTimeout(timeout);
  }
}

function abortError(signal: AbortSignal): DOMException {
  return signal.reason instanceof DOMException
    ? signal.reason
    : new DOMException("Request was aborted", "AbortError");
}

function throwIfRequestAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal);
}

function abortableFetch(fetchImpl: FetchLike, signal: AbortSignal): FetchLike {
  return (input, init) => fetchImpl(input, {
    ...init,
    signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
  });
}

async function waitWithAbort(
  wait: (delayMs: number) => Promise<void>,
  delayMs: number,
  signal: AbortSignal,
): Promise<void> {
  throwIfRequestAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    void wait(delayMs).then(
      () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

// Structural act families only. These describe what kind of instrument a title
// announces — an amendment notice, a draft, a repeal, a local decision, a code
// — and never its subject matter, so no legal topic is privileged over another.
const AMENDMENT_TITLE = /(?:изменен|дополнен|внесени|o[‘’ʼʻ']?zgartir|qo[‘’ʼʻ']?shimcha|kiritish\s+haqida)/iu;
const NON_NORMATIVE_TITLE = /(?:проект|loyiha|утратил\p{L}*\s+силу|признан\p{L}*\s+утративш|o[‘’ʼʻ']?z\s+kuchini\s+yo[‘’ʼʻ']?qot)/iu;
/**
 * A district, regional or city instrument binds one locality. It is genuine law
 * but never the national rule a chat question asks about, and it dominates Lex
 * search results because localities publish far more acts than the republic.
 */
const LOCAL_AUTHORITY_TITLE = /(?:\btuman(?:i|ining|idagi)\b|\bviloyat(?:i|ining)\b|\bshahri(?:ning)?\b|\bрайон\p{L}*\b|\bобласт\p{L}*\b|\bгородск\p{L}*\s+кенгаш)/iu;
const CODE_TITLE = /(?:кодекс|kodeks|code)\b/iu;
const NAMED_ACT_TITLE = /(?:to[‘’ʼʻ']?g[‘’ʼʻ']?risida|^«?об?\s|^закон|^qonun)/iu;
const PARLIAMENTARY_WRAPPER_TITLE = /^о\s+законе\s+республики\s+узбекистан/iu;

function plainSearchTitle(value: string): string {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&nbsp;|&#160;/giu, " ")
    .replace(/&quot;|&#34;/giu, "\"")
    .replace(/&apos;|&#39;/giu, "'")
    .replace(/&amp;|&#38;/giu, "&")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * One request-scoped relevance term, prepared once so span scoring can compare
 * hundreds of candidates without rebuilding a matcher per comparison.
 */
type RelevanceTerm = { term: string; stem: string; wholeWord: RegExp | null };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Relevance vocabulary for one request. It is derived only from the question
 * and from the searches actually issued for it, so a topic gains weight by
 * being asked about — never by appearing in a dictionary shipped with JURO.
 */
function relevanceTerms(query: string): RelevanceTerm[] {
  const seen = new Set<string>();
  const terms: RelevanceTerm[] = [];
  for (const token of query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
    if (seen.has(token) || REQUEST_FRAME_TERMS.has(token)) continue;
    seen.add(token);
    const stem = queryStem(token);
    terms.push({
      term: token,
      stem,
      wholeWord: stem.length >= MIN_PREFIX_STEM_LENGTH
        ? null
        : new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(stem)}(?![\\p{L}\\p{N}])`, "u"),
    });
    if (terms.length >= 16) break;
  }
  return terms;
}

function termMatches(haystack: string, term: RelevanceTerm): boolean {
  return term.wholeWord ? term.wholeWord.test(haystack) : haystack.includes(term.stem);
}

function countTermMatches(haystack: string, terms: readonly RelevanceTerm[]): number {
  return terms.reduce((total, term) => total + (termMatches(haystack, term) ? 1 : 0), 0);
}

function searchCandidateRank(titleValue: string, terms: readonly RelevanceTerm[], order: number): number {
  const title = plainSearchTitle(titleValue).toLocaleLowerCase();
  let score = countTermMatches(title, terms) * 7;
  if (CODE_TITLE.test(title) && !AMENDMENT_TITLE.test(title)) score += 80;
  if (PARLIAMENTARY_WRAPPER_TITLE.test(title)) score -= 45;
  if (AMENDMENT_TITLE.test(title)) score -= 90;
  if (NON_NORMATIVE_TITLE.test(title)) score -= 120;
  if (LOCAL_AUTHORITY_TITLE.test(title)) score -= 120;
  return score - order / 1_000;
}

function officialDocumentUrls(
  html: string,
  terms: readonly RelevanceTerm[],
  limit = MAX_CANDIDATES_PER_PROVIDER,
): string[] {
  const origin = "https://lex.uz";
  const candidates: Array<{ url: string; title: string; order: number }> = [];
  const seen = new Set<string>();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/giu;
  const hrefPattern = /\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/iu;
  for (const [order, match] of [...html.matchAll(anchorPattern)].entries()) {
    const href = match[1]?.match(hrefPattern);
    const raw = href?.[1] ?? href?.[2] ?? href?.[3];
    if (!raw || raw.length > 2_000) continue;
    try {
      const candidateUrl = new URL(raw, origin);
      // Lex appends the full-text `query` and a result fragment solely to
      // highlight matching words in its document reader. Neither is part of
      // the legal source identity and the fetch boundary intentionally rejects
      // both, so remove only those known presentation components before
      // canonical validation.
      candidateUrl.searchParams.delete("query");
      candidateUrl.hash = "";
      const reference = classifyLegalSourceUrl(candidateUrl.href);
      if (reference.sourceKind !== "lex" || seen.has(reference.canonicalUrl)) continue;
      seen.add(reference.canonicalUrl);
      candidates.push({ url: reference.canonicalUrl, title: match[2] ?? "", order });
    } catch {
      // Only exact, canonical Lex document paths remain eligible.
    }
  }
  return candidates
    .sort((left, right) => searchCandidateRank(right.title, terms, right.order) - searchCandidateRank(left.title, terms, left.order))
    .slice(0, limit)
    .map((candidate) => candidate.url);
}

function relevantExcerpt(plainText: string, terms: readonly RelevanceTerm[]): string {
  const normalized = plainText.replace(/\s+/gu, " ").trim();
  const lower = normalized.toLocaleLowerCase();
  const index = terms
    .map((term) => lower.indexOf(term.stem))
    .find((value) => value >= 0) ?? 0;
  const start = Math.max(0, index - 220);
  return normalized.slice(start, start + 1_200);
}

function validatedOfficialDocumentUrls(values: readonly string[], locale: "ru" | "uz"): string[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    try {
      const reference = classifyLegalSourceUrl(value);
      if (reference.sourceKind !== "lex" || reference.locale !== locale || seen.has(reference.canonicalUrl)) continue;
      seen.add(reference.canonicalUrl);
      urls.push(reference.canonicalUrl);
      if (urls.length >= MAX_CANDIDATES_PER_PROVIDER) break;
    } catch {
      // Discovery output is untrusted until this exact canonical allowlist passes.
    }
  }
  return urls;
}

function queryStem(term: string): string {
  const uzbekRoot = term.replace(/(?:larining|laridagi|lariga|lardan|larning|sining|ining|ning|lari|larni|larda|lar)$/iu, "");
  if (uzbekRoot !== term && uzbekRoot.length >= 4) return uzbekRoot;
  if (term.length >= 11) return term.slice(0, -3);
  if (term.length >= 8) return term.slice(0, -2);
  if (term.length >= 6) return term.slice(0, -1);
  return term;
}

/**
 * A direct page is a source card only when its parsed, official text matches
 * the request. This deliberately runs after URL validation and does not use
 * model output, so an unrelated search result cannot become a citation.
 *
 * The act title is evidence here, not a gate. A broad act can answer a narrow
 * question through one provision even when its title shares no useful query
 * terms. Provision headings and hashed span text therefore count the same as
 * the title, while two independent term matches stay mandatory so an unrelated
 * act cannot qualify on one incidental word.
 */
function isRelevantDirectSource(
  source: LegalSourceContext,
  terms: readonly RelevanceTerm[],
): boolean {
  if (terms.length === 0) return false;
  const evidence = [
    source.actTitle,
    source.article ?? "",
    source.excerpt ?? "",
    ...(source.spans ?? []).flatMap((span) => [span.article ?? "", span.text]),
  ].join(" ").toLocaleLowerCase();
  return countTermMatches(evidence, terms) >= Math.min(2, terms.length);
}

function officialDisplayTitle(value: string): string {
  return removeLegalSourceUiNoise(value)
    .replace(/^из элемента документа\s*/iu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 500);
}

/**
 * Public, server-derived cards for technically validated official pages.
 * They are deliberately separate from model claims: no finding, risk, or
 * deadline gains a citation merely because a card is present.
 */
export function directSourceCards(sources: readonly LegalSourceContext[]) {
  return sources
    .filter((source) => source.sourceType === "lex"
      && ["direct_validated", "verified"].includes(source.verificationState)
      && source.excerpt?.trim()
      && (() => {
        try {
          const url = new URL(source.officialUrl);
          return url.protocol === "https:" && (url.hostname === "lex.uz" || url.hostname === "www.lex.uz");
        } catch {
          return false;
        }
      })())
    .map((source) => ({
      sourceId: source.id,
      actTitle: source.actTitle,
      actIdentifier: source.actIdentifier,
      article: source.article ?? null,
      originalUrl: source.officialUrl,
      status: source.applicabilityStatus ?? "current" as const,
      effectiveDate: source.effectiveDate ?? null,
      verifiedAt: source.verifiedAt,
    }));
}

const ARTICLE_HEADING_START = /^(?:(?:статья|модда|modda|article)\s+\d+(?:[.-]\d+)?|\d+(?:[.-]\d+)?\s*(?:-\s*)?modda\b)/iu;

function articleNumberFromText(value: string): string | null {
  const match = value.match(/(?:(?:статья|модда|modda|article)\s+(\d+(?:[.-]\d+)?)|(\d+(?:[.-]\d+)?)\s*(?:-\s*)?modda\b)/iu);
  return match?.[1] ?? match?.[2] ?? null;
}

function articleReference(blocks: Array<{ kind: string; text: string; semanticRole?: string }>): string | null {
  const block = blocks.find((candidate) =>
    candidate.semanticRole === "article"
      || (candidate.kind === "heading" && ARTICLE_HEADING_START.test(candidate.text.trim())),
  );
  return block?.text.trim().slice(0, 240) ?? null;
}

function paragraphReference(value: string): string | null {
  return value.match(/^(?:пункт|band)\s+\d+(?:[.-]\d+)?/iu)?.[0] ?? null;
}

function splitLegalText(value: string): string[] {
  const articleParts = value
    .replace(/\s+/gu, " ")
    .trim()
    .split(/(?=(?:(?:Статья|Модда|Modda|Article)\s+\d+(?:[.-]\d+)?|(?<!\d)\d+(?:[.-]\d+)?\s*(?:-\s*)?modda\b))/giu)
    .filter(Boolean);
  return articleParts.flatMap((part) => {
    if (part.length <= MAX_SPAN_CHARACTERS) return [part];
    const sentences = part.split(/(?<=[.!?;])\s+/u);
    const chunks: string[] = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length + 1 > MAX_SPAN_CHARACTERS) {
        chunks.push(current);
        current = "";
      }
      current = `${current}${current ? " " : ""}${sentence}`.slice(0, MAX_SPAN_CHARACTERS);
    }
    if (current) chunks.push(current);
    return chunks;
  });
}

function sourceSpanScore(
  text: string,
  articleNumberRequested: string | null,
  article: string | null,
  terms: readonly RelevanceTerm[],
): number {
  const heading = (article ?? "").toLocaleLowerCase();
  const body = text.toLocaleLowerCase();
  // A term in the official article heading is a much stronger relevance signal
  // than the same word repeated somewhere in a long provision: the heading is
  // the legislator's own statement of what the provision governs. Keeping the
  // two counts separate lets the article dedicated to the question outrank a
  // neighbouring one that merely reuses its vocabulary.
  const headingMatches = countTermMatches(heading, terms);
  const bodyMatches = countTermMatches(body, terms);
  let score = headingMatches * 10 + bodyMatches * 8;
  if (headingMatches >= 2) score += 8;
  if (bodyMatches >= 2) score += 8;
  if (articleNumberRequested && articleNumberFromText(text) === articleNumberRequested) score += 25;
  if (ARTICLE_HEADING_START.test(text)) score += 2;
  return score;
}

/**
 * Word bigrams, used only to recognise that two candidate spans say the same
 * thing. Bigrams rather than words because Lex boilerplate reuses the same
 * vocabulary in genuinely different provisions.
 */
function spanBigrams(text: string): Set<string> {
  const words = (text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).slice(0, 400);
  const bigrams = new Set<string>();
  for (let index = 0; index + 1 < words.length; index += 1) {
    bigrams.add(`${words[index]} ${words[index + 1]}`);
  }
  return bigrams;
}

/**
 * True when nearly everything the candidate says is already covered. The ratio
 * is deliberately one-directional: a longer span that happens to contain a
 * shorter selected one still adds the surrounding provision, which is how an
 * enumerated list stays attached to the sentence introducing it.
 */
function alreadyCovered(candidate: Set<string>, selected: readonly Set<string>[]): boolean {
  if (candidate.size === 0) return false;
  return selected.some((existing) => {
    if (existing.size === 0) return false;
    let shared = 0;
    for (const bigram of candidate) {
      if (existing.has(bigram)) shared += 1;
    }
    return shared / candidate.size >= MAX_SPAN_OVERLAP;
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requestScopedSourceSpans(input: {
  snapshot: NormalizedLegalSourceSnapshot;
  contentSha256: string;
  articleNumberRequested: string | null;
  terms: readonly RelevanceTerm[];
  completeRequestedArticle?: boolean;
}): Promise<LegalSourceSpan[]> {
  if (input.completeRequestedArticle && input.articleNumberRequested) {
    const article = completeArticleText(input.snapshot.blocks, input.articleNumberRequested);
    if (!article) throw new Error("LEGAL_SOURCE_PROVISION_INCOMPLETE");
    const {heading, text: fullText} = article;
    const chunks = splitLegalText(fullText);
    if (chunks.length > MAX_SOURCE_SPANS || chunks.join(" ").replace(/\s+/gu, " ").trim() !== fullText) {
      throw new Error("LEGAL_SOURCE_PROVISION_CONTEXT_LIMIT");
    }
    return Promise.all(chunks.map(async (text, index) => ({
      id: `span:${input.contentSha256.slice(0, 12)}:article:${input.articleNumberRequested}:${index}`,
      article: heading, paragraph: null, text, textSha256: await sha256Hex(text), quality: "high" as const,
    })));
  }
  let currentArticle: string | null = null;
  const articleHeadingsByNumber = new Map<string, string>();
  for (const block of input.snapshot.blocks) {
    if (block.semanticRole !== "article" && !ARTICLE_HEADING_START.test(block.text)) continue;
    const number = articleNumberFromText(block.text);
    if (number && !articleHeadingsByNumber.has(number)) {
      articleHeadingsByNumber.set(number, block.text.trim().slice(0, 240));
    }
  }
  const candidates: Array<Omit<LegalSourceSpan, "textSha256"> & { score: number; order: number }> = [];
  const seenCandidateText = new Set<string>();
  const addCandidate = (text: string, article: string | null, paragraph: string | null, id: string) => {
    const normalized = text.replace(/\s+/gu, " ").trim();
    if (normalized.length < 40 || seenCandidateText.has(normalized)) return;
    if (article && normalized === article.replace(/\s+/gu, " ").trim()) return;
    seenCandidateText.add(normalized);
    const order = candidates.length;
    candidates.push({
      id,
      article,
      paragraph,
      text: normalized,
      quality: "high",
      score: sourceSpanScore(normalized, input.articleNumberRequested, article, input.terms),
      order,
    });
  };
  for (const block of input.snapshot.blocks) {
    if (block.semanticRole === "article" || ARTICLE_HEADING_START.test(block.text)) {
      currentArticle = block.text.slice(0, 240);
    }
    if (block.semanticRole === "article" || block.kind === "heading") continue;
    for (const [partIndex, text] of splitLegalText(block.text).entries()) {
      const embeddedArticleNumber = articleNumberFromText(text);
      const embeddedArticle = embeddedArticleNumber ? articleHeadingsByNumber.get(embeddedArticleNumber) ?? null : null;
      const article = (embeddedArticle ?? currentArticle)?.slice(0, 240) ?? null;
      addCandidate(
        text,
        article,
        block.semanticRole === "paragraph" ? paragraphReference(text) : null,
        `span:${input.contentSha256.slice(0, 12)}:${block.index}:${partIndex}`,
      );
    }
  }
  // Lex renders list introductions and list items as separate short elements.
  // Those fragments are individually too small to support a claim, but the
  // parser's clean plain text preserves their order. Add bounded article-level
  // chunks so provisions such as "the charter must contain:" remain attached
  // to the enumerated contents instead of disappearing from retrieval.
  for (const [partIndex, text] of splitLegalText(input.snapshot.plainText).entries()) {
    const embeddedArticleNumber = articleNumberFromText(text);
    const embeddedArticle = embeddedArticleNumber
      ? articleHeadingsByNumber.get(embeddedArticleNumber) ?? text.match(/^(?:(?:статья|модда|modda|article)\s+\d+(?:[.-]\d+)?|\d+(?:[.-]\d+)?\s*(?:-\s*)?modda\b)/iu)?.[0] ?? null
      : null;
    addCandidate(
      text,
      embeddedArticle?.slice(0, 240) ?? null,
      null,
      `span:${input.contentSha256.slice(0, 12)}:plain:${partIndex}`,
    );
  }
  const ordered = candidates.sort((left, right) => right.score - left.score || left.order - right.order);
  // Selection is by score, then by novelty. Both passes above intentionally
  // produce overlapping views of the same act — one per parsed block and one
  // per article-level chunk — and long acts repeat amendment and registration
  // wording across many provisions. Without the novelty check those near-copies
  // fill the whole budget and the provisions that answer the question are cut.
  const selectedBigrams: Set<string>[] = [];
  const selected: typeof ordered = [];
  for (const span of ordered) {
    if (selected.length >= MAX_SOURCE_SPANS) break;
    const bigrams = spanBigrams(span.text);
    if (alreadyCovered(bigrams, selectedBigrams)) continue;
    selectedBigrams.push(bigrams);
    selected.push(span);
  }
  return Promise.all(selected.map(async (span) => ({
    id: span.id,
    article: span.article,
    paragraph: span.paragraph,
    text: span.text,
    quality: span.quality,
    textSha256: await sha256Hex(span.text),
  })));
}

function sourceQuality(input: {
  snapshot: NormalizedLegalSourceSnapshot;
  canonicalUrl: string;
  locale: "ru" | "uz";
  spans: readonly LegalSourceSpan[];
}): NonNullable<LegalSourceContext["sourceQuality"]> {
  const title = input.snapshot.documentTitle.replace(/\s+/gu, " ").trim();
  const sample = input.spans.map((span) => span.text).join(" ").slice(0, 12_000);
  const letters = sample.match(/\p{L}/gu)?.length ?? 0;
  const cyrillic = sample.match(/\p{Script=Cyrillic}/gu)?.length ?? 0;
  const latin = sample.match(/\p{Script=Latin}/gu)?.length ?? 0;
  const uzbekCyrillic = sample.match(/[ўқғҳ]/giu)?.length ?? 0;
  const localeMatches = letters >= 40 && (input.locale === "ru"
    ? cyrillic / letters >= 0.55 && (cyrillic === 0 || uzbekCyrillic / cyrillic <= 0.02)
    : latin / letters >= 0.45);
  let canonicalUrl = false;
  try {
    const parsed = new URL(input.canonicalUrl);
    canonicalUrl = parsed.protocol === "https:" && (parsed.hostname === "lex.uz" || parsed.hostname === "www.lex.uz");
  } catch {}
  const checks = {
    title: title.length >= 4 && title.length <= 2_000 && !containsLegalSourceUiNoise(title),
    sufficientText: sample.length >= 240,
    clean: !containsLegalSourceUiNoise(sample),
    locale: localeMatches,
    canonicalUrl,
    structured: input.spans.length > 0,
  };
  return { passed: Object.values(checks).every(Boolean), ...checks };
}

/**
 * Ranks by instrument kind, not by subject. A code outranks a named act, which
 * outranks subordinate regulation; drafts and repeals are excluded outright and
 * amendment notices rank below the act they amend, because a question is almost
 * never answered by the notice that changed a provision.
 */
function sourceRank(source: LegalSourceContext): number {
  const title = source.actTitle.toLocaleLowerCase();
  if (NON_NORMATIVE_TITLE.test(title)) return -100;
  if (LOCAL_AUTHORITY_TITLE.test(title)) return 5;
  if (PARLIAMENTARY_WRAPPER_TITLE.test(title)) return 8;
  if (AMENDMENT_TITLE.test(title)) return 10;
  if (CODE_TITLE.test(title)) return 45;
  if (NAMED_ACT_TITLE.test(title)) return 40;
  if (/(?:положение|nizom)/iu.test(title)) return 25;
  return 20;
}

class OfficialDirectProvider implements LegalSourceProvider {
  constructor(
    readonly kind: DirectLegalSourceKind,
    private readonly locale: "ru" | "uz",
    private readonly fetchImpl: FetchLike,
    private readonly now: () => Date,
    private readonly wait: (delayMs: number) => Promise<void>,
    private readonly signal: AbortSignal,
    private readonly articleNumberRequested: string | null,
    private readonly terms: readonly RelevanceTerm[],
    private readonly completeArticle = false,
    private readonly documentTimeoutMs = 1_800,
  ) {}

  async search(query: string, locale: "ru" | "uz"): Promise<string[]> {
    const html = await boundedSearchHtml(directSearchUrl(query, locale), this.fetchImpl, this.signal);
    return officialDocumentUrls(html, this.terms, 20).slice(0, MAX_CANDIDATES_PER_PROVIDER);
  }

  async fetchDocument(url: string): Promise<{ source: LegalSourceContext; evidence: DirectLegalSourceEvidence }> {
    const fetched = await fetchLegalSource(url, {
      adviceEnabled: false,
      fetchImpl: this.fetchImpl,
      now: this.now,
      maxBytes: DOCUMENT_MAX_BYTES,
      timeoutMs: this.documentTimeoutMs,
      // The request is initiated by the person asking JURO, not by the
      // scheduled crawler. We still check robots disallow rules, canonical
      // HTTPS paths, redirects and response integrity; only the crawler delay
      // is not allowed to consume the interactive answer budget.
      crawlDelayMode: "proceed",
      wait: (delayMs) => waitWithAbort(this.wait, delayMs, this.signal),
    });
    const html = new TextDecoder("utf-8", { fatal: true }).decode(fetched.bytes);
    if (lexDocumentIsRepealed(html)) throw new Error("LEGAL_SOURCE_DOCUMENT_REPEALED");
    const snapshot = normalizeLegalSourceHtml({
      html,
      reference: fetched,
      rawContentSha256: fetched.contentSha256,
    });
    const fetchedAt = fetched.fetchedAt;
    if (fetched.sourceKind !== "lex") throw new Error("LEGAL_SOURCE_UPSTREAM_UNAVAILABLE");
    const sourceId = `direct:lex:${fetched.locale}:${fetched.canonicalId}:${fetched.contentSha256.slice(0, 12)}`;
    const spans = await requestScopedSourceSpans({
      snapshot,
      contentSha256: fetched.contentSha256,
      articleNumberRequested: this.articleNumberRequested,
      terms: this.terms,
      completeRequestedArticle: this.completeArticle,
    });
    // Direct-answer source cards predate the `uz-Cyrl` value. Preserve the
    // exact UZC page in the packet while using Uzbek query quality rules; the
    // full corpus stores `uz-Cyrl` explicitly instead of translating it.
    if (fetched.locale === "en") throw new Error("LEGAL_SOURCE_QUALITY_REJECTED");
    const quality = sourceQuality({
      snapshot,
      canonicalUrl: fetched.canonicalUrl,
      locale: fetched.locale === "uzc" ? "uz" : fetched.locale,
      spans,
    });
    if (!quality.passed) throw new Error("LEGAL_SOURCE_QUALITY_REJECTED");
    const source: LegalSourceContext = {
      id: sourceId,
      actTitle: officialDisplayTitle(snapshot.documentTitle),
      actIdentifier: fetched.canonicalId,
      officialUrl: fetched.canonicalUrl,
      revisionDate: fetched.lastModified,
      lastCheckedAt: fetchedAt,
      locale: fetched.locale,
      publishedAt: null,
      sourceType: "lex",
      status: "verified",
      verificationState: "direct_validated",
      verifiedAt: fetchedAt,
      contentSha256: fetched.contentSha256,
      article: spans.find((span) => span.article)?.article ?? articleReference(snapshot.blocks),
      excerpt: spans.map((span) => span.text).join(" ").slice(0, 1_200) || relevantExcerpt(snapshot.plainText, this.terms),
      effectiveDate: null,
      applicabilityStatus: "current",
      spans,
      sourceQuality: quality,
    };
    return {
      source,
      evidence: {
        sourceId,
        sourceKind: "lex",
        canonicalUrl: fetched.canonicalUrl,
        contentSha256: fetched.contentSha256,
        retrievedAt: fetchedAt,
        validatedAt: fetchedAt,
        validationStatus: "validated",
      },
    };
  }
}

function publicErrorCode(error: unknown): string {
  const code = error instanceof Error ? error.message : "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE";
  const permitted: LegalSourceFetchErrorCode[] = [
    "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE", "LEGAL_SOURCE_ROBOTS_UNAVAILABLE",
    "LEGAL_SOURCE_ROBOTS_DISALLOWED", "LEGAL_SOURCE_ROBOTS_RATE_POLICY",
    "LEGAL_SOURCE_CRAWL_WINDOW_REQUIRED", "LEGAL_SOURCE_CONTENT_TYPE_REJECTED",
    "LEGAL_SOURCE_EMPTY_CONTENT", "LEGAL_SOURCE_TOO_LARGE", "LEGAL_SOURCE_TIMEOUT",
  ];
  return permitted.includes(code as LegalSourceFetchErrorCode)
    ? code
    : code.startsWith("LEGAL_SOURCE_SEARCH_")
      ? code
      : "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE";
}

export async function retrieveDirectLegalSources(
  question: string,
  locale: "ru" | "uz",
  options: {
    fetchImpl?: FetchLike;
    now?: () => Date;
    limit?: number;
    wait?: (delayMs: number) => Promise<void>;
    signal?: AbortSignal;
    budgetMs?: number;
    discoverOfficialUrls?: (
      query: string,
      locale: "ru" | "uz",
      signal: AbortSignal,
    ) => Promise<string[]>;
    /** Model-understood, request-scoped Lex searches. No topic dictionary is used. */
    searchQueries?: readonly string[] | Promise<readonly string[]>;
    knownOfficialUrls?: readonly string[];
  } = {},
): Promise<DirectLegalRetrieval> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? (() => new Date());
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const budgetMs = options.budgetMs ?? DIRECT_RETRIEVAL_BUDGET_MS;
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1) throw new TypeError("Invalid direct retrieval budget.");
  throwIfRequestAborted(options.signal);
  const budgetController = new AbortController();
  const budgetTimer = setTimeout(() => budgetController.abort(), budgetMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, budgetController.signal])
    : budgetController.signal;
  const boundedFetch = abortableFetch(fetchImpl, signal);
  const sources: LegalSourceContext[] = [];
  const evidence: DirectLegalSourceEvidence[] = [];
  const errors: Array<{ provider: DirectLegalSourceKind; code: string }> = [];
  const immediateQueries = Array.isArray(options.searchQueries)
    ? options.searchQueries
      .map((value) => value.replace(/\s+/gu, " ").trim().slice(0, 240))
      .filter(Boolean)
    : null;
  const initialQuery = immediateQueries?.[0] ?? question;
  const baseTerms = relevanceTerms([question, initialQuery].join(" "));
  const articleNumberRequested = detectArticleNumbers(question)[0] ?? null;
  try {
    // Start the original Lex request before semantic understanding resolves.
    // This removes a model round trip from the lexical path without weakening
    // later reranking: fetched documents still use the complete request-scoped
    // semantic vocabulary below.
    const initialProvider = new OfficialDirectProvider(
      "lex", locale, boundedFetch, now, wait, signal, articleNumberRequested, baseTerms,
    );
    const knownUrls = validatedOfficialDocumentUrls(options.knownOfficialUrls ?? [], locale).slice(0, MAX_CANDIDATES_PER_PROVIDER);
    const originalCandidates = (knownUrls.length ? Promise.resolve(knownUrls) : initialProvider.search(initialQuery, locale)).then(
      (candidates) => ({ candidates, error: null as unknown }),
      (error: unknown) => ({ candidates: [] as string[], error }),
    );
    const semanticQueries = (await Promise.resolve(options.searchQueries ?? []).catch(() => []))
      .map((value) => value.replace(/\s+/gu, " ").trim().slice(0, 240))
      .filter(Boolean);
    const queries = [...new Set([
      ...(immediateQueries?.length ? [] : [question]),
      ...semanticQueries,
    ]
      .filter((value): value is string => Boolean(value)))].slice(0, 4);
    if (queries.length === 0) queries.push(question);
    const terms = relevanceTerms([question, ...queries].join(" "));
    const provider = new OfficialDirectProvider(
      "lex", locale, boundedFetch, now, wait, signal, articleNumberRequested, terms, false,
      knownUrls.length ? Math.min(4_000, budgetMs) : 1_800,
    );
    const sourceLimit = Math.max(1, Math.min(options.limit ?? 4, 8));
    const seenUrls = new Set<string>();
    let ordinaryCandidatesReserved = 0;
    let discoveryCandidatesReserved = 0;
    let activeDocumentFetches = 0;
    const documentFetchWaiters: Array<() => void> = [];
    const acquireDocumentFetch = async () => {
      if (activeDocumentFetches >= MAX_CONCURRENT_DOCUMENT_FETCHES) {
        await new Promise<void>((resolve) => { documentFetchWaiters.push(resolve); });
      }
      activeDocumentFetches += 1;
    };
    const releaseDocumentFetch = () => {
      activeDocumentFetches = Math.max(0, activeDocumentFetches - 1);
      documentFetchWaiters.shift()?.();
    };
    const record = (fetched: PromiseSettledResult<{ source: LegalSourceContext; evidence: DirectLegalSourceEvidence }>) => {
      if (budgetController.signal.aborted || sources.length >= sourceLimit) return;
      if (fetched.status === "rejected") {
        errors.push({ provider: provider.kind, code: publicErrorCode(fetched.reason) });
        return;
      }
      if (!isRelevantDirectSource(fetched.value.source, terms)) return;
      if (sourceRank(fetched.value.source) < 0) return;
      sources.push(fetched.value.source);
      evidence.push(fetched.value.evidence);
    };
    const fetchCandidates = async (
      candidates: readonly string[],
      channel: "lex_search" | "agent_discovery" = "lex_search",
    ) => {
      const unseen = candidates.filter((candidate) => {
        if (seenUrls.has(candidate)) return false;
        if (channel === "agent_discovery") {
          if (discoveryCandidatesReserved >= MAX_CANDIDATES_PER_PROVIDER) return false;
          discoveryCandidatesReserved += 1;
        } else {
          // Keep title-search fan-out globally bounded while reserving a
          // separate candidate allowance for the semantic discovery agent.
          if (ordinaryCandidatesReserved >= MAX_CANDIDATES_PER_PROVIDER) return false;
          ordinaryCandidatesReserved += 1;
        }
        seenUrls.add(candidate);
        return true;
      });
      const fetched = await Promise.all(unseen.map(async (candidate): Promise<PromiseSettledResult<{
        source: LegalSourceContext;
        evidence: DirectLegalSourceEvidence;
      }>> => {
        await acquireDocumentFetch();
        try {
          if (budgetController.signal.aborted || sources.length >= sourceLimit) {
            return { status: "rejected", reason: new Error("LEGAL_SOURCE_TIMEOUT") };
          }
          try {
            return { status: "fulfilled", value: await provider.fetchDocument(candidate) };
          } catch (error) {
            return { status: "rejected", reason: error };
          }
        } finally {
          releaseDocumentFetch();
        }
      }));
      throwIfRequestAborted(options.signal);
      for (const result of fetched) record(result);
    };

    // Lex's own search is title-only and its title search alone surfaces
    // amendment/draft notices ahead of base acts. Run the already-started
    // original search, complementary semantic searches, and bounded official-
    // domain discovery as independent tool branches; all candidates converge
    // on the same canonical fetch and exact-span validation boundary.
    const branches = await Promise.allSettled([
      (async () => {
        const original = await originalCandidates;
        if (original.error) {
          errors.push({ provider: provider.kind, code: publicErrorCode(original.error) });
          return;
        }
        await fetchCandidates(original.candidates);
      })(),
      ...queries.slice(1).map(async (query) => {
        if (budgetController.signal.aborted || sources.length >= sourceLimit) return;
        try {
          await fetchCandidates(await provider.search(query, locale));
        } catch (error) {
          errors.push({ provider: provider.kind, code: publicErrorCode(error) });
        }
      }),
      (async () => {
        if (!options.discoverOfficialUrls || budgetController.signal.aborted) return;
        throwIfRequestAborted(options.signal);
        // Supply the agent all distinct request-scoped formulations in one
        // bounded prompt. It may refine web-search calls from their results,
        // while application code remains free of legal-topic vocabulary.
        const discoveryQuery = queries.join("\n").slice(0, 500);
        const discovered = validatedOfficialDocumentUrls(
          await options.discoverOfficialUrls(discoveryQuery || question, locale, signal),
          locale,
        );
        throwIfRequestAborted(options.signal);
        await fetchCandidates(discovered, "agent_discovery");
      })(),
    ]);
    for (const branch of branches) if (branch.status === "rejected") throw branch.reason;
    throwIfRequestAborted(options.signal);
  } catch (error) {
    throwIfRequestAborted(options.signal);
    errors.push({ provider: "lex", code: publicErrorCode(error) });
  } finally {
    clearTimeout(budgetTimer);
  }
  const retrievedAt = evidence.map((item) => item.retrievedAt).sort()[0] ?? null;
  const scored = sources
    .map((source, index) => ({
      source,
      evidence: evidence[index],
      score: sourceRank(source),
    }))
    .sort((left, right) => right.score - left.score);
  const bestScore = scored[0]?.score ?? Number.NEGATIVE_INFINITY;
  const ranked = scored
    // When a base code or law was fetched successfully, amendment notices and
    // parliamentary wrappers are not useful citation cards for the same query.
    .filter((item) => bestScore < 40 || item.score >= 25)
    .slice(0, Math.max(1, Math.min(options.limit ?? 4, 8)));
  const freshness = retrievedAt
    ? legalDatabaseFreshnessFromAsOf(retrievedAt, now())
    : legalDatabaseFreshnessFromAsOf("unavailable", now());
  return {
    sources: ranked.map((item) => item.source),
    evidence: ranked.flatMap((item) => item.evidence ? [item.evidence] : []),
    freshness,
    legalDatabaseAsOf: freshness.asOf,
    sourceAccessMode: "direct",
    sourcesRetrievedAt: retrievedAt,
    sourceValidationStatus: ranked.length > 0 ? "validated" : "unavailable",
    errors,
  };
}

/** Fetch one caller-selected canonical Lex document through the same SSRF,
 * robots, parsing, structure and quality gates as search retrieval. */
export async function fetchDirectOfficialLexDocument(
  url: string,
  locale: "ru" | "uz",
  options: {
    fetchImpl?: FetchLike;
    now?: () => Date;
    wait?: (delayMs: number) => Promise<void>;
    signal?: AbortSignal;
    budgetMs?: number;
    query?: string;
    completeArticle?: boolean;
  } = {},
): Promise<{ source: LegalSourceContext; evidence: DirectLegalSourceEvidence }> {
  const reference = classifyLegalSourceUrl(url);
  if (reference.sourceKind !== "lex" || reference.locale !== locale) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }
  const budgetMs = options.budgetMs ?? DIRECT_RETRIEVAL_BUDGET_MS;
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 1) throw new TypeError("Invalid direct retrieval budget.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const question = options.query?.trim() || reference.canonicalUrl;
  const wait = options.wait ?? ((delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  const terms = relevanceTerms(question);
  const articleNumberRequested = detectArticleNumbers(question)[0] ?? null;
  try {
    return await new OfficialDirectProvider(
      "lex",
      locale,
      abortableFetch(options.fetchImpl ?? fetch, signal),
      options.now ?? (() => new Date()),
      wait,
      signal,
      articleNumberRequested,
      terms,
      options.completeArticle ?? false,
      options.completeArticle ? Math.min(4_000, budgetMs) : 1_800,
    ).fetchDocument(reference.canonicalUrl);
  } finally {
    clearTimeout(timer);
  }
}
