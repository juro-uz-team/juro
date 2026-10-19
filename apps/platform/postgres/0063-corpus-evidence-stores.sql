-- Saved citations bind a generation to its immutable evidence namespace.
CREATE TABLE storage.corpus_evidence_stores (
  generation_sha256 text PRIMARY KEY CHECK(generation_sha256 ~ '^[a-f0-9]{64}$'),
  namespace text NOT NULL UNIQUE CHECK(namespace ~ '^legal-prepared-[a-f0-9]{64}$'),
  manifest bytea NOT NULL CHECK(octet_length(manifest) BETWEEN 1 AND 1048576),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(encode(sha256(manifest),'hex')=generation_sha256)
);
CREATE TRIGGER corpus_evidence_stores_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON storage.corpus_evidence_stores
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_native_corpus_acceptance_history();
