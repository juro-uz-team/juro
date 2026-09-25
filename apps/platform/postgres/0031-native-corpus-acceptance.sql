-- Native acceptance records attest qualification of immutable local releases.
-- Selection is append-only, so rollback retains the prior complete binding.
CREATE TABLE storage.native_corpus_acceptances (
  sha256 text PRIMARY KEY CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  manifest_bytes bytea NOT NULL,
  current_vector_generation uuid NOT NULL REFERENCES storage.vector_search_generations(id),
  history_vector_generation uuid NOT NULL REFERENCES storage.vector_search_generations(id),
  current_membership_generation uuid NOT NULL REFERENCES storage.corpus_membership_generations(id),
  history_membership_generation uuid NOT NULL REFERENCES storage.corpus_membership_generations(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (encode(sha256(manifest_bytes),'hex') = sha256)
);

CREATE TABLE storage.native_corpus_selections (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  acceptance_sha256 text NOT NULL REFERENCES storage.native_corpus_acceptances(sha256),
  selected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION storage.guard_native_corpus_acceptance_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'NATIVE_CORPUS_ACCEPTANCE_HISTORY_IMMUTABLE';
END;
$$;
CREATE TRIGGER native_corpus_acceptances_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON storage.native_corpus_acceptances
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_native_corpus_acceptance_history();
CREATE TRIGGER native_corpus_selections_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON storage.native_corpus_selections
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_native_corpus_acceptance_history();
