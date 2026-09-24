import { z } from "zod";

// Lex.uz exposes separate Uzbek Cyrillic URLs under `/uzc`.  Keep the
// concrete source locale instead of silently folding that official text into
// Uzbek Latin; callers map it to the BCP-47 `uz-Cyrl` corpus language.
const localeSchema = z.enum(["ru", "uz", "uzc", "en"]);

export type LegalSourceKind = "lex" | "advice";
export type LegalSourceLocale = z.infer<typeof localeSchema>;

export const LEGAL_SOURCE_FETCH_ERROR_CODES = [
  "LEGAL_SOURCE_URL_REJECTED",
  "LEGAL_SOURCE_POLICY_DISABLED",
  "LEGAL_SOURCE_REDIRECT_REJECTED",
  "LEGAL_SOURCE_REDIRECT_LIMIT",
  "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE",
  "LEGAL_SOURCE_ROBOTS_UNAVAILABLE",
  "LEGAL_SOURCE_ROBOTS_DISALLOWED",
  "LEGAL_SOURCE_ROBOTS_RATE_POLICY",
  "LEGAL_SOURCE_CRAWL_WINDOW_BUSY",
  "LEGAL_SOURCE_CRAWL_WINDOW_REQUIRED",
  "LEGAL_SOURCE_CONTENT_TYPE_REJECTED",
  "LEGAL_SOURCE_EMPTY_CONTENT",
  "LEGAL_SOURCE_TOO_LARGE",
  "LEGAL_SOURCE_ENCODING_REJECTED",
  "LEGAL_SOURCE_TIMEOUT",
] as const;

export type LegalSourceFetchErrorCode =
  (typeof LEGAL_SOURCE_FETCH_ERROR_CODES)[number];

export class LegalSourceFetchError extends Error {
  constructor(
    readonly code: LegalSourceFetchErrorCode,
    readonly retryable: boolean,
    readonly httpStatus: number | null = null,
  ) {
    super(code);
    this.name = "LegalSourceFetchError";
  }
}

export type LegalSourceReference = {
  sourceKind: LegalSourceKind;
  locale: LegalSourceLocale;
  canonicalId: string;
  canonicalUrl: string;
  host: string;
  revisionDate?: string;
};

export type FetchedLegalSource = LegalSourceReference & {
  bytes: Uint8Array;
  contentSha256: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
  fetchedAt: string;
  robotsUrl: string;
};

export type FetchedLexPdfRepresentation = LegalSourceReference & {
  bytes: Uint8Array;
  contentSha256: string;
  contentType: string;
  representationUrl: string;
  fetchedAt: string;
  robotsUrl: string;
};

export type FetchedLexArchiveRepresentation = LegalSourceReference & {
  bytes: Uint8Array;
  contentSha256: string;
  contentType: string;
  representationUrl: string;
  fetchedAt: string;
  robotsUrl: string;
};

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type FetchOptions = {
  adviceEnabled: boolean;
  fetchImpl?: FetchLike;
  now?: () => Date;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  wait?: (delayMs: number) => Promise<void>;
  /**
   * A user-initiated live lookup has a short response budget.  It still reads
   * robots rules and rejects a disallowed path, but it must not turn a
   * per-crawler crawl-delay into a 20+ second interactive legal answer.  The
   * scheduled ingestion path retains the conservative default and supplies a
   * host-paced wait function.
   */
  crawlDelayMode?: "wait" | "proceed";
};

type RobotsRule = {
  allow: boolean;
  pattern: string;
};

type RobotsGroup = {
  agents: string[];
  rules: RobotsRule[];
  crawlDelay: number | null;
};

const SOURCE_USER_AGENT =
  "JURO-LegalSourceSync/1.0 (+https://juro.uz)";
