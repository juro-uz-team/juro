-- Native PostgreSQL baseline; prior applied migrations remain immutable.

CREATE SCHEMA IF NOT EXISTS legal;

SET search_path TO legal, public;

CREATE TABLE "legal_evidence_locators" (
  "id" text PRIMARY KEY NOT NULL,
  "object_kind" text NOT NULL,
  "r2_key" text NOT NULL UNIQUE,
  "media_type" text NOT NULL,
  "byte_count" bigint NOT NULL,
  "sha256" text NOT NULL,
  "source_normalized_sha256" text,
  "ordinal" bigint NOT NULL,
  "schema_version" bigint NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_evidence_locator_kind_check"
    CHECK ("object_kind" IN ('raw_capture','normalized_revision','provision_rendition')),
  CONSTRAINT "legal_evidence_locator_size_check" CHECK ("byte_count">0),
  CONSTRAINT "legal_evidence_locator_sha_check"
    CHECK (length("sha256")=64 AND "sha256" !~ '^.*[^0-9a-f].*$'
      AND ("source_normalized_sha256" IS NULL OR
        (length("source_normalized_sha256")=64
          AND "source_normalized_sha256" !~ '^.*[^0-9a-f].*$'))),
  CONSTRAINT "legal_evidence_locator_schema_check" CHECK ("schema_version"=1)
);

CREATE TABLE "legal_instruments" (
  "id" text PRIMARY KEY NOT NULL,
  "publisher_instrument_token" text NOT NULL UNIQUE,
  "canonical_title" text NOT NULL,
  "document_type" text NOT NULL,
  "canonical_url" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "legal_official_expressions" (
  "id" text PRIMARY KEY NOT NULL,
  "legal_instrument_id" text NOT NULL,
  "language_tag" text NOT NULL,
  "source_url" text NOT NULL,
  "created_at" text NOT NULL,
  "script" text NOT NULL DEFAULT 'unknown'
  CHECK ("script" IN ('Latn','Cyrl','unknown')),
  "textual_authority" text NOT NULL DEFAULT 'unknown'
  CHECK ("textual_authority" IN ('controlling','official_translation','unknown')),
  "origin" text NOT NULL DEFAULT 'unknown'
  CHECK ("origin" IN ('certified_original','adopted_original','official_publisher','unknown')),
  "publication_status" text NOT NULL DEFAULT 'unknown'
  CHECK ("publication_status" IN ('official','withdrawn','unknown')),
  "controlling_on_conflict" bigint NOT NULL DEFAULT 0
  CHECK ("controlling_on_conflict" IN (0,1)),
  "derived_from_expression_id" text,
  "authority_evidence_json" text
);

CREATE TABLE "legal_text_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "official_expression_id" text NOT NULL,
  "publisher_revision_token" text NOT NULL,
  "raw_locator_id" text NOT NULL,
  "normalized_locator_id" text NOT NULL,
  "captured_at" text NOT NULL,
  "created_at" text NOT NULL,
  "script" text NOT NULL DEFAULT 'unknown'
  CHECK ("script" IN ('Latn','Cyrl','unknown')),
  "textual_authority" text NOT NULL DEFAULT 'unknown'
  CHECK ("textual_authority" IN ('controlling','official_translation','unknown')),
  "authority_evidence_json" text,
  UNIQUE ("official_expression_id","publisher_revision_token")
);

CREATE TABLE "legal_provision_concepts" (
  "id" text PRIMARY KEY NOT NULL,
  "legal_instrument_id" text NOT NULL,
  "publisher_concept_token" text NOT NULL,
  "created_at" text NOT NULL,
  UNIQUE ("legal_instrument_id","publisher_concept_token")
);

CREATE TABLE "legal_provision_renditions" (
  "id" text PRIMARY KEY NOT NULL,
  "provision_concept_id" text NOT NULL,
  "text_revision_id" text NOT NULL,
  "locator_id" text NOT NULL UNIQUE,
  "article_number" text NOT NULL,
  "article_title" text,
  "sequence" bigint NOT NULL,
  "source_url" text NOT NULL,
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_provision_rendition_status_check"
    CHECK ("status" IN ('active','historical','repealed','unknown')),
  CONSTRAINT "legal_provision_rendition_sequence_check" CHECK ("sequence">=0),
  UNIQUE ("provision_concept_id","text_revision_id")
);

CREATE TABLE "legal_official_eligibility" (
  "id" text PRIMARY KEY NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "capability" text NOT NULL,
  "status" text NOT NULL,
  "reason_codes_json" text NOT NULL,
  "evaluated_at" text NOT NULL,
  CONSTRAINT "legal_official_eligibility_subject_check"
    CHECK ("subject_type" IN ('text_revision','provision_rendition')),
  CONSTRAINT "legal_official_eligibility_capability_check"
    CHECK ("capability" IN ('current','as_of','comparison')),
  CONSTRAINT "legal_official_eligibility_status_check"
    CHECK ("status" IN ('eligible','ineligible','gap'))
);

CREATE TABLE "legal_corpus_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "corpus_hash" text NOT NULL,
  "member_count" bigint NOT NULL,
  "status" text NOT NULL,
  "frozen_at" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_snapshot_environment_check"
    CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_snapshot_hash_check"
    CHECK (length("corpus_hash")=64 AND "corpus_hash" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_snapshot_count_check" CHECK ("member_count">0),
  CONSTRAINT "legal_snapshot_status_check" CHECK ("status"='frozen')
);

CREATE TABLE "legal_corpus_snapshot_members" (
  "corpus_snapshot_id" text NOT NULL,
  "provision_rendition_id" text NOT NULL,
  "locator_id" text NOT NULL,
  "sha256" text NOT NULL,
  PRIMARY KEY ("corpus_snapshot_id","provision_rendition_id")
);

CREATE TABLE "legal_search_releases" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "capability" text NOT NULL,
  "corpus_snapshot_id" text NOT NULL,
  "status" text NOT NULL,
  "item_count" bigint NOT NULL,
  "retrieval_policy_version" text NOT NULL,
  "configuration_identity" text NOT NULL,
  "sealed_at" text,
  "created_at" text NOT NULL,
  "sealed_reconciliation_run_id" text
,
  CONSTRAINT "legal_search_release_environment_check"
    CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_search_release_capability_check"
    CHECK ("capability" IN ('current','history')),
  CONSTRAINT "legal_search_release_status_check"
    CHECK ("status" IN ('draft','sealed','failed')),
  CONSTRAINT "legal_search_release_count_check" CHECK ("item_count">=0),
  CONSTRAINT "legal_search_release_seal_check"
    CHECK (("status"='sealed' AND "sealed_at" IS NOT NULL)
      OR ("status"<>'sealed' AND "sealed_at" IS NULL))
);

CREATE TABLE "legal_search_release_items" (
  "search_release_id" text NOT NULL,
  "provision_rendition_id" text NOT NULL,
  "canonical_chunk_id" text NOT NULL,
  "item_key" text NOT NULL,
  "r2_key" text NOT NULL,
  "byte_count" bigint NOT NULL,
  "sha256" text NOT NULL,
  "language" text,
  "document_type" text,
  "valid_from" text,
  "valid_to" text,
  PRIMARY KEY ("search_release_id","item_key"),
  UNIQUE ("search_release_id","canonical_chunk_id")
);

CREATE TABLE "legal_activation_sets" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "current_release_id" text,
  "as_of_release_id" text,
  "comparison_current_release_id" text,
  "comparison_history_release_id" text,
  "previous_activation_set_id" text,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_activation_set_environment_check"
    CHECK ("environment" IN ('development','staging','production'))
);

CREATE TABLE "legal_active_activation_sets" (
  "environment" text PRIMARY KEY NOT NULL,
  "activation_set_id" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "legal_activation_events" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "activation_set_id" text NOT NULL,
  "prior_activation_set_id" text,
  "action" text NOT NULL,
  "actor" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_activation_event_action_check" CHECK ("action" IN ('activate','rollback')),
  CONSTRAINT "legal_activation_event_actor_check" CHECK (length(trim("actor")) BETWEEN 1 AND 160),
  CONSTRAINT "legal_activation_event_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500)
);

CREATE TABLE "legal_text_revision_validity" (
  "text_revision_id" text PRIMARY KEY NOT NULL,
  "valid_from" text NOT NULL,
  "valid_to" text,
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_text_revision_validity_interval_check"
    CHECK ("valid_to" IS NULL OR "valid_from"<"valid_to")
);

CREATE TABLE "legal_applicability_periods" (
  "id" text PRIMARY KEY NOT NULL,
  "provision_rendition_id" text NOT NULL,
  "valid_from" text NOT NULL,
  "valid_to" text,
  "evidence_url" text NOT NULL,
  "evidence_kind" text NOT NULL,
  "status" text NOT NULL DEFAULT 'verified',
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_applicability_period_interval_check"
    CHECK ("valid_to" IS NULL OR "valid_from"<"valid_to"),
  CONSTRAINT "legal_applicability_period_status_check" CHECK ("status"='verified'),
  CONSTRAINT "legal_applicability_period_evidence_kind_check"
    CHECK ("evidence_kind" IN ('commencement_clause','amendment_act','repeal_act','official_timeline')),
  UNIQUE ("provision_rendition_id","valid_from","valid_to")
);

CREATE TABLE "legal_temporal_coverage_gaps" (
  "id" text PRIMARY KEY NOT NULL,
  "provision_rendition_id" text NOT NULL,
  "gap_kind" text NOT NULL,
  "valid_from" text,
  "valid_to" text,
  "evidence_url" text NOT NULL,
  "reason" text NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_temporal_gap_kind_check"
    CHECK ("gap_kind" IN ('unknown','ambiguous','disputed')),
  CONSTRAINT "legal_temporal_gap_interval_check"
    CHECK ("valid_from" IS NULL OR "valid_to" IS NULL OR "valid_from"<"valid_to"),
  CONSTRAINT "legal_temporal_gap_status_check" CHECK ("status" IN ('open','resolved')),
  CONSTRAINT "legal_temporal_gap_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 2000)
);

CREATE TABLE "legal_current_provision_pointers" (
  "provision_rendition_id" text PRIMARY KEY NOT NULL,
  "evidence_url" text NOT NULL,
  "verified_at" text NOT NULL,
  "recorded_at" text NOT NULL
);

CREATE TABLE "legal_provision_lineage_edges" (
  "id" text PRIMARY KEY NOT NULL,
  "predecessor_concept_id" text NOT NULL,
  "successor_concept_id" text,
  "transition" text NOT NULL,
  "evidence_url" text NOT NULL,
  "review_state" text NOT NULL,
  "reviewed_by" text,
  "reviewed_at" text,
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_provision_lineage_transition_check"
    CHECK ("transition" IN ('unchanged','modified','renumbered','moved','split','merged','repealed')),
  CONSTRAINT "legal_provision_lineage_repeal_check"
    CHECK (("transition"='repealed' AND "successor_concept_id" IS NULL)
      OR ("transition"<>'repealed' AND "successor_concept_id" IS NOT NULL)),
  CONSTRAINT "legal_provision_lineage_review_check"
    CHECK ("review_state" IN ('pending','accepted','rejected')),
  CONSTRAINT "legal_provision_lineage_reviewer_check"
    CHECK (("review_state"='pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL)
      OR ("review_state"<>'pending' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)),
  UNIQUE ("predecessor_concept_id","successor_concept_id","transition","evidence_url")
);

CREATE TABLE "legal_official_expression_equivalences" (
  "id" text PRIMARY KEY NOT NULL,
  "left_expression_id" text NOT NULL,
  "right_expression_id" text NOT NULL,
  "equivalence_kind" text NOT NULL,
  "evidence_url" text NOT NULL,
  "review_state" text NOT NULL,
  "reviewed_by" text,
  "reviewed_at" text,
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_expression_equivalence_distinct_check"
    CHECK ("left_expression_id"<"right_expression_id"),
  CONSTRAINT "legal_expression_equivalence_kind_check"
    CHECK ("equivalence_kind" IN ('official_translation','cross_script','publisher_equivalent')),
  CONSTRAINT "legal_expression_equivalence_review_check"
    CHECK ("review_state" IN ('pending','accepted','rejected')),
  CONSTRAINT "legal_expression_equivalence_reviewer_check"
    CHECK (("review_state"='pending' AND "reviewed_by" IS NULL AND "reviewed_at" IS NULL)
      OR ("review_state"<>'pending' AND "reviewed_by" IS NOT NULL AND "reviewed_at" IS NOT NULL)),
  UNIQUE ("left_expression_id","right_expression_id","equivalence_kind","evidence_url")
);

CREATE TABLE "legal_source_aliases" (
  "id" text PRIMARY KEY NOT NULL,
  "legal_instrument_id" text NOT NULL,
  "source_url" text NOT NULL,
  "redirected_to" text,
  "recorded_at" text NOT NULL,
  UNIQUE ("legal_instrument_id","source_url")
);

CREATE TABLE "legal_migration_reconciliation_checkpoints" (
  "run_id" text NOT NULL,
  "phase" text NOT NULL,
  "input_sha256" text NOT NULL,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("run_id","phase"),
  CONSTRAINT "legal_migration_checkpoint_phase_check"
    CHECK ("phase" IN ('canonicalized','reconciled'))
);

CREATE TABLE "legal_duplicate_candidates" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "semantic_fingerprint" text NOT NULL,
  "canonical_identities_json" text NOT NULL,
  "review_state" text NOT NULL,
  "decision" text,
  "evidence_url" text,
  "reviewed_by" text,
  "reviewed_at" text,
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_duplicate_candidate_review_check"
    CHECK ("review_state" IN ('unresolved','reviewed')),
  UNIQUE ("run_id","semantic_fingerprint")
);

CREATE TABLE "legal_migration_reconciliation_reports" (
  "run_id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "release_id" text NOT NULL,
  "capability" text NOT NULL,
  "input_sha256" text NOT NULL,
  "report_sha256" text NOT NULL UNIQUE,
  "status" text NOT NULL,
  "report_json" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_migration_report_environment_check"
    CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_migration_report_capability_check"
    CHECK ("capability" IN ('current','history')),
  CONSTRAINT "legal_migration_report_status_check" CHECK ("status" IN ('clean','blocked'))
);

CREATE TABLE "legal_search_release_governance" (
  "id" text PRIMARY KEY NOT NULL,
  "search_release_id" text NOT NULL,
  "environment" text NOT NULL,
  "capability" text NOT NULL,
  "reconciliation_run_id" text NOT NULL,
  "status" text NOT NULL,
  "failures_json" text NOT NULL,
  "evidence_json" text NOT NULL,
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_release_governance_status_check" CHECK ("status" IN ('passed','failed')),
  UNIQUE ("search_release_id","recorded_at")
);

CREATE TABLE "legal_search_release_shards" (
  "governance_id" text NOT NULL,
  "search_release_id" text NOT NULL,
  "shard_id" text NOT NULL,
  "item_count" bigint NOT NULL,
  "inventory_sha256" text NOT NULL,
  "sync_state" text NOT NULL,
  PRIMARY KEY ("governance_id","shard_id"),
  CONSTRAINT "legal_release_shard_sync_check" CHECK ("sync_state"='complete'),
  CONSTRAINT "legal_release_shard_count_check" CHECK ("item_count">=0)
);

CREATE TABLE "legal_search_release_evaluation_strata" (
  "governance_id" text NOT NULL,
  "search_release_id" text NOT NULL,
  "stratum" text NOT NULL,
  "scenario_count" bigint NOT NULL,
  "metrics_json" text NOT NULL,
  PRIMARY KEY ("governance_id","stratum"),
  CONSTRAINT "legal_release_stratum_count_check" CHECK ("scenario_count">0)
);

CREATE TABLE "legal_release_observations" (
  "id" text PRIMARY KEY NOT NULL,
  "release_id" text NOT NULL,
  "environment" text NOT NULL,
  "phase" text NOT NULL,
  "observed_at" text NOT NULL,
  "request_count" bigint NOT NULL,
  "green" bigint NOT NULL,
  "gate_breach_count" bigint NOT NULL,
  CONSTRAINT "legal_release_observation_environment_check"
    CHECK ("environment" IN ('staging','production')),
  CONSTRAINT "legal_release_observation_phase_check"
    CHECK ("phase" IN ('staging_soak','production_canary','retirement_stability')),
  CONSTRAINT "legal_release_observation_count_check"
    CHECK ("request_count">=0 AND "gate_breach_count">=0 AND "green" IN (0,1)),
  UNIQUE ("release_id","phase","observed_at")
);

CREATE TABLE "legal_target_control" (
  "control_key" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "migration_state" text DEFAULT 'initialized' NOT NULL,
  "evidence_bucket_name" text NOT NULL,
  "schema_version" bigint DEFAULT 1 NOT NULL,
  "initialized_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "legal_target_control_key_check"
    CHECK ("control_key"='environment'),
  CONSTRAINT "legal_target_control_environment_check"
    CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_target_control_state_check"
    CHECK ("migration_state" IN ('initialized','migrating','ready','blocked')),
  CONSTRAINT "legal_target_control_bucket_check"
    CHECK (
      "evidence_bucket_name"='juro-legal-evidence-'||"environment"
      OR (
        "evidence_bucket_name" ~ ('^juro-legal-evidence-' || "environment" || '-[a-z0-9].*$')
        AND "evidence_bucket_name" !~ '^.*[^a-z0-9-].*$'
        AND "evidence_bucket_name" !~ '^.*--.*$'
        AND substr("evidence_bucket_name",-1,1)<>'-'
      )
    ),
  CONSTRAINT "legal_target_control_schema_check" CHECK ("schema_version"=1),
  CONSTRAINT "legal_target_control_timestamp_check"
    CHECK ("initialized_at" ~ '^....-..-..T..:..:...*Z$'
      AND "updated_at" ~ '^....-..-..T..:..:...*Z$')
);

