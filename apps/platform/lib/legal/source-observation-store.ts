import {classifyLegalSourceUrl} from "./source-fetch";
import {sourceObservationSchema, type SourceObservationStore} from "./source-observation";

function currentOfficialUrl(value: string): string {
  const reference = classifyLegalSourceUrl(value);
  if (reference.sourceKind !== "lex" || reference.revisionDate || reference.canonicalUrl !== value) {
    throw new TypeError("SOURCE_OBSERVATION_IDENTITY_INVALID");
  }
  return reference.canonicalUrl;
}

export function createD1SourceObservationStore(db: D1Database): SourceObservationStore {
  return {
    async get(url) {
      const row = await db.prepare(`SELECT observation_version AS version, official_url AS officialUrl,
        observed_at AS observedAt, is_current AS current, normalized_text_sha256 AS normalizedTextSha256,
        raw_content_sha256 AS rawContentSha256 FROM legal_publisher_status_observations WHERE official_url=?`)
        .bind(currentOfficialUrl(url)).first<Record<string, unknown>>();
      if (row && row.current !== 0 && row.current !== 1) throw new TypeError("SOURCE_OBSERVATION_INVALID");
      return row ? sourceObservationSchema.parse({...row, current: row.current === 1}) : null;
    },
    async put(value) {
      const observation = sourceObservationSchema.parse(value);
      currentOfficialUrl(observation.officialUrl);
      await db.prepare(`INSERT INTO legal_publisher_status_observations
        (official_url,observation_version,observed_at,is_current,normalized_text_sha256,raw_content_sha256)
        VALUES (?,?,?,?,?,?) ON CONFLICT(official_url) DO UPDATE SET
          observation_version=excluded.observation_version,observed_at=excluded.observed_at,
          is_current=excluded.is_current,normalized_text_sha256=excluded.normalized_text_sha256,
          raw_content_sha256=excluded.raw_content_sha256
        WHERE legal_publisher_status_observations.observed_at<excluded.observed_at`).bind(
        observation.officialUrl, observation.version, observation.observedAt, observation.current ? 1 : 0,
        observation.normalizedTextSha256, observation.rawContentSha256).run();
    },
  };
}
