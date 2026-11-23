import { classifyLegalSourceUrl, type LegalSourceReference } from "./source-fetch";

export const LEGAL_SOURCE_DISCOVERY_ERROR_CODES = [
  "LEGAL_SOURCE_DISCOVERY_UNAVAILABLE",
  "LEGAL_SOURCE_DISCOVERY_REDIRECT_REJECTED",
  "LEGAL_SOURCE_DISCOVERY_CONTENT_TYPE_REJECTED",
  "LEGAL_SOURCE_DISCOVERY_TOO_LARGE",
  "LEGAL_SOURCE_DISCOVERY_ENCODING_REJECTED",
  "LEGAL_SOURCE_DISCOVERY_TIMEOUT",
  "LEGAL_SOURCE_DISCOVERY_RATE_POLICY",
  "LEGAL_SOURCE_DISCOVERY_CRAWL_WINDOW_REQUIRED",
] as const;

export type LegalSourceDiscoveryErrorCode =
  (typeof LEGAL_SOURCE_DISCOVERY_ERROR_CODES)[number];

export class LegalSourceDiscoveryError extends Error {
  constructor(readonly code: LegalSourceDiscoveryErrorCode, readonly retryable: boolean) {
    super(code);
    this.name = "LegalSourceDiscoveryError";
  }
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type AdviceSitemapDiscovery = {
  candidates: LegalSourceReference[];
  robotsUrl: string;
  sitemapUrls: string[];
  fetchedAt: string;
};

export type LexRssDiscovery = {
  candidates: LegalSourceReference[];
  entries: Array<{
    reference: LegalSourceReference;
    title: string | null;
    publishedAt: string | null;
  }>;
  robotsUrl: string;
  rssUrls: string[];
  fetchedAt: string;
  crawlDelaySeconds: number;
};

const USER_AGENT = "JURO-LegalSourceSync/1.0 (+https://juro.uz)";
const USER_AGENT_TOKEN = "juro-legalsourcesync";
const ADVICE_ROBOTS_URL = "https://advice.uz/robots.txt";
const LEX_ROBOTS_URL = "https://lex.uz/robots.txt";
const LEX_RSS_URLS = ["https://lex.uz/ru/rss", "https://lex.uz/uz/rss"] as const;
const MAX_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_DOCUMENTS = 20;
const DEFAULT_MAX_LEX_DOCUMENTS = 40;
const MAX_CRAWL_DELAY_SECONDS = 60;
const ACCEPT_XML = "application/xml, text/xml;q=0.9, */*;q=0.1";
const ACCEPT_RSS = "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1";

function isAllowedSitemapUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "advice.uz"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && (url.pathname === "/sitemap.xml" || /^\/documents_(?:ru|uz)\.xml$/.test(url.pathname));
  } catch {
    return false;
  }
}

function contentType(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";", 1)[0]!.trim().toLowerCase();
}

async function readText(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await response.body?.cancel();
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_TOO_LARGE", false);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_TOO_LARGE", false);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_ENCODING_REJECTED", false);
  }
}

async function fetchBounded(
  fetchImpl: FetchLike,
  url: string,
  accept: string,
  timeoutMs: number,
  allowNotFound = false,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: { Accept: accept, "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      if (allowNotFound && url === LEX_ROBOTS_URL
        && response.headers.get("location") === "https://lex.uz/Pages/404.aspx") {
        return fetchBounded(fetchImpl, "https://lex.uz/Pages/404.aspx", accept, timeoutMs, true);
      }
      throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_REDIRECT_REJECTED", false);
    }
    if (!response.ok && !(allowNotFound && response.status === 404)) {
      await response.body?.cancel();
      throw new LegalSourceDiscoveryError(
        "LEGAL_SOURCE_DISCOVERY_UNAVAILABLE",
        response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500,
      );
    }
    return response;
  } catch (error) {
    if (error instanceof LegalSourceDiscoveryError) throw error;
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_TIMEOUT", true);
    }
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_UNAVAILABLE", true);
  } finally {
    clearTimeout(timeout);
  }
}

function sitemapLocations(xml: string): string[] {
  const locations: string[] = [];
  const expression = /<loc(?:\s[^>]*)?>\s*([^<\s][^<]*?)\s*<\/loc>/gi;
  for (const match of xml.matchAll(expression)) {
    const value = match[1]?.trim();
    if (value) locations.push(value);
  }
  return locations;
}

function robotsSitemaps(robots: string): string[] {
  return robots.split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .flatMap((line) => {
      const match = /^sitemap\s*:\s*(\S+)$/i.exec(line);
      return match?.[1] ? [match[1]] : [];
    });
}

