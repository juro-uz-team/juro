-- Retain immutable acceptance/generation identities, not retired source payloads.
CREATE TABLE storage.corpus_retirements (
  acceptance_sha256 text PRIMARY KEY REFERENCES storage.native_corpus_acceptances(sha256),
  inventory_sha256 text NOT NULL CHECK(inventory_sha256 ~ '^[a-f0-9]{64}$'),
  inventory_manifest bytea NOT NULL CHECK(octet_length(inventory_manifest) BETWEEN 1 AND 1048576),
  retired_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK(encode(sha256(inventory_manifest),'hex')=inventory_sha256)
);

-- Exact store/key/content identity prevents a later namespace from aliasing old evidence.
CREATE TABLE storage.retired_corpus_objects (
  namespace text NOT NULL,
  object_key text NOT NULL,
  content_sha256 text NOT NULL CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
  acceptance_sha256 text NOT NULL REFERENCES storage.corpus_retirements(acceptance_sha256),
  PRIMARY KEY(namespace,object_key,content_sha256)
);
CREATE TRIGGER corpus_retirements_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON storage.corpus_retirements
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_native_corpus_acceptance_history();
CREATE TRIGGER retired_corpus_objects_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON storage.retired_corpus_objects
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_native_corpus_acceptance_history();

CREATE TABLE storage.retired_corpus_stores (
  kind text NOT NULL CHECK(kind IN ('vector','object','membership')),
  identity text NOT NULL,
  acceptance_sha256 text NOT NULL REFERENCES storage.corpus_retirements(acceptance_sha256),
  PRIMARY KEY(kind,identity)
);
CREATE TRIGGER retired_corpus_stores_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON storage.retired_corpus_stores
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_native_corpus_acceptance_history();

CREATE FUNCTION storage.prevent_retired_corpus_write() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE store_kind text; store_id text; previous_id text;
BEGIN
  IF TG_TABLE_NAME='objects' THEN store_kind:='object'; store_id:=NEW.bucket;
    IF TG_OP='UPDATE' THEN previous_id:=OLD.bucket; END IF;
  ELSIF TG_TABLE_NAME='corpus_membership_generations' THEN store_kind:='membership'; store_id:=NEW.release_id;
  ELSIF TG_TABLE_NAME='vector_collections' THEN store_kind:='vector'; store_id:=NEW.name;
    IF TG_OP='UPDATE' THEN previous_id:=OLD.name; END IF;
  ELSE store_kind:='vector'; store_id:=NEW.collection;
    IF TG_OP='UPDATE' THEN previous_id:=OLD.collection; END IF;
  END IF;
  IF EXISTS(SELECT 1 FROM storage.retired_corpus_stores WHERE kind=store_kind AND identity IN (store_id,previous_id)) THEN
    -- Deleting old embeddings advances the source revision through an existing
    -- statement trigger. Permit that bookkeeping without restoring readiness.
    IF TG_TABLE_NAME='vector_collections' AND TG_OP='UPDATE' THEN
      IF NEW.ready=false AND OLD.ready=false
        AND (to_jsonb(NEW)-'source_revision')=(to_jsonb(OLD)-'source_revision')
        AND NEW.source_revision>=OLD.source_revision THEN RETURN NEW; END IF;
    END IF;
    RAISE EXCEPTION 'RETIRED_CORPUS_WRITE_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER retired_corpus_object_write_guard BEFORE INSERT OR UPDATE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION storage.prevent_retired_corpus_write();
CREATE TRIGGER retired_corpus_embedding_write_guard BEFORE INSERT OR UPDATE ON storage.embeddings
  FOR EACH ROW EXECUTE FUNCTION storage.prevent_retired_corpus_write();
CREATE TRIGGER retired_corpus_collection_write_guard BEFORE INSERT OR UPDATE ON storage.vector_collections
  FOR EACH ROW EXECUTE FUNCTION storage.prevent_retired_corpus_write();
CREATE TRIGGER retired_corpus_vector_generation_guard BEFORE INSERT ON storage.vector_search_generations
  FOR EACH ROW EXECUTE FUNCTION storage.prevent_retired_corpus_write();
CREATE TRIGGER retired_corpus_membership_generation_guard BEFORE INSERT ON storage.corpus_membership_generations
  FOR EACH ROW EXECUTE FUNCTION storage.prevent_retired_corpus_write();

CREATE FUNCTION storage.prevent_retired_corpus_selection() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('native-corpus-selection',0));
  IF EXISTS(SELECT 1 FROM storage.corpus_retirements WHERE acceptance_sha256=NEW.acceptance_sha256) THEN
    RAISE EXCEPTION 'NATIVE_CORPUS_RETIRED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER native_corpus_selection_retirement_guard
  BEFORE INSERT ON storage.native_corpus_selections
  FOR EACH ROW EXECUTE FUNCTION storage.prevent_retired_corpus_selection();

CREATE FUNCTION storage.lock_corpus_retirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('native-corpus-selection',0));
  RETURN NEW;
END;
$$;
CREATE TRIGGER corpus_retirement_selection_lock
  BEFORE INSERT ON storage.corpus_retirements
  FOR EACH ROW EXECUTE FUNCTION storage.lock_corpus_retirement();
