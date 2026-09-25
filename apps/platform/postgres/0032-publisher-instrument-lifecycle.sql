-- Publisher lifecycle facts belong to the same raw response and observation
-- time; an older writer cannot carry them forward to a different observation.
ALTER TABLE legal.legal_publisher_status_observations
  ADD COLUMN lifecycle_repealed_on text,
  ADD COLUMN lifecycle_observed_at text;
