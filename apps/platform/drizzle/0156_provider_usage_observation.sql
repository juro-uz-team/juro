-- NULL preserves unspecified historical observations; zero is explicitly unknown.
ALTER TABLE ai_provider_usage_events ADD COLUMN usage_observed INTEGER
  CHECK (usage_observed IS NULL OR usage_observed IN (0, 1));
