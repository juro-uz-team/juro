CREATE TABLE storage.operational_metrics (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  indexes text[] NOT NULL,
  labels text[] NOT NULL,
  values double precision[] NOT NULL
);
CREATE INDEX operational_metrics_recorded_at_idx ON storage.operational_metrics(recorded_at);
