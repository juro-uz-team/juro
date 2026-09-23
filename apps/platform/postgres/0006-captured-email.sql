CREATE TABLE storage.captured_emails (
  id text PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  message jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now()
);
