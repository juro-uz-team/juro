CREATE TABLE storage.corpus_publication_sources (
    work text PRIMARY KEY CHECK (work ~ '^[a-f0-9]{64}$'),
    package_sha256 text NOT NULL CHECK (package_sha256 ~ '^[a-f0-9]{64}$'),
    generation_sha256 text NOT NULL REFERENCES storage.corpus_evidence_stores (generation_sha256)
);