const SOURCE_USER_AGENT_TOKEN = "juro-legalsourcesync";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_ARCHIVE_MAX_BYTES = 20 * 1024 * 1024;
const ROBOTS_MAX_BYTES = 128 * 1024;
const DEFAULT_MAX_REDIRECTS = 2;
const MAX_ROBOTS_CRAWL_DELAY_SECONDS = 60;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function sourceHostKind(hostname: string): LegalSourceKind | null {
  const host = hostname.toLowerCase();
  if (host === "lex.uz" || host === "www.lex.uz") return "lex";
  if (host === "advice.uz" || host === "www.advice.uz") return "advice";
  return null;
}

function parseSourcePath(url: URL, sourceKind: LegalSourceKind): {
  locale: LegalSourceLocale;
  canonicalId: string;
  adviceRoute?: "document" | "documents";
} | null {
  if (sourceKind === "lex") {
    const localized = /^\/(ru|uz|uzc|en)\/docs\/(-?\d+)\/?$/.exec(url.pathname);
    const cyrillic = /^\/docs\/(-?\d+)\/?$/.exec(url.pathname);
    const locale = localeSchema.safeParse(localized?.[1] ?? (cyrillic ? "uzc" : null));
    const canonicalId = localized?.[2] ?? cyrillic?.[1];
    if (!locale.success || !canonicalId) return null;
    return { locale: locale.data, canonicalId };
  }

  const match = /^\/(ru|oz)\/(document|documents)\/(\d+)\/?$/.exec(
    url.pathname,
  );
  if (!match?.[3]) return null;
  return {
    locale: match[1] === "ru" ? "ru" : "uz",
    canonicalId: match[3],
    // Advice.uz currently serves /document/:id in search results, while
    // older official links retain /documents/:id. Keep the supplied official
    // route canonical so historical links remain valid without inventing a
    // redirect target.
    adviceRoute: match[2] as "document" | "documents",
  };
}

function hasAllowedAdviceCardQuery(url: URL): boolean {
  if (url.search === "") return true;
  const entries = [...url.searchParams.entries()];
  return entries.length === 1
    && entries[0]?.[0] === "keyword"
    && entries[0][1].length > 0
    && entries[0][1].length <= 240;
}

function allowedLexRevisionQuery(url: URL): { raw: string; iso: string } | null {
  if (!url.search) return null;
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 1 || entries[0]?.[0] !== "ONDATE") return null;
  const raw = entries[0][1];
  const match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s\d{2})?$/u.exec(raw);
  if (!match) return null;
  const [, day, month, year] = match;
  const iso = `${year}-${month}-${day}`;
  const candidate = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(candidate.getTime()) || candidate.toISOString().slice(0, 10) !== iso) return null;
  return { raw, iso };
}

export function classifyLegalSourceUrl(value: string): LegalSourceReference {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }

  const sourceKind = sourceHostKind(url.hostname);
  if (
    url.protocol !== "https:" ||
    url.port !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    // Advice search result cards currently retain a harmless `keyword` query.
    // It is stripped before any source fetch. Lex document URLs do not permit
    // a query string at all.
    (url.search !== ""
      && (sourceKind === "lex"
        ? !allowedLexRevisionQuery(url)
        : sourceKind !== "advice" || !hasAllowedAdviceCardQuery(url)))
  ) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }

  if (!sourceKind) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }
  const path = parseSourcePath(url, sourceKind);
  if (!path) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }

  const canonicalHost = sourceKind === "lex" ? "lex.uz" : "advice.uz";
  const canonicalPath = sourceKind === "lex"
    ? path.locale === "uzc"
      ? `/docs/${path.canonicalId.replace(/^-/, "")}`
      : `/${path.locale}/docs/${path.canonicalId}`
    : `/${path.locale === "ru" ? "ru" : "oz"}/${path.adviceRoute ?? "documents"}/${path.canonicalId}`;
  const revision = sourceKind === "lex" ? allowedLexRevisionQuery(url) : null;
  return {
    sourceKind,
    locale: path.locale,
    canonicalId: path.canonicalId,
    canonicalUrl: `https://${canonicalHost}${canonicalPath}${revision ? `?ONDATE=${encodeURIComponent(revision.raw)}` : ""}`,
    host: canonicalHost,
    ...(revision ? { revisionDate: revision.iso } : {}),
  };
}

