-- Retain authenticated source bytes alongside the derived point lookup. A
-- generation becomes visible only after exhaustive parity against its pages.
CREATE TABLE storage.corpus_membership_generations (
  id uuid PRIMARY KEY,
  release_id text NOT NULL,
  inventory_release_id text NOT NULL,
  source_inventory_sha256 text NOT NULL CHECK(source_inventory_sha256 ~ '^[a-f0-9]{64}$'),
  source_manifest bytea NOT NULL CHECK(octet_length(source_manifest)<=262144),
  member_count integer NOT NULL CHECK(member_count>0),
  state text NOT NULL DEFAULT 'building' CHECK(state IN ('building','verified','retired')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corpus_membership_generation_source
  ON storage.corpus_membership_generations(release_id,source_inventory_sha256,state);
CREATE TABLE storage.corpus_membership_pages (
  generation_id uuid NOT NULL REFERENCES storage.corpus_membership_generations(id) ON DELETE CASCADE,
  partition text NOT NULL CHECK(partition ~ '^[0-3][a-f0-9]$'),
  content bytea NOT NULL CHECK(octet_length(content)<=67108864),
  PRIMARY KEY(generation_id,partition)
);
CREATE TABLE storage.corpus_members (
  generation_id uuid NOT NULL REFERENCES storage.corpus_membership_generations(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  ordinal bigint NOT NULL CHECK(ordinal>=0),
  member jsonb NOT NULL,
  PRIMARY KEY(generation_id,item_key),
  UNIQUE(generation_id,ordinal),
  CHECK(member->>'itemKey' IS NOT DISTINCT FROM item_key),
  CHECK((member->>'ordinal')::bigint IS NOT DISTINCT FROM ordinal)
);

CREATE FUNCTION storage.guard_corpus_membership_data() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner uuid; owner_state text;
BEGIN
  IF TG_OP='TRUNCATE' THEN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_TRUNCATE_FORBIDDEN'; END IF;
  IF TG_OP='DELETE' THEN owner:=OLD.generation_id; ELSE owner:=NEW.generation_id; END IF;
  IF TG_OP='UPDATE' AND NEW.generation_id<>OLD.generation_id THEN
    RAISE EXCEPTION 'CORPUS_MEMBERSHIP_IDENTITY_IMMUTABLE';
  END IF;
  SELECT state INTO owner_state FROM storage.corpus_membership_generations WHERE id=owner FOR SHARE;
  IF TG_OP='DELETE' AND (owner_state IS NULL OR owner_state='retired') THEN RETURN OLD; END IF;
  IF owner_state IS DISTINCT FROM 'building' THEN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_IMMUTABLE'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER corpus_member_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.corpus_members
  FOR EACH ROW EXECUTE FUNCTION storage.guard_corpus_membership_data();
CREATE TRIGGER corpus_member_truncate BEFORE TRUNCATE ON storage.corpus_members
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_corpus_membership_data();
CREATE TRIGGER corpus_membership_page_guard BEFORE INSERT OR UPDATE OR DELETE ON storage.corpus_membership_pages
  FOR EACH ROW EXECUTE FUNCTION storage.guard_corpus_membership_data();
CREATE TRIGGER corpus_membership_page_truncate BEFORE TRUNCATE ON storage.corpus_membership_pages
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_corpus_membership_data();

CREATE FUNCTION storage.publish_corpus_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE manifest jsonb; page record; reference jsonb; body jsonb;
BEGIN
  IF TG_OP='DELETE' THEN
    IF OLD.state='verified' THEN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_MUST_RETIRE'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'building' THEN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_NOT_BUILDING'; END IF;
    RETURN NEW;
  END IF;
  IF ROW(NEW.id,NEW.release_id,NEW.inventory_release_id,NEW.source_inventory_sha256,NEW.source_manifest,NEW.member_count,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.release_id,OLD.inventory_release_id,OLD.source_inventory_sha256,OLD.source_manifest,OLD.member_count,OLD.created_at) THEN
    RAISE EXCEPTION 'CORPUS_MEMBERSHIP_IDENTITY_IMMUTABLE';
  END IF;
  IF NEW.state=OLD.state THEN RETURN NEW; END IF;
  IF NEW.state='retired' AND OLD.state IN ('building','verified') THEN RETURN NEW; END IF;
  IF OLD.state<>'building' OR NEW.state<>'verified' THEN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_TRANSITION_INVALID'; END IF;
  IF current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'CORPUS_MEMBERSHIP_REQUIRES_READ_COMMITTED';
  END IF;
  IF encode(sha256(NEW.source_manifest),'hex')<>NEW.source_inventory_sha256 THEN
    RAISE EXCEPTION 'CORPUS_MEMBERSHIP_MANIFEST_INVALID';
  END IF;
  manifest:=convert_from(NEW.source_manifest,'UTF8')::jsonb;
  IF manifest->>'schemaVersion' IS DISTINCT FROM '1'
    OR manifest->>'releaseId' IS DISTINCT FROM NEW.inventory_release_id
    OR jsonb_typeof(manifest->'partitions') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'CORPUS_MEMBERSHIP_MANIFEST_INVALID';
  END IF;
  IF jsonb_array_length(manifest->'partitions') NOT BETWEEN 1 AND 64
    OR (SELECT count(DISTINCT value->>'partition') FROM jsonb_array_elements(manifest->'partitions'))<>jsonb_array_length(manifest->'partitions')
    OR (SELECT count(*) FROM storage.corpus_membership_pages WHERE generation_id=NEW.id)<>jsonb_array_length(manifest->'partitions') THEN
    RAISE EXCEPTION 'CORPUS_MEMBERSHIP_PAGE_COUNT_INVALID';
  END IF;
  FOR reference IN SELECT value FROM jsonb_array_elements(manifest->'partitions') LOOP
    SELECT * INTO page FROM storage.corpus_membership_pages WHERE generation_id=NEW.id AND partition=reference->>'partition';
    IF NOT FOUND OR encode(sha256(page.content),'hex') IS DISTINCT FROM reference->>'sha256'
      OR octet_length(page.content) IS DISTINCT FROM (reference->>'sizeBytes')::integer THEN
      RAISE EXCEPTION 'CORPUS_MEMBERSHIP_PAGE_INVALID';
    END IF;
    body:=convert_from(page.content,'UTF8')::jsonb;
    IF body->>'schemaVersion' IS DISTINCT FROM '1' OR body->>'releaseId' IS DISTINCT FROM NEW.inventory_release_id
      OR body->>'partition' IS DISTINCT FROM reference->>'partition'
      OR jsonb_typeof(body->'items') IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'CORPUS_MEMBERSHIP_PAGE_INVALID';
    END IF;
    IF jsonb_array_length(body->'items') IS DISTINCT FROM (reference->>'count')::integer
      OR (reference->>'count')::integer<=0 THEN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_PAGE_INVALID'; END IF;
    -- Preserve the original point-reader's deterministic partition placement;
    -- a globally indexed row must not admit a misplaced source member.
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'items') item WHERE
      lpad(to_hex(get_byte(CASE WHEN item->>'itemKey' ~ '^retrieval-chunk-v1:[a-f0-9]{64}$'
        THEN decode(substring(item->>'itemKey' FROM 20),'hex')
        ELSE sha256(convert_to(item->>'itemKey','UTF8')) END,0)/4),2,'0')
      IS DISTINCT FROM reference->>'partition') THEN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_PARTITION_INVALID'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(body->'items') item
      LEFT JOIN storage.corpus_members member ON member.generation_id=NEW.id AND member.item_key=item->>'itemKey'
      WHERE member.member IS DISTINCT FROM item) THEN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_PARITY_INVALID'; END IF;
  END LOOP;
  IF (SELECT sum((value->>'count')::bigint) FROM jsonb_array_elements(manifest->'partitions'))<>NEW.member_count
    OR (SELECT count(*) FROM storage.corpus_members WHERE generation_id=NEW.id)<>NEW.member_count
    OR (SELECT count(DISTINCT item->>'itemKey') FROM storage.corpus_membership_pages source_page,
      LATERAL jsonb_array_elements(convert_from(source_page.content,'UTF8')::jsonb->'items') item WHERE source_page.generation_id=NEW.id)<>NEW.member_count THEN
    RAISE EXCEPTION 'CORPUS_MEMBERSHIP_MEMBER_COUNT_INVALID';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER corpus_membership_publication BEFORE INSERT OR UPDATE OR DELETE ON storage.corpus_membership_generations
  FOR EACH ROW EXECUTE FUNCTION storage.publish_corpus_membership();
CREATE FUNCTION storage.forbid_corpus_membership_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'CORPUS_MEMBERSHIP_TRUNCATE_FORBIDDEN'; END;
$$;
CREATE TRIGGER corpus_membership_generation_truncate BEFORE TRUNCATE ON storage.corpus_membership_generations
  FOR EACH STATEMENT EXECUTE FUNCTION storage.forbid_corpus_membership_truncate();
