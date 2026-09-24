-- Optional parallel fingerprint for freshly captured superscript-preserving sources.
-- Existing observations remain bound to their original profile and timestamp.
ALTER TABLE legal.legal_publisher_status_observations
  ADD COLUMN normalized_text_sha256_v2 text;
