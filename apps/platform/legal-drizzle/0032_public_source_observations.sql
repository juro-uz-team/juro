CREATE TABLE `legal_source_observations` (
  `official_url` text PRIMARY KEY NOT NULL,
  `observation_version` integer NOT NULL CHECK (`observation_version`=1),
  `observed_at` text NOT NULL,
  `is_current` integer NOT NULL CHECK (`is_current` IN (0,1)),
  `normalized_text_sha256` text NOT NULL,
  `raw_content_sha256` text NOT NULL,
  CHECK (length(`normalized_text_sha256`)=64 AND `normalized_text_sha256` NOT GLOB '*[^0-9a-f]*'
    AND length(`raw_content_sha256`)=64 AND `raw_content_sha256` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TABLE `legal_source_observation_targets` (
  `official_url` text PRIMARY KEY NOT NULL,
  `refresh_after` text NOT NULL,
  `lease_until` text,
  `lease_token` text,
  `last_attempt_at` text,
  `last_error_code` text
);
--> statement-breakpoint
CREATE INDEX `legal_source_observation_refresh_due` ON `legal_source_observation_targets` (`refresh_after`, `official_url`);
--> statement-breakpoint
CREATE TABLE `legal_source_observation_crawl_windows` (
  `host` text PRIMARY KEY NOT NULL,
  `available_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `legal_source_observation_refresh_leases` (
  `official_url` text PRIMARY KEY NOT NULL,
  `lease_token` text NOT NULL,
  `lease_until` text NOT NULL
);