function sameSourceReference(
  expected: LegalSourceReference,
  candidate: LegalSourceReference,
): boolean {
  return expected.sourceKind === candidate.sourceKind
    && expected.locale === candidate.locale
    && expected.canonicalId === candidate.canonicalId
    && expected.canonicalUrl === candidate.canonicalUrl;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best effort after a rejected response.
  }
}

function timeoutSignal(timeoutMs: number): {
  signal: AbortSignal;
  clear: () => void;
} {
  const controller = new AbortController();
  const handle = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(handle),
  };
}

async function fetchOnce(
  fetchImpl: FetchLike,
  url: URL,
  timeoutMs: number,
  accept: string,
): Promise<Response> {
  const timeout = timeoutSignal(timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      headers: {
        Accept: accept,
        "User-Agent": SOURCE_USER_AGENT,
      },
      signal: timeout.signal,
    });
  } catch (error) {
    if (
      timeout.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    ) {
      throw new LegalSourceFetchError("LEGAL_SOURCE_TIMEOUT", true);
    }
    throw new LegalSourceFetchError("LEGAL_SOURCE_UPSTREAM_UNAVAILABLE", true);
  } finally {
    timeout.clear();
  }
}

async function fetchFollowingRedirects(
  initialUrl: URL,
  options: {
    fetchImpl: FetchLike;
    timeoutMs: number;
    maxRedirects: number;
    accept: string;
    allowNotFound?: boolean;
    validateUrl: (url: URL) => boolean;
    unavailableCode:
      | "LEGAL_SOURCE_ROBOTS_UNAVAILABLE"
      | "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE";
  },
): Promise<{ response: Response; finalUrl: URL }> {
  let currentUrl = initialUrl;
  for (let redirects = 0; redirects <= options.maxRedirects; redirects += 1) {
    const response = await fetchOnce(
      options.fetchImpl,
      currentUrl,
      options.timeoutMs,
      options.accept,
    );
    if (!REDIRECT_STATUSES.has(response.status)) {
      if (options.allowNotFound && response.status === 404) return { response, finalUrl: currentUrl };
      if (!response.ok) {
        await cancelBody(response);
        const retryable = response.status === 408
          || response.status === 425
          || response.status === 429
          || response.status >= 500;
        throw new LegalSourceFetchError(options.unavailableCode, retryable, response.status);
      }
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers.get("location");
    await cancelBody(response);
    if (!location) {
      throw new LegalSourceFetchError("LEGAL_SOURCE_REDIRECT_REJECTED", false);
    }
    if (redirects === options.maxRedirects) {
      throw new LegalSourceFetchError("LEGAL_SOURCE_REDIRECT_LIMIT", false);
    }

    let nextUrl: URL;
    try {
      nextUrl = new URL(location, currentUrl);
    } catch {
      throw new LegalSourceFetchError("LEGAL_SOURCE_REDIRECT_REJECTED", false);
    }
    if (!options.validateUrl(nextUrl)) {
      throw new LegalSourceFetchError("LEGAL_SOURCE_REDIRECT_REJECTED", false);
    }
    currentUrl = nextUrl;
  }
  throw new LegalSourceFetchError("LEGAL_SOURCE_REDIRECT_LIMIT", false);
}

function responseContentType(response: Response): {
  mediaType: string;
  charset: string | null;
  raw: string;
} {
  const raw = response.headers.get("content-type")?.trim() ?? "";
  const [mediaTypePart = "", ...parameters] = raw.split(";");
  let charset: string | null = null;
  for (const parameter of parameters) {
    const [name, value] = parameter.trim().split("=", 2);
    if (name?.toLowerCase() === "charset" && value) {
      charset = value.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
    }
  }
  return { mediaType: mediaTypePart.trim().toLowerCase(), charset, raw };
}

export async function readBoundedLegalSourceBytes(
  response: Response,
  maxBytes: number,
  timeoutMs: number,
): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    await cancelBody(response);
    throw new LegalSourceFetchError("LEGAL_SOURCE_TOO_LARGE", false);
  }
  if (!response.body) {
    return new Uint8Array();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await new Promise<ReadableStreamReadResult<Uint8Array>>(
        (resolve, reject) => {
          const timeoutHandle = setTimeout(() => {
            reject(new LegalSourceFetchError("LEGAL_SOURCE_TIMEOUT", true));
          }, timeoutMs);
          reader.read().then(
            (result) => {
              clearTimeout(timeoutHandle);
              resolve(result);
            },
            () => {
              clearTimeout(timeoutHandle);
              reject(new LegalSourceFetchError(
                "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE",
                true,
              ));
            },
          );
        },
      );
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new LegalSourceFetchError("LEGAL_SOURCE_TOO_LARGE", false);
      }
      chunks.push(value);
    }
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Cancellation is best effort after a body read failure.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LegalSourceFetchError("LEGAL_SOURCE_ENCODING_REJECTED", false);
  }
}

