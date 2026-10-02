import {classifyLegalSourceUrl} from "./source-fetch";
import {finishIndexedRetrievalCleanup, indexedRetrievalRemainingMs} from "../runtime/indexed-retrieval";
import {readLexPublisherObservation} from "./lex-document-status";
import {createD1SourceObservationStore} from "./source-observation-store";
import {createSourceObservationReader, isFreshSourceObservation, sourceObservationSchema, type SourceObservation} from "./source-observation";

export function createSharedSourceObservationRefresh(input: {
  db: D1Database; readPublisher?: (url: string,previous?:SourceObservation) => Promise<SourceObservation>;
  now?: () => number; wait?: () => Promise<void>;
}) {
  const now = input.now ?? Date.now;
  const wait = input.wait ?? (() => new Promise<void>(resolve => setTimeout(resolve, 250)));
  const store = createD1SourceObservationStore(input.db);
  return async (url: string): Promise<SourceObservation> => {
    const reference = classifyLegalSourceUrl(url);
    if (reference.sourceKind !== "lex" || reference.revisionDate || reference.canonicalUrl !== url) {
      throw new TypeError("SOURCE_OBSERVATION_IDENTITY_INVALID");
    }
    const startedAt = now();
    const previous = await store.get(url);
    if (isFreshSourceObservation(previous, url, now()) && now() - Date.parse(previous.observedAt) < 180_000) return previous;
    const previousObservedAt = isFreshSourceObservation(previous, url, now()) ? Date.parse(previous.observedAt) : Number.NEGATIVE_INFINITY;
    const token = crypto.randomUUID();
    const lease = await input.db.prepare(`INSERT INTO legal_source_observation_refresh_leases
      (official_url,lease_token,lease_until) VALUES (?,?,?) ON CONFLICT(official_url) DO UPDATE SET
        lease_token=excluded.lease_token,lease_until=excluded.lease_until
      WHERE legal_source_observation_refresh_leases.lease_until<=?`).bind(
      url, token, new Date(startedAt + 20_000).toISOString(), new Date(startedAt).toISOString()).run();
    if (Number(lease.meta.changes ?? 0) !== 1) {
      // Join an existing public refresh; never duplicate its publisher request.
      const joinedAt = now();
      const waitBudget = indexedRetrievalRemainingMs();
      for (let attempt = 0; attempt < Math.ceil(waitBudget / 250) && now() - joinedAt < waitBudget; attempt++) {
        indexedRetrievalRemainingMs();
        await wait();
        indexedRetrievalRemainingMs();
        const observation = await store.get(url);
        if (isFreshSourceObservation(observation, url, now()) && Date.parse(observation.observedAt) > previousObservedAt) return observation;
        const owner = await input.db.prepare("SELECT lease_token FROM legal_source_observation_refresh_leases WHERE official_url=? AND lease_until>?")
          .bind(url, new Date(now()).toISOString()).first();
        if (!owner) {
          // The owner may publish and release between our observation and lease reads.
          const completed = await store.get(url);
          if (isFreshSourceObservation(completed, url, now()) && Date.parse(completed.observedAt) > previousObservedAt) return completed;
          throw new TypeError("SOURCE_OBSERVATION_REFRESH_UNAVAILABLE");
        }
      }
      throw new TypeError("SOURCE_OBSERVATION_REFRESH_UNAVAILABLE");
    }
    let ownershipLost = false;
    let renewal = Promise.resolve();
    const renew = async () => {
      const at = now();
      const result = await input.db.prepare(`UPDATE legal_source_observation_refresh_leases SET lease_until=?
        WHERE official_url=? AND lease_token=? AND lease_until>?`).bind(
        new Date(at + 20_000).toISOString(), url, token, new Date(at).toISOString()).run();
      if (Number(result.meta.changes ?? 0) !== 1) throw new TypeError("SOURCE_OBSERVATION_REFRESH_OWNERSHIP_LOST");
    };
    const timer = setInterval(() => {
      renewal = renewal.then(renew).catch(() => {ownershipLost = true;});
    }, 5_000);
    try {
      // Another owner may have completed between our initial read and acquisition.
      const completed = await store.get(url);
      if (isFreshSourceObservation(completed, url, now())
        && (Date.parse(completed.observedAt) > previousObservedAt || now() - Date.parse(completed.observedAt) < 180_000)) return completed;
      const prior=sourceObservationSchema.safeParse(completed??previous);
      const observation = sourceObservationSchema.parse(await (input.readPublisher
        ?input.readPublisher(url,prior.success?prior.data:undefined)
        :readLexPublisherObservation(url,{previous:prior.success?prior.data:undefined})));
      if (!isFreshSourceObservation(observation, url, now())) throw new TypeError("SOURCE_OBSERVATION_UNAVAILABLE");
      await renewal;
      if (ownershipLost) throw new TypeError("SOURCE_OBSERVATION_REFRESH_OWNERSHIP_LOST");
      await renew();
      await store.put(observation);
      return observation;
    } finally {
      clearInterval(timer);
      await renewal;
      await finishIndexedRetrievalCleanup(()=>input.db.prepare("DELETE FROM legal_source_observation_refresh_leases WHERE official_url=? AND lease_token=?")
        .bind(url, token).run());
    }
  };
}

export function createSharedLexDocumentObservationReader(db: D1Database,readPublisher?: (url:string,previous?:SourceObservation)=>Promise<SourceObservation>) {
  return createSourceObservationReader({store: createD1SourceObservationStore(db),
    readPublisher: createSharedSourceObservationRefresh({db,readPublisher})});
}
