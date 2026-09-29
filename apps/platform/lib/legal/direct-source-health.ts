/**
 * Health checks for the query-scoped legal source path.
 *
 * The probes deliberately request only public landing-page headers. They never
 * fetch, retain, index, or parse a legal document, so this operational module
 * cannot reintroduce an owned legal corpus.
 */
const HEALTH_TIMEOUT_MS = 10_000;
const FRESH_WITHIN_MS = 24 * 60 * 60 * 1_000;

export const directHealthKinds = ["lex"] as const;
export type DirectHealthKind = typeof directHealthKinds[number];
export type DirectHealthStatus = "healthy" | "unavailable";
export type DirectHealthState = "fresh" | "degraded" | "stale" | "unknown";

type DirectHealthCheck = {
  sourceKind: DirectHealthKind;
  status: DirectHealthStatus;
  checkedAt: string;
  latencyMs: number;
  errorCode: string | null;
  endpointUrl: string;
};

type HealthRow = DirectHealthCheck;

export type DirectLegalSourceHealth = {
  state: DirectHealthState;
  alertCode: "DIRECT_SOURCE_HEALTH_UNKNOWN" | "DIRECT_SOURCE_HEALTH_STALE" | "DIRECT_SOURCE_UNAVAILABLE" | null;
  checkedAt: string | null;
  ageMinutes: number | null;
  sources: DirectHealthCheck[];
};

const endpoints: Record<DirectHealthKind, string> = {
  // robots.txt currently redirects to the site's 404 page. Probe the canonical
  // landing page with HEAD, without retrieving or indexing legal content.
  lex: "https://lex.uz/uz/",
};

function publicHealthError(error: unknown): string {
  if (error instanceof Error && error.message === "DIRECT_SOURCE_HEALTH_TIMEOUT") {
    return error.message;
  }
  return "DIRECT_SOURCE_HEALTH_UNAVAILABLE";
}

async function boundedHealthFetch(
  sourceKind: DirectHealthKind,
  now: () => Date,
  fetchImpl: typeof fetch,
): Promise<DirectHealthCheck> {
  const endpointUrl = endpoints[sourceKind];
  const startedAt = now().getTime();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpointUrl, {
      method: "HEAD",
      // Cloudflare's fetch path does not consistently surface `redirect:
      // "error"` failures for an otherwise valid public HTTPS endpoint. Keep
      // redirects observable and reject them below instead of treating a
      // worker-runtime transport quirk as Lex unavailability.
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "text/plain;q=0.9,*/*;q=0.1",
        "user-agent": "JURO-LegalSourceHealth/1.0 (+https://juro.uz)",
      },
    });
    const contentType = response.headers.get("content-type")?.toLocaleLowerCase() ?? "";
    if (!response.ok || response.status >= 300 || !contentType.includes("text")) {
      try { await response.body?.cancel(); } catch { /* best effort */ }
      throw new Error("DIRECT_SOURCE_HEALTH_UNAVAILABLE");
    }
    try { await response.body?.cancel(); } catch { /* best effort */ }
    return {
      sourceKind,
      status: "healthy",
      checkedAt: now().toISOString(),
      latencyMs: Math.max(0, now().getTime() - startedAt),
      errorCode: null,
      endpointUrl,
    };
  } catch (error) {
    return {
      sourceKind,
      status: "unavailable",
      checkedAt: now().toISOString(),
      latencyMs: Math.max(0, now().getTime() - startedAt),
      errorCode: error instanceof DOMException && error.name === "AbortError"
        ? "DIRECT_SOURCE_HEALTH_TIMEOUT"
        : publicHealthError(error),
      endpointUrl,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function ageMinutes(checkedAt: string | null, now: Date): number | null {
  if (!checkedAt) return null;
  const timestamp = Date.parse(checkedAt);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now.getTime() - timestamp) / 60_000));
}

export function summarizeDirectLegalSourceHealth(
  rows: readonly HealthRow[],
  now = new Date(),
): DirectLegalSourceHealth {
  const latest = new Map<DirectHealthKind, HealthRow>();
  for (const row of rows) {
    if (!directHealthKinds.includes(row.sourceKind) || latest.has(row.sourceKind)) continue;
    latest.set(row.sourceKind, row);
  }
  const sources = directHealthKinds.map((sourceKind) => latest.get(sourceKind)).filter(
    (row): row is HealthRow => Boolean(row),
  );
  const checkedAt = sources.map((row) => row.checkedAt).sort().at(-1) ?? null;
  const checkedAgeMinutes = ageMinutes(checkedAt, now);
  if (sources.length < directHealthKinds.length) {
    return { state: "unknown", alertCode: "DIRECT_SOURCE_HEALTH_UNKNOWN", checkedAt, ageMinutes: checkedAgeMinutes, sources };
  }
  if (sources.some((source) => source.status !== "healthy")) {
    return { state: "degraded", alertCode: "DIRECT_SOURCE_UNAVAILABLE", checkedAt, ageMinutes: checkedAgeMinutes, sources };
  }
  if (checkedAgeMinutes === null || checkedAgeMinutes * 60_000 > FRESH_WITHIN_MS) {
    return { state: "stale", alertCode: "DIRECT_SOURCE_HEALTH_STALE", checkedAt, ageMinutes: checkedAgeMinutes, sources };
  }
  return { state: "fresh", alertCode: null, checkedAt, ageMinutes: checkedAgeMinutes, sources };
}

export async function readDirectLegalSourceHealth(
  db: D1Database,
  environment: string,
  now = new Date(),
): Promise<DirectLegalSourceHealth> {
  const rows = await db.prepare(
    `SELECT source_kind AS sourceKind,status,checked_at AS checkedAt,
            latency_ms AS latencyMs,error_code AS errorCode,endpoint_url AS endpointUrl
       FROM legal_source_health_checks
      WHERE environment=? AND source_kind='lex'
      ORDER BY checked_at DESC,id DESC
      LIMIT 24`,
  ).bind(environment).all<HealthRow>();
  return summarizeDirectLegalSourceHealth(rows.results, now);
}

export async function runDirectLegalSourceHealthCheck(input: {
  db: D1Database;
  environment: string;
  now?: () => Date;
  fetchImpl?: typeof fetch;
}): Promise<DirectLegalSourceHealth> {
  const now = input.now ?? (() => new Date());
  const fetchImpl = input.fetchImpl ?? fetch;
  const checks = await Promise.all(directHealthKinds.map((sourceKind) =>
    boundedHealthFetch(sourceKind, now, fetchImpl),
  ));
  await input.db.batch(checks.map((check) => input.db.prepare(
    `INSERT INTO legal_source_health_checks (
       id,environment,source_kind,status,checked_at,latency_ms,error_code,endpoint_url,created_at
     ) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).bind(
    crypto.randomUUID(),
    input.environment,
    check.sourceKind,
    check.status,
    check.checkedAt,
    check.latencyMs,
    check.errorCode,
    check.endpointUrl,
    check.checkedAt,
  )));
  return summarizeDirectLegalSourceHealth(checks, now());
}