function parseRobots(value: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let hasDirectives = false;

  for (const rawLine of value.split(/\r?\n/)) {
    const withoutComment = rawLine.split("#", 1)[0]?.trim() ?? "";
    if (!withoutComment) {
      if (current && hasDirectives) {
        current = null;
        hasDirectives = false;
      }
      continue;
    }
    const separator = withoutComment.indexOf(":");
    if (separator <= 0) continue;
    const key = withoutComment.slice(0, separator).trim().toLowerCase();
    const directive = withoutComment.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (!current || hasDirectives) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
        hasDirectives = false;
      }
      current.agents.push(directive.toLowerCase());
      continue;
    }
    if (!current || current.agents.length === 0) continue;
    if (key === "allow" || key === "disallow") {
      hasDirectives = true;
      if (key === "disallow" && directive === "") continue;
      current.rules.push({ allow: key === "allow", pattern: directive });
      continue;
    }
    if (key === "crawl-delay") {
      hasDirectives = true;
      const seconds = Number(directive);
      if (Number.isFinite(seconds) && seconds >= 0) {
        current.crawlDelay = seconds;
      }
    }
  }
  return groups;
}

function selectedRobotsGroups(groups: RobotsGroup[]): RobotsGroup[] {
  const exact = groups.filter((group) =>
    group.agents.includes(SOURCE_USER_AGENT_TOKEN)
  );
  if (exact.length > 0) return exact;
  return groups.filter((group) => group.agents.includes("*"));
}

