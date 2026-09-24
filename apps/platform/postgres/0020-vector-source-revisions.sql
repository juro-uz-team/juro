-- Derived search generations must bind to this revision in the same snapshot
-- as their original-vector reads. Application-only invalidation misses SQL
-- imports, metadata edits, collection moves and administrative truncation.
ALTER TABLE storage.vector_collections
  ADD COLUMN source_revision bigint NOT NULL DEFAULT 0 CHECK (source_revision >= 0);

CREATE FUNCTION storage.advance_inserted_vector_sources() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_name text;
BEGIN
  FOR source_name IN SELECT DISTINCT collection FROM inserted_vectors ORDER BY collection LOOP
    UPDATE storage.vector_collections SET source_revision=source_revision+1 WHERE name=source_name;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION storage.advance_deleted_vector_sources() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_name text;
BEGIN
  FOR source_name IN SELECT DISTINCT collection FROM deleted_vectors ORDER BY collection LOOP
    UPDATE storage.vector_collections SET source_revision=source_revision+1 WHERE name=source_name;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION storage.advance_updated_vector_sources() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_name text;
BEGIN
  FOR source_name IN
    SELECT collection FROM previous_vectors UNION SELECT collection FROM updated_vectors ORDER BY collection
  LOOP
    UPDATE storage.vector_collections SET source_revision=source_revision+1 WHERE name=source_name;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION storage.advance_truncated_vector_sources() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source_name text;
BEGIN
  FOR source_name IN SELECT name FROM storage.vector_collections ORDER BY name LOOP
    UPDATE storage.vector_collections SET source_revision=source_revision+1 WHERE name=source_name;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION storage.advance_vector_configuration() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.source_revision < OLD.source_revision THEN
    RAISE EXCEPTION 'VECTOR_SOURCE_REVISION_CANNOT_DECREASE';
  END IF;
  IF ROW(NEW.name,NEW.dimensions,NEW.metric,NEW.model)
     IS DISTINCT FROM ROW(OLD.name,OLD.dimensions,OLD.metric,OLD.model) THEN
    NEW.source_revision := GREATEST(NEW.source_revision,OLD.source_revision+1);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER embeddings_inserted_revision AFTER INSERT ON storage.embeddings
  REFERENCING NEW TABLE AS inserted_vectors FOR EACH STATEMENT
  EXECUTE FUNCTION storage.advance_inserted_vector_sources();
CREATE TRIGGER embeddings_deleted_revision AFTER DELETE ON storage.embeddings
  REFERENCING OLD TABLE AS deleted_vectors FOR EACH STATEMENT
  EXECUTE FUNCTION storage.advance_deleted_vector_sources();
CREATE TRIGGER embeddings_updated_revision AFTER UPDATE ON storage.embeddings
  REFERENCING OLD TABLE AS previous_vectors NEW TABLE AS updated_vectors FOR EACH STATEMENT
  EXECUTE FUNCTION storage.advance_updated_vector_sources();
CREATE TRIGGER embeddings_truncated_revision AFTER TRUNCATE ON storage.embeddings
  FOR EACH STATEMENT EXECUTE FUNCTION storage.advance_truncated_vector_sources();
CREATE TRIGGER vector_configuration_revision BEFORE UPDATE ON storage.vector_collections
  FOR EACH ROW EXECUTE FUNCTION storage.advance_vector_configuration();