type RobotsDelayGroup = {
  agents: string[];
  crawlDelay: number | null;
};

function robotsCrawlDelaySeconds(robots: string): number {
  const groups: RobotsDelayGroup[] = [];
  let current: RobotsDelayGroup | null = null;
  let hasDirectives = false;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      if (current && hasDirectives) {
        current = null;
        hasDirectives = false;
      }
      continue;
    }
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") {
      if (!current || hasDirectives) {
        current = { agents: [], crawlDelay: null };
        groups.push(current);
        hasDirectives = false;
      }
      current.agents.push(value.toLowerCase());
      continue;
    }
    if (key !== "crawl-delay" || !current || current.agents.length === 0) continue;
    hasDirectives = true;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) current.crawlDelay = seconds;
  }
  const exact = groups.filter((group) => group.agents.includes(USER_AGENT_TOKEN));
  const selected = exact.length > 0
    ? exact
    : groups.filter((group) => group.agents.includes("*"));
  return Math.max(0, ...selected.map((group) => group.crawlDelay ?? 0));
}

async function honorCrawlDelay(
  delaySeconds: number,
  wait: ((delayMs: number) => Promise<void>) | undefined,
): Promise<void> {
  if (delaySeconds <= 0) return;
  if (delaySeconds > MAX_CRAWL_DELAY_SECONDS) {
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_RATE_POLICY", false);
  }
  if (!wait) {
    throw new LegalSourceDiscoveryError(
      "LEGAL_SOURCE_DISCOVERY_CRAWL_WINDOW_REQUIRED",
      true,
    );
  }
  await wait(Math.ceil(delaySeconds * 1_000));
}

function isAllowedLexRssUrl(value: string): boolean {
  return LEX_RSS_URLS.includes(value as (typeof LEX_RSS_URLS)[number]);
}

function decodeXmlText(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gu, "$1")
    .replace(/<[^>]+>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function itemValue(item: string, tag: "title" | "link" | "pubDate"): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "iu").exec(item);
  const value = match?.[1] ? decodeXmlText(match[1]) : "";
  return value || null;
}

function rssMetadataEntries(xml: string): Array<{ link: string; title: string | null; publishedAt: string | null }> {
  if (!/<rss(?:\s|>)/i.test(xml) || !/<channel(?:\s|>)/i.test(xml)) {
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_UNAVAILABLE", false);
  }
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/giu)].flatMap((match) => {
    const item = match[1] ?? "";
    const link = itemValue(item, "link");
    if (!link) return [];
    const publishedRaw = itemValue(item, "pubDate");
    const timestamp = publishedRaw ? Date.parse(publishedRaw) : NaN;
    return [{
      link: link.replaceAll("&amp;", "&"),
      title: itemValue(item, "title"),
      publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
    }];
  });
}

export async function discoverAdviceSitemapDocuments(options: {
  fetchImpl?: FetchLike;
  now?: () => Date;
  maxDocuments?: number;
  timeoutMs?: number;
  wait?: (delayMs: number) => Promise<void>;
} = {}): Promise<AdviceSitemapDiscovery> {
  // Kept as a typed compatibility export for callers compiled against the
  // old ingestion subsystem. It must never perform network I/O.
  throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_UNAVAILABLE", false);
  /* c8 ignore start -- permanently disabled legacy implementation */
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxDocuments = options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 100 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("Invalid legal source discovery limits.");
  }
  const robotsResponse = await fetchBounded(fetchImpl, ADVICE_ROBOTS_URL, "text/plain, */*;q=0.1", timeoutMs);
  if (contentType(robotsResponse) !== "text/plain") {
    await robotsResponse.body?.cancel();
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_CONTENT_TYPE_REJECTED", false);
  }
  const robots = await readText(robotsResponse, MAX_BYTES);
  const crawlDelaySeconds = robotsCrawlDelaySeconds(robots);
  const roots = robotsSitemaps(robots).filter(isAllowedSitemapUrl);
  if (roots.length === 0) {
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_UNAVAILABLE", false);
  }

  const sitemapUrls: string[] = [];
  const candidates = new Map<string, LegalSourceReference>();
  const pending = [...new Set(roots)];
  while (pending.length > 0 && candidates.size < maxDocuments && sitemapUrls.length < 3) {
    const sitemap = pending.shift()!;
    if (!isAllowedSitemapUrl(sitemap) || sitemapUrls.includes(sitemap)) continue;
    await honorCrawlDelay(crawlDelaySeconds, options.wait);
    const response = await fetchBounded(fetchImpl, sitemap, ACCEPT_XML, timeoutMs);
    const mediaType = contentType(response);
    if (mediaType !== "application/xml" && mediaType !== "text/xml") {
      await response.body?.cancel();
      throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_CONTENT_TYPE_REJECTED", false);
    }
    sitemapUrls.push(sitemap);
    for (const location of sitemapLocations(await readText(response, MAX_BYTES))) {
      if (isAllowedSitemapUrl(location) && sitemapUrls.length + pending.length < 3) {
        pending.push(location);
        continue;
      }
      try {
        const source = classifyLegalSourceUrl(location);
        if (source.sourceKind === "advice") candidates.set(source.canonicalUrl, source);
      } catch {
        // Sitemap entries outside JURO's strict source allowlist are ignored.
      }
      if (candidates.size >= maxDocuments) break;
    }
  }
  return {
    candidates: [...candidates.values()],
    robotsUrl: ADVICE_ROBOTS_URL,
    sitemapUrls,
    fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
  };
  /* c8 ignore stop */
}