function escapeRegex(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function robotsPattern(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const expression = escapeRegex(body).replaceAll("*", ".*");
  return new RegExp(`^${expression}${anchored ? "$" : ""}`);
}

function robotsAllows(groups: RobotsGroup[], url: URL): {
  allowed: boolean;
  crawlDelay: number;
} {
  const selected = selectedRobotsGroups(groups);
  if (selected.length === 0) return { allowed: true, crawlDelay: 0 };
  const target = `${url.pathname}${url.search}`;
  const matchingRules = selected.flatMap((group) => group.rules)
    .filter((rule) => robotsPattern(rule.pattern).test(target))
    .sort((left, right) => {
      const specificity = (value: string) =>
        value.replaceAll("*", "").replace(/\$$/, "").length;
      const difference = specificity(right.pattern) - specificity(left.pattern);
      if (difference !== 0) return difference;
      return Number(right.allow) - Number(left.allow);
    });
  const crawlDelay = Math.max(
    0,
    ...selected.map((group) => group.crawlDelay ?? 0),
  );
  return { allowed: matchingRules[0]?.allow ?? true, crawlDelay };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digestBytes = Uint8Array.from(bytes);
  const digest = await crypto.subtle.digest("SHA-256", digestBytes.buffer);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function fetchLegalSource(
  value: string,
  options: FetchOptions,
): Promise<FetchedLegalSource> {
  const reference = classifyLegalSourceUrl(value);
  // Product policy is fail-closed: Advice.uz is retained only as a legacy
  // metadata discriminator for old rows. No runtime path may read it, even if
  // an obsolete environment flag is accidentally enabled.
  if (reference.sourceKind === "advice") {
    throw new LegalSourceFetchError("LEGAL_SOURCE_POLICY_DISABLED", false);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (
    timeoutMs < 1 || maxBytes < 1 || maxRedirects < 0
    || !Number.isSafeInteger(timeoutMs)
    || !Number.isSafeInteger(maxBytes)
    || !Number.isSafeInteger(maxRedirects)
  ) {
    throw new TypeError("Invalid legal source fetch limits.");
  }

  const robotsInitialUrl = new URL(`https://${reference.host}/robots.txt`);
  const robotsResult = await fetchFollowingRedirects(robotsInitialUrl, {
    fetchImpl,
    timeoutMs,
    maxRedirects,
    accept: "*/*",
    allowNotFound: true,
    unavailableCode: "LEGAL_SOURCE_ROBOTS_UNAVAILABLE",
    validateUrl(candidate) {
      return candidate.protocol === "https:"
        && candidate.port === ""
        && candidate.username === ""
        && candidate.password === ""
        && sourceHostKind(candidate.hostname) === reference.sourceKind
        && (candidate.pathname === "/robots.txt"
          || (candidate.origin === robotsInitialUrl.origin && candidate.pathname === "/Pages/404.aspx"))
        && candidate.search === ""
        && candidate.hash === "";
    },
  });
  const robotsType = responseContentType(robotsResult.response);
  const robotsMissing = robotsResult.response.status === 404;
  if (
    !robotsMissing && (robotsType.mediaType !== "text/plain"
    || (robotsType.charset && !["utf-8", "utf8"].includes(robotsType.charset)))
  ) {
    await cancelBody(robotsResult.response);
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_UNAVAILABLE", false);
  }
  if (robotsMissing) await cancelBody(robotsResult.response);
  const robotsBytes = robotsMissing ? new Uint8Array() : await readBoundedLegalSourceBytes(
    robotsResult.response,
    ROBOTS_MAX_BYTES,
    timeoutMs,
  );
  const robots = robotsAllows(
    parseRobots(decodeUtf8(robotsBytes)),
    new URL(reference.canonicalUrl),
  );
  if (!robots.allowed) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_DISALLOWED", false);
  }
  if (robots.crawlDelay > MAX_ROBOTS_CRAWL_DELAY_SECONDS) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_RATE_POLICY", false);
  }
  const requestedDelaySeconds = robots.crawlDelay;
  if (requestedDelaySeconds > 0 && options.crawlDelayMode !== "proceed") {
    if (!options.wait) {
      throw new LegalSourceFetchError(
        "LEGAL_SOURCE_CRAWL_WINDOW_REQUIRED",
        true,
      );
    }
    await options.wait(Math.ceil(requestedDelaySeconds * 1_000));
  }

  const contentResult = await fetchFollowingRedirects(
    new URL(reference.canonicalUrl),
    {
      fetchImpl,
      timeoutMs,
      maxRedirects,
      accept: "text/html;charset=UTF-8",
      unavailableCode: "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE",
      validateUrl(candidate) {
        if (
          candidate.protocol !== "https:"
          || candidate.port !== ""
          || candidate.username !== ""
          || candidate.password !== ""
          || candidate.hash !== ""
        ) return false;
        try {
          return sameSourceReference(reference, classifyLegalSourceUrl(candidate.href));
        } catch {
          return false;
        }
      },
    },
  );
  const contentReference = classifyLegalSourceUrl(contentResult.finalUrl.href);
  if (!sameSourceReference(reference, contentReference)) {
    await cancelBody(contentResult.response);
    throw new LegalSourceFetchError("LEGAL_SOURCE_REDIRECT_REJECTED", false);
  }
  const contentType = responseContentType(contentResult.response);
  if (
    contentType.mediaType !== "text/html"
    || (contentType.charset && !["utf-8", "utf8"].includes(contentType.charset))
  ) {
    await cancelBody(contentResult.response);
    throw new LegalSourceFetchError(
      "LEGAL_SOURCE_CONTENT_TYPE_REJECTED",
      false,
    );
  }

  const bytes = await readBoundedLegalSourceBytes(
    contentResult.response,
    maxBytes,
    timeoutMs,
  );
  if (bytes.byteLength === 0) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_EMPTY_CONTENT", false);
  }
  decodeUtf8(bytes);
  return {
    ...reference,
    canonicalUrl: contentReference.canonicalUrl,
    bytes,
    contentSha256: await sha256(bytes),
    contentType: contentType.raw || "text/html; charset=utf-8",
    etag: contentResult.response.headers.get("etag"),
    lastModified: contentResult.response.headers.get("last-modified"),
    fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
    robotsUrl: robotsResult.finalUrl.href,
  };
}

