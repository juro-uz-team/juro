CREATE TABLE storage.object_reclamation (
  root text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  requested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(root,sha256)
);
