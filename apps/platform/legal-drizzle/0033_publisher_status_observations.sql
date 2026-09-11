-- Earlier observations used an incomplete publisher repeal-banner policy.
-- Preserve that cache as compatibility history; never relabel its decisions.
-- Separate storage prevents older workers from overwriting corrected status.
CREATE TABLE `legal_publisher_status_observations` (
  `official_url` text PRIMARY KEY NOT NULL,
  `observation_version` integer NOT NULL CHECK (`observation_version`=2),
  `observed_at` text NOT NULL,
  `is_current` integer NOT NULL CHECK (`is_current` IN (0,1)),
  `normalized_text_sha256` text NOT NULL,
  `raw_content_sha256` text NOT NULL,
  CHECK (length(`normalized_text_sha256`)=64 AND `normalized_text_sha256` NOT GLOB '*[^0-9a-f]*'
    AND length(`raw_content_sha256`)=64 AND `raw_content_sha256` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
-- Re-observe registered public targets under the corrected policy.
UPDATE `legal_source_observation_targets` SET `refresh_after`='1970-01-01T00:00:00.000Z';
