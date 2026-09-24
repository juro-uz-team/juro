CREATE TABLE storage.vector_search_generations (
  id uuid PRIMARY KEY,
  collection text NOT NULL REFERENCES storage.vector_collections(name) ON DELETE CASCADE,
  source_revision bigint NOT NULL CHECK(source_revision >= 0),
  state text NOT NULL DEFAULT 'building' CHECK(state IN ('building','verified','retired')),
  member_count bigint NOT NULL CHECK(member_count > 0),
  group_count bigint NOT NULL CHECK(group_count > 0 AND group_count <= member_count),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vector_search_generations_collection ON storage.vector_search_generations(collection,state);

CREATE TABLE storage.vector_search_groups (
  generation_id uuid NOT NULL REFERENCES storage.vector_search_generations(id) ON DELETE CASCADE,
  digest bytea NOT NULL CHECK(octet_length(digest)=32),
  embedding vector NOT NULL,
  coverage nummultirange,
  PRIMARY KEY(generation_id,digest)
);
CREATE TABLE storage.vector_search_members (
  generation_id uuid NOT NULL,
  id text NOT NULL,
  digest bytea NOT NULL,
  PRIMARY KEY(generation_id,id),
  FOREIGN KEY(generation_id,digest) REFERENCES storage.vector_search_groups(generation_id,digest) ON DELETE CASCADE
);
CREATE INDEX vector_search_members_group ON storage.vector_search_members(generation_id,digest);

-- Publication serializes with builders, and checks the unchanged original
-- identities and vector digests before permitting a searchable generation.
CREATE FUNCTION storage.validate_vector_generation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE source storage.vector_collections%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state='verified' THEN RAISE EXCEPTION 'VECTOR_GENERATION_MUST_RETIRE'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'building' THEN RAISE EXCEPTION 'VECTOR_GENERATION_NOT_BUILDING'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.collection,NEW.source_revision,NEW.member_count,NEW.group_count,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id,OLD.collection,OLD.source_revision,OLD.member_count,OLD.group_count,OLD.created_at) THEN
    RAISE EXCEPTION 'VECTOR_GENERATION_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.state=OLD.state THEN RETURN NEW; END IF;
  IF NEW.state='retired' AND OLD.state IN ('building','verified') THEN RETURN NEW; END IF;
  IF OLD.state<>'building' OR NEW.state<>'verified' THEN RAISE EXCEPTION 'VECTOR_GENERATION_TRANSITION_INVALID'; END IF;
  -- Builders hold a shared parent lock, but do not change its row version.
  -- An older repeatable-read snapshot could otherwise publish obsolete child
  -- contents after waiting for a concurrent builder to release that lock.
  -- Capture/build may use a snapshot; publication is a separate fresh check.
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'VECTOR_GENERATION_PUBLICATION_REQUIRES_READ_COMMITTED';
  END IF;
  SELECT * INTO STRICT source FROM storage.vector_collections WHERE name=NEW.collection FOR SHARE;
  IF source.source_revision<>NEW.source_revision THEN RAISE EXCEPTION 'VECTOR_GENERATION_SOURCE_CHANGED'; END IF;
  IF (SELECT count(*) FROM storage.embeddings WHERE collection=NEW.collection)<>NEW.member_count
    OR (SELECT count(*) FROM storage.vector_search_members WHERE generation_id=NEW.id)<>NEW.member_count
    OR (SELECT count(*) FROM storage.vector_search_groups WHERE generation_id=NEW.id)<>NEW.group_count THEN
    RAISE EXCEPTION 'VECTOR_GENERATION_COUNT_MISMATCH';
  END IF;
  IF EXISTS(SELECT 1 FROM storage.vector_search_groups g WHERE g.generation_id=NEW.id
    AND (vector_dims(g.embedding)<>source.dimensions OR sha256(vector_send(g.embedding))<>g.digest
      OR NOT EXISTS(SELECT 1 FROM storage.vector_search_members m WHERE m.generation_id=g.generation_id AND m.digest=g.digest))) THEN
    RAISE EXCEPTION 'VECTOR_GENERATION_GROUP_INVALID';
  END IF;
  IF EXISTS(SELECT 1 FROM storage.vector_search_members m
    LEFT JOIN storage.embeddings e ON e.collection=NEW.collection AND e.id=m.id
    WHERE m.generation_id=NEW.id AND (e.id IS NULL OR sha256(vector_send(e.embedding))<>m.digest)) THEN
    RAISE EXCEPTION 'VECTOR_GENERATION_MEMBER_INVALID';
  END IF;
  -- NULL coverage means no temporal acceleration. A non-NULL range union
  -- must cover every original interval, including gaps between revisions.
  IF EXISTS(SELECT 1 FROM storage.vector_search_members m
    JOIN storage.vector_search_groups g USING(generation_id,digest)
    JOIN storage.embeddings e ON e.collection=NEW.collection AND e.id=m.id
    WHERE m.generation_id=NEW.id AND g.coverage IS NOT NULL AND
    CASE WHEN jsonb_typeof(e.metadata->'valid_from_epoch')='number'
      AND jsonb_typeof(e.metadata->'valid_to_epoch')='number'
      AND (e.metadata->>'valid_from_epoch')::numeric < (e.metadata->>'valid_to_epoch')::numeric
    THEN NOT (g.coverage @> numrange((e.metadata->>'valid_from_epoch')::numeric,
      (e.metadata->>'valid_to_epoch')::numeric,'[)')) ELSE true END) THEN
    RAISE EXCEPTION 'VECTOR_GENERATION_TEMPORAL_COVERAGE_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vector_generation_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON storage.vector_search_generations
  FOR EACH ROW EXECUTE FUNCTION storage.validate_vector_generation();

CREATE FUNCTION storage.guard_vector_generation_data() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE generation uuid; generation_state text;
BEGIN
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'VECTOR_GENERATION_TRUNCATE_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' THEN generation:=OLD.generation_id;
  ELSE generation:=NEW.generation_id;
  END IF;
  IF TG_OP='UPDATE' AND NEW.generation_id<>OLD.generation_id THEN
    RAISE EXCEPTION 'VECTOR_GENERATION_IDENTITY_IMMUTABLE';
  END IF;
  SELECT state INTO generation_state FROM storage.vector_search_generations WHERE id=generation FOR SHARE;
  -- A missing parent is possible during its FK cascade. Verified parents
  -- cannot be deleted; building/retired parents can be cleaned up explicitly.
  IF TG_OP='DELETE' AND (generation_state IS NULL OR generation_state='retired') THEN RETURN OLD; END IF;
  IF generation_state IS DISTINCT FROM 'building' THEN RAISE EXCEPTION 'VECTOR_GENERATION_DATA_IMMUTABLE'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER vector_group_immutability BEFORE INSERT OR UPDATE OR DELETE ON storage.vector_search_groups
  FOR EACH ROW EXECUTE FUNCTION storage.guard_vector_generation_data();
CREATE TRIGGER vector_member_immutability BEFORE INSERT OR UPDATE OR DELETE ON storage.vector_search_members
  FOR EACH ROW EXECUTE FUNCTION storage.guard_vector_generation_data();
CREATE TRIGGER vector_group_truncation BEFORE TRUNCATE ON storage.vector_search_groups
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_vector_generation_data();
CREATE TRIGGER vector_member_truncation BEFORE TRUNCATE ON storage.vector_search_members
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_vector_generation_data();
