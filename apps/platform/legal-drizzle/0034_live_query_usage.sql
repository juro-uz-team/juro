-- Live request usage is independent of explicitly capped evaluation budgets.
CREATE TABLE `legal_custom_query_usage` (
  `id` text PRIMARY KEY NOT NULL,
  `environment` text NOT NULL CHECK (`environment` IN ('development','staging','production')),
  `release_id` text NOT NULL,
  `estimated_usd_micros` integer NOT NULL CHECK (`estimated_usd_micros` > 0),
  `query_count` integer NOT NULL CHECK (`query_count` BETWEEN 1 AND 6),
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `legal_custom_query_usage_environment_time`
  ON `legal_custom_query_usage` (`environment`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `legal_custom_query_usage_no_update` BEFORE UPDATE ON `legal_custom_query_usage`
BEGIN SELECT RAISE(ABORT, 'LEGAL_CUSTOM_QUERY_USAGE_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `legal_custom_query_usage_no_delete` BEFORE DELETE ON `legal_custom_query_usage`
BEGIN SELECT RAISE(ABORT, 'LEGAL_CUSTOM_QUERY_USAGE_IMMUTABLE'); END;
