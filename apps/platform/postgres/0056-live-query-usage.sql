-- Live retrieval records estimated provider exposure without requiring an
-- operator to provision a new allowance at each calendar boundary.
-- Existing capped evaluation and corpus-processing ledgers remain unchanged.
CREATE TABLE legal.legal_custom_query_usage (
  id text PRIMARY KEY,
  environment text NOT NULL CHECK (environment IN ('development','staging','production')),
  release_id text NOT NULL,
  estimated_usd_micros bigint NOT NULL CHECK (estimated_usd_micros > 0),
  query_count integer NOT NULL CHECK (query_count BETWEEN 1 AND 6),
  created_at text NOT NULL
);
CREATE INDEX legal_custom_query_usage_environment_time
  ON legal.legal_custom_query_usage(environment, created_at);
CREATE FUNCTION legal.preserve_custom_query_usage() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'LEGAL_CUSTOM_QUERY_USAGE_IMMUTABLE';
END;
$$;
CREATE TRIGGER legal_custom_query_usage_immutable
  BEFORE UPDATE OR DELETE ON legal.legal_custom_query_usage
  FOR EACH ROW EXECUTE FUNCTION legal.preserve_custom_query_usage();
