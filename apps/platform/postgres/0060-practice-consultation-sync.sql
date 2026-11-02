SET search_path TO app, public;
-- Metadata for an existing consultation, never another appointment row.
CREATE TABLE practice_google_consultations (
 connection_id text NOT NULL REFERENCES practice_calendar_connections(id) ON DELETE CASCADE,
 consultation_id text NOT NULL REFERENCES lawyer_consultations(id) ON DELETE CASCADE,
 google_id text NOT NULL, etag text, synced_updated_at text NOT NULL,
 state text NOT NULL DEFAULT 'synced', remote_snapshot jsonb,
 PRIMARY KEY(connection_id,consultation_id), UNIQUE(connection_id,google_id)
);
