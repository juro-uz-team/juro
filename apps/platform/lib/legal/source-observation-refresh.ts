import {readLexPublisherObservation} from "./lex-document-status";
import {createD1SourceObservationStore} from "./source-observation-store";
import {isFreshSourceObservation, sourceObservationSchema, type SourceObservation} from "./source-observation";
import {createSharedSourceObservationRefresh} from "./shared-source-observation";

export const SOURCE_OBSERVATION_REFRESH_CRON = "* * * * *";

export async function reserveSourceObservationCrawlWindow(db: D1Database, delayMs: number, now: number): Promise<boolean> {
  if (!Number.isSafeInteger(delayMs) || delayMs < 1 || !Number.isFinite(now)) return false;
  const result = await db.prepare(`INSERT INTO legal_source_observation_crawl_windows(host,available_at)
    VALUES ('lex.uz',?) ON CONFLICT(host) DO UPDATE SET available_at=excluded.available_at
    WHERE legal_source_observation_crawl_windows.available_at<=?`).bind(
    new Date(now + delayMs).toISOString(), new Date(now).toISOString()).run();
  return Number(result.meta.changes ?? 0) === 1;
}

/** Work is selected from the public accepted-inventory registry, never from
 * private questions. Missing or stale observations still need on-demand recovery. */
export async function refreshPublicSourceObservations(input: {
  db: D1Database; now?: () => number; observe?: (url: string) => Promise<SourceObservation>;
  readPublisher?: (url:string,options:{wait:(delayMs:number)=>Promise<void>;previous?:SourceObservation})=>Promise<SourceObservation>;
}) {
  const now = input.now ?? Date.now;
  const started = performance.now();
  const store = createD1SourceObservationStore(input.db);
  const observe = createSharedSourceObservationRefresh({db: input.db, now, readPublisher: input.observe ?? ((url: string,previous?:SourceObservation) => (input.readPublisher ?? readLexPublisherObservation)(url, {previous,async wait(delayMs) {
    if (!await reserveSourceObservationCrawlWindow(input.db, delayMs, now())) {
      throw new Error("LEGAL_SOURCE_CRAWL_WINDOW_BUSY");
    }
  }}))});
  const due = await input.db.prepare(`SELECT official_url AS officialUrl FROM legal_source_observation_targets
    WHERE refresh_after<=? AND (lease_until IS NULL OR lease_until<=?)
    ORDER BY refresh_after,official_url LIMIT 16`).bind(new Date(now()).toISOString(), new Date(now()).toISOString())
    .all<{officialUrl: string}>();
  let claimed = 0, refreshed = 0, reused = 0, failed = 0;
  for (let offset = 0; offset < due.results.length; offset += 4) {
    await Promise.all(due.results.slice(offset, offset + 4).map(async ({officialUrl}) => {
      const token = crypto.randomUUID();
      const attempt = new Date(now()).toISOString();
      const lease = await input.db.prepare(`UPDATE legal_source_observation_targets
        SET lease_until=?,lease_token=?,last_attempt_at=? WHERE official_url=?
          AND refresh_after<=? AND (lease_until IS NULL OR lease_until<=?) RETURNING official_url`).bind(
        new Date(now() + 120_000).toISOString(), token, attempt, officialUrl, attempt, attempt).first();
      if (!lease) return;
      claimed++;
      try {
        const existing = await store.get(officialUrl);
        const recent = isFreshSourceObservation(existing, officialUrl, now())
          && now() - Date.parse(existing.observedAt) < 180_000;
        const observation = recent ? existing : sourceObservationSchema.parse(await observe(officialUrl));
        if (!isFreshSourceObservation(observation, officialUrl, now())) throw new Error("SOURCE_OBSERVATION_UNAVAILABLE");
        if (recent) reused++;
        else {await store.put(observation); refreshed++;}
        await input.db.prepare(`UPDATE legal_source_observation_targets
          SET refresh_after=?,lease_until=NULL,lease_token=NULL,last_error_code=NULL
          WHERE official_url=? AND lease_token=?`).bind(
          new Date(Date.parse(observation.observedAt) + 180_000).toISOString(), officialUrl, token).run();
      } catch (error) {
        failed++;
        const code = error instanceof Error && /^[A-Z_]{1,100}$/u.test(error.message)
          ? error.message : "SOURCE_OBSERVATION_REFRESH_FAILED";
        const window = code === "LEGAL_SOURCE_CRAWL_WINDOW_BUSY"
          ? await input.db.prepare("SELECT available_at AS availableAt FROM legal_source_observation_crawl_windows WHERE host='lex.uz'").bind()
            .first<{availableAt: string}>() : null;
        const retryAt = window && Date.parse(window.availableAt) > now() ? window.availableAt : new Date(now() + 60_000).toISOString();
        await input.db.prepare(`UPDATE legal_source_observation_targets
          SET refresh_after=?,lease_until=NULL,lease_token=NULL,last_error_code=?
          WHERE official_url=? AND lease_token=?`).bind(retryAt, code, officialUrl, token).run();
      }
    }));
  }
  const summary = {claimed, refreshed, reused, failed, elapsedMs: Math.round(performance.now() - started)};
  console.info(JSON.stringify({event: "legal.source_observations_refreshed", ...summary}));
  return summary;
}
