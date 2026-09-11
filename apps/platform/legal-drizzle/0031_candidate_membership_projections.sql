CREATE TABLE `legal_candidate_membership_projections` (
  `search_release_id` text NOT NULL,
  `proof_version` integer NOT NULL CHECK (`proof_version` > 0),
  `source_inventory_sha256` text NOT NULL,
  `projection_r2_key` text NOT NULL CHECK (length(`projection_r2_key`) BETWEEN 1 AND 1024),
  `projection_sha256` text NOT NULL,
  `projection_size_bytes` integer NOT NULL CHECK (`projection_size_bytes` BETWEEN 1 AND 262144),
  `member_count` integer NOT NULL CHECK (`member_count` BETWEEN 1 AND 16777216),
  `created_at` text NOT NULL,
  PRIMARY KEY (`search_release_id`, `proof_version`),
  FOREIGN KEY (`search_release_id`) REFERENCES `legal_search_releases`(`id`) ON DELETE restrict,
  CHECK (length(`source_inventory_sha256`)=64 AND `source_inventory_sha256` NOT GLOB '*[^0-9a-f]*'
    AND length(`projection_sha256`)=64 AND `projection_sha256` NOT GLOB '*[^0-9a-f]*')
);
--> statement-breakpoint
CREATE TRIGGER `legal_candidate_membership_projection_inventory`
BEFORE INSERT ON `legal_candidate_membership_projections`
WHEN NOT EXISTS (
  SELECT 1 FROM `legal_custom_search_r2_runtime_roots` root
  WHERE root.search_release_id=NEW.search_release_id
    AND root.mapping_inventory_sha256=NEW.source_inventory_sha256
    AND root.mapping_count=NEW.member_count
)
BEGIN SELECT RAISE(ABORT, 'LEGAL_MEMBERSHIP_PROJECTION_INVENTORY_MISMATCH'); END;
--> statement-breakpoint
CREATE TRIGGER `legal_candidate_membership_projection_no_update`
BEFORE UPDATE ON `legal_candidate_membership_projections`
BEGIN SELECT RAISE(ABORT, 'LEGAL_MEMBERSHIP_PROJECTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `legal_candidate_membership_projection_no_replace`
BEFORE INSERT ON `legal_candidate_membership_projections`
WHEN EXISTS (
  SELECT 1 FROM `legal_candidate_membership_projections` published
  WHERE published.search_release_id=NEW.search_release_id
    AND published.proof_version=NEW.proof_version
)
BEGIN SELECT RAISE(ABORT, 'LEGAL_MEMBERSHIP_PROJECTION_IMMUTABLE'); END;
--> statement-breakpoint
CREATE TRIGGER `legal_candidate_membership_projection_no_delete`
BEFORE DELETE ON `legal_candidate_membership_projections`
BEGIN SELECT RAISE(ABORT, 'LEGAL_MEMBERSHIP_PROJECTION_IMMUTABLE'); END;