CREATE TABLE "legal_migration_cutoffs" (
  "scope" text PRIMARY KEY NOT NULL,
  "migration_run_id" text NOT NULL UNIQUE,
  "cutoff_at" text NOT NULL,
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_migration_cutoff_scope_check" CHECK ("scope"='current'),
  CONSTRAINT "legal_migration_cutoff_run_check"
    CHECK ("migration_run_id" ~ '^[a-z0-9].*$'
      AND "migration_run_id" !~ '^.*[^a-z0-9-].*$'
      AND "migration_run_id" !~ '^.*--.*$'
      AND substr("migration_run_id",-1,1)<>'-'),
  CONSTRAINT "legal_migration_cutoff_timestamp_check"
    CHECK ("cutoff_at" ~ '^....-..-..T..:..:...*Z$'
      AND "recorded_at" ~ '^....-..-..T..:..:...*Z$')
);

CREATE TABLE "legal_source_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "publisher" text NOT NULL,
  "publisher_document_token" text NOT NULL UNIQUE,
  "language_tag" text NOT NULL,
  "source_url" text NOT NULL,
  "legacy_instrument_id" text,
  "legacy_expression_id" text UNIQUE,
  "provenance_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_source_document_publisher_check" CHECK ("publisher"='lex.uz'),
  CONSTRAINT "legal_source_document_language_check"
    CHECK ("language_tag" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_source_document_hash_check"
    CHECK (length("provenance_sha256")=64 AND "provenance_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "source_document_id" text NOT NULL,
  "publisher_revision_token" text NOT NULL,
  "language_tag" text NOT NULL,
  "capture_id" text NOT NULL,
  "raw_locator_id" text NOT NULL,
  "normalized_locator_id" text NOT NULL,
  "content_sha256" text NOT NULL,
  "captured_at" text NOT NULL,
  "legacy_text_revision_id" text NOT NULL UNIQUE,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_source_snapshot_language_check"
    CHECK ("language_tag" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_source_snapshot_hash_check"
    CHECK (length("content_sha256")=64 AND "content_sha256" !~ '^.*[^0-9a-f].*$'),
  UNIQUE ("source_document_id","publisher_revision_token","language_tag","capture_id","content_sha256")
);

CREATE TABLE "legal_snapshot_provisions" (
  "id" text PRIMARY KEY NOT NULL,
  "source_snapshot_id" text NOT NULL,
  "source_position_token" text NOT NULL,
  "sequence" bigint NOT NULL,
  "normalized_content_sha256" text NOT NULL,
  "provision_locator_id" text NOT NULL,
  "source_url" text NOT NULL,
  "temporal_state" text NOT NULL,
  "privacy_class" text NOT NULL,
  "legacy_provision_rendition_id" text NOT NULL UNIQUE,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_snapshot_provision_sequence_check" CHECK ("sequence">=0),
  CONSTRAINT "legal_snapshot_provision_hash_check"
    CHECK (length("normalized_content_sha256")=64
      AND "normalized_content_sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_snapshot_provision_temporal_check"
    CHECK ("temporal_state" IN ('current_supported','unknown','historical_only','disputed')),
  CONSTRAINT "legal_snapshot_provision_privacy_check"
    CHECK ("privacy_class" IN ('public_official_source','private','unknown')),
  UNIQUE ("source_snapshot_id","source_position_token","normalized_content_sha256")
);

CREATE TABLE "legal_source_snapshot_current_pointers" (
  "id" text PRIMARY KEY NOT NULL,
  "build_id" text NOT NULL,
  "source_document_id" text NOT NULL,
  "source_snapshot_id" text NOT NULL,
  "evidence_url" text NOT NULL,
  "verified_at" text NOT NULL,
  "recorded_at" text NOT NULL,
  UNIQUE ("build_id","source_document_id"),
  UNIQUE ("build_id","source_snapshot_id")
);

CREATE TABLE "legal_retrieval_eligibility" (
  "id" text PRIMARY KEY NOT NULL,
  "build_id" text NOT NULL,
  "snapshot_provision_id" text NOT NULL,
  "capability" text NOT NULL,
  "status" text NOT NULL,
  "reason_codes_json" text NOT NULL,
  "official_source_verified" bigint NOT NULL,
  "d1_r2_integrity_verified" bigint NOT NULL,
  "extraction_verified" bigint NOT NULL,
  "identity_stable" bigint NOT NULL,
  "current_pointer_verified" bigint NOT NULL,
  "temporal_state_supported" bigint NOT NULL,
  "privacy_verified" bigint NOT NULL,
  "quarantine_clear" bigint NOT NULL,
  "canonicalization_clear" bigint NOT NULL,
  "evaluated_at" text NOT NULL,
  CONSTRAINT "legal_retrieval_eligibility_capability_check"
    CHECK ("capability" IN ('current','as_of','comparison')),
  CONSTRAINT "legal_retrieval_eligibility_status_check"
    CHECK ("status" IN ('eligible','ineligible','gap')),
  CONSTRAINT "legal_retrieval_eligibility_boolean_check" CHECK (
    "official_source_verified" IN (0,1) AND "d1_r2_integrity_verified" IN (0,1)
    AND "extraction_verified" IN (0,1) AND "identity_stable" IN (0,1)
    AND "current_pointer_verified" IN (0,1) AND "temporal_state_supported" IN (0,1)
    AND "privacy_verified" IN (0,1) AND "quarantine_clear" IN (0,1)
    AND "canonicalization_clear" IN (0,1)),
  UNIQUE ("build_id","snapshot_provision_id","capability")
);

CREATE TABLE "legal_source_snapshot_quarantines" (
  "id" text PRIMARY KEY NOT NULL,
  "source_document_id" text NOT NULL,
  "source_version_token" text NOT NULL,
  "reason_code" text NOT NULL,
  "evidence_json" text NOT NULL,
  "recorded_at" text NOT NULL,
  UNIQUE ("source_document_id","source_version_token","reason_code")
);

CREATE TABLE "legal_source_snapshot_aliases" (
  "id" text PRIMARY KEY NOT NULL,
  "subject_type" text NOT NULL,
  "alias_identity" text NOT NULL,
  "canonical_identity" text NOT NULL,
  "reason_code" text NOT NULL,
  "evidence_json" text NOT NULL,
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_source_snapshot_alias_subject_check"
    CHECK ("subject_type" IN ('source_document','source_snapshot','snapshot_provision','canonical_chunk')),
  UNIQUE ("subject_type","alias_identity")
);

CREATE TABLE "legal_canonical_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "snapshot_provision_id" text NOT NULL,
  "ordinal" bigint NOT NULL,
  "r2_key" text NOT NULL UNIQUE,
  "byte_count" bigint NOT NULL,
  "sha256" text NOT NULL,
  "schema_version" bigint NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_canonical_chunk_ordinal_check" CHECK ("ordinal">=0),
  CONSTRAINT "legal_canonical_chunk_size_check" CHECK ("byte_count">0),
  CONSTRAINT "legal_canonical_chunk_hash_check"
    CHECK (length("sha256")=64 AND "sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_canonical_chunk_schema_check" CHECK ("schema_version"=1),
  UNIQUE ("snapshot_provision_id","ordinal")
);

CREATE TABLE "legal_sparse_projection_postings" (
  "canonical_chunk_id" text PRIMARY KEY NOT NULL,
  "posting_inventory_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_sparse_projection_hash_check"
    CHECK (length("posting_inventory_sha256")=64
      AND "posting_inventory_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_dense_projection_candidates" (
  "canonical_chunk_id" text PRIMARY KEY NOT NULL,
  "embedding_model" text NOT NULL,
  "dimensions" bigint NOT NULL,
  "provider_candidate_id" text NOT NULL UNIQUE,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_dense_projection_dimensions_check" CHECK ("dimensions"=1536)
);

CREATE TABLE "legal_source_snapshot_release_members" (
  "search_release_id" text NOT NULL,
  "canonical_chunk_id" text NOT NULL,
  "snapshot_provision_id" text NOT NULL,
  "shard_id" text NOT NULL,
  PRIMARY KEY ("search_release_id","canonical_chunk_id")
);

CREATE TABLE "legal_source_snapshot_builds" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "cutoff_at" text NOT NULL,
  "release_id" text NOT NULL,
  "configuration_identity" text NOT NULL,
  "shard_count" bigint NOT NULL,
  "status" text NOT NULL,
  "phase" text NOT NULL,
  "cursor" text,
  "processed_count" bigint NOT NULL DEFAULT 0,
  "eligible_count" bigint NOT NULL DEFAULT 0,
  "excluded_count" bigint NOT NULL DEFAULT 0,
  "inventory_sha256" text,
  "projection_sha256" text,
  "release_sha256" text,
  "error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "legal_source_snapshot_build_environment_check"
    CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_source_snapshot_build_shard_check" CHECK ("shard_count" BETWEEN 1 AND 99),
  CONSTRAINT "legal_source_snapshot_build_status_check"
    CHECK ("status" IN ('building','complete','sealed','failed')),
  CONSTRAINT "legal_source_snapshot_build_phase_check"
    CHECK ("phase" IN ('inventory','projections','reconciliation','release','complete')),
  CONSTRAINT "legal_source_snapshot_build_count_check"
    CHECK ("processed_count">=0 AND "eligible_count">=0 AND "excluded_count">=0)
);

CREATE TABLE "legal_source_snapshot_build_checkpoints" (
  "build_id" text NOT NULL,
  "phase" text NOT NULL,
  "cursor" text,
  "item_count" bigint NOT NULL,
  "identity_sha256" text NOT NULL,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("build_id","phase"),
  CONSTRAINT "legal_source_snapshot_checkpoint_phase_check"
    CHECK ("phase" IN ('inventory','projections','release','reconciliation','recovery')),
  CONSTRAINT "legal_source_snapshot_checkpoint_count_check" CHECK ("item_count">=0),
  CONSTRAINT "legal_source_snapshot_checkpoint_hash_check"
    CHECK (length("identity_sha256")=64 AND "identity_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_snapshot_inventories" (
  "build_id" text NOT NULL,
  "inventory_kind" text NOT NULL,
  "item_count" bigint NOT NULL,
  "inventory_sha256" text NOT NULL,
  "inventory_json" text NOT NULL,
  "recorded_at" text NOT NULL,
  PRIMARY KEY ("build_id","inventory_kind"),
  CONSTRAINT "legal_source_snapshot_inventory_count_check" CHECK ("item_count">=0),
  CONSTRAINT "legal_source_snapshot_inventory_hash_check"
    CHECK (length("inventory_sha256")=64 AND "inventory_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_snapshot_deferred_inventories" (
  "build_id" text NOT NULL,
  "inventory_kind" text NOT NULL,
  "item_count" bigint NOT NULL,
  "inventory_sha256" text NOT NULL,
  "evidence_json" text NOT NULL,
  "recorded_at" text NOT NULL,
  PRIMARY KEY ("build_id","inventory_kind")
);

CREATE TABLE "legal_source_snapshot_stable_identities" (
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "canonical_identity_sha256" text NOT NULL,
  "identity_evidence_json" text NOT NULL,
  "recorded_at" text NOT NULL,
  PRIMARY KEY ("subject_type","subject_id"),
  UNIQUE ("subject_type","canonical_identity_sha256"),
  CONSTRAINT "legal_source_snapshot_stable_identity_subject_check"
    CHECK ("subject_type" IN ('source_document','source_snapshot','snapshot_provision')),
  CONSTRAINT "legal_source_snapshot_stable_identity_hash_check"
    CHECK (length("canonical_identity_sha256")=64
      AND "canonical_identity_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_snapshot_integrity_attestations" (
  "build_id" text NOT NULL,
  "snapshot_provision_id" text NOT NULL,
  "source_object_r2_key" text NOT NULL,
  "source_object_byte_count" bigint NOT NULL,
  "source_object_sha256" text NOT NULL,
  "normalized_text_sha256" text NOT NULL,
  "verified_at" text NOT NULL,
  PRIMARY KEY ("build_id","snapshot_provision_id"),
  CONSTRAINT "legal_source_snapshot_integrity_size_check" CHECK ("source_object_byte_count">0),
  CONSTRAINT "legal_source_snapshot_integrity_hash_check" CHECK (
    length("source_object_sha256")=64 AND "source_object_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("normalized_text_sha256")=64
    AND "normalized_text_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_snapshot_replay_pages" (
  "build_id" text NOT NULL,
  "run_id" text NOT NULL,
  "lane" text NOT NULL,
  "page" bigint NOT NULL,
  "last_snapshot_provision_id" text NOT NULL,
  "item_count" bigint NOT NULL,
  "identity_sha256" text NOT NULL,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("build_id","run_id","lane","page"),
  CONSTRAINT "legal_source_snapshot_replay_run_check" CHECK ("run_id" IN ('baseline','repeat')),
  CONSTRAINT "legal_source_snapshot_replay_lane_check" CHECK ("lane" ~ '^[0-9a-f][0-9a-f]$'),
  CONSTRAINT "legal_source_snapshot_replay_count_check" CHECK ("page">=0 AND "item_count">0),
  CONSTRAINT "legal_source_snapshot_replay_hash_check"
    CHECK (length("identity_sha256")=64 AND "identity_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_snapshot_replay_runs" (
  "build_id" text NOT NULL,
  "run_id" text NOT NULL,
  "item_count" bigint NOT NULL,
  "identity_sha256" text NOT NULL,
  "status" text NOT NULL,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("build_id","run_id"),
  CONSTRAINT "legal_source_snapshot_replay_status_check" CHECK ("status"='clean'),
  CONSTRAINT "legal_source_snapshot_replay_run_count_check" CHECK ("item_count">0),
  CONSTRAINT "legal_source_snapshot_replay_run_hash_check"
    CHECK (length("identity_sha256")=64 AND "identity_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_snapshot_qualifications" (
  "build_id" text PRIMARY KEY NOT NULL,
  "release_id" text NOT NULL,
  "recovery_sql_sha256" text NOT NULL,
  "recovery_sqlite_sha256" text NOT NULL,
  "validation_sha256" text NOT NULL,
  "standards_review_sha256" text NOT NULL,
  "spec_review_sha256" text NOT NULL,
  "qualification_sha256" text NOT NULL,
  "qualified_at" text NOT NULL
);

CREATE TABLE "legal_ai_search_projection_builds" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "search_release_id" text NOT NULL,
  "projection_bucket_name" text NOT NULL,
  "source_release_sha256" text NOT NULL,
  "status" text NOT NULL,
  "cursor" text,
  "expected_item_count" bigint NOT NULL,
  "copied_item_count" bigint NOT NULL DEFAULT 0,
  "projection_sha256" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "completed_at" text,
  CONSTRAINT "legal_ai_search_projection_environment_check"
    CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_ai_search_projection_status_check"
    CHECK ("status" IN ('building','complete','failed')),
  CONSTRAINT "legal_ai_search_projection_count_check"
    CHECK ("expected_item_count">=0 AND "copied_item_count">=0
      AND "copied_item_count"<="expected_item_count"),
  CONSTRAINT "legal_ai_search_projection_source_hash_check"
    CHECK (length("source_release_sha256")=64
      AND "source_release_sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_ai_search_projection_hash_check"
    CHECK ("projection_sha256" IS NULL OR (length("projection_sha256")=64
      AND "projection_sha256" !~ '^.*[^0-9a-f].*$')),
  UNIQUE ("search_release_id","projection_bucket_name")
);

CREATE TABLE "legal_ai_search_projection_items" (
  "build_id" text NOT NULL,
  "search_release_id" text NOT NULL,
  "item_key" text NOT NULL,
  "canonical_chunk_id" text NOT NULL,
  "evidence_r2_key" text NOT NULL,
  "byte_count" bigint NOT NULL,
  "sha256" text NOT NULL,
  "metadata_json" text NOT NULL,
  "copied_at" text NOT NULL,
  PRIMARY KEY ("build_id","item_key"),
  CONSTRAINT "legal_ai_search_projection_item_size_check" CHECK ("byte_count">0),
  CONSTRAINT "legal_ai_search_projection_item_hash_check"
    CHECK (length("sha256")=64 AND "sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_ai_search_projection_checkpoints" (
  "build_id" text NOT NULL,
  "lane" text NOT NULL,
  "status" text NOT NULL,
  "cursor" text,
  "copied_item_count" bigint NOT NULL DEFAULT 0,
  "updated_at" text NOT NULL,
  "completed_at" text,
  PRIMARY KEY ("build_id","lane"),
  CONSTRAINT "legal_ai_search_projection_lane_check"
    CHECK (length("lane")=2 AND "lane" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_ai_search_projection_checkpoint_status_check"
    CHECK ("status" IN ('building','complete')),
  CONSTRAINT "legal_ai_search_projection_checkpoint_count_check"
    CHECK ("copied_item_count">=0)
);

CREATE TABLE "legal_search_release_provider_instances" (
  "governance_id" text NOT NULL,
  "search_release_id" text NOT NULL,
  "shard_id" text NOT NULL,
  "provider_namespace" text NOT NULL,
  "provider_instance_id" text NOT NULL,
  "sync_job_id" text NOT NULL,
  "scheduled_indexing_paused" bigint NOT NULL,
  PRIMARY KEY ("governance_id","shard_id"),
  CONSTRAINT "legal_release_provider_pause_check"
    CHECK ("scheduled_indexing_paused" IN (0,1)),
  UNIQUE ("governance_id","provider_instance_id")
);

CREATE TABLE "legal_search_candidate_qualifications" (
  "id" text PRIMARY KEY NOT NULL,
  "search_release_id" text NOT NULL,
  "environment" text NOT NULL,
  "capability" text NOT NULL,
  "reconciliation_run_id" text NOT NULL,
  "provider_namespace" text NOT NULL,
  "provider_instance_id" text NOT NULL,
  "shard_id" text NOT NULL,
  "sync_job_id" text NOT NULL,
  "configuration_json" text NOT NULL,
  "configuration_sha256" text NOT NULL,
  "provider_item_count" bigint NOT NULL,
  "provider_chunk_count" bigint NOT NULL,
  "provider_inventory_sha256" text NOT NULL,
  "provider_reconciliation_json" text NOT NULL,
  "provider_reconciliation_sha256" text NOT NULL,
  "source_prefix" text NOT NULL,
  "scheduled_indexing_paused" bigint NOT NULL,
  "status" text NOT NULL,
  "recorded_at" text NOT NULL,
  CONSTRAINT "legal_candidate_qualification_environment_check"
    CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_candidate_qualification_capability_check"
    CHECK ("capability" IN ('current','history')),
  CONSTRAINT "legal_candidate_qualification_shard_check"
    CHECK (length("shard_id")=2 AND "shard_id" !~ '^.*[^0-9].*$'),
  CONSTRAINT "legal_candidate_qualification_hash_check"
    CHECK (length("configuration_sha256")=64
      AND "configuration_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("provider_inventory_sha256")=64
      AND "provider_inventory_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("provider_reconciliation_sha256")=64
      AND "provider_reconciliation_sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_candidate_qualification_count_check"
    CHECK ("provider_item_count">0 AND "provider_chunk_count">="provider_item_count"),
  CONSTRAINT "legal_candidate_qualification_pause_check"
    CHECK ("scheduled_indexing_paused"=1),
  CONSTRAINT "legal_candidate_qualification_status_check"
    CHECK ("status"='qualified'),
  UNIQUE ("search_release_id","provider_instance_id","recorded_at")
);

CREATE TABLE "legal_custom_search_release_components" (
  "search_release_id" text PRIMARY KEY NOT NULL,
  "schema_version" text NOT NULL,
  "source_root_sha256" text NOT NULL,
  "chunk_policy_version" text NOT NULL,
  "chunk_inventory_r2_key" text NOT NULL,
  "chunk_inventory_sha256" text NOT NULL,
  "chunk_count" bigint NOT NULL,
  "sparse_analyzer" text NOT NULL,
  "sparse_partition_count" bigint NOT NULL,
  "sparse_manifest_r2_key" text NOT NULL,
  "sparse_manifest_sha256" text NOT NULL,
  "embedding_input_version" text NOT NULL,
  "embedding_model" text NOT NULL,
  "embedding_dimensions" bigint NOT NULL,
  "embedding_transform_version" text NOT NULL,
  "embedding_inventory_r2_key" text NOT NULL,
  "embedding_inventory_sha256" text NOT NULL,
  "vectorize_index_name" text NOT NULL,
  "vectorize_final_mutation_id" text NOT NULL,
  "vectorize_inventory_r2_key" text NOT NULL,
  "vectorize_inventory_sha256" text NOT NULL,
  "vector_count" bigint NOT NULL,
  "metadata_indexes_json" text NOT NULL,
  "metadata_indexes_sha256" text NOT NULL,
  "fusion_policy_version" text NOT NULL,
  "provider_input_tokens" bigint NOT NULL,
  "provider_cost_usd_micros" bigint NOT NULL,
  "configuration_sha256" text NOT NULL,
  "privacy_attestation_sha256" text NOT NULL,
  "restore_preflight_sha256" text NOT NULL,
  "sealed_at" text NOT NULL,
  CONSTRAINT "legal_custom_component_schema_check"
    CHECK ("schema_version"='custom-search-release-v1'),
  CONSTRAINT "legal_custom_component_policy_check"
    CHECK ("chunk_policy_version"='retrieval-chunk-v1'
      AND "sparse_analyzer"='word-v1'
      AND "sparse_partition_count"=16
      AND "embedding_input_version"='legal-embedding-input-v1'
      AND "embedding_model"='text-embedding-3-large'
      AND "embedding_dimensions"=1536
      AND "embedding_transform_version"='float32-l2-v1'
      AND "fusion_policy_version"='equal-rrf-k60-v1'),
  CONSTRAINT "legal_custom_component_count_check"
    CHECK ("chunk_count">0 AND "vector_count"="chunk_count"
      AND "provider_input_tokens">=0 AND "provider_cost_usd_micros">=0),
  CONSTRAINT "legal_custom_component_hash_check"
    CHECK (length("source_root_sha256")=64 AND "source_root_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("chunk_inventory_sha256")=64 AND "chunk_inventory_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("sparse_manifest_sha256")=64 AND "sparse_manifest_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("embedding_inventory_sha256")=64 AND "embedding_inventory_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("vectorize_inventory_sha256")=64 AND "vectorize_inventory_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("metadata_indexes_sha256")=64 AND "metadata_indexes_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("configuration_sha256")=64 AND "configuration_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("privacy_attestation_sha256")=64 AND "privacy_attestation_sha256" !~ '^.*[^0-9a-f].*$'
      AND length("restore_preflight_sha256")=64 AND "restore_preflight_sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_custom_component_r2_key_check"
    CHECK (length(trim("chunk_inventory_r2_key"))>0
      AND length(trim("sparse_manifest_r2_key"))>0
      AND length(trim("embedding_inventory_r2_key"))>0
      AND length(trim("vectorize_inventory_r2_key"))>0),
  CONSTRAINT "legal_custom_component_vectorize_check"
    CHECK (length(trim("vectorize_index_name"))>0
      AND length(trim("vectorize_final_mutation_id"))>0),
  CONSTRAINT "legal_custom_component_metadata_check"
    CHECK (json_valid("metadata_indexes_json")
      AND "metadata_indexes_json"='["document_type","language","valid_from_epoch","valid_to_epoch"]')
);

CREATE TABLE "legal_complete_corpus_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "schema_version" text NOT NULL,
  "source_cutoff" text NOT NULL,
  "source_bookmark" text NOT NULL,
  "source_inventory_sha256" text NOT NULL,
  "source_canonical_sha256" text NOT NULL,
  "source_alias_sha256" text NOT NULL,
  "source_r2_object_manifest_sha256" text NOT NULL,
  "source_r2_alias_manifest_sha256" text NOT NULL,
  "source_empty_version_manifest_sha256" text NOT NULL,
  "plan_r2_key" text,
  "plan_sha256" text,
  "final_reconstruction_r2_key" text,
  "final_reconstruction_sha256" text,
  "status" text NOT NULL,
  "expected_record_count" bigint NOT NULL,
  "materialized_record_count" bigint NOT NULL DEFAULT 0,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "completed_at" text,
  CONSTRAINT "legal_complete_corpus_run_schema_check" CHECK ("schema_version"='complete-corpus-materialization-v1'),
  CONSTRAINT "legal_complete_corpus_run_status_check" CHECK ("status" IN ('building','materialized','complete','failed')),
  CONSTRAINT "legal_complete_corpus_run_count_check" CHECK ("expected_record_count">=0 AND "materialized_record_count">=0),
  CONSTRAINT "legal_complete_corpus_run_hash_check" CHECK (
    length("source_inventory_sha256")=64 AND "source_inventory_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("source_canonical_sha256")=64 AND "source_canonical_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("source_alias_sha256")=64 AND "source_alias_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("source_r2_object_manifest_sha256")=64 AND "source_r2_object_manifest_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("source_r2_alias_manifest_sha256")=64 AND "source_r2_alias_manifest_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("source_empty_version_manifest_sha256")=64 AND "source_empty_version_manifest_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("plan_sha256")=64 AND "plan_sha256" !~ '^.*[^0-9a-f].*$'
  )
);

CREATE TABLE "legal_complete_corpus_objects" (
  "run_id" text NOT NULL,
  "object_kind" text NOT NULL,
  "sha256" text NOT NULL,
  "r2_key" text NOT NULL,
  "byte_count" bigint NOT NULL,
  "materialization_disposition" text NOT NULL,
  "media_type" text NOT NULL,
  "schema_version" text NOT NULL,
  "normalization_version" text NOT NULL,
  "source_r2_key" text,
  "source_sha256" text,
  "source_normalized_sha256" text,
  "descriptor_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  UNIQUE ("run_id","object_kind","sha256"),
  UNIQUE ("run_id","r2_key"),
  CONSTRAINT "legal_complete_corpus_object_kind_check" CHECK ("object_kind" IN ('raw_capture','normalized_revision','provision_rendition','plan','manifest','reconstruction','corpus_snapshot')),
  CONSTRAINT "legal_complete_corpus_object_count_check" CHECK ("byte_count">=0),
  CONSTRAINT "legal_complete_corpus_object_disposition_check" CHECK ("materialization_disposition" IN ('created','reused')),
  CONSTRAINT "legal_complete_corpus_object_hash_check" CHECK (length("sha256")=64 AND "sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_complete_corpus_records" (
  "run_id" text NOT NULL,
  "source_id" text NOT NULL,
  "source_document_id" text NOT NULL,
  "source_version_id" text NOT NULL,
  "instrument_id" text NOT NULL,
  "official_expression_id" text NOT NULL,
  "text_revision_id" text NOT NULL,
  "provision_concept_id" text NOT NULL,
  "provision_rendition_id" text NOT NULL,
  "legacy_current_rendition_id" text NOT NULL,
  "publisher_revision_token" text NOT NULL,
  "legacy_target_publisher_revision_token" text NOT NULL,
  "source_publisher_revision_token" text NOT NULL,
  "publisher_provision_token" text NOT NULL,
  "applicability_identity" text NOT NULL,
  "identity_stage" text NOT NULL,
  "textual_authority" text NOT NULL,
  "provision_source_url" text,
  "version_source_url" text,
  "previous_source_version_id" text,
  "source_change_type" text NOT NULL,
  "source_revision_sha256" text NOT NULL,
  "object_metadata_revision_sha256" text NOT NULL,
  "record_sha256" text NOT NULL,
  "legal_identity_sha256" text NOT NULL,
  "material_sha256" text NOT NULL,
  "content_sha256" text NOT NULL,
  "raw_source_r2_key" text NOT NULL,
  "raw_source_sha256" text NOT NULL,
  "normalized_source_r2_key" text NOT NULL,
  "normalized_source_sha256" text NOT NULL,
  "raw_object_r2_key" text NOT NULL,
  "normalized_object_r2_key" text NOT NULL,
  "provision_object_r2_key" text NOT NULL,
  "provision_object_sha256" text NOT NULL,
  "language" text NOT NULL,
  "script" text NOT NULL,
  "ordinal" bigint NOT NULL,
  "valid_from" text,
  "valid_to" text,
  "current_eligible" bigint NOT NULL,
  "historical_eligible" bigint NOT NULL,
  "temporal_gap" bigint NOT NULL,
  "quarantined" bigint NOT NULL,
  "created_at" text NOT NULL,
  UNIQUE ("run_id","legal_identity_sha256"),
  UNIQUE ("run_id","source_id"),
  UNIQUE ("run_id","provision_rendition_id"),
  CONSTRAINT "legal_complete_corpus_record_ordinal_check" CHECK ("ordinal">=0),
  CONSTRAINT "legal_complete_corpus_record_identity_stage_check" CHECK ("identity_stage"='ticket29-provisional-v1'),
  CONSTRAINT "legal_complete_corpus_record_boolean_check" CHECK ("current_eligible" IN (0,1) AND "historical_eligible" IN (0,1) AND "temporal_gap" IN (0,1) AND "quarantined" IN (0,1)),
  CONSTRAINT "legal_complete_corpus_record_temporal_check" CHECK (("temporal_gap"=1 AND "valid_from" IS NULL AND "current_eligible"=0 AND "historical_eligible"=0) OR ("temporal_gap"=0 AND "valid_from" IS NOT NULL))
);

CREATE TABLE "legal_complete_corpus_aliases" (
  "run_id" text NOT NULL,
  "owner_kind" text NOT NULL,
  "owner_id" text NOT NULL,
  "target_identity" text NOT NULL,
  "alias_kind" text NOT NULL,
  "alias_sha256" text NOT NULL,
  "alias_value" text NOT NULL,
  "row_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  UNIQUE ("run_id","owner_kind","owner_id","alias_kind"),
  CONSTRAINT "legal_complete_corpus_alias_owner_check" CHECK ("owner_kind"='source_version'),
  CONSTRAINT "legal_complete_corpus_alias_kind_check" CHECK ("alias_kind" IN ('raw_capture','normalized_revision','version_url'))
);

CREATE TABLE "legal_complete_corpus_lineage_refs" (
  "run_id" text NOT NULL,
  "source_version_id" text NOT NULL,
  "previous_source_version_id" text,
  "change_type" text NOT NULL,
  "row_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  UNIQUE ("run_id","source_version_id")
);

CREATE TABLE "legal_complete_corpus_quarantines" (
  "run_id" text NOT NULL,
  "source_version_id" text NOT NULL,
  "source_document_id" text NOT NULL,
  "instrument_id" text NOT NULL,
  "official_expression_id" text NOT NULL,
  "text_revision_id" text NOT NULL,
  "publisher_revision_token" text NOT NULL,
  "legacy_target_publisher_revision_token" text NOT NULL,
  "source_publisher_revision_token" text NOT NULL,
  "identity_stage" text NOT NULL,
  "language" text NOT NULL,
  "script" text NOT NULL,
  "version_source_url" text,
  "canonical_source_url" text,
  "previous_source_version_id" text,
  "source_change_type" text NOT NULL,
  "source_availability_status" text NOT NULL,
  "source_revision_sha256" text NOT NULL,
  "raw_source_r2_key" text NOT NULL,
  "raw_source_sha256" text NOT NULL,
  "normalized_source_r2_key" text NOT NULL,
  "normalized_source_sha256" text NOT NULL,
  "raw_object_r2_key" text NOT NULL,
  "normalized_object_r2_key" text NOT NULL,
  "reason" text NOT NULL,
  "row_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  PRIMARY KEY ("run_id","source_version_id"),
  CONSTRAINT "legal_complete_corpus_quarantine_reason_check" CHECK ("reason"='NO_MATERIALIZED_PROVISIONS'),
  CONSTRAINT "legal_complete_corpus_quarantine_identity_stage_check" CHECK ("identity_stage"='ticket29-provisional-v1')
);

CREATE TABLE "legal_complete_corpus_quarantine_attempts" (
  "run_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "record_count" bigint NOT NULL,
  "created_object_count" bigint NOT NULL,
  "reused_object_count" bigint NOT NULL,
  "created_byte_count" bigint NOT NULL,
  "reused_byte_count" bigint NOT NULL,
  "root_sha256" text NOT NULL,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("run_id","attempt_id")
);

CREATE TABLE "legal_complete_corpus_interruptions" (
  "run_id" text NOT NULL,
  "page_sha256" text NOT NULL,
  "checkpoint" text NOT NULL,
  "record_count" bigint NOT NULL,
  "created_object_count" bigint NOT NULL,
  "reused_object_count" bigint NOT NULL,
  "created_byte_count" bigint NOT NULL,
  "reused_byte_count" bigint NOT NULL,
  "recorded_at" text NOT NULL,
  PRIMARY KEY ("run_id","page_sha256","checkpoint"),
  CONSTRAINT "legal_complete_corpus_interruption_checkpoint_check" CHECK ("checkpoint"='objects_durable_before_receipt')
);

CREATE TABLE "legal_complete_corpus_pages" (
  "run_id" text NOT NULL,
  "page_sha256" text NOT NULL,
  "plan_offset" bigint NOT NULL,
  "plan_length" bigint NOT NULL,
  "plan_r2_key" text NOT NULL,
  "record_count" bigint NOT NULL,
  "created_object_count" bigint NOT NULL,
  "reused_object_count" bigint NOT NULL,
  "created_byte_count" bigint NOT NULL,
  "reused_byte_count" bigint NOT NULL,
  "receipt_sha256" text NOT NULL,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("run_id","page_sha256")
);

CREATE TABLE "legal_complete_corpus_attempt_pages" (
  "run_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "page_sha256" text NOT NULL,
  "record_count" bigint NOT NULL,
  "created_object_count" bigint NOT NULL,
  "reused_object_count" bigint NOT NULL,
  "created_byte_count" bigint NOT NULL,
  "reused_byte_count" bigint NOT NULL,
  "receipt_sha256" text NOT NULL,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("run_id","attempt_id","page_sha256")
);

CREATE TABLE "legal_complete_corpus_manifests" (
  "run_id" text NOT NULL,
  "membership" text NOT NULL,
  "record_count" bigint NOT NULL,
  "root_sha256" text NOT NULL,
  "r2_key" text NOT NULL,
  "manifest_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  PRIMARY KEY ("run_id","membership"),
  CONSTRAINT "legal_complete_corpus_manifest_membership_check" CHECK ("membership" IN ('union','current','history','gaps','quarantines'))
);

CREATE TABLE "legal_complete_corpus_lane_reports" (
  "run_id" text NOT NULL,
  "report_kind" text NOT NULL,
  "lane" text NOT NULL,
  "record_count" bigint NOT NULL,
  "current_count" bigint NOT NULL,
  "history_count" bigint NOT NULL,
  "gap_count" bigint NOT NULL,
  "verified_object_count" bigint NOT NULL,
  "root_sha256" text NOT NULL,
  "r2_key" text NOT NULL,
  "report_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  PRIMARY KEY ("run_id","report_kind","lane"),
  CONSTRAINT "legal_complete_corpus_lane_report_kind_check" CHECK ("report_kind" IN ('plan','manifest','reconstruction'))
);

CREATE TABLE "legal_complete_corpus_control_attempts" (
  "run_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "stage" text NOT NULL,
  "lane" text NOT NULL,
  "record_count" bigint NOT NULL,
  "created_object_count" bigint NOT NULL,
  "reused_object_count" bigint NOT NULL,
  "created_byte_count" bigint NOT NULL,
  "reused_byte_count" bigint NOT NULL,
  "root_sha256" text NOT NULL,
  "completed_at" text NOT NULL,
  PRIMARY KEY ("run_id","attempt_id","stage","lane"),
  CONSTRAINT "legal_complete_corpus_control_attempt_id_check" CHECK ("attempt_id" IN ('ticket29:first','ticket29:second')),
  CONSTRAINT "legal_complete_corpus_control_stage_check" CHECK ("stage" IN ('plan','manifest','reconstruction','finalize')),
  CONSTRAINT "legal_complete_corpus_control_count_check" CHECK (
    "record_count">=0 AND "created_object_count">=0 AND "reused_object_count">=0
    AND "created_byte_count">=0 AND "reused_byte_count">=0
  )
);

CREATE TABLE "legal_complete_corpus_qualifications" (
  "run_id" text NOT NULL PRIMARY KEY,
  "report_r2_key" text NOT NULL,
  "report_sha256" text NOT NULL,
  "report_byte_count" bigint NOT NULL,
  "report_write_disposition" text NOT NULL,
  "database_export_sha256" text NOT NULL,
  "database_export_byte_count" bigint NOT NULL,
  "evidence_object_count" bigint NOT NULL,
  "evidence_byte_count" bigint NOT NULL,
  "evidence_root_sha256" text NOT NULL,
  "qualified_at" text NOT NULL,
  CONSTRAINT "legal_complete_corpus_qualification_disposition_check" CHECK ("report_write_disposition" IN ('created','reused')),
  CONSTRAINT "legal_complete_corpus_qualification_count_check" CHECK (
    "report_byte_count">=0 AND "database_export_byte_count">=0
    AND "evidence_object_count">=0 AND "evidence_byte_count">=0
  )
);

CREATE TABLE "legal_complete_corpus_snapshots" (
  "run_id" text NOT NULL PRIMARY KEY,
  "snapshot_id" text NOT NULL UNIQUE,
  "source_cutoff" text NOT NULL,
  "source_inventory_sha256" text NOT NULL,
  "source_canonical_sha256" text NOT NULL,
  "source_alias_sha256" text NOT NULL,
  "union_root_sha256" text NOT NULL,
  "current_root_sha256" text NOT NULL,
  "history_root_sha256" text NOT NULL,
  "gaps_root_sha256" text NOT NULL,
  "quarantines_root_sha256" text NOT NULL,
  "r2_key" text NOT NULL UNIQUE,
  "snapshot_sha256" text NOT NULL,
  "byte_count" bigint NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "legal_custom_search_runtime_components" (
  "search_release_id" text PRIMARY KEY NOT NULL,
  "complete_corpus_run_id" text NOT NULL,
  "schema_version" text NOT NULL,
  "sparse_manifest_sha256" text NOT NULL,
  "runtime_descriptor_r2_key" text NOT NULL,
  "runtime_descriptor_sha256" text NOT NULL,
  "runtime_documents_r2_key" text NOT NULL,
  "runtime_documents_sha256" text NOT NULL,
  "runtime_documents_size_bytes" bigint NOT NULL,
  "mapping_count" bigint NOT NULL,
  "mapping_inventory_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_custom_runtime_schema_check"
    CHECK ("schema_version"='custom-search-runtime-v1'),
  CONSTRAINT "legal_custom_runtime_count_check"
    CHECK ("runtime_documents_size_bytes">0 AND "mapping_count">0),
  CONSTRAINT "legal_custom_runtime_hash_check" CHECK (
    length("sparse_manifest_sha256")=64 AND "sparse_manifest_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("runtime_descriptor_sha256")=64 AND "runtime_descriptor_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("runtime_documents_sha256")=64 AND "runtime_documents_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("mapping_inventory_sha256")=64 AND "mapping_inventory_sha256" !~ '^.*[^0-9a-f].*$'
  )
);

CREATE TABLE "legal_custom_search_runtime_items" (
  "search_release_id" text NOT NULL,
  "item_key" text NOT NULL,
  "retrieval_chunk_id" text NOT NULL,
  "item_ordinal" bigint NOT NULL,
  "legal_identity_sha256" text NOT NULL,
  PRIMARY KEY ("search_release_id","item_key"),
  UNIQUE ("search_release_id","retrieval_chunk_id"),
  UNIQUE ("search_release_id","item_ordinal"),
  CONSTRAINT "legal_custom_runtime_item_ordinal_check" CHECK ("item_ordinal">=0),
  CONSTRAINT "legal_custom_runtime_item_identity_check"
    CHECK (length("legal_identity_sha256")=64 AND "legal_identity_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_custom_query_budget_periods" (
  "environment" text NOT NULL,
  "period" text NOT NULL,
  "authorized_usd_micros" bigint NOT NULL,
  "reserved_usd_micros" bigint NOT NULL DEFAULT 0,
  "reserved_requests" bigint NOT NULL DEFAULT 0,
  "created_at" text NOT NULL,
  PRIMARY KEY ("environment","period"),
  CONSTRAINT "legal_custom_query_budget_environment_check"
    CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_custom_query_budget_amount_check"
    CHECK ("authorized_usd_micros">=0 AND "reserved_usd_micros">=0
      AND "reserved_usd_micros"<="authorized_usd_micros" AND "reserved_requests">=0)
);

CREATE TABLE "legal_custom_query_reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "period" text NOT NULL,
  "release_id" text NOT NULL,
  "reserved_usd_micros" bigint NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_custom_query_reservation_amount_check" CHECK ("reserved_usd_micros">0)
);

CREATE TABLE "legal_custom_search_title_inventories" (
  "search_release_id" text PRIMARY KEY NOT NULL,
  "title_count" bigint NOT NULL CHECK ("title_count">0),
  "inventory_sha256" text NOT NULL CHECK (
    length("inventory_sha256")=64 AND "inventory_sha256" !~ '^.*[^0-9a-f].*$'),
  "created_at" text NOT NULL
);

CREATE TABLE "legal_custom_search_trusted_titles" (
  "search_release_id" text NOT NULL,
  "title" text NOT NULL CHECK (length(trim("title"))>0),
  PRIMARY KEY ("search_release_id","title")
);

CREATE TABLE "legal_historical_metadata_acceptances" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL CHECK ("environment" IN ('development','staging','production')),
  "catalog_database_id" text NOT NULL,
  "complete_corpus_run_id" text NOT NULL UNIQUE,
  "history_root_sha256" text NOT NULL CHECK (
    length("history_root_sha256")=64 AND "history_root_sha256" !~ '^.*[^0-9a-f].*$'),
  "history_record_count" bigint NOT NULL CHECK ("history_record_count">0),
  "gap_record_count" bigint NOT NULL CHECK ("gap_record_count">=0),
  "alias_count" bigint NOT NULL CHECK ("alias_count">=0),
  "lineage_ref_count" bigint NOT NULL CHECK ("lineage_ref_count">=0),
  "active_activation_set_id" text NOT NULL,
  "active_current_release_id" text NOT NULL,
  "waiver_id" text NOT NULL,
  "new_historical_record_count" bigint NOT NULL CHECK ("new_historical_record_count"=0),
  "new_evidence_object_count" bigint NOT NULL CHECK ("new_evidence_object_count"=0),
  "result_r2_key" text NOT NULL UNIQUE,
  "result_sha256" text NOT NULL CHECK (
    length("result_sha256")=64 AND "result_sha256" !~ '^.*[^0-9a-f].*$'),
  "accepted_at" text NOT NULL
);

CREATE TABLE "legal_custom_search_r2_runtime_roots" (
  "search_release_id" text PRIMARY KEY NOT NULL,
  "schema_version" text NOT NULL,
  "sparse_manifest_sha256" text NOT NULL,
  "runtime_descriptor_r2_key" text NOT NULL,
  "runtime_descriptor_sha256" text NOT NULL,
  "runtime_documents_r2_key" text NOT NULL,
  "runtime_documents_sha256" text NOT NULL,
  "runtime_documents_size_bytes" bigint NOT NULL,
  "mapping_count" bigint NOT NULL,
  "mapping_inventory_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_custom_r2_runtime_schema_check"
    CHECK ("schema_version"='custom-search-r2-runtime-v1'),
  CONSTRAINT "legal_custom_r2_runtime_count_check"
    CHECK ("runtime_documents_size_bytes">0 AND "mapping_count">0),
  CONSTRAINT "legal_custom_r2_runtime_hash_check" CHECK (
    length("sparse_manifest_sha256")=64 AND "sparse_manifest_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("runtime_descriptor_sha256")=64 AND "runtime_descriptor_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("runtime_documents_sha256")=64 AND "runtime_documents_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("mapping_inventory_sha256")=64 AND "mapping_inventory_sha256" !~ '^.*[^0-9a-f].*$'
  )
);

CREATE TABLE "legal_custom_search_membership_lookups" (
  "search_release_id" text PRIMARY KEY NOT NULL,
  "source_inventory_sha256" text NOT NULL,
  "lookup_r2_key" text NOT NULL,
  "lookup_sha256" text NOT NULL,
  "lookup_size_bytes" bigint NOT NULL CHECK ("lookup_size_bytes" > 0 AND "lookup_size_bytes" <= 262144),
  "member_count" bigint NOT NULL CHECK ("member_count" > 0),
  "created_at" text NOT NULL,
  CHECK (length("source_inventory_sha256")=64 AND "source_inventory_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("lookup_sha256")=64 AND "lookup_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_custom_search_reference_lookups" (
  "search_release_id" text PRIMARY KEY NOT NULL,
  "source_inventory_sha256" text NOT NULL,
  "lookup_r2_key" text NOT NULL,
  "lookup_sha256" text NOT NULL,
  "lookup_size_bytes" bigint NOT NULL CHECK ("lookup_size_bytes" > 0 AND "lookup_size_bytes" <= 262144),
  "member_count" bigint NOT NULL CHECK ("member_count" > 0),
  "indexed_member_count" bigint NOT NULL CHECK ("indexed_member_count" >= 0 AND "indexed_member_count" <= "member_count"),
  "created_at" text NOT NULL,
  CHECK (length("source_inventory_sha256")=64 AND "source_inventory_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("lookup_sha256")=64 AND "lookup_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_candidate_membership_projections" (
  "search_release_id" text NOT NULL,
  "proof_version" bigint NOT NULL CHECK ("proof_version" > 0),
  "source_inventory_sha256" text NOT NULL,
  "projection_r2_key" text NOT NULL CHECK (length("projection_r2_key") BETWEEN 1 AND 1024),
  "projection_sha256" text NOT NULL,
  "projection_size_bytes" bigint NOT NULL CHECK ("projection_size_bytes" BETWEEN 1 AND 262144),
  "member_count" bigint NOT NULL CHECK ("member_count" BETWEEN 1 AND 16777216),
  "created_at" text NOT NULL,
  PRIMARY KEY ("search_release_id", "proof_version"),
  CHECK (length("source_inventory_sha256")=64 AND "source_inventory_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("projection_sha256")=64 AND "projection_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_observations" (
  "official_url" text PRIMARY KEY NOT NULL,
  "observation_version" bigint NOT NULL CHECK ("observation_version"=1),
  "observed_at" text NOT NULL,
  "is_current" bigint NOT NULL CHECK ("is_current" IN (0,1)),
  "normalized_text_sha256" text NOT NULL,
  "raw_content_sha256" text NOT NULL,
  CHECK (length("normalized_text_sha256")=64 AND "normalized_text_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("raw_content_sha256")=64 AND "raw_content_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_observation_targets" (
  "official_url" text PRIMARY KEY NOT NULL,
  "refresh_after" text NOT NULL,
  "lease_until" text,
  "lease_token" text,
  "last_attempt_at" text,
  "last_error_code" text
);

CREATE TABLE "legal_source_observation_crawl_windows" (
  "host" text PRIMARY KEY NOT NULL,
  "available_at" text NOT NULL
);

CREATE TABLE "legal_source_observation_refresh_leases" (
  "official_url" text PRIMARY KEY NOT NULL,
  "lease_token" text NOT NULL,
  "lease_until" text NOT NULL
);

CREATE TABLE "legal_publisher_status_observations" (
  "official_url" text PRIMARY KEY NOT NULL,
  "observation_version" bigint NOT NULL CHECK ("observation_version"=2),
  "observed_at" text NOT NULL,
  "is_current" bigint NOT NULL CHECK ("is_current" IN (0,1)),
  "normalized_text_sha256" text NOT NULL,
  "raw_content_sha256" text NOT NULL,
  CHECK (length("normalized_text_sha256")=64 AND "normalized_text_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("raw_content_sha256")=64 AND "raw_content_sha256" !~ '^.*[^0-9a-f].*$')
);

ALTER TABLE "legal_official_expressions" ADD FOREIGN KEY ("legal_instrument_id") REFERENCES "legal_instruments"("id") ON DELETE restrict;

ALTER TABLE "legal_text_revisions" ADD FOREIGN KEY ("official_expression_id") REFERENCES "legal_official_expressions"("id") ON DELETE restrict;

ALTER TABLE "legal_text_revisions" ADD FOREIGN KEY ("raw_locator_id") REFERENCES "legal_evidence_locators"("id") ON DELETE restrict;

ALTER TABLE "legal_text_revisions" ADD FOREIGN KEY ("normalized_locator_id") REFERENCES "legal_evidence_locators"("id") ON DELETE restrict;

ALTER TABLE "legal_provision_concepts" ADD FOREIGN KEY ("legal_instrument_id") REFERENCES "legal_instruments"("id") ON DELETE restrict;

ALTER TABLE "legal_provision_renditions" ADD FOREIGN KEY ("provision_concept_id") REFERENCES "legal_provision_concepts"("id") ON DELETE restrict;

ALTER TABLE "legal_provision_renditions" ADD FOREIGN KEY ("text_revision_id") REFERENCES "legal_text_revisions"("id") ON DELETE restrict;

ALTER TABLE "legal_provision_renditions" ADD FOREIGN KEY ("locator_id") REFERENCES "legal_evidence_locators"("id") ON DELETE restrict;

ALTER TABLE "legal_corpus_snapshot_members" ADD FOREIGN KEY ("corpus_snapshot_id") REFERENCES "legal_corpus_snapshots"("id") ON DELETE restrict;

ALTER TABLE "legal_corpus_snapshot_members" ADD FOREIGN KEY ("provision_rendition_id") REFERENCES "legal_provision_renditions"("id") ON DELETE restrict;

ALTER TABLE "legal_corpus_snapshot_members" ADD FOREIGN KEY ("locator_id") REFERENCES "legal_evidence_locators"("id") ON DELETE restrict;

ALTER TABLE "legal_search_releases" ADD FOREIGN KEY ("sealed_reconciliation_run_id") REFERENCES "legal_migration_reconciliation_reports"("run_id") ON DELETE restrict;

ALTER TABLE "legal_search_releases" ADD FOREIGN KEY ("corpus_snapshot_id") REFERENCES "legal_corpus_snapshots"("id") ON DELETE restrict;

ALTER TABLE "legal_search_release_items" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_search_release_items" ADD FOREIGN KEY ("provision_rendition_id") REFERENCES "legal_provision_renditions"("id") ON DELETE restrict;

ALTER TABLE "legal_activation_sets" ADD FOREIGN KEY ("current_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_activation_sets" ADD FOREIGN KEY ("as_of_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_activation_sets" ADD FOREIGN KEY ("comparison_current_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_activation_sets" ADD FOREIGN KEY ("comparison_history_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_activation_sets" ADD FOREIGN KEY ("previous_activation_set_id") REFERENCES "legal_activation_sets"("id") ON DELETE restrict;

ALTER TABLE "legal_active_activation_sets" ADD FOREIGN KEY ("activation_set_id") REFERENCES "legal_activation_sets"("id") ON DELETE restrict;

ALTER TABLE "legal_activation_events" ADD FOREIGN KEY ("activation_set_id") REFERENCES "legal_activation_sets"("id") ON DELETE restrict;

ALTER TABLE "legal_activation_events" ADD FOREIGN KEY ("prior_activation_set_id") REFERENCES "legal_activation_sets"("id") ON DELETE restrict;

ALTER TABLE "legal_text_revision_validity" ADD FOREIGN KEY ("text_revision_id") REFERENCES "legal_text_revisions"("id") ON DELETE restrict;

ALTER TABLE "legal_applicability_periods" ADD FOREIGN KEY ("provision_rendition_id") REFERENCES "legal_provision_renditions"("id") ON DELETE restrict;

ALTER TABLE "legal_temporal_coverage_gaps" ADD FOREIGN KEY ("provision_rendition_id") REFERENCES "legal_provision_renditions"("id") ON DELETE restrict;

ALTER TABLE "legal_current_provision_pointers" ADD FOREIGN KEY ("provision_rendition_id") REFERENCES "legal_provision_renditions"("id") ON DELETE restrict;

ALTER TABLE "legal_provision_lineage_edges" ADD FOREIGN KEY ("predecessor_concept_id") REFERENCES "legal_provision_concepts"("id") ON DELETE restrict;

ALTER TABLE "legal_provision_lineage_edges" ADD FOREIGN KEY ("successor_concept_id") REFERENCES "legal_provision_concepts"("id") ON DELETE restrict;

ALTER TABLE "legal_official_expression_equivalences" ADD FOREIGN KEY ("left_expression_id") REFERENCES "legal_official_expressions"("id") ON DELETE restrict;

ALTER TABLE "legal_official_expression_equivalences" ADD FOREIGN KEY ("right_expression_id") REFERENCES "legal_official_expressions"("id") ON DELETE restrict;

ALTER TABLE "legal_source_aliases" ADD FOREIGN KEY ("legal_instrument_id") REFERENCES "legal_instruments"("id") ON DELETE restrict;

ALTER TABLE "legal_search_release_governance" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_search_release_governance" ADD FOREIGN KEY ("reconciliation_run_id") REFERENCES "legal_migration_reconciliation_reports"("run_id") ON DELETE restrict;

ALTER TABLE "legal_search_release_shards" ADD FOREIGN KEY ("governance_id") REFERENCES "legal_search_release_governance"("id") ON DELETE restrict;

ALTER TABLE "legal_search_release_shards" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_search_release_evaluation_strata" ADD FOREIGN KEY ("governance_id") REFERENCES "legal_search_release_governance"("id") ON DELETE restrict;

ALTER TABLE "legal_search_release_evaluation_strata" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_source_documents" ADD FOREIGN KEY ("legacy_instrument_id") REFERENCES "legal_instruments"("id") ON DELETE restrict;

ALTER TABLE "legal_source_documents" ADD FOREIGN KEY ("legacy_expression_id") REFERENCES "legal_official_expressions"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshots" ADD FOREIGN KEY ("source_document_id") REFERENCES "legal_source_documents"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshots" ADD FOREIGN KEY ("raw_locator_id") REFERENCES "legal_evidence_locators"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshots" ADD FOREIGN KEY ("normalized_locator_id") REFERENCES "legal_evidence_locators"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshots" ADD FOREIGN KEY ("legacy_text_revision_id") REFERENCES "legal_text_revisions"("id") ON DELETE restrict;

ALTER TABLE "legal_snapshot_provisions" ADD FOREIGN KEY ("source_snapshot_id") REFERENCES "legal_source_snapshots"("id") ON DELETE restrict;

ALTER TABLE "legal_snapshot_provisions" ADD FOREIGN KEY ("provision_locator_id") REFERENCES "legal_evidence_locators"("id") ON DELETE restrict;

ALTER TABLE "legal_snapshot_provisions" ADD FOREIGN KEY ("legacy_provision_rendition_id") REFERENCES "legal_provision_renditions"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_current_pointers" ADD FOREIGN KEY ("source_document_id") REFERENCES "legal_source_documents"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_current_pointers" ADD FOREIGN KEY ("source_snapshot_id") REFERENCES "legal_source_snapshots"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_current_pointers" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_retrieval_eligibility" ADD FOREIGN KEY ("snapshot_provision_id") REFERENCES "legal_snapshot_provisions"("id") ON DELETE restrict;

ALTER TABLE "legal_retrieval_eligibility" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_quarantines" ADD FOREIGN KEY ("source_document_id") REFERENCES "legal_source_documents"("id") ON DELETE restrict;

ALTER TABLE "legal_canonical_chunks" ADD FOREIGN KEY ("snapshot_provision_id") REFERENCES "legal_snapshot_provisions"("id") ON DELETE restrict;

ALTER TABLE "legal_sparse_projection_postings" ADD FOREIGN KEY ("canonical_chunk_id") REFERENCES "legal_canonical_chunks"("id") ON DELETE restrict;

ALTER TABLE "legal_dense_projection_candidates" ADD FOREIGN KEY ("canonical_chunk_id") REFERENCES "legal_canonical_chunks"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_release_members" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_release_members" ADD FOREIGN KEY ("canonical_chunk_id") REFERENCES "legal_canonical_chunks"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_release_members" ADD FOREIGN KEY ("snapshot_provision_id") REFERENCES "legal_snapshot_provisions"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_build_checkpoints" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_inventories" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_deferred_inventories" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_integrity_attestations" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_integrity_attestations" ADD FOREIGN KEY ("snapshot_provision_id") REFERENCES "legal_snapshot_provisions"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_replay_pages" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_replay_runs" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_qualifications" ADD FOREIGN KEY ("build_id") REFERENCES "legal_source_snapshot_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_source_snapshot_qualifications" ADD FOREIGN KEY ("release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_ai_search_projection_builds" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_ai_search_projection_items" ADD FOREIGN KEY ("build_id") REFERENCES "legal_ai_search_projection_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_ai_search_projection_items" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_ai_search_projection_checkpoints" ADD FOREIGN KEY ("build_id") REFERENCES "legal_ai_search_projection_builds"("id") ON DELETE restrict;

ALTER TABLE "legal_search_release_provider_instances" ADD FOREIGN KEY ("governance_id","shard_id")
    REFERENCES "legal_search_release_shards"("governance_id","shard_id") ON DELETE restrict;

ALTER TABLE "legal_search_release_provider_instances" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_search_candidate_qualifications" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_search_candidate_qualifications" ADD FOREIGN KEY ("reconciliation_run_id")
    REFERENCES "legal_migration_reconciliation_reports"("run_id") ON DELETE restrict;

ALTER TABLE "legal_custom_search_release_components" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_objects" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_records" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_aliases" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_lineage_refs" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_quarantines" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_quarantine_attempts" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_interruptions" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_pages" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_attempt_pages" ADD FOREIGN KEY ("run_id","page_sha256") REFERENCES "legal_complete_corpus_pages"("run_id","page_sha256") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_manifests" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_lane_reports" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_control_attempts" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_qualifications" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_complete_corpus_snapshots" ADD FOREIGN KEY ("run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_custom_search_runtime_components" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_custom_search_runtime_components" ADD FOREIGN KEY ("complete_corpus_run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_custom_search_runtime_items" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_custom_query_reservations" ADD FOREIGN KEY ("environment","period")
    REFERENCES "legal_custom_query_budget_periods"("environment","period") ON DELETE restrict;

ALTER TABLE "legal_custom_search_title_inventories" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_custom_search_trusted_titles" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_historical_metadata_acceptances" ADD FOREIGN KEY ("complete_corpus_run_id") REFERENCES "legal_complete_corpus_runs"("id") ON DELETE restrict;

ALTER TABLE "legal_historical_metadata_acceptances" ADD FOREIGN KEY ("active_activation_set_id") REFERENCES "legal_activation_sets"("id") ON DELETE restrict;

ALTER TABLE "legal_historical_metadata_acceptances" ADD FOREIGN KEY ("active_current_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_custom_search_r2_runtime_roots" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_custom_search_membership_lookups" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_custom_search_reference_lookups" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

ALTER TABLE "legal_candidate_membership_projections" ADD FOREIGN KEY ("search_release_id") REFERENCES "legal_search_releases"("id") ON DELETE restrict;

CREATE UNIQUE INDEX "legal_official_eligibility_subject_uidx"
ON "legal_official_eligibility" ("subject_type","subject_id","capability");

CREATE INDEX "legal_text_revision_authority_idx"
ON "legal_text_revisions" ("textual_authority","official_expression_id");

CREATE UNIQUE INDEX "legal_official_expression_natural_uidx"
ON "legal_official_expressions"
  ("legal_instrument_id","language_tag","script","textual_authority");

CREATE INDEX "legal_applicability_period_lookup_idx"
ON "legal_applicability_periods" ("provision_rendition_id","valid_from","valid_to");

CREATE INDEX "legal_temporal_coverage_gap_lookup_idx"
ON "legal_temporal_coverage_gaps" ("provision_rendition_id","status","valid_from","valid_to");

CREATE INDEX "legal_provision_lineage_predecessor_idx"
ON "legal_provision_lineage_edges" ("predecessor_concept_id","review_state");

CREATE INDEX "legal_provision_lineage_successor_idx"
ON "legal_provision_lineage_edges" ("successor_concept_id","review_state");

CREATE INDEX "legal_release_observation_window_idx"
ON "legal_release_observations" ("release_id","phase","observed_at");

CREATE INDEX "legal_search_releases_sealed_reconciliation_idx"
ON "legal_search_releases" ("sealed_reconciliation_run_id");

CREATE INDEX "legal_source_snapshot_provision_lookup_idx"
ON "legal_snapshot_provisions" ("source_snapshot_id","sequence");

CREATE INDEX "legal_retrieval_eligibility_lookup_idx"
ON "legal_retrieval_eligibility" ("capability","status","snapshot_provision_id");

CREATE INDEX "legal_source_snapshot_release_shard_idx"
ON "legal_source_snapshot_release_members" ("search_release_id","shard_id","canonical_chunk_id");

CREATE INDEX "legal_retrieval_eligibility_build_lookup_idx"
ON "legal_retrieval_eligibility" ("build_id","capability","status","snapshot_provision_id");

CREATE INDEX "legal_source_snapshot_release_provision_idx"
ON "legal_source_snapshot_release_members" ("search_release_id","snapshot_provision_id","canonical_chunk_id");

CREATE INDEX "legal_ai_search_projection_release_item_idx"
ON "legal_ai_search_projection_items" ("search_release_id","item_key");

CREATE INDEX "legal_search_release_provider_instance_lookup_idx"
ON "legal_search_release_provider_instances" ("provider_namespace","provider_instance_id");

CREATE INDEX "legal_search_candidate_qualification_release_idx"
ON "legal_search_candidate_qualifications"
  ("search_release_id","environment","capability","recorded_at");

CREATE INDEX "legal_search_release_item_provision_idx"
ON "legal_search_release_items" ("search_release_id","provision_rendition_id");

CREATE INDEX "legal_evidence_locator_kind_sha_idx"
ON "legal_evidence_locators" ("object_kind","sha256");

CREATE INDEX "legal_custom_search_runtime_items_identity_idx"
ON "legal_custom_search_runtime_items" ("search_release_id","legal_identity_sha256");

CREATE INDEX "legal_source_observation_refresh_due" ON "legal_source_observation_targets" ("refresh_after", "official_url");

-- legal_evidence_locators_no_update
CREATE FUNCTION guard_52a5685b64366383b1e66234() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVIDENCE_LOCATOR_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_evidence_locators_no_update" BEFORE UPDATE ON "legal_evidence_locators"
FOR EACH ROW EXECUTE FUNCTION guard_52a5685b64366383b1e66234();

-- legal_evidence_locators_no_delete
CREATE FUNCTION guard_a887b88a684d9ab629321645() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVIDENCE_LOCATOR_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_evidence_locators_no_delete" BEFORE DELETE ON "legal_evidence_locators"
FOR EACH ROW EXECUTE FUNCTION guard_a887b88a684d9ab629321645();

-- legal_instruments_no_update
CREATE FUNCTION guard_04893fc728aec28caad44781() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_INSTRUMENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_instruments_no_update" BEFORE UPDATE ON "legal_instruments"
FOR EACH ROW EXECUTE FUNCTION guard_04893fc728aec28caad44781();

-- legal_official_expressions_no_update
CREATE FUNCTION guard_e5c4ae85b5e6d8cbe58240dd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_OFFICIAL_EXPRESSION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_official_expressions_no_update" BEFORE UPDATE ON "legal_official_expressions"
FOR EACH ROW EXECUTE FUNCTION guard_e5c4ae85b5e6d8cbe58240dd();

-- legal_text_revisions_no_update
CREATE FUNCTION guard_a26706f0ae187ed64d573762() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_TEXT_REVISION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_text_revisions_no_update" BEFORE UPDATE ON "legal_text_revisions"
FOR EACH ROW EXECUTE FUNCTION guard_a26706f0ae187ed64d573762();

-- legal_provision_concepts_no_update
CREATE FUNCTION guard_dd25592b9c93c1d882449666() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_PROVISION_CONCEPT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_provision_concepts_no_update" BEFORE UPDATE ON "legal_provision_concepts"
FOR EACH ROW EXECUTE FUNCTION guard_dd25592b9c93c1d882449666();

-- legal_provision_renditions_no_update
CREATE FUNCTION guard_4fae528db1da08e9b3704e32() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_PROVISION_RENDITION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_provision_renditions_no_update" BEFORE UPDATE ON "legal_provision_renditions"
FOR EACH ROW EXECUTE FUNCTION guard_4fae528db1da08e9b3704e32();

-- legal_official_eligibility_no_update
CREATE FUNCTION guard_150664363a7592da5b539165() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_OFFICIAL_ELIGIBILITY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_official_eligibility_no_update" BEFORE UPDATE ON "legal_official_eligibility"
FOR EACH ROW EXECUTE FUNCTION guard_150664363a7592da5b539165();

-- legal_active_activation_set_guard
CREATE FUNCTION guard_1389c4adde688d2f3b75c395() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "legal_activation_sets" candidate
  WHERE candidate."id"=NEW."activation_set_id"
    AND candidate."environment"=OLD."environment"
    AND candidate."previous_activation_set_id"=OLD."activation_set_id"
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_ACTIVATION_SET_STALE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_active_activation_set_guard" BEFORE UPDATE ON "legal_active_activation_sets"
FOR EACH ROW EXECUTE FUNCTION guard_1389c4adde688d2f3b75c395();

-- legal_corpus_snapshots_no_update
CREATE FUNCTION guard_07b633844d139729a5214ba1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_snapshots_no_update" BEFORE UPDATE ON "legal_corpus_snapshots"
FOR EACH ROW EXECUTE FUNCTION guard_07b633844d139729a5214ba1();

-- legal_corpus_snapshot_members_no_update
CREATE FUNCTION guard_f584fbbbff6ef9f3b027e68f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_snapshot_members_no_update" BEFORE UPDATE ON "legal_corpus_snapshot_members"
FOR EACH ROW EXECUTE FUNCTION guard_f584fbbbff6ef9f3b027e68f();

-- legal_corpus_snapshot_members_no_delete
CREATE FUNCTION guard_c137abaf50a60262078470e6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_snapshot_members_no_delete" BEFORE DELETE ON "legal_corpus_snapshot_members"
FOR EACH ROW EXECUTE FUNCTION guard_c137abaf50a60262078470e6();

-- legal_search_releases_identity_guard
CREATE FUNCTION guard_7d5dfc90d34f85ea66f3d503() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status"<>'draft' OR NEW."id"<>OLD."id" OR NEW."environment"<>OLD."environment"
  OR NEW."capability"<>OLD."capability" OR NEW."corpus_snapshot_id"<>OLD."corpus_snapshot_id"
  OR NEW."item_count"<>OLD."item_count"
  OR NEW."retrieval_policy_version"<>OLD."retrieval_policy_version"
  OR NEW."configuration_identity"<>OLD."configuration_identity"
  OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SEARCH_RELEASE_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_search_releases_identity_guard" BEFORE UPDATE ON "legal_search_releases"
FOR EACH ROW EXECUTE FUNCTION guard_7d5dfc90d34f85ea66f3d503();

-- legal_search_release_items_no_update
CREATE FUNCTION guard_719a94f218e994a051a368f9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SEARCH_RELEASE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_search_release_items_no_update" BEFORE UPDATE ON "legal_search_release_items"
FOR EACH ROW EXECUTE FUNCTION guard_719a94f218e994a051a368f9();

-- legal_search_release_items_no_delete
CREATE FUNCTION guard_286b5a84871e5e1c5828a1d0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SEARCH_RELEASE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_search_release_items_no_delete" BEFORE DELETE ON "legal_search_release_items"
FOR EACH ROW EXECUTE FUNCTION guard_286b5a84871e5e1c5828a1d0();

-- legal_activation_sets_no_update
CREATE FUNCTION guard_f360399f542db35da911f3ea() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_ACTIVATION_SET_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_activation_sets_no_update" BEFORE UPDATE ON "legal_activation_sets"
FOR EACH ROW EXECUTE FUNCTION guard_f360399f542db35da911f3ea();

-- legal_activation_events_no_update
CREATE FUNCTION guard_74e7af969f78398f4f3ac4ed() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_ACTIVATION_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_activation_events_no_update" BEFORE UPDATE ON "legal_activation_events"
FOR EACH ROW EXECUTE FUNCTION guard_74e7af969f78398f4f3ac4ed();

-- legal_applicability_period_no_overlap
CREATE FUNCTION guard_c5f1ad04c879a93ba7aadaef() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "legal_applicability_periods" existing
  WHERE existing."provision_rendition_id"=NEW."provision_rendition_id"
    AND (existing."valid_to" IS NULL OR NEW."valid_from"<existing."valid_to")
    AND (NEW."valid_to" IS NULL OR existing."valid_from"<NEW."valid_to")
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_APPLICABILITY_PERIOD_OVERLAP', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_applicability_period_no_overlap" BEFORE INSERT ON "legal_applicability_periods"
FOR EACH ROW EXECUTE FUNCTION guard_c5f1ad04c879a93ba7aadaef();

-- legal_text_revision_validity_no_update
CREATE FUNCTION guard_afc9b1abb2e8fb1d563ba15d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_TEMPORAL_EVIDENCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_text_revision_validity_no_update" BEFORE UPDATE ON "legal_text_revision_validity"
FOR EACH ROW EXECUTE FUNCTION guard_afc9b1abb2e8fb1d563ba15d();

-- legal_applicability_periods_no_update
CREATE FUNCTION guard_5ae99bfeb51ec18aa76a9e54() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_TEMPORAL_EVIDENCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_applicability_periods_no_update" BEFORE UPDATE ON "legal_applicability_periods"
FOR EACH ROW EXECUTE FUNCTION guard_5ae99bfeb51ec18aa76a9e54();

-- legal_temporal_coverage_gaps_no_update
CREATE FUNCTION guard_70d569cef4cd953d82683c08() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_TEMPORAL_EVIDENCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_temporal_coverage_gaps_no_update" BEFORE UPDATE ON "legal_temporal_coverage_gaps"
FOR EACH ROW EXECUTE FUNCTION guard_70d569cef4cd953d82683c08();

-- legal_current_provision_pointers_no_update
CREATE FUNCTION guard_96c3ef3a5f8e7d6250976cba() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_TEMPORAL_EVIDENCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_current_provision_pointers_no_update" BEFORE UPDATE ON "legal_current_provision_pointers"
FOR EACH ROW EXECUTE FUNCTION guard_96c3ef3a5f8e7d6250976cba();

-- legal_provision_lineage_edges_no_update
CREATE FUNCTION guard_a224f075d55fb6ce109a6358() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_PROVISION_LINEAGE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_provision_lineage_edges_no_update" BEFORE UPDATE ON "legal_provision_lineage_edges"
FOR EACH ROW EXECUTE FUNCTION guard_a224f075d55fb6ce109a6358();

-- legal_official_expression_equivalences_no_update
CREATE FUNCTION guard_021d7f866fe488418edf3424() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EXPRESSION_EQUIVALENCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_official_expression_equivalences_no_update" BEFORE UPDATE ON "legal_official_expression_equivalences"
FOR EACH ROW EXECUTE FUNCTION guard_021d7f866fe488418edf3424();

-- legal_source_aliases_no_update
CREATE FUNCTION guard_09922850736d61e1c171f5f5() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_ALIAS_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_aliases_no_update" BEFORE UPDATE ON "legal_source_aliases"
FOR EACH ROW EXECUTE FUNCTION guard_09922850736d61e1c171f5f5();

-- legal_migration_checkpoints_no_update
CREATE FUNCTION guard_c6419b610be87cda95b09fe3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_MIGRATION_CHECKPOINT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_migration_checkpoints_no_update" BEFORE UPDATE ON "legal_migration_reconciliation_checkpoints"
FOR EACH ROW EXECUTE FUNCTION guard_c6419b610be87cda95b09fe3();

-- legal_duplicate_candidates_no_update
CREATE FUNCTION guard_8808b449d7251c9a7f40f254() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_DUPLICATE_CANDIDATE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_duplicate_candidates_no_update" BEFORE UPDATE ON "legal_duplicate_candidates"
FOR EACH ROW EXECUTE FUNCTION guard_8808b449d7251c9a7f40f254();

-- legal_migration_reports_no_update
CREATE FUNCTION guard_a31d787ebf8c1b1b43739ef8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_MIGRATION_REPORT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_migration_reports_no_update" BEFORE UPDATE ON "legal_migration_reconciliation_reports"
FOR EACH ROW EXECUTE FUNCTION guard_a31d787ebf8c1b1b43739ef8();

-- legal_search_release_governance_no_update
CREATE FUNCTION guard_b8436707efa4730914e031e9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_RELEASE_GOVERNANCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_search_release_governance_no_update" BEFORE UPDATE ON "legal_search_release_governance"
FOR EACH ROW EXECUTE FUNCTION guard_b8436707efa4730914e031e9();

-- legal_search_release_shards_no_update
CREATE FUNCTION guard_739643aedea0842b862b8a94() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_RELEASE_GOVERNANCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_search_release_shards_no_update" BEFORE UPDATE ON "legal_search_release_shards"
FOR EACH ROW EXECUTE FUNCTION guard_739643aedea0842b862b8a94();

-- legal_search_release_evaluation_strata_no_update
CREATE FUNCTION guard_d8cfccb609ff70e19e0c9aeb() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_RELEASE_GOVERNANCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_search_release_evaluation_strata_no_update" BEFORE UPDATE ON "legal_search_release_evaluation_strata"
FOR EACH ROW EXECUTE FUNCTION guard_d8cfccb609ff70e19e0c9aeb();

-- legal_release_observations_no_update
CREATE FUNCTION guard_d7bcb027096fc59437a0aa69() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_RELEASE_OBSERVATION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_release_observations_no_update" BEFORE UPDATE ON "legal_release_observations"
FOR EACH ROW EXECUTE FUNCTION guard_d7bcb027096fc59437a0aa69();

-- legal_target_control_identity_guard
CREATE FUNCTION guard_ce9bc76a0e9ef0b09d649cd4() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."control_key"<>OLD."control_key"
  OR NEW."environment"<>OLD."environment"
  OR NEW."evidence_bucket_name"<>OLD."evidence_bucket_name"
  OR NEW."schema_version"<>OLD."schema_version"
  OR NEW."initialized_at"<>OLD."initialized_at" THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_TARGET_CONTROL_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_target_control_identity_guard" BEFORE UPDATE ON "legal_target_control"
FOR EACH ROW EXECUTE FUNCTION guard_ce9bc76a0e9ef0b09d649cd4();

-- legal_target_control_no_delete
CREATE FUNCTION guard_22aed4afb071fbfc833ac5ba() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_TARGET_CONTROL_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_target_control_no_delete" BEFORE DELETE ON "legal_target_control"
FOR EACH ROW EXECUTE FUNCTION guard_22aed4afb071fbfc833ac5ba();

-- legal_migration_cutoffs_no_update
CREATE FUNCTION guard_a7b2237a1da23939ebce2dd3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_MIGRATION_CUTOFF_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_migration_cutoffs_no_update" BEFORE UPDATE ON "legal_migration_cutoffs"
FOR EACH ROW EXECUTE FUNCTION guard_a7b2237a1da23939ebce2dd3();

-- legal_migration_cutoffs_no_delete
CREATE FUNCTION guard_9c73962843d8c827a6fd765a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_MIGRATION_CUTOFF_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_migration_cutoffs_no_delete" BEFORE DELETE ON "legal_migration_cutoffs"
FOR EACH ROW EXECUTE FUNCTION guard_9c73962843d8c827a6fd765a();

-- legal_source_documents_no_update
CREATE FUNCTION guard_4124bd69885001c660452203() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_DOCUMENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_documents_no_update" BEFORE UPDATE ON "legal_source_documents"
FOR EACH ROW EXECUTE FUNCTION guard_4124bd69885001c660452203();

-- legal_source_snapshots_no_update
CREATE FUNCTION guard_6c5b36cfb2a3f81799cb2927() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshots_no_update" BEFORE UPDATE ON "legal_source_snapshots"
FOR EACH ROW EXECUTE FUNCTION guard_6c5b36cfb2a3f81799cb2927();

-- legal_snapshot_provisions_no_update
CREATE FUNCTION guard_bd228ac11c520ace6a99927e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SNAPSHOT_PROVISION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_snapshot_provisions_no_update" BEFORE UPDATE ON "legal_snapshot_provisions"
FOR EACH ROW EXECUTE FUNCTION guard_bd228ac11c520ace6a99927e();

-- legal_source_snapshot_current_pointers_no_update
CREATE FUNCTION guard_50f37d23b58024d332e4d1dc() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_POINTER_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_current_pointers_no_update" BEFORE UPDATE ON "legal_source_snapshot_current_pointers"
FOR EACH ROW EXECUTE FUNCTION guard_50f37d23b58024d332e4d1dc();

-- legal_retrieval_eligibility_no_update
CREATE FUNCTION guard_20b32a4124e088b55753a3ab() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_RETRIEVAL_ELIGIBILITY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_retrieval_eligibility_no_update" BEFORE UPDATE ON "legal_retrieval_eligibility"
FOR EACH ROW EXECUTE FUNCTION guard_20b32a4124e088b55753a3ab();

-- legal_source_snapshot_quarantines_no_update
CREATE FUNCTION guard_4fa86a0ca36ae1d81e588d5f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_QUARANTINE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_quarantines_no_update" BEFORE UPDATE ON "legal_source_snapshot_quarantines"
FOR EACH ROW EXECUTE FUNCTION guard_4fa86a0ca36ae1d81e588d5f();

-- legal_source_snapshot_aliases_no_update
CREATE FUNCTION guard_acb407ffe61c3d2190eb3555() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_ALIAS_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_aliases_no_update" BEFORE UPDATE ON "legal_source_snapshot_aliases"
FOR EACH ROW EXECUTE FUNCTION guard_acb407ffe61c3d2190eb3555();

-- legal_canonical_chunks_no_update
CREATE FUNCTION guard_a59458ff3abd2c9c8d3dd180() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CANONICAL_CHUNK_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_canonical_chunks_no_update" BEFORE UPDATE ON "legal_canonical_chunks"
FOR EACH ROW EXECUTE FUNCTION guard_a59458ff3abd2c9c8d3dd180();

-- legal_sparse_projection_postings_no_update
CREATE FUNCTION guard_250035b47cd718902d61cabf() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SPARSE_PROJECTION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_sparse_projection_postings_no_update" BEFORE UPDATE ON "legal_sparse_projection_postings"
FOR EACH ROW EXECUTE FUNCTION guard_250035b47cd718902d61cabf();

-- legal_dense_projection_candidates_no_update
CREATE FUNCTION guard_5dc90d0dbeb85c1960754e94() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_DENSE_PROJECTION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_dense_projection_candidates_no_update" BEFORE UPDATE ON "legal_dense_projection_candidates"
FOR EACH ROW EXECUTE FUNCTION guard_5dc90d0dbeb85c1960754e94();

-- legal_source_snapshot_release_members_no_update
CREATE FUNCTION guard_ecf4f4081f99f9741a0e89b6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_RELEASE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_release_members_no_update" BEFORE UPDATE ON "legal_source_snapshot_release_members"
FOR EACH ROW EXECUTE FUNCTION guard_ecf4f4081f99f9741a0e89b6();

-- legal_source_snapshot_build_checkpoints_no_update
CREATE FUNCTION guard_b2604d94d4be8355d252ecd9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_CHECKPOINT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_build_checkpoints_no_update" BEFORE UPDATE ON "legal_source_snapshot_build_checkpoints"
FOR EACH ROW EXECUTE FUNCTION guard_b2604d94d4be8355d252ecd9();

-- legal_source_snapshot_inventories_no_update
CREATE FUNCTION guard_f664facb4634feb121f2102d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_INVENTORY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_inventories_no_update" BEFORE UPDATE ON "legal_source_snapshot_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_f664facb4634feb121f2102d();

-- legal_source_documents_no_delete
CREATE FUNCTION guard_0be8bb567b5baf387109b1af() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_DOCUMENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_documents_no_delete" BEFORE DELETE ON "legal_source_documents"
FOR EACH ROW EXECUTE FUNCTION guard_0be8bb567b5baf387109b1af();

-- legal_source_snapshots_no_delete
CREATE FUNCTION guard_aed4c43daaa2d0c3451f8164() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshots_no_delete" BEFORE DELETE ON "legal_source_snapshots"
FOR EACH ROW EXECUTE FUNCTION guard_aed4c43daaa2d0c3451f8164();

-- legal_snapshot_provisions_no_delete
CREATE FUNCTION guard_f34e92433dc9ca2d82a12329() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SNAPSHOT_PROVISION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_snapshot_provisions_no_delete" BEFORE DELETE ON "legal_snapshot_provisions"
FOR EACH ROW EXECUTE FUNCTION guard_f34e92433dc9ca2d82a12329();

-- legal_source_snapshot_current_pointers_no_delete
CREATE FUNCTION guard_11b3a1c297db28244cb1f2d2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_POINTER_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_current_pointers_no_delete" BEFORE DELETE ON "legal_source_snapshot_current_pointers"
FOR EACH ROW EXECUTE FUNCTION guard_11b3a1c297db28244cb1f2d2();

-- legal_retrieval_eligibility_no_delete
CREATE FUNCTION guard_d1bd2c2868b970064b6ce145() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_RETRIEVAL_ELIGIBILITY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_retrieval_eligibility_no_delete" BEFORE DELETE ON "legal_retrieval_eligibility"
FOR EACH ROW EXECUTE FUNCTION guard_d1bd2c2868b970064b6ce145();

-- legal_source_snapshot_quarantines_no_delete
CREATE FUNCTION guard_7d102e698261a3e132d247d5() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_QUARANTINE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_quarantines_no_delete" BEFORE DELETE ON "legal_source_snapshot_quarantines"
FOR EACH ROW EXECUTE FUNCTION guard_7d102e698261a3e132d247d5();

-- legal_source_snapshot_aliases_no_delete
CREATE FUNCTION guard_458cd000b96b36c30528753a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_ALIAS_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_aliases_no_delete" BEFORE DELETE ON "legal_source_snapshot_aliases"
FOR EACH ROW EXECUTE FUNCTION guard_458cd000b96b36c30528753a();

-- legal_canonical_chunks_no_delete
CREATE FUNCTION guard_1cc2a14c53d09d7828142840() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CANONICAL_CHUNK_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_canonical_chunks_no_delete" BEFORE DELETE ON "legal_canonical_chunks"
FOR EACH ROW EXECUTE FUNCTION guard_1cc2a14c53d09d7828142840();

-- legal_sparse_projection_postings_no_delete
CREATE FUNCTION guard_73750fe4ecc487b64b33dacf() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SPARSE_PROJECTION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_sparse_projection_postings_no_delete" BEFORE DELETE ON "legal_sparse_projection_postings"
FOR EACH ROW EXECUTE FUNCTION guard_73750fe4ecc487b64b33dacf();

-- legal_dense_projection_candidates_no_delete
CREATE FUNCTION guard_0c52adda2f9f0992485f0461() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_DENSE_PROJECTION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_dense_projection_candidates_no_delete" BEFORE DELETE ON "legal_dense_projection_candidates"
FOR EACH ROW EXECUTE FUNCTION guard_0c52adda2f9f0992485f0461();

-- legal_source_snapshot_release_members_no_delete
CREATE FUNCTION guard_61e1eef2dbc71b1297e86f0a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_RELEASE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_release_members_no_delete" BEFORE DELETE ON "legal_source_snapshot_release_members"
FOR EACH ROW EXECUTE FUNCTION guard_61e1eef2dbc71b1297e86f0a();

-- legal_source_snapshot_build_checkpoints_no_delete
CREATE FUNCTION guard_7db457cdfed8ebde1e7316ad() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_CHECKPOINT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_build_checkpoints_no_delete" BEFORE DELETE ON "legal_source_snapshot_build_checkpoints"
FOR EACH ROW EXECUTE FUNCTION guard_7db457cdfed8ebde1e7316ad();

-- legal_source_snapshot_inventories_no_delete
CREATE FUNCTION guard_13f6bba2345d050912bd9566() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_INVENTORY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_inventories_no_delete" BEFORE DELETE ON "legal_source_snapshot_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_13f6bba2345d050912bd9566();

-- legal_source_snapshot_deferred_inventories_no_delete
CREATE FUNCTION guard_9460dafa67b57dafb7e8b99e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_DEFERRED_INVENTORY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_deferred_inventories_no_delete" BEFORE DELETE ON "legal_source_snapshot_deferred_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_9460dafa67b57dafb7e8b99e();

-- legal_source_snapshot_stable_identities_no_update
CREATE FUNCTION guard_b1a27cede8fd8f2096659258() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_STABLE_IDENTITY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_stable_identities_no_update" BEFORE UPDATE ON "legal_source_snapshot_stable_identities"
FOR EACH ROW EXECUTE FUNCTION guard_b1a27cede8fd8f2096659258();

-- legal_source_snapshot_stable_identities_no_delete
CREATE FUNCTION guard_dd3a4db853888216e4d0d5db() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_STABLE_IDENTITY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_stable_identities_no_delete" BEFORE DELETE ON "legal_source_snapshot_stable_identities"
FOR EACH ROW EXECUTE FUNCTION guard_dd3a4db853888216e4d0d5db();

-- legal_source_snapshot_integrity_attestations_no_update
CREATE FUNCTION guard_d480d217ef89e2cf891b1a57() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_INTEGRITY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_integrity_attestations_no_update" BEFORE UPDATE ON "legal_source_snapshot_integrity_attestations"
FOR EACH ROW EXECUTE FUNCTION guard_d480d217ef89e2cf891b1a57();

-- legal_source_snapshot_integrity_attestations_no_delete
CREATE FUNCTION guard_a04d043916c493b188c57592() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_INTEGRITY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_integrity_attestations_no_delete" BEFORE DELETE ON "legal_source_snapshot_integrity_attestations"
FOR EACH ROW EXECUTE FUNCTION guard_a04d043916c493b188c57592();

-- legal_source_snapshot_replay_pages_no_update
CREATE FUNCTION guard_e661c6bb89bce2d20d76403a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_REPLAY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_replay_pages_no_update" BEFORE UPDATE ON "legal_source_snapshot_replay_pages"
FOR EACH ROW EXECUTE FUNCTION guard_e661c6bb89bce2d20d76403a();

-- legal_source_snapshot_replay_pages_no_delete
CREATE FUNCTION guard_457f13d376602e302d4715d5() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_REPLAY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_replay_pages_no_delete" BEFORE DELETE ON "legal_source_snapshot_replay_pages"
FOR EACH ROW EXECUTE FUNCTION guard_457f13d376602e302d4715d5();

-- legal_source_snapshot_replay_runs_no_update
CREATE FUNCTION guard_49524927ba9411663b1a4664() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_REPLAY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_replay_runs_no_update" BEFORE UPDATE ON "legal_source_snapshot_replay_runs"
FOR EACH ROW EXECUTE FUNCTION guard_49524927ba9411663b1a4664();

-- legal_source_snapshot_replay_runs_no_delete
CREATE FUNCTION guard_00451eadbfa58a1b03976712() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_REPLAY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_replay_runs_no_delete" BEFORE DELETE ON "legal_source_snapshot_replay_runs"
FOR EACH ROW EXECUTE FUNCTION guard_00451eadbfa58a1b03976712();

-- legal_source_snapshot_qualifications_no_update
CREATE FUNCTION guard_b3513d10a3f9b9a9e56671ce() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_QUALIFICATION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_qualifications_no_update" BEFORE UPDATE ON "legal_source_snapshot_qualifications"
FOR EACH ROW EXECUTE FUNCTION guard_b3513d10a3f9b9a9e56671ce();

-- legal_source_snapshot_qualifications_no_delete
CREATE FUNCTION guard_773f1400f3047ec5c37a0ccc() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_QUALIFICATION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_qualifications_no_delete" BEFORE DELETE ON "legal_source_snapshot_qualifications"
FOR EACH ROW EXECUTE FUNCTION guard_773f1400f3047ec5c37a0ccc();

-- legal_source_snapshot_deferred_inventories_validate_insert
CREATE FUNCTION guard_0ac78da33117fbc1e7adb9aa() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."item_count" < 0
  OR length(NEW."inventory_sha256") <> 64
  OR NEW."inventory_sha256" ~ '^.*[^0-9a-f].*$' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_DEFERRED_INVENTORY_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_deferred_inventories_validate_insert" BEFORE INSERT ON "legal_source_snapshot_deferred_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_0ac78da33117fbc1e7adb9aa();

-- legal_source_snapshot_deferred_inventories_no_update
CREATE FUNCTION guard_df8b5ed111679ebc70fd7ca7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_SNAPSHOT_DEFERRED_INVENTORY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_snapshot_deferred_inventories_no_update" BEFORE UPDATE ON "legal_source_snapshot_deferred_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_df8b5ed111679ebc70fd7ca7();

-- legal_ai_search_projection_items_no_update
CREATE FUNCTION guard_725f2f499899f50280e06806() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_AI_SEARCH_PROJECTION_ITEM_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_ai_search_projection_items_no_update" BEFORE UPDATE ON "legal_ai_search_projection_items"
FOR EACH ROW EXECUTE FUNCTION guard_725f2f499899f50280e06806();

-- legal_ai_search_projection_items_no_delete
CREATE FUNCTION guard_e608f3170069b9e8496cd2ee() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_AI_SEARCH_PROJECTION_ITEM_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_ai_search_projection_items_no_delete" BEFORE DELETE ON "legal_ai_search_projection_items"
FOR EACH ROW EXECUTE FUNCTION guard_e608f3170069b9e8496cd2ee();

-- legal_search_release_provider_instances_no_update
CREATE FUNCTION guard_f4bd383c1438c625065079dd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_RELEASE_GOVERNANCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_search_release_provider_instances_no_update" BEFORE UPDATE ON "legal_search_release_provider_instances"
FOR EACH ROW EXECUTE FUNCTION guard_f4bd383c1438c625065079dd();

-- legal_search_candidate_qualifications_no_update
CREATE FUNCTION guard_8535424d5a8de964cfc3a7ba() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CANDIDATE_QUALIFICATION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_search_candidate_qualifications_no_update" BEFORE UPDATE ON "legal_search_candidate_qualifications"
FOR EACH ROW EXECUTE FUNCTION guard_8535424d5a8de964cfc3a7ba();

-- legal_search_candidate_qualifications_no_delete
CREATE FUNCTION guard_de1f75208305c1e51a11789c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CANDIDATE_QUALIFICATION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_search_candidate_qualifications_no_delete" BEFORE DELETE ON "legal_search_candidate_qualifications"
FOR EACH ROW EXECUTE FUNCTION guard_de1f75208305c1e51a11789c();

-- legal_custom_search_release_components_no_update
CREATE FUNCTION guard_827121555de77ebec7812aee() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_RELEASE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_release_components_no_update" BEFORE UPDATE ON "legal_custom_search_release_components"
FOR EACH ROW EXECUTE FUNCTION guard_827121555de77ebec7812aee();

-- legal_custom_search_release_components_no_delete
CREATE FUNCTION guard_6386c0b840f28e5d9b206849() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_RELEASE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_release_components_no_delete" BEFORE DELETE ON "legal_custom_search_release_components"
FOR EACH ROW EXECUTE FUNCTION guard_6386c0b840f28e5d9b206849();

-- legal_complete_corpus_snapshots_building_insert
CREATE FUNCTION guard_a15d53e2f4c47d607dcb9994() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_snapshots_building_insert" BEFORE INSERT ON "legal_complete_corpus_snapshots"
FOR EACH ROW EXECUTE FUNCTION guard_a15d53e2f4c47d607dcb9994();

-- legal_complete_corpus_snapshots_no_update
CREATE FUNCTION guard_d237e18ce02b936d9a9aafaf() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_snapshots_no_update" BEFORE UPDATE ON "legal_complete_corpus_snapshots"
FOR EACH ROW EXECUTE FUNCTION guard_d237e18ce02b936d9a9aafaf();

-- legal_complete_corpus_snapshots_no_delete
CREATE FUNCTION guard_280d7ef3b6ac01fc53af6951() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_snapshots_no_delete" BEFORE DELETE ON "legal_complete_corpus_snapshots"
FOR EACH ROW EXECUTE FUNCTION guard_280d7ef3b6ac01fc53af6951();

-- legal_complete_corpus_qualifications_materialized_insert
CREATE FUNCTION guard_ccf2cffb421bb8e8434ae76b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'materialized' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_QUALIFICATION_REQUIRES_MATERIALIZED_RUN', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_qualifications_materialized_insert" BEFORE INSERT ON "legal_complete_corpus_qualifications"
FOR EACH ROW EXECUTE FUNCTION guard_ccf2cffb421bb8e8434ae76b();

-- legal_complete_corpus_qualifications_no_update
CREATE FUNCTION guard_e12a37c929cb8e12639b8e9f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_QUALIFICATION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_qualifications_no_update" BEFORE UPDATE ON "legal_complete_corpus_qualifications"
FOR EACH ROW EXECUTE FUNCTION guard_e12a37c929cb8e12639b8e9f();

-- legal_complete_corpus_qualifications_no_delete
CREATE FUNCTION guard_88f0da620b0edfc3f65c5347() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_QUALIFICATION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_qualifications_no_delete" BEFORE DELETE ON "legal_complete_corpus_qualifications"
FOR EACH ROW EXECUTE FUNCTION guard_88f0da620b0edfc3f65c5347();

-- legal_complete_corpus_records_no_update
CREATE FUNCTION guard_161147d230f7cf71105b7bed() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RECORD_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_records_no_update" BEFORE UPDATE ON "legal_complete_corpus_records"
FOR EACH ROW EXECUTE FUNCTION guard_161147d230f7cf71105b7bed();

-- legal_complete_corpus_records_no_delete
CREATE FUNCTION guard_fdcb85a15516f1db49049795() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RECORD_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_records_no_delete" BEFORE DELETE ON "legal_complete_corpus_records"
FOR EACH ROW EXECUTE FUNCTION guard_fdcb85a15516f1db49049795();

-- legal_complete_corpus_runs_no_delete
CREATE FUNCTION guard_078e6f4dd748bafd74f7bf15() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_runs_no_delete" BEFORE DELETE ON "legal_complete_corpus_runs"
FOR EACH ROW EXECUTE FUNCTION guard_078e6f4dd748bafd74f7bf15();

-- legal_complete_corpus_aliases_no_update
CREATE FUNCTION guard_a3993fa9022df55246a68bde() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_ALIAS_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_aliases_no_update" BEFORE UPDATE ON "legal_complete_corpus_aliases"
FOR EACH ROW EXECUTE FUNCTION guard_a3993fa9022df55246a68bde();

-- legal_complete_corpus_aliases_no_delete
CREATE FUNCTION guard_223fc537e881cb912c707227() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_ALIAS_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_aliases_no_delete" BEFORE DELETE ON "legal_complete_corpus_aliases"
FOR EACH ROW EXECUTE FUNCTION guard_223fc537e881cb912c707227();

-- legal_complete_corpus_lineage_refs_no_update
CREATE FUNCTION guard_e0d343c103eb591ad3ab9e12() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_LINEAGE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_lineage_refs_no_update" BEFORE UPDATE ON "legal_complete_corpus_lineage_refs"
FOR EACH ROW EXECUTE FUNCTION guard_e0d343c103eb591ad3ab9e12();

-- legal_complete_corpus_lineage_refs_no_delete
CREATE FUNCTION guard_b4a4ddcf911926091342bd9f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_LINEAGE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_lineage_refs_no_delete" BEFORE DELETE ON "legal_complete_corpus_lineage_refs"
FOR EACH ROW EXECUTE FUNCTION guard_b4a4ddcf911926091342bd9f();

-- legal_complete_corpus_quarantines_no_update
CREATE FUNCTION guard_d84e1aaa3b54cadec3a8b032() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_QUARANTINE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_quarantines_no_update" BEFORE UPDATE ON "legal_complete_corpus_quarantines"
FOR EACH ROW EXECUTE FUNCTION guard_d84e1aaa3b54cadec3a8b032();

-- legal_complete_corpus_quarantines_no_delete
CREATE FUNCTION guard_07e6dbd95a873e20bca89a58() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_QUARANTINE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_quarantines_no_delete" BEFORE DELETE ON "legal_complete_corpus_quarantines"
FOR EACH ROW EXECUTE FUNCTION guard_07e6dbd95a873e20bca89a58();

-- legal_complete_corpus_quarantine_attempts_no_update
CREATE FUNCTION guard_92facbc076796467a82a9ca3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_QUARANTINE_ATTEMPT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_quarantine_attempts_no_update" BEFORE UPDATE ON "legal_complete_corpus_quarantine_attempts"
FOR EACH ROW EXECUTE FUNCTION guard_92facbc076796467a82a9ca3();

-- legal_complete_corpus_quarantine_attempts_no_delete
CREATE FUNCTION guard_77fd1fcbb41a958552d3e867() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_QUARANTINE_ATTEMPT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_quarantine_attempts_no_delete" BEFORE DELETE ON "legal_complete_corpus_quarantine_attempts"
FOR EACH ROW EXECUTE FUNCTION guard_77fd1fcbb41a958552d3e867();

-- legal_complete_corpus_objects_no_update
CREATE FUNCTION guard_bda843ecb5db748c769820fe() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_OBJECT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_objects_no_update" BEFORE UPDATE ON "legal_complete_corpus_objects"
FOR EACH ROW EXECUTE FUNCTION guard_bda843ecb5db748c769820fe();

-- legal_complete_corpus_objects_no_delete
CREATE FUNCTION guard_e05b6a13ad1e0fcad3979609() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_OBJECT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_objects_no_delete" BEFORE DELETE ON "legal_complete_corpus_objects"
FOR EACH ROW EXECUTE FUNCTION guard_e05b6a13ad1e0fcad3979609();

-- legal_complete_corpus_pages_no_update
CREATE FUNCTION guard_0a0f00bbb0a71ca232a268af() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_PAGE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_pages_no_update" BEFORE UPDATE ON "legal_complete_corpus_pages"
FOR EACH ROW EXECUTE FUNCTION guard_0a0f00bbb0a71ca232a268af();

-- legal_complete_corpus_pages_no_delete
CREATE FUNCTION guard_5008673a6b4859c6d94c0d7a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_PAGE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_pages_no_delete" BEFORE DELETE ON "legal_complete_corpus_pages"
FOR EACH ROW EXECUTE FUNCTION guard_5008673a6b4859c6d94c0d7a();

-- legal_complete_corpus_attempt_pages_no_update
CREATE FUNCTION guard_675192b83b5121d9e23c1aeb() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_ATTEMPT_PAGE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_attempt_pages_no_update" BEFORE UPDATE ON "legal_complete_corpus_attempt_pages"
FOR EACH ROW EXECUTE FUNCTION guard_675192b83b5121d9e23c1aeb();

-- legal_complete_corpus_attempt_pages_no_delete
CREATE FUNCTION guard_900ba370c406c4bdb351b386() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_ATTEMPT_PAGE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_attempt_pages_no_delete" BEFORE DELETE ON "legal_complete_corpus_attempt_pages"
FOR EACH ROW EXECUTE FUNCTION guard_900ba370c406c4bdb351b386();

-- legal_complete_corpus_interruptions_no_update
CREATE FUNCTION guard_912cb0fcbb224c9d9dd419ee() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_INTERRUPTION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_interruptions_no_update" BEFORE UPDATE ON "legal_complete_corpus_interruptions"
FOR EACH ROW EXECUTE FUNCTION guard_912cb0fcbb224c9d9dd419ee();

-- legal_complete_corpus_interruptions_no_delete
CREATE FUNCTION guard_b91f3fee9647d9be11ca00b9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_INTERRUPTION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_interruptions_no_delete" BEFORE DELETE ON "legal_complete_corpus_interruptions"
FOR EACH ROW EXECUTE FUNCTION guard_b91f3fee9647d9be11ca00b9();

-- legal_complete_corpus_manifests_no_update
CREATE FUNCTION guard_a1b5dfb206f0b8aa99fe5b27() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_MANIFEST_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_manifests_no_update" BEFORE UPDATE ON "legal_complete_corpus_manifests"
FOR EACH ROW EXECUTE FUNCTION guard_a1b5dfb206f0b8aa99fe5b27();

-- legal_complete_corpus_manifests_no_delete
CREATE FUNCTION guard_e9f9c34c7afda765e331b2aa() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_MANIFEST_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_manifests_no_delete" BEFORE DELETE ON "legal_complete_corpus_manifests"
FOR EACH ROW EXECUTE FUNCTION guard_e9f9c34c7afda765e331b2aa();

-- legal_complete_corpus_lane_reports_no_update
CREATE FUNCTION guard_f70bb9915cbc545d47d61406() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_LANE_REPORT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_lane_reports_no_update" BEFORE UPDATE ON "legal_complete_corpus_lane_reports"
FOR EACH ROW EXECUTE FUNCTION guard_f70bb9915cbc545d47d61406();

-- legal_complete_corpus_lane_reports_no_delete
CREATE FUNCTION guard_70df614c68851dcac7a561d0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_LANE_REPORT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_lane_reports_no_delete" BEFORE DELETE ON "legal_complete_corpus_lane_reports"
FOR EACH ROW EXECUTE FUNCTION guard_70df614c68851dcac7a561d0();

-- legal_complete_corpus_control_attempts_building_insert
CREATE FUNCTION guard_07592309d55fd655cc1887f9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_control_attempts_building_insert" BEFORE INSERT ON "legal_complete_corpus_control_attempts"
FOR EACH ROW EXECUTE FUNCTION guard_07592309d55fd655cc1887f9();

-- legal_complete_corpus_control_attempts_no_update
CREATE FUNCTION guard_4570e88c6ddfcb9ed8071b43() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_CONTROL_ATTEMPT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_control_attempts_no_update" BEFORE UPDATE ON "legal_complete_corpus_control_attempts"
FOR EACH ROW EXECUTE FUNCTION guard_4570e88c6ddfcb9ed8071b43();

-- legal_complete_corpus_control_attempts_no_delete
CREATE FUNCTION guard_e15207fa4d15b64bafe4c92b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_CONTROL_ATTEMPT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_control_attempts_no_delete" BEFORE DELETE ON "legal_complete_corpus_control_attempts"
FOR EACH ROW EXECUTE FUNCTION guard_e15207fa4d15b64bafe4c92b();

-- legal_complete_corpus_runs_forward_status
CREATE FUNCTION guard_dc3e141c731cf473d000f5c1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (OLD."status"='building' AND NEW."status" IN ('building','materialized','failed'))
  OR (OLD."status"='materialized' AND NEW."status" IN ('materialized','complete','failed'))
  OR (OLD."status"='complete' AND NEW."status"='complete')
  OR (OLD."status"='failed' AND NEW."status"='failed')
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_STATUS_REGRESSION', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_runs_forward_status" BEFORE UPDATE OF "status" ON "legal_complete_corpus_runs"
FOR EACH ROW EXECUTE FUNCTION guard_dc3e141c731cf473d000f5c1();

-- legal_complete_corpus_runs_immutable_identity
CREATE FUNCTION guard_3969792c7af592adb054f04a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."id" IS DISTINCT FROM NEW."id"
  OR OLD."schema_version" IS DISTINCT FROM NEW."schema_version"
  OR OLD."source_cutoff" IS DISTINCT FROM NEW."source_cutoff"
  OR OLD."source_bookmark" IS DISTINCT FROM NEW."source_bookmark"
  OR OLD."source_inventory_sha256" IS DISTINCT FROM NEW."source_inventory_sha256"
  OR OLD."source_canonical_sha256" IS DISTINCT FROM NEW."source_canonical_sha256"
  OR OLD."source_alias_sha256" IS DISTINCT FROM NEW."source_alias_sha256"
  OR OLD."source_r2_object_manifest_sha256" IS DISTINCT FROM NEW."source_r2_object_manifest_sha256"
  OR OLD."source_r2_alias_manifest_sha256" IS DISTINCT FROM NEW."source_r2_alias_manifest_sha256"
  OR OLD."source_empty_version_manifest_sha256" IS DISTINCT FROM NEW."source_empty_version_manifest_sha256"
  OR OLD."expected_record_count" IS DISTINCT FROM NEW."expected_record_count"
  OR (OLD."plan_r2_key" IS NOT NULL AND OLD."plan_r2_key" IS DISTINCT FROM NEW."plan_r2_key")
  OR (OLD."plan_sha256" IS NOT NULL AND OLD."plan_sha256" IS DISTINCT FROM NEW."plan_sha256")
  OR (OLD."final_reconstruction_r2_key" IS NOT NULL
    AND OLD."final_reconstruction_r2_key" IS DISTINCT FROM NEW."final_reconstruction_r2_key")
  OR (OLD."final_reconstruction_sha256" IS NOT NULL
    AND OLD."final_reconstruction_sha256" IS DISTINCT FROM NEW."final_reconstruction_sha256")
  OR (OLD."status"='building' AND (NEW."materialized_record_count"<OLD."materialized_record_count"
    OR NEW."materialized_record_count">NEW."expected_record_count"))
  OR (OLD."status"<>'building'
    AND OLD."materialized_record_count" IS DISTINCT FROM NEW."materialized_record_count")
  OR (OLD."completed_at" IS NOT NULL AND OLD."completed_at" IS DISTINCT FROM NEW."completed_at")
  OR OLD."created_at" IS DISTINCT FROM NEW."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_runs_immutable_identity" BEFORE UPDATE ON "legal_complete_corpus_runs"
FOR EACH ROW EXECUTE FUNCTION guard_3969792c7af592adb054f04a();

-- legal_complete_corpus_objects_building_insert
CREATE FUNCTION guard_ff03f0b872ad7b226d835b41() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_objects_building_insert" BEFORE INSERT ON "legal_complete_corpus_objects"
FOR EACH ROW EXECUTE FUNCTION guard_ff03f0b872ad7b226d835b41();

-- legal_complete_corpus_records_building_insert
CREATE FUNCTION guard_923c8ea1d9d0f5e613c26548() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_records_building_insert" BEFORE INSERT ON "legal_complete_corpus_records"
FOR EACH ROW EXECUTE FUNCTION guard_923c8ea1d9d0f5e613c26548();

-- legal_complete_corpus_aliases_building_insert
CREATE FUNCTION guard_052a273a8df44134b8e8e6bf() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_aliases_building_insert" BEFORE INSERT ON "legal_complete_corpus_aliases"
FOR EACH ROW EXECUTE FUNCTION guard_052a273a8df44134b8e8e6bf();

-- legal_complete_corpus_lineage_refs_building_insert
CREATE FUNCTION guard_a481ea7eaa7ead523f3111e3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_lineage_refs_building_insert" BEFORE INSERT ON "legal_complete_corpus_lineage_refs"
FOR EACH ROW EXECUTE FUNCTION guard_a481ea7eaa7ead523f3111e3();

-- legal_complete_corpus_quarantines_building_insert
CREATE FUNCTION guard_7ca63ec321a9541db1879d91() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_quarantines_building_insert" BEFORE INSERT ON "legal_complete_corpus_quarantines"
FOR EACH ROW EXECUTE FUNCTION guard_7ca63ec321a9541db1879d91();

-- legal_complete_corpus_quarantine_attempts_building_insert
CREATE FUNCTION guard_dc5b5878c39ec5d323222d7f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_quarantine_attempts_building_insert" BEFORE INSERT ON "legal_complete_corpus_quarantine_attempts"
FOR EACH ROW EXECUTE FUNCTION guard_dc5b5878c39ec5d323222d7f();

-- legal_complete_corpus_interruptions_building_insert
CREATE FUNCTION guard_156a51b40302a0f5ad4fe9ca() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_interruptions_building_insert" BEFORE INSERT ON "legal_complete_corpus_interruptions"
FOR EACH ROW EXECUTE FUNCTION guard_156a51b40302a0f5ad4fe9ca();

-- legal_complete_corpus_pages_building_insert
CREATE FUNCTION guard_aa8f468a7e5e766400816ceb() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_pages_building_insert" BEFORE INSERT ON "legal_complete_corpus_pages"
FOR EACH ROW EXECUTE FUNCTION guard_aa8f468a7e5e766400816ceb();

-- legal_complete_corpus_attempt_pages_building_insert
CREATE FUNCTION guard_1f8fdd0d9b7595c5f3e45eb1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_attempt_pages_building_insert" BEFORE INSERT ON "legal_complete_corpus_attempt_pages"
FOR EACH ROW EXECUTE FUNCTION guard_1f8fdd0d9b7595c5f3e45eb1();

-- legal_complete_corpus_manifests_building_insert
CREATE FUNCTION guard_f99e2f1f3b766240b21d9a29() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_manifests_building_insert" BEFORE INSERT ON "legal_complete_corpus_manifests"
FOR EACH ROW EXECUTE FUNCTION guard_f99e2f1f3b766240b21d9a29();

-- legal_complete_corpus_lane_reports_building_insert
CREATE FUNCTION guard_ca398bbd08b3b0885b1310e3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (SELECT "status" FROM "legal_complete_corpus_runs" WHERE "id"=NEW."run_id") <> 'building' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_COMPLETE_CORPUS_RUN_SEALED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_complete_corpus_lane_reports_building_insert" BEFORE INSERT ON "legal_complete_corpus_lane_reports"
FOR EACH ROW EXECUTE FUNCTION guard_ca398bbd08b3b0885b1310e3();

-- legal_custom_search_runtime_components_no_update
CREATE FUNCTION guard_3218590ffb3a1df73a3facad() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_RUNTIME_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_runtime_components_no_update" BEFORE UPDATE ON "legal_custom_search_runtime_components"
FOR EACH ROW EXECUTE FUNCTION guard_3218590ffb3a1df73a3facad();

-- legal_custom_search_runtime_components_no_delete
CREATE FUNCTION guard_6d25da4de102f777fd19097b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_RUNTIME_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_runtime_components_no_delete" BEFORE DELETE ON "legal_custom_search_runtime_components"
FOR EACH ROW EXECUTE FUNCTION guard_6d25da4de102f777fd19097b();

-- legal_custom_search_runtime_items_no_update
CREATE FUNCTION guard_301f9702014175792bc2be0a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_RUNTIME_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_runtime_items_no_update" BEFORE UPDATE ON "legal_custom_search_runtime_items"
FOR EACH ROW EXECUTE FUNCTION guard_301f9702014175792bc2be0a();

-- legal_custom_search_runtime_items_no_delete
CREATE FUNCTION guard_86a232eb1563f94af08e7fb4() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_RUNTIME_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_runtime_items_no_delete" BEFORE DELETE ON "legal_custom_search_runtime_items"
FOR EACH ROW EXECUTE FUNCTION guard_86a232eb1563f94af08e7fb4();

-- legal_custom_query_reservations_no_update
CREATE FUNCTION guard_9428695ab274449576fd0093() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_QUERY_RESERVATION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_query_reservations_no_update" BEFORE UPDATE ON "legal_custom_query_reservations"
FOR EACH ROW EXECUTE FUNCTION guard_9428695ab274449576fd0093();

-- legal_custom_query_reservations_no_delete
CREATE FUNCTION guard_0dfbbcfaf11b6f99c94df1b9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_QUERY_RESERVATION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_query_reservations_no_delete" BEFORE DELETE ON "legal_custom_query_reservations"
FOR EACH ROW EXECUTE FUNCTION guard_0dfbbcfaf11b6f99c94df1b9();

-- legal_custom_search_title_inventory_count_guard
CREATE FUNCTION guard_fbe128956f4accdab22c4e74() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."title_count"<>(SELECT count(*) FROM "legal_custom_search_trusted_titles"
  WHERE "search_release_id"=NEW."search_release_id") THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_TITLE_COUNT_MISMATCH', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_title_inventory_count_guard" BEFORE INSERT ON "legal_custom_search_title_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_fbe128956f4accdab22c4e74();

-- legal_custom_search_title_inventory_insert_guard
CREATE FUNCTION guard_370d49f2f764cf45e14a8f35() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "legal_custom_search_title_inventories"
  WHERE "search_release_id"=NEW."search_release_id") THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_TITLES_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_title_inventory_insert_guard" BEFORE INSERT ON "legal_custom_search_title_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_370d49f2f764cf45e14a8f35();

-- legal_custom_search_trusted_titles_insert_guard
CREATE FUNCTION guard_27a5e9c53c80a6c4a3aae873() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "legal_custom_search_title_inventories"
  WHERE "search_release_id"=NEW."search_release_id") THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_TITLES_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_trusted_titles_insert_guard" BEFORE INSERT ON "legal_custom_search_trusted_titles"
FOR EACH ROW EXECUTE FUNCTION guard_27a5e9c53c80a6c4a3aae873();

-- legal_custom_search_title_inventories_no_update
CREATE FUNCTION guard_37effdce1aeb18bcb770d849() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_TITLES_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_title_inventories_no_update" BEFORE UPDATE ON "legal_custom_search_title_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_37effdce1aeb18bcb770d849();

-- legal_custom_search_title_inventories_no_delete
CREATE FUNCTION guard_1597d32b7b0e52c8c6ecfdfc() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_TITLES_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_title_inventories_no_delete" BEFORE DELETE ON "legal_custom_search_title_inventories"
FOR EACH ROW EXECUTE FUNCTION guard_1597d32b7b0e52c8c6ecfdfc();

-- legal_custom_search_trusted_titles_no_update
CREATE FUNCTION guard_5910b0fe267a9268eece64bf() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_TITLES_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_trusted_titles_no_update" BEFORE UPDATE ON "legal_custom_search_trusted_titles"
FOR EACH ROW EXECUTE FUNCTION guard_5910b0fe267a9268eece64bf();

-- legal_custom_search_trusted_titles_no_delete
CREATE FUNCTION guard_6caf3fb4e9e384533bcf6e5d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_TITLES_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_trusted_titles_no_delete" BEFORE DELETE ON "legal_custom_search_trusted_titles"
FOR EACH ROW EXECUTE FUNCTION guard_6caf3fb4e9e384533bcf6e5d();

-- legal_historical_metadata_acceptances_insert_guard
CREATE FUNCTION guard_36a780740c12e013b125404d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "legal_historical_metadata_acceptances"
  WHERE "complete_corpus_run_id"=NEW."complete_corpus_run_id"
    OR "id"=NEW."id" OR "result_r2_key"=NEW."result_r2_key") THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_HISTORICAL_METADATA_ACCEPTANCE_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_historical_metadata_acceptances_insert_guard" BEFORE INSERT ON "legal_historical_metadata_acceptances"
FOR EACH ROW EXECUTE FUNCTION guard_36a780740c12e013b125404d();

-- legal_historical_metadata_acceptances_no_update
CREATE FUNCTION guard_0f03abd14ece653e3aa3672e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_HISTORICAL_METADATA_ACCEPTANCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_historical_metadata_acceptances_no_update" BEFORE UPDATE ON "legal_historical_metadata_acceptances"
FOR EACH ROW EXECUTE FUNCTION guard_0f03abd14ece653e3aa3672e();

-- legal_historical_metadata_acceptances_no_delete
CREATE FUNCTION guard_4fc0d3e373ea54bbca3675ab() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_HISTORICAL_METADATA_ACCEPTANCE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_historical_metadata_acceptances_no_delete" BEFORE DELETE ON "legal_historical_metadata_acceptances"
FOR EACH ROW EXECUTE FUNCTION guard_4fc0d3e373ea54bbca3675ab();

-- legal_custom_search_r2_runtime_roots_no_update
CREATE FUNCTION guard_c4533112e47c4f3ae7c1631e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_R2_RUNTIME_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_r2_runtime_roots_no_update" BEFORE UPDATE ON "legal_custom_search_r2_runtime_roots"
FOR EACH ROW EXECUTE FUNCTION guard_c4533112e47c4f3ae7c1631e();

-- legal_custom_search_r2_runtime_roots_no_delete
CREATE FUNCTION guard_3a5b11595d7c413986700249() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_SEARCH_R2_RUNTIME_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_r2_runtime_roots_no_delete" BEFORE DELETE ON "legal_custom_search_r2_runtime_roots"
FOR EACH ROW EXECUTE FUNCTION guard_3a5b11595d7c413986700249();

-- legal_custom_search_membership_lookups_no_update
CREATE FUNCTION guard_e93fa531edfe53f85344a5f9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_MEMBERSHIP_LOOKUP_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_membership_lookups_no_update" BEFORE UPDATE ON "legal_custom_search_membership_lookups"
FOR EACH ROW EXECUTE FUNCTION guard_e93fa531edfe53f85344a5f9();

-- legal_custom_search_membership_lookups_no_delete
CREATE FUNCTION guard_b7acf5539304c17fba718100() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_MEMBERSHIP_LOOKUP_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_membership_lookups_no_delete" BEFORE DELETE ON "legal_custom_search_membership_lookups"
FOR EACH ROW EXECUTE FUNCTION guard_b7acf5539304c17fba718100();

-- legal_custom_search_reference_lookups_no_update
CREATE FUNCTION guard_41b759e23f6e203cbd6f3269() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_REFERENCE_LOOKUP_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_reference_lookups_no_update" BEFORE UPDATE ON "legal_custom_search_reference_lookups"
FOR EACH ROW EXECUTE FUNCTION guard_41b759e23f6e203cbd6f3269();

-- legal_custom_search_reference_lookups_no_delete
CREATE FUNCTION guard_d7f5c81e22e02b91cbf4fee9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CUSTOM_REFERENCE_LOOKUP_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_custom_search_reference_lookups_no_delete" BEFORE DELETE ON "legal_custom_search_reference_lookups"
FOR EACH ROW EXECUTE FUNCTION guard_d7f5c81e22e02b91cbf4fee9();

-- legal_candidate_membership_projection_inventory
CREATE FUNCTION guard_2e30991fa03c13f35665aae4() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "legal_custom_search_r2_runtime_roots" root
  WHERE root.search_release_id=NEW.search_release_id
    AND root.mapping_inventory_sha256=NEW.source_inventory_sha256
    AND root.mapping_count=NEW.member_count
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_MEMBERSHIP_PROJECTION_INVENTORY_MISMATCH', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_candidate_membership_projection_inventory" BEFORE INSERT ON "legal_candidate_membership_projections"
FOR EACH ROW EXECUTE FUNCTION guard_2e30991fa03c13f35665aae4();

-- legal_candidate_membership_projection_no_update
CREATE FUNCTION guard_9e5a971c4b57da0e020ad9b9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_MEMBERSHIP_PROJECTION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_candidate_membership_projection_no_update" BEFORE UPDATE ON "legal_candidate_membership_projections"
FOR EACH ROW EXECUTE FUNCTION guard_9e5a971c4b57da0e020ad9b9();

-- legal_candidate_membership_projection_no_replace
CREATE FUNCTION guard_29147c0ee1e5f2110b703cc1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "legal_candidate_membership_projections" published
  WHERE published.search_release_id=NEW.search_release_id
    AND published.proof_version=NEW.proof_version
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_MEMBERSHIP_PROJECTION_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_candidate_membership_projection_no_replace" BEFORE INSERT ON "legal_candidate_membership_projections"
FOR EACH ROW EXECUTE FUNCTION guard_29147c0ee1e5f2110b703cc1();

-- legal_candidate_membership_projection_no_delete
CREATE FUNCTION guard_a481b8d6f99324be38a89dc6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_MEMBERSHIP_PROJECTION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_candidate_membership_projection_no_delete" BEFORE DELETE ON "legal_candidate_membership_projections"
FOR EACH ROW EXECUTE FUNCTION guard_a481b8d6f99324be38a89dc6();

RESET search_path;
