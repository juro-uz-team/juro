CREATE TABLE storage.queue_messages (
  id uuid PRIMARY KEY,
  queue text NOT NULL,
  body jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner uuid,
  lease_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  dead_letter_at timestamptz,
  CHECK ((lease_owner IS NULL) = (lease_expires_at IS NULL))
);
CREATE INDEX queue_available_idx ON storage.queue_messages(available_at,created_at) WHERE dead_letter_at IS NULL;
