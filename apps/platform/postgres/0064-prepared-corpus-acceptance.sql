-- Prepared releases retain their own authenticated layout instead of claiming
-- membership in the retired vector generations.
CREATE TABLE storage.prepared_corpus_acceptances (
  sha256 text PRIMARY KEY CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  manifest_bytes bytea NOT NULL CHECK(octet_length(manifest_bytes) BETWEEN 1 AND 1048576),
  current_evidence_generation text NOT NULL REFERENCES storage.corpus_evidence_stores(generation_sha256),
  history_evidence_generation text NOT NULL REFERENCES storage.corpus_evidence_stores(generation_sha256),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(encode(sha256(manifest_bytes),'hex')=sha256)
);
CREATE TRIGGER prepared_corpus_acceptances_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON storage.prepared_corpus_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_native_corpus_acceptance_history();

ALTER TABLE storage.native_corpus_selections ALTER COLUMN acceptance_sha256 DROP NOT NULL;
ALTER TABLE storage.native_corpus_selections ADD COLUMN prepared_acceptance_sha256 text
  REFERENCES storage.prepared_corpus_acceptances(sha256);
ALTER TABLE storage.native_corpus_selections ADD CONSTRAINT corpus_selection_exactly_one_acceptance
  CHECK((acceptance_sha256 IS NOT NULL)::integer+(prepared_acceptance_sha256 IS NOT NULL)::integer=1);