export async function discoverLexRssDocuments(options: {
  fetchImpl?: FetchLike;
  now?: () => Date;
  maxDocuments?: number;
  timeoutMs?: number;
  wait?: (delayMs: number) => Promise<void>;
} = {}): Promise<LexRssDiscovery> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxDocuments = options.maxDocuments ?? DEFAULT_MAX_LEX_DOCUMENTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(maxDocuments) || maxDocuments < 1 || maxDocuments > 100
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1
  ) {
    throw new TypeError("Invalid legal source discovery limits.");
  }

  const robotsResponse = await fetchBounded(
    fetchImpl,
    LEX_ROBOTS_URL,
    "text/plain, */*;q=0.1",
    timeoutMs,
    true,
  );
  const hasRobots = robotsResponse.status !== 404;
  if (hasRobots && contentType(robotsResponse) !== "text/plain") {
    await robotsResponse.body?.cancel();
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_CONTENT_TYPE_REJECTED", false);
  }
  if (!hasRobots) await robotsResponse.body?.cancel();
  const robots = hasRobots ? await readText(robotsResponse, MAX_BYTES) : "";
  const crawlDelaySeconds = robotsCrawlDelaySeconds(robots);
  if (crawlDelaySeconds > MAX_CRAWL_DELAY_SECONDS) {
    throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_RATE_POLICY", false);
  }

  const candidates = new Map<string, LegalSourceReference>();
  const entries = new Map<string, LexRssDiscovery["entries"][number]>();
  const rssUrls: string[] = [];
  const perFeedLimit = Math.ceil(maxDocuments / LEX_RSS_URLS.length);
  for (const rssUrl of LEX_RSS_URLS) {
    if (candidates.size >= maxDocuments) break;
    if (!isAllowedLexRssUrl(rssUrl)) continue;
    await honorCrawlDelay(crawlDelaySeconds, options.wait);
    const response = await fetchBounded(fetchImpl, rssUrl, ACCEPT_RSS, timeoutMs);
    const mediaType = contentType(response);
    if (!["application/rss+xml", "application/xml", "text/xml"].includes(mediaType)) {
      await response.body?.cancel();
      throw new LegalSourceDiscoveryError("LEGAL_SOURCE_DISCOVERY_CONTENT_TYPE_REJECTED", false);
    }
    rssUrls.push(rssUrl);
    let feedCandidates = 0;
    for (const entry of rssMetadataEntries(await readText(response, MAX_BYTES))) {
      try {
        const absolute = new URL(entry.link, rssUrl);
        const source = classifyLegalSourceUrl(absolute.href);
        if (source.sourceKind !== "lex" || source.locale !== (rssUrl.includes("/ru/") ? "ru" : "uz")) {
          continue;
        }
        if (!candidates.has(source.canonicalUrl)) feedCandidates += 1;
        candidates.set(source.canonicalUrl, source);
        if (!entries.has(source.canonicalUrl)) {
          entries.set(source.canonicalUrl, {
            reference: source,
            title: entry.title,
            publishedAt: entry.publishedAt,
          });
        }
      } catch {
        // RSS entries outside JURO's exact Lex document allowlist are ignored.
      }
      if (feedCandidates >= perFeedLimit || candidates.size >= maxDocuments) break;
    }
  }
  return {
    candidates: [...candidates.values()].slice(0, maxDocuments),
    entries: [...entries.values()].slice(0, maxDocuments),
    robotsUrl: LEX_ROBOTS_URL,
    rssUrls,
    fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
    crawlDelaySeconds,
  };
}
