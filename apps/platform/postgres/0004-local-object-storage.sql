CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE storage.objects (
  bucket text NOT NULL,
  key text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  size bigint NOT NULL CHECK (size >= 0),
  version text NOT NULL,
  uploaded timestamptz NOT NULL DEFAULT now(),
  http_metadata jsonb NOT NULL DEFAULT '{}',
  custom_metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (bucket, key)
);
CREATE INDEX objects_digest_idx ON storage.objects(sha256);

CREATE TABLE storage.vector_collections (
  name text PRIMARY KEY,
  dimensions integer NOT NULL CHECK (dimensions BETWEEN 1 AND 16000),
  metric text NOT NULL CHECK (metric IN ('cosine','euclidean','dot-product')),
  model text,
  source_manifest_sha256 text
);
CREATE TABLE storage.embeddings (
  collection text NOT NULL REFERENCES storage.vector_collections(name),
  namespace text NOT NULL DEFAULT '',
  id text NOT NULL,
  embedding vector NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY(collection,id)
);
CREATE INDEX embeddings_namespace_idx ON storage.embeddings(collection,namespace);
CREATE INDEX embeddings_metadata_idx ON storage.embeddings USING gin(metadata jsonb_path_ops);
