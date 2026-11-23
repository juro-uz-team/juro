CREATE TABLE app.corpus_publication_updates (
    id text PRIMARY KEY,
    canonical_id text NOT NULL,
    official_url text NOT NULL,
    title text NOT NULL,
    language text,
    kind text NOT NULL CHECK (kind IN ('new_act', 'edition', 'metadata_changed')),
    observed_at text NOT NULL,
    edition_date text,
    work text,
    catchup boolean NOT NULL
);

CREATE INDEX corpus_publication_updates_recent ON app.corpus_publication_updates (observed_at DESC, id DESC);
CREATE INDEX corpus_publication_updates_by_source ON app.corpus_publication_updates (canonical_id, kind);

CREATE TABLE app.corpus_publication_checkpoint (
    baseline text PRIMARY KEY,
    last_sequence bigint NOT NULL CHECK (last_sequence >= 0),
    last_success_at text,
    catchup_summary_sent boolean NOT NULL DEFAULT false
);
