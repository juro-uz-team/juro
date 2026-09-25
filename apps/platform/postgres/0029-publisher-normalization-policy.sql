-- Derived fingerprints may be reused only after freshly fetched complete HTML
-- matches and the normalizer implementation identity is unchanged. Timestamp
-- binding prevents an older writer from refreshing an unrelated policy proof.
ALTER TABLE legal.legal_publisher_status_observations
  ADD COLUMN normalization_policy text,
  ADD COLUMN normalization_policy_observed_at text;