/**
 * Fetch an official Lex PDF representation from a canonical Lex citation.
 * This endpoint is deliberately not accepted as an input URL: callers retain
 * the canonical /:locale/docs/:id citation and the derived PDF path is exact.
 */
export async function fetchLexPdfRepresentation(
  canonicalUrl: string,
  options: Pick<
    FetchOptions,
    "fetchImpl" | "now" | "timeoutMs" | "maxBytes" | "maxRedirects" | "wait"
  >,
): Promise<FetchedLexPdfRepresentation> {
  const reference = classifyLegalSourceUrl(canonicalUrl);
  if (reference.sourceKind !== "lex") {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (
    timeoutMs < 1 || maxBytes < 1 || maxRedirects < 0
    || !Number.isSafeInteger(timeoutMs)
    || !Number.isSafeInteger(maxBytes)
    || !Number.isSafeInteger(maxRedirects)
  ) {
    throw new TypeError("Invalid Lex PDF fetch limits.");
  }

  const representationId = reference.canonicalId.replace(/^-/, "");
  if (!/^\d+$/.test(representationId)) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }
  const representationUrl = new URL(
    `https://${reference.host}/pdffile/${representationId}`,
  );
  const robotsInitialUrl = new URL(`https://${reference.host}/robots.txt`);
  const robotsResult = await fetchFollowingRedirects(robotsInitialUrl, {
    fetchImpl,
    timeoutMs,
    maxRedirects,
    accept: "*/*",
    allowNotFound: true,
    unavailableCode: "LEGAL_SOURCE_ROBOTS_UNAVAILABLE",
    validateUrl(candidate) {
      return candidate.protocol === "https:"
        && candidate.port === ""
        && candidate.username === ""
        && candidate.password === ""
        && sourceHostKind(candidate.hostname) === "lex"
        && (candidate.pathname === "/robots.txt"
          || (candidate.origin === robotsInitialUrl.origin && candidate.pathname === "/Pages/404.aspx"))
        && candidate.search === ""
        && candidate.hash === "";
    },
  });
  const robotsType = responseContentType(robotsResult.response);
  const robotsMissing=robotsResult.response.status===404;
  if (
    !robotsMissing && (robotsType.mediaType !== "text/plain"
    || (robotsType.charset && !["utf-8", "utf8"].includes(robotsType.charset)))
  ) {
    await cancelBody(robotsResult.response);
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_UNAVAILABLE", false);
  }
  if(robotsMissing)await cancelBody(robotsResult.response);
  const robotsBytes = robotsMissing?new Uint8Array():await readBoundedLegalSourceBytes(
    robotsResult.response,
    ROBOTS_MAX_BYTES,
    timeoutMs,
  );
  const robots = robotsAllows(
    parseRobots(decodeUtf8(robotsBytes)),
    representationUrl,
  );
  if (!robots.allowed) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_DISALLOWED", false);
  }
  if (robots.crawlDelay > MAX_ROBOTS_CRAWL_DELAY_SECONDS) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_RATE_POLICY", false);
  }
  if (robots.crawlDelay > 0) {
    if (!options.wait) {
      throw new LegalSourceFetchError("LEGAL_SOURCE_CRAWL_WINDOW_REQUIRED", true);
    }
    await options.wait(Math.ceil(robots.crawlDelay * 1_000));
  }

  const contentResult = await fetchFollowingRedirects(representationUrl, {
    fetchImpl,
    timeoutMs,
    maxRedirects,
    accept: "application/pdf",
    unavailableCode: "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE",
    validateUrl(candidate) {
      return candidate.protocol === "https:"
        && candidate.port === ""
        && candidate.username === ""
        && candidate.password === ""
        && sourceHostKind(candidate.hostname) === "lex"
        && candidate.pathname === `/pdffile/${representationId}`
        && candidate.search === ""
        && candidate.hash === "";
    },
  });
  const contentType = responseContentType(contentResult.response);
  if (contentType.mediaType !== "application/pdf") {
    await cancelBody(contentResult.response);
    throw new LegalSourceFetchError("LEGAL_SOURCE_CONTENT_TYPE_REJECTED", false);
  }
  const bytes = await readBoundedLegalSourceBytes(contentResult.response, maxBytes, timeoutMs);
  if (
    bytes.byteLength < 5
    || String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-"
  ) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_CONTENT_TYPE_REJECTED", false);
  }
  return {
    ...reference,
    bytes,
    contentSha256: await sha256(bytes),
    contentType: contentType.raw || "application/pdf",
    representationUrl: contentResult.finalUrl.href,
    fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
    robotsUrl: robotsResult.finalUrl.href,
  };
}

