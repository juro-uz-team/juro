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
        normalized_text_sha256_v2 AS normalizedTextSha256V2,
        normalized_text_sha256_v2_observed_at AS v2ObservedAt,
        normalization_policy AS normalizationPolicy,normalization_policy_observed_at AS policyObservedAt, raw_content_sha256 AS rawContentSha256 FROM legal_publisher_status_observations WHERE official_url=?`)
        .bind(currentOfficialUrl(url)).first<Record<string, unknown>>();
      if (row && row.current !== 0 && row.current !== 1) throw new TypeError("SOURCE_OBSERVATION_INVALID");
      if (!row) return null;
      const {normalizedTextSha256V2, v2ObservedAt, normalizationPolicy,policyObservedAt,...original} = row;
      return sourceObservationSchema.parse({...original, current: row.current === 1,
        ...(normalizationPolicy===null||policyObservedAt!==row.observedAt?{}:{normalizationPolicy}),
        ...(normalizedTextSha256V2 === null || v2ObservedAt !== row.observedAt ? {} : {normalizedTextSha256V2})});
    },
    async put(value) {
      const observation = sourceObservationSchema.parse(value);
      currentOfficialUrl(observation.officialUrl);
      await db.prepare(`INSERT INTO legal_publisher_status_observations
        (official_url,observation_version,observed_at,is_current,normalized_text_sha256,raw_content_sha256,normalized_text_sha256_v2,normalized_text_sha256_v2_observed_at,normalization_policy,normalization_policy_observed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(official_url) DO UPDATE SET
          observation_version=excluded.observation_version,observed_at=excluded.observed_at,
          is_current=excluded.is_current,normalized_text_sha256=excluded.normalized_text_sha256,
          raw_content_sha256=excluded.raw_content_sha256,
          normalized_text_sha256_v2=excluded.normalized_text_sha256_v2,
          normalized_text_sha256_v2_observed_at=excluded.normalized_text_sha256_v2_observed_at,
          normalization_policy=excluded.normalization_policy,normalization_policy_observed_at=excluded.normalization_policy_observed_at
        WHERE legal_publisher_status_observations.observed_at<excluded.observed_at`).bind(
        observation.officialUrl, observation.version, observation.observedAt, observation.current ? 1 : 0,
        observation.normalizedTextSha256, observation.rawContentSha256, observation.normalizedTextSha256V2 ?? null,
        observation.normalizedTextSha256V2 ? observation.observedAt : null,
        observation.normalizationPolicy??null,observation.normalizationPolicy?observation.observedAt:null).run();
    },
  };
}
