-- Prepared public evidence is append-only and does not grant capture callers
-- write access to private objects, retired evidence, or filesystem metadata.
CREATE TABLE storage.prepared_evidence_objects (
  namespace text NOT NULL REFERENCES storage.corpus_evidence_stores(namespace),
  key text NOT NULL CHECK(octet_length(key) BETWEEN 1 AND 1024),
  sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
  content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 67108864),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(namespace,key),
  CHECK(encode(sha256(content),'hex')=sha256)
);
CREATE TRIGGER prepared_evidence_objects_immutable
  BEFORE UPDATE OR DELETE OR TRUNCATE ON storage.prepared_evidence_objects
  FOR EACH STATEMENT EXECUTE FUNCTION storage.guard_native_corpus_acceptance_history();

CREATE FUNCTION storage.append_prepared_evidence(p_namespace text,p_key text,p_content bytea)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  digest text;
  retained text;
BEGIN
  digest := encode(sha256(p_content),'hex');
  INSERT INTO storage.prepared_evidence_objects(namespace,key,sha256,content)
    VALUES(p_namespace,p_key,digest,p_content) ON CONFLICT(namespace,key) DO NOTHING;
  SELECT sha256 INTO retained FROM storage.prepared_evidence_objects
    WHERE namespace=p_namespace AND key=p_key;
  IF retained IS DISTINCT FROM digest THEN
    RAISE EXCEPTION 'PREPARED_EVIDENCE_CONFLICT';
  END IF;
  RETURN retained;
END;
$$;
REVOKE ALL ON FUNCTION storage.append_prepared_evidence(text,text,bytea) FROM PUBLIC;