/**
 * Fetches a ZIP representation that was discovered on the already-fetched
 * canonical Lex page.  The linked URL is never model-generated: it must be an
 * exact same-origin `/files/<number>.zip` path and every redirect is pinned to
 * that same immutable path.  ZIP structure is validated by the caller before
 * any member is extracted.
 */
export async function fetchLexArchiveRepresentation(
  canonicalUrl: string,
  representationValue: string,
  options: Pick<
    FetchOptions,
    "fetchImpl" | "now" | "timeoutMs" | "maxBytes" | "maxRedirects" | "wait"
  >,
): Promise<FetchedLexArchiveRepresentation> {
  const reference = classifyLegalSourceUrl(canonicalUrl);
  if (reference.sourceKind !== "lex") {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }
  let representationUrl: URL;
  try {
    representationUrl = new URL(representationValue);
  } catch {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }
  const archivePath = /^\/files\/\d+\.zip$/iu;
  if (
    representationUrl.protocol !== "https:"
    || representationUrl.hostname.toLowerCase() !== reference.host
    || representationUrl.port !== ""
    || representationUrl.username !== ""
    || representationUrl.password !== ""
    || representationUrl.search !== ""
    || representationUrl.hash !== ""
    || !archivePath.test(representationUrl.pathname)
  ) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_URL_REJECTED", false);
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_ARCHIVE_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  if (
    timeoutMs < 1 || maxBytes < 1 || maxRedirects < 0
    || !Number.isSafeInteger(timeoutMs)
    || !Number.isSafeInteger(maxBytes)
    || !Number.isSafeInteger(maxRedirects)
  ) {
    throw new TypeError("Invalid Lex archive fetch limits.");
  }

  const robotsInitialUrl = new URL(`https://${reference.host}/robots.txt`);
  const robotsResult = await fetchFollowingRedirects(robotsInitialUrl, {
    fetchImpl,
    timeoutMs,
    maxRedirects,
    accept: "*/*",
    unavailableCode: "LEGAL_SOURCE_ROBOTS_UNAVAILABLE",
    validateUrl(candidate) {
      return candidate.protocol === "https:"
        && candidate.port === ""
        && candidate.username === ""
        && candidate.password === ""
        && sourceHostKind(candidate.hostname) === "lex"
        && candidate.pathname === "/robots.txt"
        && candidate.search === ""
        && candidate.hash === "";
    },
  });
  const robotsType = responseContentType(robotsResult.response);
  if (
    robotsType.mediaType !== "text/plain"
    || (robotsType.charset && !["utf-8", "utf8"].includes(robotsType.charset))
  ) {
    await cancelBody(robotsResult.response);
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_UNAVAILABLE", false);
  }
  const robotsBytes = await readBoundedLegalSourceBytes(
    robotsResult.response,
    ROBOTS_MAX_BYTES,
    timeoutMs,
  );
  const robots = robotsAllows(parseRobots(decodeUtf8(robotsBytes)), representationUrl);
  if (!robots.allowed) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_DISALLOWED", false);
  }
  if (robots.crawlDelay > MAX_ROBOTS_CRAWL_DELAY_SECONDS) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_ROBOTS_RATE_POLICY", false);
  }
  if (robots.crawlDelay > 0) {
    if (!options.wait) {
      throw new LegalSourceFetchError("LEGAL_SOURCE_CRAWL_WINDOW_REQUIRED", true);
    }
    await options.wait(Math.ceil(robots.crawlDelay * 1_000));
  }

  const expectedPath = representationUrl.pathname;
  const contentResult = await fetchFollowingRedirects(representationUrl, {
    fetchImpl,
    timeoutMs,
    maxRedirects,
    accept: "application/zip,application/octet-stream",
    unavailableCode: "LEGAL_SOURCE_UPSTREAM_UNAVAILABLE",
    validateUrl(candidate) {
      return candidate.protocol === "https:"
        && candidate.port === ""
        && candidate.username === ""
        && candidate.password === ""
        && sourceHostKind(candidate.hostname) === "lex"
        && candidate.pathname === expectedPath
        && candidate.search === ""
        && candidate.hash === "";
    },
  });
  const contentType = responseContentType(contentResult.response);
  if (![
    "application/zip",
    "application/x-zip-compressed",
    "application/octet-stream",
  ].includes(contentType.mediaType)) {
    await cancelBody(contentResult.response);
    throw new LegalSourceFetchError("LEGAL_SOURCE_CONTENT_TYPE_REJECTED", false);
  }
  const bytes = await readBoundedLegalSourceBytes(contentResult.response, maxBytes, timeoutMs);
  const zipMagic = bytes.byteLength >= 4
    && bytes[0] === 0x50
    && bytes[1] === 0x4b
    && ((bytes[2] === 0x03 && bytes[3] === 0x04)
      || (bytes[2] === 0x05 && bytes[3] === 0x06)
      || (bytes[2] === 0x07 && bytes[3] === 0x08));
  if (!zipMagic) {
    throw new LegalSourceFetchError("LEGAL_SOURCE_CONTENT_TYPE_REJECTED", false);
  }
  return {
    ...reference,
    bytes,
    contentSha256: await sha256(bytes),
    contentType: contentType.raw || "application/zip",
    representationUrl: contentResult.finalUrl.href,
    fetchedAt: (options.now ?? (() => new Date()))().toISOString(),
    robotsUrl: robotsResult.finalUrl.href,
  };
}
