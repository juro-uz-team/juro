-- Old application writers do not know the additional fingerprint. Bind it to
-- the precise observation so their later writes cannot refresh a stale hash.
ALTER TABLE legal.legal_publisher_status_observations
  ADD COLUMN normalized_text_sha256_v2_observed_at text;
