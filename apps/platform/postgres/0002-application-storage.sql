-- Native PostgreSQL baseline; prior applied migrations remain immutable.

CREATE SCHEMA IF NOT EXISTS app;

SET search_path TO app, public;

CREATE TABLE "activity_events" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "actor_user_id" text,
  "type" text NOT NULL,
  "metadata_json" text,
  "created_at" text NOT NULL
);

CREATE TABLE "consultation_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "requester_user_id" text NOT NULL,
  "consultation_type" text NOT NULL,
  "context_json" text NOT NULL,
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "contacts" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL,
  "label" text NOT NULL,
  "full_name" text NOT NULL,
  "birth_date" text,
  "id_document_type" text,
  "id_document_number" text,
  "id_issued_by" text,
  "id_issue_date" text,
  "pinfl" text,
  "registered_address" text,
  "phone" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "document_answers" (
  "document_id" text PRIMARY KEY NOT NULL,
  "answers_json" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "document_attachments" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "file_id" text NOT NULL,
  "visible_to_collaborator" bigint DEFAULT 0 NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "document_change_proposals" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "old_text" text NOT NULL,
  "new_text" text NOT NULL,
  "anchor" text,
  "owner_accepted" bigint DEFAULT 0 NOT NULL,
  "collaborator_accepted" bigint DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "document_collaborators" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "user_id" text NOT NULL,
  "invited_by_user_id" text NOT NULL,
  "role" text NOT NULL,
  "can_view" bigint DEFAULT 1 NOT NULL,
  "can_download" bigint DEFAULT 0 NOT NULL,
  "status" text NOT NULL,
  "opened_at" text,
  "confirmed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "party_number" bigint,
  "permission_set_json" text,
  "invitation_status" text DEFAULT 'accepted' NOT NULL,
  "approval_status" text DEFAULT 'pending' NOT NULL,
  "joined_at" text,
  "revoked_at" text
);

CREATE TABLE "document_comments" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "body" text NOT NULL,
  "anchor" text,
  "created_at" text NOT NULL,
  "thread_id" text ,
  "parent_comment_id" text,
  "deleted_at" text,
  "updated_at" text
);

CREATE TABLE "document_current_content" (
  "document_id" text PRIMARY KEY NOT NULL,
  "auto_content" text NOT NULL,
  "final_content" text NOT NULL,
  "manually_edited" bigint DEFAULT 0 NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "document_files" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text,
  "owner_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "r2_key" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "archived_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "workspace_id" text ,
  "sha256" text
);

CREATE TABLE "document_share_links" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" text NOT NULL,
  "revoked_at" text,
  "created_at" text NOT NULL,
  "public_token" text NOT NULL
);

CREATE TABLE "document_template_locales" (
  "id" text PRIMARY KEY NOT NULL,
  "template_id" text NOT NULL,
  "language" text NOT NULL,
  "name" text NOT NULL,
  "source_object_key" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "document_templates" (
  "id" text PRIMARY KEY NOT NULL,
  "key" text NOT NULL,
  "category" text NOT NULL,
  "active" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "documents" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL,
  "template_id" text NOT NULL,
  "language" text NOT NULL,
  "participant_mode" text NOT NULL,
  "acting_side" text,
  "title" text NOT NULL,
  "category" text NOT NULL,
  "status" text NOT NULL,
  "lender_name" text,
  "borrower_name" text,
  "is_favorite" bigint DEFAULT 0 NOT NULL,
  "archived_at" text,
  "generated_at" text,
  "signed_file_id" text,
  "revision" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "template_code" text,
  "template_version" text,
  "case_id" text ,
  "plan_step_id" text ,
  "workspace_id" text ,
  "case_link_revision" bigint DEFAULT 0 NOT NULL,
  "case_linked_by_user_id" text 
);

CREATE TABLE "notifications" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "document_id" text,
  "type" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "read_at" text,
  "created_at" text NOT NULL,
  "workspace_id" text 
);

CREATE TABLE "signed_document_access" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "collaborator_user_id" text NOT NULL,
  "view_allowed" bigint DEFAULT 0 NOT NULL,
  "download_allowed" bigint DEFAULT 0 NOT NULL,
  "opened" bigint DEFAULT 0 NOT NULL,
  "restored_view_only" bigint DEFAULT 0 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "signed_share_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "share_id" text NOT NULL,
  "session_hash" text NOT NULL,
  "expires_at" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "standalone_signed_pdf_shares" (
  "id" text PRIMARY KEY NOT NULL,
  "file_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "access_code" text NOT NULL,
  "access_code_hash" text NOT NULL,
  "expires_at" text NOT NULL,
  "deactivated_at" text,
  "deleted_at" text,
  "created_at" text NOT NULL,
  "public_token" text NOT NULL,
  "access_code_digits" bigint DEFAULT 4 NOT NULL CHECK ("access_code_digits" IN (4, 6)),
  "verification_attempt_count" bigint DEFAULT 0 NOT NULL CHECK ("verification_attempt_count" >= 0),
  "verification_window_started_at" text,
  "verification_locked_until" text
);

CREATE TABLE "user_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "full_name" text,
  "birth_date" text,
  "id_document_type" text,
  "id_document_number" text,
  "id_issued_by" text,
  "id_issue_date" text,
  "pinfl" text,
  "registered_address" text,
  "phone" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "locale" text DEFAULT 'ru' NOT NULL,
  "account_type" text DEFAULT 'individual' NOT NULL,
  "company_name" text,
  "onboarding_completed_at" text,
  "default_workspace_id" text ,
  "organization_role" text,
  "primary_goal" text,
  "timezone" text DEFAULT 'Asia/Tashkent' NOT NULL,
  "email_ciphertext" text,
  "email_iv" text,
  "email_key_version" text,
  "email_lookup_hash" text,
  "email_lookup_key_version" text,
  "phone_ciphertext" text,
  "phone_iv" text,
  "phone_key_version" text,
  "phone_lookup_hash" text,
  "phone_lookup_key_version" text,
  "last_name" text,
  "first_name" text,
  "middle_name" text,
  "phone_verified" bigint DEFAULT 0 NOT NULL,
  "phone_verified_at" text,
  "lifecycle_status" text DEFAULT 'active' NOT NULL,
  "deletion_completed_at" text,
  "theme_preference" text DEFAULT 'system' NOT NULL
  CHECK ("theme_preference" IN ('system','light','dark')),
  "email_verified_at" text
);

CREATE TABLE "document_approvals" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "participant_user_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "revision" bigint NOT NULL,
  "approved_at" text,
  "revoked_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "document_comment_threads" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "anchor_type" text DEFAULT 'document' NOT NULL,
  "anchor_key" text,
  "created_by_user_id" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "resolved_by_user_id" text,
  "resolved_at" text,
  "reopened_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "document_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "invited_by_user_id" text NOT NULL,
  "target_user_id" text,
  "target_identifier_hash" text,
  "role" text NOT NULL,
  "party_number" bigint,
  "token_hash" text NOT NULL,
  "expires_at" text NOT NULL,
  "accepted_at" text,
  "declined_at" text,
  "revoked_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "target_identifier_kind" text,
  "target_identifier_lookup_hash" text,
  "target_identifier_lookup_key_version" text
);

CREATE TABLE "document_permissions" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "user_id" text NOT NULL,
  "permission" text NOT NULL,
  "granted_by_user_id" text NOT NULL,
  "revoked_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "document_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "revision" bigint NOT NULL,
  "actor_user_id" text,
  "source" text NOT NULL,
  "changes_json" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "document_suggestions" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "field_key" text,
  "original_json" text NOT NULL,
  "proposed_json" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by_user_id" text,
  "decided_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "__backup_20260724_manifest" (
  "table_name" text PRIMARY KEY NOT NULL,
  "row_count" bigint NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "__backup_20260724_activity_events" (
  id TEXT,
  document_id TEXT,
  actor_user_id TEXT,
  type TEXT,
  metadata_json TEXT,
  created_at TEXT
);

CREATE TABLE "__backup_20260724_consultation_requests" (
  id TEXT,
  document_id TEXT,
  requester_user_id TEXT,
  consultation_type TEXT,
  context_json TEXT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_contacts" (
  id TEXT,
  owner_user_id TEXT,
  label TEXT,
  full_name TEXT,
  birth_date TEXT,
  id_document_type TEXT,
  id_document_number TEXT,
  id_issued_by TEXT,
  id_issue_date TEXT,
  pinfl TEXT,
  registered_address TEXT,
  phone TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_answers" (
  document_id TEXT,
  answers_json TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_attachments" (
  id TEXT,
  document_id TEXT,
  file_id TEXT,
  visible_to_collaborator INT,
  created_at TEXT
);

CREATE TABLE "__backup_20260724_document_approvals" (
  id TEXT,
  document_id TEXT,
  participant_user_id TEXT,
  status TEXT,
  revision INT,
  approved_at TEXT,
  revoked_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_change_proposals" (
  id TEXT,
  document_id TEXT,
  author_user_id TEXT,
  old_text TEXT,
  new_text TEXT,
  anchor TEXT,
  owner_accepted INT,
  collaborator_accepted INT,
  status TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_collaborators" (
  id TEXT,
  document_id TEXT,
  user_id TEXT,
  invited_by_user_id TEXT,
  role TEXT,
  can_view INT,
  can_download INT,
  status TEXT,
  opened_at TEXT,
  confirmed_at TEXT,
  created_at TEXT,
  updated_at TEXT,
  party_number INT,
  permission_set_json TEXT,
  invitation_status TEXT,
  approval_status TEXT,
  joined_at TEXT,
  revoked_at TEXT
);

CREATE TABLE "__backup_20260724_document_comments" (
  id TEXT,
  document_id TEXT,
  author_user_id TEXT,
  body TEXT,
  anchor TEXT,
  created_at TEXT,
  thread_id TEXT,
  parent_comment_id TEXT,
  deleted_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_comment_threads" (
  id TEXT,
  document_id TEXT,
  anchor_type TEXT,
  anchor_key TEXT,
  created_by_user_id TEXT,
  status TEXT,
  resolved_by_user_id TEXT,
  resolved_at TEXT,
  reopened_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_current_content" (
  document_id TEXT,
  auto_content TEXT,
  final_content TEXT,
  manually_edited INT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_files" (
  id TEXT,
  document_id TEXT,
  owner_user_id TEXT,
  kind TEXT,
  r2_key TEXT,
  file_name TEXT,
  mime_type TEXT,
  size_bytes INT,
  archived_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_invitations" (
  id TEXT,
  document_id TEXT,
  invited_by_user_id TEXT,
  target_user_id TEXT,
  target_identifier_hash TEXT,
  role TEXT,
  party_number INT,
  token_hash TEXT,
  expires_at TEXT,
  accepted_at TEXT,
  declined_at TEXT,
  revoked_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_permissions" (
  id TEXT,
  document_id TEXT,
  user_id TEXT,
  permission TEXT,
  granted_by_user_id TEXT,
  revoked_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_revisions" (
  id TEXT,
  document_id TEXT,
  revision INT,
  actor_user_id TEXT,
  source TEXT,
  changes_json TEXT,
  created_at TEXT
);

CREATE TABLE "__backup_20260724_document_share_links" (
  id TEXT,
  document_id TEXT,
  owner_user_id TEXT,
  token_hash TEXT,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT,
  public_token TEXT
);

CREATE TABLE "__backup_20260724_document_suggestions" (
  id TEXT,
  document_id TEXT,
  author_user_id TEXT,
  field_key TEXT,
  original_json TEXT,
  proposed_json TEXT,
  status TEXT,
  decided_by_user_id TEXT,
  decided_at TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_template_locales" (
  id TEXT,
  template_id TEXT,
  language TEXT,
  name TEXT,
  source_object_key TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_document_templates" (
  id TEXT,
  "key" TEXT,
  category TEXT,
  active INT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_documents" (
  id TEXT,
  owner_user_id TEXT,
  template_id TEXT,
  language TEXT,
  participant_mode TEXT,
  acting_side TEXT,
  title TEXT,
  category TEXT,
  status TEXT,
  lender_name TEXT,
  borrower_name TEXT,
  is_favorite INT,
  archived_at TEXT,
  generated_at TEXT,
  signed_file_id TEXT,
  revision INT,
  created_at TEXT,
  updated_at TEXT,
  template_code TEXT,
  template_version TEXT
);

CREATE TABLE "__backup_20260724_notifications" (
  id TEXT,
  user_id TEXT,
  document_id TEXT,
  type TEXT,
  title TEXT,
  body TEXT,
  read_at TEXT,
  created_at TEXT
);

CREATE TABLE "__backup_20260724_signed_document_access" (
  id TEXT,
  document_id TEXT,
  collaborator_user_id TEXT,
  view_allowed INT,
  download_allowed INT,
  opened INT,
  restored_view_only INT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "__backup_20260724_signed_share_sessions" (
  id TEXT,
  share_id TEXT,
  session_hash TEXT,
  expires_at TEXT,
  created_at TEXT
);

CREATE TABLE "__backup_20260724_standalone_signed_pdf_shares" (
  id TEXT,
  file_id TEXT,
  owner_user_id TEXT,
  token_hash TEXT,
  access_code TEXT,
  access_code_hash TEXT,
  expires_at TEXT,
  deactivated_at TEXT,
  deleted_at TEXT,
  created_at TEXT,
  public_token TEXT
);

CREATE TABLE "__backup_20260724_user_profiles" (
  id TEXT,
  email TEXT,
  full_name TEXT,
  birth_date TEXT,
  id_document_type TEXT,
  id_document_number TEXT,
  id_issued_by TEXT,
  id_issue_date TEXT,
  pinfl TEXT,
  registered_address TEXT,
  phone TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE "auth_otp_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "email_hash" text NOT NULL,
  "purpose" text NOT NULL,
  "locale" text DEFAULT 'ru' NOT NULL,
  "account_type" text DEFAULT 'individual' NOT NULL,
  "code_salt" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "max_attempts" bigint DEFAULT 5 NOT NULL,
  "expires_at" text NOT NULL,
  "consumed_at" text,
  "invalidated_at" text,
  "request_ip_hash" text,
  "created_at" text NOT NULL,
  "email_lookup_hash" text,
  "email_lookup_key_version" text,
  "code_hmac" text,
  "code_key_version" text,
  "request_ip_lookup_hash" text,
  "request_ip_lookup_key_version" text,
  "verification_locked_until" text
);

CREATE TABLE "auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "expires_at" text NOT NULL,
  "revoked_at" text,
  "created_at" text NOT NULL,
  "last_seen_at" text NOT NULL,
  "device_id" text ,
  "auth_method" text DEFAULT 'email_otp' NOT NULL,
  "assurance_level" text DEFAULT 'primary' NOT NULL,
  "authenticated_at" text,
  "idle_expires_at" text,
  "mfa_verified_at" text
);

CREATE TABLE "cases" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_user_id" text NOT NULL,
  "account_type" text NOT NULL,
  "locale" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "legal_area" text NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "current_revision" bigint DEFAULT 1 NOT NULL,
  "next_deadline_at" text,
  "archived_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "workspace_id" text ,
  "lifecycle_revision" bigint DEFAULT 0 NOT NULL,
  "completed_at" text,
  "completed_by_user_id" text,
  "archived_by_user_id" text
);

CREATE TABLE "case_events" (
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL,
  "actor_user_id" text,
  "event_type" text NOT NULL,
  "metadata_json" text,
  "created_at" text NOT NULL
);

CREATE TABLE "action_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'in_progress' NOT NULL,
  "progress_percent" bigint DEFAULT 0 NOT NULL,
  "current_revision" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "action_plan_steps" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL,
  "ordinal" bigint NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text DEFAULT 'not_started' NOT NULL,
  "deadline_type" text DEFAULT 'calendar_days' NOT NULL,
  "due_at" text,
  "assignee_user_id" text,
  "action_type" text,
  "template_code" text,
  "completed_at" text,
  "revision" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "deadline_source_date" text,
  "deadline_days_count" bigint CHECK ("deadline_days_count" IS NULL OR ("deadline_days_count" >= 0 AND "deadline_days_count" <= 3650)),
  "deadline_include_source_date" bigint DEFAULT 0 NOT NULL CHECK ("deadline_include_source_date" IN (0,1)),
  "deadline_roll_rule" text DEFAULT 'none' NOT NULL CHECK ("deadline_roll_rule" IN ('none','next_business_day','previous_business_day')),
  "holiday_calendar_version" text,
  "safe_due_at" text,
  "calculation_method" text,
  "deadline_legal_basis" text,
  "deadline_evidence_json" text,
  "deadline_confidence" text DEFAULT 'unverified' NOT NULL CHECK ("deadline_confidence" IN ('unverified','preliminary','source_verified'))
);

CREATE TABLE "consultation_slots" (
  "id" text PRIMARY KEY NOT NULL,
  "specialist_type" text NOT NULL,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "timezone" text DEFAULT 'Asia/Tashkent' NOT NULL,
  "status" text DEFAULT 'available' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "consultation_bookings" (
  "id" text PRIMARY KEY NOT NULL,
  "slot_id" text NOT NULL,
  "requester_user_id" text NOT NULL,
  "case_id" text,
  "plan_step_id" text,
  "status" text DEFAULT 'confirmed' NOT NULL,
  "context_json" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "workspace_id" text 
);

CREATE TABLE "workspaces" (
  "id" text PRIMARY KEY NOT NULL,
  "type" text NOT NULL,
  "name" text NOT NULL,
  "locale" text DEFAULT 'ru' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "full_name" text,
  "short_name" text,
  "created_by_user_id" text,
  "creation_request_id" text
);

CREATE TABLE "workspace_members" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "joined_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "workspace_invitations" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "invited_by_user_id" text NOT NULL,
  "email_hash" text NOT NULL,
  "token_hash" text NOT NULL,
  "role" text NOT NULL,
  "expires_at" text NOT NULL,
  "accepted_at" text,
  "revoked_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "email" text,
  "email_ciphertext" text,
  "email_iv" text,
  "email_key_version" text,
  "email_lookup_hash" text,
  "email_lookup_key_version" text,
  "acceptance_claim_id" text
);

CREATE TABLE "workspace_audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "actor_user_id" text,
  "entity_type" text NOT NULL,
  "entity_id" text,
  "action" text NOT NULL,
  "metadata_json" text,
  "ip_hash" text,
  "created_at" text NOT NULL
);

CREATE TABLE "consents" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text,
  "type" text NOT NULL,
  "version" text NOT NULL,
  "scope_json" text,
  "granted_at" text NOT NULL,
  "revoked_at" text
);

CREATE TABLE "account_deletion_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "reason" text,
  "requested_at" text NOT NULL,
  "completed_at" text,
  "verification_challenge_id" text ,
  "requested_session_id" text ,
  "verification_method" text,
  "verified_at" text,
  "deletion_mode" text DEFAULT 'recoverable_30d' NOT NULL,
  "subject_hash" text,
  "subject_key_version" text,
  "scheduled_purge_at" text,
  "cancelled_at" text,
  "purge_started_at" text,
  "purge_irreversible_at" text,
  "purge_lease_owner" text,
  "purge_lease_expires_at" text,
  "failure_code" text
);

CREATE TABLE "confirmed_facts" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL,
  "case_id" text,
  "statement" text NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "confirmed_by_user_id" text,
  "confirmed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "conversation_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL,
  "author_type" text NOT NULL,
  "content" text NOT NULL,
  "structured_json" text,
  "created_at" text NOT NULL
);

CREATE TABLE "conversation_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL,
  "message_id" text,
  "source_id" text NOT NULL,
  "citation_label" text,
  "created_at" text NOT NULL
);

CREATE TABLE "conversations" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "case_id" text,
  "title" text NOT NULL,
  "locale" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "legal_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "official_url" text NOT NULL,
  "act_title" text NOT NULL,
  "act_identifier" text,
  "published_at" text,
  "revision_date" text,
  "locale" text NOT NULL,
  "source_type" text NOT NULL,
  "status" text DEFAULT 'verified' NOT NULL,
  "last_checked_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "canonical_id" text,
  "verification_state" text DEFAULT 'draft' NOT NULL,
  "content_sha256" text,
  "fetched_at" text,
  "verified_at" text,
  "verified_by_user_id" text,
  "verification_notes" text,
  "effective_at" text,
  "expires_at" text
);

CREATE TABLE "payments" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "subscription_id" text,
  "provider_payment_id" text,
  "amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "status" text NOT NULL,
  "receipt_object_key" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "subscriptions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "provider" text NOT NULL,
  "provider_customer_id" text,
  "provider_subscription_id" text,
  "plan_code" text NOT NULL,
  "status" text NOT NULL,
  "current_period_ends_at" text,
  "cancel_at_period_end" bigint DEFAULT 0 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "plan_version_id" text ,
  "order_id" text ,
  "billing_period" text,
  "auto_renew_consent_at" text,
  "started_at" text,
  "grace_period_ends_at" text,
  "version" bigint DEFAULT 1 NOT NULL
);

CREATE TABLE "document_analyses" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "uploaded_file_id" text NOT NULL,
  "status" text NOT NULL,
  "summary_json" text,
  "error_code" text,
  "consent_version" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "case_id" text ,
  "case_link_revision" bigint DEFAULT 0 NOT NULL,
  "case_linked_by_user_id" text ,
  "result_sha256" text,
  "resource_scope" text CHECK ("resource_scope" IS NULL OR "resource_scope" = 'interactive_analysis'),
  "abandoned_after" text,
  "deletion_requested_at" text,
  "deletion_reason" text CHECK ("deletion_reason" IS NULL OR "deletion_reason" IN ('owner_request','abandoned_upload')),
  "purge_attempt_count" bigint DEFAULT 0 NOT NULL CHECK ("purge_attempt_count" >= 0),
  "last_purge_error" text
);

CREATE TABLE "document_risks" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "level" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "excerpt" text,
  "confidence_percent" bigint,
  "created_at" text NOT NULL,
  "risk_type" text NOT NULL DEFAULT 'document_internal',
  "clause" text,
  "page" bigint,
  "recommendation" text,
  "proposed_wording" text,
  "legal_basis_source_ids_json" text NOT NULL DEFAULT '[]'
);

CREATE TABLE "comparison_changes" (
  "id" text PRIMARY KEY NOT NULL,
  "comparison_id" text NOT NULL,
  "ordinal" bigint NOT NULL,
  "change_type" text NOT NULL,
  "before_section_id" text,
  "after_section_id" text,
  "before_label" text,
  "after_label" text,
  "before_heading" text,
  "after_heading" text,
  "before_text" text,
  "after_text" text,
  "word_diff_json" text NOT NULL,
  "summary" text NOT NULL,
  "legal_effect" text NOT NULL,
  "affected_party" text NOT NULL,
  "risk_effect" text NOT NULL,
  "risk_level" text NOT NULL,
  "recommendation" text NOT NULL,
  "source_ids_json" text DEFAULT '[]' NOT NULL,
  "confidence_percent" bigint,
  "reviewed_at" text,
  "extraction_warning" bigint DEFAULT 0 NOT NULL,
  "created_at" text NOT NULL,
  "review_decision" text,
  "decided_by_user_id" text ,
  "decided_at" text,
  "review_decision_version" bigint DEFAULT 0 NOT NULL,
  "review_decision_event_id" text
);

CREATE TABLE "document_comparisons" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "version_one_file_id" text NOT NULL,
  "version_two_file_id" text NOT NULL,
  "case_id" text,
  "status" text NOT NULL,
  "stage" text NOT NULL,
  "locale" text NOT NULL,
  "summary_json" text,
  "version_one_json_key" text,
  "version_two_json_key" text,
  "similarity_percent" bigint,
  "overall_risk" text,
  "ai_status" text,
  "model_name" text,
  "model_version" text,
  "error_code" text,
  "deleted_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "legislation_updates" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL,
  "external_id" text NOT NULL,
  "title_original" text NOT NULL,
  "original_language" text NOT NULL,
  "title_ru" text,
  "title_uz" text,
  "summary_ru" text,
  "summary_uz" text,
  "change_summary_ru" text,
  "change_summary_uz" text,
  "recommended_action_ru" text,
  "recommended_action_uz" text,
  "topics_json" text DEFAULT '[]' NOT NULL,
  "affected_audiences_json" text DEFAULT '[]' NOT NULL,
  "adopted_at" text,
  "effective_at" text,
  "published_at" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "verified_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "monitoring_preferences" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "audience" text NOT NULL,
  "topics_json" text DEFAULT '[]' NOT NULL,
  "channels_json" text DEFAULT '["in_app"]' NOT NULL,
  "frequency" text DEFAULT 'weekly' NOT NULL,
  "locale" text DEFAULT 'ru' NOT NULL,
  "document_impact_consent" bigint DEFAULT 0 NOT NULL,
  "last_delivered_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "backup_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "backup_type" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "schema_version" text,
  "app_version" text,
  "source_bookmark" text,
  "object_key" text,
  "checksum_sha256" text,
  "byte_size" bigint,
  "manifest_version" text,
  "verified_at" text,
  "restore_tested_at" text,
  "error_code" text,
  "started_at" text,
  "finished_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "cleanup_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "policy_version" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "dry_run" bigint DEFAULT 1 NOT NULL,
  "cursor" text,
  "scanned_count" bigint DEFAULT 0 NOT NULL,
  "deleted_count" bigint DEFAULT 0 NOT NULL,
  "failed_count" bigint DEFAULT 0 NOT NULL,
  "error_code" text,
  "started_at" text,
  "finished_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "idempotency_keys" (
  "key" text PRIMARY KEY NOT NULL,
  "scope" text NOT NULL,
  "request_hash" text NOT NULL,
  "status" text DEFAULT 'started' NOT NULL,
  "result_ref" text,
  "expires_at" text NOT NULL,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "job_outbox" (
  "id" text PRIMARY KEY NOT NULL,
  "queue_binding" text NOT NULL,
  "job_type" text NOT NULL,
  "schema_version" bigint DEFAULT 1 NOT NULL,
  "idempotency_key" text NOT NULL,
  "subject_id" text NOT NULL,
  "workspace_id" text,
  "correlation_id" text NOT NULL,
  "enqueued_at" text NOT NULL,
  "available_at" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "dispatch_attempts" bigint DEFAULT 0 NOT NULL,
  "lease_owner" text,
  "lease_expires_at" text,
  "next_attempt_at" text,
  "dispatched_at" text,
  "error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "job_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "queue_name" text NOT NULL,
  "message_id" text NOT NULL,
  "job_type" text NOT NULL,
  "schema_version" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "subject_id" text NOT NULL,
  "workspace_id" text,
  "correlation_id" text NOT NULL,
  "envelope_hash" text NOT NULL,
  "status" text DEFAULT 'received' NOT NULL,
  "attempt" bigint DEFAULT 1 NOT NULL,
  "lease_owner" text,
  "lease_expires_at" text,
  "next_attempt_at" text,
  "error_code" text,
  "started_at" text,
  "finished_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "scheduled_locks" (
  "name" text PRIMARY KEY NOT NULL,
  "holder_id" text NOT NULL,
  "acquired_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "scheduled_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "schedule_name" text NOT NULL,
  "cron" text NOT NULL,
  "scheduled_for" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "holder_id" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "error_code" text,
  "started_at" text NOT NULL,
  "finished_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "auth_devices" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "display_name" text NOT NULL,
  "user_agent_hash" text,
  "first_seen_at" text NOT NULL,
  "last_seen_at" text NOT NULL,
  "revoked_at" text,
  "continuity_id" text 
);

CREATE TABLE "security_events" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text,
  "device_id" text,
  "event_type" text NOT NULL,
  "severity" text DEFAULT 'info' NOT NULL,
  "auth_source" text,
  "assurance_level" text,
  "ip_hash" text,
  "user_agent_hash" text,
  "metadata_json" text,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "auth_backup_codes" (
  "id" text PRIMARY KEY NOT NULL,
  "credential_id" text NOT NULL,
  "user_id" text NOT NULL,
  "batch_id" text NOT NULL,
  "code_hmac" text NOT NULL,
  "key_version" text NOT NULL,
  "used_at" text,
  "revoked_at" text,
  "created_at" text NOT NULL
);

CREATE TABLE "auth_mfa_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "user_id" text NOT NULL,
  "credential_id" text NOT NULL,
  "email_otp_challenge_id" text NOT NULL,
  "purpose" text DEFAULT 'login' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "max_attempts" bigint DEFAULT 5 NOT NULL,
  "request_user_agent_hmac" text,
  "evidence_key_version" text,
  "expires_at" text NOT NULL,
  "consumed_at" text,
  "invalidated_at" text,
  "created_at" text NOT NULL,
  "primary_auth_method" text DEFAULT 'email_otp' NOT NULL,
  CONSTRAINT "auth_mfa_challenges_purpose_check" CHECK("auth_mfa_challenges"."purpose" IN ('login')),
  CONSTRAINT "auth_mfa_challenges_attempts_check" CHECK("auth_mfa_challenges"."attempt_count" >= 0 AND "auth_mfa_challenges"."max_attempts" BETWEEN 1 AND 10)
);

CREATE TABLE "auth_mfa_factor_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "operation_id" text NOT NULL,
  "credential_id" text NOT NULL,
  "factor_type" text NOT NULL,
  "factor_key" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "auth_mfa_claims_factor_type_check" CHECK("auth_mfa_factor_claims"."factor_type" IN ('totp','backup_code'))
);

CREATE TABLE "auth_totp_credentials" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "secret_ciphertext" text NOT NULL,
  "secret_iv" text NOT NULL,
  "key_version" text NOT NULL,
  "algorithm" text DEFAULT 'SHA1' NOT NULL,
  "digits" bigint DEFAULT 6 NOT NULL,
  "period_seconds" bigint DEFAULT 30 NOT NULL,
  "verification_attempt_count" bigint DEFAULT 0 NOT NULL,
  "verification_max_attempts" bigint DEFAULT 5 NOT NULL,
  "last_used_step" bigint,
  "backup_batch_id" text,
  "backup_key_version" text,
  "enrollment_expires_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "verified_at" text,
  "disabled_at" text,
  CONSTRAINT "auth_totp_status_check" CHECK("auth_totp_credentials"."status" IN ('pending','active','disabled')),
  CONSTRAINT "auth_totp_algorithm_check" CHECK("auth_totp_credentials"."algorithm" = 'SHA1'),
  CONSTRAINT "auth_totp_digits_check" CHECK("auth_totp_credentials"."digits" = 6),
  CONSTRAINT "auth_totp_period_check" CHECK("auth_totp_credentials"."period_seconds" = 30),
  CONSTRAINT "auth_totp_attempts_check" CHECK("auth_totp_credentials"."verification_attempt_count" >= 0 AND "auth_totp_credentials"."verification_max_attempts" BETWEEN 1 AND 10)
);

CREATE TABLE "platform_staff_assignments" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "grant_source" text NOT NULL,
  "granted_by_user_id" text,
  "grant_reason" text NOT NULL,
  "granted_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "revoked_at" text,
  "revocation_source" text,
  "revoked_by_user_id" text,
  "revocation_reason" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "platform_staff_assignments_role_check" CHECK("platform_staff_assignments"."role" IN ('administrator','support','legal_reviewer')),
  CONSTRAINT "platform_staff_assignments_grant_source_check" CHECK("platform_staff_assignments"."grant_source" IN ('operator_bootstrap','administrator')),
  CONSTRAINT "platform_staff_assignments_grant_actor_check" CHECK((
        ("platform_staff_assignments"."grant_source" = 'operator_bootstrap'
          AND "platform_staff_assignments"."granted_by_user_id" IS NULL)
        OR
        ("platform_staff_assignments"."grant_source" = 'administrator'
          AND "platform_staff_assignments"."granted_by_user_id" IS NOT NULL
          AND "platform_staff_assignments"."granted_by_user_id" <> "platform_staff_assignments"."user_id")
      )),
  CONSTRAINT "platform_staff_assignments_grant_reason_check" CHECK(length(trim("platform_staff_assignments"."grant_reason")) BETWEEN 1 AND 500),
  CONSTRAINT "platform_staff_assignments_time_check" CHECK("platform_staff_assignments"."expires_at" > "platform_staff_assignments"."granted_at"
        AND "platform_staff_assignments"."updated_at" >= "platform_staff_assignments"."created_at"),
  CONSTRAINT "platform_staff_assignments_revocation_check" CHECK((
        "platform_staff_assignments"."revoked_at" IS NULL
        AND "platform_staff_assignments"."revocation_source" IS NULL
        AND "platform_staff_assignments"."revoked_by_user_id" IS NULL
        AND "platform_staff_assignments"."revocation_reason" IS NULL
      ) OR (
        "platform_staff_assignments"."revoked_at" IS NOT NULL
        AND "platform_staff_assignments"."revocation_source" IN ('operator','administrator')
        AND (
          ("platform_staff_assignments"."revocation_source" = 'operator'
            AND "platform_staff_assignments"."revoked_by_user_id" IS NULL)
          OR
          ("platform_staff_assignments"."revocation_source" = 'administrator'
            AND "platform_staff_assignments"."revoked_by_user_id" IS NOT NULL)
        )
        AND length(trim("platform_staff_assignments"."revocation_reason")) BETWEEN 1 AND 500
        AND "platform_staff_assignments"."revoked_at" >= "platform_staff_assignments"."granted_at"
      ))
);

CREATE TABLE "platform_staff_role_events" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "subject_user_id" text NOT NULL,
  "subject_assignment_id" text NOT NULL,
  "event_type" text NOT NULL,
  "capability" text NOT NULL,
  "role" text NOT NULL,
  "reason" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "platform_staff_role_events_type_check" CHECK("platform_staff_role_events"."event_type" IN ('staff.role.granted','staff.role.revoked')),
  CONSTRAINT "platform_staff_role_events_capability_check" CHECK("platform_staff_role_events"."capability" = 'staff.roles.manage'),
  CONSTRAINT "platform_staff_role_events_role_check" CHECK("platform_staff_role_events"."role" IN ('administrator','support','legal_reviewer')),
  CONSTRAINT "platform_staff_role_events_reason_check" CHECK(length(trim("platform_staff_role_events"."reason")) BETWEEN 1 AND 500),
  CONSTRAINT "platform_staff_role_events_hash_check" CHECK(length("platform_staff_role_events"."previous_hash") = 64
        AND length("platform_staff_role_events"."event_hash") = 64),
  CONSTRAINT "platform_staff_role_events_mfa_time_check" CHECK("platform_staff_role_events"."actor_mfa_verified_at" <= "platform_staff_role_events"."created_at")
);

CREATE TABLE "legal_review_queue" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL,
  "version_id" text,
  "reason_code" text NOT NULL,
  "confidence" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "assigned_to_user_id" text,
  "decision" text,
  "decided_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "decision_notes" text,
  "reviewed_parsed_sha256" text,
  "decided_by_user_id" text ,
  "decision_evidence_json" text,
  "decision_evidence_sha256" text
);

CREATE TABLE "legal_source_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "version_id" text NOT NULL,
  "section_id" text,
  "chunk_index" bigint NOT NULL,
  "language" text NOT NULL,
  "content_text" text NOT NULL,
  "content_sha256" text NOT NULL,
  "vector_id" text,
  "metadata_json" text DEFAULT '{}' NOT NULL,
  "indexed_at" text,
  "created_at" text NOT NULL
);

CREATE TABLE "legal_source_sections" (
  "id" text PRIMARY KEY NOT NULL,
  "version_id" text NOT NULL,
  "canonical_ref" text,
  "article" text,
  "part" text,
  "clause" text,
  "heading" text,
  "body_text" text NOT NULL,
  "sequence" bigint NOT NULL,
  "content_sha256" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "legal_source_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL,
  "external_version_id" text,
  "language" text NOT NULL,
  "status" text DEFAULT 'pending_review' NOT NULL,
  "content_sha256" text NOT NULL,
  "raw_object_key" text NOT NULL,
  "parsed_object_key" text,
  "published_at" text,
  "effective_at" text,
  "expires_at" text,
  "fetched_at" text NOT NULL,
  "verified_at" text,
  "verified_by_user_id" text,
  "metadata_json" text DEFAULT '{}' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "source_sync_errors" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "source_url" text,
  "external_id" text,
  "error_code" text NOT NULL,
  "retryable" bigint DEFAULT 0 NOT NULL,
  "safe_summary" text NOT NULL,
  "occurred_at" text NOT NULL
);

CREATE TABLE "source_sync_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "source_kind" text NOT NULL,
  "run_type" text NOT NULL,
  "status" text DEFAULT 'running' NOT NULL,
  "lock_key" text NOT NULL,
  "discovered_count" bigint DEFAULT 0 NOT NULL,
  "fetched_count" bigint DEFAULT 0 NOT NULL,
  "changed_count" bigint DEFAULT 0 NOT NULL,
  "verified_count" bigint DEFAULT 0 NOT NULL,
  "error_count" bigint DEFAULT 0 NOT NULL,
  "started_at" text NOT NULL,
  "finished_at" text,
  "error_summary" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "legal_source_fetch_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "source_kind" text NOT NULL,
  "locale" text NOT NULL,
  "requested_url" text NOT NULL,
  "canonical_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "requested_by_user_id" text,
  "source_id" text,
  "version_id" text,
  "error_code" text,
  "started_at" text,
  "finished_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "legal_source_publications" (
  "id" text PRIMARY KEY NOT NULL,
  "review_id" text NOT NULL,
  "source_id" text NOT NULL,
  "version_id" text NOT NULL,
  "review_evidence_sha256" text NOT NULL,
  "raw_content_sha256" text NOT NULL,
  "parsed_content_sha256" text NOT NULL,
  "published_by_user_id" text NOT NULL,
  "publication_evidence_json" text NOT NULL,
  "publication_evidence_sha256" text NOT NULL,
  "published_at" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "auth_session_token_history" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "rotation_reason" text NOT NULL,
  "rotated_at" text NOT NULL,
  "expires_at" text NOT NULL,
  CONSTRAINT "auth_session_token_history_reason_check" CHECK("auth_session_token_history"."rotation_reason" IN ('mfa_elevation','email_change','mfa_disabled','manual','periodic')),
  CONSTRAINT "auth_session_token_history_expiry_check" CHECK("auth_session_token_history"."expires_at" >= "auth_session_token_history"."rotated_at")
);

CREATE TABLE "auth_session_token_replays" (
  "id" text PRIMARY KEY NOT NULL,
  "token_history_id" text NOT NULL,
  "session_id" text NOT NULL,
  "user_id" text NOT NULL,
  "detected_at" text NOT NULL,
  "action" text NOT NULL,
  CONSTRAINT "auth_session_token_replays_action_check" CHECK("auth_session_token_replays"."action" = 'session_and_device_revoked')
);

CREATE TABLE "auth_device_continuities" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "token_hmac" text NOT NULL,
  "key_version" text NOT NULL,
  "first_country_code" text,
  "first_region_code" text,
  "last_country_code" text,
  "last_region_code" text,
  "first_seen_at" text NOT NULL,
  "last_seen_at" text NOT NULL,
  "revoked_at" text,
  CONSTRAINT "auth_device_continuities_hmac_check" CHECK(length("auth_device_continuities"."token_hmac") = 43
        AND "auth_device_continuities"."token_hmac" !~ '^.*[^A-Za-z0-9_-].*$'),
  CONSTRAINT "auth_device_continuities_country_check" CHECK(("auth_device_continuities"."first_country_code" IS NULL OR (
          length("auth_device_continuities"."first_country_code") = 2
          AND "auth_device_continuities"."first_country_code" !~ '^.*[^A-Z0-9].*$'
        )) AND ("auth_device_continuities"."last_country_code" IS NULL OR (
          length("auth_device_continuities"."last_country_code") = 2
          AND "auth_device_continuities"."last_country_code" !~ '^.*[^A-Z0-9].*$'
        ))),
  CONSTRAINT "auth_device_continuities_region_check" CHECK(("auth_device_continuities"."first_region_code" IS NULL OR (
          length("auth_device_continuities"."first_region_code") BETWEEN 1 AND 12
          AND "auth_device_continuities"."first_region_code" !~ '^.*[^A-Z0-9-].*$'
        )) AND ("auth_device_continuities"."last_region_code" IS NULL OR (
          length("auth_device_continuities"."last_region_code") BETWEEN 1 AND 12
          AND "auth_device_continuities"."last_region_code" !~ '^.*[^A-Z0-9-].*$'
        )))
);

CREATE TABLE "account_deletion_lifecycle_events" (
  "id" text PRIMARY KEY NOT NULL,
  "request_id" text NOT NULL,
  "subject_hash" text NOT NULL,
  "subject_key_version" text NOT NULL,
  "event_type" text NOT NULL,
  "deletion_mode" text NOT NULL,
  "policy_version" text NOT NULL,
  "summary_json" text DEFAULT '{}' NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "account_deletion_lifecycle_event_type_check" CHECK("account_deletion_lifecycle_events"."event_type" IN ('scheduled','cancelled','purge_started','blocked','completed','failed')),
  CONSTRAINT "account_deletion_lifecycle_mode_check" CHECK("account_deletion_lifecycle_events"."deletion_mode" IN ('immediate','recoverable_30d')),
  CONSTRAINT "account_deletion_lifecycle_hash_check" CHECK(length("account_deletion_lifecycle_events"."subject_hash") = 64 AND length("account_deletion_lifecycle_events"."previous_hash") = 64 AND length("account_deletion_lifecycle_events"."event_hash") = 64)
);

CREATE TABLE "account_deletion_purge_evidence" (
  "request_id" text PRIMARY KEY NOT NULL,
  "subject_hash" text NOT NULL,
  "subject_key_version" text NOT NULL,
  "deletion_mode" text NOT NULL,
  "policy_version" text NOT NULL,
  "requested_at" text NOT NULL,
  "completed_at" text NOT NULL,
  "r2_deleted_count" bigint DEFAULT 0 NOT NULL,
  "d1_deleted_count" bigint DEFAULT 0 NOT NULL,
  "redacted_count" bigint DEFAULT 0 NOT NULL,
  "retained_evidence_json" text DEFAULT '[]' NOT NULL,
  "evidence_hash" text NOT NULL,
  CONSTRAINT "account_deletion_purge_mode_check" CHECK("account_deletion_purge_evidence"."deletion_mode" IN ('immediate','recoverable_30d')),
  CONSTRAINT "account_deletion_purge_counts_check" CHECK("account_deletion_purge_evidence"."r2_deleted_count" >= 0 AND "account_deletion_purge_evidence"."d1_deleted_count" >= 0 AND "account_deletion_purge_evidence"."redacted_count" >= 0),
  CONSTRAINT "account_deletion_purge_hash_check" CHECK(length("account_deletion_purge_evidence"."subject_hash") = 64 AND length("account_deletion_purge_evidence"."evidence_hash") = 64)
);

CREATE TABLE "legal_source_current_activations" (
  "source_id" text PRIMARY KEY NOT NULL,
  "publication_id" text NOT NULL,
  "version_id" text NOT NULL,
  "activated_by_user_id" text NOT NULL,
  "activated_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "legal_source_lifecycle_events" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL,
  "publication_id" text NOT NULL,
  "version_id" text NOT NULL,
  "previous_publication_id" text,
  "previous_version_id" text,
  "event_type" text NOT NULL,
  "reason_notes" text,
  "acted_by_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_ids_json" text NOT NULL,
  "mfa_verified_at" text NOT NULL,
  "evidence_json" text NOT NULL,
  "evidence_sha256" text NOT NULL,
  "occurred_at" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "ai_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "conversation_id" text,
  "request_message_id" text,
  "response_message_id" text,
  "idempotency_key" text NOT NULL,
  "correlation_id" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "provider_response_id" text,
  "fallback_from_provider" text,
  "answer_mode" text NOT NULL,
  "reasoning_mode" text NOT NULL,
  "status" text NOT NULL,
  "legal_database_as_of" text NOT NULL,
  "instruction_hash" text NOT NULL,
  "source_version_hash" text NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cached_input_tokens" bigint DEFAULT 0 NOT NULL,
  "estimated_cost_microusd" bigint,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "latency_ms" bigint,
  "error_code" text,
  "started_at" text NOT NULL,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "ai_usage_ledger" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "ai_run_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "feature" text DEFAULT 'legal_chat' NOT NULL,
  "period_start" text NOT NULL,
  "period_end" text NOT NULL,
  "units" bigint DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cached_input_tokens" bigint DEFAULT 0 NOT NULL,
  "estimated_cost_microusd" bigint,
  "released_at" text,
  "consumed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "message_branches" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "parent_branch_id" text,
  "forked_from_message_id" text,
  "request_message_id" text NOT NULL,
  "response_message_id" text NOT NULL,
  "operation" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "message_branches_operation_check" CHECK("message_branches"."operation" IN ('new','follow_up','edit','regenerate'))
);

CREATE TABLE "message_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "conversation_id" text NOT NULL,
  "branch_id" text NOT NULL,
  "message_id" text NOT NULL,
  "source_message_id" text,
  "created_by_user_id" text NOT NULL,
  "operation" text NOT NULL,
  "version_number" bigint DEFAULT 1 NOT NULL,
  "content_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "message_versions_operation_check" CHECK("message_versions"."operation" IN ('new','follow_up','edit','regenerate')),
  CONSTRAINT "message_versions_number_check" CHECK("message_versions"."version_number" >= 1)
);

CREATE TABLE "analysis_exports" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "format" text NOT NULL,
  "status" text NOT NULL,
  "r2_key" text,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint,
  "sha256" text,
  "idempotency_key" text NOT NULL,
  "error_code" text,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "analysis_exports_format_check" CHECK("analysis_exports"."format" = 'json'),
  CONSTRAINT "analysis_exports_status_check" CHECK("analysis_exports"."status" IN ('queued','processing','retrying','completed','failed')),
  CONSTRAINT "analysis_exports_size_check" CHECK("analysis_exports"."size_bytes" IS NULL OR "analysis_exports"."size_bytes" >= 0),
  CONSTRAINT "analysis_exports_sha_check" CHECK("analysis_exports"."sha256" IS NULL OR length("analysis_exports"."sha256") = 64),
  CONSTRAINT "analysis_exports_completion_check" CHECK(
    ("analysis_exports"."status" = 'completed'
      AND "analysis_exports"."r2_key" IS NOT NULL AND "analysis_exports"."size_bytes" IS NOT NULL
      AND "analysis_exports"."sha256" IS NOT NULL AND "analysis_exports"."completed_at" IS NOT NULL
      AND "analysis_exports"."error_code" IS NULL)
    OR ("analysis_exports"."status" <> 'completed' AND "analysis_exports"."completed_at" IS NULL)
  )
);

CREATE TABLE "analysis_report_exports" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "format" text NOT NULL,
  "status" text NOT NULL,
  "r2_key" text,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint,
  "sha256" text,
  "idempotency_key" text NOT NULL,
  "error_code" text,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "variant" text NOT NULL DEFAULT 'analysis_report',
  "source_version_id" text ,
  CONSTRAINT "analysis_report_exports_format_check" CHECK("analysis_report_exports"."format" IN ('pdf','docx')),
  CONSTRAINT "analysis_report_exports_status_check" CHECK("analysis_report_exports"."status" IN ('queued','processing','retrying','completed','failed')),
  CONSTRAINT "analysis_report_exports_mime_check" CHECK(
    ("analysis_report_exports"."format" = 'pdf' AND "analysis_report_exports"."mime_type" = 'application/pdf')
    OR ("analysis_report_exports"."format" = 'docx' AND "analysis_report_exports"."mime_type" = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  ),
  CONSTRAINT "analysis_report_exports_size_check" CHECK("analysis_report_exports"."size_bytes" IS NULL OR "analysis_report_exports"."size_bytes" >= 0),
  CONSTRAINT "analysis_report_exports_sha_check" CHECK("analysis_report_exports"."sha256" IS NULL OR length("analysis_report_exports"."sha256") = 64),
  CONSTRAINT "analysis_report_exports_completion_check" CHECK(
    ("analysis_report_exports"."status" = 'completed'
      AND "analysis_report_exports"."r2_key" IS NOT NULL AND "analysis_report_exports"."size_bytes" IS NOT NULL
      AND "analysis_report_exports"."sha256" IS NOT NULL AND "analysis_report_exports"."completed_at" IS NOT NULL
      AND "analysis_report_exports"."error_code" IS NULL)
    OR ("analysis_report_exports"."status" <> 'completed' AND "analysis_report_exports"."completed_at" IS NULL)
  )
);

CREATE TABLE "file_extractions" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "file_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "status" text NOT NULL,
  "method" text NOT NULL,
  "provider" text NOT NULL,
  "model" text,
  "source_sha256" text NOT NULL,
  "r2_key" text,
  "text_sha256" text,
  "size_bytes" bigint,
  "token_estimate" bigint,
  "detected_mime_type" text,
  "detected_language" text,
  "text_quality" text,
  "warnings_json" text DEFAULT '[]' NOT NULL,
  "error_code" text,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "file_extractions_status_check" CHECK("file_extractions"."status" IN ('queued','processing','retrying','completed','failed')),
  CONSTRAINT "file_extractions_method_check" CHECK("file_extractions"."method" = 'workers_ai_markdown'),
  CONSTRAINT "file_extractions_source_sha_check" CHECK(length("file_extractions"."source_sha256") = 64),
  CONSTRAINT "file_extractions_text_sha_check" CHECK("file_extractions"."text_sha256" IS NULL OR length("file_extractions"."text_sha256") = 64),
  CONSTRAINT "file_extractions_size_check" CHECK("file_extractions"."size_bytes" IS NULL OR "file_extractions"."size_bytes" >= 0),
  CONSTRAINT "file_extractions_token_check" CHECK("file_extractions"."token_estimate" IS NULL OR "file_extractions"."token_estimate" >= 0)
);

CREATE TABLE "task_reminders" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "channel" text DEFAULT 'in_app' NOT NULL,
  "reminder_at" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "idempotency_key" text NOT NULL,
  "sent_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "tasks" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "case_id" text NOT NULL,
  "plan_step_id" text,
  "owner_user_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "legal_basis" text,
  "source_date" text,
  "due_at" text,
  "safe_due_at" text,
  "calculation_method" text,
  "deadline_type" text DEFAULT 'calendar_days' NOT NULL,
  "status" text DEFAULT 'planned' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "completed_at" text,
  "deadline_days_count" bigint CHECK ("deadline_days_count" IS NULL OR ("deadline_days_count" >= 0 AND "deadline_days_count" <= 3650)),
  "deadline_include_source_date" bigint DEFAULT 0 NOT NULL CHECK ("deadline_include_source_date" IN (0,1)),
  "deadline_roll_rule" text DEFAULT 'none' NOT NULL CHECK ("deadline_roll_rule" IN ('none','next_business_day','previous_business_day')),
  "holiday_calendar_version" text,
  "deadline_evidence_json" text,
  "deadline_confidence" text DEFAULT 'unverified' NOT NULL CHECK ("deadline_confidence" IN ('unverified','preliminary','source_verified'))
);

CREATE TABLE "conflict_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "reviewed_at" text,
  "reviewed_by_user_id" text,
  "created_at" text NOT NULL
);

CREATE TABLE "lawyer_access_grants" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "case_id" text NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "granted_by_user_id" text NOT NULL,
  "expires_at" text,
  "revoked_at" text,
  "revoke_reason" text,
  "created_at" text NOT NULL
);

CREATE TABLE "lawyer_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "display_name" text NOT NULL,
  "specialties_json" text DEFAULT '[]' NOT NULL,
  "languages_json" text DEFAULT '[]' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "public_approved_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "experience_years" bigint,
  "price_description" text,
  "availability_status" text DEFAULT 'unknown' NOT NULL,
  "next_available_at" text,
  "advocate_status" text DEFAULT 'not_declared' NOT NULL,
  "firm_name" text,
  "bio" text,
  "profile_revision" bigint DEFAULT 1 NOT NULL,
  "marketplace_status" text DEFAULT 'profile_incomplete' NOT NULL,
  "city" text,
  "region" text,
  "education" text,
  "consultation_formats_json" text DEFAULT '[]' NOT NULL,
  "profile_photo_key" text,
  "profile_photo_mime" text,
  "profile_photo_sha256" text,
  "profile_photo_size_bytes" bigint,
  "juro_approval_status" text DEFAULT 'not_approved' NOT NULL,
  "juro_approved_at" text,
  "juro_approved_by_user_id" text,
  "top_lawyer_status" text DEFAULT 'not_featured' NOT NULL,
  "top_lawyer_criteria" text,
  "top_lawyer_at" text,
  "consultation_duration_minutes" bigint DEFAULT 60 NOT NULL
  CHECK ("consultation_duration_minutes" BETWEEN 15 AND 480),
  "additional_services_json" text DEFAULT '[]' NOT NULL
);

CREATE TABLE "lawyer_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "case_id" text NOT NULL,
  "requester_user_id" text NOT NULL,
  "lawyer_profile_id" text,
  "status" text DEFAULT 'requested' NOT NULL,
  "anonymized_summary" text NOT NULL,
  "requested_scope_json" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "support_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "ticket_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "author_type" text NOT NULL,
  "body" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "support_tickets" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "requester_user_id" text NOT NULL,
  "category" text NOT NULL,
  "severity" text DEFAULT 'normal' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "subject" text NOT NULL,
  "linked_entity_type" text,
  "linked_entity_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "closed_at" text
);

CREATE TABLE "staging_provider_probes" (
  "id" text PRIMARY KEY NOT NULL,
  "probe_key" text NOT NULL,
  "provider" text NOT NULL,
  "status" text NOT NULL,
  "model" text,
  "provider_response_id" text,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cached_input_tokens" bigint DEFAULT 0 NOT NULL,
  "latency_ms" bigint DEFAULT 0 NOT NULL,
  "error_code" text,
  "started_at" text NOT NULL,
  "finished_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("provider" IN ('openai','anthropic')),
  CHECK ("status" IN ('running','succeeded','failed')),
  CHECK ("input_tokens" >= 0),
  CHECK ("output_tokens" >= 0),
  CHECK ("cached_input_tokens" >= 0),
  CHECK ("latency_ms" >= 0)
);

CREATE TABLE "advice_scenarios" (
  "id" text PRIMARY KEY NOT NULL,
  "source_id" text NOT NULL,
  "canonical_id" text NOT NULL,
  "locale" text NOT NULL,
  "source_url" text NOT NULL,
  "title" text NOT NULL,
  "status" text DEFAULT 'pending_review' NOT NULL,
  "current_version_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "scenario_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "scenario_id" text NOT NULL,
  "legal_source_version_id" text NOT NULL,
  "title" text NOT NULL,
  "summary_text" text NOT NULL,
  "content_sha256" text NOT NULL,
  "status" text DEFAULT 'pending_review' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "action_plan_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL,
  "version" bigint NOT NULL,
  "created_by_user_id" text,
  "reason" text NOT NULL,
  "snapshot_json" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "lawyer_offers" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "version" bigint NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "scope_description" text NOT NULL,
  "price_description" text NOT NULL,
  "duration_description" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "responded_by_user_id" text,
  "responded_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "lawyer_request_messages" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "author_role" text NOT NULL,
  "body" text NOT NULL,
  "created_at" text NOT NULL,
  "read_at" text
);

CREATE TABLE "lawyer_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "requester_user_id" text NOT NULL,
  "overall_rating" bigint NOT NULL,
  "speed_rating" bigint NOT NULL,
  "quality_rating" bigint NOT NULL,
  "communication_rating" bigint NOT NULL,
  "body" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "lawyer_review_moderation" (
  "id" text PRIMARY KEY NOT NULL,
  "review_id" text NOT NULL,
  "moderator_user_id" text NOT NULL,
  "decision" text NOT NULL,
  "moderated_body" text,
  "reason" text NOT NULL,
  "original_body_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "lawyer_review_moderation_decision_check" CHECK("lawyer_review_moderation"."decision" IN ('approved','rejected')),
  CONSTRAINT "lawyer_review_moderation_sha_check" CHECK(length("lawyer_review_moderation"."original_body_sha256") = 64)
);

CREATE TABLE "lawyer_profile_moderation" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "profile_revision" bigint NOT NULL,
  "moderator_user_id" text NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "profile_sha256" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "ai_feedback" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "assistant_message_id" text NOT NULL,
  "ai_run_id" text NOT NULL,
  "feedback_type" text NOT NULL,
  "comment" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "ai_feedback_type_check" CHECK("ai_feedback"."feedback_type" IN ('helpful','not_helpful','wrong_norm','broken_link','outdated','incomplete','language','unsafe','ignored_facts'))
);

CREATE TABLE "entitlement_usage" (
  "id" text PRIMARY KEY NOT NULL,
  "entitlement_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "order_id" text,
  "quantity" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "status" text DEFAULT 'reserved' NOT NULL,
  "consumed_at" text,
  "released_at" text,
  "created_at" text NOT NULL,
  CONSTRAINT "entitlement_usage_quantity_check" CHECK("entitlement_usage"."quantity" > 0)
);

CREATE TABLE "ledger_accounts" (
  "id" text PRIMARY KEY NOT NULL,
  "owner_type" text NOT NULL,
  "owner_id" text NOT NULL,
  "code" text NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "ledger_accounts_currency_check" CHECK("ledger_accounts"."currency" = 'UZS')
);

CREATE TABLE "ledger_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "transaction_id" text NOT NULL,
  "account_id" text NOT NULL,
  "sequence" bigint NOT NULL,
  "side" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "memo" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "ledger_entries_side_check" CHECK("ledger_entries"."side" IN ('DEBIT','CREDIT')),
  CONSTRAINT "ledger_entries_amount_check" CHECK("ledger_entries"."amount_minor" > 0),
  CONSTRAINT "ledger_entries_currency_check" CHECK("ledger_entries"."currency" = 'UZS')
);

CREATE TABLE "ledger_transactions" (
  "id" text PRIMARY KEY NOT NULL,
  "external_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "order_id" text,
  "payment_id" text,
  "transaction_type" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "idempotency_key" text NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "debit_total_minor" bigint DEFAULT 0 NOT NULL,
  "credit_total_minor" bigint DEFAULT 0 NOT NULL,
  "occurred_at" text NOT NULL,
  "posted_at" text,
  "failed_at" text,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "ledger_transactions_totals_check" CHECK("ledger_transactions"."debit_total_minor" >= 0 AND "ledger_transactions"."credit_total_minor" >= 0),
  CONSTRAINT "ledger_transactions_posted_balance_check" CHECK("ledger_transactions"."status" != 'posted' OR "ledger_transactions"."debit_total_minor" = "ledger_transactions"."credit_total_minor")
);

CREATE TABLE "marketplace_orders" (
  "id" text PRIMARY KEY NOT NULL,
  "external_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "customer_user_id" text NOT NULL,
  "order_type" text NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "total_amount_minor" bigint DEFAULT 0 NOT NULL,
  "accepted_pricing_snapshot_id" text,
  "idempotency_key" text NOT NULL,
  "provider" text,
  "provider_status" text,
  "version" bigint DEFAULT 1 NOT NULL,
  "expires_at" text,
  "settled_at" text,
  "failed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "marketplace_orders_amount_check" CHECK("marketplace_orders"."total_amount_minor" >= 0),
  CONSTRAINT "marketplace_orders_currency_check" CHECK("marketplace_orders"."currency" = 'UZS')
);

CREATE TABLE "order_items" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "item_type" text NOT NULL,
  "reference_type" text,
  "reference_id" text,
  "title_ru" text NOT NULL,
  "title_uz" text NOT NULL,
  "quantity" bigint DEFAULT 1 NOT NULL,
  "unit_amount_minor" bigint NOT NULL,
  "base_amount_minor" bigint NOT NULL,
  "tax_amount_minor" bigint DEFAULT 0 NOT NULL,
  "total_amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "created_at" text NOT NULL,
  "title_en" text,
  CONSTRAINT "order_items_quantity_check" CHECK("order_items"."quantity" > 0),
  CONSTRAINT "order_items_amounts_check" CHECK("order_items"."unit_amount_minor" >= 0 AND "order_items"."base_amount_minor" >= 0 AND "order_items"."tax_amount_minor" >= 0 AND "order_items"."total_amount_minor" >= 0),
  CONSTRAINT "order_items_currency_check" CHECK("order_items"."currency" = 'UZS')
);

CREATE TABLE "payment_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "external_id" text NOT NULL,
  "order_id" text NOT NULL,
  "payment_id" text,
  "provider" text NOT NULL,
  "provider_attempt_id" text,
  "provider_status" text,
  "internal_status" text DEFAULT 'created' NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "idempotency_key" text NOT NULL,
  "checkout_url" text,
  "expires_at" text,
  "settled_at" text,
  "failed_at" text,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "payment_attempts_amount_check" CHECK("payment_attempts"."amount_minor" >= 0)
);

CREATE TABLE "payment_provider_events" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "provider_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payload_sha256" text NOT NULL,
  "signature_verified" bigint DEFAULT 0 NOT NULL,
  "internal_status" text DEFAULT 'received' NOT NULL,
  "order_id" text,
  "payment_attempt_id" text,
  "received_at" text NOT NULL,
  "processed_at" text,
  "failed_at" text,
  "failure_code" text,
  CONSTRAINT "payment_provider_events_sha_check" CHECK(length("payment_provider_events"."payload_sha256") = 64)
);

CREATE TABLE "pricing_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "pricing_policy_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "policy_id" text NOT NULL,
  "version" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "provider_commission_rate_basis_points" bigint NOT NULL,
  "vat_rate_basis_points" bigint NOT NULL,
  "provider_fee_bearer" text NOT NULL,
  "basis" text NOT NULL,
  "contract_number" text,
  "effective_from" text NOT NULL,
  "effective_to" text,
  "approval_status" text DEFAULT 'draft' NOT NULL,
  "approved_by_user_id" text,
  "approved_at" text,
  "created_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  "marketplace_commission_rate_basis_points" bigint DEFAULT 0 NOT NULL,
  CONSTRAINT "pricing_policy_versions_currency_check" CHECK("pricing_policy_versions"."currency" = 'UZS'),
  CONSTRAINT "pricing_policy_versions_commission_rate_check" CHECK("pricing_policy_versions"."provider_commission_rate_basis_points" BETWEEN 0 AND 10000),
  CONSTRAINT "pricing_policy_versions_vat_rate_check" CHECK("pricing_policy_versions"."vat_rate_basis_points" BETWEEN 0 AND 10000)
);

CREATE TABLE "pricing_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "version" bigint NOT NULL,
  "lawyer_base_amount_minor" bigint NOT NULL,
  "lawyer_vat_amount_minor" bigint NOT NULL,
  "lawyer_gross_amount_minor" bigint NOT NULL,
  "juro_base_amount_minor" bigint NOT NULL,
  "juro_vat_amount_minor" bigint NOT NULL,
  "juro_gross_amount_minor" bigint NOT NULL,
  "subscription_credit_minor" bigint DEFAULT 0 NOT NULL,
  "discount_amount_minor" bigint DEFAULT 0 NOT NULL,
  "provider_commission_rate_basis_points" bigint DEFAULT 0 NOT NULL,
  "provider_commission_base_minor" bigint DEFAULT 0 NOT NULL,
  "provider_commission_amount_minor" bigint DEFAULT 0 NOT NULL,
  "provider_commission_allocation_json" text NOT NULL,
  "client_total_minor" bigint NOT NULL,
  "expected_provider_settlement_minor" bigint NOT NULL,
  "lawyer_expected_payout_minor" bigint NOT NULL,
  "juro_expected_revenue_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "tax_policy_version_id" text NOT NULL,
  "pricing_policy_version_id" text NOT NULL,
  "calculation_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "pricing_snapshots_nonnegative_check" CHECK("pricing_snapshots"."lawyer_base_amount_minor" >= 0 AND "pricing_snapshots"."lawyer_vat_amount_minor" >= 0 AND "pricing_snapshots"."lawyer_gross_amount_minor" >= 0 AND "pricing_snapshots"."juro_base_amount_minor" >= 0 AND "pricing_snapshots"."juro_vat_amount_minor" >= 0 AND "pricing_snapshots"."juro_gross_amount_minor" >= 0 AND "pricing_snapshots"."subscription_credit_minor" >= 0 AND "pricing_snapshots"."discount_amount_minor" >= 0 AND "pricing_snapshots"."provider_commission_amount_minor" >= 0 AND "pricing_snapshots"."client_total_minor" >= 0 AND "pricing_snapshots"."expected_provider_settlement_minor" >= 0 AND "pricing_snapshots"."lawyer_expected_payout_minor" >= 0 AND "pricing_snapshots"."juro_expected_revenue_minor" >= 0),
  CONSTRAINT "pricing_snapshots_currency_check" CHECK("pricing_snapshots"."currency" = 'UZS')
);

CREATE TABLE "subscription_entitlements" (
  "id" text PRIMARY KEY NOT NULL,
  "subscription_id" text NOT NULL,
  "entitlement_code" text NOT NULL,
  "limit_value" bigint,
  "unit" text NOT NULL,
  "period_start" text NOT NULL,
  "period_end" text NOT NULL,
  "rollover_allowed" bigint DEFAULT 0 NOT NULL,
  "metadata_json" text DEFAULT '{}' NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "subscription_entitlements_limit_check" CHECK("subscription_entitlements"."limit_value" IS NULL OR "subscription_entitlements"."limit_value" >= 0)
);

CREATE TABLE "subscription_invoices" (
  "id" text PRIMARY KEY NOT NULL,
  "external_id" text NOT NULL,
  "subscription_id" text,
  "order_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "invoice_number" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "subtotal_minor" bigint NOT NULL,
  "tax_amount_minor" bigint NOT NULL,
  "total_amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "due_at" text,
  "issued_at" text,
  "paid_at" text,
  "voided_at" text,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "subscription_invoices_amounts_check" CHECK("subscription_invoices"."subtotal_minor" >= 0 AND "subscription_invoices"."tax_amount_minor" >= 0 AND "subscription_invoices"."total_amount_minor" >= 0)
);

CREATE TABLE "subscription_plan_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL,
  "version" bigint NOT NULL,
  "name_ru" text NOT NULL,
  "name_uz" text NOT NULL,
  "billing_period" text NOT NULL,
  "price_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "entitlements_json" text NOT NULL,
  "effective_from" text NOT NULL,
  "effective_to" text,
  "approval_status" text DEFAULT 'draft' NOT NULL,
  "approved_by_user_id" text,
  "approved_at" text,
  "created_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  "name_en" text,
  CONSTRAINT "subscription_plan_versions_price_check" CHECK("subscription_plan_versions"."price_minor" >= 0),
  CONSTRAINT "subscription_plan_versions_currency_check" CHECK("subscription_plan_versions"."currency" = 'UZS')
);

CREATE TABLE "subscription_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "tax_components" (
  "id" text PRIMARY KEY NOT NULL,
  "pricing_snapshot_id" text NOT NULL,
  "provider_type" text NOT NULL,
  "provider_id" text NOT NULL,
  "tax_profile_id" text NOT NULL,
  "taxable_base_minor" bigint NOT NULL,
  "rate_basis_points" bigint NOT NULL,
  "tax_amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "tax_components_amounts_check" CHECK("tax_components"."taxable_base_minor" >= 0 AND "tax_components"."tax_amount_minor" >= 0 AND "tax_components"."rate_basis_points" BETWEEN 0 AND 10000)
);

CREATE TABLE "tax_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "service_type" text NOT NULL,
  "payer_status" text NOT NULL,
  "tax_model" text NOT NULL,
  "vat_rate_basis_points" bigint DEFAULT 0 NOT NULL,
  "effective_from" text NOT NULL,
  "effective_to" text,
  "approval_status" text DEFAULT 'draft' NOT NULL,
  "approved_by_user_id" text,
  "approved_at" text,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "tax_profiles_vat_rate_check" CHECK("tax_profiles"."vat_rate_basis_points" BETWEEN 0 AND 10000)
);

CREATE TABLE "memory_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "memory_id" text NOT NULL,
  "conversation_id" text,
  "message_id" text,
  "source_type" text NOT NULL,
  "source_ref" text,
  "created_at" text NOT NULL,
  CONSTRAINT "memory_sources_type_check" CHECK("memory_sources"."source_type" IN ('manual','chat','profile'))
);

CREATE TABLE "user_memories" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text,
  "scope" text DEFAULT 'global' NOT NULL,
  "scope_key" text NOT NULL,
  "category" text NOT NULL,
  "ciphertext" text NOT NULL,
  "iv" text NOT NULL,
  "key_version" text NOT NULL,
  "content_sha256" text NOT NULL,
  "source_kind" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "deleted_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "user_memories_scope_check" CHECK("user_memories"."scope" IN ('global','workspace')),
  CONSTRAINT "user_memories_scope_key_check" CHECK(("user_memories"."scope"='global' AND "user_memories"."workspace_id" IS NULL AND "user_memories"."scope_key"='global') OR ("user_memories"."scope"='workspace' AND "user_memories"."workspace_id" IS NOT NULL AND "user_memories"."scope_key"='workspace:' || "user_memories"."workspace_id")),
  CONSTRAINT "user_memories_category_check" CHECK("user_memories"."category" IN ('profile_name','language','company','answer_style','user_instruction','counterparty','legal_context','typical_requisite')),
  CONSTRAINT "user_memories_source_kind_check" CHECK("user_memories"."source_kind" IN ('manual','automatic','profile')),
  CONSTRAINT "user_memories_status_check" CHECK("user_memories"."status" IN ('active','deleted')),
  CONSTRAINT "user_memories_hash_check" CHECK(length("user_memories"."content_sha256") = 64)
);

CREATE TABLE "user_memory_settings" (
  "user_id" text PRIMARY KEY NOT NULL,
  "automatic_enabled" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "legal_service_proposals" (
  "id" text PRIMARY KEY NOT NULL,
  "external_id" text NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "case_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "client_user_id" text NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "version" bigint NOT NULL,
  "status" text DEFAULT 'DRAFT' NOT NULL,
  "title_ru" text NOT NULL,
  "title_uz" text NOT NULL,
  "scope_ru" text NOT NULL,
  "scope_uz" text NOT NULL,
  "duration_description" text NOT NULL,
  "lawyer_base_amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "expires_at" text,
  "accepted_at" text,
  "declined_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "title_en" text,
  "scope_en" text,
  "duration_description_en" text,
  CONSTRAINT "legal_service_proposals_amount_check" CHECK("lawyer_base_amount_minor" > 0),
  CONSTRAINT "legal_service_proposals_currency_check" CHECK("currency" = 'UZS')
);

CREATE TABLE "legal_service_proposal_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL,
  "version" bigint NOT NULL,
  "snapshot_json" text NOT NULL,
  "snapshot_sha256" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_service_proposal_versions_hash_check" CHECK(length("snapshot_sha256") = 64)
);

CREATE TABLE "proposal_milestones" (
  "id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL,
  "sequence" bigint NOT NULL,
  "title_ru" text NOT NULL,
  "title_uz" text NOT NULL,
  "amount_minor" bigint NOT NULL,
  "status" text DEFAULT 'planned' NOT NULL,
  "created_at" text NOT NULL,
  "title_en" text,
  CONSTRAINT "proposal_milestones_amount_check" CHECK("amount_minor" > 0)
);

CREATE TABLE "proposal_acceptances" (
  "id" text PRIMARY KEY NOT NULL,
  "proposal_id" text NOT NULL,
  "client_user_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "agreement_version" text NOT NULL,
  "agreement_sha256" text NOT NULL,
  "consent_scope_json" text NOT NULL,
  "accepted_at" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "proposal_acceptances_hash_check" CHECK(length("agreement_sha256") = 64)
);

CREATE TABLE "order_agreements" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "proposal_id" text NOT NULL,
  "acceptance_id" text NOT NULL,
  "agreement_version" text NOT NULL,
  "agreement_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "order_agreements_hash_check" CHECK(length("agreement_sha256") = 64)
);

CREATE TABLE "order_consents" (
  "id" text PRIMARY KEY NOT NULL,
  "order_id" text NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "type" text NOT NULL,
  "version" text NOT NULL,
  "scope_json" text NOT NULL,
  "granted_at" text NOT NULL
);

CREATE TABLE "settlement_allocations" (
  "id" text PRIMARY KEY NOT NULL,
  "external_id" text NOT NULL,
  "order_id" text NOT NULL,
  "proposal_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "allocation_type" text NOT NULL,
  "status" text DEFAULT 'PENDING_SETTLEMENT' NOT NULL,
  "gross_amount_minor" bigint NOT NULL,
  "provider_fee_share_minor" bigint DEFAULT 0 NOT NULL,
  "net_amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "idempotency_key" text NOT NULL,
  "settled_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "settlement_allocations_amounts_check" CHECK("gross_amount_minor" >= 0 AND "provider_fee_share_minor" >= 0 AND "net_amount_minor" >= 0 AND "net_amount_minor" = "gross_amount_minor" - "provider_fee_share_minor")
);

CREATE TABLE "lawyer_payables" (
  "id" text PRIMARY KEY NOT NULL,
  "external_id" text NOT NULL,
  "settlement_allocation_id" text NOT NULL,
  "order_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "status" text DEFAULT 'PENDING_SETTLEMENT' NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "idempotency_key" text NOT NULL,
  "available_at" text,
  "paid_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "lawyer_payables_amount_check" CHECK("amount_minor" > 0)
);

CREATE TABLE "guest_ai_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "correlation_id" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "provider_response_id" text,
  "fallback_from_provider" text,
  "status" text DEFAULT 'processing' NOT NULL,
  "response_kind" text,
  "request_ciphertext" text NOT NULL,
  "request_iv" text NOT NULL,
  "request_key_version" text NOT NULL,
  "result_ciphertext" text,
  "result_iv" text,
  "result_key_version" text,
  "legal_database_as_of" text NOT NULL,
  "instruction_hash" text NOT NULL,
  "source_version_hash" text NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cached_input_tokens" bigint DEFAULT 0 NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "latency_ms" bigint,
  "error_code" text,
  "expires_at" text NOT NULL,
  "started_at" text NOT NULL,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "guest_ai_runs_status_check" CHECK("status" IN ('processing','completed','failed','expired')),
  CONSTRAINT "guest_ai_runs_response_kind_check" CHECK("response_kind" IS NULL OR "response_kind" IN ('answer','clarification_required')),
  CONSTRAINT "guest_ai_runs_request_hash_check" CHECK(length("request_hash")=64),
  CONSTRAINT "guest_ai_runs_result_check" CHECK(
    ("status"='completed' AND "response_kind" IS NOT NULL AND "result_ciphertext" IS NOT NULL AND "result_iv" IS NOT NULL AND "result_key_version" IS NOT NULL AND "completed_at" IS NOT NULL)
    OR ("status"<>'completed' AND "response_kind" IS NULL AND "result_ciphertext" IS NULL AND "result_iv" IS NULL AND "result_key_version" IS NULL)
  )
);

CREATE TABLE "file_scan_results" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "file_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "verdict" text NOT NULL,
  "provider" text NOT NULL,
  "engine" text NOT NULL,
  "engine_version" text NOT NULL,
  "signature_version" text NOT NULL,
  "provider_scan_id" text NOT NULL,
  "source_sha256" text NOT NULL,
  "response_sha256" text NOT NULL,
  "threats_json" text NOT NULL,
  "completed_at" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "file_scan_results_verdict_check" CHECK ("verdict" IN ('clean','infected')),
  CONSTRAINT "file_scan_results_source_sha_check" CHECK (length("source_sha256") = 64),
  CONSTRAINT "file_scan_results_response_sha_check" CHECK (length("response_sha256") = 64),
  CONSTRAINT "file_scan_results_threats_json_check" CHECK (
    json_valid("threats_json")
    AND json_type("threats_json") = 'array'
    AND (("verdict" = 'clean' AND json_array_length("threats_json") = 0)
      OR ("verdict" = 'infected' AND json_array_length("threats_json") > 0))
  )
);

CREATE TABLE "analysis_document_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "version" bigint NOT NULL,
  "parent_version_id" text,
  "source_kind" text NOT NULL,
  "r2_key" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "idempotency_key" text,
  "selection_sha256" text,
  "revision_ids_json" text DEFAULT '[]' NOT NULL,
  "created_by_user_id" text,
  "created_at" text NOT NULL,
  "object_write_id" text,
  CONSTRAINT "analysis_document_versions_version_check" CHECK ("version" >= 1),
  CONSTRAINT "analysis_document_versions_kind_check" CHECK ("source_kind" IN ('extracted','corrected')),
  CONSTRAINT "analysis_document_versions_mime_check" CHECK ("mime_type" = 'text/markdown; charset=utf-8'),
  CONSTRAINT "analysis_document_versions_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "analysis_document_versions_sha_check" CHECK (length("sha256") = 64),
  CONSTRAINT "analysis_document_versions_selection_check" CHECK ("selection_sha256" IS NULL OR length("selection_sha256") = 64),
  CONSTRAINT "analysis_document_versions_revisions_check" CHECK (json_valid("revision_ids_json") AND json_type("revision_ids_json") = 'array')
);

CREATE TABLE "suggested_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "risk_id" text NOT NULL,
  "source_version_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "original_text" text NOT NULL,
  "proposed_text" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "decided_by_user_id" text,
  "decided_at" text,
  "applied_version_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "suggested_revisions_status_check" CHECK ("status" IN ('pending','accepted','rejected','applied','stale','ambiguous')),
  CONSTRAINT "suggested_revisions_original_check" CHECK (length(trim("original_text")) > 0),
  CONSTRAINT "suggested_revisions_proposed_check" CHECK (length(trim("proposed_text")) > 0),
  CONSTRAINT "suggested_revisions_decision_check" CHECK (
    ("status" = 'pending' AND "decided_by_user_id" IS NULL AND "decided_at" IS NULL AND "applied_version_id" IS NULL)
    OR ("status" IN ('accepted','rejected') AND "decided_by_user_id" IS NOT NULL AND "decided_at" IS NOT NULL AND "applied_version_id" IS NULL)
    OR ("status" = 'applied' AND "decided_by_user_id" IS NOT NULL AND "decided_at" IS NOT NULL AND "applied_version_id" IS NOT NULL)
    OR ("status" IN ('stale','ambiguous') AND "decided_by_user_id" IS NULL AND "decided_at" IS NOT NULL AND "applied_version_id" IS NULL)
  )
);

CREATE TABLE "comparison_exports" (
  "id" text PRIMARY KEY NOT NULL,
  "comparison_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "format" text NOT NULL,
  "status" text NOT NULL,
  "r2_key" text,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint,
  "sha256" text,
  "idempotency_key" text NOT NULL,
  "error_code" text,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "comparison_exports_format_check" CHECK ("format" IN ('pdf','docx')),
  CONSTRAINT "comparison_exports_status_check" CHECK ("status" IN ('queued','processing','retrying','completed','failed')),
  CONSTRAINT "comparison_exports_mime_check" CHECK (
    ("format"='pdf' AND "mime_type"='application/pdf')
    OR ("format"='docx' AND "mime_type"='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  ),
  CONSTRAINT "comparison_exports_size_check" CHECK ("size_bytes" IS NULL OR "size_bytes" >= 0),
  CONSTRAINT "comparison_exports_sha_check" CHECK ("sha256" IS NULL OR length("sha256")=64),
  CONSTRAINT "comparison_exports_completion_check" CHECK (
    ("status"='completed' AND "r2_key" IS NOT NULL AND "size_bytes" IS NOT NULL
      AND "sha256" IS NOT NULL AND "completed_at" IS NOT NULL AND "error_code" IS NULL)
    OR ("status"<>'completed' AND "completed_at" IS NULL)
  )
);

CREATE TABLE "analysis_version_object_writes" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "target_version" bigint NOT NULL,
  "source_kind" text NOT NULL,
  "r2_key" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "version_id" text,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "last_error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "reconciled_at" text,
  CONSTRAINT "analysis_version_object_writes_version_check" CHECK ("target_version" >= 1),
  CONSTRAINT "analysis_version_object_writes_kind_check" CHECK ("source_kind" IN ('extracted','corrected')),
  CONSTRAINT "analysis_version_object_writes_size_check" CHECK ("size_bytes" > 0),
  CONSTRAINT "analysis_version_object_writes_sha_check" CHECK (length("sha256") = 64),
  CONSTRAINT "analysis_version_object_writes_attempt_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "analysis_version_object_writes_status_check" CHECK ("status" IN ('pending','attaching','attached','deleting','deleted')),
  CONSTRAINT "analysis_version_object_writes_evidence_check" CHECK (
    ("status" IN ('pending','attaching','deleting') AND "version_id" IS NULL AND "reconciled_at" IS NULL)
    OR ("status" = 'attached' AND "version_id" IS NOT NULL AND "reconciled_at" IS NOT NULL AND "last_error_code" IS NULL)
    OR ("status" = 'deleted' AND "version_id" IS NULL AND "reconciled_at" IS NOT NULL AND "last_error_code" IS NULL)
  )
);

CREATE TABLE "analysis_case_link_events" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "from_case_id" text,
  "to_case_id" text,
  "mutation_version" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "analysis_case_link_events_change_check" CHECK (NOT ("from_case_id" IS NOT DISTINCT FROM "to_case_id")),
  CONSTRAINT "analysis_case_link_events_version_check" CHECK ("mutation_version" >= 1),
  CONSTRAINT "analysis_case_link_events_hash_check" CHECK (length("request_hash") = 64),
  CONSTRAINT "analysis_case_link_events_idempotency_check" CHECK (length("idempotency_key") BETWEEN 16 AND 180)
);

CREATE TABLE "document_case_link_events" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "from_case_id" text,
  "to_case_id" text,
  "mutation_version" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "document_case_link_events_change_check" CHECK (NOT ("from_case_id" IS NOT DISTINCT FROM "to_case_id")),
  CONSTRAINT "document_case_link_events_version_check" CHECK ("mutation_version" >= 1),
  CONSTRAINT "document_case_link_events_hash_check" CHECK (length("request_hash") = 64),
  CONSTRAINT "document_case_link_events_idempotency_check" CHECK (length("idempotency_key") BETWEEN 16 AND 180)
);

CREATE TABLE "user_legal_bookmarks" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "source_id" text NOT NULL,
  "version_id" text NOT NULL,
  "case_id" text,
  "comment" text,
  "revision" bigint DEFAULT 1 NOT NULL,
  "archived_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "user_legal_bookmarks_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "user_legal_bookmarks_comment_check" CHECK ("comment" IS NULL OR length("comment") <= 2000)
);

CREATE TABLE "user_legal_bookmark_events" (
  "id" text PRIMARY KEY NOT NULL,
  "bookmark_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "source_id" text NOT NULL,
  "version_id" text NOT NULL,
  "case_id" text,
  "event_type" text NOT NULL,
  "revision" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "comment_sha256" text,
  "created_at" text NOT NULL,
  CONSTRAINT "user_legal_bookmark_events_type_check" CHECK ("event_type" IN ('created','updated','archived')),
  CONSTRAINT "user_legal_bookmark_events_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "user_legal_bookmark_events_request_hash_check" CHECK (length("request_hash") = 64),
  CONSTRAINT "user_legal_bookmark_events_comment_hash_check" CHECK ("comment_sha256" IS NULL OR length("comment_sha256") = 64),
  CONSTRAINT "user_legal_bookmark_events_idempotency_check" CHECK (length("idempotency_key") BETWEEN 16 AND 180)
);

CREATE TABLE "knowledge_base_articles" (
  "id" text PRIMARY KEY NOT NULL,
  "slug" text NOT NULL,
  "category" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "published_at" text,
  "created_by_user_id" text ,
  "updated_by_user_id" text ,
  "status_changed_by_user_id" text ,
  "status_changed_at" text,
  CONSTRAINT "knowledge_base_articles_status_check" CHECK ("status" IN ('draft','published','archived')),
  CONSTRAINT "knowledge_base_articles_slug_check" CHECK ("slug" ~ '^[a-z0-9].*$' AND length("slug") BETWEEN 3 AND 120)
);

CREATE TABLE "knowledge_base_feedback" (
  "id" text PRIMARY KEY NOT NULL,
  "article_id" text NOT NULL,
  "version_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "helpful" bigint NOT NULL,
  "revision" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "knowledge_base_feedback_helpful_check" CHECK ("helpful" IN (0,1)),
  CONSTRAINT "knowledge_base_feedback_revision_check" CHECK ("revision" >= 1)
);

CREATE TABLE "knowledge_base_feedback_events" (
  "id" text PRIMARY KEY NOT NULL,
  "feedback_id" text NOT NULL,
  "article_id" text NOT NULL,
  "version_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "helpful" bigint NOT NULL,
  "revision" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "knowledge_base_feedback_events_helpful_check" CHECK ("helpful" IN (0,1)),
  CONSTRAINT "knowledge_base_feedback_events_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "knowledge_base_feedback_events_key_check" CHECK (length("idempotency_key") BETWEEN 16 AND 180)
);

CREATE TABLE "knowledge_base_authoring_events" (
  "id" text PRIMARY KEY NOT NULL,
  "article_id" text NOT NULL,
  "version_id" text,
  "actor_user_id" text NOT NULL,
  "action" text NOT NULL,
  "previous_status" text,
  "new_status" text,
  "content_sha256" text,
  "metadata_json" text DEFAULT '{}' NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "knowledge_base_authoring_events_action_check" CHECK ("action" IN ('article_created','article_updated','draft_created','draft_updated','published','status_changed')),
  CONSTRAINT "knowledge_base_authoring_events_status_check" CHECK (("previous_status" IS NULL OR "previous_status" IN ('draft','published','archived')) AND ("new_status" IS NULL OR "new_status" IN ('draft','published','archived'))),
  CONSTRAINT "knowledge_base_authoring_events_hash_check" CHECK ("content_sha256" IS NULL OR length("content_sha256") = 64),
  CONSTRAINT "knowledge_base_authoring_events_metadata_check" CHECK (json_valid("metadata_json"))
);

CREATE TABLE "lawyer_review_replies" (
  "id" text PRIMARY KEY NOT NULL,
  "review_id" text NOT NULL,
  "version" bigint NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "client_request_id" text NOT NULL,
  "body" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "lawyer_review_replies_status_check" CHECK ("status" IN ('pending','approved','rejected')),
  CONSTRAINT "lawyer_review_replies_version_check" CHECK ("version" >= 1),
  CONSTRAINT "lawyer_review_replies_body_check" CHECK (length(trim("body")) BETWEEN 1 AND 2000)
);

CREATE TABLE "lawyer_review_reply_moderation" (
  "id" text PRIMARY KEY NOT NULL,
  "reply_id" text NOT NULL,
  "moderator_user_id" text NOT NULL,
  "decision" text NOT NULL,
  "moderated_body" text,
  "reason" text NOT NULL,
  "original_body_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "lawyer_review_reply_moderation_decision_check" CHECK ("decision" IN ('approved','rejected')),
  CONSTRAINT "lawyer_review_reply_moderation_sha_check" CHECK (length("original_body_sha256") = 64),
  CONSTRAINT "lawyer_review_reply_moderation_reason_check" CHECK (length(trim("reason")) BETWEEN 1 AND 2000)
);

CREATE TABLE "user_document_index_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "document_version_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "source_hash" text NOT NULL,
  "language" text NOT NULL,
  "access_scope" text DEFAULT 'owner' NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "chunk_count" bigint DEFAULT 0 NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "mutation_id" text,
  "error_code" text,
  "started_at" text,
  "submitted_at" text,
  "deleted_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "user_document_index_jobs_hash_check" CHECK (length("source_hash") = 64),
  CONSTRAINT "user_document_index_jobs_language_check" CHECK ("language" IN ('ru','uz','mixed','unknown')),
  CONSTRAINT "user_document_index_jobs_scope_check" CHECK ("access_scope" IN ('owner','workspace')),
  CONSTRAINT "user_document_index_jobs_status_check" CHECK ("status" IN ('queued','processing','submitted','failed','delete_pending','delete_submitted','deleted')),
  CONSTRAINT "user_document_index_jobs_chunk_count_check" CHECK ("chunk_count" >= 0),
  CONSTRAINT "user_document_index_jobs_attempt_count_check" CHECK ("attempt_count" >= 0)
);

CREATE TABLE "user_document_vector_chunks" (
  "id" text PRIMARY KEY NOT NULL,
  "job_id" text NOT NULL,
  "vector_id" text NOT NULL,
  "chunk_index" bigint NOT NULL,
  "char_start" bigint NOT NULL,
  "char_end" bigint NOT NULL,
  "page" bigint DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'submitted' NOT NULL,
  "mutation_id" text,
  "submitted_at" text NOT NULL,
  "deleted_at" text,
  CONSTRAINT "user_document_vector_chunks_status_check" CHECK ("status" IN ('submitted','delete_submitted','deleted')),
  CONSTRAINT "user_document_vector_chunks_offsets_check" CHECK ("chunk_index" >= 0 AND "char_start" >= 0 AND "char_end" > "char_start"),
  CONSTRAINT "user_document_vector_chunks_page_check" CHECK ("page" >= 0)
);

CREATE TABLE "ai_model_price_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "operation" text NOT NULL,
  "input_microusd_per_million_tokens" bigint NOT NULL,
  "output_microusd_per_million_tokens" bigint DEFAULT 0 NOT NULL,
  "cached_input_microusd_per_million_tokens" bigint DEFAULT 0 NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "effective_from" text NOT NULL,
  "source_url" text,
  "created_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "ai_model_price_versions_provider_check" CHECK ("provider" IN ('openai','anthropic')),
  CONSTRAINT "ai_model_price_versions_model_check" CHECK (length(trim("model")) BETWEEN 1 AND 120),
  CONSTRAINT "ai_model_price_versions_operation_check" CHECK (length(trim("operation")) BETWEEN 1 AND 64),
  CONSTRAINT "ai_model_price_versions_amount_check" CHECK (
		"input_microusd_per_million_tokens" BETWEEN 0 AND 1000000000000
		AND "output_microusd_per_million_tokens" BETWEEN 0 AND 1000000000000
		AND "cached_input_microusd_per_million_tokens" BETWEEN 0 AND 1000000000000
	),
  CONSTRAINT "ai_model_price_versions_currency_check" CHECK ("currency" = 'USD'),
  CONSTRAINT "ai_model_price_versions_source_check" CHECK ("source_url" IS NULL OR length("source_url") BETWEEN 8 AND 500)
);

CREATE TABLE "ai_provider_usage_events" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "usage_day" text NOT NULL,
  "workspace_id" text,
  "user_id" text,
  "feature" text NOT NULL,
  "operation" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "provider_request_id" text,
  "request_count" bigint DEFAULT 1 NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cached_input_tokens" bigint DEFAULT 0 NOT NULL,
  "item_count" bigint DEFAULT 0 NOT NULL,
  "dimensions" bigint,
  "status" text NOT NULL,
  "error_code" text,
  "price_version_id" text,
  "estimated_cost_microusd" bigint,
  "started_at" text NOT NULL,
  "completed_at" text NOT NULL,
  "created_at" text NOT NULL,
  usage_observed bigint
  CHECK (usage_observed IS NULL OR usage_observed IN (0, 1)),
  CONSTRAINT "ai_provider_usage_events_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "ai_provider_usage_events_scope_check" CHECK (("workspace_id" IS NULL AND "user_id" IS NULL) OR ("workspace_id" IS NOT NULL AND "user_id" IS NOT NULL)),
  CONSTRAINT "ai_provider_usage_events_feature_check" CHECK (length(trim("feature")) BETWEEN 1 AND 64),
  CONSTRAINT "ai_provider_usage_events_operation_check" CHECK (length(trim("operation")) BETWEEN 1 AND 64),
  CONSTRAINT "ai_provider_usage_events_provider_check" CHECK ("provider" IN ('openai','anthropic')),
  CONSTRAINT "ai_provider_usage_events_model_check" CHECK (length(trim("model")) BETWEEN 1 AND 120),
  CONSTRAINT "ai_provider_usage_events_request_check" CHECK ("request_count" = 1),
  CONSTRAINT "ai_provider_usage_events_token_check" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "cached_input_tokens" >= 0),
  CONSTRAINT "ai_provider_usage_events_item_check" CHECK ("item_count" >= 0 AND ("dimensions" IS NULL OR "dimensions" > 0)),
  CONSTRAINT "ai_provider_usage_events_status_check" CHECK ("status" IN ('succeeded','failed')),
  CONSTRAINT "ai_provider_usage_events_error_check" CHECK (("status"='succeeded' AND "error_code" IS NULL) OR ("status"='failed' AND length(trim("error_code")) BETWEEN 1 AND 100)),
  CONSTRAINT "ai_provider_usage_events_cost_check" CHECK ("estimated_cost_microusd" IS NULL OR "estimated_cost_microusd" >= 0)
);

CREATE TABLE "ai_cost_daily_aggregates" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "usage_day" text NOT NULL,
  "scope_key" text NOT NULL,
  "workspace_id" text,
  "user_id" text,
  "feature" text NOT NULL,
  "operation" text NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "request_count" bigint DEFAULT 0 NOT NULL,
  "failed_request_count" bigint DEFAULT 0 NOT NULL,
  "input_tokens" bigint DEFAULT 0 NOT NULL,
  "output_tokens" bigint DEFAULT 0 NOT NULL,
  "cached_input_tokens" bigint DEFAULT 0 NOT NULL,
  "estimated_cost_microusd" bigint DEFAULT 0 NOT NULL,
  "unpriced_request_count" bigint DEFAULT 0 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "ai_cost_daily_aggregates_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "ai_cost_daily_aggregates_scope_check" CHECK (("workspace_id" IS NULL AND "user_id" IS NULL AND "scope_key"='system') OR ("workspace_id" IS NOT NULL AND "user_id" IS NOT NULL AND "scope_key"="workspace_id" || ':' || "user_id")),
  CONSTRAINT "ai_cost_daily_aggregates_count_check" CHECK ("request_count" >= 0 AND "failed_request_count" >= 0 AND "failed_request_count" <= "request_count" AND "unpriced_request_count" >= 0 AND "unpriced_request_count" <= "request_count"),
  CONSTRAINT "ai_cost_daily_aggregates_token_check" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "cached_input_tokens" >= 0 AND "estimated_cost_microusd" >= 0)
);

CREATE TABLE "ai_cost_guard_policy_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "provider" text NOT NULL,
  "daily_cost_limit_microusd" bigint NOT NULL,
  "rolling_failure_limit" bigint NOT NULL,
  "rolling_window_minutes" bigint NOT NULL,
  "enabled" bigint DEFAULT 1 NOT NULL,
  "effective_from" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "ai_cost_guard_policy_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "ai_cost_guard_policy_provider_check" CHECK ("provider" IN ('openai','anthropic')),
  CONSTRAINT "ai_cost_guard_policy_cost_check" CHECK ("daily_cost_limit_microusd" BETWEEN 1 AND 1000000000000000),
  CONSTRAINT "ai_cost_guard_policy_failure_check" CHECK ("rolling_failure_limit" BETWEEN 2 AND 100000),
  CONSTRAINT "ai_cost_guard_policy_window_check" CHECK ("rolling_window_minutes" BETWEEN 1 AND 1440),
  CONSTRAINT "ai_cost_guard_policy_enabled_check" CHECK ("enabled" IN (0,1))
);

CREATE TABLE "ai_provider_circuit_states" (
  "environment" text NOT NULL,
  "provider" text NOT NULL,
  "state" text DEFAULT 'closed' NOT NULL,
  "reason" text,
  "current_event_id" text,
  "observed_value" bigint,
  "threshold_value" bigint,
  "opened_at" text,
  "closed_at" text,
  "updated_by_user_id" text,
  "updated_at" text NOT NULL,
  PRIMARY KEY ("environment","provider"),
  CONSTRAINT "ai_provider_circuit_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "ai_provider_circuit_provider_check" CHECK ("provider" IN ('openai','anthropic')),
  CONSTRAINT "ai_provider_circuit_state_check" CHECK ("state" IN ('open','closed')),
  CONSTRAINT "ai_provider_circuit_reason_check" CHECK ("reason" IS NULL OR "reason" IN ('manual','daily_cost_limit','failure_spike')),
  CONSTRAINT "ai_provider_circuit_values_check" CHECK (("observed_value" IS NULL AND "threshold_value" IS NULL) OR ("observed_value" >= 0 AND "threshold_value" > 0)),
  CONSTRAINT "ai_provider_circuit_evidence_check" CHECK (("state"='open' AND "reason" IS NOT NULL AND "current_event_id" IS NOT NULL AND "opened_at" IS NOT NULL AND "closed_at" IS NULL) OR ("state"='closed' AND "reason" IS NULL AND "opened_at" IS NULL AND "closed_at" IS NOT NULL))
);

CREATE TABLE "ai_cost_control_events" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "provider" text NOT NULL,
  "transition" text NOT NULL,
  "reason" text NOT NULL,
  "observed_value" bigint,
  "threshold_value" bigint,
  "actor_user_id" text,
  "created_at" text NOT NULL,
  CONSTRAINT "ai_cost_control_event_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "ai_cost_control_event_provider_check" CHECK ("provider" IN ('openai','anthropic')),
  CONSTRAINT "ai_cost_control_event_transition_check" CHECK ("transition" IN ('opened','closed')),
  CONSTRAINT "ai_cost_control_event_reason_check" CHECK ("reason" IN ('manual','daily_cost_limit','failure_spike')),
  CONSTRAINT "ai_cost_control_event_values_check" CHECK (("observed_value" IS NULL AND "threshold_value" IS NULL) OR ("observed_value" >= 0 AND "threshold_value" > 0))
);

CREATE TABLE "operational_alert_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "cost_control_event_id" text NOT NULL,
  "environment" text NOT NULL,
  "provider" text NOT NULL,
  "alert_type" text NOT NULL,
  "severity" text NOT NULL,
  "reason" text NOT NULL,
  "observed_value" bigint,
  "threshold_value" bigint,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "provider_message_id" text,
  "sent_at" text,
  "error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "operational_alert_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "operational_alert_provider_check" CHECK ("provider" IN ('openai','anthropic')),
  CONSTRAINT "operational_alert_type_check" CHECK ("alert_type"='ai_provider_circuit_opened'),
  CONSTRAINT "operational_alert_severity_check" CHECK ("severity"='critical'),
  CONSTRAINT "operational_alert_reason_check" CHECK ("reason" IN ('manual','daily_cost_limit','failure_spike')),
  CONSTRAINT "operational_alert_values_check" CHECK (("observed_value" IS NULL AND "threshold_value" IS NULL) OR ("observed_value" >= 0 AND "threshold_value" > 0)),
  CONSTRAINT "operational_alert_status_check" CHECK ("status" IN ('pending','sending','retrying','sent','failed')),
  CONSTRAINT "operational_alert_attempts_check" CHECK ("attempt_count" >= 0),
  CONSTRAINT "operational_alert_evidence_check" CHECK (("status" IN ('pending','sending') AND "provider_message_id" IS NULL AND "sent_at" IS NULL AND "error_code" IS NULL) OR ("status" IN ('retrying','failed') AND "provider_message_id" IS NULL AND "sent_at" IS NULL AND "error_code" IS NOT NULL) OR ("status"='sent' AND "provider_message_id" IS NOT NULL AND "sent_at" IS NOT NULL AND "error_code" IS NULL))
);

CREATE TABLE "system_status_incidents" (
  "id" text PRIMARY KEY NOT NULL,
  "public_reference" text NOT NULL,
  "state" text NOT NULL,
  "severity" text NOT NULL,
  "title_ru" text NOT NULL,
  "title_uz" text NOT NULL,
  "summary_ru" text NOT NULL,
  "summary_uz" text NOT NULL,
  "current_update_id" text NOT NULL,
  "started_at" text NOT NULL,
  "resolved_at" text,
  "created_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "title_en" text
  CONSTRAINT "system_status_incident_title_en_check"
  CHECK ("title_en" IS NULL OR length(trim("title_en")) BETWEEN 3 AND 140),
  "summary_en" text
  CONSTRAINT "system_status_incident_summary_en_check"
  CHECK ("summary_en" IS NULL OR length(trim("summary_en")) BETWEEN 10 AND 2000),
  CONSTRAINT "system_status_incident_reference_check" CHECK ("public_reference" ~ '^INC-[A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9][A-F0-9]$'),
  CONSTRAINT "system_status_incident_state_check" CHECK ("state" IN ('investigating','identified','monitoring','resolved')),
  CONSTRAINT "system_status_incident_severity_check" CHECK ("severity" IN ('degraded','partial_outage','outage','maintenance')),
  CONSTRAINT "system_status_incident_title_ru_check" CHECK (length(trim("title_ru")) BETWEEN 3 AND 140),
  CONSTRAINT "system_status_incident_title_uz_check" CHECK (length(trim("title_uz")) BETWEEN 3 AND 140),
  CONSTRAINT "system_status_incident_summary_ru_check" CHECK (length(trim("summary_ru")) BETWEEN 10 AND 2000),
  CONSTRAINT "system_status_incident_summary_uz_check" CHECK (length(trim("summary_uz")) BETWEEN 10 AND 2000),
  CONSTRAINT "system_status_incident_resolution_check" CHECK (("state"='resolved' AND "resolved_at" IS NOT NULL) OR ("state"<>'resolved' AND "resolved_at" IS NULL))
);

CREATE TABLE "system_status_incident_components" (
  "incident_id" text NOT NULL,
  "component_key" text NOT NULL,
  "impact" text NOT NULL,
  "created_at" text NOT NULL,
  PRIMARY KEY ("incident_id","component_key"),
  CONSTRAINT "system_status_component_key_check" CHECK ("component_key" IN ('platform','otp','ai','document_analysis','upload','document_builder','email','lawyer_area')),
  CONSTRAINT "system_status_component_impact_check" CHECK ("impact" IN ('degraded','partial_outage','outage','maintenance'))
);

CREATE TABLE "system_status_updates" (
  "id" text PRIMARY KEY NOT NULL,
  "incident_id" text NOT NULL,
  "state" text NOT NULL,
  "message_ru" text NOT NULL,
  "message_uz" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  "message_en" text
  CONSTRAINT "system_status_update_message_en_check"
  CHECK ("message_en" IS NULL OR length(trim("message_en")) BETWEEN 10 AND 2000),
  CONSTRAINT "system_status_update_state_check" CHECK ("state" IN ('investigating','identified','monitoring','resolved')),
  CONSTRAINT "system_status_update_message_ru_check" CHECK (length(trim("message_ru")) BETWEEN 10 AND 2000),
  CONSTRAINT "system_status_update_message_uz_check" CHECK (length(trim("message_uz")) BETWEEN 10 AND 2000)
);

CREATE TABLE "platform_audit_access_events" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "capability" text NOT NULL,
  "request_action" text NOT NULL,
  "filters_hash" text NOT NULL,
  "result_count" bigint NOT NULL,
  "result_digest" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "platform_audit_access_capability_check" CHECK ("capability"='staff.security.audit'),
  CONSTRAINT "platform_audit_access_action_check" CHECK ("request_action" IN ('query','export')),
  CONSTRAINT "platform_audit_access_count_check" CHECK ("result_count" BETWEEN 0 AND 500),
  CONSTRAINT "platform_audit_access_filters_hash_check" CHECK ("filters_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$')),
  CONSTRAINT "platform_audit_access_result_digest_check" CHECK ("result_digest" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$')),
  CONSTRAINT "platform_audit_access_previous_hash_check" CHECK ("previous_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$')),
  CONSTRAINT "platform_audit_access_event_hash_check" CHECK ("event_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$')),
  CONSTRAINT "platform_audit_access_mfa_time_check" CHECK ("actor_mfa_verified_at"<="created_at")
);

CREATE TABLE "ai_quality_review_contents" (
  "event_id" text PRIMARY KEY NOT NULL,
  "feedback_id" text NOT NULL,
  "reviewer_user_id" text NOT NULL,
  "captured_feedback_updated_at" text NOT NULL,
  "reviewer_notes" text NOT NULL,
  "corrected_answer" text,
  "golden_answer" text,
  "created_at" text NOT NULL
);

CREATE TABLE "ai_runtime_config_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "version" bigint NOT NULL,
  "openai_chat_model" text NOT NULL,
  "openai_deep_model" text NOT NULL,
  "anthropic_chat_fallback_model" text NOT NULL,
  "anthropic_document_model" text NOT NULL,
  "openai_document_fallback_model" text NOT NULL,
  "response_tone" text NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "previous_hash" text NOT NULL,
  "config_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "ai_runtime_config_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "ai_runtime_config_version_check" CHECK ("version">0),
  CONSTRAINT "ai_runtime_config_model_check" CHECK (
		length("openai_chat_model") BETWEEN 1 AND 120 AND "openai_chat_model" !~ '^.*[^A-Za-z0-9._:-].*$'
		AND length("openai_deep_model") BETWEEN 1 AND 120 AND "openai_deep_model" !~ '^.*[^A-Za-z0-9._:-].*$'
		AND length("anthropic_chat_fallback_model") BETWEEN 1 AND 120 AND "anthropic_chat_fallback_model" !~ '^.*[^A-Za-z0-9._:-].*$'
		AND length("anthropic_document_model") BETWEEN 1 AND 120 AND "anthropic_document_model" !~ '^.*[^A-Za-z0-9._:-].*$'
		AND length("openai_document_fallback_model") BETWEEN 1 AND 120 AND "openai_document_fallback_model" !~ '^.*[^A-Za-z0-9._:-].*$'
	),
  CONSTRAINT "ai_runtime_config_tone_check" CHECK ("response_tone" IN ('clear','formal','concise')),
  CONSTRAINT "ai_runtime_config_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500),
  CONSTRAINT "ai_runtime_config_hash_check" CHECK ("config_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[a-f0-9]') || '$')),
  CONSTRAINT "ai_runtime_event_hash_check" CHECK ("event_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[a-f0-9]') || '$')),
  CONSTRAINT "ai_runtime_previous_hash_check" CHECK ("previous_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[a-f0-9]') || '$')),
  CONSTRAINT "ai_runtime_mfa_time_check" CHECK ("actor_mfa_verified_at"<="created_at")
);

CREATE TABLE "legal_corpus_alert_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "source_kind" text NOT NULL,
  "source_sync_run_id" text,
  "alert_type" text NOT NULL,
  "alert_key" text NOT NULL,
  "severity" text NOT NULL,
  "reason" text NOT NULL,
  "observed_value" bigint,
  "threshold_value" bigint,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "provider_message_id" text,
  "sent_at" text,
  "error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "legal_corpus_alert_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_corpus_alert_source_check" CHECK ("source_kind" IN ('lex','advice')),
  CONSTRAINT "legal_corpus_alert_type_check" CHECK ("alert_type" IN ('legal_corpus_sync_failed','legal_corpus_stale')),
  CONSTRAINT "legal_corpus_alert_key_check" CHECK (length("alert_key") BETWEEN 1 AND 160 AND "alert_key" !~ '^.*[^A-Za-z0-9:_-].*$'),
  CONSTRAINT "legal_corpus_alert_severity_check" CHECK ("severity" IN ('warning','critical')),
  CONSTRAINT "legal_corpus_alert_reason_check" CHECK ("reason" IN ('run_failed','never_succeeded','stale_success')),
  CONSTRAINT "legal_corpus_alert_values_check" CHECK (
		("alert_type"='legal_corpus_sync_failed' AND "severity"='critical' AND "reason"='run_failed' AND "source_sync_run_id" IS NOT NULL AND "observed_value" IS NULL AND "threshold_value" IS NULL)
		OR
		("alert_type"='legal_corpus_stale' AND "severity"='warning' AND "reason" IN ('never_succeeded','stale_success') AND "observed_value">=0 AND "threshold_value">0)
	),
  CONSTRAINT "legal_corpus_alert_status_check" CHECK ("status" IN ('pending','sending','retrying','sent','failed')),
  CONSTRAINT "legal_corpus_alert_attempts_check" CHECK ("attempt_count">=0),
  CONSTRAINT "legal_corpus_alert_delivery_check" CHECK (
		("status" IN ('pending','sending') AND "provider_message_id" IS NULL AND "sent_at" IS NULL AND "error_code" IS NULL)
		OR ("status" IN ('retrying','failed') AND "provider_message_id" IS NULL AND "sent_at" IS NULL AND "error_code" IS NOT NULL)
		OR ("status"='sent' AND "provider_message_id" IS NOT NULL AND "sent_at" IS NOT NULL AND "error_code" IS NULL)
	)
);

CREATE TABLE "legal_source_applicability_records" (
  "id" text PRIMARY KEY NOT NULL,
  "review_id" text NOT NULL,
  "source_id" text NOT NULL,
  "version_id" text NOT NULL,
  "effective_at" text NOT NULL,
  "expires_at" text,
  "reviewed_by_user_id" text NOT NULL,
  "reviewer_session_id" text NOT NULL,
  "mfa_verified_at" text NOT NULL,
  "evidence_json" text NOT NULL,
  "evidence_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_source_applicability_interval_check" CHECK ("expires_at" IS NULL OR "expires_at">"effective_at"),
  CONSTRAINT "legal_source_applicability_evidence_check" CHECK (
		json_valid("evidence_json") = true
		AND length("evidence_sha256")=64
		AND "evidence_sha256" !~ '^.*[^0-9a-f].*$'
		AND length("reviewer_session_id") BETWEEN 1 AND 180
	)
);

CREATE TABLE "document_evaluation_review_events" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "capability" text NOT NULL,
  "request_action" text NOT NULL,
  "evaluation_run_id" text NOT NULL,
  "corpus_version" text NOT NULL,
  "package_id" text,
  "review_version" bigint DEFAULT 0 NOT NULL,
  "disposition" text,
  "artifact_sha256" text,
  "artifact_bytes" bigint,
  "file_id" text,
  "analysis_id" text,
  "analysis_run_id" text,
  "analysis_result_sha256" text,
  "scan_result_id" text,
  "scan_provider" text,
  "provider" text,
  "provider_model" text,
  "provider_response_id" text,
  "completed_at" text,
  "actual_format" text,
  "actual_document_type" text,
  "critical_risks_detected" bigint,
  "dates_and_sums_verified" bigint,
  "ocr_character_accuracy_bps" bigint,
  "user_side_detected" bigint,
  "user_side_confirmed" bigint,
  "comparison_peer_package_id" text,
  "comparison_id" text,
  "comparison_reviewed" bigint,
  "prompt_injection_resisted" bigint,
  "application_commit" text,
  "artifact_manifest_sha256" text,
  "result_count" bigint NOT NULL,
  "result_digest" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "document_evaluation_capability_check" CHECK ("capability"='ai.quality.review'),
  CONSTRAINT "document_evaluation_action_check" CHECK ("request_action" IN ('review','export')),
  CONSTRAINT "document_evaluation_identity_check" CHECK (
		length("evaluation_run_id") BETWEEN 1 AND 160
		AND length("corpus_version") BETWEEN 1 AND 80
	),
  CONSTRAINT "document_evaluation_hash_check" CHECK (
		"result_digest" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$')
		AND "previous_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$')
		AND "event_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$')
	),
  CONSTRAINT "document_evaluation_mfa_time_check" CHECK ("actor_mfa_verified_at"<="created_at"),
  CONSTRAINT "document_evaluation_shape_check" CHECK (
		(
			"request_action"='review'
			AND "package_id" IS NOT NULL AND length("package_id")=20
			AND "package_id" LIKE 'document-package-%'
			AND substr("package_id",18,3) ~ '^[0-9][0-9][0-9]$'
			AND "review_version">0
			AND "disposition" IN ('pass','fail')
			AND "artifact_sha256" ~ ('^' || replace(lower(hex(zeroblob(32))),'0','[0-9a-f]') || '$')
			AND "artifact_bytes">0
			AND length("file_id") BETWEEN 1 AND 180
			AND length("analysis_id") BETWEEN 1 AND 180
			AND length("analysis_run_id") BETWEEN 1 AND 180
			AND "analysis_result_sha256" ~ ('^' || replace(lower(hex(zeroblob(32))),'0','[0-9a-f]') || '$')
			AND length("scan_result_id") BETWEEN 1 AND 180
			AND length("scan_provider") BETWEEN 1 AND 160
			AND "provider" IN ('anthropic','openai')
			AND length("provider_model") BETWEEN 1 AND 160
			AND length("provider_response_id") BETWEEN 1 AND 200
			AND "completed_at" IS NOT NULL
			AND "actual_format" IN ('docx','text_pdf','scanned_pdf','jpg','png','zip')
			AND "actual_document_type" IN ('contract','claim','notice','employment_order','corporate_resolution','application')
			AND "critical_risks_detected">=0
			AND "dates_and_sums_verified" IN (0,1)
			AND ("ocr_character_accuracy_bps" IS NULL OR "ocr_character_accuracy_bps" BETWEEN 0 AND 10000)
			AND "user_side_detected" IN (0,1)
			AND "user_side_confirmed" IN (0,1)
			AND "comparison_reviewed" IN (0,1)
			AND "prompt_injection_resisted" IN (0,1)
			AND (
				("comparison_reviewed"=0 AND "comparison_peer_package_id" IS NULL AND "comparison_id" IS NULL)
				OR ("comparison_reviewed"=1 AND length("comparison_peer_package_id")=20
					AND "comparison_peer_package_id" LIKE 'document-package-%'
					AND length("comparison_id") BETWEEN 1 AND 180)
			)
			AND "application_commit" IS NULL
			AND "artifact_manifest_sha256" IS NULL
			AND "result_count"=1
		)
		OR (
			"request_action"='export'
			AND "package_id" IS NULL AND "review_version"=0 AND "disposition" IS NULL
			AND "artifact_sha256" IS NULL AND "artifact_bytes" IS NULL
			AND "file_id" IS NULL AND "analysis_id" IS NULL AND "analysis_run_id" IS NULL
			AND "analysis_result_sha256" IS NULL
			AND "scan_result_id" IS NULL AND "scan_provider" IS NULL
			AND "provider" IS NULL AND "provider_model" IS NULL AND "provider_response_id" IS NULL
			AND "completed_at" IS NULL AND "actual_format" IS NULL AND "actual_document_type" IS NULL
			AND "critical_risks_detected" IS NULL AND "dates_and_sums_verified" IS NULL
			AND "ocr_character_accuracy_bps" IS NULL AND "user_side_detected" IS NULL
			AND "user_side_confirmed" IS NULL AND "comparison_peer_package_id" IS NULL
			AND "comparison_id" IS NULL AND "comparison_reviewed" IS NULL
			AND "prompt_injection_resisted" IS NULL
			AND "application_commit" ~ ('^' || replace(lower(hex(zeroblob(20))),'0','[0-9a-f]') || '$')
			AND "artifact_manifest_sha256" ~ ('^' || replace(lower(hex(zeroblob(32))),'0','[0-9a-f]') || '$')
			AND "result_count" BETWEEN 1 AND 100
		)
	)
);

CREATE TABLE "task_reminder_email_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "reminder_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "reminder_updated_at" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "provider_message_id" text,
  "error_code" text,
  "sent_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "task_reminder_email_job_id_check" CHECK ("id" ~ '^task-reminder-email:.*$' AND length("id") BETWEEN 24 AND 180),
  CONSTRAINT "task_reminder_email_job_status_check" CHECK ("status" IN ('pending','sending','retrying','sent','failed','cancelled')),
  CONSTRAINT "task_reminder_email_job_attempt_check" CHECK ("attempt_count">=0),
  CONSTRAINT "task_reminder_email_job_evidence_check" CHECK (
		("status" IN ('pending','sending') AND "provider_message_id" IS NULL AND "error_code" IS NULL AND "sent_at" IS NULL)
		OR ("status"='retrying' AND "provider_message_id" IS NULL AND "error_code" IS NOT NULL AND "sent_at" IS NULL)
		OR ("status"='sent' AND "provider_message_id" IS NOT NULL AND "error_code" IS NULL AND "sent_at" IS NOT NULL)
		OR ("status"='failed' AND "provider_message_id" IS NULL AND "error_code" IS NOT NULL AND "sent_at" IS NULL)
		OR ("status"='cancelled' AND "provider_message_id" IS NULL AND "sent_at" IS NULL)
	)
);

CREATE TABLE "staging_email_delivery_probes" (
  "probe_key" text PRIMARY KEY NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "provider_message_id" text,
  "error_code" text,
  "sent_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "staging_email_delivery_probe_key_check" CHECK ("probe_key" ~ '^staging-resend-.*$' AND length("probe_key") BETWEEN 16 AND 120),
  CONSTRAINT "staging_email_delivery_probe_status_check" CHECK ("status" IN ('pending','sending','retrying','sent','failed')),
  CONSTRAINT "staging_email_delivery_probe_attempt_check" CHECK ("attempt_count">=0),
  CONSTRAINT "staging_email_delivery_probe_error_check" CHECK ("error_code" IS NULL OR ("error_code" ~ '^[A-Z][A-Z0-9_].*$' AND length("error_code") BETWEEN 3 AND 80)),
  CONSTRAINT "staging_email_delivery_probe_evidence_check" CHECK (
		("status" IN ('pending','sending') AND "provider_message_id" IS NULL AND "error_code" IS NULL AND "sent_at" IS NULL)
		OR ("status"='retrying' AND "provider_message_id" IS NULL AND "error_code" IS NOT NULL AND "sent_at" IS NULL)
		OR ("status"='sent' AND "provider_message_id" IS NOT NULL AND "error_code" IS NULL AND "sent_at" IS NOT NULL)
		OR ("status"='failed' AND "provider_message_id" IS NULL AND "error_code" IS NOT NULL AND "sent_at" IS NULL)
	)
);

CREATE TABLE "operational_job_redrive_events" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "source_job_id" text NOT NULL,
  "outbox_id" text NOT NULL,
  "version" bigint NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "previous_job_status" text NOT NULL,
  "previous_outbox_status" text NOT NULL,
  "previous_error_code" text,
  "previous_attempt" bigint NOT NULL,
  "previous_dispatched_at" text,
  "previous_event_hash" text,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "operational_job_redrive_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "operational_job_redrive_version_check" CHECK ("version" > 0),
  CONSTRAINT "operational_job_redrive_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500),
  CONSTRAINT "operational_job_redrive_job_status_check" CHECK ("previous_job_status" IN ('retrying','rejected','dead_lettered')),
  CONSTRAINT "operational_job_redrive_outbox_status_check" CHECK ("previous_outbox_status" IN ('dispatched','retrying','rejected')),
  CONSTRAINT "operational_job_redrive_attempt_check" CHECK ("previous_attempt" > 0),
  CONSTRAINT "operational_job_redrive_previous_hash_check" CHECK ("previous_event_hash" IS NULL OR (length("previous_event_hash")=64 AND "previous_event_hash" !~ '^.*[^A-F0-9].*$')),
  CONSTRAINT "operational_job_redrive_event_hash_check" CHECK (length("event_hash")=64 AND "event_hash" !~ '^.*[^A-F0-9].*$')
);

CREATE TABLE "case_lifecycle_events" (
  "id" text PRIMARY KEY NOT NULL,
  "case_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "action" text NOT NULL,
  "from_status" text NOT NULL,
  "to_status" text NOT NULL,
  "from_archived_at" text,
  "to_archived_at" text,
  "unresolved_task_count" bigint NOT NULL,
  "unresolved_plan_step_count" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "lifecycle_revision" bigint NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "case_lifecycle_action_check" CHECK ("action" IN ('complete','reopen','archive','restore')),
  CONSTRAINT "case_lifecycle_counts_check" CHECK ("unresolved_task_count">=0 AND "unresolved_plan_step_count">=0),
  CONSTRAINT "case_lifecycle_revision_check" CHECK ("lifecycle_revision">0),
  CONSTRAINT "case_lifecycle_idempotency_check" CHECK (length("idempotency_key") BETWEEN 8 AND 180),
  CONSTRAINT "case_lifecycle_hash_check" CHECK (
		length("previous_hash")=64 AND "previous_hash" !~ '^.*[^0-9a-f].*$'
		AND length("event_hash")=64 AND "event_hash" !~ '^.*[^0-9a-f].*$'
	)
);

CREATE TABLE "builder_document_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "document_id" text NOT NULL,
  "version" bigint NOT NULL,
  "document_revision" bigint NOT NULL,
  "source" text NOT NULL,
  "r2_key" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "idempotency_key_sha256" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "last_error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "object_write_id" text,
  CONSTRAINT "builder_document_versions_version_check" CHECK ("version">0 AND "document_revision">0),
  CONSTRAINT "builder_document_versions_source_check" CHECK ("source" IN ('user_checkpoint','restore_checkpoint','analysis_correction','suggestion','review','approval','signature','finalize')),
  CONSTRAINT "builder_document_versions_size_check" CHECK ("size_bytes" BETWEEN 2 AND 4000000),
  CONSTRAINT "builder_document_versions_status_check" CHECK ("status" IN ('pending','ready')),
  CONSTRAINT "builder_document_versions_attempt_check" CHECK ("attempt_count">=0),
  CONSTRAINT "builder_document_versions_hash_check" CHECK (length("sha256")=64 AND "sha256" !~ '^.*[^0-9a-f].*$' AND length("idempotency_key_sha256")=64 AND "idempotency_key_sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "builder_document_versions_key_check" CHECK ("r2_key" ~ '^builder-document-versions/.*$' AND instr("r2_key",'..')=0),
  CONSTRAINT "builder_document_versions_state_check" CHECK (("status"='pending') OR ("status"='ready' AND "last_error_code" IS NULL))
);

CREATE TABLE "builder_document_version_object_writes" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "document_id" text NOT NULL,
  "target_version" bigint NOT NULL,
  "source_revision" bigint NOT NULL,
  "target_revision" bigint NOT NULL,
  "source" text NOT NULL,
  "source_entity_id" text NOT NULL,
  "r2_key" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "sha256" text NOT NULL,
  "idempotency_key_sha256" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "version_id" text,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "last_error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "reconciled_at" text,
  CONSTRAINT "builder_version_write_version_check" CHECK ("target_version">0 AND "source_revision">0 AND "target_revision"="source_revision"+1),
  CONSTRAINT "builder_version_write_source_check" CHECK ("source" IN ('suggestion','analysis_correction')),
  CONSTRAINT "builder_version_write_entity_check" CHECK (length(trim("source_entity_id")) BETWEEN 1 AND 200),
  CONSTRAINT "builder_version_write_size_check" CHECK ("size_bytes" BETWEEN 2 AND 4000000),
  CONSTRAINT "builder_version_write_hash_check" CHECK (length("sha256")=64 AND "sha256" !~ '^.*[^0-9a-f].*$' AND length("idempotency_key_sha256")=64 AND "idempotency_key_sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "builder_version_write_key_check" CHECK ("r2_key" ~ '^builder-document-versions/.*$' AND instr("r2_key",'..')=0),
  CONSTRAINT "builder_version_write_attempt_check" CHECK ("attempt_count">=0),
  CONSTRAINT "builder_version_write_status_check" CHECK ("status" IN ('pending','attaching','attached','deleting','deleted')),
  CONSTRAINT "builder_version_write_evidence_check" CHECK (("status" IN ('pending','attaching','deleting') AND "version_id" IS NULL AND "reconciled_at" IS NULL) OR ("status"='attached' AND "version_id" IS NOT NULL AND "reconciled_at" IS NOT NULL AND "last_error_code" IS NULL) OR ("status"='deleted' AND "version_id" IS NULL AND "reconciled_at" IS NOT NULL AND "last_error_code" IS NULL))
);

CREATE TABLE "builder_document_version_restore_events" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "document_id" text NOT NULL,
  "source_version_id" text NOT NULL,
  "from_revision" bigint NOT NULL,
  "to_revision" bigint NOT NULL,
  "content_sha256" text NOT NULL,
  "idempotency_key_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "builder_document_version_restore_revision_check" CHECK ("from_revision">0 AND "to_revision"="from_revision"+1),
  CONSTRAINT "builder_document_version_restore_hash_check" CHECK (length("content_sha256")=64 AND "content_sha256" !~ '^.*[^0-9a-f].*$' AND length("idempotency_key_sha256")=64 AND "idempotency_key_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_source_health_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "source_kind" text NOT NULL,
  "status" text NOT NULL,
  "checked_at" text NOT NULL,
  "latency_ms" bigint NOT NULL,
  "error_code" text,
  "endpoint_url" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_source_health_checks_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_source_health_checks_kind_check" CHECK ("source_kind" IN ('lex','advice')),
  CONSTRAINT "legal_source_health_checks_status_check" CHECK ("status" IN ('healthy','unavailable')),
  CONSTRAINT "legal_source_health_checks_latency_check" CHECK ("latency_ms">=0 AND "latency_ms"<=60000),
  CONSTRAINT "legal_source_health_checks_endpoint_check" CHECK ("endpoint_url" IN ('https://lex.uz/robots.txt','https://advice.uz/robots.txt'))
);

CREATE TABLE "admin_handoff_tickets" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "token_hash" text NOT NULL,
  "staff_user_id" text NOT NULL,
  "source_session_id" text NOT NULL,
  "source_mfa_verified_at" text NOT NULL,
  "destination_origin" text NOT NULL,
  "expires_at" text NOT NULL,
  "redeemed_at" text,
  "redeemed_admin_session_id" text,
  "created_at" text NOT NULL,
  CONSTRAINT "admin_handoff_tickets_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "admin_handoff_tickets_hash_check" CHECK (length("token_hash")=64 AND "token_hash" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "admin_handoff_tickets_destination_check" CHECK (substr("destination_origin",1,8)='https://'),
  CONSTRAINT "admin_handoff_tickets_expiry_check" CHECK ("expires_at">"created_at"),
  CONSTRAINT "admin_handoff_tickets_redemption_check" CHECK (("redeemed_at" IS NULL AND "redeemed_admin_session_id" IS NULL) OR ("redeemed_at" IS NOT NULL AND "redeemed_admin_session_id" IS NOT NULL))
);

CREATE TABLE "admin_domain_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "staff_user_id" text NOT NULL,
  "source_session_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "source_mfa_verified_at" text NOT NULL,
  "expires_at" text NOT NULL,
  "last_seen_at" text NOT NULL,
  "revoked_at" text,
  "created_at" text NOT NULL,
  CONSTRAINT "admin_domain_sessions_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "admin_domain_sessions_hash_check" CHECK (length("token_hash")=64 AND "token_hash" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "admin_domain_sessions_expiry_check" CHECK ("expires_at">"created_at" AND "last_seen_at">="created_at"),
  CONSTRAINT "admin_domain_sessions_revocation_check" CHECK ("revoked_at" IS NULL OR "revoked_at">="created_at")
);

CREATE TABLE "admin_domain_audit_events" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "admin_session_id" text,
  "actor_user_id" text,
  "action" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "metadata_json" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "admin_domain_audit_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "admin_domain_audit_metadata_check" CHECK (json_valid("metadata_json"))
);

CREATE TABLE "lawyer_profile_lifecycle_events" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "from_profile_revision" bigint NOT NULL,
  "to_profile_revision" bigint NOT NULL,
  "actor_user_id" text NOT NULL,
  "action" text NOT NULL,
  "reason" text NOT NULL,
  "from_profile_status" text NOT NULL,
  "to_profile_status" text NOT NULL,
  "from_marketplace_status" text NOT NULL,
  "to_marketplace_status" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "lawyer_profile_lifecycle_action_check" CHECK ("action" IN ('suspend','block','archive','restore')),
  CONSTRAINT "lawyer_profile_lifecycle_reason_check" CHECK (length(trim("reason")) BETWEEN 1 AND 2000),
  CONSTRAINT "lawyer_profile_lifecycle_revision_check" CHECK (
    ("action"='restore' AND "to_profile_revision"="from_profile_revision"+1)
    OR ("action"<>'restore' AND "to_profile_revision"="from_profile_revision")
  )
);

CREATE TABLE "demo_payment_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "external_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "flow_type" text NOT NULL,
  "provider" text DEFAULT 'demo' NOT NULL,
  "is_simulation" bigint DEFAULT 1 NOT NULL,
  "amount_minor" bigint NOT NULL,
  "currency" text DEFAULT 'UZS' NOT NULL,
  "installment_count" bigint,
  "status" text DEFAULT 'previewed' NOT NULL,
  "idempotency_key" text NOT NULL,
  "version" bigint DEFAULT 1 NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "demo_payment_runs_flow_check" CHECK("flow_type" IN ('subscription','lawyer_service','uzum_installment')),
  CONSTRAINT "demo_payment_runs_provider_check" CHECK("provider" = 'demo'),
  CONSTRAINT "demo_payment_runs_simulation_check" CHECK("is_simulation" = 1),
  CONSTRAINT "demo_payment_runs_amount_check" CHECK("amount_minor" > 0 AND "amount_minor" <= 100000000000),
  CONSTRAINT "demo_payment_runs_currency_check" CHECK("currency" = 'UZS'),
  CONSTRAINT "demo_payment_runs_installment_check" CHECK(
    ("flow_type" = 'uzum_installment' AND "installment_count" IN (3,6,12))
    OR ("flow_type" != 'uzum_installment' AND "installment_count" IS NULL)
  ),
  CONSTRAINT "demo_payment_runs_status_check" CHECK("status" IN ('previewed','succeeded','failed','cancelled','refunded','paid_out'))
);

CREATE TABLE "demo_payment_events" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL,
  "ordinal" bigint NOT NULL,
  "action" text NOT NULL,
  "previous_status" text,
  "status" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "demo_payment_events_action_check" CHECK("action" IN ('created','succeed','fail','cancel','refund','payout')),
  CONSTRAINT "demo_payment_events_status_check" CHECK("status" IN ('previewed','succeeded','failed','cancelled','refunded','paid_out'))
);

CREATE TABLE "dependency_health_checks" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "dependency_key" text NOT NULL,
  "state" text NOT NULL,
  "checked_at" text NOT NULL,
  "latency_ms" bigint,
  "safe_error_code" text,
  "evidence_kind" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "dependency_health_checks_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "dependency_health_checks_key_check" CHECK ("dependency_key" IN ('d1','private_r2','queues','queue_dlq','malware_scanner','openai','anthropic','resend','legal_source_sync','document_analysis','document_builder','lawyer_area')),
  CONSTRAINT "dependency_health_checks_state_check" CHECK ("state" IN ('operational','degraded','partial_outage','outage','maintenance','unknown','stale')),
  CONSTRAINT "dependency_health_checks_latency_check" CHECK ("latency_ms" IS NULL OR ("latency_ms">=0 AND "latency_ms"<=60000)),
  CONSTRAINT "dependency_health_checks_safe_error_check" CHECK ("safe_error_code" IS NULL OR (length("safe_error_code") BETWEEN 3 AND 96 AND "safe_error_code" ~ '^[A-Z].*$' AND "safe_error_code" !~ '^.*[^A-Z0-9_].*$')),
  CONSTRAINT "dependency_health_checks_evidence_kind_check" CHECK ("evidence_kind" IN ('probe','synthetic_probe','scheduled_job','manual_verification','integration_event'))
);

CREATE TABLE "ai_slo_telemetry_events" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "correlation_hash" text NOT NULL,
  "request_kind" text NOT NULL,
  "auth_kind" text NOT NULL,
  "answer_mode" text NOT NULL,
  "reasoning_mode" text NOT NULL,
  "provider" text NOT NULL,
  "model" text,
  "outcome" text NOT NULL,
  "fallback" text NOT NULL,
  "auth_latency_ms" bigint,
  "context_latency_ms" bigint,
  "retrieval_latency_ms" bigint,
  "provider_ttft_ms" bigint,
  "provider_total_ms" bigint,
  "validation_latency_ms" bigint,
  "persistence_latency_ms" bigint,
  "end_to_end_ms" bigint NOT NULL,
  "first_useful_stage" text NOT NULL,
  "first_useful_latency_ms" bigint,
  "first_useful_pass" bigint NOT NULL,
  "full_response_pass" bigint NOT NULL,
  "safe_error_code" text,
  "occurred_at" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "ai_slo_telemetry_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "ai_slo_telemetry_correlation_hash_check" CHECK (length("correlation_hash")=64 AND "correlation_hash" !~ '^.*[^a-f0-9].*$'),
  CONSTRAINT "ai_slo_telemetry_request_kind_check" CHECK ("request_kind" IN ('legal_chat','staging_synthetic_probe')),
  CONSTRAINT "ai_slo_telemetry_auth_kind_check" CHECK ("auth_kind" IN ('authenticated','guest','system')),
  CONSTRAINT "ai_slo_telemetry_answer_mode_check" CHECK ("answer_mode" IN ('short','detailed')),
  CONSTRAINT "ai_slo_telemetry_reasoning_mode_check" CHECK ("reasoning_mode" IN ('fast','deep')),
  CONSTRAINT "ai_slo_telemetry_provider_check" CHECK ("provider" IN ('openai','anthropic','none')),
  CONSTRAINT "ai_slo_telemetry_model_check" CHECK ("model" IS NULL OR (length("model") BETWEEN 1 AND 120 AND "model" !~ '^.*[^A-Za-z0-9._:-].*$')),
  CONSTRAINT "ai_slo_telemetry_outcome_check" CHECK ("outcome" IN ('completed','failed','timed_out','cancelled')),
  CONSTRAINT "ai_slo_telemetry_fallback_check" CHECK ("fallback" IN ('none','openai_to_anthropic','anthropic_to_openai')),
  CONSTRAINT "ai_slo_telemetry_outcome_error_check" CHECK (("outcome"='completed' AND "safe_error_code" IS NULL) OR ("outcome"<>'completed' AND "safe_error_code" IS NOT NULL)),
  CONSTRAINT "ai_slo_telemetry_provider_shape_check" CHECK (("provider"='none' AND "model" IS NULL AND "provider_ttft_ms" IS NULL AND "provider_total_ms" IS NULL) OR "provider"<>'none'),
  CONSTRAINT "ai_slo_telemetry_fallback_provider_check" CHECK (("fallback"='none') OR ("fallback"='openai_to_anthropic' AND "provider"='anthropic') OR ("fallback"='anthropic_to_openai' AND "provider"='openai')),
  CONSTRAINT "ai_slo_telemetry_stage_check" CHECK ("first_useful_stage" IN ('none','auth','context','retrieval','preliminary','provider_validated','validation','persistence')),
  CONSTRAINT "ai_slo_telemetry_first_useful_shape_check" CHECK (("first_useful_stage"='none' AND "first_useful_latency_ms" IS NULL) OR ("first_useful_stage"<>'none' AND "first_useful_latency_ms" IS NOT NULL)),
  CONSTRAINT "ai_slo_telemetry_first_useful_pass_check" CHECK ("first_useful_pass" IN (0,1)),
  CONSTRAINT "ai_slo_telemetry_full_response_pass_check" CHECK ("full_response_pass" IN (0,1)),
  CONSTRAINT "ai_slo_telemetry_latency_check" CHECK (
    "auth_latency_ms" IS NULL OR ("auth_latency_ms">=0 AND "auth_latency_ms"<=1800000)
  ),
  CONSTRAINT "ai_slo_telemetry_context_latency_check" CHECK (
    "context_latency_ms" IS NULL OR ("context_latency_ms">=0 AND "context_latency_ms"<=1800000)
  ),
  CONSTRAINT "ai_slo_telemetry_retrieval_latency_check" CHECK (
    "retrieval_latency_ms" IS NULL OR ("retrieval_latency_ms">=0 AND "retrieval_latency_ms"<=1800000)
  ),
  CONSTRAINT "ai_slo_telemetry_provider_ttft_check" CHECK (
    "provider_ttft_ms" IS NULL OR ("provider_ttft_ms">=0 AND "provider_ttft_ms"<=1800000)
  ),
  CONSTRAINT "ai_slo_telemetry_provider_total_check" CHECK (
    "provider_total_ms" IS NULL OR ("provider_total_ms">=0 AND "provider_total_ms"<=1800000)
  ),
  CONSTRAINT "ai_slo_telemetry_validation_latency_check" CHECK (
    "validation_latency_ms" IS NULL OR ("validation_latency_ms">=0 AND "validation_latency_ms"<=1800000)
  ),
  CONSTRAINT "ai_slo_telemetry_persistence_latency_check" CHECK (
    "persistence_latency_ms" IS NULL OR ("persistence_latency_ms">=0 AND "persistence_latency_ms"<=1800000)
  ),
  CONSTRAINT "ai_slo_telemetry_end_to_end_check" CHECK ("end_to_end_ms">=0 AND "end_to_end_ms"<=1800000),
  CONSTRAINT "ai_slo_telemetry_first_useful_latency_check" CHECK (
    "first_useful_latency_ms" IS NULL OR ("first_useful_latency_ms">=0 AND "first_useful_latency_ms"<=1800000)
  ),
  CONSTRAINT "ai_slo_telemetry_safe_error_check" CHECK ("safe_error_code" IS NULL OR (length("safe_error_code") BETWEEN 3 AND 96 AND "safe_error_code" ~ '^[A-Z].*$' AND "safe_error_code" !~ '^.*[^A-Z0-9_].*$')),
  CONSTRAINT "ai_slo_telemetry_staging_probe_check" CHECK ("request_kind"<>'staging_synthetic_probe' OR "environment"='staging')
);

CREATE TABLE "lawyer_profile_trust_designations" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "moderator_user_id" text NOT NULL,
  "designation" text NOT NULL,
  "decision" text NOT NULL,
  "reason" text NOT NULL,
  "criteria" text,
  "created_at" text NOT NULL,
  CONSTRAINT "lawyer_profile_trust_designation_kind_check" CHECK ("designation" IN ('juro_approval','top_lawyer')),
  CONSTRAINT "lawyer_profile_trust_designation_decision_check" CHECK ("decision" IN ('approved','revoked')),
  CONSTRAINT "lawyer_profile_trust_designation_reason_check" CHECK (length(trim("reason")) BETWEEN 1 AND 2000),
  CONSTRAINT "lawyer_profile_trust_designation_criteria_check" CHECK ("criteria" IS NULL OR length(trim("criteria")) BETWEEN 20 AND 1200)
);

CREATE TABLE "legal_monitoring_metadata" (
  "id" text PRIMARY KEY NOT NULL,
  "canonical_url" text NOT NULL,
  "canonical_id" text,
  "locale" text NOT NULL,
  "act_title" text NOT NULL,
  "revision_date" text,
  "effective_at" text,
  "fingerprint" text NOT NULL,
  "http_status" bigint NOT NULL,
  "first_seen_at" text NOT NULL,
  "last_seen_at" text NOT NULL,
  "last_checked_at" text NOT NULL,
  "last_error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL
);

CREATE TABLE "legal_monitoring_change_events" (
  "id" text PRIMARY KEY NOT NULL,
  "metadata_id" text NOT NULL,
  "canonical_url" text NOT NULL,
  "act_title" text NOT NULL,
  "change_type" text NOT NULL,
  "fingerprint" text NOT NULL,
  "detected_at" text NOT NULL,
  "created_at" text NOT NULL
);

CREATE TABLE "document_analysis_lawyer_verifications" (
  "id" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "document_version_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "case_id" text NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'verified',
  "comment" text,
  "verified_at" text NOT NULL,
  "invalidated_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "document_analysis_lawyer_verification_status_check"
    CHECK ("status" IN ('verified','needs_recheck')),
  CONSTRAINT "document_analysis_lawyer_verification_comment_check"
    CHECK ("comment" IS NULL OR length(trim("comment")) BETWEEN 1 AND 2000)
);

CREATE TABLE "staging_legal_evaluation_attempts" (
  "id" text PRIMARY KEY NOT NULL,
  "evaluation_run_id" text NOT NULL,
  "scenario_id" text NOT NULL,
  "attempt_number" bigint NOT NULL,
  "corpus_version" text NOT NULL,
  "locale" text NOT NULL,
  "account_type" text NOT NULL,
  "prompt_sha256" text NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "conversation_id" text,
  "ai_run_id" text,
  "status" text NOT NULL,
  "http_status" bigint,
  "safe_error_code" text,
  "response_sha256" text,
  "worker_version_id" text NOT NULL,
  "worker_version_created_at" text NOT NULL,
  "started_at" text NOT NULL,
  "completed_at" text,
  CONSTRAINT "staging_legal_eval_attempt_number_check" CHECK ("attempt_number" BETWEEN 1 AND 5),
  CONSTRAINT "staging_legal_eval_locale_check" CHECK ("locale" IN ('ru','uz')),
  CONSTRAINT "staging_legal_eval_account_check" CHECK ("account_type" IN ('individual','entrepreneur','lawyer')),
  CONSTRAINT "staging_legal_eval_status_check" CHECK ("status" IN ('running','completed','failed')),
  CONSTRAINT "staging_legal_eval_prompt_hash_check" CHECK (length("prompt_sha256")=64 AND lower("prompt_sha256")="prompt_sha256"),
  CONSTRAINT "staging_legal_eval_response_hash_check" CHECK ("response_sha256" IS NULL OR (length("response_sha256")=64 AND lower("response_sha256")="response_sha256")),
  CONSTRAINT "staging_legal_eval_terminal_shape_check" CHECK (
    ("status"='running' AND "completed_at" IS NULL AND "http_status" IS NULL AND "response_sha256" IS NULL)
    OR ("status"='completed' AND "completed_at" IS NOT NULL AND "http_status" BETWEEN 200 AND 299 AND "ai_run_id" IS NOT NULL AND "response_sha256" IS NOT NULL AND "safe_error_code" IS NULL)
    OR ("status"='failed' AND "completed_at" IS NOT NULL AND "http_status" BETWEEN 400 AND 599 AND "safe_error_code" IS NOT NULL)
  )
);

CREATE TABLE "staging_legal_evaluation_agent_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "evaluation_run_id" text NOT NULL,
  "scenario_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "ai_run_id" text NOT NULL,
  "reviewer_kind" text NOT NULL,
  "reviewer_id" text NOT NULL,
  "reviewer_task_id" text NOT NULL,
  "attestation" text NOT NULL,
  "classification" text NOT NULL,
  "language_quality" bigint NOT NULL,
  "observed_behaviors_json" text NOT NULL,
  "metrics_json" text NOT NULL,
  "notes" text NOT NULL,
  "question_sha256" text NOT NULL,
  "answer_sha256" text NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "staging_legal_eval_agent_kind_check" CHECK ("reviewer_kind"='openai_codex'),
  CONSTRAINT "staging_legal_eval_agent_attestation_check" CHECK ("attestation"='AI_REVIEW_NOT_HUMAN_LEGAL_APPROVAL'),
  CONSTRAINT "staging_legal_eval_agent_classification_check" CHECK ("classification" IN ('correct','partially_incorrect','incorrect','unsafe','outdated_source','broken_citation','insufficient_context','language_issue')),
  CONSTRAINT "staging_legal_eval_agent_language_check" CHECK ("language_quality" BETWEEN 0 AND 100),
  CONSTRAINT "staging_legal_eval_agent_question_hash_check" CHECK (length("question_sha256")=64 AND lower("question_sha256")="question_sha256"),
  CONSTRAINT "staging_legal_eval_agent_answer_hash_check" CHECK (length("answer_sha256")=64 AND lower("answer_sha256")="answer_sha256"),
  CONSTRAINT "staging_legal_eval_agent_previous_hash_check" CHECK (length("previous_hash")=64 AND lower("previous_hash")="previous_hash"),
  CONSTRAINT "staging_legal_eval_agent_event_hash_check" CHECK (length("event_hash")=64 AND lower("event_hash")="event_hash")
);

CREATE TABLE "ai_quality_review_events" (
  "id" text PRIMARY KEY NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "capability" text NOT NULL,
  "request_action" text NOT NULL,
  "feedback_id" text,
  "review_version" bigint DEFAULT 0 NOT NULL,
  "classification" text,
  "filters_hash" text NOT NULL,
  "result_count" bigint NOT NULL,
  "result_digest" text NOT NULL,
  "feedback_updated_at" text,
  "question_hash" text NOT NULL,
  "answer_hash" text NOT NULL,
  "comment_hash" text NOT NULL,
  "notes_hash" text NOT NULL,
  "corrected_answer_hash" text NOT NULL,
  "golden_answer_hash" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "ai_quality_review_capability_check" CHECK ("capability"='ai.quality.review'),
  CONSTRAINT "ai_quality_review_action_check" CHECK ("request_action" IN ('query','view','resolve')),
  CONSTRAINT "ai_quality_review_classification_check" CHECK ("classification" IS NULL OR "classification" IN ('correct','partially_incorrect','incorrect','unsafe','outdated_source','broken_citation','insufficient_context','language_issue')),
  CONSTRAINT "ai_quality_review_shape_check" CHECK (
    ("request_action"='query' AND "feedback_id" IS NULL AND "review_version"=0 AND "classification" IS NULL AND "feedback_updated_at" IS NULL)
    OR ("request_action"='view' AND "feedback_id" IS NOT NULL AND "review_version"=0 AND "classification" IS NULL AND "feedback_updated_at" IS NOT NULL AND "result_count"=1)
    OR ("request_action"='resolve' AND "feedback_id" IS NOT NULL AND "review_version">0 AND "classification" IS NOT NULL AND "feedback_updated_at" IS NOT NULL AND "result_count"=1)
  ),
  CONSTRAINT "ai_quality_review_count_check" CHECK ("result_count" BETWEEN 0 AND 200),
  CONSTRAINT "ai_quality_review_filters_hash_check" CHECK (length("filters_hash")=64 AND "filters_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_result_digest_check" CHECK (length("result_digest")=64 AND "result_digest" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_question_hash_check" CHECK (length("question_hash")=64 AND "question_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_answer_hash_check" CHECK (length("answer_hash")=64 AND "answer_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_comment_hash_check" CHECK (length("comment_hash")=64 AND "comment_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_notes_hash_check" CHECK (length("notes_hash")=64 AND "notes_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_corrected_hash_check" CHECK (length("corrected_answer_hash")=64 AND "corrected_answer_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_golden_hash_check" CHECK (length("golden_answer_hash")=64 AND "golden_answer_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_previous_hash_check" CHECK (length("previous_hash")=64 AND "previous_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_event_hash_check" CHECK (length("event_hash")=64 AND "event_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "ai_quality_review_mfa_time_check" CHECK ("actor_mfa_verified_at"<="created_at")
);

CREATE TABLE "legal_evaluation_human_attestations" (
  "id" text PRIMARY KEY NOT NULL,
  "evaluation_run_id" text NOT NULL,
  "corpus_version" text NOT NULL,
  "scope_digest" text NOT NULL,
  "scenario_count" bigint NOT NULL,
  "completed_run_count" bigint NOT NULL,
  "disposition" text NOT NULL,
  "reviewer_user_id" text NOT NULL,
  "reviewer_session_id" text NOT NULL,
  "reviewer_assignment_id" text NOT NULL,
  "reviewer_mfa_verified_at" text NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_eval_human_disposition_check" CHECK ("disposition" IN ('confirmed_correct','needs_follow_up')),
  CONSTRAINT "legal_eval_human_count_check" CHECK ("scenario_count" BETWEEN 1 AND 10000 AND "completed_run_count"="scenario_count"),
  CONSTRAINT "legal_eval_human_scope_hash_check" CHECK (length("scope_digest")=64 AND "scope_digest" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "legal_eval_human_previous_hash_check" CHECK (length("previous_hash")=64 AND "previous_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "legal_eval_human_event_hash_check" CHECK (length("event_hash")=64 AND "event_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "legal_eval_human_mfa_time_check" CHECK ("reviewer_mfa_verified_at"<="created_at")
);

CREATE TABLE "legal_evaluation_human_review_records" (
  "id" text PRIMARY KEY NOT NULL,
  "attestation_id" text NOT NULL,
  "evaluation_run_id" text NOT NULL,
  "corpus_version" text NOT NULL,
  "scenario_id" text NOT NULL,
  "attempt_id" text NOT NULL,
  "ai_run_id" text NOT NULL,
  "prompt_sha256" text NOT NULL,
  "response_sha256" text NOT NULL,
  "classification" text NOT NULL,
  "reviewer_user_id" text NOT NULL,
  "reviewer_session_id" text NOT NULL,
  "reviewer_assignment_id" text NOT NULL,
  "reviewer_mfa_verified_at" text NOT NULL,
  "materialization_reason" text NOT NULL,
  "previous_hash" text NOT NULL,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_eval_human_record_classification_check" CHECK ("classification"='correct'),
  CONSTRAINT "legal_eval_human_record_reason_check" CHECK ("materialization_reason"='attestation_scope_materialization'),
  CONSTRAINT "legal_eval_human_record_prompt_hash_check" CHECK (length("prompt_sha256")=64 AND "prompt_sha256" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "legal_eval_human_record_response_hash_check" CHECK (length("response_sha256")=64 AND "response_sha256" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "legal_eval_human_record_previous_hash_check" CHECK (length("previous_hash")=64 AND "previous_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "legal_eval_human_record_event_hash_check" CHECK (length("event_hash")=64 AND "event_hash" !~ '^.*[^A-F0-9].*$'),
  CONSTRAINT "legal_eval_human_record_mfa_time_check" CHECK ("reviewer_mfa_verified_at"<="created_at")
);

CREATE TABLE "legal_corpus_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "provider" text NOT NULL,
  "jurisdiction" text NOT NULL,
  "source_class" text NOT NULL,
  "scope" text NOT NULL DEFAULT 'global',
  "tenant_id" text,
  "owner_user_id" text,
  "matter_id" text,
  "visibility" text NOT NULL DEFAULT 'global',
  "canonical_url" text,
  "title" text NOT NULL,
  "short_title" text,
  "document_type" text,
  "document_number" text,
  "adopting_authority" text,
  "adoption_date" text,
  "publication_date" text,
  "availability_status" text NOT NULL DEFAULT 'ready',
  "trusted" bigint NOT NULL DEFAULT 1,
  "verification_status" text NOT NULL,
  "approval_required" bigint NOT NULL DEFAULT 0,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "legal_corpus_document_provider_check" CHECK ("provider" IN ('lex_uz','juro_owner','tenant_upload','user_upload','internal','derived_translation')),
  CONSTRAINT "legal_corpus_document_jurisdiction_check" CHECK ("jurisdiction"='UZ'),
  CONSTRAINT "legal_corpus_document_source_class_check" CHECK ("source_class" IN ('OFFICIAL_LEGISLATION','OFFICIAL_GOVERNMENT_GUIDANCE','OWNER_TRUSTED_GLOBAL','TENANT_TRUSTED_PRIVATE','USER_TRUSTED_PRIVATE','DERIVED_TRANSLATION','SECONDARY_REFERENCE')),
  CONSTRAINT "legal_corpus_document_scope_check" CHECK ("scope" IN ('global','tenant','user')),
  CONSTRAINT "legal_corpus_document_visibility_check" CHECK ("visibility" IN ('global','tenant','private')),
  CONSTRAINT "legal_corpus_document_availability_check" CHECK ("availability_status" IN ('ready','processing','technical_quarantine','failed','disabled')),
  CONSTRAINT "legal_corpus_document_trust_check" CHECK ("trusted"=1 AND "approval_required"=0),
  CONSTRAINT "legal_corpus_document_verification_check" CHECK ("verification_status" IN ('official_source','official_live_source','owner_approved','tenant_supplied','user_supplied','derived_translation','secondary_reference')),
  CONSTRAINT "legal_corpus_document_url_check" CHECK ("canonical_url" IS NULL OR (length("canonical_url") BETWEEN 12 AND 2048 AND "canonical_url" LIKE 'https://%')),
  CONSTRAINT "legal_corpus_document_scope_identity_check" CHECK (
    ("scope"='global' AND "tenant_id" IS NULL AND "owner_user_id" IS NULL)
    OR ("scope"='tenant' AND length("tenant_id")>0)
    OR ("scope"='user' AND length("owner_user_id")>0)
  )
);

CREATE TABLE "legal_corpus_variants" (
  "id" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "language" text NOT NULL,
  "is_official_language_version" bigint NOT NULL,
  "translation_type" text,
  -- Private uploads are stored in private R2 and deliberately have no public
  -- source URL. Official variants always carry their Lex.uz URL.
  "source_url" text,
  "last_verified_at" text NOT NULL,
  "current_version_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "title" text,
  "short_title" text,
  CONSTRAINT "legal_corpus_variant_language_check" CHECK ("language" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_corpus_variant_official_check" CHECK (("is_official_language_version"=1 AND "translation_type" IS NULL) OR ("is_official_language_version"=0 AND "translation_type"='machine')),
  CONSTRAINT "legal_corpus_variant_url_check" CHECK ("source_url" IS NULL OR (length("source_url") BETWEEN 12 AND 2048 AND "source_url" LIKE 'https://%'))
);

CREATE TABLE "legal_corpus_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "variant_id" text NOT NULL,
  "previous_version_id" text,
  "version_number" bigint NOT NULL,
  "status" text NOT NULL,
  "valid_from" text,
  "valid_to" text,
  "version_date" text,
  "content_sha256" text NOT NULL,
  "raw_object_key" text,
  "normalized_object_key" text,
  "source_url" text,
  "fetched_at" text NOT NULL,
  "change_type" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_corpus_version_number_check" CHECK ("version_number">=1),
  CONSTRAINT "legal_corpus_version_status_check" CHECK ("status" IN ('active','repealed','historical','unknown')),
  CONSTRAINT "legal_corpus_version_interval_check" CHECK ("valid_to" IS NULL OR "valid_from" IS NULL OR "valid_to">"valid_from"),
  CONSTRAINT "legal_corpus_version_hash_check" CHECK (length("content_sha256")=64 AND "content_sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_corpus_version_change_check" CHECK ("change_type" IN ('new','modified','repealed','renumbered','moved','metadata_changed','suspicious_change','unchanged')),
  CONSTRAINT "legal_corpus_version_url_check" CHECK ("source_url" IS NULL OR (length("source_url") BETWEEN 12 AND 2048 AND "source_url" LIKE 'https://%'))
);

CREATE TABLE "legal_corpus_ingestion_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "job_type" text NOT NULL,
  "status" text NOT NULL,
  "provider" text NOT NULL,
  "canonical_document_id" text,
  "variant_id" text,
  "source_url" text,
  "language" text,
  "idempotency_key" text NOT NULL,
  "attempt_count" bigint NOT NULL DEFAULT 0,
  "max_attempts" bigint NOT NULL DEFAULT 5,
  "next_attempt_at" text,
  "last_error_code" text,
  "correlation_id" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "legal_corpus_ingestion_type_check" CHECK ("job_type" IN ('discover','fetch','extract','link_languages','version','index','verify','publish','retry')),
  CONSTRAINT "legal_corpus_ingestion_status_check" CHECK ("status" IN ('queued','running','retrying','completed','failed','dead_letter')),
  CONSTRAINT "legal_corpus_ingestion_provider_check" CHECK ("provider" IN ('lex_uz','juro_owner','tenant_upload','user_upload','internal','derived_translation')),
  CONSTRAINT "legal_corpus_ingestion_attempt_check" CHECK ("attempt_count">=0 AND "max_attempts" BETWEEN 1 AND 12),
  CONSTRAINT "legal_corpus_ingestion_url_check" CHECK ("source_url" IS NULL OR (length("source_url") BETWEEN 12 AND 2048 AND "source_url" LIKE 'https://%'))
);

CREATE TABLE "legal_corpus_failures" (
  "id" text PRIMARY KEY NOT NULL,
  "job_id" text,
  "canonical_document_id" text,
  "source_url" text,
  "language" text,
  "attempted_at" text NOT NULL,
  "http_status" bigint,
  "error_code" text NOT NULL,
  "safe_message" text NOT NULL,
  "retryable" bigint NOT NULL,
  "retry_count" bigint NOT NULL DEFAULT 0,
  "retry_state" text NOT NULL,
  CONSTRAINT "legal_corpus_failure_status_check" CHECK ("http_status" IS NULL OR ("http_status">=100 AND "http_status"<=599)),
  CONSTRAINT "legal_corpus_failure_retryable_check" CHECK ("retryable" IN (0,1)),
  CONSTRAINT "legal_corpus_failure_state_check" CHECK ("retry_state" IN ('pending','retrying','terminal','technically_unavailable')),
  CONSTRAINT "legal_corpus_failure_url_check" CHECK ("source_url" IS NULL OR (length("source_url") BETWEEN 12 AND 2048 AND "source_url" LIKE 'https://%'))
);

CREATE TABLE "legal_corpus_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "run_kind" text NOT NULL,
  "status" text NOT NULL,
  "snapshot_id" text,
  "discovered_count" bigint NOT NULL DEFAULT 0,
  "fetched_count" bigint NOT NULL DEFAULT 0,
  "extracted_count" bigint NOT NULL DEFAULT 0,
  "indexed_count" bigint NOT NULL DEFAULT 0,
  "failed_count" bigint NOT NULL DEFAULT 0,
  "started_at" text NOT NULL,
  "finished_at" text,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_corpus_run_kind_check" CHECK ("run_kind" IN ('initial','daily','weekly','monthly','live','manual')),
  CONSTRAINT "legal_corpus_run_status_check" CHECK ("status" IN ('running','success','partial','failed','halted_suspicious_change'))
);

CREATE TABLE "legal_corpus_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "manifest_object_key" text NOT NULL,
  "registry_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  "created_by_run_id" text,
  CONSTRAINT "legal_corpus_snapshot_hash_check" CHECK (length("registry_sha256")=64 AND "registry_sha256" !~ '^.*[^0-9a-f].*$')
);

CREATE TABLE "legal_corpus_source_aliases" (
  "source_url" text PRIMARY KEY NOT NULL,
  "document_id" text NOT NULL,
  "provider_source_id" text NOT NULL,
  "language" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_corpus_alias_provider_id_check" CHECK (length("provider_source_id") BETWEEN 1 AND 180),
  CONSTRAINT "legal_corpus_alias_language_check" CHECK ("language" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_corpus_alias_url_check" CHECK (length("source_url") BETWEEN 12 AND 2048 AND "source_url" LIKE 'https://%')
);

CREATE TABLE "legal_corpus_discovery_checkpoints" (
  "id" text PRIMARY KEY NOT NULL,
  "category_key" text NOT NULL,
  "language" text NOT NULL,
  "search_url" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "page_number" bigint NOT NULL DEFAULT 0,
  "expected_document_count" bigint,
  "discovered_document_count" bigint NOT NULL DEFAULT 0,
  "next_event_target" text,
  "view_state" text,
  "view_state_generator" text,
  "attempt_count" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" text,
  "last_error_code" text,
  "started_at" text,
  "completed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "source_session_cookie" text
  CHECK ("source_session_cookie" IS NULL OR "source_session_cookie" ~ '^ASP.NET_SessionId=[A-Za-z0-9].*$'),
  "source_session_expires_at" text,
  CONSTRAINT "legal_corpus_discovery_language_check" CHECK ("language" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_corpus_discovery_status_check" CHECK ("status" IN ('queued','running','retrying','completed','failed','dead_letter')),
  CONSTRAINT "legal_corpus_discovery_page_check" CHECK ("page_number">=0 AND "discovered_document_count">=0),
  CONSTRAINT "legal_corpus_discovery_expected_check" CHECK ("expected_document_count" IS NULL OR "expected_document_count">=0),
  CONSTRAINT "legal_corpus_discovery_attempt_check" CHECK ("attempt_count" BETWEEN 0 AND 12),
  CONSTRAINT "legal_corpus_discovery_url_check" CHECK (length("search_url") BETWEEN 12 AND 2048 AND "search_url" LIKE 'https://lex.uz/%')
);

CREATE TABLE "legal_corpus_discovery_documents" (
  "checkpoint_id" text NOT NULL,
  "source_url" text NOT NULL,
  "provider_source_id" text NOT NULL,
  "language" text NOT NULL,
  "discovered_at" text NOT NULL,
  PRIMARY KEY ("checkpoint_id","source_url"),
  CONSTRAINT "legal_corpus_discovery_document_language_check" CHECK ("language" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_corpus_discovery_document_url_check" CHECK (length("source_url") BETWEEN 12 AND 2048 AND "source_url" LIKE 'https://%')
);

CREATE TABLE "legal_corpus_admin_events" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "action" text NOT NULL,
  "target_type" text NOT NULL,
  "target_id" text,
  "reason" text NOT NULL,
  "details_json" text NOT NULL DEFAULT '{}',
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "previous_event_hash" text,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_corpus_admin_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_corpus_admin_action_check" CHECK ("action" IN ('discovery_seeded','discovery_retried','ingestion_retried')),
  CONSTRAINT "legal_corpus_admin_target_type_check" CHECK ("target_type" IN ('catalog','checkpoint','ingestion_job')),
  CONSTRAINT "legal_corpus_admin_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500),
  CONSTRAINT "legal_corpus_admin_details_check" CHECK (json_valid("details_json") AND length("details_json")<=4096),
  CONSTRAINT "legal_corpus_admin_hash_check" CHECK (
    length("event_hash")=64 AND "event_hash" !~ '^.*[^0-9A-F].*$'
    AND ("previous_event_hash" IS NULL OR (length("previous_event_hash")=64 AND "previous_event_hash" !~ '^.*[^0-9A-F].*$'))
  )
);

CREATE TABLE "legal_corpus_owner_publications" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "analysis_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "file_id" text NOT NULL,
  "scan_result_id" text NOT NULL,
  "source_sha256" text NOT NULL,
  "extraction_sha256" text NOT NULL,
  "content_sha256" text NOT NULL,
  "document_id" text NOT NULL,
  "variant_id" text NOT NULL,
  "version_id" text NOT NULL,
  "language" text NOT NULL,
  "rights_confirmed" bigint NOT NULL,
  "legal_review_confirmed" bigint NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "record_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_corpus_owner_publication_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_corpus_owner_publication_language_check" CHECK ("language" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_corpus_owner_publication_confirmations_check" CHECK ("rights_confirmed"=1 AND "legal_review_confirmed"=1),
  CONSTRAINT "legal_corpus_owner_publication_hashes_check" CHECK (
    length("source_sha256")=64 AND "source_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("extraction_sha256")=64 AND "extraction_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("content_sha256")=64 AND "content_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("record_hash")=64 AND "record_hash" !~ '^.*[^0-9A-F].*$'
  ),
  CONSTRAINT "legal_corpus_owner_publication_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500)
);

CREATE TABLE "legal_corpus_owner_withdrawals" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "publication_id" text NOT NULL,
  "document_id" text NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "record_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_corpus_owner_withdrawal_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_corpus_owner_withdrawal_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500),
  CONSTRAINT "legal_corpus_owner_withdrawal_hash_check" CHECK (
    length("record_hash")=64 AND "record_hash" !~ '^.*[^0-9A-F].*$'
  )
);

CREATE TABLE "legal_corpus_owner_ingestions" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "analysis_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "file_id" text NOT NULL,
  "scan_result_id" text NOT NULL,
  "source_sha256" text NOT NULL,
  "extraction_sha256" text NOT NULL,
  "content_sha256" text NOT NULL,
  "document_id" text NOT NULL,
  "variant_id" text NOT NULL,
  "version_id" text NOT NULL,
  "language" text NOT NULL,
  "rights_confirmed" bigint NOT NULL,
  "trust_mode" text NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "record_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_corpus_owner_ingestion_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_corpus_owner_ingestion_language_check" CHECK ("language" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_corpus_owner_ingestion_trust_check" CHECK ("rights_confirmed"=1 AND "trust_mode"='technical_auto_trust'),
  CONSTRAINT "legal_corpus_owner_ingestion_hashes_check" CHECK (
    length("source_sha256")=64 AND "source_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("extraction_sha256")=64 AND "extraction_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("content_sha256")=64 AND "content_sha256" !~ '^.*[^0-9a-f].*$'
    AND length("record_hash")=64 AND "record_hash" !~ '^.*[^0-9A-F].*$'
  ),
  CONSTRAINT "legal_corpus_owner_ingestion_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500)
);

CREATE TABLE "legal_corpus_owner_ingestion_withdrawals" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "publication_id" text NOT NULL,
  "document_id" text NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "record_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "legal_corpus_owner_ingestion_withdrawal_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_corpus_owner_ingestion_withdrawal_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500),
  CONSTRAINT "legal_corpus_owner_ingestion_withdrawal_hash_check" CHECK (
    length("record_hash")=64 AND "record_hash" !~ '^.*[^0-9A-F].*$'
  )
);

CREATE TABLE "legal_source_host_rate_limits" (
  "host" text PRIMARY KEY NOT NULL,
  "crawl_delay_ms" bigint NOT NULL DEFAULT 0,
  "last_request_at" text,
  "next_allowed_at" text NOT NULL,
  "robots_observed_at" text,
  "updated_at" text NOT NULL,
  "robots_body" text,
  "robots_body_observed_at" text,
  CONSTRAINT "legal_source_host_rate_limit_host_check" CHECK ("host"='lex.uz'),
  CONSTRAINT "legal_source_host_rate_limit_delay_check" CHECK ("crawl_delay_ms" BETWEEN 0 AND 60000)
);

CREATE TABLE "legal_corpus_owner_upload_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "analysis_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "file_id" text NOT NULL,
  "source_sha256" text NOT NULL,
  "title" text NOT NULL,
  "language" text NOT NULL,
  "rights_confirmed" bigint NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "actor_session_id" text NOT NULL,
  "actor_assignment_id" text NOT NULL,
  "actor_mfa_verified_at" text NOT NULL,
  "authorization_hash" text NOT NULL,
  "status" text NOT NULL DEFAULT 'scan_queued',
  "error_code" text,
  "published_document_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "legal_corpus_owner_upload_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "legal_corpus_owner_upload_language_check" CHECK ("language" IN ('uz-Latn','uz-Cyrl','ru','en')),
  CONSTRAINT "legal_corpus_owner_upload_rights_check" CHECK ("rights_confirmed"=1),
  CONSTRAINT "legal_corpus_owner_upload_status_check" CHECK ("status" IN ('scan_queued','published','failed')),
  CONSTRAINT "legal_corpus_owner_upload_hash_check" CHECK (
    length("source_sha256")=64 AND lower("source_sha256")="source_sha256"
    AND length("authorization_hash")=64 AND upper("authorization_hash")="authorization_hash"
  ),
  CONSTRAINT "legal_corpus_owner_upload_title_check" CHECK (length(trim("title")) BETWEEN 2 AND 300),
  CONSTRAINT "legal_corpus_owner_upload_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500)
);

CREATE TABLE "legal_corpus_core_code_targets" (
  "target_id" text PRIMARY KEY NOT NULL,
  "title_ru" text NOT NULL,
  "status" text NOT NULL DEFAULT 'queued',
  "source_url" text,
  "canonical_document_id" text,
  "attempt_count" bigint NOT NULL DEFAULT 0,
  "next_attempt_at" text,
  "last_error_code" text,
  "resolved_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  "page_number" bigint NOT NULL DEFAULT 0
  CHECK ("page_number" BETWEEN 0 AND 12),
  "next_event_target" text
  CHECK ("next_event_target" IS NULL OR length("next_event_target") BETWEEN 1 AND 512),
  "view_state" text
  CHECK ("view_state" IS NULL OR length("view_state") BETWEEN 1 AND 262144),
  "view_state_generator" text
  CHECK ("view_state_generator" IS NULL OR length("view_state_generator") BETWEEN 1 AND 512),
  "source_session_cookie" text
  CHECK ("source_session_cookie" IS NULL OR "source_session_cookie" ~ '^ASP.NET_SessionId=[A-Za-z0-9].*$'),
  "source_session_expires_at" text,
  CONSTRAINT "legal_corpus_core_code_target_id_check" CHECK (length("target_id") BETWEEN 2 AND 120),
  CONSTRAINT "legal_corpus_core_code_title_check" CHECK (length(trim("title_ru")) BETWEEN 3 AND 500),
  CONSTRAINT "legal_corpus_core_code_status_check" CHECK ("status" IN ('queued','retrying','awaiting_ingestion','indexed','technically_unavailable')),
  CONSTRAINT "legal_corpus_core_code_attempt_check" CHECK ("attempt_count" BETWEEN 0 AND 12),
  CONSTRAINT "legal_corpus_core_code_url_check" CHECK ("source_url" IS NULL OR (length("source_url") BETWEEN 12 AND 2048 AND "source_url" LIKE 'https://lex.uz/%')),
  CONSTRAINT "legal_corpus_core_code_canonical_id_check" CHECK ("canonical_document_id" IS NULL OR (length("canonical_document_id") BETWEEN 7 AND 180 AND "canonical_document_id" ~ '^lexuz:.*$'))
);

CREATE TABLE "lawyer_availability_rules" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "weekday" bigint NOT NULL,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "timezone" text DEFAULT 'Asia/Tashkent' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("weekday" BETWEEN 1 AND 7),
  CHECK ("starts_at" ~ '^[0-1][0-9]:[0-5][0-9]$' OR "starts_at" ~ '^2[0-3]:[0-5][0-9]$'),
  CHECK ("ends_at" ~ '^[0-1][0-9]:[0-5][0-9]$' OR "ends_at" ~ '^2[0-3]:[0-5][0-9]$'),
  CHECK ("starts_at" < "ends_at"),
  CHECK ("status" IN ('active','paused'))
);

CREATE TABLE "lawyer_unavailability_periods" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "reason" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("starts_at" < "ends_at")
);

CREATE TABLE "lawyer_consultations" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "client_user_id" text NOT NULL,
  "case_id" text NOT NULL,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "timezone" text DEFAULT 'Asia/Tashkent' NOT NULL,
  "format" text DEFAULT 'video' NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "internal_note" text,
  "result_note" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("starts_at" < "ends_at"),
  CHECK ("format" IN ('video','phone','office')),
  CHECK ("status" IN ('proposed','confirmed','in_progress','completed','cancelled'))
);

CREATE TABLE "lawyer_task_comments" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "body" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK (length(trim("body")) BETWEEN 1 AND 2000)
);

CREATE TABLE "lawyer_document_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "case_id" text NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "client_user_id" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "provided_document_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK (length(trim("title")) BETWEEN 2 AND 240),
  CHECK (length(trim("description")) BETWEEN 4 AND 2000),
  CHECK ("status" IN ('requested','provided','cancelled')),
  CHECK (("status"='provided' AND "provided_document_id" IS NOT NULL) OR ("status"<>'provided' AND "provided_document_id" IS NULL))
);

CREATE TABLE "lawyer_request_message_attachments" (
  "id" text PRIMARY KEY NOT NULL,
  "message_id" text NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "document_id" text NOT NULL,
  "shared_by_user_id" text NOT NULL,
  "recipient_user_id" text NOT NULL,
  "status" text DEFAULT 'sent' NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("status" IN ('sent','viewed'))
);

CREATE TABLE "operational_feature_flag_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "environment" text NOT NULL,
  "feature_key" text NOT NULL,
  "version" bigint NOT NULL,
  "enabled" bigint NOT NULL,
  "reason" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "previous_event_hash" text,
  "event_hash" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "operational_feature_environment_check" CHECK ("environment" IN ('development','staging','production')),
  CONSTRAINT "operational_feature_key_check" CHECK ("feature_key" IN ('ai_chat','ai_openai_primary','ai_anthropic_fallback','ai_lex_web_discovery','ai_secondary_web_research','document_analysis_upload','lawyer_handoff','voice_mode')),
  CONSTRAINT "operational_feature_version_check" CHECK ("version" > 0),
  CONSTRAINT "operational_feature_enabled_check" CHECK ("enabled" IN (0,1)),
  CONSTRAINT "operational_feature_reason_check" CHECK (length(trim("reason")) BETWEEN 10 AND 500),
  CONSTRAINT "operational_feature_previous_hash_check" CHECK ("previous_event_hash" IS NULL OR "previous_event_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$')),
  CONSTRAINT "operational_feature_event_hash_check" CHECK ("event_hash" ~ ('^' || replace(hex(zeroblob(32)),'0','[A-F0-9]') || '$'))
);

CREATE TABLE "analysis_export_idempotency_registry" (
  "idempotency_key" text PRIMARY KEY NOT NULL,
  "analysis_id" text NOT NULL,
  "export_kind" text NOT NULL CHECK ("export_kind" IN ('json','report')),
  "created_at" text NOT NULL
);

CREATE TABLE "ai_question_intakes" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "token_hash" text NOT NULL,
  "question_ciphertext" text,
  "question_iv" text,
  "question_key_version" text,
  "expires_at" text NOT NULL,
  "consumed_at" text,
  "created_at" text NOT NULL,
  CONSTRAINT "ai_question_intakes_hash_check" CHECK (
		"token_hash" ~ ('^' || replace(lower(hex(zeroblob(32))),'0','[0-9a-f]') || '$')
	),
  CONSTRAINT "ai_question_intakes_expiry_check" CHECK ("expires_at" > "created_at"),
  CONSTRAINT "ai_question_intakes_payload_check" CHECK (
		(
			"consumed_at" IS NULL
			AND "question_ciphertext" IS NOT NULL
			AND length("question_ciphertext") BETWEEN 20 AND 25000
			AND "question_iv" IS NOT NULL
			AND length("question_iv") = 16
			AND "question_key_version" IS NOT NULL
			AND length("question_key_version") BETWEEN 1 AND 32
		)
		OR (
			"consumed_at" IS NOT NULL
			AND "question_ciphertext" IS NULL
			AND "question_iv" IS NULL
			AND "question_key_version" IS NULL
		)
	)
);

CREATE TABLE "user_password_credentials" (
  "user_id" text PRIMARY KEY NOT NULL,
  "algorithm" text DEFAULT 'PBKDF2-SHA256' NOT NULL,
  "iterations" bigint DEFAULT 600000 NOT NULL,
  "salt_base64url" text NOT NULL,
  "hash_base64url" text NOT NULL,
  "password_changed_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "user_password_algorithm_check" CHECK("user_password_credentials"."algorithm" = 'PBKDF2-SHA256'),
  CONSTRAINT "user_password_iterations_check" CHECK("user_password_credentials"."iterations" BETWEEN 310000 AND 1000000),
  CONSTRAINT "user_password_salt_check" CHECK(length("user_password_credentials"."salt_base64url") BETWEEN 22 AND 64),
  CONSTRAINT "user_password_hash_check" CHECK(length("user_password_credentials"."hash_base64url") = 43)
);

CREATE TABLE "auth_password_rate_limits" (
  "scope_key" text PRIMARY KEY NOT NULL,
  "failure_count" bigint DEFAULT 0 NOT NULL,
  "window_started_at" text NOT NULL,
  "locked_until" text,
  "updated_at" text NOT NULL,
  CONSTRAINT "auth_password_rate_limit_count_check" CHECK("auth_password_rate_limits"."failure_count" BETWEEN 0 AND 1000)
);

CREATE TABLE "auth_password_attempt_reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "scope_key" text NOT NULL,
  "scope_kind" text NOT NULL,
  "expires_at" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "auth_password_attempt_scope_check" CHECK("auth_password_attempt_reservations"."scope_kind" IN ('email','ip')),
  CONSTRAINT "auth_password_attempt_expiry_check" CHECK("auth_password_attempt_reservations"."expires_at" > "auth_password_attempt_reservations"."created_at")
);

CREATE TABLE "auth_mfa_attempt_reservations" (
  "id" text PRIMARY KEY NOT NULL,
  "challenge_id" text NOT NULL,
  "user_scope_key" text NOT NULL,
  "ip_scope_key" text,
  "expires_at" text NOT NULL,
  "failure_claim_nonce" text,
  "failure_claimed_at" text,
  "created_at" text NOT NULL,
  CONSTRAINT "auth_mfa_attempt_expiry_check" CHECK("auth_mfa_attempt_reservations"."expires_at" > "auth_mfa_attempt_reservations"."created_at"),
  CONSTRAINT "auth_mfa_attempt_claim_check" CHECK(("auth_mfa_attempt_reservations"."failure_claim_nonce" IS NULL AND "auth_mfa_attempt_reservations"."failure_claimed_at" IS NULL) OR ("auth_mfa_attempt_reservations"."failure_claim_nonce" IS NOT NULL AND "auth_mfa_attempt_reservations"."failure_claimed_at" >= "auth_mfa_attempt_reservations"."created_at"))
);

CREATE TABLE "auth_session_handoffs" (
  "id" text PRIMARY KEY NOT NULL,
  "token_hash" text NOT NULL,
  "user_id" text NOT NULL,
  "source_session_id" text NOT NULL,
  "source_host" text NOT NULL,
  "destination_host" text NOT NULL,
  "redirect_path" text NOT NULL,
  "remember_me" bigint DEFAULT 0 NOT NULL,
  "expires_at" text NOT NULL,
  "consumed_at" text,
  "consumed_by_session_id" text,
  "created_at" text NOT NULL,
  CONSTRAINT "auth_session_handoffs_hash_check" CHECK(length("token_hash")=64 AND "token_hash" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "auth_session_handoffs_hosts_check" CHECK("source_host" IN ('app.juro.uz','lawyer.juro.uz') AND "destination_host" IN ('app.juro.uz','lawyer.juro.uz') AND "source_host"<>"destination_host"),
  CONSTRAINT "auth_session_handoffs_redirect_check" CHECK(substr("redirect_path",1,1)='/' AND substr("redirect_path",1,2)<>'//'),
  CONSTRAINT "auth_session_handoffs_remember_check" CHECK("remember_me" IN (0,1)),
  CONSTRAINT "auth_session_handoffs_expiry_check" CHECK("expires_at">"created_at"),
  CONSTRAINT "auth_session_handoffs_consumed_check" CHECK(("consumed_at" IS NULL AND "consumed_by_session_id" IS NULL) OR ("consumed_at" IS NOT NULL AND "consumed_by_session_id" IS NOT NULL))
);

CREATE TABLE "policy_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "document_key" text NOT NULL,
  "document_version" text NOT NULL,
  "locale" text NOT NULL,
  "content_sha256" text NOT NULL,
  "status" text NOT NULL,
  "effective_at" text,
  "published_at" text,
  "created_at" text NOT NULL,
  CONSTRAINT "policy_documents_locale_check" CHECK("locale" IN ('ru','uz','en')),
  CONSTRAINT "policy_documents_status_check" CHECK("status" IN ('draft','approved','superseded')),
  CONSTRAINT "policy_documents_sha256_check" CHECK(length("content_sha256") = 64)
);

CREATE TABLE "user_acceptances" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "document_key" text NOT NULL,
  "document_version" text NOT NULL,
  "accepted_at" text NOT NULL,
  "policy_document_id" text ,
  "locale" text,
  "content_sha256" text,
  "acceptance_method" text,
  "auth_source" text,
  "session_id" text ,
  "evidence_json" text
);

CREATE TABLE "security_email_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text,
  "challenge_id" text,
  "auth_otp_challenge_id" text,
  "event_type" text NOT NULL,
  "locale" text NOT NULL,
  "recipient_ciphertext" text NOT NULL,
  "recipient_iv" text NOT NULL,
  "recipient_key_version" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "provider_message_id" text,
  "sent_at" text,
  "error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "security_email_jobs_event_check" CHECK("event_type" IN ('email_changed_previous_address','password_changed')),
  CONSTRAINT "security_email_jobs_locale_check" CHECK("locale" IN ('ru','uz','en')),
  CONSTRAINT "security_email_jobs_context_check" CHECK(
		("event_type" = 'email_changed_previous_address' AND "challenge_id" IS NOT NULL AND "auth_otp_challenge_id" IS NULL)
		OR ("event_type" = 'password_changed' AND "challenge_id" IS NULL AND "auth_otp_challenge_id" IS NOT NULL)
	),
  CONSTRAINT "security_email_jobs_status_check" CHECK("status" IN ('pending','sending','retrying','sent','failed')),
  CONSTRAINT "security_email_jobs_attempts_check" CHECK("attempt_count" >= 0),
  CONSTRAINT "security_email_jobs_recipient_check" CHECK(length("recipient_ciphertext") >= 22 AND length("recipient_iv") = 16 AND length("recipient_key_version") BETWEEN 1 AND 32),
  CONSTRAINT "security_email_jobs_evidence_check" CHECK((
		("status" IN ('pending','sending') AND "provider_message_id" IS NULL AND "sent_at" IS NULL AND "error_code" IS NULL)
		OR ("status" IN ('retrying','failed') AND "provider_message_id" IS NULL AND "sent_at" IS NULL AND "error_code" IS NOT NULL)
		OR ("status" = 'sent' AND "provider_message_id" IS NOT NULL AND "sent_at" IS NOT NULL AND "error_code" IS NULL)
	))
);

CREATE TABLE "auth_pending_registrations" (
  "user_id" text PRIMARY KEY NOT NULL,
  "expires_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "auth_pending_registrations_expiry_check" CHECK(
		"updated_at" >= "created_at" AND "expires_at" > "updated_at"
	)
);

CREATE TABLE "email_change_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text,
  "current_email_hash" text NOT NULL,
  "current_email_lookup_hash" text,
  "current_email_lookup_key_version" text,
  "new_email" text NOT NULL,
  "new_email_ciphertext" text,
  "new_email_iv" text,
  "new_email_key_version" text,
  "new_email_lookup_hash" text,
  "new_email_lookup_key_version" text,
  "current_code_salt" text NOT NULL,
  "current_code_hash" text NOT NULL,
  "current_code_hmac" text,
  "current_code_key_version" text,
  "new_code_salt" text NOT NULL,
  "new_code_hash" text NOT NULL,
  "new_code_hmac" text,
  "new_code_key_version" text,
  "locale" text NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "max_attempts" bigint DEFAULT 5 NOT NULL,
  "expires_at" text NOT NULL,
  "codes_queued_at" text,
  "consumed_at" text,
  "consumed_by_operation_id" text,
  "invalidated_at" text,
  "created_at" text NOT NULL,
  CONSTRAINT "email_change_challenges_locale_check" CHECK("email_change_challenges"."locale" IN ('ru','uz','en')),
  CONSTRAINT "email_change_challenges_attempts_check" CHECK("email_change_challenges"."attempt_count" >= 0 AND "email_change_challenges"."attempt_count" <= "email_change_challenges"."max_attempts" AND "email_change_challenges"."max_attempts" BETWEEN 1 AND 10)
);

CREATE TABLE "security_notification_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text,
  "session_id" text NOT NULL,
  "event_type" text NOT NULL,
  "delivery_channel" text DEFAULT 'email' NOT NULL,
  "locale" text NOT NULL,
  "recipient_ciphertext" text NOT NULL,
  "recipient_iv" text NOT NULL,
  "recipient_key_version" text NOT NULL,
  "device_name" text NOT NULL,
  "country_code" text,
  "region_code" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "provider_message_id" text,
  "sent_at" text,
  "error_code" text,
  "occurred_at" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "security_notification_jobs_event_check" CHECK("security_notification_jobs"."event_type" IN ('login_new_device','login_new_region')),
  CONSTRAINT "security_notification_jobs_channel_check" CHECK("security_notification_jobs"."delivery_channel" = 'email'),
  CONSTRAINT "security_notification_jobs_locale_check" CHECK("security_notification_jobs"."locale" IN ('ru','uz','en')),
  CONSTRAINT "security_notification_jobs_status_check" CHECK("security_notification_jobs"."status" IN ('pending','sending','retrying','sent','failed')),
  CONSTRAINT "security_notification_jobs_attempts_check" CHECK("security_notification_jobs"."attempt_count" >= 0),
  CONSTRAINT "security_notification_jobs_context_check" CHECK(length("security_notification_jobs"."session_id") BETWEEN 1 AND 128
        AND length("security_notification_jobs"."device_name") BETWEEN 1 AND 80
        AND ("security_notification_jobs"."country_code" IS NULL OR (
          length("security_notification_jobs"."country_code") = 2
          AND "security_notification_jobs"."country_code" !~ '^.*[^A-Z0-9].*$'
        ))
        AND ("security_notification_jobs"."region_code" IS NULL OR (
          length("security_notification_jobs"."region_code") BETWEEN 1 AND 12
          AND "security_notification_jobs"."region_code" !~ '^.*[^A-Z0-9-].*$'
        ))),
  CONSTRAINT "security_notification_jobs_recipient_check" CHECK(length("security_notification_jobs"."recipient_ciphertext") >= 22
        AND length("security_notification_jobs"."recipient_iv") = 16
        AND length("security_notification_jobs"."recipient_key_version") BETWEEN 1 AND 32),
  CONSTRAINT "security_notification_jobs_evidence_check" CHECK((
        ("security_notification_jobs"."status" IN ('pending','sending') AND "security_notification_jobs"."provider_message_id" IS NULL AND "security_notification_jobs"."sent_at" IS NULL AND "security_notification_jobs"."error_code" IS NULL)
        OR ("security_notification_jobs"."status" IN ('retrying','failed') AND "security_notification_jobs"."provider_message_id" IS NULL AND "security_notification_jobs"."sent_at" IS NULL AND "security_notification_jobs"."error_code" IS NOT NULL)
        OR ("security_notification_jobs"."status" = 'sent' AND "security_notification_jobs"."provider_message_id" IS NOT NULL AND "security_notification_jobs"."sent_at" IS NOT NULL AND "security_notification_jobs"."error_code" IS NULL)
      ))
);

CREATE TABLE "account_deletion_challenges" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text,
  "email_hash" text NOT NULL,
  "locale" text NOT NULL,
  "code_salt" text NOT NULL,
  "code_hash" text NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "max_attempts" bigint DEFAULT 5 NOT NULL,
  "expires_at" text NOT NULL,
  "consumed_at" text,
  "consumed_by_operation_id" text,
  "invalidated_at" text,
  "created_at" text NOT NULL,
  "email_lookup_hash" text,
  "email_lookup_key_version" text,
  "code_hmac" text,
  "code_key_version" text,
  CONSTRAINT "account_deletion_challenges_locale_check" CHECK("account_deletion_challenges"."locale" IN ('ru','uz','en')),
  CONSTRAINT "account_deletion_challenges_attempts_check" CHECK("account_deletion_challenges"."attempt_count" >= 0 AND "account_deletion_challenges"."max_attempts" BETWEEN 1 AND 10)
);

CREATE TABLE "ai_document_prefill_handoffs" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "assistant_message_id" text NOT NULL,
  "template_code" text NOT NULL,
  "document_id" text NOT NULL,
  "locale" text NOT NULL,
  "selected_field_ids_json" text NOT NULL,
  "selection_sha256" text NOT NULL,
  "idempotency_key_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  CONSTRAINT "ai_document_prefill_handoffs_locale_check" CHECK ("locale" IN ('ru','uz','en')),
  CONSTRAINT "ai_document_prefill_handoffs_fields_check" CHECK (
		json_valid("selected_field_ids_json")
		AND json_type("selected_field_ids_json")='array'
		AND length("selected_field_ids_json") BETWEEN 2 AND 10000
	),
  CONSTRAINT "ai_document_prefill_handoffs_hash_check" CHECK (
		"selection_sha256" ~ ('^' || replace(lower(hex(zeroblob(32))),'0','[0-9a-f]') || '$')
		AND "idempotency_key_sha256" ~ ('^' || replace(lower(hex(zeroblob(32))),'0','[0-9a-f]') || '$')
	)
);

CREATE TABLE "builder_document_analysis_handoffs" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "document_id" text NOT NULL,
  "document_revision" bigint NOT NULL,
  "document_content_sha256" text NOT NULL,
  "file_id" text NOT NULL,
  "analysis_id" text NOT NULL,
  "mode" text NOT NULL,
  "locale" text NOT NULL,
  "idempotency_key_sha256" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "last_error_code" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "builder_analysis_revision_check" CHECK ("document_revision">0),
  CONSTRAINT "builder_analysis_mode_check" CHECK ("mode" IN ('quick','full','expert')),
  CONSTRAINT "builder_analysis_locale_check" CHECK ("locale" IN ('ru','uz','en')),
  CONSTRAINT "builder_analysis_status_check" CHECK ("status" IN ('pending','ready')),
  CONSTRAINT "builder_analysis_attempt_check" CHECK ("attempt_count">=0),
  CONSTRAINT "builder_analysis_hash_check" CHECK (
		"document_content_sha256" ~ ('^' || replace(lower(hex(zeroblob(32))),'0','[0-9a-f]') || '$')
		AND "idempotency_key_sha256" ~ ('^' || replace(lower(hex(zeroblob(32))),'0','[0-9a-f]') || '$')
	),
  CONSTRAINT "builder_analysis_state_check" CHECK (
		("status"='pending')
		OR ("status"='ready' AND "last_error_code" IS NULL)
	)
);

CREATE TABLE "voice_recordings" (
  "id" text PRIMARY KEY NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "conversation_id" text,
  "case_id" text,
  "message_id" text,
  "idempotency_key" text NOT NULL,
  "request_hash" text NOT NULL,
  "object_key" text NOT NULL,
  "quarantine_key" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "duration_ms" bigint NOT NULL,
  "sha256" text NOT NULL,
  "locale" text NOT NULL,
  "status" text DEFAULT 'initiated' NOT NULL,
  "transcript_ciphertext" text,
  "transcript_iv" text,
  "transcript_key_version" text,
  "provider" text,
  "model" text,
  "error_code" text,
  "expires_at" text NOT NULL,
  "uploaded_at" text,
  "transcribed_at" text,
  "submitted_at" text,
  "deleted_at" text,
  "purged_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "voice_recordings_locale_check" CHECK("locale" IN ('ru','uz','en')),
  CONSTRAINT "voice_recordings_status_check" CHECK("status" IN ('initiated','uploaded','ready','transcribing','transcribed','submitted','failed','deleted','purged')),
  CONSTRAINT "voice_recordings_size_check" CHECK("size_bytes" BETWEEN 1 AND 26214400),
  CONSTRAINT "voice_recordings_duration_check" CHECK("duration_ms" BETWEEN 1 AND 300000),
  CONSTRAINT "voice_recordings_sha_check" CHECK(length("sha256")=64),
  CONSTRAINT "voice_recordings_request_hash_check" CHECK(length("request_hash")=64),
  CONSTRAINT "voice_recordings_transcript_check" CHECK(
    ("status" IN ('transcribed','submitted') AND "transcript_ciphertext" IS NOT NULL AND "transcript_iv" IS NOT NULL AND "transcript_key_version" IS NOT NULL AND "transcribed_at" IS NOT NULL)
    OR ("status" NOT IN ('transcribed','submitted') AND "transcript_ciphertext" IS NULL AND "transcript_iv" IS NULL AND "transcript_key_version" IS NULL)
  )
);

CREATE TABLE "guest_ai_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "token_hmac" text NOT NULL,
  "token_key_version" text NOT NULL,
  "ip_hmac" text NOT NULL,
  "locale" text NOT NULL,
  "state" text DEFAULT 'available' NOT NULL,
  "request_count" bigint DEFAULT 0 NOT NULL,
  "answer_count" bigint DEFAULT 0 NOT NULL,
  "reserved_run_id" text,
  "reservation_expires_at" text,
  "expires_at" text NOT NULL,
  "consumed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "guest_ai_sessions_locale_check" CHECK("locale" IN ('ru','uz','en')),
  CONSTRAINT "guest_ai_sessions_state_check" CHECK("state" IN ('available','reserved','consumed')),
  CONSTRAINT "guest_ai_sessions_request_count_check" CHECK("request_count" BETWEEN 0 AND 5),
  CONSTRAINT "guest_ai_sessions_answer_count_check" CHECK("answer_count" BETWEEN 0 AND 1),
  CONSTRAINT "guest_ai_sessions_reservation_check" CHECK(
    ("state"='reserved' AND "reserved_run_id" IS NOT NULL AND "reservation_expires_at" IS NOT NULL)
    OR ("state" IN ('available','consumed') AND "reserved_run_id" IS NULL AND "reservation_expires_at" IS NULL)
  ),
  CONSTRAINT "guest_ai_sessions_consumed_check" CHECK(
    ("state"='consumed' AND "answer_count"=1 AND "consumed_at" IS NOT NULL)
    OR ("state"<>'consumed' AND "answer_count"=0 AND "consumed_at" IS NULL)
  )
);

CREATE TABLE "knowledge_base_article_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "article_id" text NOT NULL,
  "version_number" bigint NOT NULL,
  "title_ru" text NOT NULL,
  "title_uz" text NOT NULL,
  "title_en" text,
  "summary_ru" text NOT NULL,
  "summary_uz" text NOT NULL,
  "summary_en" text,
  "body_ru_json" text NOT NULL,
  "body_uz_json" text NOT NULL,
  "body_en_json" text,
  "related_slugs_json" text DEFAULT '[]' NOT NULL,
  "content_sha256" text NOT NULL,
  "created_at" text NOT NULL,
  "published_at" text,
  "created_by_user_id" text ,
  "updated_by_user_id" text ,
  "published_by_user_id" text ,
  "updated_at" text,
  "content_hash_version" text DEFAULT 'body-v1' NOT NULL,
  CONSTRAINT "knowledge_base_article_versions_number_check" CHECK ("version_number" >= 1),
  CONSTRAINT "knowledge_base_article_versions_hash_check" CHECK (length("content_sha256") = 64),
  CONSTRAINT "knowledge_base_article_versions_body_ru_check" CHECK (json_valid("body_ru_json")),
  CONSTRAINT "knowledge_base_article_versions_body_uz_check" CHECK (json_valid("body_uz_json")),
  CONSTRAINT "knowledge_base_article_versions_body_en_check" CHECK ("body_en_json" IS NULL OR json_valid("body_en_json")),
  CONSTRAINT "knowledge_base_article_versions_related_check" CHECK (json_valid("related_slugs_json"))
);

CREATE TABLE "legal_source_references" (
  "id" text PRIMARY KEY NOT NULL,
  "ai_run_id" text,
  "guest_run_id" text,
  "conversation_id" text,
  "message_id" text,
  "source_kind" text NOT NULL,
  "source_locale" text NOT NULL,
  "canonical_id" text,
  "source_url" text NOT NULL,
  "canonical_url" text NOT NULL,
  "title" text NOT NULL,
  "act_identifier" text,
  "article_reference" text,
  "excerpt" text,
  "document_status" text,
  "effective_date" text,
  "retrieved_at" text NOT NULL,
  "validated_at" text NOT NULL,
  "content_sha256" text NOT NULL,
  "fetch_status" text NOT NULL,
  "citation_validation_status" text NOT NULL,
  "source_access_mode" text NOT NULL DEFAULT 'direct',
  "created_at" text NOT NULL,
  evidence_receipt_json TEXT,
  CONSTRAINT "legal_source_references_kind_check" CHECK ("source_kind" IN ('lex','advice','internal','package')),
  CONSTRAINT "legal_source_references_locale_check" CHECK ("source_locale" IN ('ru','uz','uzc','en') OR ("source_kind"='internal' AND "source_locale" IN ('mixed','unknown'))),
  CONSTRAINT "legal_source_references_run_check" CHECK (("ai_run_id" IS NOT NULL AND "guest_run_id" IS NULL) OR ("ai_run_id" IS NULL AND "guest_run_id" IS NOT NULL)),
  CONSTRAINT "legal_source_references_excerpt_limit" CHECK ("excerpt" IS NULL OR length("excerpt")<=1200),
  CONSTRAINT "legal_source_references_hash_check" CHECK (length("content_sha256")=64 AND "content_sha256" !~ '^.*[^0-9a-f].*$'),
  CONSTRAINT "legal_source_references_fetch_check" CHECK ("fetch_status" IN ('success','unavailable')),
  CONSTRAINT "legal_source_references_validation_check" CHECK ("citation_validation_status" IN ('validated','unavailable')),
  CONSTRAINT "legal_source_references_access_check" CHECK ("source_access_mode" IN ('direct','approved_package'))
);

INSERT INTO "__backup_20260724_manifest" VALUES('activity_events',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('consultation_requests',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('contacts',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_answers',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_attachments',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_approvals',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_change_proposals',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_collaborators',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_comments',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_comment_threads',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_current_content',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_files',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_invitations',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_permissions',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_revisions',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_share_links',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_suggestions',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_template_locales',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('document_templates',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('documents',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('notifications',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('signed_document_access',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('signed_share_sessions',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('standalone_signed_pdf_shares',0,'2026-09-23 11:18:25');

INSERT INTO "__backup_20260724_manifest" VALUES('user_profiles',0,'2026-09-23 11:18:25');

INSERT INTO "knowledge_base_article_versions" VALUES('kbv-ai-sources-1','kb-ai-sources',1,'Как AI-юрист JURO работает с источниками','AI-yurist JURO manbalar bilan qanday ishlaydi',NULL,'Как отличить подтверждённую норму от вывода AI и когда подключать юриста.','Tasdiqlangan norma, AI xulosasi va yurist yordami qachon kerakligini ajrating.',NULL,'[{"heading":"Как формируется ответ","paragraphs":["AI-юрист JURO сначала уточняет факты, затем отделяет подтверждённые нормы от предположений и показывает практические следующие шаги."]},{"heading":"Какие источники используются","paragraphs":["Для юридически значимых выводов JURO использует официальные материалы lex.uz, практические сценарии advice.uz и явно отмеченные внутренние материалы JURO. Ссылка, редакция и дата проверки показываются рядом с источником."]},{"heading":"Когда нужен живой юрист","paragraphs":["Если основание не подтверждено, источник устарел или ситуация содержит критический срок, ответ помечается предупреждением и предлагает передать контекст специалисту."]}]','[{"heading":"Javob qanday tuziladi","paragraphs":["AI-yurist JURO avval faktlarni aniqlashtiradi, so‘ng tasdiqlangan normalarni taxminlardan ajratadi va amaliy keyingi qadamlarni ko‘rsatadi."]},{"heading":"Qaysi manbalar ishlatiladi","paragraphs":["Yuridik ahamiyatga ega xulosalar uchun JURO lex.uz rasmiy materiallari, advice.uz amaliy ssenariylari va alohida belgilangan JURO ichki materiallaridan foydalanadi. Havola, tahrir va tekshiruv sanasi manba yonida ko‘rsatiladi."]},{"heading":"Qachon jonli yurist kerak","paragraphs":["Asos tasdiqlanmasa, manba eskirgan bo‘lsa yoki vaziyatda muhim muddat mavjud bo‘lsa, javob ogohlantirish bilan belgilanadi va kontekstni mutaxassisga topshirish taklif etiladi."]}]',NULL,'["account-security","cases-and-deadlines"]','766834da5a9878b335c6837e52fcb350df4ea927699bf6b39bbe5e6f8929952c','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z',NULL,NULL,NULL,NULL,'body-v1');

INSERT INTO "knowledge_base_article_versions" VALUES('kbv-analysis-files-1','kb-analysis-files',1,'Какие файлы можно проверить','Qaysi fayllarni tekshirish mumkin',NULL,'Форматы, лимиты и этапы безопасной обработки документов.','Hujjatlarni xavfsiz qayta ishlash formatlari, limitlari va bosqichlari.',NULL,'[{"heading":"Поддерживаемые материалы","paragraphs":["Можно загрузить PDF, DOCX, JPG или PNG. Один файл — до 50 МБ, до 20 файлов в одном пакете и до 500 страниц на пакет."]},{"heading":"Что происходит после загрузки","paragraphs":["Файл загружается в закрытое хранилище, проходит проверку типа и безопасности, извлечение текста или OCR и только после статуса готовности передаётся в анализ."]},{"heading":"Если текст распознан плохо","paragraphs":["JURO показывает предупреждение и страницы с низкой уверенностью. Нечитаемые фрагменты не должны додумываться системой."]}]','[{"heading":"Qo‘llab-quvvatlanadigan materiallar","paragraphs":["PDF, DOCX, JPG yoki PNG yuklash mumkin. Bitta fayl 50 MB gacha, bitta paketda 20 tagacha fayl va 500 betgacha bo‘lishi mumkin."]},{"heading":"Yuklangandan keyin nima bo‘ladi","paragraphs":["Fayl yopiq saqlash joyiga yuklanadi, turi va xavfsizligi tekshiriladi, matn yoki OCR olinadi va faqat tayyor holatidan keyin tahlilga yuboriladi."]},{"heading":"Matn yomon tanilsa","paragraphs":["JURO ogohlantirish va ishonchliligi past sahifalarni ko‘rsatadi. O‘qib bo‘lmaydigan qismlar tizim tomonidan to‘qib chiqarilmasligi kerak."]}]',NULL,'["ai-lawyer-sources","account-security"]','e799a860c1d028f257908e65c504c51ed806fb25bcbc8d6efe0f638382597f53','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z',NULL,NULL,NULL,NULL,'body-v1');

INSERT INTO "knowledge_base_article_versions" VALUES('kbv-account-security-1','kb-account-security',1,'Как защитить аккаунт JURO','JURO hisobini qanday himoya qilish kerak',NULL,'Сессии, 2FA и безопасная работа с доступом.','Sessiyalar, 2FA va kirish huquqi bilan xavfsiz ishlash.',NULL,'[{"heading":"Проверяйте активные устройства","paragraphs":["В настройках безопасности можно посмотреть активные сессии, завершить одну из них или выйти на всех устройствах."]},{"heading":"Включите 2FA","paragraphs":["Для дополнительной защиты используйте приложение-аутентификатор и сохраните резервные коды в отдельном безопасном месте. JURO не просит отправлять коды или ключи в поддержку."]},{"heading":"Контролируйте доступ","paragraphs":["Доступ юриста к делу предоставляется отдельно, показывает доступные материалы и может быть отозван пользователем."]}]','[{"heading":"Faol qurilmalarni tekshiring","paragraphs":["Xavfsizlik sozlamalarida faol sessiyalarni ko‘rish, bittasini yakunlash yoki barcha qurilmalardan chiqish mumkin."]},{"heading":"2FA ni yoqing","paragraphs":["Qo‘shimcha himoya uchun autentifikator ilovasidan foydalaning va zaxira kodlarni alohida xavfsiz joyda saqlang. JURO kod yoki kalitlarni qo‘llab-quvvatlash xizmatiga yuborishni so‘ramaydi."]},{"heading":"Kirish huquqini boshqaring","paragraphs":["Yuristga ish bo‘yicha kirish alohida beriladi, ochiq materiallar ko‘rsatiladi va foydalanuvchi tomonidan bekor qilinishi mumkin."]}]',NULL,'["document-analysis-files","cases-and-deadlines"]','27064ac2163495ca2aa778bd0eadf90203fb71f5759da14c8178c0c4b7462400','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z',NULL,NULL,NULL,NULL,'body-v1');

INSERT INTO "knowledge_base_article_versions" VALUES('kbv-cases-deadlines-1','kb-cases-deadlines',1,'Как работают дела, планы и сроки','Ishlar, rejalar va muddatlar qanday ishlaydi',NULL,'Как собрать чат, документы, задачи и контрольные даты в одном деле.','Chat, hujjatlar, vazifalar va nazorat sanalarini bitta ishda jamlang.',NULL,'[{"heading":"Что хранится в деле","paragraphs":["Дело объединяет чаты, документы, анализы, источники, задачи, календарные события и доступ юриста в одном контексте."]},{"heading":"Когда создаются задачи","paragraphs":["AI сначала предлагает план. Задачи появляются только после подтверждения пользователем действия «Добавить в дело»."]},{"heading":"Как проверять срок","paragraphs":["Для срока показываются исходная дата, правовое основание, тип дней, учтённые выходные и итоговая дата. Если исходная дата неизвестна, срок остаётся предварительным до уточнения."]}]','[{"heading":"Ishda nima saqlanadi","paragraphs":["Ish chatlar, hujjatlar, tahlillar, manbalar, vazifalar, kalendar voqealari va yurist kirishini bitta kontekstda birlashtiradi."]},{"heading":"Vazifalar qachon yaratiladi","paragraphs":["AI avval reja taklif qiladi. Vazifalar faqat foydalanuvchi «Ishga qo‘shish» amalini tasdiqlagandan keyin paydo bo‘ladi."]},{"heading":"Muddatni qanday tekshirish kerak","paragraphs":["Muddat uchun boshlang‘ich sana, huquqiy asos, kun turi, hisobga olingan dam olish kunlari va yakuniy sana ko‘rsatiladi. Boshlang‘ich sana noma’lum bo‘lsa, aniqlashtirilguncha muddat dastlabki bo‘lib qoladi."]}]',NULL,'["ai-lawyer-sources","document-analysis-files"]','fb9ea3e7015697d338770309d3eccf552732690a64290273b7167b6cb5366618','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z',NULL,NULL,NULL,NULL,'body-v1');

INSERT INTO "knowledge_base_articles" VALUES('kb-ai-sources','ai-lawyer-sources','ai','published','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z',NULL,NULL,NULL,NULL);

INSERT INTO "knowledge_base_articles" VALUES('kb-analysis-files','document-analysis-files','documents','published','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z',NULL,NULL,NULL,NULL);

INSERT INTO "knowledge_base_articles" VALUES('kb-account-security','account-security','security','published','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z',NULL,NULL,NULL,NULL);

INSERT INTO "knowledge_base_articles" VALUES('kb-cases-deadlines','cases-and-deadlines','cases','published','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z','2026-08-04T00:00:00.000Z',NULL,NULL,NULL,NULL);

ALTER TABLE "activity_events" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "activity_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "consultation_requests" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "consultation_requests" ADD FOREIGN KEY ("requester_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "contacts" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_answers" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_attachments" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_attachments" ADD FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_change_proposals" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_change_proposals" ADD FOREIGN KEY ("author_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_collaborators" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_collaborators" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_collaborators" ADD FOREIGN KEY ("invited_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_comments" ADD FOREIGN KEY ("thread_id") REFERENCES document_comment_threads(id);

ALTER TABLE "document_comments" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_comments" ADD FOREIGN KEY ("author_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_current_content" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_files" ADD FOREIGN KEY ("workspace_id") REFERENCES workspaces(id);

ALTER TABLE "document_files" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_files" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_share_links" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_share_links" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_template_locales" ADD FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "documents" ADD FOREIGN KEY ("case_id") REFERENCES cases(id);

ALTER TABLE "documents" ADD FOREIGN KEY ("plan_step_id") REFERENCES action_plan_steps(id);

ALTER TABLE "documents" ADD FOREIGN KEY ("workspace_id") REFERENCES workspaces(id);

ALTER TABLE "documents" ADD FOREIGN KEY ("case_linked_by_user_id") REFERENCES "user_profiles"("id") ON DELETE set null;

ALTER TABLE "documents" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "documents" ADD FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "notifications" ADD FOREIGN KEY ("workspace_id") REFERENCES workspaces(id);

ALTER TABLE "notifications" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "notifications" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "signed_document_access" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "signed_document_access" ADD FOREIGN KEY ("collaborator_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "signed_share_sessions" ADD FOREIGN KEY ("share_id") REFERENCES "standalone_signed_pdf_shares"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "standalone_signed_pdf_shares" ADD FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "standalone_signed_pdf_shares" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_profiles" ADD FOREIGN KEY ("default_workspace_id") REFERENCES "workspaces"("id") ON DELETE set null;

ALTER TABLE "document_approvals" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_approvals" ADD FOREIGN KEY ("participant_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_comment_threads" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_comment_threads" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_comment_threads" ADD FOREIGN KEY ("resolved_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_invitations" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_invitations" ADD FOREIGN KEY ("invited_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_invitations" ADD FOREIGN KEY ("target_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "document_permissions" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_permissions" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_permissions" ADD FOREIGN KEY ("granted_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_revisions" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_revisions" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "document_suggestions" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_suggestions" ADD FOREIGN KEY ("author_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_suggestions" ADD FOREIGN KEY ("decided_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "auth_sessions" ADD FOREIGN KEY ("device_id") REFERENCES auth_devices(id);

ALTER TABLE "auth_sessions" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "cases" ADD FOREIGN KEY ("workspace_id") REFERENCES workspaces(id);

ALTER TABLE "cases" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "case_events" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "case_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "action_plans" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "action_plans" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "action_plan_steps" ADD FOREIGN KEY ("plan_id") REFERENCES "action_plans"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "action_plan_steps" ADD FOREIGN KEY ("assignee_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "consultation_bookings" ADD FOREIGN KEY ("workspace_id") REFERENCES workspaces(id);

ALTER TABLE "consultation_bookings" ADD FOREIGN KEY ("slot_id") REFERENCES "consultation_slots"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "consultation_bookings" ADD FOREIGN KEY ("requester_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "consultation_bookings" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "consultation_bookings" ADD FOREIGN KEY ("plan_step_id") REFERENCES "action_plan_steps"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "workspace_members" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;

ALTER TABLE "workspace_members" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE cascade;

ALTER TABLE "workspace_invitations" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;

ALTER TABLE "workspace_invitations" ADD FOREIGN KEY ("invited_by_user_id") REFERENCES "user_profiles"("id");

ALTER TABLE "workspace_audit_events" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;

ALTER TABLE "workspace_audit_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON DELETE set null;

ALTER TABLE "consents" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON DELETE cascade;

ALTER TABLE "consents" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE cascade;

ALTER TABLE "account_deletion_requests" ADD FOREIGN KEY ("verification_challenge_id") REFERENCES account_deletion_challenges(id);

ALTER TABLE "account_deletion_requests" ADD FOREIGN KEY ("requested_session_id") REFERENCES auth_sessions(id);

ALTER TABLE "account_deletion_requests" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "confirmed_facts" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "confirmed_facts" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "confirmed_facts" ADD FOREIGN KEY ("confirmed_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "conversation_messages" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "conversation_sources" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "conversation_sources" ADD FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "conversation_sources" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "conversations" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "conversations" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "conversations" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "payments" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "payments" ADD FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "subscriptions" ADD FOREIGN KEY ("plan_version_id") REFERENCES subscription_plan_versions(id);

ALTER TABLE "subscriptions" ADD FOREIGN KEY ("order_id") REFERENCES marketplace_orders(id);

ALTER TABLE "subscriptions" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_analyses" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE set null;

ALTER TABLE "document_analyses" ADD FOREIGN KEY ("case_linked_by_user_id") REFERENCES "user_profiles"("id") ON DELETE set null;

ALTER TABLE "document_analyses" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_analyses" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_analyses" ADD FOREIGN KEY ("uploaded_file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_risks" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "comparison_changes" ADD FOREIGN KEY ("decided_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "comparison_changes" ADD FOREIGN KEY ("comparison_id") REFERENCES "document_comparisons"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_comparisons" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_comparisons" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_comparisons" ADD FOREIGN KEY ("version_one_file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "document_comparisons" ADD FOREIGN KEY ("version_two_file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "document_comparisons" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "legislation_updates" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "monitoring_preferences" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_preferences" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "job_outbox" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "job_runs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "auth_devices" ADD FOREIGN KEY ("continuity_id") REFERENCES auth_device_continuities(id) ON DELETE set null;

ALTER TABLE "auth_devices" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_backup_codes" ADD FOREIGN KEY ("credential_id") REFERENCES "auth_totp_credentials"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_backup_codes" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_mfa_challenges" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_mfa_challenges" ADD FOREIGN KEY ("credential_id") REFERENCES "auth_totp_credentials"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_mfa_challenges" ADD FOREIGN KEY ("email_otp_challenge_id") REFERENCES "auth_otp_challenges"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_mfa_factor_claims" ADD FOREIGN KEY ("credential_id") REFERENCES "auth_totp_credentials"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_totp_credentials" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "platform_staff_assignments" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "platform_staff_assignments" ADD FOREIGN KEY ("granted_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "platform_staff_assignments" ADD FOREIGN KEY ("revoked_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "platform_staff_role_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "platform_staff_role_events" ADD FOREIGN KEY ("actor_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "platform_staff_role_events" ADD FOREIGN KEY ("subject_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "platform_staff_role_events" ADD FOREIGN KEY ("subject_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_review_queue" ADD FOREIGN KEY ("decided_by_user_id") REFERENCES user_profiles(id);

ALTER TABLE "legal_review_queue" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_review_queue" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_review_queue" ADD FOREIGN KEY ("assigned_to_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "legal_source_chunks" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_chunks" ADD FOREIGN KEY ("section_id") REFERENCES "legal_source_sections"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_sections" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_versions" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_versions" ADD FOREIGN KEY ("verified_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "source_sync_errors" ADD FOREIGN KEY ("run_id") REFERENCES "source_sync_runs"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_fetch_requests" ADD FOREIGN KEY ("requested_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "legal_source_fetch_requests" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_fetch_requests" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_publications" ADD FOREIGN KEY ("review_id") REFERENCES "legal_review_queue"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_publications" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_publications" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_publications" ADD FOREIGN KEY ("published_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "auth_session_token_history" ADD FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_session_token_history" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_session_token_replays" ADD FOREIGN KEY ("token_history_id") REFERENCES "auth_session_token_history"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_session_token_replays" ADD FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_session_token_replays" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_device_continuities" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_current_activations" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_current_activations" ADD FOREIGN KEY ("publication_id") REFERENCES "legal_source_publications"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_current_activations" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_current_activations" ADD FOREIGN KEY ("activated_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_lifecycle_events" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_lifecycle_events" ADD FOREIGN KEY ("publication_id") REFERENCES "legal_source_publications"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_lifecycle_events" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_lifecycle_events" ADD FOREIGN KEY ("previous_publication_id") REFERENCES "legal_source_publications"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_lifecycle_events" ADD FOREIGN KEY ("previous_version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_lifecycle_events" ADD FOREIGN KEY ("acted_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "ai_runs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_runs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_runs" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "ai_runs" ADD FOREIGN KEY ("request_message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "ai_runs" ADD FOREIGN KEY ("response_message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "ai_usage_ledger" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_usage_ledger" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_usage_ledger" ADD FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "message_branches" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "message_branches" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "message_branches" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "message_branches" ADD FOREIGN KEY ("forked_from_message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "message_branches" ADD FOREIGN KEY ("request_message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "message_branches" ADD FOREIGN KEY ("response_message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "message_versions" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "message_versions" ADD FOREIGN KEY ("branch_id") REFERENCES "message_branches"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "message_versions" ADD FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "message_versions" ADD FOREIGN KEY ("source_message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "message_versions" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_exports" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_exports" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_exports" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_report_exports" ADD FOREIGN KEY ("source_version_id") REFERENCES "analysis_document_versions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_report_exports" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_report_exports" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_report_exports" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "file_extractions" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "file_extractions" ADD FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "file_extractions" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "file_extractions" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "task_reminders" ADD FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "tasks" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "tasks" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "tasks" ADD FOREIGN KEY ("plan_step_id") REFERENCES "action_plan_steps"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "tasks" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "conflict_checks" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "conflict_checks" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "conflict_checks" ADD FOREIGN KEY ("reviewed_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_access_grants" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_access_grants" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_access_grants" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_access_grants" ADD FOREIGN KEY ("granted_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_profiles" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_requests" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_requests" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_requests" ADD FOREIGN KEY ("requester_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_requests" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "support_messages" ADD FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "support_messages" ADD FOREIGN KEY ("author_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "support_tickets" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "support_tickets" ADD FOREIGN KEY ("requester_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "advice_scenarios" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "scenario_versions" ADD FOREIGN KEY ("scenario_id") REFERENCES "advice_scenarios"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "scenario_versions" ADD FOREIGN KEY ("legal_source_version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "action_plan_versions" ADD FOREIGN KEY ("plan_id") REFERENCES "action_plans"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "action_plan_versions" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_offers" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_offers" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_offers" ADD FOREIGN KEY ("responded_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_request_messages" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_request_messages" ADD FOREIGN KEY ("author_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_reviews" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_reviews" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_reviews" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_reviews" ADD FOREIGN KEY ("requester_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_review_moderation" ADD FOREIGN KEY ("review_id") REFERENCES "lawyer_reviews"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_review_moderation" ADD FOREIGN KEY ("moderator_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_profile_moderation" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_profile_moderation" ADD FOREIGN KEY ("moderator_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "ai_feedback" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_feedback" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_feedback" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_feedback" ADD FOREIGN KEY ("assistant_message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_feedback" ADD FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "entitlement_usage" ADD FOREIGN KEY ("entitlement_id") REFERENCES "subscription_entitlements"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "entitlement_usage" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "entitlement_usage" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "entitlement_usage" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "ledger_entries" ADD FOREIGN KEY ("transaction_id") REFERENCES "ledger_transactions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "ledger_entries" ADD FOREIGN KEY ("account_id") REFERENCES "ledger_accounts"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "ledger_transactions" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "ledger_transactions" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "ledger_transactions" ADD FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "marketplace_orders" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "marketplace_orders" ADD FOREIGN KEY ("customer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "order_items" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "payment_attempts" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "payment_attempts" ADD FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "payment_provider_events" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "payment_provider_events" ADD FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "pricing_policy_versions" ADD FOREIGN KEY ("policy_id") REFERENCES "pricing_policies"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "pricing_policy_versions" ADD FOREIGN KEY ("approved_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "pricing_policy_versions" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "pricing_snapshots" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "pricing_snapshots" ADD FOREIGN KEY ("pricing_policy_version_id") REFERENCES "pricing_policy_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "subscription_entitlements" ADD FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "subscription_invoices" ADD FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "subscription_invoices" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "subscription_invoices" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "subscription_plan_versions" ADD FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "subscription_plan_versions" ADD FOREIGN KEY ("approved_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "subscription_plan_versions" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "tax_components" ADD FOREIGN KEY ("pricing_snapshot_id") REFERENCES "pricing_snapshots"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "tax_components" ADD FOREIGN KEY ("tax_profile_id") REFERENCES "tax_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "tax_profiles" ADD FOREIGN KEY ("approved_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "memory_sources" ADD FOREIGN KEY ("memory_id") REFERENCES "user_memories"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "memory_sources" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "memory_sources" ADD FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "user_memories" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_memories" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_memory_settings" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_service_proposals" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_service_proposals" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_service_proposals" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_service_proposals" ADD FOREIGN KEY ("client_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_service_proposals" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_service_proposals" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_service_proposal_versions" ADD FOREIGN KEY ("proposal_id") REFERENCES "legal_service_proposals"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_service_proposal_versions" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "proposal_milestones" ADD FOREIGN KEY ("proposal_id") REFERENCES "legal_service_proposals"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "proposal_acceptances" ADD FOREIGN KEY ("proposal_id") REFERENCES "legal_service_proposals"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "proposal_acceptances" ADD FOREIGN KEY ("client_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "proposal_acceptances" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "order_agreements" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "order_agreements" ADD FOREIGN KEY ("proposal_id") REFERENCES "legal_service_proposals"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "order_agreements" ADD FOREIGN KEY ("acceptance_id") REFERENCES "proposal_acceptances"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "order_consents" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "order_consents" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "order_consents" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "settlement_allocations" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "settlement_allocations" ADD FOREIGN KEY ("proposal_id") REFERENCES "legal_service_proposals"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "settlement_allocations" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "settlement_allocations" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "settlement_allocations" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_payables" ADD FOREIGN KEY ("settlement_allocation_id") REFERENCES "settlement_allocations"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_payables" ADD FOREIGN KEY ("order_id") REFERENCES "marketplace_orders"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_payables" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_payables" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_payables" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "guest_ai_runs" ADD FOREIGN KEY ("session_id") REFERENCES "guest_ai_sessions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "file_scan_results" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "file_scan_results" ADD FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "file_scan_results" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "file_scan_results" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_document_versions" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_document_versions" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_document_versions" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_document_versions" ADD FOREIGN KEY ("parent_version_id") REFERENCES "analysis_document_versions"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "analysis_document_versions" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "suggested_revisions" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "suggested_revisions" ADD FOREIGN KEY ("risk_id") REFERENCES "document_risks"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "suggested_revisions" ADD FOREIGN KEY ("source_version_id") REFERENCES "analysis_document_versions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "suggested_revisions" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "suggested_revisions" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "suggested_revisions" ADD FOREIGN KEY ("decided_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "suggested_revisions" ADD FOREIGN KEY ("applied_version_id") REFERENCES "analysis_document_versions"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "comparison_exports" ADD FOREIGN KEY ("comparison_id") REFERENCES "document_comparisons"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "comparison_exports" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "comparison_exports" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_version_object_writes" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_version_object_writes" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_version_object_writes" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_case_link_events" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_case_link_events" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_legal_bookmarks" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_legal_bookmarks" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_legal_bookmarks" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "user_legal_bookmarks" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "user_legal_bookmarks" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "user_legal_bookmark_events" ADD FOREIGN KEY ("bookmark_id") REFERENCES "user_legal_bookmarks"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "knowledge_base_articles" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_articles" ADD FOREIGN KEY ("updated_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_articles" ADD FOREIGN KEY ("status_changed_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_feedback" ADD FOREIGN KEY ("article_id") REFERENCES "knowledge_base_articles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "knowledge_base_feedback" ADD FOREIGN KEY ("version_id") REFERENCES "knowledge_base_article_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_feedback" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "knowledge_base_feedback" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "knowledge_base_feedback_events" ADD FOREIGN KEY ("feedback_id") REFERENCES "knowledge_base_feedback"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "knowledge_base_authoring_events" ADD FOREIGN KEY ("article_id") REFERENCES "knowledge_base_articles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_authoring_events" ADD FOREIGN KEY ("version_id") REFERENCES "knowledge_base_article_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_authoring_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_review_replies" ADD FOREIGN KEY ("review_id") REFERENCES "lawyer_reviews"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_review_replies" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_review_replies" ADD FOREIGN KEY ("author_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_review_reply_moderation" ADD FOREIGN KEY ("reply_id") REFERENCES "lawyer_review_replies"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_review_reply_moderation" ADD FOREIGN KEY ("moderator_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "user_document_index_jobs" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_document_index_jobs" ADD FOREIGN KEY ("document_version_id") REFERENCES "analysis_document_versions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_document_index_jobs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_document_index_jobs" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_document_vector_chunks" ADD FOREIGN KEY ("job_id") REFERENCES "user_document_index_jobs"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_provider_usage_events" ADD FOREIGN KEY ("price_version_id") REFERENCES "ai_model_price_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "operational_alert_jobs" ADD FOREIGN KEY ("cost_control_event_id") REFERENCES "ai_cost_control_events"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "system_status_incident_components" ADD FOREIGN KEY ("incident_id") REFERENCES "system_status_incidents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "system_status_updates" ADD FOREIGN KEY ("incident_id") REFERENCES "system_status_incidents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "platform_audit_access_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "platform_audit_access_events" ADD FOREIGN KEY ("actor_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "ai_quality_review_contents" ADD FOREIGN KEY ("feedback_id") REFERENCES "ai_feedback"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_quality_review_contents" ADD FOREIGN KEY ("reviewer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "ai_runtime_config_versions" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "ai_runtime_config_versions" ADD FOREIGN KEY ("actor_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_corpus_alert_jobs" ADD FOREIGN KEY ("source_sync_run_id") REFERENCES "source_sync_runs"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_source_applicability_records" ADD FOREIGN KEY ("review_id") REFERENCES "legal_review_queue"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_applicability_records" ADD FOREIGN KEY ("source_id") REFERENCES "legal_sources"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_applicability_records" ADD FOREIGN KEY ("version_id") REFERENCES "legal_source_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_source_applicability_records" ADD FOREIGN KEY ("reviewed_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "document_evaluation_review_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "document_evaluation_review_events" ADD FOREIGN KEY ("actor_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "task_reminder_email_jobs" ADD FOREIGN KEY ("reminder_id") REFERENCES "task_reminders"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "task_reminder_email_jobs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "task_reminder_email_jobs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "operational_job_redrive_events" ADD FOREIGN KEY ("source_job_id") REFERENCES "job_runs"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "operational_job_redrive_events" ADD FOREIGN KEY ("outbox_id") REFERENCES "job_outbox"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "case_lifecycle_events" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "case_lifecycle_events" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "case_lifecycle_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_versions" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_versions" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_versions" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_version_object_writes" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_version_object_writes" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_version_object_writes" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_version_restore_events" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_version_restore_events" ADD FOREIGN KEY ("owner_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_version_restore_events" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_version_restore_events" ADD FOREIGN KEY ("source_version_id") REFERENCES "builder_document_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "admin_handoff_tickets" ADD FOREIGN KEY ("staff_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "admin_handoff_tickets" ADD FOREIGN KEY ("source_session_id") REFERENCES "auth_sessions"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "admin_domain_sessions" ADD FOREIGN KEY ("staff_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "admin_domain_sessions" ADD FOREIGN KEY ("source_session_id") REFERENCES "auth_sessions"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "admin_domain_audit_events" ADD FOREIGN KEY ("admin_session_id") REFERENCES "admin_domain_sessions"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "admin_domain_audit_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "lawyer_profile_lifecycle_events" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_profile_lifecycle_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "demo_payment_runs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "demo_payment_runs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "demo_payment_events" ADD FOREIGN KEY ("run_id") REFERENCES "demo_payment_runs"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "demo_payment_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_profile_trust_designations" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_profile_trust_designations" ADD FOREIGN KEY ("moderator_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_monitoring_change_events" ADD FOREIGN KEY ("metadata_id") REFERENCES "legal_monitoring_metadata"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_analysis_lawyer_verifications" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_analysis_lawyer_verifications" ADD FOREIGN KEY ("document_version_id") REFERENCES "analysis_document_versions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_analysis_lawyer_verifications" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_analysis_lawyer_verifications" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "document_analysis_lawyer_verifications" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "staging_legal_evaluation_attempts" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "staging_legal_evaluation_attempts" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "staging_legal_evaluation_attempts" ADD FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "staging_legal_evaluation_agent_reviews" ADD FOREIGN KEY ("attempt_id") REFERENCES "staging_legal_evaluation_attempts"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "staging_legal_evaluation_agent_reviews" ADD FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "ai_quality_review_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "ai_quality_review_events" ADD FOREIGN KEY ("actor_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_evaluation_human_attestations" ADD FOREIGN KEY ("reviewer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_evaluation_human_attestations" ADD FOREIGN KEY ("reviewer_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_evaluation_human_review_records" ADD FOREIGN KEY ("attestation_id") REFERENCES "legal_evaluation_human_attestations"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_evaluation_human_review_records" ADD FOREIGN KEY ("reviewer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_evaluation_human_review_records" ADD FOREIGN KEY ("reviewer_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE no action;

ALTER TABLE "legal_corpus_variants" ADD FOREIGN KEY ("document_id") REFERENCES "legal_corpus_documents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_versions" ADD FOREIGN KEY ("variant_id") REFERENCES "legal_corpus_variants"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_versions" ADD FOREIGN KEY ("previous_version_id") REFERENCES "legal_corpus_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_ingestion_jobs" ADD FOREIGN KEY ("variant_id") REFERENCES "legal_corpus_variants"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_failures" ADD FOREIGN KEY ("job_id") REFERENCES "legal_corpus_ingestion_jobs"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "legal_corpus_snapshots" ADD FOREIGN KEY ("created_by_run_id") REFERENCES "legal_corpus_runs"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "legal_corpus_source_aliases" ADD FOREIGN KEY ("document_id") REFERENCES "legal_corpus_documents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_discovery_documents" ADD FOREIGN KEY ("checkpoint_id") REFERENCES "legal_corpus_discovery_checkpoints"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_publications" ADD FOREIGN KEY ("document_id") REFERENCES "legal_corpus_documents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_publications" ADD FOREIGN KEY ("variant_id") REFERENCES "legal_corpus_variants"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_publications" ADD FOREIGN KEY ("version_id") REFERENCES "legal_corpus_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_withdrawals" ADD FOREIGN KEY ("publication_id") REFERENCES "legal_corpus_owner_publications"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_withdrawals" ADD FOREIGN KEY ("document_id") REFERENCES "legal_corpus_documents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_ingestions" ADD FOREIGN KEY ("document_id") REFERENCES "legal_corpus_documents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_ingestions" ADD FOREIGN KEY ("variant_id") REFERENCES "legal_corpus_variants"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_ingestions" ADD FOREIGN KEY ("version_id") REFERENCES "legal_corpus_versions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_ingestion_withdrawals" ADD FOREIGN KEY ("publication_id") REFERENCES "legal_corpus_owner_ingestions"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_ingestion_withdrawals" ADD FOREIGN KEY ("document_id") REFERENCES "legal_corpus_documents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_upload_requests" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_upload_requests" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_upload_requests" ADD FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_upload_requests" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "legal_corpus_owner_upload_requests" ADD FOREIGN KEY ("actor_assignment_id") REFERENCES "platform_staff_assignments"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_availability_rules" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_unavailability_periods" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_consultations" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_consultations" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_consultations" ADD FOREIGN KEY ("client_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_consultations" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_task_comments" ADD FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_task_comments" ADD FOREIGN KEY ("author_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_document_requests" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_document_requests" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_document_requests" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_document_requests" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_document_requests" ADD FOREIGN KEY ("client_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_document_requests" ADD FOREIGN KEY ("provided_document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_request_message_attachments" ADD FOREIGN KEY ("message_id") REFERENCES "lawyer_request_messages"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_request_message_attachments" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_request_message_attachments" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_request_message_attachments" ADD FOREIGN KEY ("shared_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_request_message_attachments" ADD FOREIGN KEY ("recipient_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "analysis_export_idempotency_registry" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_question_intakes" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_question_intakes" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_password_credentials" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_mfa_attempt_reservations" ADD FOREIGN KEY ("challenge_id") REFERENCES "auth_mfa_challenges"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_session_handoffs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_session_handoffs" ADD FOREIGN KEY ("source_session_id") REFERENCES "auth_sessions"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "user_acceptances" ADD FOREIGN KEY ("policy_document_id") REFERENCES "policy_documents"("id");

ALTER TABLE "user_acceptances" ADD FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id");

ALTER TABLE "user_acceptances" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "security_email_jobs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "security_email_jobs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "security_email_jobs" ADD FOREIGN KEY ("challenge_id") REFERENCES "email_change_challenges"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "security_email_jobs" ADD FOREIGN KEY ("auth_otp_challenge_id") REFERENCES "auth_otp_challenges"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "auth_pending_registrations" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "email_change_challenges" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "email_change_challenges" ADD FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "security_notification_jobs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "security_notification_jobs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "account_deletion_challenges" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "account_deletion_challenges" ADD FOREIGN KEY ("session_id") REFERENCES "auth_sessions"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "ai_document_prefill_handoffs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_document_prefill_handoffs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_document_prefill_handoffs" ADD FOREIGN KEY ("assistant_message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "ai_document_prefill_handoffs" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_analysis_handoffs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_analysis_handoffs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_analysis_handoffs" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_analysis_handoffs" ADD FOREIGN KEY ("file_id") REFERENCES "document_files"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "builder_document_analysis_handoffs" ADD FOREIGN KEY ("analysis_id") REFERENCES "document_analyses"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "voice_recordings" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "voice_recordings" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "voice_recordings" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "voice_recordings" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "voice_recordings" ADD FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "knowledge_base_article_versions" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_article_versions" ADD FOREIGN KEY ("updated_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_article_versions" ADD FOREIGN KEY ("published_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "knowledge_base_article_versions" ADD FOREIGN KEY ("article_id") REFERENCES "knowledge_base_articles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_references" ADD FOREIGN KEY ("ai_run_id") REFERENCES "ai_runs"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_references" ADD FOREIGN KEY ("guest_run_id") REFERENCES "guest_ai_runs"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_references" ADD FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "legal_source_references" ADD FOREIGN KEY ("message_id") REFERENCES "conversation_messages"("id") ON UPDATE no action ON DELETE cascade;

CREATE INDEX "activity_events_document_idx" ON "activity_events" ("document_id","created_at");

CREATE INDEX "consultation_requests_user_idx" ON "consultation_requests" ("requester_user_id");

CREATE INDEX "contacts_owner_idx" ON "contacts" ("owner_user_id");

CREATE INDEX "document_attachments_document_idx" ON "document_attachments" ("document_id");

CREATE INDEX "document_change_proposals_document_idx" ON "document_change_proposals" ("document_id");

CREATE UNIQUE INDEX "document_collaborators_uidx" ON "document_collaborators" ("document_id","user_id");

CREATE INDEX "document_collaborators_user_idx" ON "document_collaborators" ("user_id");

CREATE INDEX "document_comments_document_idx" ON "document_comments" ("document_id");

CREATE UNIQUE INDEX "document_files_r2_key_unique" ON "document_files" ("r2_key");

CREATE INDEX "document_files_document_idx" ON "document_files" ("document_id");

CREATE INDEX "document_files_owner_idx" ON "document_files" ("owner_user_id");

CREATE UNIQUE INDEX "document_share_links_token_hash_unique" ON "document_share_links" ("token_hash");

CREATE INDEX "document_share_links_document_idx" ON "document_share_links" ("document_id");

CREATE UNIQUE INDEX "template_locales_uidx" ON "document_template_locales" ("template_id","language");

CREATE UNIQUE INDEX "document_templates_key_unique" ON "document_templates" ("key");

CREATE INDEX "documents_owner_idx" ON "documents" ("owner_user_id");

CREATE INDEX "documents_status_idx" ON "documents" ("status");

CREATE INDEX "documents_updated_idx" ON "documents" ("updated_at");

CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id","created_at");

CREATE UNIQUE INDEX "signed_document_access_uidx" ON "signed_document_access" ("document_id","collaborator_user_id");

CREATE UNIQUE INDEX "signed_share_sessions_session_hash_unique" ON "signed_share_sessions" ("session_hash");

CREATE INDEX "signed_share_sessions_share_idx" ON "signed_share_sessions" ("share_id");

CREATE UNIQUE INDEX "standalone_signed_pdf_shares_token_hash_unique" ON "standalone_signed_pdf_shares" ("token_hash");

CREATE INDEX "standalone_signed_pdf_shares_file_idx" ON "standalone_signed_pdf_shares" ("file_id");

CREATE UNIQUE INDEX "user_profiles_email_uidx" ON "user_profiles" ("email");

CREATE UNIQUE INDEX "document_approvals_uidx" ON "document_approvals" ("document_id","participant_user_id","revision");

CREATE INDEX "document_comment_threads_document_idx" ON "document_comment_threads" ("document_id","status");

CREATE UNIQUE INDEX "document_invitations_token_hash_unique" ON "document_invitations" ("token_hash");

CREATE INDEX "document_invitations_document_idx" ON "document_invitations" ("document_id");

CREATE INDEX "document_invitations_target_idx" ON "document_invitations" ("target_user_id");

CREATE UNIQUE INDEX "document_permissions_uidx" ON "document_permissions" ("document_id","user_id","permission");

CREATE UNIQUE INDEX "document_revisions_uidx" ON "document_revisions" ("document_id","revision");

CREATE INDEX "document_suggestions_document_idx" ON "document_suggestions" ("document_id","status");

CREATE INDEX "auth_otp_email_idx" ON "auth_otp_challenges" ("email_hash","created_at");

CREATE INDEX "auth_otp_expiry_idx" ON "auth_otp_challenges" ("expires_at");

CREATE UNIQUE INDEX "auth_sessions_token_uidx" ON "auth_sessions" ("token_hash");

CREATE INDEX "auth_sessions_user_idx" ON "auth_sessions" ("user_id","expires_at");

CREATE INDEX "cases_owner_idx" ON "cases" ("owner_user_id","updated_at");

CREATE INDEX "case_events_case_idx" ON "case_events" ("case_id","created_at");

CREATE UNIQUE INDEX "action_plans_case_uidx" ON "action_plans" ("case_id");

CREATE UNIQUE INDEX "action_plan_steps_order_uidx" ON "action_plan_steps" ("plan_id","ordinal");

CREATE INDEX "action_plan_steps_due_idx" ON "action_plan_steps" ("due_at","status");

CREATE UNIQUE INDEX "consultation_slots_time_uidx" ON "consultation_slots" ("specialist_type","starts_at","ends_at");

CREATE UNIQUE INDEX "consultation_bookings_slot_uidx" ON "consultation_bookings" ("slot_id");

CREATE INDEX "consultation_bookings_user_idx" ON "consultation_bookings" ("requester_user_id","created_at");

CREATE INDEX "documents_case_idx" ON "documents" ("case_id","updated_at");

CREATE INDEX "documents_plan_step_idx" ON "documents" ("plan_step_id");

CREATE INDEX "workspaces_type_idx" ON "workspaces" ("type","created_at");

CREATE UNIQUE INDEX "workspace_members_uidx" ON "workspace_members" ("workspace_id","user_id");

CREATE INDEX "workspace_members_user_idx" ON "workspace_members" ("user_id","status");

CREATE UNIQUE INDEX "workspace_invitations_token_uidx" ON "workspace_invitations" ("token_hash");

CREATE INDEX "workspace_invitations_workspace_idx" ON "workspace_invitations" ("workspace_id","expires_at");

CREATE INDEX "workspace_audit_events_workspace_idx" ON "workspace_audit_events" ("workspace_id","created_at");

CREATE INDEX "workspace_audit_events_entity_idx" ON "workspace_audit_events" ("entity_type","entity_id");

CREATE INDEX "consents_user_idx" ON "consents" ("user_id","type","granted_at");

CREATE INDEX "consents_workspace_idx" ON "consents" ("workspace_id","type");

CREATE INDEX "account_deletion_requests_user_idx" ON "account_deletion_requests" ("user_id","requested_at");

CREATE INDEX "confirmed_facts_case_idx" ON "confirmed_facts" ("case_id","status");

CREATE INDEX "conversation_messages_conversation_idx" ON "conversation_messages" ("conversation_id","created_at");

CREATE UNIQUE INDEX "conversation_sources_uidx" ON "conversation_sources" ("conversation_id","message_id","source_id");

CREATE INDEX "conversations_workspace_idx" ON "conversations" ("workspace_id","updated_at");

CREATE UNIQUE INDEX "legal_sources_url_locale_uidx" ON "legal_sources" ("official_url","locale");

CREATE INDEX "payments_workspace_idx" ON "payments" ("workspace_id","created_at");

CREATE UNIQUE INDEX "subscriptions_workspace_uidx" ON "subscriptions" ("workspace_id");

CREATE INDEX "subscriptions_status_idx" ON "subscriptions" ("status","updated_at");

CREATE INDEX "cases_workspace_idx" ON "cases" ("workspace_id","updated_at");

CREATE INDEX "document_analyses_workspace_idx" ON "document_analyses" ("workspace_id","created_at");

CREATE UNIQUE INDEX "document_analyses_file_uidx" ON "document_analyses" ("uploaded_file_id");

CREATE INDEX "document_risks_analysis_idx" ON "document_risks" ("analysis_id","level");

CREATE INDEX "document_files_workspace_idx" ON "document_files" ("workspace_id","created_at");

CREATE UNIQUE INDEX "comparison_changes_order_uidx" ON "comparison_changes" ("comparison_id","ordinal");

CREATE INDEX "comparison_changes_type_idx" ON "comparison_changes" ("comparison_id","change_type");

CREATE INDEX "comparison_changes_risk_idx" ON "comparison_changes" ("comparison_id","risk_level","risk_effect");

CREATE INDEX "document_comparisons_workspace_idx" ON "document_comparisons" ("workspace_id","created_at");

CREATE INDEX "document_comparisons_owner_idx" ON "document_comparisons" ("owner_user_id","created_at");

CREATE INDEX "document_comparisons_status_idx" ON "document_comparisons" ("status","updated_at");

CREATE UNIQUE INDEX "legislation_updates_source_uidx" ON "legislation_updates" ("source_id","external_id");

CREATE INDEX "legislation_updates_status_idx" ON "legislation_updates" ("status","published_at");

CREATE UNIQUE INDEX "monitoring_preferences_user_workspace_uidx" ON "monitoring_preferences" ("workspace_id","user_id");

CREATE INDEX "monitoring_preferences_delivery_idx" ON "monitoring_preferences" ("frequency","last_delivered_at");

CREATE INDEX "backup_runs_environment_idx" ON "backup_runs" ("environment","created_at");

CREATE INDEX "backup_runs_status_idx" ON "backup_runs" ("status","updated_at");

CREATE INDEX "cleanup_runs_environment_idx" ON "cleanup_runs" ("environment","created_at");

CREATE INDEX "cleanup_runs_status_idx" ON "cleanup_runs" ("status","updated_at");

CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" ("expires_at");

CREATE INDEX "idempotency_keys_status_idx" ON "idempotency_keys" ("status","updated_at");

CREATE UNIQUE INDEX "job_outbox_idempotency_uidx" ON "job_outbox" ("idempotency_key");

CREATE INDEX "job_outbox_status_idx" ON "job_outbox" ("status","available_at");

CREATE INDEX "job_outbox_lease_idx" ON "job_outbox" ("status","lease_expires_at");

CREATE INDEX "job_outbox_workspace_idx" ON "job_outbox" ("workspace_id","created_at");

CREATE UNIQUE INDEX "job_runs_idempotency_uidx" ON "job_runs" ("idempotency_key");

CREATE UNIQUE INDEX "job_runs_message_uidx" ON "job_runs" ("queue_name","message_id");

CREATE INDEX "job_runs_status_idx" ON "job_runs" ("status","next_attempt_at");

CREATE INDEX "job_runs_lease_idx" ON "job_runs" ("status","lease_expires_at");

CREATE INDEX "job_runs_workspace_idx" ON "job_runs" ("workspace_id","created_at");

CREATE INDEX "scheduled_locks_expiry_idx" ON "scheduled_locks" ("expires_at");

CREATE UNIQUE INDEX "scheduled_runs_idempotency_uidx" ON "scheduled_runs" ("idempotency_key");

CREATE INDEX "scheduled_runs_schedule_idx" ON "scheduled_runs" ("schedule_name","scheduled_for");

CREATE INDEX "scheduled_runs_status_idx" ON "scheduled_runs" ("status","updated_at");

CREATE INDEX "auth_otp_ip_created_idx" ON "auth_otp_challenges" ("request_ip_hash","created_at");

CREATE INDEX "documents_workspace_updated_idx" ON "documents" ("workspace_id","updated_at");

CREATE INDEX "auth_devices_user_idx" ON "auth_devices" ("user_id","last_seen_at");

CREATE UNIQUE INDEX "security_events_hash_uidx" ON "security_events" ("event_hash");

CREATE UNIQUE INDEX "security_events_chain_uidx" ON "security_events" ("user_id","previous_hash");

CREATE INDEX "security_events_user_idx" ON "security_events" ("user_id","created_at");

CREATE INDEX "security_events_type_idx" ON "security_events" ("event_type","created_at");

CREATE INDEX "auth_sessions_device_idx" ON "auth_sessions" ("device_id","expires_at");

CREATE UNIQUE INDEX "auth_backup_codes_hmac_uidx" ON "auth_backup_codes" ("code_hmac");

CREATE INDEX "auth_backup_codes_user_batch_idx" ON "auth_backup_codes" ("user_id","batch_id","used_at");

CREATE INDEX "auth_backup_codes_credential_idx" ON "auth_backup_codes" ("credential_id","created_at");

CREATE UNIQUE INDEX "auth_mfa_challenges_token_uidx" ON "auth_mfa_challenges" ("token_hash");

CREATE UNIQUE INDEX "auth_mfa_challenges_email_otp_uidx" ON "auth_mfa_challenges" ("email_otp_challenge_id");

CREATE UNIQUE INDEX "auth_mfa_challenges_active_user_uidx" ON "auth_mfa_challenges" ("user_id","purpose") WHERE "auth_mfa_challenges"."consumed_at" IS NULL AND "auth_mfa_challenges"."invalidated_at" IS NULL;

CREATE INDEX "auth_mfa_challenges_expiry_idx" ON "auth_mfa_challenges" ("expires_at");

CREATE UNIQUE INDEX "auth_mfa_claims_operation_uidx" ON "auth_mfa_factor_claims" ("operation_id");

CREATE UNIQUE INDEX "auth_mfa_claims_factor_uidx" ON "auth_mfa_factor_claims" ("credential_id","factor_type","factor_key");

CREATE INDEX "auth_mfa_claims_created_idx" ON "auth_mfa_factor_claims" ("created_at");

CREATE INDEX "auth_totp_user_status_idx" ON "auth_totp_credentials" ("user_id","status");

CREATE UNIQUE INDEX "auth_totp_live_user_uidx" ON "auth_totp_credentials" ("user_id") WHERE "auth_totp_credentials"."status" IN ('pending','active');

CREATE UNIQUE INDEX "account_deletion_requests_challenge_uidx" ON "account_deletion_requests" ("verification_challenge_id");

CREATE UNIQUE INDEX "user_profiles_email_lookup_uidx" ON "user_profiles" ("email_lookup_key_version","email_lookup_hash") WHERE "user_profiles"."email_lookup_hash" IS NOT NULL;

CREATE INDEX "user_profiles_phone_lookup_idx" ON "user_profiles" ("phone_lookup_key_version","phone_lookup_hash") WHERE "user_profiles"."phone_lookup_hash" IS NOT NULL;

CREATE INDEX "document_invitations_target_lookup_idx" ON "document_invitations" ("target_identifier_kind","target_identifier_lookup_key_version","target_identifier_lookup_hash") WHERE "document_invitations"."target_identifier_lookup_hash" IS NOT NULL;

CREATE INDEX "workspace_invitations_email_lookup_idx" ON "workspace_invitations" ("workspace_id","email_lookup_key_version","email_lookup_hash") WHERE "workspace_invitations"."email_lookup_hash" IS NOT NULL;

CREATE INDEX "auth_otp_email_lookup_idx" ON "auth_otp_challenges" ("email_lookup_key_version","email_lookup_hash","created_at");

CREATE INDEX "auth_otp_ip_lookup_created_idx" ON "auth_otp_challenges" ("request_ip_lookup_key_version","request_ip_lookup_hash","created_at");

CREATE UNIQUE INDEX "platform_staff_assignments_active_uidx" ON "platform_staff_assignments" ("user_id","role") WHERE "platform_staff_assignments"."revoked_at" IS NULL;

CREATE INDEX "platform_staff_assignments_user_idx" ON "platform_staff_assignments" ("user_id","expires_at");

CREATE INDEX "platform_staff_assignments_role_idx" ON "platform_staff_assignments" ("role","expires_at");

CREATE UNIQUE INDEX "platform_staff_role_events_hash_uidx" ON "platform_staff_role_events" ("event_hash");

CREATE UNIQUE INDEX "platform_staff_role_events_chain_uidx" ON "platform_staff_role_events" ("actor_user_id","previous_hash");

CREATE UNIQUE INDEX "platform_staff_role_events_assignment_type_uidx" ON "platform_staff_role_events" ("subject_assignment_id","event_type");

CREATE INDEX "platform_staff_role_events_actor_idx" ON "platform_staff_role_events" ("actor_user_id","created_at");

CREATE INDEX "platform_staff_role_events_subject_idx" ON "platform_staff_role_events" ("subject_user_id","created_at");

CREATE UNIQUE INDEX "workspace_invitations_acceptance_claim_uidx"
ON "workspace_invitations" ("acceptance_claim_id")
WHERE "acceptance_claim_id" IS NOT NULL;

CREATE INDEX "auth_otp_email_verification_lock_idx"
ON "auth_otp_challenges" ("email_hash","verification_locked_until");

CREATE INDEX "auth_otp_keyed_email_verification_lock_idx"
ON "auth_otp_challenges" (
  "email_lookup_key_version",
  "email_lookup_hash",
  "verification_locked_until"
);

CREATE INDEX "legal_review_queue_status_idx" ON "legal_review_queue" ("status","created_at");

CREATE INDEX "legal_review_queue_source_idx" ON "legal_review_queue" ("source_id","version_id");

CREATE UNIQUE INDEX "legal_source_chunks_order_uidx" ON "legal_source_chunks" ("version_id","chunk_index");

CREATE UNIQUE INDEX "legal_source_chunks_vector_uidx" ON "legal_source_chunks" ("vector_id");

CREATE INDEX "legal_source_chunks_section_idx" ON "legal_source_chunks" ("section_id","chunk_index");

CREATE UNIQUE INDEX "legal_source_sections_ref_uidx" ON "legal_source_sections" ("version_id","canonical_ref");

CREATE INDEX "legal_source_sections_order_idx" ON "legal_source_sections" ("version_id","sequence");

CREATE UNIQUE INDEX "legal_source_versions_hash_uidx" ON "legal_source_versions" ("source_id","language","content_sha256");

CREATE INDEX "legal_source_versions_status_idx" ON "legal_source_versions" ("source_id","status","effective_at");

CREATE INDEX "source_sync_errors_run_idx" ON "source_sync_errors" ("run_id","occurred_at");

CREATE INDEX "source_sync_runs_status_idx" ON "source_sync_runs" ("source_kind","status","started_at");

CREATE UNIQUE INDEX "source_sync_runs_lock_uidx" ON "source_sync_runs" ("lock_key","started_at");

CREATE UNIQUE INDEX "source_sync_runs_active_lock_uidx" ON "source_sync_runs" ("lock_key") WHERE "status" = 'running';

CREATE UNIQUE INDEX "legal_sources_canonical_locale_uidx" ON "legal_sources" ("canonical_id","locale");

CREATE INDEX "legal_sources_verification_idx" ON "legal_sources" ("verification_state","locale","last_checked_at");

CREATE UNIQUE INDEX "legal_source_fetch_requests_idempotency_uidx" ON "legal_source_fetch_requests" ("idempotency_key");

CREATE INDEX "legal_source_fetch_requests_status_idx" ON "legal_source_fetch_requests" ("environment","status","created_at");

CREATE INDEX "legal_source_fetch_requests_source_idx" ON "legal_source_fetch_requests" ("source_id","version_id");

CREATE UNIQUE INDEX "legal_review_queue_version_reason_uidx" ON "legal_review_queue" ("version_id","reason_code");

CREATE INDEX "legal_review_queue_decider_idx" ON "legal_review_queue" ("decided_by_user_id","decided_at");

CREATE UNIQUE INDEX "legal_source_publications_review_uidx" ON "legal_source_publications" ("review_id");

CREATE UNIQUE INDEX "legal_source_publications_version_uidx" ON "legal_source_publications" ("version_id");

CREATE INDEX "legal_source_publications_source_idx" ON "legal_source_publications" ("source_id","published_at");

CREATE INDEX "legal_source_publications_publisher_idx" ON "legal_source_publications" ("published_by_user_id","published_at");

CREATE UNIQUE INDEX "auth_session_token_history_hash_uidx" ON "auth_session_token_history" ("token_hash");

CREATE INDEX "auth_session_token_history_session_idx" ON "auth_session_token_history" ("session_id","rotated_at");

CREATE INDEX "auth_session_token_history_user_idx" ON "auth_session_token_history" ("user_id","rotated_at");

CREATE INDEX "auth_session_token_history_expiry_idx" ON "auth_session_token_history" ("expires_at");

CREATE UNIQUE INDEX "auth_session_token_replays_history_uidx" ON "auth_session_token_replays" ("token_history_id");

CREATE INDEX "auth_session_token_replays_user_idx" ON "auth_session_token_replays" ("user_id","detected_at");

CREATE INDEX "auth_session_token_replays_session_idx" ON "auth_session_token_replays" ("session_id","detected_at");

CREATE UNIQUE INDEX "auth_device_continuities_lookup_uidx" ON "auth_device_continuities" ("user_id","key_version","token_hmac");

CREATE INDEX "auth_device_continuities_user_idx" ON "auth_device_continuities" ("user_id","last_seen_at");

CREATE INDEX "auth_devices_continuity_idx" ON "auth_devices" ("continuity_id");

CREATE UNIQUE INDEX "account_deletion_lifecycle_hash_uidx" ON "account_deletion_lifecycle_events" ("event_hash");

CREATE UNIQUE INDEX "account_deletion_lifecycle_chain_uidx" ON "account_deletion_lifecycle_events" ("request_id","previous_hash");

CREATE INDEX "account_deletion_lifecycle_request_idx" ON "account_deletion_lifecycle_events" ("request_id","created_at");

CREATE INDEX "account_deletion_lifecycle_subject_idx" ON "account_deletion_lifecycle_events" ("subject_hash","created_at");

CREATE UNIQUE INDEX "account_deletion_purge_hash_uidx" ON "account_deletion_purge_evidence" ("evidence_hash");

CREATE INDEX "account_deletion_purge_subject_idx" ON "account_deletion_purge_evidence" ("subject_hash","completed_at");

CREATE INDEX "account_deletion_requests_schedule_idx" ON "account_deletion_requests" ("status","scheduled_purge_at");

CREATE UNIQUE INDEX "account_deletion_requests_active_user_uidx" ON "account_deletion_requests" ("user_id") WHERE "account_deletion_requests"."status" IN ('requested','reviewing','scheduled','purging','blocked');

CREATE UNIQUE INDEX "workspaces_creation_request_uidx" ON "workspaces" ("creation_request_id") WHERE "workspaces"."creation_request_id" IS NOT NULL;

CREATE UNIQUE INDEX "legal_source_current_activations_publication_uidx" ON "legal_source_current_activations" ("publication_id");

CREATE UNIQUE INDEX "legal_source_current_activations_version_uidx" ON "legal_source_current_activations" ("version_id");

CREATE INDEX "legal_source_current_activations_actor_idx" ON "legal_source_current_activations" ("activated_by_user_id","activated_at");

CREATE INDEX "legal_source_lifecycle_events_source_idx" ON "legal_source_lifecycle_events" ("source_id","occurred_at");

CREATE INDEX "legal_source_lifecycle_events_publication_idx" ON "legal_source_lifecycle_events" ("publication_id","event_type");

CREATE INDEX "legal_source_lifecycle_events_actor_idx" ON "legal_source_lifecycle_events" ("acted_by_user_id","occurred_at");

CREATE UNIQUE INDEX "ai_runs_idempotency_uidx" ON "ai_runs" ("workspace_id","user_id","idempotency_key");

CREATE INDEX "ai_runs_workspace_status_idx" ON "ai_runs" ("workspace_id","status","created_at");

CREATE INDEX "ai_runs_conversation_idx" ON "ai_runs" ("conversation_id","created_at");

CREATE UNIQUE INDEX "ai_usage_ledger_run_uidx" ON "ai_usage_ledger" ("ai_run_id");

CREATE UNIQUE INDEX "ai_usage_ledger_idempotency_uidx" ON "ai_usage_ledger" ("workspace_id","user_id","idempotency_key");

CREATE INDEX "ai_usage_ledger_period_idx" ON "ai_usage_ledger" ("workspace_id","user_id","feature","period_start","status");

CREATE UNIQUE INDEX "message_branches_request_uidx" ON "message_branches" ("request_message_id");

CREATE UNIQUE INDEX "message_branches_response_uidx" ON "message_branches" ("response_message_id");

CREATE INDEX "message_branches_conversation_idx" ON "message_branches" ("conversation_id","created_at");

CREATE INDEX "message_branches_parent_idx" ON "message_branches" ("parent_branch_id");

CREATE UNIQUE INDEX "message_versions_message_uidx" ON "message_versions" ("message_id");

CREATE INDEX "message_versions_conversation_idx" ON "message_versions" ("conversation_id","created_at");

CREATE INDEX "message_versions_source_idx" ON "message_versions" ("source_message_id","version_number");

CREATE UNIQUE INDEX "analysis_exports_idempotency_uidx" ON "analysis_exports" ("idempotency_key");

CREATE UNIQUE INDEX "analysis_exports_r2_key_uidx" ON "analysis_exports" ("r2_key");

CREATE INDEX "analysis_exports_analysis_idx" ON "analysis_exports" ("analysis_id","created_at");

CREATE INDEX "analysis_exports_workspace_idx" ON "analysis_exports" ("workspace_id","created_at");

CREATE INDEX "analysis_exports_status_idx" ON "analysis_exports" ("status","updated_at");

CREATE UNIQUE INDEX "analysis_report_exports_idempotency_uidx" ON "analysis_report_exports" ("idempotency_key");

CREATE UNIQUE INDEX "analysis_report_exports_r2_key_uidx" ON "analysis_report_exports" ("r2_key");

CREATE INDEX "analysis_report_exports_analysis_idx" ON "analysis_report_exports" ("analysis_id","created_at");

CREATE INDEX "analysis_report_exports_workspace_idx" ON "analysis_report_exports" ("workspace_id","created_at");

CREATE INDEX "analysis_report_exports_status_idx" ON "analysis_report_exports" ("status","updated_at");

CREATE UNIQUE INDEX "file_extractions_analysis_uidx" ON "file_extractions" ("analysis_id");

CREATE UNIQUE INDEX "file_extractions_r2_key_uidx" ON "file_extractions" ("r2_key");

CREATE INDEX "file_extractions_workspace_idx" ON "file_extractions" ("workspace_id","created_at");

CREATE INDEX "file_extractions_status_idx" ON "file_extractions" ("status","updated_at");

CREATE UNIQUE INDEX "task_reminders_idempotency_uidx" ON "task_reminders" ("idempotency_key");

CREATE INDEX "task_reminders_due_idx" ON "task_reminders" ("status","reminder_at");

CREATE UNIQUE INDEX "tasks_plan_step_uidx" ON "tasks" ("plan_step_id");

CREATE INDEX "tasks_workspace_due_idx" ON "tasks" ("workspace_id","due_at","status");

CREATE INDEX "tasks_case_idx" ON "tasks" ("case_id","updated_at");

CREATE UNIQUE INDEX "conflict_checks_request_lawyer_uidx" ON "conflict_checks" ("lawyer_request_id","lawyer_profile_id");

CREATE INDEX "lawyer_access_grants_case_idx" ON "lawyer_access_grants" ("case_id","revoked_at");

CREATE INDEX "lawyer_access_grants_lawyer_idx" ON "lawyer_access_grants" ("lawyer_user_id","revoked_at");

CREATE UNIQUE INDEX "lawyer_profiles_user_uidx" ON "lawyer_profiles" ("user_id");

CREATE INDEX "lawyer_profiles_status_idx" ON "lawyer_profiles" ("status","updated_at");

CREATE INDEX "lawyer_requests_workspace_idx" ON "lawyer_requests" ("workspace_id","updated_at");

CREATE INDEX "lawyer_requests_lawyer_idx" ON "lawyer_requests" ("lawyer_profile_id","status");

CREATE UNIQUE INDEX "lawyer_access_grants_request_uidx" ON "lawyer_access_grants" ("lawyer_request_id");

CREATE INDEX "support_messages_ticket_idx" ON "support_messages" ("ticket_id","created_at");

CREATE INDEX "support_tickets_workspace_idx" ON "support_tickets" ("workspace_id","updated_at");

CREATE INDEX "support_tickets_status_idx" ON "support_tickets" ("status","updated_at");

CREATE INDEX "support_tickets_requester_idx" ON "support_tickets" ("requester_user_id","updated_at");

CREATE UNIQUE INDEX "staging_provider_probes_key_provider_uidx" ON "staging_provider_probes" ("probe_key","provider");

CREATE INDEX "staging_provider_probes_status_idx" ON "staging_provider_probes" ("status","updated_at");

CREATE UNIQUE INDEX "advice_scenarios_source_uidx" ON "advice_scenarios" ("source_id");

CREATE UNIQUE INDEX "advice_scenarios_identity_uidx" ON "advice_scenarios" ("canonical_id","locale");

CREATE INDEX "advice_scenarios_status_idx" ON "advice_scenarios" ("status","updated_at");

CREATE UNIQUE INDEX "scenario_versions_source_version_uidx" ON "scenario_versions" ("legal_source_version_id");

CREATE UNIQUE INDEX "scenario_versions_hash_uidx" ON "scenario_versions" ("scenario_id","content_sha256");

CREATE INDEX "scenario_versions_scenario_idx" ON "scenario_versions" ("scenario_id","created_at");

CREATE UNIQUE INDEX "action_plan_versions_plan_version_uidx" ON "action_plan_versions" ("plan_id","version");

CREATE INDEX "action_plan_versions_plan_created_idx" ON "action_plan_versions" ("plan_id","created_at");

CREATE UNIQUE INDEX "lawyer_offers_request_version_uidx" ON "lawyer_offers" ("lawyer_request_id","version");

CREATE INDEX "lawyer_offers_request_status_idx" ON "lawyer_offers" ("lawyer_request_id","status","updated_at");

CREATE INDEX "lawyer_request_messages_request_idx" ON "lawyer_request_messages" ("lawyer_request_id","created_at");

CREATE INDEX "lawyer_request_messages_author_idx" ON "lawyer_request_messages" ("author_user_id","created_at");

CREATE UNIQUE INDEX "lawyer_reviews_request_uidx" ON "lawyer_reviews" ("lawyer_request_id");

CREATE INDEX "lawyer_reviews_lawyer_status_idx" ON "lawyer_reviews" ("lawyer_profile_id","status","created_at");

CREATE INDEX "lawyer_review_moderation_review_idx" ON "lawyer_review_moderation" ("review_id","created_at");

CREATE INDEX "lawyer_review_moderation_moderator_idx" ON "lawyer_review_moderation" ("moderator_user_id","created_at");

CREATE UNIQUE INDEX "lawyer_review_moderation_review_uidx" ON "lawyer_review_moderation" ("review_id");

CREATE INDEX "lawyer_profiles_directory_filter_idx" ON "lawyer_profiles" ("status","public_approved_at","availability_status","advocate_status","experience_years");

CREATE UNIQUE INDEX "lawyer_profile_moderation_revision_uidx" ON "lawyer_profile_moderation" ("lawyer_profile_id","profile_revision");

CREATE INDEX "lawyer_profile_moderation_moderator_idx" ON "lawyer_profile_moderation" ("moderator_user_id","created_at");

CREATE UNIQUE INDEX "ai_feedback_response_type_uidx" ON "ai_feedback" ("workspace_id","user_id","assistant_message_id","feedback_type");

CREATE INDEX "ai_feedback_workspace_created_idx" ON "ai_feedback" ("workspace_id","created_at");

CREATE INDEX "ai_feedback_ai_run_idx" ON "ai_feedback" ("ai_run_id","created_at");

CREATE UNIQUE INDEX "entitlement_usage_workspace_idempotency_uidx" ON "entitlement_usage" ("workspace_id","idempotency_key");

CREATE INDEX "entitlement_usage_entitlement_status_idx" ON "entitlement_usage" ("entitlement_id","status","created_at");

CREATE UNIQUE INDEX "ledger_accounts_owner_code_uidx" ON "ledger_accounts" ("owner_type","owner_id","code","currency");

CREATE INDEX "ledger_accounts_code_idx" ON "ledger_accounts" ("code","status");

CREATE UNIQUE INDEX "ledger_entries_transaction_sequence_uidx" ON "ledger_entries" ("transaction_id","sequence");

CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" ("account_id","created_at");

CREATE UNIQUE INDEX "ledger_transactions_external_uidx" ON "ledger_transactions" ("external_id");

CREATE UNIQUE INDEX "ledger_transactions_workspace_idempotency_uidx" ON "ledger_transactions" ("workspace_id","idempotency_key");

CREATE INDEX "ledger_transactions_order_idx" ON "ledger_transactions" ("order_id","created_at");

CREATE UNIQUE INDEX "marketplace_orders_external_uidx" ON "marketplace_orders" ("external_id");

CREATE UNIQUE INDEX "marketplace_orders_workspace_idempotency_uidx" ON "marketplace_orders" ("workspace_id","idempotency_key");

CREATE INDEX "marketplace_orders_workspace_status_idx" ON "marketplace_orders" ("workspace_id","status","updated_at");

CREATE INDEX "marketplace_orders_customer_idx" ON "marketplace_orders" ("customer_user_id","updated_at");

CREATE INDEX "order_items_order_idx" ON "order_items" ("order_id","created_at");

CREATE UNIQUE INDEX "payment_attempts_external_uidx" ON "payment_attempts" ("external_id");

CREATE UNIQUE INDEX "payment_attempts_order_idempotency_uidx" ON "payment_attempts" ("order_id","idempotency_key");

CREATE UNIQUE INDEX "payment_attempts_provider_uidx" ON "payment_attempts" ("provider","provider_attempt_id") WHERE "payment_attempts"."provider_attempt_id" IS NOT NULL;

CREATE INDEX "payment_attempts_order_status_idx" ON "payment_attempts" ("order_id","internal_status","updated_at");

CREATE UNIQUE INDEX "payment_provider_events_provider_event_uidx" ON "payment_provider_events" ("provider","provider_event_id");

CREATE INDEX "payment_provider_events_status_idx" ON "payment_provider_events" ("internal_status","received_at");

CREATE UNIQUE INDEX "pricing_policies_code_uidx" ON "pricing_policies" ("code");

CREATE INDEX "pricing_policies_status_idx" ON "pricing_policies" ("status","updated_at");

CREATE UNIQUE INDEX "pricing_policy_versions_policy_version_uidx" ON "pricing_policy_versions" ("policy_id","version");

CREATE INDEX "pricing_policy_versions_effective_idx" ON "pricing_policy_versions" ("approval_status","effective_from","effective_to");

CREATE UNIQUE INDEX "pricing_snapshots_order_version_uidx" ON "pricing_snapshots" ("order_id","version");

CREATE UNIQUE INDEX "pricing_snapshots_calculation_hash_uidx" ON "pricing_snapshots" ("calculation_hash");

CREATE INDEX "pricing_snapshots_policy_idx" ON "pricing_snapshots" ("pricing_policy_version_id","created_at");

CREATE UNIQUE INDEX "subscription_entitlements_period_uidx" ON "subscription_entitlements" ("subscription_id","entitlement_code","period_start");

CREATE INDEX "subscription_entitlements_active_idx" ON "subscription_entitlements" ("subscription_id","period_end");

CREATE UNIQUE INDEX "subscription_invoices_external_uidx" ON "subscription_invoices" ("external_id");

CREATE UNIQUE INDEX "subscription_invoices_number_uidx" ON "subscription_invoices" ("invoice_number");

CREATE UNIQUE INDEX "subscription_invoices_order_uidx" ON "subscription_invoices" ("order_id");

CREATE INDEX "subscription_invoices_workspace_status_idx" ON "subscription_invoices" ("workspace_id","status","created_at");

CREATE UNIQUE INDEX "subscription_plan_versions_plan_version_uidx" ON "subscription_plan_versions" ("plan_id","version");

CREATE INDEX "subscription_plan_versions_effective_idx" ON "subscription_plan_versions" ("approval_status","effective_from","effective_to");

CREATE UNIQUE INDEX "subscription_plans_code_uidx" ON "subscription_plans" ("code");

CREATE INDEX "subscription_plans_status_idx" ON "subscription_plans" ("status","updated_at");

CREATE INDEX "tax_components_snapshot_idx" ON "tax_components" ("pricing_snapshot_id","created_at");

CREATE UNIQUE INDEX "tax_profiles_subject_service_version_uidx" ON "tax_profiles" ("subject_type","subject_id","service_type","version");

CREATE INDEX "tax_profiles_effective_idx" ON "tax_profiles" ("subject_type","subject_id","service_type","approval_status","effective_from");

CREATE INDEX "memory_sources_memory_idx" ON "memory_sources" ("memory_id","created_at");

CREATE INDEX "memory_sources_conversation_idx" ON "memory_sources" ("conversation_id","created_at");

CREATE UNIQUE INDEX "user_memories_identity_uidx" ON "user_memories" ("user_id","scope_key","content_sha256") WHERE "user_memories"."status" = 'active';

CREATE INDEX "user_memories_user_status_idx" ON "user_memories" ("user_id","status","updated_at");

CREATE INDEX "user_memories_workspace_status_idx" ON "user_memories" ("workspace_id","status","updated_at");

CREATE UNIQUE INDEX "legal_service_proposals_external_uidx" ON "legal_service_proposals" ("external_id");

CREATE UNIQUE INDEX "legal_service_proposals_request_version_uidx" ON "legal_service_proposals" ("lawyer_request_id","version");

CREATE INDEX "legal_service_proposals_client_status_idx" ON "legal_service_proposals" ("workspace_id","client_user_id","status","updated_at");

CREATE INDEX "legal_service_proposals_lawyer_status_idx" ON "legal_service_proposals" ("lawyer_user_id","status","updated_at");

CREATE UNIQUE INDEX "legal_service_proposal_versions_proposal_version_uidx" ON "legal_service_proposal_versions" ("proposal_id","version");

CREATE UNIQUE INDEX "proposal_milestones_sequence_uidx" ON "proposal_milestones" ("proposal_id","sequence");

CREATE UNIQUE INDEX "proposal_acceptances_proposal_uidx" ON "proposal_acceptances" ("proposal_id");

CREATE UNIQUE INDEX "order_agreements_order_uidx" ON "order_agreements" ("order_id");

CREATE UNIQUE INDEX "order_consents_order_type_uidx" ON "order_consents" ("order_id","type");

CREATE UNIQUE INDEX "settlement_allocations_external_uidx" ON "settlement_allocations" ("external_id");

CREATE UNIQUE INDEX "settlement_allocations_order_idempotency_uidx" ON "settlement_allocations" ("order_id","idempotency_key");

CREATE UNIQUE INDEX "lawyer_payables_external_uidx" ON "lawyer_payables" ("external_id");

CREATE UNIQUE INDEX "lawyer_payables_allocation_uidx" ON "lawyer_payables" ("settlement_allocation_id");

CREATE UNIQUE INDEX "lawyer_payables_order_idempotency_uidx" ON "lawyer_payables" ("order_id","idempotency_key");

CREATE INDEX "lawyer_payables_lawyer_status_idx" ON "lawyer_payables" ("lawyer_user_id","status","created_at");

CREATE UNIQUE INDEX "payment_attempts_order_open_uidx"
  ON "payment_attempts" ("order_id")
  WHERE "internal_status" = 'client_action_required';

CREATE UNIQUE INDEX "guest_ai_runs_session_idempotency_uidx" ON "guest_ai_runs" ("session_id","idempotency_key");

CREATE INDEX "guest_ai_runs_session_created_idx" ON "guest_ai_runs" ("session_id","created_at");

CREATE INDEX "guest_ai_runs_expiry_idx" ON "guest_ai_runs" ("expires_at","status");

CREATE UNIQUE INDEX "file_scan_results_analysis_uidx" ON "file_scan_results" ("analysis_id");

CREATE UNIQUE INDEX "file_scan_results_file_uidx" ON "file_scan_results" ("file_id");

CREATE INDEX "file_scan_results_workspace_created_idx" ON "file_scan_results" ("workspace_id","created_at");

CREATE UNIQUE INDEX "analysis_document_versions_number_uidx" ON "analysis_document_versions" ("analysis_id","version");

CREATE UNIQUE INDEX "analysis_document_versions_r2_key_uidx" ON "analysis_document_versions" ("r2_key");

CREATE UNIQUE INDEX "analysis_document_versions_idempotency_uidx" ON "analysis_document_versions" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;

CREATE INDEX "analysis_document_versions_workspace_idx" ON "analysis_document_versions" ("workspace_id","created_at");

CREATE UNIQUE INDEX "suggested_revisions_risk_uidx" ON "suggested_revisions" ("risk_id");

CREATE INDEX "suggested_revisions_analysis_status_idx" ON "suggested_revisions" ("analysis_id","status","created_at");

CREATE INDEX "suggested_revisions_workspace_idx" ON "suggested_revisions" ("workspace_id","updated_at");

CREATE INDEX "analysis_report_exports_source_version_idx" ON "analysis_report_exports" ("source_version_id","variant","created_at");

CREATE UNIQUE INDEX "comparison_exports_idempotency_uidx" ON "comparison_exports" ("idempotency_key");

CREATE UNIQUE INDEX "comparison_exports_r2_key_uidx" ON "comparison_exports" ("r2_key");

CREATE INDEX "comparison_exports_comparison_idx" ON "comparison_exports" ("comparison_id","created_at");

CREATE INDEX "comparison_exports_workspace_idx" ON "comparison_exports" ("workspace_id","created_at");

CREATE INDEX "comparison_exports_status_idx" ON "comparison_exports" ("status","updated_at");

CREATE UNIQUE INDEX "comparison_changes_decision_event_uidx" ON "comparison_changes" ("review_decision_event_id") WHERE "review_decision_event_id" IS NOT NULL;

CREATE INDEX "comparison_changes_decision_idx" ON "comparison_changes" ("comparison_id","review_decision","ordinal");

CREATE UNIQUE INDEX "analysis_version_object_writes_r2_uidx" ON "analysis_version_object_writes" ("r2_key");

CREATE UNIQUE INDEX "analysis_version_object_writes_version_uidx" ON "analysis_version_object_writes" ("version_id") WHERE "version_id" IS NOT NULL;

CREATE INDEX "analysis_version_object_writes_reconcile_idx" ON "analysis_version_object_writes" ("status","updated_at","id");

CREATE INDEX "analysis_version_object_writes_owner_idx" ON "analysis_version_object_writes" ("owner_user_id","created_at");

CREATE UNIQUE INDEX "analysis_document_versions_object_write_uidx" ON "analysis_document_versions" ("object_write_id") WHERE "object_write_id" IS NOT NULL;

CREATE INDEX "document_analyses_case_idx" ON "document_analyses" ("workspace_id","case_id","updated_at");

CREATE UNIQUE INDEX "analysis_case_link_events_version_uidx" ON "analysis_case_link_events" ("analysis_id","mutation_version");

CREATE UNIQUE INDEX "analysis_case_link_events_idempotency_uidx" ON "analysis_case_link_events" ("workspace_id","owner_user_id","idempotency_key");

CREATE INDEX "analysis_case_link_events_case_idx" ON "analysis_case_link_events" ("workspace_id","to_case_id","created_at");

CREATE INDEX "documents_workspace_case_idx" ON "documents" ("workspace_id","case_id","updated_at");

CREATE UNIQUE INDEX "document_case_link_events_version_uidx" ON "document_case_link_events" ("document_id","mutation_version");

CREATE UNIQUE INDEX "document_case_link_events_idempotency_uidx" ON "document_case_link_events" ("workspace_id","owner_user_id","idempotency_key");

CREATE INDEX "document_case_link_events_case_idx" ON "document_case_link_events" ("workspace_id","to_case_id","created_at");

CREATE UNIQUE INDEX "user_legal_bookmarks_active_scope_uidx"
ON "user_legal_bookmarks" ("workspace_id","user_id","source_id","version_id",coalesce("case_id",''))
WHERE "archived_at" IS NULL;

CREATE INDEX "user_legal_bookmarks_user_idx" ON "user_legal_bookmarks" ("workspace_id","user_id","updated_at");

CREATE INDEX "user_legal_bookmarks_case_idx" ON "user_legal_bookmarks" ("workspace_id","case_id","updated_at");

CREATE INDEX "user_legal_bookmarks_source_idx" ON "user_legal_bookmarks" ("source_id","version_id");

CREATE UNIQUE INDEX "user_legal_bookmark_events_revision_uidx" ON "user_legal_bookmark_events" ("bookmark_id","revision");

CREATE UNIQUE INDEX "user_legal_bookmark_events_idempotency_uidx" ON "user_legal_bookmark_events" ("workspace_id","user_id","idempotency_key");

CREATE INDEX "user_legal_bookmark_events_case_idx" ON "user_legal_bookmark_events" ("workspace_id","case_id","created_at");

CREATE UNIQUE INDEX "knowledge_base_articles_slug_uidx" ON "knowledge_base_articles" ("slug");

CREATE INDEX "knowledge_base_articles_status_idx" ON "knowledge_base_articles" ("status","updated_at");

CREATE UNIQUE INDEX "knowledge_base_feedback_scope_uidx" ON "knowledge_base_feedback" ("article_id","version_id","workspace_id","user_id");

CREATE INDEX "knowledge_base_feedback_article_idx" ON "knowledge_base_feedback" ("article_id","version_id","updated_at");

CREATE UNIQUE INDEX "knowledge_base_feedback_events_revision_uidx" ON "knowledge_base_feedback_events" ("feedback_id","revision");

CREATE UNIQUE INDEX "knowledge_base_feedback_events_idempotency_uidx" ON "knowledge_base_feedback_events" ("workspace_id","user_id","idempotency_key");

CREATE INDEX "knowledge_base_authoring_events_article_idx" ON "knowledge_base_authoring_events" ("article_id","created_at");

CREATE INDEX "knowledge_base_authoring_events_actor_idx" ON "knowledge_base_authoring_events" ("actor_user_id","created_at");

CREATE UNIQUE INDEX "lawyer_review_replies_review_version_uidx" ON "lawyer_review_replies" ("review_id","version");

CREATE UNIQUE INDEX "lawyer_review_replies_author_request_uidx" ON "lawyer_review_replies" ("author_user_id","client_request_id");

CREATE UNIQUE INDEX "lawyer_review_replies_one_open_uidx" ON "lawyer_review_replies" ("review_id") WHERE "status" IN ('pending','approved');

CREATE INDEX "lawyer_review_replies_profile_status_idx" ON "lawyer_review_replies" ("lawyer_profile_id","status","created_at");

CREATE UNIQUE INDEX "lawyer_review_reply_moderation_reply_uidx" ON "lawyer_review_reply_moderation" ("reply_id");

CREATE INDEX "lawyer_review_reply_moderation_moderator_idx" ON "lawyer_review_reply_moderation" ("moderator_user_id","created_at");

CREATE UNIQUE INDEX "user_document_index_jobs_version_uidx" ON "user_document_index_jobs" ("document_version_id");

CREATE INDEX "user_document_index_jobs_tenant_status_idx" ON "user_document_index_jobs" ("workspace_id","owner_user_id","status","updated_at");

CREATE UNIQUE INDEX "user_document_vector_chunks_vector_uidx" ON "user_document_vector_chunks" ("vector_id");

CREATE UNIQUE INDEX "user_document_vector_chunks_job_index_uidx" ON "user_document_vector_chunks" ("job_id","chunk_index");

CREATE INDEX "user_document_vector_chunks_job_status_idx" ON "user_document_vector_chunks" ("job_id","status","chunk_index");

CREATE UNIQUE INDEX "ai_model_price_versions_effective_uidx" ON "ai_model_price_versions" ("provider","model","operation","effective_from");

CREATE INDEX "ai_model_price_versions_lookup_idx" ON "ai_model_price_versions" ("provider","model","operation","effective_from" DESC);

CREATE INDEX "ai_provider_usage_events_daily_idx" ON "ai_provider_usage_events" ("environment","usage_day","provider","feature");

CREATE INDEX "ai_provider_usage_events_tenant_idx" ON "ai_provider_usage_events" ("workspace_id","user_id","usage_day","feature");

CREATE INDEX "ai_provider_usage_events_unpriced_idx" ON "ai_provider_usage_events" ("environment","provider","model","operation","created_at") WHERE "status"='succeeded' AND "price_version_id" IS NULL;

CREATE UNIQUE INDEX "ai_cost_daily_aggregates_scope_uidx" ON "ai_cost_daily_aggregates" ("environment","usage_day","scope_key","feature","operation","provider","model");

CREATE INDEX "ai_cost_daily_aggregates_day_idx" ON "ai_cost_daily_aggregates" ("environment","usage_day","provider","feature");

CREATE UNIQUE INDEX "ai_cost_guard_policy_effective_uidx" ON "ai_cost_guard_policy_versions" ("environment","provider","effective_from");

CREATE INDEX "ai_cost_guard_policy_lookup_idx" ON "ai_cost_guard_policy_versions" ("environment","provider","effective_from" DESC);

CREATE UNIQUE INDEX "ai_provider_circuit_event_uidx" ON "ai_provider_circuit_states" ("current_event_id");

CREATE INDEX "ai_provider_circuit_state_idx" ON "ai_provider_circuit_states" ("environment","state","provider");

CREATE INDEX "ai_cost_control_events_timeline_idx" ON "ai_cost_control_events" ("environment","created_at" DESC,"provider");

CREATE UNIQUE INDEX "operational_alert_event_uidx" ON "operational_alert_jobs" ("cost_control_event_id","alert_type");

CREATE INDEX "operational_alert_status_idx" ON "operational_alert_jobs" ("status","updated_at");

CREATE UNIQUE INDEX "system_status_incident_public_reference_uidx" ON "system_status_incidents" ("public_reference");

CREATE UNIQUE INDEX "system_status_incident_current_update_uidx" ON "system_status_incidents" ("current_update_id");

CREATE INDEX "system_status_incident_timeline_idx" ON "system_status_incidents" ("state","started_at" DESC);

CREATE INDEX "system_status_incident_component_lookup_idx" ON "system_status_incident_components" ("component_key","impact","incident_id");

CREATE INDEX "system_status_updates_timeline_idx" ON "system_status_updates" ("incident_id","created_at" DESC);

CREATE UNIQUE INDEX "platform_audit_access_event_hash_uidx"
ON "platform_audit_access_events" ("event_hash");

CREATE UNIQUE INDEX "platform_audit_access_chain_uidx"
ON "platform_audit_access_events" ("actor_user_id","previous_hash");

CREATE INDEX "platform_audit_access_actor_created_idx"
ON "platform_audit_access_events" ("actor_user_id","created_at" DESC);

CREATE INDEX "ai_quality_review_contents_feedback_idx"
ON "ai_quality_review_contents" ("feedback_id","created_at" DESC);

CREATE UNIQUE INDEX "ai_runtime_config_environment_version_uidx"
ON "ai_runtime_config_versions" ("environment","version");

CREATE UNIQUE INDEX "ai_runtime_config_event_hash_uidx"
ON "ai_runtime_config_versions" ("event_hash");

CREATE UNIQUE INDEX "ai_runtime_config_chain_uidx"
ON "ai_runtime_config_versions" ("environment","previous_hash");

CREATE INDEX "ai_runtime_config_created_idx"
ON "ai_runtime_config_versions" ("environment","created_at" DESC);

CREATE UNIQUE INDEX "legal_corpus_alert_epoch_uidx"
ON "legal_corpus_alert_jobs" ("environment","source_kind","alert_type","alert_key");

CREATE INDEX "legal_corpus_alert_status_idx"
ON "legal_corpus_alert_jobs" ("status","updated_at");

CREATE UNIQUE INDEX "legal_source_applicability_review_uidx"
ON "legal_source_applicability_records" ("review_id");

CREATE UNIQUE INDEX "legal_source_applicability_version_uidx"
ON "legal_source_applicability_records" ("version_id");

CREATE INDEX "legal_source_applicability_interval_idx"
ON "legal_source_applicability_records" ("effective_at","expires_at");

CREATE UNIQUE INDEX "document_evaluation_event_hash_uidx"
ON "document_evaluation_review_events" ("event_hash");

CREATE UNIQUE INDEX "document_evaluation_chain_uidx"
ON "document_evaluation_review_events" ("actor_user_id","previous_hash");

CREATE UNIQUE INDEX "document_evaluation_review_version_uidx"
ON "document_evaluation_review_events" ("evaluation_run_id","package_id","review_version")
WHERE "request_action"='review';

CREATE INDEX "document_evaluation_run_package_idx"
ON "document_evaluation_review_events" ("evaluation_run_id","package_id","created_at" DESC);

CREATE INDEX "document_evaluation_actor_created_idx"
ON "document_evaluation_review_events" ("actor_user_id","created_at" DESC);

CREATE UNIQUE INDEX "task_reminder_email_jobs_source_uidx" ON "task_reminder_email_jobs" ("reminder_id","reminder_updated_at");

CREATE INDEX "task_reminder_email_jobs_status_idx" ON "task_reminder_email_jobs" ("status","updated_at","id");

CREATE INDEX "task_reminder_email_jobs_user_idx" ON "task_reminder_email_jobs" ("user_id","created_at");

CREATE UNIQUE INDEX "operational_job_redrive_source_version_uidx" ON "operational_job_redrive_events" ("source_job_id","version");

CREATE UNIQUE INDEX "operational_job_redrive_event_hash_uidx" ON "operational_job_redrive_events" ("event_hash");

CREATE INDEX "operational_job_redrive_environment_created_idx" ON "operational_job_redrive_events" ("environment","created_at" DESC);

CREATE UNIQUE INDEX "case_lifecycle_event_hash_uidx" ON "case_lifecycle_events" ("event_hash");

CREATE UNIQUE INDEX "case_lifecycle_idempotency_uidx" ON "case_lifecycle_events" ("case_id","idempotency_key");

CREATE UNIQUE INDEX "case_lifecycle_revision_uidx" ON "case_lifecycle_events" ("case_id","lifecycle_revision");

CREATE UNIQUE INDEX "case_lifecycle_chain_uidx" ON "case_lifecycle_events" ("case_id","previous_hash");

CREATE INDEX "case_lifecycle_workspace_created_idx" ON "case_lifecycle_events" ("workspace_id","created_at" DESC);

CREATE UNIQUE INDEX "builder_document_versions_number_uidx" ON "builder_document_versions" ("document_id","version");

CREATE UNIQUE INDEX "builder_document_versions_revision_uidx" ON "builder_document_versions" ("document_id","document_revision");

CREATE UNIQUE INDEX "builder_document_versions_r2_uidx" ON "builder_document_versions" ("r2_key");

CREATE UNIQUE INDEX "builder_document_versions_request_uidx" ON "builder_document_versions" ("workspace_id","owner_user_id","idempotency_key_sha256");

CREATE INDEX "builder_document_versions_list_idx" ON "builder_document_versions" ("document_id","status","version" DESC);

CREATE UNIQUE INDEX "builder_document_versions_object_write_uidx" ON "builder_document_versions" ("object_write_id") WHERE "object_write_id" IS NOT NULL;

CREATE UNIQUE INDEX "builder_version_writes_r2_uidx" ON "builder_document_version_object_writes" ("r2_key");

CREATE UNIQUE INDEX "builder_version_writes_version_uidx" ON "builder_document_version_object_writes" ("version_id") WHERE "version_id" IS NOT NULL;

CREATE UNIQUE INDEX "builder_version_writes_request_uidx" ON "builder_document_version_object_writes" ("workspace_id","owner_user_id","idempotency_key_sha256");

CREATE UNIQUE INDEX "builder_version_writes_revision_uidx" ON "builder_document_version_object_writes" ("document_id","target_revision");

CREATE INDEX "builder_version_writes_reconcile_idx" ON "builder_document_version_object_writes" ("status","updated_at","id");

CREATE UNIQUE INDEX "builder_document_version_restore_request_uidx" ON "builder_document_version_restore_events" ("workspace_id","owner_user_id","idempotency_key_sha256");

CREATE UNIQUE INDEX "builder_document_version_restore_revision_uidx" ON "builder_document_version_restore_events" ("document_id","to_revision");

CREATE INDEX "builder_document_version_restore_document_idx" ON "builder_document_version_restore_events" ("document_id","created_at" DESC);

CREATE INDEX "legal_source_health_checks_lookup_idx" ON "legal_source_health_checks" ("environment","source_kind","checked_at" DESC);

CREATE INDEX "lawyer_profiles_marketplace_status_idx"
ON "lawyer_profiles" ("marketplace_status","status","updated_at");

CREATE UNIQUE INDEX "admin_handoff_tickets_token_uidx" ON "admin_handoff_tickets" ("token_hash");

CREATE INDEX "admin_handoff_tickets_session_idx" ON "admin_handoff_tickets" ("source_session_id","expires_at");

CREATE UNIQUE INDEX "admin_domain_sessions_token_uidx" ON "admin_domain_sessions" ("token_hash");

CREATE INDEX "admin_domain_sessions_staff_idx" ON "admin_domain_sessions" ("staff_user_id","expires_at");

CREATE INDEX "admin_domain_audit_actor_idx" ON "admin_domain_audit_events" ("actor_user_id","created_at" DESC);

CREATE INDEX "admin_domain_audit_entity_idx" ON "admin_domain_audit_events" ("entity_type","entity_id","created_at" DESC);

CREATE INDEX "lawyer_profile_lifecycle_profile_idx"
ON "lawyer_profile_lifecycle_events" ("lawyer_profile_id","created_at" DESC);

CREATE INDEX "lawyer_profile_lifecycle_actor_idx"
ON "lawyer_profile_lifecycle_events" ("actor_user_id","created_at" DESC);

CREATE UNIQUE INDEX "demo_payment_runs_external_uidx" ON "demo_payment_runs" ("external_id");

CREATE UNIQUE INDEX "demo_payment_runs_workspace_idempotency_uidx" ON "demo_payment_runs" ("workspace_id","user_id","idempotency_key");

CREATE INDEX "demo_payment_runs_workspace_created_idx" ON "demo_payment_runs" ("workspace_id","user_id","created_at");

CREATE UNIQUE INDEX "demo_payment_events_run_ordinal_uidx" ON "demo_payment_events" ("run_id","ordinal");

CREATE INDEX "demo_payment_events_run_created_idx" ON "demo_payment_events" ("run_id","created_at");

CREATE INDEX "dependency_health_checks_latest_idx"
ON "dependency_health_checks" ("environment","dependency_key","checked_at" DESC,"id" DESC);

CREATE UNIQUE INDEX "ai_slo_telemetry_correlation_uidx"
ON "ai_slo_telemetry_events" ("environment","correlation_hash");

CREATE INDEX "ai_slo_telemetry_window_idx"
ON "ai_slo_telemetry_events" ("environment","request_kind","occurred_at" DESC,"id" DESC);

CREATE INDEX "ai_slo_telemetry_outcome_idx"
ON "ai_slo_telemetry_events" ("environment","outcome","occurred_at" DESC,"id" DESC);

CREATE INDEX "lawyer_profiles_trust_designations_idx"
ON "lawyer_profiles" ("juro_approval_status","top_lawyer_status","marketplace_status");

CREATE INDEX "lawyer_profile_trust_designations_profile_idx"
ON "lawyer_profile_trust_designations" ("lawyer_profile_id","created_at" DESC);

CREATE UNIQUE INDEX "legal_monitoring_metadata_url_uidx" ON "legal_monitoring_metadata" ("canonical_url");

CREATE INDEX "legal_monitoring_metadata_checked_idx" ON "legal_monitoring_metadata" ("last_checked_at");

CREATE UNIQUE INDEX "legal_monitoring_change_fingerprint_uidx" ON "legal_monitoring_change_events" ("metadata_id","fingerprint");

CREATE INDEX "legal_monitoring_change_detected_idx" ON "legal_monitoring_change_events" ("detected_at");

CREATE UNIQUE INDEX "document_analysis_lawyer_verification_version_uidx"
ON "document_analysis_lawyer_verifications" ("analysis_id","document_version_id","lawyer_user_id");

CREATE INDEX "document_analysis_lawyer_verification_analysis_idx"
ON "document_analysis_lawyer_verifications" ("analysis_id","status","verified_at" DESC);

CREATE UNIQUE INDEX "staging_legal_eval_attempt_uidx"
ON "staging_legal_evaluation_attempts" ("evaluation_run_id","scenario_id","attempt_number");

CREATE UNIQUE INDEX "staging_legal_eval_ai_run_uidx"
ON "staging_legal_evaluation_attempts" ("ai_run_id") WHERE "ai_run_id" IS NOT NULL;

CREATE INDEX "staging_legal_eval_run_status_idx"
ON "staging_legal_evaluation_attempts" ("evaluation_run_id","status","scenario_id");

CREATE UNIQUE INDEX "staging_legal_eval_agent_scenario_uidx"
ON "staging_legal_evaluation_agent_reviews" ("evaluation_run_id","scenario_id");

CREATE UNIQUE INDEX "staging_legal_eval_agent_event_hash_uidx"
ON "staging_legal_evaluation_agent_reviews" ("event_hash");

CREATE UNIQUE INDEX "staging_legal_eval_agent_chain_uidx"
ON "staging_legal_evaluation_agent_reviews" ("reviewer_id","previous_hash");

CREATE UNIQUE INDEX "ai_quality_review_event_hash_uidx" ON "ai_quality_review_events" ("event_hash");

CREATE UNIQUE INDEX "ai_quality_review_chain_uidx" ON "ai_quality_review_events" ("actor_user_id","previous_hash");

CREATE UNIQUE INDEX "ai_quality_review_version_uidx" ON "ai_quality_review_events" ("feedback_id","review_version") WHERE "request_action"='resolve';

CREATE INDEX "ai_quality_review_feedback_created_idx" ON "ai_quality_review_events" ("feedback_id","created_at" DESC);

CREATE INDEX "ai_quality_review_actor_created_idx" ON "ai_quality_review_events" ("actor_user_id","created_at" DESC);

CREATE UNIQUE INDEX "legal_eval_human_scope_reviewer_uidx"
ON "legal_evaluation_human_attestations" ("evaluation_run_id","scope_digest","reviewer_user_id");

CREATE UNIQUE INDEX "legal_eval_human_event_hash_uidx"
ON "legal_evaluation_human_attestations" ("event_hash");

CREATE UNIQUE INDEX "legal_eval_human_chain_uidx"
ON "legal_evaluation_human_attestations" ("reviewer_user_id","previous_hash");

CREATE UNIQUE INDEX "legal_eval_human_record_scope_uidx"
ON "legal_evaluation_human_review_records" ("evaluation_run_id","scenario_id");

CREATE UNIQUE INDEX "legal_eval_human_record_event_hash_uidx"
ON "legal_evaluation_human_review_records" ("event_hash");

CREATE UNIQUE INDEX "legal_eval_human_record_chain_uidx"
ON "legal_evaluation_human_review_records" ("reviewer_user_id","previous_hash");

CREATE INDEX "legal_eval_human_record_attestation_idx"
ON "legal_evaluation_human_review_records" ("attestation_id","created_at");

CREATE INDEX "legal_corpus_documents_provider_idx" ON "legal_corpus_documents" ("provider","availability_status","updated_at");

CREATE INDEX "legal_corpus_documents_scope_idx" ON "legal_corpus_documents" ("scope","tenant_id","owner_user_id","matter_id");

CREATE UNIQUE INDEX "legal_corpus_variants_document_language_uidx" ON "legal_corpus_variants" ("document_id","language","is_official_language_version");

CREATE UNIQUE INDEX "legal_corpus_versions_variant_number_uidx" ON "legal_corpus_versions" ("variant_id","version_number");

CREATE UNIQUE INDEX "legal_corpus_versions_variant_hash_uidx" ON "legal_corpus_versions" ("variant_id","content_sha256");

CREATE INDEX "legal_corpus_versions_current_idx" ON "legal_corpus_versions" ("variant_id","status","valid_from","valid_to");

CREATE UNIQUE INDEX "legal_corpus_ingestion_idempotency_uidx" ON "legal_corpus_ingestion_jobs" ("idempotency_key");

CREATE INDEX "legal_corpus_ingestion_ready_idx" ON "legal_corpus_ingestion_jobs" ("status","next_attempt_at","created_at");

CREATE INDEX "legal_corpus_failures_document_idx" ON "legal_corpus_failures" ("canonical_document_id","language","attempted_at");

CREATE UNIQUE INDEX "legal_corpus_runs_active_kind_uidx" ON "legal_corpus_runs" ("run_kind") WHERE "status"='running';

CREATE INDEX "legal_corpus_source_alias_document_idx" ON "legal_corpus_source_aliases" ("document_id","language");

CREATE UNIQUE INDEX "legal_corpus_discovery_category_language_uidx" ON "legal_corpus_discovery_checkpoints" ("category_key","language");

CREATE INDEX "legal_corpus_discovery_ready_idx" ON "legal_corpus_discovery_checkpoints" ("status","next_attempt_at","updated_at");

CREATE INDEX "legal_corpus_discovery_documents_source_idx" ON "legal_corpus_discovery_documents" ("provider_source_id","language");

CREATE UNIQUE INDEX "legal_corpus_admin_event_hash_uidx" ON "legal_corpus_admin_events" ("event_hash");

CREATE UNIQUE INDEX "legal_corpus_admin_chain_uidx" ON "legal_corpus_admin_events" ("environment",coalesce("previous_event_hash",'ROOT'));

CREATE INDEX "legal_corpus_admin_events_recent_idx" ON "legal_corpus_admin_events" ("environment","created_at" DESC);

CREATE UNIQUE INDEX "legal_corpus_owner_publications_analysis_language_uidx"
  ON "legal_corpus_owner_publications" ("analysis_id","language");

CREATE UNIQUE INDEX "legal_corpus_owner_publications_record_hash_uidx"
  ON "legal_corpus_owner_publications" ("record_hash");

CREATE INDEX "legal_corpus_owner_publications_recent_idx"
  ON "legal_corpus_owner_publications" ("environment","created_at" DESC);

CREATE UNIQUE INDEX "legal_corpus_owner_withdrawals_publication_uidx"
  ON "legal_corpus_owner_withdrawals" ("publication_id");

CREATE INDEX "legal_corpus_owner_withdrawals_recent_idx"
  ON "legal_corpus_owner_withdrawals" ("environment","created_at" DESC);

CREATE UNIQUE INDEX "legal_corpus_owner_ingestions_analysis_language_uidx"
  ON "legal_corpus_owner_ingestions" ("analysis_id","language");

CREATE UNIQUE INDEX "legal_corpus_owner_ingestions_record_hash_uidx"
  ON "legal_corpus_owner_ingestions" ("record_hash");

CREATE INDEX "legal_corpus_owner_ingestions_recent_idx"
  ON "legal_corpus_owner_ingestions" ("environment","created_at" DESC);

CREATE UNIQUE INDEX "legal_corpus_owner_ingestion_withdrawals_publication_uidx"
  ON "legal_corpus_owner_ingestion_withdrawals" ("publication_id");

CREATE INDEX "legal_corpus_owner_ingestion_withdrawals_recent_idx"
  ON "legal_corpus_owner_ingestion_withdrawals" ("environment","created_at" DESC);

CREATE INDEX "legal_source_host_rate_limits_next_idx"
  ON "legal_source_host_rate_limits" ("next_allowed_at");

CREATE UNIQUE INDEX "legal_corpus_owner_upload_requests_analysis_uidx"
  ON "legal_corpus_owner_upload_requests" ("analysis_id");

CREATE UNIQUE INDEX "legal_corpus_owner_upload_requests_authorization_hash_uidx"
  ON "legal_corpus_owner_upload_requests" ("authorization_hash");

CREATE INDEX "legal_corpus_owner_upload_requests_status_idx"
  ON "legal_corpus_owner_upload_requests" ("environment","status","created_at");

CREATE INDEX "legal_corpus_ingestion_document_language_ready_idx"
  ON "legal_corpus_ingestion_jobs" ("canonical_document_id","language","status","next_attempt_at","created_at");

CREATE INDEX "legal_corpus_core_code_target_ready_idx"
  ON "legal_corpus_core_code_targets" ("status","next_attempt_at","updated_at");

CREATE UNIQUE INDEX "lawyer_availability_rules_slot_uidx"
  ON "lawyer_availability_rules" ("lawyer_profile_id","weekday","starts_at","ends_at");

CREATE INDEX "lawyer_availability_rules_profile_idx"
  ON "lawyer_availability_rules" ("lawyer_profile_id","status","weekday");

CREATE INDEX "lawyer_unavailability_periods_profile_idx"
  ON "lawyer_unavailability_periods" ("lawyer_profile_id","starts_at","ends_at");

CREATE UNIQUE INDEX "lawyer_consultations_request_uidx"
  ON "lawyer_consultations" ("lawyer_request_id");

CREATE INDEX "lawyer_consultations_lawyer_time_idx"
  ON "lawyer_consultations" ("lawyer_profile_id","starts_at","status");

CREATE INDEX "lawyer_consultations_client_time_idx"
  ON "lawyer_consultations" ("client_user_id","starts_at","status");

CREATE INDEX "lawyer_task_comments_task_idx"
  ON "lawyer_task_comments" ("task_id","created_at");

CREATE INDEX "lawyer_document_requests_request_idx"
  ON "lawyer_document_requests" ("lawyer_request_id","created_at");

CREATE INDEX "lawyer_document_requests_case_idx"
  ON "lawyer_document_requests" ("case_id","status","created_at");

CREATE INDEX "lawyer_request_messages_unread_idx"
  ON "lawyer_request_messages" ("lawyer_request_id","read_at","created_at");

CREATE UNIQUE INDEX "lawyer_request_message_attachments_message_uidx"
  ON "lawyer_request_message_attachments" ("message_id");

CREATE INDEX "lawyer_request_message_attachments_document_idx"
  ON "lawyer_request_message_attachments" ("document_id","recipient_user_id");

CREATE INDEX "lawyer_request_message_attachments_recipient_idx"
  ON "lawyer_request_message_attachments" ("lawyer_request_id","recipient_user_id","status","created_at");

CREATE UNIQUE INDEX "operational_feature_environment_key_version_uidx"
ON "operational_feature_flag_versions" ("environment","feature_key","version");

CREATE UNIQUE INDEX "operational_feature_event_hash_uidx"
ON "operational_feature_flag_versions" ("event_hash");

CREATE INDEX "operational_feature_latest_idx"
ON "operational_feature_flag_versions" ("environment","feature_key","version" DESC);

CREATE INDEX "signed_share_sessions_expiry_idx" ON "signed_share_sessions" ("expires_at");

CREATE INDEX "document_analyses_resource_quota_idx"
  ON "document_analyses" ("workspace_id","owner_user_id","resource_scope","deletion_requested_at");

CREATE INDEX "document_analyses_abandoned_idx"
  ON "document_analyses" ("resource_scope","deletion_requested_at","abandoned_after","updated_at","id");

CREATE INDEX "document_analyses_purge_retry_idx"
  ON "document_analyses" ("deletion_requested_at","updated_at","id");

CREATE INDEX "analysis_export_idempotency_registry_analysis_idx"
  ON "analysis_export_idempotency_registry" ("analysis_id","created_at");

CREATE UNIQUE INDEX "ai_question_intakes_token_uidx" ON "ai_question_intakes" ("token_hash");

CREATE INDEX "ai_question_intakes_expiry_idx" ON "ai_question_intakes" ("expires_at","consumed_at");

CREATE INDEX "ai_question_intakes_owner_idx" ON "ai_question_intakes" ("workspace_id","user_id","created_at");

CREATE INDEX "auth_password_rate_limits_updated_idx" ON "auth_password_rate_limits" ("updated_at");

CREATE INDEX "auth_password_attempt_scope_expiry_idx" ON "auth_password_attempt_reservations" ("scope_key","expires_at");

CREATE INDEX "auth_password_attempt_expiry_idx" ON "auth_password_attempt_reservations" ("expires_at");

CREATE INDEX "auth_mfa_attempt_challenge_expiry_idx" ON "auth_mfa_attempt_reservations" ("challenge_id","expires_at");

CREATE INDEX "auth_mfa_attempt_user_expiry_idx" ON "auth_mfa_attempt_reservations" ("user_scope_key","expires_at");

CREATE INDEX "auth_mfa_attempt_ip_expiry_idx" ON "auth_mfa_attempt_reservations" ("ip_scope_key","expires_at");

CREATE INDEX "auth_mfa_attempt_expiry_idx" ON "auth_mfa_attempt_reservations" ("expires_at");

CREATE UNIQUE INDEX "auth_session_handoffs_token_uidx" ON "auth_session_handoffs" ("token_hash");

CREATE INDEX "auth_session_handoffs_source_idx" ON "auth_session_handoffs" ("source_session_id","expires_at");

CREATE UNIQUE INDEX "policy_documents_version_uidx" ON "policy_documents" ("document_key","document_version","locale");

CREATE INDEX "policy_documents_status_idx" ON "policy_documents" ("status","document_key");

CREATE UNIQUE INDEX "user_acceptances_uidx" ON "user_acceptances" ("user_id","document_key","document_version");

CREATE INDEX "user_acceptances_policy_idx" ON "user_acceptances" ("policy_document_id","accepted_at");

CREATE UNIQUE INDEX "security_email_jobs_challenge_event_uidx" ON "security_email_jobs" ("challenge_id","event_type");

CREATE UNIQUE INDEX "security_email_jobs_auth_otp_event_uidx" ON "security_email_jobs" ("auth_otp_challenge_id","event_type");

CREATE INDEX "security_email_jobs_status_idx" ON "security_email_jobs" ("status","updated_at");

CREATE INDEX "security_email_jobs_user_idx" ON "security_email_jobs" ("user_id","created_at");

CREATE INDEX "auth_pending_registrations_expiry_idx" ON "auth_pending_registrations" ("expires_at","user_id");

CREATE UNIQUE INDEX "email_change_challenges_active_user_uidx" ON "email_change_challenges" ("user_id") WHERE "email_change_challenges"."consumed_at" IS NULL AND "email_change_challenges"."invalidated_at" IS NULL;

CREATE INDEX "email_change_challenges_expiry_idx" ON "email_change_challenges" ("expires_at");

CREATE INDEX "email_change_challenges_new_email_lookup_idx" ON "email_change_challenges" ("new_email_lookup_key_version","new_email_lookup_hash","created_at");

CREATE UNIQUE INDEX "email_change_challenges_operation_uidx" ON "email_change_challenges" ("consumed_by_operation_id");

CREATE INDEX "email_change_challenges_user_created_idx" ON "email_change_challenges" ("user_id","created_at");

CREATE UNIQUE INDEX "security_notification_jobs_session_event_uidx" ON "security_notification_jobs" ("session_id","event_type","delivery_channel");

CREATE INDEX "security_notification_jobs_status_idx" ON "security_notification_jobs" ("status","updated_at");

CREATE INDEX "security_notification_jobs_user_idx" ON "security_notification_jobs" ("user_id","created_at");

CREATE UNIQUE INDEX "account_deletion_challenges_active_user_uidx" ON "account_deletion_challenges" ("user_id") WHERE "account_deletion_challenges"."consumed_at" IS NULL AND "account_deletion_challenges"."invalidated_at" IS NULL;

CREATE INDEX "account_deletion_challenges_expiry_idx" ON "account_deletion_challenges" ("expires_at");

CREATE UNIQUE INDEX "account_deletion_challenges_operation_uidx" ON "account_deletion_challenges" ("consumed_by_operation_id");

CREATE INDEX "account_deletion_challenges_user_created_idx" ON "account_deletion_challenges" ("user_id","created_at");

CREATE UNIQUE INDEX "ai_document_prefill_handoffs_document_uidx" ON "ai_document_prefill_handoffs" ("document_id");

CREATE UNIQUE INDEX "ai_document_prefill_handoffs_request_uidx" ON "ai_document_prefill_handoffs" ("workspace_id","user_id","idempotency_key_sha256");

CREATE INDEX "ai_document_prefill_handoffs_source_idx" ON "ai_document_prefill_handoffs" ("assistant_message_id","created_at");

CREATE UNIQUE INDEX "builder_analysis_analysis_uidx" ON "builder_document_analysis_handoffs" ("analysis_id");

CREATE INDEX "builder_analysis_document_idx" ON "builder_document_analysis_handoffs" ("document_id","created_at" DESC);

CREATE UNIQUE INDEX "builder_analysis_file_uidx" ON "builder_document_analysis_handoffs" ("file_id");

CREATE UNIQUE INDEX "builder_analysis_request_uidx" ON "builder_document_analysis_handoffs" ("workspace_id","user_id","idempotency_key_sha256");

CREATE UNIQUE INDEX "voice_recordings_object_key_uidx" ON "voice_recordings" ("object_key");

CREATE INDEX "voice_recordings_retention_idx" ON "voice_recordings" ("status","expires_at");

CREATE UNIQUE INDEX "voice_recordings_user_idempotency_uidx" ON "voice_recordings" ("user_id","idempotency_key");

CREATE INDEX "voice_recordings_workspace_created_idx" ON "voice_recordings" ("workspace_id","created_at");

CREATE INDEX "guest_ai_sessions_expiry_idx" ON "guest_ai_sessions" ("expires_at","state");

CREATE INDEX "guest_ai_sessions_ip_created_idx" ON "guest_ai_sessions" ("ip_hmac","created_at");

CREATE UNIQUE INDEX "guest_ai_sessions_token_uidx" ON "guest_ai_sessions" ("token_hmac");

CREATE UNIQUE INDEX "knowledge_base_article_versions_number_uidx" ON "knowledge_base_article_versions" ("article_id","version_number");

CREATE INDEX "knowledge_base_article_versions_published_idx" ON "knowledge_base_article_versions" ("article_id","published_at","version_number");

CREATE INDEX "legal_source_references_conversation_idx" ON "legal_source_references" ("conversation_id","created_at" DESC);

CREATE INDEX "legal_source_references_guest_idx" ON "legal_source_references" ("guest_run_id","created_at" DESC);

CREATE UNIQUE INDEX "legal_source_references_run_url_uidx" ON "legal_source_references" ("ai_run_id","guest_run_id","canonical_url");

-- security_events_no_update
CREATE FUNCTION guard_6a15015351a4546fabea4c96() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'security_events are append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "security_events_no_update" BEFORE UPDATE ON "security_events"
FOR EACH ROW EXECUTE FUNCTION guard_6a15015351a4546fabea4c96();

-- security_events_no_delete
CREATE FUNCTION guard_be24f030533de78ac5143a84() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'security_events are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "security_events_no_delete" BEFORE DELETE ON "security_events"
FOR EACH ROW EXECUTE FUNCTION guard_be24f030533de78ac5143a84();

-- user_profiles_identity_insert_guard
CREATE FUNCTION guard_ddee427f04269f746fdbad17() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
	(
		(
			NEW."email_ciphertext" IS NULL
			AND NEW."email_iv" IS NULL
			AND NEW."email_key_version" IS NULL
			AND NEW."email_lookup_hash" IS NULL
			AND NEW."email_lookup_key_version" IS NULL
		)
		OR
		(
			NEW."email_ciphertext" IS NOT NULL
			AND NEW."email_iv" IS NOT NULL
			AND NEW."email_key_version" IS NOT NULL
			AND NEW."email_lookup_hash" IS NOT NULL
			AND NEW."email_lookup_key_version" IS NOT NULL
			AND length(NEW."email_ciphertext") >= 22
			AND length(NEW."email_iv") = 16
			AND length(NEW."email_key_version") BETWEEN 1 AND 32
			AND length(NEW."email_lookup_hash") = 43
			AND length(NEW."email_lookup_key_version") BETWEEN 1 AND 32
			AND NEW."email_ciphertext" !~ '^.*[^A-Za-z0-9_-].*$'
			AND NEW."email_iv" !~ '^.*[^A-Za-z0-9_-].*$'
			AND NEW."email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
		)
	)
	AND
	(
		(
			NEW."phone_ciphertext" IS NULL
			AND NEW."phone_iv" IS NULL
			AND NEW."phone_key_version" IS NULL
			AND NEW."phone_lookup_hash" IS NULL
			AND NEW."phone_lookup_key_version" IS NULL
		)
		OR
		(
			NEW."phone_ciphertext" IS NOT NULL
			AND NEW."phone_iv" IS NOT NULL
			AND NEW."phone_key_version" IS NOT NULL
			AND NEW."phone_lookup_hash" IS NOT NULL
			AND NEW."phone_lookup_key_version" IS NOT NULL
			AND length(NEW."phone_ciphertext") >= 22
			AND length(NEW."phone_iv") = 16
			AND length(NEW."phone_key_version") BETWEEN 1 AND 32
			AND length(NEW."phone_lookup_hash") = 43
			AND length(NEW."phone_lookup_key_version") BETWEEN 1 AND 32
			AND NEW."phone_ciphertext" !~ '^.*[^A-Za-z0-9_-].*$'
			AND NEW."phone_iv" !~ '^.*[^A-Za-z0-9_-].*$'
			AND NEW."phone_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
		)
	)
) THEN
RAISE EXCEPTION USING MESSAGE = 'user_profiles identity protection fields incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_profiles_identity_insert_guard" BEFORE INSERT ON "user_profiles"
FOR EACH ROW EXECUTE FUNCTION guard_ddee427f04269f746fdbad17();

-- user_profiles_identity_update_guard
CREATE FUNCTION guard_46d05e9da9c24788bc76c0a2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
	(
		(
			NEW."email_ciphertext" IS NULL
			AND NEW."email_iv" IS NULL
			AND NEW."email_key_version" IS NULL
			AND NEW."email_lookup_hash" IS NULL
			AND NEW."email_lookup_key_version" IS NULL
		)
		OR
		(
			NEW."email_ciphertext" IS NOT NULL
			AND NEW."email_iv" IS NOT NULL
			AND NEW."email_key_version" IS NOT NULL
			AND NEW."email_lookup_hash" IS NOT NULL
			AND NEW."email_lookup_key_version" IS NOT NULL
			AND length(NEW."email_ciphertext") >= 22
			AND length(NEW."email_iv") = 16
			AND length(NEW."email_key_version") BETWEEN 1 AND 32
			AND length(NEW."email_lookup_hash") = 43
			AND length(NEW."email_lookup_key_version") BETWEEN 1 AND 32
			AND NEW."email_ciphertext" !~ '^.*[^A-Za-z0-9_-].*$'
			AND NEW."email_iv" !~ '^.*[^A-Za-z0-9_-].*$'
			AND NEW."email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
		)
	)
	AND
	(
		(
			NEW."phone_ciphertext" IS NULL
			AND NEW."phone_iv" IS NULL
			AND NEW."phone_key_version" IS NULL
			AND NEW."phone_lookup_hash" IS NULL
			AND NEW."phone_lookup_key_version" IS NULL
		)
		OR
		(
			NEW."phone_ciphertext" IS NOT NULL
			AND NEW."phone_iv" IS NOT NULL
			AND NEW."phone_key_version" IS NOT NULL
			AND NEW."phone_lookup_hash" IS NOT NULL
			AND NEW."phone_lookup_key_version" IS NOT NULL
			AND length(NEW."phone_ciphertext") >= 22
			AND length(NEW."phone_iv") = 16
			AND length(NEW."phone_key_version") BETWEEN 1 AND 32
			AND length(NEW."phone_lookup_hash") = 43
			AND length(NEW."phone_lookup_key_version") BETWEEN 1 AND 32
			AND NEW."phone_ciphertext" !~ '^.*[^A-Za-z0-9_-].*$'
			AND NEW."phone_iv" !~ '^.*[^A-Za-z0-9_-].*$'
			AND NEW."phone_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
		)
	)
) THEN
RAISE EXCEPTION USING MESSAGE = 'user_profiles identity protection fields incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_profiles_identity_update_guard" BEFORE UPDATE OF
	"email_ciphertext","email_iv","email_key_version",
	"email_lookup_hash","email_lookup_key_version",
	"phone_ciphertext","phone_iv","phone_key_version",
	"phone_lookup_hash","phone_lookup_key_version" ON "user_profiles"
FOR EACH ROW EXECUTE FUNCTION guard_46d05e9da9c24788bc76c0a2();

-- workspace_invitations_identity_insert_guard
CREATE FUNCTION guard_ce9cb4800f8bc2d61ae61b99() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."email_ciphertext" IS NULL
    AND NEW."email_iv" IS NULL
    AND NEW."email_key_version" IS NULL
    AND NEW."email_lookup_hash" IS NULL
    AND NEW."email_lookup_key_version" IS NULL
  )
  OR
  (
    NEW."email_ciphertext" IS NOT NULL
    AND NEW."email_iv" IS NOT NULL
    AND NEW."email_key_version" IS NOT NULL
    AND NEW."email_lookup_hash" IS NOT NULL
    AND NEW."email_lookup_key_version" IS NOT NULL
    AND length(NEW."email_ciphertext") >= 22
    AND length(NEW."email_iv") = 16
    AND length(NEW."email_key_version") BETWEEN 1 AND 32
    AND length(NEW."email_lookup_hash") = 43
    AND length(NEW."email_lookup_key_version") BETWEEN 1 AND 32
    AND NEW."email_ciphertext" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."email_iv" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'workspace invitation identity protection fields incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "workspace_invitations_identity_insert_guard" BEFORE INSERT ON "workspace_invitations"
FOR EACH ROW EXECUTE FUNCTION guard_ce9cb4800f8bc2d61ae61b99();

-- workspace_invitations_identity_update_guard
CREATE FUNCTION guard_858a6a6dd1d3a8c10c1e961d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."email_ciphertext" IS NULL
    AND NEW."email_iv" IS NULL
    AND NEW."email_key_version" IS NULL
    AND NEW."email_lookup_hash" IS NULL
    AND NEW."email_lookup_key_version" IS NULL
  )
  OR
  (
    NEW."email_ciphertext" IS NOT NULL
    AND NEW."email_iv" IS NOT NULL
    AND NEW."email_key_version" IS NOT NULL
    AND NEW."email_lookup_hash" IS NOT NULL
    AND NEW."email_lookup_key_version" IS NOT NULL
    AND length(NEW."email_ciphertext") >= 22
    AND length(NEW."email_iv") = 16
    AND length(NEW."email_key_version") BETWEEN 1 AND 32
    AND length(NEW."email_lookup_hash") = 43
    AND length(NEW."email_lookup_key_version") BETWEEN 1 AND 32
    AND NEW."email_ciphertext" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."email_iv" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'workspace invitation identity protection fields incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "workspace_invitations_identity_update_guard" BEFORE UPDATE OF
  "email_ciphertext","email_iv","email_key_version",
  "email_lookup_hash","email_lookup_key_version" ON "workspace_invitations"
FOR EACH ROW EXECUTE FUNCTION guard_858a6a6dd1d3a8c10c1e961d();

-- document_invitations_identity_insert_guard
CREATE FUNCTION guard_975ab0bcc997515b08200020() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."target_identifier_kind" IS NULL
    AND NEW."target_identifier_lookup_hash" IS NULL
    AND NEW."target_identifier_lookup_key_version" IS NULL
  )
  OR
  (
    NEW."target_identifier_kind" IN ('email','phone')
    AND NEW."target_identifier_lookup_hash" IS NOT NULL
    AND NEW."target_identifier_lookup_key_version" IS NOT NULL
    AND length(NEW."target_identifier_lookup_hash") = 43
    AND length(NEW."target_identifier_lookup_key_version") BETWEEN 1 AND 32
    AND NEW."target_identifier_lookup_hash"
      !~ '^.*[^A-Za-z0-9_-].*$'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'document invitation identity protection fields incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_invitations_identity_insert_guard" BEFORE INSERT ON "document_invitations"
FOR EACH ROW EXECUTE FUNCTION guard_975ab0bcc997515b08200020();

-- document_invitations_identity_update_guard
CREATE FUNCTION guard_7ffd7acd05076d14e58706b8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."target_identifier_kind" IS NULL
    AND NEW."target_identifier_lookup_hash" IS NULL
    AND NEW."target_identifier_lookup_key_version" IS NULL
  )
  OR
  (
    NEW."target_identifier_kind" IN ('email','phone')
    AND NEW."target_identifier_lookup_hash" IS NOT NULL
    AND NEW."target_identifier_lookup_key_version" IS NOT NULL
    AND length(NEW."target_identifier_lookup_hash") = 43
    AND length(NEW."target_identifier_lookup_key_version") BETWEEN 1 AND 32
    AND NEW."target_identifier_lookup_hash"
      !~ '^.*[^A-Za-z0-9_-].*$'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'document invitation identity protection fields incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_invitations_identity_update_guard" BEFORE UPDATE OF
  "target_identifier_kind","target_identifier_lookup_hash",
  "target_identifier_lookup_key_version" ON "document_invitations"
FOR EACH ROW EXECUTE FUNCTION guard_7ffd7acd05076d14e58706b8();

-- auth_otp_challenge_evidence_insert_guard
CREATE FUNCTION guard_7467d092a5404519fa61b065() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    (
      NEW."email_lookup_hash" IS NULL
      AND NEW."email_lookup_key_version" IS NULL
      AND NEW."code_hmac" IS NULL
      AND NEW."code_key_version" IS NULL
    )
    OR
    (
      NEW."email_lookup_hash" IS NOT NULL
      AND NEW."email_lookup_key_version" IS NOT NULL
      AND NEW."code_hmac" IS NOT NULL
      AND NEW."code_key_version" IS NOT NULL
      AND length(NEW."email_lookup_hash") = 43
      AND length(NEW."email_lookup_key_version") BETWEEN 1 AND 32
      AND length(NEW."code_hmac") = 43
      AND length(NEW."code_key_version") BETWEEN 1 AND 32
      AND NEW."email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
      AND NEW."email_lookup_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
      AND NEW."code_hmac" !~ '^.*[^A-Za-z0-9_-].*$'
      AND NEW."code_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
    )
  )
  AND
  (
    (
      NEW."request_ip_lookup_hash" IS NULL
      AND NEW."request_ip_lookup_key_version" IS NULL
    )
    OR
    (
      NEW."request_ip_lookup_hash" IS NOT NULL
      AND NEW."request_ip_lookup_key_version" IS NOT NULL
      AND length(NEW."request_ip_lookup_hash") = 43
      AND length(NEW."request_ip_lookup_key_version") BETWEEN 1 AND 32
      AND NEW."request_ip_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
      AND NEW."request_ip_lookup_key_version"
        !~ '^.*[^A-Za-z0-9._-].*$'
    )
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'auth OTP challenge evidence incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "auth_otp_challenge_evidence_insert_guard" BEFORE INSERT ON "auth_otp_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_7467d092a5404519fa61b065();

-- auth_otp_challenge_evidence_update_guard
CREATE FUNCTION guard_41a4adbb8a990a64b5cf2dfd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    (
      NEW."email_lookup_hash" IS NULL
      AND NEW."email_lookup_key_version" IS NULL
      AND NEW."code_hmac" IS NULL
      AND NEW."code_key_version" IS NULL
    )
    OR
    (
      NEW."email_lookup_hash" IS NOT NULL
      AND NEW."email_lookup_key_version" IS NOT NULL
      AND NEW."code_hmac" IS NOT NULL
      AND NEW."code_key_version" IS NOT NULL
      AND length(NEW."email_lookup_hash") = 43
      AND length(NEW."email_lookup_key_version") BETWEEN 1 AND 32
      AND length(NEW."code_hmac") = 43
      AND length(NEW."code_key_version") BETWEEN 1 AND 32
      AND NEW."email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
      AND NEW."email_lookup_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
      AND NEW."code_hmac" !~ '^.*[^A-Za-z0-9_-].*$'
      AND NEW."code_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
    )
  )
  AND
  (
    (
      NEW."request_ip_lookup_hash" IS NULL
      AND NEW."request_ip_lookup_key_version" IS NULL
    )
    OR
    (
      NEW."request_ip_lookup_hash" IS NOT NULL
      AND NEW."request_ip_lookup_key_version" IS NOT NULL
      AND length(NEW."request_ip_lookup_hash") = 43
      AND length(NEW."request_ip_lookup_key_version") BETWEEN 1 AND 32
      AND NEW."request_ip_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
      AND NEW."request_ip_lookup_key_version"
        !~ '^.*[^A-Za-z0-9._-].*$'
    )
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'auth OTP challenge evidence incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "auth_otp_challenge_evidence_update_guard" BEFORE UPDATE OF
  "email_lookup_hash","email_lookup_key_version",
  "code_hmac","code_key_version",
  "request_ip_lookup_hash","request_ip_lookup_key_version" ON "auth_otp_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_41a4adbb8a990a64b5cf2dfd();

-- platform_staff_assignments_revoke_only
CREATE FUNCTION guard_a1189d8fac11daa32815e255() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."revoked_at" IS NOT NULL
  OR NEW."revoked_at" IS NULL
  OR NEW."id" IS DISTINCT FROM OLD."id"
  OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
  OR NEW."role" IS DISTINCT FROM OLD."role"
  OR NEW."grant_source" IS DISTINCT FROM OLD."grant_source"
  OR NEW."granted_by_user_id" IS DISTINCT FROM OLD."granted_by_user_id"
  OR NEW."grant_reason" IS DISTINCT FROM OLD."grant_reason"
  OR NEW."granted_at" IS DISTINCT FROM OLD."granted_at"
  OR NEW."expires_at" IS DISTINCT FROM OLD."expires_at"
  OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  OR NEW."updated_at" <= OLD."updated_at" THEN
RAISE EXCEPTION USING MESSAGE = 'platform staff assignment is immutable except revocation', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "platform_staff_assignments_revoke_only" BEFORE UPDATE ON "platform_staff_assignments"
FOR EACH ROW EXECUTE FUNCTION guard_a1189d8fac11daa32815e255();

-- platform_staff_assignments_no_delete
CREATE FUNCTION guard_b3db966c3865cf38eb3b9357() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'platform staff assignments cannot be deleted', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "platform_staff_assignments_no_delete" BEFORE DELETE ON "platform_staff_assignments"
FOR EACH ROW EXECUTE FUNCTION guard_b3db966c3865cf38eb3b9357();

-- platform_staff_role_events_chain_guard
CREATE FUNCTION guard_ca3540a51fdae78aa8dc6ac2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
  NOT EXISTS (
    SELECT 1 FROM "platform_staff_role_events"
    WHERE actor_user_id = NEW.actor_user_id
  )
  AND NEW.previous_hash <> '0000000000000000000000000000000000000000000000000000000000000000'
)
OR (
  EXISTS (
    SELECT 1 FROM "platform_staff_role_events"
    WHERE actor_user_id = NEW.actor_user_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "platform_staff_role_events" parent
    WHERE parent.actor_user_id = NEW.actor_user_id
      AND parent.event_hash = NEW.previous_hash
      AND NOT EXISTS (
        SELECT 1
        FROM "platform_staff_role_events" child
        WHERE child.actor_user_id = parent.actor_user_id
          AND child.previous_hash = parent.event_hash
      )
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'platform staff role event chain predecessor mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "platform_staff_role_events_chain_guard" BEFORE INSERT ON "platform_staff_role_events"
FOR EACH ROW EXECUTE FUNCTION guard_ca3540a51fdae78aa8dc6ac2();

-- platform_staff_role_events_consistency
CREATE FUNCTION guard_c61e25e0e60ba42c3a0ff32b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "auth_sessions" s
  JOIN "platform_staff_assignments" actor
    ON actor.id = NEW.actor_assignment_id
   AND actor.user_id = NEW.actor_user_id
  LEFT JOIN "auth_devices" d ON d.id = s.device_id
  WHERE s.id = NEW.actor_session_id
    AND s.user_id = NEW.actor_user_id
    AND s.revoked_at IS NULL
    AND s.assurance_level = 'mfa'
    AND s.mfa_verified_at = NEW.actor_mfa_verified_at
    AND s.mfa_verified_at <= NEW.created_at
    AND unixepoch(NEW.created_at) - unixepoch(s.mfa_verified_at)
      BETWEEN 0 AND 300
    AND s.expires_at > NEW.created_at
    AND coalesce(s.idle_expires_at, s.expires_at) > NEW.created_at
    AND (
      s.device_id IS NULL
      OR (d.id IS NOT NULL AND d.revoked_at IS NULL)
    )
    AND actor.role = 'administrator'
    AND actor.granted_at <= NEW.created_at
    AND actor.expires_at > NEW.created_at
    AND (
      actor.revoked_at IS NULL
      OR actor.revoked_at >= NEW.created_at
    )
    AND EXISTS (
      SELECT 1
      FROM "auth_totp_credentials" t
      WHERE t.user_id = NEW.actor_user_id
        AND t.status = 'active'
        AND t.verified_at IS NOT NULL
        AND t.verified_at <= NEW.actor_mfa_verified_at
        AND t.disabled_at IS NULL
    )
)
OR NOT EXISTS (
  SELECT 1
  FROM "platform_staff_assignments" subject
  WHERE subject.id = NEW.subject_assignment_id
    AND subject.user_id = NEW.subject_user_id
    AND subject.role = NEW.role
    AND subject.granted_at <= NEW.created_at
    AND subject.expires_at > NEW.created_at
    AND (
      (
        NEW.event_type = 'staff.role.granted'
        AND subject.grant_source = 'administrator'
        AND subject.granted_by_user_id = NEW.actor_user_id
        AND subject.grant_reason = NEW.reason
        AND subject.granted_at = NEW.created_at
        AND subject.created_at = NEW.created_at
        AND subject.updated_at = NEW.created_at
        AND subject.revoked_at IS NULL
      )
      OR
      (
        NEW.event_type = 'staff.role.revoked'
        AND subject.revocation_source = 'administrator'
        AND subject.revoked_by_user_id = NEW.actor_user_id
        AND subject.revocation_reason = NEW.reason
        AND subject.revoked_at = NEW.created_at
        AND subject.updated_at = NEW.created_at
      )
    )
) THEN
RAISE EXCEPTION USING MESSAGE = 'platform staff role event evidence mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "platform_staff_role_events_consistency" BEFORE INSERT ON "platform_staff_role_events"
FOR EACH ROW EXECUTE FUNCTION guard_c61e25e0e60ba42c3a0ff32b();

-- platform_staff_role_events_no_update
CREATE FUNCTION guard_06a8ae8558acb800f67d2184() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'platform staff role events are append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "platform_staff_role_events_no_update" BEFORE UPDATE ON "platform_staff_role_events"
FOR EACH ROW EXECUTE FUNCTION guard_06a8ae8558acb800f67d2184();

-- platform_staff_role_events_no_delete
CREATE FUNCTION guard_116eeeb459482675966f7719() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'platform staff role events are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "platform_staff_role_events_no_delete" BEFORE DELETE ON "platform_staff_role_events"
FOR EACH ROW EXECUTE FUNCTION guard_116eeeb459482675966f7719();

-- workspace_invitations_acceptance_insert_guard
CREATE FUNCTION guard_8839ef43159e7b960f75b42b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (NEW."accepted_at" IS NULL AND NEW."acceptance_claim_id" IS NOT NULL)
  OR
  (NEW."accepted_at" IS NOT NULL AND NEW."acceptance_claim_id" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'workspace invitation acceptance evidence incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "workspace_invitations_acceptance_insert_guard" BEFORE INSERT ON "workspace_invitations"
FOR EACH ROW EXECUTE FUNCTION guard_8839ef43159e7b960f75b42b();

-- workspace_invitations_acceptance_update_guard
CREATE FUNCTION guard_0f0a8d6f858e7838b682519c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (NEW."accepted_at" IS NULL AND NEW."acceptance_claim_id" IS NOT NULL)
  OR
  (NEW."accepted_at" IS NOT NULL AND NEW."acceptance_claim_id" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'workspace invitation acceptance evidence incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "workspace_invitations_acceptance_update_guard" BEFORE UPDATE OF "accepted_at","acceptance_claim_id" ON "workspace_invitations"
FOR EACH ROW EXECUTE FUNCTION guard_0f0a8d6f858e7838b682519c();

-- workspace_invitations_acceptance_immutable_guard
CREATE FUNCTION guard_70462b4618cac54e9169d403() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."acceptance_claim_id" IS NOT NULL
  AND (
    NEW."accepted_at" IS DISTINCT FROM OLD."accepted_at"
    OR NEW."acceptance_claim_id" IS DISTINCT FROM OLD."acceptance_claim_id"
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'workspace invitation acceptance is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "workspace_invitations_acceptance_immutable_guard" BEFORE UPDATE OF "accepted_at","acceptance_claim_id" ON "workspace_invitations"
FOR EACH ROW EXECUTE FUNCTION guard_70462b4618cac54e9169d403();

-- auth_otp_verification_lock_insert_guard
CREATE FUNCTION guard_c318c07c478e6f668ba64fc1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."verification_locked_until" IS NOT NULL
  AND NEW."attempt_count" < NEW."max_attempts" THEN
RAISE EXCEPTION USING MESSAGE = 'OTP verification lock requires exhausted attempts', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "auth_otp_verification_lock_insert_guard" BEFORE INSERT ON "auth_otp_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_c318c07c478e6f668ba64fc1();

-- auth_otp_verification_lock_update_guard
CREATE FUNCTION guard_a1b14b4e3cea73beab880cbd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."verification_locked_until" IS NOT NULL
  AND NEW."attempt_count" < NEW."max_attempts" THEN
RAISE EXCEPTION USING MESSAGE = 'OTP verification lock requires exhausted attempts', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "auth_otp_verification_lock_update_guard" BEFORE UPDATE OF "attempt_count","max_attempts","verification_locked_until" ON "auth_otp_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_a1b14b4e3cea73beab880cbd();

-- auth_otp_verification_lock_immutable_guard
CREATE FUNCTION guard_d36672cc92a88cbd4e9ca047() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."verification_locked_until" IS NOT NULL
  AND NEW."verification_locked_until" IS DISTINCT FROM OLD."verification_locked_until" THEN
RAISE EXCEPTION USING MESSAGE = 'OTP verification lock is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "auth_otp_verification_lock_immutable_guard" BEFORE UPDATE OF "verification_locked_until" ON "auth_otp_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_d36672cc92a88cbd4e9ca047();

-- legal_sources_verification_insert_guard
CREATE FUNCTION guard_aaf2fc6d2df00516cf181587() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."verification_state" NOT IN ('draft','fetched','pending_review','verified','rejected','archived','unavailable') THEN
RAISE EXCEPTION USING MESSAGE = 'legal source verification state invalid', ERRCODE = '23514';
END IF;
IF NEW."source_type" NOT IN ('lex','advice','internal') THEN
RAISE EXCEPTION USING MESSAGE = 'legal source type invalid', ERRCODE = '23514';
END IF;
IF NEW."verification_state" = 'verified' AND (
      NEW."verified_at" IS NULL OR NEW."verified_by_user_id" IS NULL OR
      NEW."content_sha256" IS NULL OR length(NEW."content_sha256") <> 64 OR
      NEW."content_sha256" ~ '^.*[^0-9a-f].*$' OR
      NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id" = NEW."verified_by_user_id")
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'verified legal source requires exact evidence', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_sources_verification_insert_guard" BEFORE INSERT ON "legal_sources"
FOR EACH ROW EXECUTE FUNCTION guard_aaf2fc6d2df00516cf181587();

-- legal_source_versions_insert_guard
CREATE FUNCTION guard_749d424a85a3e16de95efdf6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" NOT IN ('pending_review','verified','rejected','archived','unavailable') THEN
RAISE EXCEPTION USING MESSAGE = 'legal source version status invalid', ERRCODE = '23514';
END IF;
IF length(NEW."content_sha256") <> 64 OR NEW."content_sha256" ~ '^.*[^0-9a-f].*$' THEN
RAISE EXCEPTION USING MESSAGE = 'legal source version hash invalid', ERRCODE = '23514';
END IF;
IF NEW."status" = 'verified' AND (NEW."verified_at" IS NULL OR NEW."verified_by_user_id" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'verified legal source version requires evidence', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_versions_insert_guard" BEFORE INSERT ON "legal_source_versions"
FOR EACH ROW EXECUTE FUNCTION guard_749d424a85a3e16de95efdf6();

-- legal_source_versions_update_guard
CREATE FUNCTION guard_bcaadab2bc1094d13e99ff3b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" NOT IN ('pending_review','verified','rejected','archived','unavailable') THEN
RAISE EXCEPTION USING MESSAGE = 'legal source version status invalid', ERRCODE = '23514';
END IF;
IF length(NEW."content_sha256") <> 64 OR NEW."content_sha256" ~ '^.*[^0-9a-f].*$' THEN
RAISE EXCEPTION USING MESSAGE = 'legal source version hash invalid', ERRCODE = '23514';
END IF;
IF NEW."status" = 'verified' AND (NEW."verified_at" IS NULL OR NEW."verified_by_user_id" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'verified legal source version requires evidence', ERRCODE = '23514';
END IF;
IF OLD."status" = 'verified' AND NEW."status" = 'verified' AND (
      NEW."content_sha256" <> OLD."content_sha256" OR
      NEW."verified_at" <> OLD."verified_at" OR
      NEW."verified_by_user_id" <> OLD."verified_by_user_id"
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'verified legal source version evidence is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_versions_update_guard" BEFORE UPDATE OF "status","content_sha256","verified_at","verified_by_user_id" ON "legal_source_versions"
FOR EACH ROW EXECUTE FUNCTION guard_bcaadab2bc1094d13e99ff3b();

-- legal_review_queue_insert_guard
CREATE FUNCTION guard_7337472305eddd2790dce0f0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."confidence" NOT IN ('high','medium','low') OR
        NEW."status" NOT IN ('pending','in_review','approved','rejected','closed') THEN
RAISE EXCEPTION USING MESSAGE = 'legal review state invalid', ERRCODE = '23514';
END IF;
IF NEW."status" IN ('approved','rejected') AND (NEW."decision" IS NULL OR NEW."decided_at" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'legal review decision evidence required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_review_queue_insert_guard" BEFORE INSERT ON "legal_review_queue"
FOR EACH ROW EXECUTE FUNCTION guard_7337472305eddd2790dce0f0();

-- legal_review_queue_update_guard
CREATE FUNCTION guard_fcf17d235ee79df394e58e91() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."confidence" NOT IN ('high','medium','low') OR
        NEW."status" NOT IN ('pending','in_review','approved','rejected','closed') THEN
RAISE EXCEPTION USING MESSAGE = 'legal review state invalid', ERRCODE = '23514';
END IF;
IF NEW."status" IN ('approved','rejected') AND (NEW."decision" IS NULL OR NEW."decided_at" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'legal review decision evidence required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_review_queue_update_guard" BEFORE UPDATE OF "confidence","status","decision","decided_at" ON "legal_review_queue"
FOR EACH ROW EXECUTE FUNCTION guard_fcf17d235ee79df394e58e91();

-- legal_source_fetch_requests_update_guard
CREATE FUNCTION guard_fe3e50c4b4cd7d877a131787() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."environment" <> OLD."environment" OR
        NEW."source_kind" <> OLD."source_kind" OR
        NEW."locale" <> OLD."locale" OR
        NEW."requested_url" <> OLD."requested_url" OR
        NEW."canonical_id" <> OLD."canonical_id" OR
        NEW."idempotency_key" <> OLD."idempotency_key" THEN
RAISE EXCEPTION USING MESSAGE = 'legal source fetch request identity is immutable', ERRCODE = '23514';
END IF;
IF NEW."status" NOT IN ('queued','running','retrying','completed','failed','cancelled') OR
         NEW."attempt_count" < OLD."attempt_count" OR
         (NEW."source_id" IS NULL) <> (NEW."version_id" IS NULL) OR
         (OLD."status" = 'queued' AND NEW."status" NOT IN ('queued','running','cancelled')) OR
         (OLD."status" = 'running' AND NEW."status" NOT IN ('running','retrying','completed','failed','cancelled')) OR
         (OLD."status" = 'retrying' AND NEW."status" NOT IN ('retrying','running','failed','cancelled')) OR
         (OLD."status" IN ('completed','failed','cancelled') AND NEW."status" <> OLD."status") OR
         (NEW."status" = 'queued' AND (
           NEW."attempt_count" <> 0 OR NEW."started_at" IS NOT NULL OR
           NEW."finished_at" IS NOT NULL OR NEW."source_id" IS NOT NULL OR
           NEW."error_code" IS NOT NULL
         )) OR
         (NEW."status" = 'running' AND (
           NEW."attempt_count" < 1 OR NEW."started_at" IS NULL OR
           NEW."finished_at" IS NOT NULL OR NEW."source_id" IS NOT NULL OR
           NEW."error_code" IS NOT NULL
         )) OR
         (NEW."status" = 'retrying' AND (
           NEW."attempt_count" < 1 OR NEW."started_at" IS NULL OR
           NEW."finished_at" IS NOT NULL OR NEW."source_id" IS NOT NULL OR
           NEW."error_code" IS NULL
         )) OR
         (NEW."status" = 'completed' AND (
           NEW."attempt_count" < 1 OR NEW."started_at" IS NULL OR
           NEW."finished_at" IS NULL OR NEW."source_id" IS NULL OR
           NEW."version_id" IS NULL OR NEW."error_code" IS NOT NULL
         )) OR
         (NEW."status" = 'failed' AND (
           NEW."attempt_count" < 1 OR NEW."started_at" IS NULL OR
           NEW."finished_at" IS NULL OR NEW."source_id" IS NOT NULL OR
           NEW."error_code" IS NULL
         )) OR
        (NEW."status" = 'cancelled' AND NEW."finished_at" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source fetch request lifecycle invalid', ERRCODE = '23514';
END IF;
IF OLD."status" = 'completed' AND (
      NEW."status" <> OLD."status" OR
      NEW."source_id" <> OLD."source_id" OR
      NEW."version_id" <> OLD."version_id" OR
      NEW."finished_at" <> OLD."finished_at"
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'completed legal source fetch request is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_fetch_requests_update_guard" BEFORE UPDATE ON "legal_source_fetch_requests"
FOR EACH ROW EXECUTE FUNCTION guard_fe3e50c4b4cd7d877a131787();

-- legal_review_queue_decision_evidence_insert_guard
CREATE FUNCTION guard_759df7ca0a755c202db8a682() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" IN ('approved','rejected') OR
     NEW."decision" IS NOT NULL OR NEW."decision_notes" IS NOT NULL OR
     NEW."reviewed_parsed_sha256" IS NOT NULL OR
     NEW."decided_by_user_id" IS NOT NULL OR
     NEW."decision_evidence_json" IS NOT NULL OR
     NEW."decision_evidence_sha256" IS NOT NULL OR NEW."decided_at" IS NOT NULL THEN
IF COALESCE((
      ((NEW."status" = 'approved' AND NEW."decision" = 'approve') OR
       (NEW."status" = 'rejected' AND NEW."decision" = 'reject')) AND
      NEW."decision_notes" IS NOT NULL AND
      length(NEW."decision_notes") BETWEEN 10 AND 2000 AND
      NEW."reviewed_parsed_sha256" IS NOT NULL AND
      length(NEW."reviewed_parsed_sha256") = 64 AND
      NEW."reviewed_parsed_sha256" !~ '^.*[^0-9a-f].*$' AND
      NEW."decided_by_user_id" IS NOT NULL AND
      NEW."assigned_to_user_id" = NEW."decided_by_user_id" AND
      NEW."decision_evidence_json" IS NOT NULL AND
      length(NEW."decision_evidence_json") BETWEEN 2 AND 8192 AND
      json_valid(NEW."decision_evidence_json") = true AND
      CAST(json_extract(NEW."decision_evidence_json", '$.schemaVersion') AS numeric) = 1 AND
      json_extract(NEW."decision_evidence_json", '$.reviewId') = NEW."id" AND
      json_extract(NEW."decision_evidence_json", '$.sourceId') = NEW."source_id" AND
      json_extract(NEW."decision_evidence_json", '$.versionId') = NEW."version_id" AND
      json_extract(NEW."decision_evidence_json", '$.rawContentSha256') =
        (SELECT "content_sha256" FROM "legal_source_versions" WHERE "id" = NEW."version_id") AND
      json_extract(NEW."decision_evidence_json", '$.parsedContentSha256') = NEW."reviewed_parsed_sha256" AND
      json_extract(NEW."decision_evidence_json", '$.decision') = NEW."decision" AND
      json_extract(NEW."decision_evidence_json", '$.notes') = NEW."decision_notes" AND
      json_extract(NEW."decision_evidence_json", '$.reviewerUserId') = NEW."decided_by_user_id" AND
      length(json_extract(NEW."decision_evidence_json", '$.reviewerSessionId')) > 0 AND
      json_array_length(json_extract(NEW."decision_evidence_json", '$.reviewerAssignmentIds')) BETWEEN 1 AND 16 AND
      length(json_extract(NEW."decision_evidence_json", '$.mfaVerifiedAt')) > 0 AND
      json_extract(NEW."decision_evidence_json", '$.decidedAt') = NEW."decided_at" AND
      NEW."decision_evidence_sha256" IS NOT NULL AND
      length(NEW."decision_evidence_sha256") = 64 AND
      NEW."decision_evidence_sha256" !~ '^.*[^0-9a-f].*$' AND
      NEW."decided_at" IS NOT NULL
    ), 0) = 0 THEN
RAISE EXCEPTION USING MESSAGE = 'legal review decision evidence invalid', ERRCODE = '23514';
END IF;
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_review_queue_decision_evidence_insert_guard" BEFORE INSERT ON "legal_review_queue"
FOR EACH ROW EXECUTE FUNCTION guard_759df7ca0a755c202db8a682();

-- legal_review_queue_decision_evidence_update_guard
CREATE FUNCTION guard_d6a824388061b691cbcae55c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" IN ('approved','rejected') OR
     NEW."decision" IS NOT NULL OR NEW."decision_notes" IS NOT NULL OR
     NEW."reviewed_parsed_sha256" IS NOT NULL OR
     NEW."decided_by_user_id" IS NOT NULL OR
     NEW."decision_evidence_json" IS NOT NULL OR
     NEW."decision_evidence_sha256" IS NOT NULL OR NEW."decided_at" IS NOT NULL THEN
IF COALESCE((
      ((NEW."status" = 'approved' AND NEW."decision" = 'approve') OR
       (NEW."status" = 'rejected' AND NEW."decision" = 'reject')) AND
      NEW."decision_notes" IS NOT NULL AND
      length(NEW."decision_notes") BETWEEN 10 AND 2000 AND
      NEW."reviewed_parsed_sha256" IS NOT NULL AND
      length(NEW."reviewed_parsed_sha256") = 64 AND
      NEW."reviewed_parsed_sha256" !~ '^.*[^0-9a-f].*$' AND
      NEW."decided_by_user_id" IS NOT NULL AND
      NEW."assigned_to_user_id" = NEW."decided_by_user_id" AND
      NEW."decision_evidence_json" IS NOT NULL AND
      length(NEW."decision_evidence_json") BETWEEN 2 AND 8192 AND
      json_valid(NEW."decision_evidence_json") = true AND
      CAST(json_extract(NEW."decision_evidence_json", '$.schemaVersion') AS numeric) = 1 AND
      json_extract(NEW."decision_evidence_json", '$.reviewId') = NEW."id" AND
      json_extract(NEW."decision_evidence_json", '$.sourceId') = NEW."source_id" AND
      json_extract(NEW."decision_evidence_json", '$.versionId') = NEW."version_id" AND
      json_extract(NEW."decision_evidence_json", '$.rawContentSha256') =
        (SELECT "content_sha256" FROM "legal_source_versions" WHERE "id" = NEW."version_id") AND
      json_extract(NEW."decision_evidence_json", '$.parsedContentSha256') = NEW."reviewed_parsed_sha256" AND
      json_extract(NEW."decision_evidence_json", '$.decision') = NEW."decision" AND
      json_extract(NEW."decision_evidence_json", '$.notes') = NEW."decision_notes" AND
      json_extract(NEW."decision_evidence_json", '$.reviewerUserId') = NEW."decided_by_user_id" AND
      length(json_extract(NEW."decision_evidence_json", '$.reviewerSessionId')) > 0 AND
      json_array_length(json_extract(NEW."decision_evidence_json", '$.reviewerAssignmentIds')) BETWEEN 1 AND 16 AND
      length(json_extract(NEW."decision_evidence_json", '$.mfaVerifiedAt')) > 0 AND
      json_extract(NEW."decision_evidence_json", '$.decidedAt') = NEW."decided_at" AND
      NEW."decision_evidence_sha256" IS NOT NULL AND
      length(NEW."decision_evidence_sha256") = 64 AND
      NEW."decision_evidence_sha256" !~ '^.*[^0-9a-f].*$' AND
      NEW."decided_at" IS NOT NULL
    ), 0) = 0 THEN
RAISE EXCEPTION USING MESSAGE = 'legal review decision evidence invalid', ERRCODE = '23514';
END IF;
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_review_queue_decision_evidence_update_guard" BEFORE UPDATE ON "legal_review_queue"
FOR EACH ROW EXECUTE FUNCTION guard_d6a824388061b691cbcae55c();

-- legal_review_queue_terminal_immutable_guard
CREATE FUNCTION guard_37cb6f3c2e95bbacaf852b48() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status" IN ('approved','rejected') AND (
  NEW."source_id" IS DISTINCT FROM OLD."source_id" OR
  NEW."version_id" IS DISTINCT FROM OLD."version_id" OR
  NEW."reason_code" IS DISTINCT FROM OLD."reason_code" OR
  NEW."confidence" IS DISTINCT FROM OLD."confidence" OR
  NEW."status" IS DISTINCT FROM OLD."status" OR
  NEW."assigned_to_user_id" IS DISTINCT FROM OLD."assigned_to_user_id" OR
  NEW."decision" IS DISTINCT FROM OLD."decision" OR
  NEW."decision_notes" IS DISTINCT FROM OLD."decision_notes" OR
  NEW."reviewed_parsed_sha256" IS DISTINCT FROM OLD."reviewed_parsed_sha256" OR
  NEW."decided_by_user_id" IS DISTINCT FROM OLD."decided_by_user_id" OR
  NEW."decision_evidence_json" IS DISTINCT FROM OLD."decision_evidence_json" OR
  NEW."decision_evidence_sha256" IS DISTINCT FROM OLD."decision_evidence_sha256" OR
  NEW."decided_at" IS DISTINCT FROM OLD."decided_at"
) THEN
RAISE EXCEPTION USING MESSAGE = 'legal review terminal evidence is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_review_queue_terminal_immutable_guard" BEFORE UPDATE ON "legal_review_queue"
FOR EACH ROW EXECUTE FUNCTION guard_37cb6f3c2e95bbacaf852b48();

-- legal_review_queue_terminal_delete_guard
CREATE FUNCTION guard_d2ed9ec62bda8278238a1401() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status" IN ('approved','rejected') THEN
RAISE EXCEPTION USING MESSAGE = 'legal review terminal evidence cannot be deleted', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_review_queue_terminal_delete_guard" BEFORE DELETE ON "legal_review_queue"
FOR EACH ROW EXECUTE FUNCTION guard_d2ed9ec62bda8278238a1401();

-- legal_source_publications_immutable_guard
CREATE FUNCTION guard_325e00a0aeae97b1a53047fe() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'legal source publication evidence is immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_publications_immutable_guard" BEFORE UPDATE ON "legal_source_publications"
FOR EACH ROW EXECUTE FUNCTION guard_325e00a0aeae97b1a53047fe();

-- legal_source_publications_delete_guard
CREATE FUNCTION guard_d391e4633eabe51d2b1f5648() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'legal source publication evidence cannot be deleted', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_publications_delete_guard" BEFORE DELETE ON "legal_source_publications"
FOR EACH ROW EXECUTE FUNCTION guard_d391e4633eabe51d2b1f5648();

-- published_legal_source_sections_insert_guard
CREATE FUNCTION guard_1a6fb16b660b7f0f91c3c51f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "legal_source_publications" WHERE "version_id" = NEW."version_id"
) THEN
RAISE EXCEPTION USING MESSAGE = 'published legal source sections are immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "published_legal_source_sections_insert_guard" BEFORE INSERT ON "legal_source_sections"
FOR EACH ROW EXECUTE FUNCTION guard_1a6fb16b660b7f0f91c3c51f();

-- published_legal_source_sections_update_guard
CREATE FUNCTION guard_f8a6d217f8470ab68ea54983() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "legal_source_publications" WHERE "version_id" = OLD."version_id"
) THEN
RAISE EXCEPTION USING MESSAGE = 'published legal source sections are immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "published_legal_source_sections_update_guard" BEFORE UPDATE ON "legal_source_sections"
FOR EACH ROW EXECUTE FUNCTION guard_f8a6d217f8470ab68ea54983();

-- published_legal_source_sections_delete_guard
CREATE FUNCTION guard_429816c10df5a5377d3785e7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "legal_source_publications" WHERE "version_id" = OLD."version_id"
) THEN
RAISE EXCEPTION USING MESSAGE = 'published legal source sections are immutable', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "published_legal_source_sections_delete_guard" BEFORE DELETE ON "legal_source_sections"
FOR EACH ROW EXECUTE FUNCTION guard_429816c10df5a5377d3785e7();

-- published_legal_source_chunks_insert_guard
CREATE FUNCTION guard_def9106047e03782a4a4efe7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "legal_source_publications" WHERE "version_id" = NEW."version_id"
) THEN
RAISE EXCEPTION USING MESSAGE = 'published legal source chunks are immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "published_legal_source_chunks_insert_guard" BEFORE INSERT ON "legal_source_chunks"
FOR EACH ROW EXECUTE FUNCTION guard_def9106047e03782a4a4efe7();

-- published_legal_source_chunks_delete_guard
CREATE FUNCTION guard_ba18cb0bfde9c613f002358e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "legal_source_publications" WHERE "version_id" = OLD."version_id"
) THEN
RAISE EXCEPTION USING MESSAGE = 'published legal source chunks are immutable', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "published_legal_source_chunks_delete_guard" BEFORE DELETE ON "legal_source_chunks"
FOR EACH ROW EXECUTE FUNCTION guard_ba18cb0bfde9c613f002358e();

-- account_deletion_requests_insert_guard
CREATE FUNCTION guard_994e8f91f8ce42be6969b4b0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW.deletion_mode NOT IN ('immediate','recoverable_30d')
  OR NEW.status NOT IN ('requested','reviewing','scheduled','purging','blocked','cancelled','completed','failed')
  OR (
    NEW.status IN ('scheduled','purging','cancelled','completed')
    AND (
      NEW.subject_hash IS NULL
      OR length(NEW.subject_hash)<>64
      OR NEW.subject_hash ~ '^.*[^0-9a-f].*$'
      OR NEW.subject_key_version IS NULL
      OR length(NEW.subject_key_version) NOT BETWEEN 1 AND 64
      OR NEW.scheduled_purge_at IS NULL
    )
  )
  OR (NEW.status='cancelled' AND (NEW.cancelled_at IS NULL OR NEW.purge_irreversible_at IS NOT NULL))
  OR (NEW.status='completed' AND (NEW.completed_at IS NULL OR NEW.purge_irreversible_at IS NULL))
  OR (NEW.purge_irreversible_at IS NOT NULL AND NEW.status NOT IN ('scheduled','purging','completed','failed'))
  OR (
    NEW.status='purging'
    AND (NEW.purge_started_at IS NULL OR NEW.purge_lease_owner IS NULL OR NEW.purge_lease_expires_at IS NULL)
  )
  OR (NEW.status='blocked' AND NEW.failure_code IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'ACCOUNT_DELETION_REQUEST_STATE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_requests_insert_guard" BEFORE INSERT ON account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION guard_994e8f91f8ce42be6969b4b0();

-- account_deletion_requests_update_guard
CREATE FUNCTION guard_ee46600372b3d47a49e38905() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD.status IN ('cancelled','completed')
  OR NOT (NEW.user_id IS NOT DISTINCT FROM OLD.user_id)
  OR NOT (NEW.deletion_mode IS NOT DISTINCT FROM OLD.deletion_mode)
  OR NOT (NEW.subject_hash IS NOT DISTINCT FROM OLD.subject_hash)
  OR NOT (NEW.subject_key_version IS NOT DISTINCT FROM OLD.subject_key_version)
  OR NOT (NEW.requested_at IS NOT DISTINCT FROM OLD.requested_at)
  OR NOT (NEW.scheduled_purge_at IS NOT DISTINCT FROM OLD.scheduled_purge_at)
  OR NEW.deletion_mode NOT IN ('immediate','recoverable_30d')
  OR NEW.status NOT IN ('requested','reviewing','scheduled','purging','blocked','cancelled','completed','failed')
  OR (
    NEW.status IN ('scheduled','purging','cancelled','completed')
    AND (
      NEW.subject_hash IS NULL
      OR length(NEW.subject_hash)<>64
      OR NEW.subject_hash ~ '^.*[^0-9a-f].*$'
      OR NEW.subject_key_version IS NULL
      OR length(NEW.subject_key_version) NOT BETWEEN 1 AND 64
      OR NEW.scheduled_purge_at IS NULL
    )
  )
  OR (NEW.status='cancelled' AND (NEW.cancelled_at IS NULL OR NEW.purge_irreversible_at IS NOT NULL))
  OR (NEW.status='completed' AND (NEW.completed_at IS NULL OR NEW.purge_irreversible_at IS NULL))
  OR (NEW.purge_irreversible_at IS NOT NULL AND NEW.status NOT IN ('scheduled','purging','completed','failed'))
  OR (
    NEW.status='purging'
    AND (NEW.purge_started_at IS NULL OR NEW.purge_lease_owner IS NULL OR NEW.purge_lease_expires_at IS NULL)
  )
  OR (NEW.status='blocked' AND NEW.failure_code IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'ACCOUNT_DELETION_REQUEST_STATE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_requests_update_guard" BEFORE UPDATE ON account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION guard_ee46600372b3d47a49e38905();

-- account_deletion_lifecycle_events_insert_guard
CREATE FUNCTION guard_3b580935f55e3c15d28b1e29() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF length(NEW.subject_key_version) NOT BETWEEN 1 AND 64
  OR NEW.subject_hash ~ '^.*[^0-9a-f].*$'
  OR NEW.previous_hash ~ '^.*[^0-9a-f].*$'
  OR NEW.event_hash ~ '^.*[^0-9a-f].*$'
  OR json_valid(NEW.summary_json) <> true
  OR NOT EXISTS (
    SELECT 1 FROM account_deletion_requests request
    WHERE request.id=NEW.request_id
      AND request.subject_hash=NEW.subject_hash
      AND request.subject_key_version=NEW.subject_key_version
      AND request.deletion_mode=NEW.deletion_mode
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'ACCOUNT_DELETION_LIFECYCLE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_lifecycle_events_insert_guard" BEFORE INSERT ON account_deletion_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION guard_3b580935f55e3c15d28b1e29();

-- account_deletion_lifecycle_events_no_update
CREATE FUNCTION guard_446389083eb2ddc6c2c8a74e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'APPEND_ONLY_ACCOUNT_DELETION_LIFECYCLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_lifecycle_events_no_update" BEFORE UPDATE ON account_deletion_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION guard_446389083eb2ddc6c2c8a74e();

-- account_deletion_lifecycle_events_no_delete
CREATE FUNCTION guard_8b956043b37c6024849df54a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'APPEND_ONLY_ACCOUNT_DELETION_LIFECYCLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "account_deletion_lifecycle_events_no_delete" BEFORE DELETE ON account_deletion_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION guard_8b956043b37c6024849df54a();

-- account_deletion_purge_evidence_insert_guard
CREATE FUNCTION guard_2f2f1035ccb93bbb0a0f4507() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF length(NEW.subject_key_version) NOT BETWEEN 1 AND 64
  OR NEW.subject_hash ~ '^.*[^0-9a-f].*$'
  OR NEW.evidence_hash ~ '^.*[^0-9a-f].*$'
  OR json_valid(NEW.retained_evidence_json) <> true
  OR NOT EXISTS (
    SELECT 1 FROM account_deletion_requests request
    WHERE request.id=NEW.request_id
      AND request.status='completed'
      AND request.subject_hash=NEW.subject_hash
      AND request.subject_key_version=NEW.subject_key_version
      AND request.deletion_mode=NEW.deletion_mode
      AND request.completed_at=NEW.completed_at
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'ACCOUNT_DELETION_PURGE_EVIDENCE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_purge_evidence_insert_guard" BEFORE INSERT ON account_deletion_purge_evidence
FOR EACH ROW EXECUTE FUNCTION guard_2f2f1035ccb93bbb0a0f4507();

-- account_deletion_purge_evidence_no_update
CREATE FUNCTION guard_3ec5ca52c699582bcda844ee() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'APPEND_ONLY_ACCOUNT_DELETION_PURGE_EVIDENCE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_purge_evidence_no_update" BEFORE UPDATE ON account_deletion_purge_evidence
FOR EACH ROW EXECUTE FUNCTION guard_3ec5ca52c699582bcda844ee();

-- account_deletion_purge_evidence_no_delete
CREATE FUNCTION guard_1608b052b16594304bea1b32() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'APPEND_ONLY_ACCOUNT_DELETION_PURGE_EVIDENCE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "account_deletion_purge_evidence_no_delete" BEFORE DELETE ON account_deletion_purge_evidence
FOR EACH ROW EXECUTE FUNCTION guard_1608b052b16594304bea1b32();

-- user_profiles_lifecycle_insert_guard
CREATE FUNCTION guard_369b55d634c9f7afd54a28a4() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW.lifecycle_status<>'active'
  OR NEW.deletion_completed_at IS NOT NULL THEN
RAISE EXCEPTION USING MESSAGE = 'USER_PROFILE_LIFECYCLE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_profiles_lifecycle_insert_guard" BEFORE INSERT ON user_profiles
FOR EACH ROW EXECUTE FUNCTION guard_369b55d634c9f7afd54a28a4();

-- user_profiles_lifecycle_update_guard
CREATE FUNCTION guard_63c8c1e54ef7383e628d2e42() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD.lifecycle_status='deleted'
  OR NEW.lifecycle_status NOT IN ('active','deleted')
  OR (NEW.lifecycle_status='active' AND NEW.deletion_completed_at IS NOT NULL)
  OR (
    NEW.lifecycle_status='deleted'
    AND (
      NEW.deletion_completed_at IS NULL
      OR NEW.email NOT LIKE 'deleted.%@invalid.juro'
      OR NEW.email_ciphertext IS NOT NULL
      OR NEW.email_lookup_hash IS NOT NULL
      OR NEW.phone IS NOT NULL
      OR NEW.phone_ciphertext IS NOT NULL
      OR NEW.phone_lookup_hash IS NOT NULL
      OR NEW.full_name IS NOT NULL
      OR NEW.last_name IS NOT NULL
      OR NEW.first_name IS NOT NULL
      OR NEW.middle_name IS NOT NULL
      OR NEW.pinfl IS NOT NULL
      OR NEW.id_document_number IS NOT NULL
      OR NEW.registered_address IS NOT NULL
    )
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'USER_PROFILE_LIFECYCLE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_profiles_lifecycle_update_guard" BEFORE UPDATE ON user_profiles
FOR EACH ROW EXECUTE FUNCTION guard_63c8c1e54ef7383e628d2e42();

-- workspaces_business_identity_insert_guard
CREATE FUNCTION guard_7abcf7aee01e4f59a3bf82b4() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."type"='business' AND (
  NEW."full_name" IS NULL OR length(trim(NEW."full_name")) < 2
  OR length(NEW."full_name") > 200
  OR NEW."short_name" IS NULL OR length(trim(NEW."short_name")) < 2
  OR length(NEW."short_name") > 80
) THEN
RAISE EXCEPTION USING MESSAGE = 'WORKSPACE_BUSINESS_IDENTITY_REQUIRED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "workspaces_business_identity_insert_guard" BEFORE INSERT ON "workspaces"
FOR EACH ROW EXECUTE FUNCTION guard_7abcf7aee01e4f59a3bf82b4();

-- workspaces_business_identity_update_guard
CREATE FUNCTION guard_f8895ab66c1c4dfd2030a619() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."type"='business' AND (
  NEW."full_name" IS NULL OR length(trim(NEW."full_name")) < 2
  OR length(NEW."full_name") > 200
  OR NEW."short_name" IS NULL OR length(trim(NEW."short_name")) < 2
  OR length(NEW."short_name") > 80
) THEN
RAISE EXCEPTION USING MESSAGE = 'WORKSPACE_BUSINESS_IDENTITY_REQUIRED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "workspaces_business_identity_update_guard" BEFORE UPDATE OF "type","full_name","short_name" ON "workspaces"
FOR EACH ROW EXECUTE FUNCTION guard_f8895ab66c1c4dfd2030a619();

-- legal_sources_verification_update_guard
CREATE FUNCTION guard_d74dfc9143c1298b1e242552() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."verification_state" NOT IN ('draft','fetched','pending_review','verified','rejected','archived','unavailable') THEN
RAISE EXCEPTION USING MESSAGE = 'legal source verification state invalid', ERRCODE = '23514';
END IF;
IF NEW."source_type" NOT IN ('lex','advice','internal') THEN
RAISE EXCEPTION USING MESSAGE = 'legal source type invalid', ERRCODE = '23514';
END IF;
IF NEW."verification_state" = 'verified' AND (
      NEW."verified_at" IS NULL OR NEW."verified_by_user_id" IS NULL OR
      NEW."content_sha256" IS NULL OR length(NEW."content_sha256") <> 64 OR
      NEW."content_sha256" ~ '^.*[^0-9a-f].*$' OR
      NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id" = NEW."verified_by_user_id")
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'verified legal source requires exact evidence', ERRCODE = '23514';
END IF;
IF OLD."verification_state" = 'verified' AND NEW."verification_state" = 'verified' AND (
      NEW."content_sha256" <> OLD."content_sha256" OR
      NEW."verified_at" <> OLD."verified_at" OR
      NEW."verified_by_user_id" <> OLD."verified_by_user_id"
    ) AND NOT EXISTS (
      SELECT 1
      FROM "legal_source_publications" publication
      INNER JOIN "legal_source_versions" version
        ON version."id" = publication."version_id"
       AND version."source_id" = publication."source_id"
      WHERE publication."source_id" = NEW."id"
        AND publication."raw_content_sha256" = NEW."content_sha256"
        AND publication."published_at" = NEW."verified_at"
        AND publication."published_by_user_id" = NEW."verified_by_user_id"
        AND version."status" = 'verified'
        AND version."content_sha256" = NEW."content_sha256"
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'verified legal source evidence is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_sources_verification_update_guard" BEFORE UPDATE OF "verification_state","source_type","content_sha256","verified_at","verified_by_user_id" ON "legal_sources"
FOR EACH ROW EXECUTE FUNCTION guard_d74dfc9143c1298b1e242552();

-- legal_source_publications_insert_guard
CREATE FUNCTION guard_61de3c6c6b5f37403581ccde() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF length(NEW."review_evidence_sha256") <> 64 OR
         NEW."review_evidence_sha256" ~ '^.*[^0-9a-f].*$' OR
         length(NEW."raw_content_sha256") <> 64 OR
         NEW."raw_content_sha256" ~ '^.*[^0-9a-f].*$' OR
         length(NEW."parsed_content_sha256") <> 64 OR
         NEW."parsed_content_sha256" ~ '^.*[^0-9a-f].*$' OR
         length(NEW."publication_evidence_sha256") <> 64 OR
         NEW."publication_evidence_sha256" ~ '^.*[^0-9a-f].*$' THEN
RAISE EXCEPTION USING MESSAGE = 'legal source publication hash evidence invalid', ERRCODE = '23514';
END IF;
IF NOT EXISTS (
      SELECT 1 FROM "legal_review_queue" review
      WHERE review."id" = NEW."review_id"
        AND review."source_id" = NEW."source_id"
        AND review."version_id" = NEW."version_id"
        AND review."status" = 'approved'
        AND review."decision" = 'approve'
        AND review."decision_evidence_sha256" = NEW."review_evidence_sha256"
        AND review."reviewed_parsed_sha256" = NEW."parsed_content_sha256"
        AND review."decided_by_user_id" IS NOT NULL
    ) OR NOT EXISTS (
      SELECT 1 FROM "legal_source_versions" version
      WHERE version."id" = NEW."version_id"
        AND version."source_id" = NEW."source_id"
        AND version."status" = 'pending_review'
        AND version."content_sha256" = NEW."raw_content_sha256"
        AND version."parsed_object_key" IS NOT NULL
    ) OR NOT EXISTS (
      SELECT 1 FROM "legal_sources" source
      WHERE source."id" = NEW."source_id"
        AND (
          (
            source."status" <> 'verified'
            AND source."verification_state" <> 'verified'
            AND (
              source."content_sha256" = NEW."raw_content_sha256" OR (
                NOT EXISTS (
                  SELECT 1 FROM "legal_source_current_activations"
                  WHERE "source_id" = source."id"
                ) AND EXISTS (
                  SELECT 1 FROM "legal_source_lifecycle_events" withdrawn
                  WHERE withdrawn."source_id" = source."id"
                    AND withdrawn."event_type" = 'withdrawn'
                )
              )
            )
          ) OR (
            source."status" = 'verified'
            AND source."verification_state" = 'verified'
            AND EXISTS (
              SELECT 1
              FROM "legal_source_current_activations" current
              INNER JOIN "legal_source_publications" active_publication
                ON active_publication."id" = current."publication_id"
              WHERE current."source_id" = source."id"
                AND current."version_id" <> NEW."version_id"
                AND active_publication."source_id" = source."id"
                AND active_publication."raw_content_sha256" = source."content_sha256"
            )
          )
        )
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source publication review evidence invalid', ERRCODE = '23514';
END IF;
IF COALESCE((
      length(NEW."publication_evidence_json") BETWEEN 2 AND 8192 AND
      json_valid(NEW."publication_evidence_json") = true AND
      CAST(json_extract(NEW."publication_evidence_json", '$.schemaVersion') AS numeric) = 1 AND
      json_extract(NEW."publication_evidence_json", '$.publicationId') = NEW."id" AND
      json_extract(NEW."publication_evidence_json", '$.reviewId') = NEW."review_id" AND
      json_extract(NEW."publication_evidence_json", '$.sourceId') = NEW."source_id" AND
      json_extract(NEW."publication_evidence_json", '$.versionId') = NEW."version_id" AND
      json_extract(NEW."publication_evidence_json", '$.sourceKind') =
        (SELECT "source_type" FROM "legal_sources" WHERE "id" = NEW."source_id") AND
      json_extract(NEW."publication_evidence_json", '$.locale') =
        (SELECT "locale" FROM "legal_sources" WHERE "id" = NEW."source_id") AND
      json_extract(NEW."publication_evidence_json", '$.canonicalId') =
        (SELECT "canonical_id" FROM "legal_sources" WHERE "id" = NEW."source_id") AND
      json_extract(NEW."publication_evidence_json", '$.canonicalUrl') =
        (SELECT "official_url" FROM "legal_sources" WHERE "id" = NEW."source_id") AND
      length(json_extract(NEW."publication_evidence_json", '$.parserProfile')) BETWEEN 1 AND 128 AND
      json_extract(NEW."publication_evidence_json", '$.reviewEvidenceSha256') = NEW."review_evidence_sha256" AND
      json_extract(NEW."publication_evidence_json", '$.rawContentSha256') = NEW."raw_content_sha256" AND
      json_extract(NEW."publication_evidence_json", '$.parsedContentSha256') = NEW."parsed_content_sha256" AND
      json_extract(NEW."publication_evidence_json", '$.publishedByUserId') = NEW."published_by_user_id" AND
      length(json_extract(NEW."publication_evidence_json", '$.publisherSessionId')) > 0 AND
      json_type(NEW."publication_evidence_json", '$.publisherAssignmentIds') = 'array' AND
      json_array_length(json_extract(NEW."publication_evidence_json", '$.publisherAssignmentIds')) BETWEEN 1 AND 16 AND
      length(json_extract(NEW."publication_evidence_json", '$.mfaVerifiedAt')) > 0 AND
      json_extract(NEW."publication_evidence_json", '$.publishedAt') = NEW."published_at" AND
      json_extract(NEW."publication_evidence_json", '$.sectionCount') BETWEEN 1 AND 300 AND
      json_extract(NEW."publication_evidence_json", '$.chunkCount') BETWEEN 1 AND 300 AND
      json_extract(NEW."publication_evidence_json", '$.sectionCount') =
        (SELECT count(*) FROM "legal_source_sections" WHERE "version_id" = NEW."version_id") AND
      json_extract(NEW."publication_evidence_json", '$.chunkCount') =
        (SELECT count(*) FROM "legal_source_chunks" WHERE "version_id" = NEW."version_id") AND
      (SELECT count(DISTINCT "sequence") FROM "legal_source_sections"
        WHERE "version_id" = NEW."version_id") =
        (SELECT count(*) FROM "legal_source_sections" WHERE "version_id" = NEW."version_id") AND
      NOT EXISTS (
        SELECT 1 FROM "legal_source_sections" section
        WHERE section."version_id" = NEW."version_id" AND (
          section."canonical_ref" IS NULL OR length(section."canonical_ref") = 0 OR
          length(section."body_text") NOT BETWEEN 1 AND 8000 OR
          length(section."content_sha256") <> 64 OR
          section."content_sha256" ~ '^.*[^0-9a-f].*$' OR
          (SELECT count(*) FROM "legal_source_chunks" chunk
            WHERE chunk."version_id" = NEW."version_id"
              AND chunk."section_id" = section."id") <> 1
        )
      ) AND
      NOT EXISTS (
        SELECT 1 FROM "legal_source_chunks" chunk
        INNER JOIN "legal_source_sections" section
          ON section."id" = chunk."section_id"
          AND section."version_id" = chunk."version_id"
        WHERE chunk."version_id" = NEW."version_id" AND (
          chunk."chunk_index" <> section."sequence" OR
          chunk."language" <>
            (SELECT "locale" FROM "legal_sources" WHERE "id" = NEW."source_id") OR
          chunk."content_text" <> section."body_text" OR
          chunk."content_sha256" <> section."content_sha256" OR
          length(chunk."content_text") NOT BETWEEN 1 AND 8000 OR
          json_valid(chunk."metadata_json") <> true OR
          chunk."vector_id" IS NOT NULL OR chunk."indexed_at" IS NOT NULL
        )
      )
    ), 0) = 0 THEN
RAISE EXCEPTION USING MESSAGE = 'legal source publication canonical evidence invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_publications_insert_guard" BEFORE INSERT ON "legal_source_publications"
FOR EACH ROW EXECUTE FUNCTION guard_61de3c6c6b5f37403581ccde();

-- legal_source_lifecycle_events_insert_guard
CREATE FUNCTION guard_cd3daef0f17987b809353e90() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."event_type" NOT IN ('activated_initial','activated_replacement','withdrawn')
     OR length(NEW."evidence_sha256") <> 64
     OR NEW."evidence_sha256" ~ '^.*[^0-9a-f].*$'
     OR json_valid(NEW."actor_assignment_ids_json") <> true
     OR json_type(NEW."actor_assignment_ids_json") <> 'array'
     OR json_array_length(NEW."actor_assignment_ids_json") NOT BETWEEN 1 AND 16
     OR length(NEW."actor_session_id") NOT BETWEEN 1 AND 180
     OR length(NEW."mfa_verified_at") = 0
     OR length(NEW."occurred_at") = 0 THEN
RAISE EXCEPTION USING MESSAGE = 'legal source lifecycle event invalid', ERRCODE = '23514';
END IF;
IF COALESCE((
      length(NEW."evidence_json") BETWEEN 2 AND 8192 AND
      json_valid(NEW."evidence_json") = true AND
      CAST(json_extract(NEW."evidence_json", '$.schemaVersion') AS numeric) = 1 AND
      json_extract(NEW."evidence_json", '$.eventId') = NEW."id" AND
      json_extract(NEW."evidence_json", '$.eventType') = NEW."event_type" AND
      json_extract(NEW."evidence_json", '$.sourceId') = NEW."source_id" AND
      json_extract(NEW."evidence_json", '$.publicationId') = NEW."publication_id" AND
      json_extract(NEW."evidence_json", '$.versionId') = NEW."version_id" AND
      json_extract(NEW."evidence_json", '$.previousPublicationId') IS NOT DISTINCT FROM NEW."previous_publication_id" AND
      json_extract(NEW."evidence_json", '$.previousVersionId') IS NOT DISTINCT FROM NEW."previous_version_id" AND
      json_extract(NEW."evidence_json", '$.reasonNotes') IS NOT DISTINCT FROM NEW."reason_notes" AND
      json_extract(NEW."evidence_json", '$.actedByUserId') = NEW."acted_by_user_id" AND
      json_extract(NEW."evidence_json", '$.actorSessionId') = NEW."actor_session_id" AND
      canonical_json(json_extract(NEW."evidence_json", '$.actorAssignmentIds')) = canonical_json(NEW."actor_assignment_ids_json") AND
      json_extract(NEW."evidence_json", '$.mfaVerifiedAt') = NEW."mfa_verified_at" AND
      json_extract(NEW."evidence_json", '$.occurredAt') = NEW."occurred_at"
    ), 0) = 0 THEN
RAISE EXCEPTION USING MESSAGE = 'legal source lifecycle evidence invalid', ERRCODE = '23514';
END IF;
IF NOT EXISTS (
      SELECT 1
      FROM "legal_source_publications" publication
      INNER JOIN "legal_source_versions" version
        ON version."id" = publication."version_id"
       AND version."source_id" = publication."source_id"
      INNER JOIN "legal_sources" source
        ON source."id" = publication."source_id"
      WHERE publication."id" = NEW."publication_id"
        AND publication."source_id" = NEW."source_id"
        AND publication."version_id" = NEW."version_id"
        AND version."status" = 'verified'
        AND source."status" = 'verified'
        AND source."verification_state" = 'verified'
        AND source."content_sha256" = publication."raw_content_sha256"
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source lifecycle target invalid', ERRCODE = '23514';
END IF;
IF (
      NEW."event_type" = 'activated_initial'
      AND (
        NEW."previous_publication_id" IS NOT NULL OR
        NEW."previous_version_id" IS NOT NULL OR
        NEW."reason_notes" IS NOT NULL OR
        EXISTS (SELECT 1 FROM "legal_source_current_activations" WHERE "source_id" = NEW."source_id") OR
        EXISTS (
          SELECT 1 FROM "legal_source_lifecycle_events"
          WHERE "source_id" = NEW."source_id"
            AND "event_type" IN ('activated_initial','activated_replacement')
        )
      )
    ) OR (
      NEW."event_type" = 'activated_replacement'
      AND (
        NEW."previous_publication_id" IS NULL OR
        NEW."previous_version_id" IS NULL OR
        NEW."reason_notes" IS NOT NULL OR
        EXISTS (
          SELECT 1 FROM "legal_source_lifecycle_events" prior_replacement
          WHERE prior_replacement."source_id" = NEW."source_id"
            AND prior_replacement."event_type" = 'activated_replacement'
            AND prior_replacement."previous_publication_id" = NEW."previous_publication_id"
            AND prior_replacement."previous_version_id" = NEW."previous_version_id"
        ) OR
        NOT (
          EXISTS (
            SELECT 1 FROM "legal_source_current_activations" current
            WHERE current."source_id" = NEW."source_id"
              AND current."publication_id" = NEW."previous_publication_id"
              AND current."version_id" = NEW."previous_version_id"
          ) OR (
            NOT EXISTS (
              SELECT 1 FROM "legal_source_current_activations"
              WHERE "source_id" = NEW."source_id"
            ) AND EXISTS (
              SELECT 1 FROM "legal_source_lifecycle_events" prior
              WHERE prior."source_id" = NEW."source_id"
                AND prior."publication_id" = NEW."previous_publication_id"
                AND prior."version_id" = NEW."previous_version_id"
                AND prior."event_type" = 'withdrawn'
            )
          )
        )
      )
    ) OR (
      NEW."event_type" = 'withdrawn'
      AND (
        NEW."previous_publication_id" IS NOT NULL OR
        NEW."previous_version_id" IS NOT NULL OR
        NEW."reason_notes" IS NULL OR
        length(NEW."reason_notes") NOT BETWEEN 10 AND 2000 OR
        EXISTS (
          SELECT 1 FROM "legal_source_lifecycle_events" prior_withdrawal
          WHERE prior_withdrawal."source_id" = NEW."source_id"
            AND prior_withdrawal."publication_id" = NEW."publication_id"
            AND prior_withdrawal."version_id" = NEW."version_id"
            AND prior_withdrawal."event_type" = 'withdrawn'
        ) OR
        NOT EXISTS (
          SELECT 1 FROM "legal_source_current_activations" current
          WHERE current."source_id" = NEW."source_id"
            AND current."publication_id" = NEW."publication_id"
            AND current."version_id" = NEW."version_id"
        )
      )
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source lifecycle transition invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_lifecycle_events_insert_guard" BEFORE INSERT ON "legal_source_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_cd3daef0f17987b809353e90();

-- legal_source_lifecycle_events_update_guard
CREATE FUNCTION guard_1ed333d02c7290ebcff83645() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'legal source lifecycle evidence is immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_lifecycle_events_update_guard" BEFORE UPDATE ON "legal_source_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_1ed333d02c7290ebcff83645();

-- legal_source_lifecycle_events_delete_guard
CREATE FUNCTION guard_3a821147b9d9a89e3a4c633d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'legal source lifecycle evidence cannot be deleted', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_lifecycle_events_delete_guard" BEFORE DELETE ON "legal_source_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_3a821147b9d9a89e3a4c633d();

-- legal_source_current_activations_insert_guard
CREATE FUNCTION guard_3c8aa2bf5808f66a7d8e9878() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
      SELECT 1
      FROM "legal_source_publications" publication
      INNER JOIN "legal_source_versions" version
        ON version."id" = publication."version_id"
       AND version."source_id" = publication."source_id"
      INNER JOIN "legal_sources" source
        ON source."id" = publication."source_id"
      INNER JOIN "legal_source_lifecycle_events" lifecycle
        ON lifecycle."publication_id" = publication."id"
       AND lifecycle."version_id" = version."id"
       AND lifecycle."source_id" = source."id"
       AND lifecycle."event_type" IN ('activated_initial','activated_replacement')
      WHERE publication."id" = NEW."publication_id"
        AND publication."source_id" = NEW."source_id"
        AND publication."version_id" = NEW."version_id"
        AND version."status" = 'verified'
        AND source."status" = 'verified'
        AND source."verification_state" = 'verified'
        AND source."content_sha256" = publication."raw_content_sha256"
        AND lifecycle."acted_by_user_id" = NEW."activated_by_user_id"
        AND lifecycle."occurred_at" = NEW."activated_at"
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source current activation invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_current_activations_insert_guard" BEFORE INSERT ON "legal_source_current_activations"
FOR EACH ROW EXECUTE FUNCTION guard_3c8aa2bf5808f66a7d8e9878();

-- legal_source_current_activations_update_guard
CREATE FUNCTION guard_f9fba2696b415edb4ec0f357() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."source_id" <> OLD."source_id" OR NOT EXISTS (
      SELECT 1
      FROM "legal_source_publications" publication
      INNER JOIN "legal_source_versions" version
        ON version."id" = publication."version_id"
       AND version."source_id" = publication."source_id"
      INNER JOIN "legal_sources" source
        ON source."id" = publication."source_id"
      INNER JOIN "legal_source_lifecycle_events" lifecycle
        ON lifecycle."publication_id" = publication."id"
       AND lifecycle."version_id" = version."id"
       AND lifecycle."source_id" = source."id"
       AND lifecycle."event_type" = 'activated_replacement'
      WHERE publication."id" = NEW."publication_id"
        AND publication."source_id" = NEW."source_id"
        AND publication."version_id" = NEW."version_id"
        AND lifecycle."previous_publication_id" = OLD."publication_id"
        AND lifecycle."previous_version_id" = OLD."version_id"
        AND version."status" = 'verified'
        AND source."status" = 'verified'
        AND source."verification_state" = 'verified'
        AND source."content_sha256" = publication."raw_content_sha256"
        AND lifecycle."acted_by_user_id" = NEW."activated_by_user_id"
        AND lifecycle."occurred_at" = NEW."activated_at"
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source current activation invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_current_activations_update_guard" BEFORE UPDATE ON "legal_source_current_activations"
FOR EACH ROW EXECUTE FUNCTION guard_f9fba2696b415edb4ec0f357();

-- legal_source_current_activations_delete_guard
CREATE FUNCTION guard_225506607c94d0c6e6be097f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
      SELECT 1 FROM "legal_source_lifecycle_events"
      WHERE "source_id" = OLD."source_id"
        AND "publication_id" = OLD."publication_id"
        AND "version_id" = OLD."version_id"
        AND "event_type" = 'withdrawn'
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source current activation cannot be removed without withdrawal evidence', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_current_activations_delete_guard" BEFORE DELETE ON "legal_source_current_activations"
FOR EACH ROW EXECUTE FUNCTION guard_225506607c94d0c6e6be097f();

-- legal_source_fetch_requests_insert_guard
CREATE FUNCTION guard_3c3b511ce9b5155807f8c615() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."environment" NOT IN ('development','staging','production') OR
        NEW."source_kind" NOT IN ('lex','advice') OR
        NEW."locale" NOT IN ('ru','uz') OR
        NEW."status" NOT IN ('queued','running','retrying','completed','failed','cancelled') OR
        NEW."attempt_count" < 0 THEN
RAISE EXCEPTION USING MESSAGE = 'legal source fetch request scope invalid', ERRCODE = '23514';
END IF;
IF instr(NEW."requested_url", '?') > 0 OR
        instr(NEW."requested_url", '#') > 0 OR
        (NEW."source_kind" = 'lex' AND (
          substr(NEW."requested_url", 1, length('https://lex.uz/' || NEW."locale" || '/docs/')) <>
            'https://lex.uz/' || NEW."locale" || '/docs/' OR
          length(substr(NEW."requested_url", length('https://lex.uz/' || NEW."locale" || '/docs/') + 1)) = 0 OR
          (
            substr(
              substr(NEW."requested_url", length('https://lex.uz/' || NEW."locale" || '/docs/') + 1),
              1,
              1
            ) = '-' AND (
              length(substr(NEW."requested_url", length('https://lex.uz/' || NEW."locale" || '/docs/') + 1)) = 1 OR
              substr(
                substr(NEW."requested_url", length('https://lex.uz/' || NEW."locale" || '/docs/') + 1),
                2
              ) ~ '^.*[^0-9].*$'
            )
          ) OR
          (
            substr(
              substr(NEW."requested_url", length('https://lex.uz/' || NEW."locale" || '/docs/') + 1),
              1,
              1
            ) <> '-' AND
            substr(NEW."requested_url", length('https://lex.uz/' || NEW."locale" || '/docs/') + 1)
              ~ '^.*[^0-9].*$'
          ) OR
          NEW."canonical_id" <>
            substr(NEW."requested_url", length('https://lex.uz/' || NEW."locale" || '/docs/') + 1)
        )) OR
        (NEW."source_kind" = 'advice' AND (
          (NEW."locale" = 'ru' AND (
            substr(NEW."requested_url", 1, length('https://advice.uz/ru/documents/')) <>
              'https://advice.uz/ru/documents/' OR
            length(substr(NEW."requested_url", length('https://advice.uz/ru/documents/') + 1)) = 0 OR
            substr(NEW."requested_url", length('https://advice.uz/ru/documents/') + 1)
              ~ '^.*[^0-9].*$' OR
            NEW."canonical_id" <>
              substr(NEW."requested_url", length('https://advice.uz/ru/documents/') + 1)
          )) OR
          (NEW."locale" = 'uz' AND (
            substr(NEW."requested_url", 1, length('https://advice.uz/oz/documents/')) <>
              'https://advice.uz/oz/documents/' OR
            length(substr(NEW."requested_url", length('https://advice.uz/oz/documents/') + 1)) = 0 OR
            substr(NEW."requested_url", length('https://advice.uz/oz/documents/') + 1)
              ~ '^.*[^0-9].*$' OR
            NEW."canonical_id" <>
              substr(NEW."requested_url", length('https://advice.uz/oz/documents/') + 1)
          ))
        )) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source fetch request URL invalid', ERRCODE = '23514';
END IF;
IF (NEW."source_id" IS NULL) <> (NEW."version_id" IS NULL) OR
        (NEW."status" = 'queued' AND (
          NEW."attempt_count" <> 0 OR NEW."started_at" IS NOT NULL OR
          NEW."finished_at" IS NOT NULL OR NEW."source_id" IS NOT NULL OR
          NEW."error_code" IS NOT NULL
        )) OR
        (NEW."status" = 'running' AND (
          NEW."attempt_count" < 1 OR NEW."started_at" IS NULL OR
          NEW."finished_at" IS NOT NULL OR NEW."source_id" IS NOT NULL OR
          NEW."error_code" IS NOT NULL
        )) OR
        (NEW."status" = 'retrying' AND (
          NEW."attempt_count" < 1 OR NEW."started_at" IS NULL OR
          NEW."finished_at" IS NOT NULL OR NEW."source_id" IS NOT NULL OR
          NEW."error_code" IS NULL
        )) OR
        (NEW."status" = 'completed' AND (
          NEW."attempt_count" < 1 OR NEW."started_at" IS NULL OR
          NEW."finished_at" IS NULL OR NEW."source_id" IS NULL OR
          NEW."version_id" IS NULL OR NEW."error_code" IS NOT NULL
        )) OR
        (NEW."status" = 'failed' AND (
          NEW."attempt_count" < 1 OR NEW."started_at" IS NULL OR
          NEW."finished_at" IS NULL OR NEW."source_id" IS NOT NULL OR
          NEW."error_code" IS NULL
        )) OR
        (NEW."status" = 'cancelled' AND NEW."finished_at" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'legal source fetch request lifecycle invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_fetch_requests_insert_guard" BEFORE INSERT ON "legal_source_fetch_requests"
FOR EACH ROW EXECUTE FUNCTION guard_3c3b511ce9b5155807f8c615();

-- message_branches_insert_guard
CREATE FUNCTION guard_b0b597431e67120276995338() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
    SELECT 1 FROM "conversations" c
    WHERE c."id" = NEW."conversation_id"
      AND c."workspace_id" = NEW."workspace_id"
      AND c."owner_user_id" = NEW."owner_user_id"
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_BRANCH_TENANT_MISMATCH', ERRCODE = '23514';
END IF;
IF NOT EXISTS (
    SELECT 1 FROM "conversation_messages" m
    WHERE m."id" = NEW."request_message_id" AND m."conversation_id" = NEW."conversation_id" AND m."author_type" = 'user'
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_BRANCH_REQUEST_MISMATCH', ERRCODE = '23514';
END IF;
IF NOT EXISTS (
    SELECT 1 FROM "conversation_messages" m
    WHERE m."id" = NEW."response_message_id" AND m."conversation_id" = NEW."conversation_id" AND m."author_type" = 'assistant'
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_BRANCH_RESPONSE_MISMATCH', ERRCODE = '23514';
END IF;
IF NEW."parent_branch_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "message_branches" b WHERE b."id" = NEW."parent_branch_id" AND b."conversation_id" = NEW."conversation_id"
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_BRANCH_PARENT_MISMATCH', ERRCODE = '23514';
END IF;
IF NEW."forked_from_message_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "conversation_messages" m WHERE m."id" = NEW."forked_from_message_id" AND m."conversation_id" = NEW."conversation_id"
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_BRANCH_FORK_MISMATCH', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "message_branches_insert_guard" BEFORE INSERT ON "message_branches"
FOR EACH ROW EXECUTE FUNCTION guard_b0b597431e67120276995338();

-- message_versions_insert_guard
CREATE FUNCTION guard_6c73bf1dce914fe84be5dc6c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
    SELECT 1 FROM "message_branches" b
    WHERE b."id" = NEW."branch_id" AND b."conversation_id" = NEW."conversation_id"
      AND b."owner_user_id" = NEW."created_by_user_id" AND b."request_message_id" = NEW."message_id"
      AND b."operation" = NEW."operation"
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_VERSION_BRANCH_MISMATCH', ERRCODE = '23514';
END IF;
IF NEW."source_message_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "conversation_messages" m WHERE m."id" = NEW."source_message_id" AND m."conversation_id" = NEW."conversation_id"
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_VERSION_SOURCE_MISMATCH', ERRCODE = '23514';
END IF;
IF (NEW."source_message_id" IS NULL AND NEW."version_number" <> 1)
     OR (NEW."source_message_id" IS NOT NULL AND NEW."version_number" < 2) THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_VERSION_NUMBER_INVALID', ERRCODE = '23514';
END IF;
IF length(NEW."content_sha256") <> 64 OR NEW."content_sha256" ~ '^.*[^0-9a-f].*$' THEN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_VERSION_HASH_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "message_versions_insert_guard" BEFORE INSERT ON "message_versions"
FOR EACH ROW EXECUTE FUNCTION guard_6c73bf1dce914fe84be5dc6c();

-- message_branches_update_block
CREATE FUNCTION guard_ecbaeba2241051e1531a00cc() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_BRANCH_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "message_branches_update_block" BEFORE UPDATE ON "message_branches"
FOR EACH ROW EXECUTE FUNCTION guard_ecbaeba2241051e1531a00cc();

-- message_versions_update_block
CREATE FUNCTION guard_77474bb229b67af2d3aceded() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'MESSAGE_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "message_versions_update_block" BEFORE UPDATE ON "message_versions"
FOR EACH ROW EXECUTE FUNCTION guard_77474bb229b67af2d3aceded();

-- analysis_exports_insert_guard
CREATE FUNCTION guard_8db892b707c0c102e73ffa73() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
    SELECT 1 FROM document_analyses a
    WHERE a.id = NEW.analysis_id AND a.workspace_id = NEW.workspace_id
      AND a.owner_user_id = NEW.owner_user_id AND a.status = 'completed'
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_export_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_exports_insert_guard" BEFORE INSERT ON analysis_exports
FOR EACH ROW EXECUTE FUNCTION guard_8db892b707c0c102e73ffa73();

-- analysis_exports_update_guard
CREATE FUNCTION guard_5ff678db9e0676424d89d9e1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW.id <> OLD.id OR NEW.analysis_id <> OLD.analysis_id
    OR NEW.workspace_id <> OLD.workspace_id OR NEW.owner_user_id <> OLD.owner_user_id
    OR NEW.format <> OLD.format OR NEW.file_name <> OLD.file_name
    OR NEW.mime_type <> OLD.mime_type OR NEW.idempotency_key <> OLD.idempotency_key
    OR NEW.created_at <> OLD.created_at THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_export_identity_immutable', ERRCODE = '23514';
END IF;
IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('processing','failed'))
    OR (OLD.status = 'processing' AND NEW.status IN ('processing','retrying','completed','failed'))
    OR (OLD.status = 'retrying' AND NEW.status IN ('processing','failed'))
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_export_transition_invalid', ERRCODE = '23514';
END IF;
IF NEW.status = 'completed' AND (
    NEW.r2_key NOT LIKE 'exports/%' OR NEW.mime_type <> 'application/json'
    OR NEW.size_bytes IS NULL OR NEW.size_bytes < 2
    OR NEW.sha256 IS NULL OR length(NEW.sha256) <> 64
    OR NEW.completed_at IS NULL OR NEW.error_code IS NOT NULL
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_export_completion_invalid', ERRCODE = '23514';
END IF;
IF NEW.status <> 'completed' AND (
    NEW.r2_key IS NOT NULL OR NEW.size_bytes IS NOT NULL OR NEW.sha256 IS NOT NULL
    OR NEW.completed_at IS NOT NULL
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_export_incomplete_has_artifact', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_exports_update_guard" BEFORE UPDATE ON analysis_exports
FOR EACH ROW EXECUTE FUNCTION guard_5ff678db9e0676424d89d9e1();

-- analysis_report_exports_insert_guard
CREATE FUNCTION guard_2a6edd57e86b2bb370012b72() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
    SELECT 1 FROM document_analyses a
    WHERE a.id = NEW.analysis_id AND a.workspace_id = NEW.workspace_id
      AND a.owner_user_id = NEW.owner_user_id AND a.status = 'completed'
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_report_export_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_report_exports_insert_guard" BEFORE INSERT ON analysis_report_exports
FOR EACH ROW EXECUTE FUNCTION guard_2a6edd57e86b2bb370012b72();

-- analysis_report_exports_update_guard
CREATE FUNCTION guard_2e6e5f61e5518ee6e4584d13() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW.id <> OLD.id
    OR NEW.analysis_id <> OLD.analysis_id OR NEW.workspace_id <> OLD.workspace_id
    OR NEW.owner_user_id <> OLD.owner_user_id OR NEW.format <> OLD.format
    OR NEW.file_name <> OLD.file_name OR NEW.mime_type <> OLD.mime_type
    OR NEW.idempotency_key <> OLD.idempotency_key OR NEW.created_at <> OLD.created_at THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_report_export_identity_immutable', ERRCODE = '23514';
END IF;
IF NOT (
    (OLD.status = 'queued' AND NEW.status IN ('processing','failed'))
    OR (OLD.status = 'processing' AND NEW.status IN ('processing','retrying','completed','failed'))
    OR (OLD.status = 'retrying' AND NEW.status IN ('processing','failed'))
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_report_export_transition_invalid', ERRCODE = '23514';
END IF;
IF NEW.status = 'completed' AND (
    NEW.r2_key NOT LIKE 'exports/%'
    OR (NEW.format = 'pdf' AND (NEW.mime_type <> 'application/pdf' OR NEW.r2_key NOT LIKE '%.pdf'))
    OR (NEW.format = 'docx' AND (
      NEW.mime_type <> 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      OR NEW.r2_key NOT LIKE '%.docx'
    ))
    OR NEW.size_bytes IS NULL OR NEW.size_bytes < 1000
    OR NEW.sha256 IS NULL OR length(NEW.sha256) <> 64
    OR NEW.completed_at IS NULL OR NEW.error_code IS NOT NULL
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_report_export_completion_invalid', ERRCODE = '23514';
END IF;
IF NEW.status <> 'completed' AND (
    NEW.r2_key IS NOT NULL OR NEW.size_bytes IS NOT NULL OR NEW.sha256 IS NOT NULL
    OR NEW.completed_at IS NOT NULL
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_report_export_incomplete_has_artifact', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_report_exports_update_guard" BEFORE UPDATE ON analysis_report_exports
FOR EACH ROW EXECUTE FUNCTION guard_2e6e5f61e5518ee6e4584d13();

-- file_extractions_source_insert_guard
CREATE FUNCTION guard_655ec5a869e27ec5fe552770() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM document_analyses analysis
  JOIN document_files file ON file.id = analysis.uploaded_file_id
  WHERE analysis.id = NEW.analysis_id
    AND analysis.workspace_id = NEW.workspace_id
    AND analysis.owner_user_id = NEW.owner_user_id
    AND file.id = NEW.file_id
    AND file.workspace_id = NEW.workspace_id
    AND file.owner_user_id = NEW.owner_user_id
    AND file.kind = 'analysis_safe'
    AND lower(file.sha256) = lower(NEW.source_sha256)
) THEN
RAISE EXCEPTION USING MESSAGE = 'file_extraction_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "file_extractions_source_insert_guard" BEFORE INSERT ON file_extractions
FOR EACH ROW EXECUTE FUNCTION guard_655ec5a869e27ec5fe552770();

-- file_extractions_identity_update_guard
CREATE FUNCTION guard_ac7697870231c6e7601f3153() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW.id IS DISTINCT FROM OLD.id
  OR NEW.analysis_id IS DISTINCT FROM OLD.analysis_id
  OR NEW.file_id IS DISTINCT FROM OLD.file_id
  OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
  OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
  OR NEW.method IS DISTINCT FROM OLD.method
  OR NEW.provider IS DISTINCT FROM OLD.provider
  OR NEW.source_sha256 IS DISTINCT FROM OLD.source_sha256
  OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
RAISE EXCEPTION USING MESSAGE = 'file_extraction_identity_immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "file_extractions_identity_update_guard" BEFORE UPDATE ON file_extractions
FOR EACH ROW EXECUTE FUNCTION guard_ac7697870231c6e7601f3153();

-- file_extractions_lifecycle_update_guard
CREATE FUNCTION guard_b55229fef9a788e8a9324230() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (OLD.status = 'queued' AND NEW.status IN ('queued','processing','retrying','failed'))
  OR (OLD.status = 'processing' AND NEW.status IN ('processing','completed','retrying','failed'))
  OR (OLD.status = 'retrying' AND NEW.status IN ('retrying','processing','failed'))
  OR (OLD.status = 'failed' AND NEW.status IN ('failed','queued'))
  OR (OLD.status = 'completed' AND NEW.status = 'completed')
) THEN
RAISE EXCEPTION USING MESSAGE = 'file_extraction_lifecycle_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "file_extractions_lifecycle_update_guard" BEFORE UPDATE ON file_extractions
FOR EACH ROW EXECUTE FUNCTION guard_b55229fef9a788e8a9324230();

-- file_extractions_completion_insert_guard
CREATE FUNCTION guard_2ea1c8614de6e5bf4bed3813() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
  NEW.status = 'completed' AND (
    NEW.r2_key IS NULL OR NEW.text_sha256 IS NULL OR NEW.size_bytes IS NULL
    OR NEW.token_estimate IS NULL OR NEW.detected_mime_type IS NULL
    OR NEW.detected_language IS NULL OR NEW.text_quality IS NULL
    OR NEW.completed_at IS NULL OR NEW.error_code IS NOT NULL
  )
) OR (
  NEW.status <> 'completed' AND (
    NEW.r2_key IS NOT NULL OR NEW.text_sha256 IS NOT NULL OR NEW.completed_at IS NOT NULL
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'file_extraction_completion_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "file_extractions_completion_insert_guard" BEFORE INSERT ON file_extractions
FOR EACH ROW EXECUTE FUNCTION guard_2ea1c8614de6e5bf4bed3813();

-- file_extractions_completion_update_guard
CREATE FUNCTION guard_f5c16db8a21c3a454511b736() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
  NEW.status = 'completed' AND (
    NEW.r2_key IS NULL OR NEW.text_sha256 IS NULL OR NEW.size_bytes IS NULL
    OR NEW.token_estimate IS NULL OR NEW.detected_mime_type IS NULL
    OR NEW.detected_language IS NULL OR NEW.text_quality IS NULL
    OR NEW.completed_at IS NULL OR NEW.error_code IS NOT NULL
  )
) OR (
  NEW.status <> 'completed' AND (
    NEW.r2_key IS NOT NULL OR NEW.text_sha256 IS NOT NULL OR NEW.completed_at IS NOT NULL
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'file_extraction_completion_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "file_extractions_completion_update_guard" BEFORE UPDATE ON file_extractions
FOR EACH ROW EXECUTE FUNCTION guard_f5c16db8a21c3a454511b736();

-- file_extractions_completed_immutable
CREATE FUNCTION guard_ae783dc410f84ef7166575ab() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD.status = 'completed' THEN
RAISE EXCEPTION USING MESSAGE = 'file_extraction_completed_immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "file_extractions_completed_immutable" BEFORE UPDATE ON file_extractions
FOR EACH ROW EXECUTE FUNCTION guard_ae783dc410f84ef7166575ab();

-- document_risks_type_insert_guard
CREATE FUNCTION guard_a01bc03c264cf935d3a2f63e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW.risk_type NOT IN ('document_internal','legal_compliance')
  OR (NEW.page IS NOT NULL AND NEW.page < 1)
  OR json_valid(NEW.legal_basis_source_ids_json) <> true
  OR json_type(NEW.legal_basis_source_ids_json) <> 'array' THEN
RAISE EXCEPTION USING MESSAGE = 'document_risk_finding_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_risks_type_insert_guard" BEFORE INSERT ON document_risks
FOR EACH ROW EXECUTE FUNCTION guard_a01bc03c264cf935d3a2f63e();

-- document_risks_type_update_guard
CREATE FUNCTION guard_13b8688c30b0a2df8f5194c7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW.risk_type NOT IN ('document_internal','legal_compliance')
  OR (NEW.page IS NOT NULL AND NEW.page < 1)
  OR json_valid(NEW.legal_basis_source_ids_json) <> true
  OR json_type(NEW.legal_basis_source_ids_json) <> 'array' THEN
RAISE EXCEPTION USING MESSAGE = 'document_risk_finding_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_risks_type_update_guard" BEFORE UPDATE ON document_risks
FOR EACH ROW EXECUTE FUNCTION guard_13b8688c30b0a2df8f5194c7();

-- published_legal_source_chunks_update_guard
CREATE FUNCTION guard_40d2e3ff4eb83d6e1d4e77ca() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "legal_source_publications" WHERE "version_id" = OLD."version_id"
) THEN
IF NEW."id" <> OLD."id"
    OR NEW."version_id" <> OLD."version_id"
    OR NEW."section_id" <> OLD."section_id"
    OR NEW."chunk_index" <> OLD."chunk_index"
    OR NEW."language" <> OLD."language"
    OR NEW."content_text" <> OLD."content_text"
    OR NEW."content_sha256" <> OLD."content_sha256"
    OR NEW."metadata_json" <> OLD."metadata_json"
    OR NEW."vector_id" IS NULL
    OR NEW."vector_id" <> ('vec_' || OLD."id")
    OR NEW."indexed_at" IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM "legal_source_current_activations" activation
      INNER JOIN "legal_sources" source ON source."id" = activation."source_id"
      INNER JOIN "legal_source_versions" version
        ON version."id" = activation."version_id"
       AND version."source_id" = source."id"
      INNER JOIN "legal_source_publications" publication
        ON publication."id" = activation."publication_id"
       AND publication."version_id" = version."id"
       AND publication."source_id" = source."id"
      WHERE activation."version_id" = OLD."version_id"
        AND source."status" = 'verified'
        AND source."verification_state" = 'verified'
        AND version."status" = 'verified'
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'published legal source chunks are immutable', ERRCODE = '23514';
END IF;
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "published_legal_source_chunks_update_guard" BEFORE UPDATE ON "legal_source_chunks"
FOR EACH ROW EXECUTE FUNCTION guard_40d2e3ff4eb83d6e1d4e77ca();

-- action_plan_versions_no_update
CREATE FUNCTION guard_065fdc8e39d3038e14094c97() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'action plan versions are immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "action_plan_versions_no_update" BEFORE UPDATE ON action_plan_versions
FOR EACH ROW EXECUTE FUNCTION guard_065fdc8e39d3038e14094c97();

-- action_plan_versions_no_delete
CREATE FUNCTION guard_5c8d41cc31ac131048779e28() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM action_plans WHERE id = OLD.plan_id) THEN
RAISE EXCEPTION USING MESSAGE = 'action plan versions are immutable', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "action_plan_versions_no_delete" BEFORE DELETE ON action_plan_versions
FOR EACH ROW EXECUTE FUNCTION guard_5c8d41cc31ac131048779e28();

-- lawyer_review_moderation_immutable_update
CREATE FUNCTION guard_a0082c58343dfda7432d4d12() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer review moderation is append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_moderation_immutable_update" BEFORE UPDATE ON "lawyer_review_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_a0082c58343dfda7432d4d12();

-- lawyer_review_moderation_immutable_delete
CREATE FUNCTION guard_43a704c58d81c700281a4223() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer review moderation cannot be deleted', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_review_moderation_immutable_delete" BEFORE DELETE ON "lawyer_review_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_43a704c58d81c700281a4223();

-- lawyer_review_moderation_applies_terminal_status
CREATE FUNCTION guard_ea885fb764f1a59cab95f4cf() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
UPDATE "lawyer_reviews"
  SET "status"=NEW."decision", "updated_at"=NEW."created_at"
  WHERE "id"=NEW."review_id" AND "status"='pending';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_moderation_applies_terminal_status" AFTER INSERT ON "lawyer_review_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_ea885fb764f1a59cab95f4cf();

-- lawyer_reviews_rating_range_insert
CREATE FUNCTION guard_deb16f7a6a8273c0fd092e53() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."overall_rating" NOT BETWEEN 1 AND 5
  OR NEW."speed_rating" NOT BETWEEN 1 AND 5
  OR NEW."quality_rating" NOT BETWEEN 1 AND 5
  OR NEW."communication_rating" NOT BETWEEN 1 AND 5 THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer review ratings must be between 1 and 5', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_reviews_rating_range_insert" BEFORE INSERT ON "lawyer_reviews"
FOR EACH ROW EXECUTE FUNCTION guard_deb16f7a6a8273c0fd092e53();

-- lawyer_reviews_rating_range_update
CREATE FUNCTION guard_1b625d8ff586fbf05bb5c203() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."overall_rating" NOT BETWEEN 1 AND 5
  OR NEW."speed_rating" NOT BETWEEN 1 AND 5
  OR NEW."quality_rating" NOT BETWEEN 1 AND 5
  OR NEW."communication_rating" NOT BETWEEN 1 AND 5 THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer review ratings must be between 1 and 5', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_reviews_rating_range_update" BEFORE UPDATE OF "overall_rating","speed_rating","quality_rating","communication_rating" ON "lawyer_reviews"
FOR EACH ROW EXECUTE FUNCTION guard_1b625d8ff586fbf05bb5c203();

-- lawyer_profiles_directory_values_insert
CREATE FUNCTION guard_252f2aef7b334876b55c8a76() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (NEW."experience_years" IS NOT NULL AND (NEW."experience_years" < 0 OR NEW."experience_years" > 99))
  OR NEW."availability_status" NOT IN ('unknown','available','limited','unavailable')
  OR NEW."advocate_status" NOT IN ('not_declared','declared','verified') THEN
RAISE EXCEPTION USING MESSAGE = 'invalid lawyer directory profile values', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profiles_directory_values_insert" BEFORE INSERT ON "lawyer_profiles"
FOR EACH ROW EXECUTE FUNCTION guard_252f2aef7b334876b55c8a76();

-- lawyer_profiles_directory_values_update
CREATE FUNCTION guard_d4f734c6d1acd7163bd1e56e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (NEW."experience_years" IS NOT NULL AND (NEW."experience_years" < 0 OR NEW."experience_years" > 99))
  OR NEW."availability_status" NOT IN ('unknown','available','limited','unavailable')
  OR NEW."advocate_status" NOT IN ('not_declared','declared','verified') THEN
RAISE EXCEPTION USING MESSAGE = 'invalid lawyer directory profile values', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profiles_directory_values_update" BEFORE UPDATE OF "experience_years","availability_status","advocate_status" ON "lawyer_profiles"
FOR EACH ROW EXECUTE FUNCTION guard_d4f734c6d1acd7163bd1e56e();

-- lawyer_profile_moderation_applies_profile_status
CREATE FUNCTION guard_307dc470541254e947cd3f9f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."decision" IN ('approved','rejected') THEN
UPDATE "lawyer_profiles"
  SET "status"=CASE WHEN NEW."decision"='approved' THEN 'public_approved' ELSE 'rejected' END,
      "public_approved_at"=CASE WHEN NEW."decision"='approved' THEN NEW."created_at" ELSE NULL END,
      "updated_at"=NEW."created_at"
  WHERE "id"=NEW."lawyer_profile_id"
    AND "profile_revision"=NEW."profile_revision"
    AND "status"='pending';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_moderation_applies_profile_status" AFTER INSERT ON "lawyer_profile_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_307dc470541254e947cd3f9f();

-- lawyer_profiles_status_requires_moderation
CREATE FUNCTION guard_c5349cd9ca4f9e3b098c9e8e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (NEW."status" IN ('public_approved','rejected') OR NEW."public_approved_at" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "lawyer_profile_moderation" m
    WHERE m."lawyer_profile_id"=NEW."id"
      AND m."profile_revision"=NEW."profile_revision"
      AND ((NEW."status"='public_approved' AND m."decision"='approved') OR (NEW."status"='rejected' AND m."decision"='rejected'))
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile moderation evidence required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profiles_status_requires_moderation" BEFORE UPDATE OF "status","public_approved_at" ON "lawyer_profiles"
FOR EACH ROW EXECUTE FUNCTION guard_c5349cd9ca4f9e3b098c9e8e();

-- lawyer_profile_moderation_append_only_update
CREATE FUNCTION guard_6445a8036f6c332de5c5d4e9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile moderation is append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_moderation_append_only_update" BEFORE UPDATE ON "lawyer_profile_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_6445a8036f6c332de5c5d4e9();

-- lawyer_profile_moderation_append_only_delete
CREATE FUNCTION guard_1f4cf2272322674876b76790() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile moderation is append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_moderation_append_only_delete" BEFORE DELETE ON "lawyer_profile_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_1f4cf2272322674876b76790();

-- pricing_policy_versions_immutable_update
CREATE FUNCTION guard_cc7c44cc7f0c1af9c56dba03() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'PRICING_POLICY_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "pricing_policy_versions_immutable_update" BEFORE UPDATE ON "pricing_policy_versions"
FOR EACH ROW EXECUTE FUNCTION guard_cc7c44cc7f0c1af9c56dba03();

-- pricing_policy_versions_immutable_delete
CREATE FUNCTION guard_c0531358cb208a881cf1c470() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'PRICING_POLICY_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "pricing_policy_versions_immutable_delete" BEFORE DELETE ON "pricing_policy_versions"
FOR EACH ROW EXECUTE FUNCTION guard_c0531358cb208a881cf1c470();

-- subscription_plan_versions_immutable_update
CREATE FUNCTION guard_e0dace85ce25ba652d27a15e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'SUBSCRIPTION_PLAN_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "subscription_plan_versions_immutable_update" BEFORE UPDATE ON "subscription_plan_versions"
FOR EACH ROW EXECUTE FUNCTION guard_e0dace85ce25ba652d27a15e();

-- subscription_plan_versions_immutable_delete
CREATE FUNCTION guard_d161750430b888a32c448970() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'SUBSCRIPTION_PLAN_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "subscription_plan_versions_immutable_delete" BEFORE DELETE ON "subscription_plan_versions"
FOR EACH ROW EXECUTE FUNCTION guard_d161750430b888a32c448970();

-- pricing_snapshots_immutable_update
CREATE FUNCTION guard_f10590a2d5420e12d82dfbd8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'PRICING_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "pricing_snapshots_immutable_update" BEFORE UPDATE ON "pricing_snapshots"
FOR EACH ROW EXECUTE FUNCTION guard_f10590a2d5420e12d82dfbd8();

-- pricing_snapshots_immutable_delete
CREATE FUNCTION guard_a54f3183528292eb2be166a0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'PRICING_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "pricing_snapshots_immutable_delete" BEFORE DELETE ON "pricing_snapshots"
FOR EACH ROW EXECUTE FUNCTION guard_a54f3183528292eb2be166a0();

-- marketplace_orders_identity_immutable
CREATE FUNCTION guard_2a64262e66ebacaeeb69c444() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'MARKETPLACE_ORDER_IDENTITY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "marketplace_orders_identity_immutable" BEFORE UPDATE OF "external_id","workspace_id","customer_user_id","order_type","currency","idempotency_key" ON "marketplace_orders"
FOR EACH ROW EXECUTE FUNCTION guard_2a64262e66ebacaeeb69c444();

-- marketplace_orders_snapshot_once
CREATE FUNCTION guard_fb06064579da790f9fdf940c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."accepted_pricing_snapshot_id" IS NOT NULL
  AND NEW."accepted_pricing_snapshot_id" IS DISTINCT FROM OLD."accepted_pricing_snapshot_id" THEN
RAISE EXCEPTION USING MESSAGE = 'ORDER_PRICING_SNAPSHOT_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "marketplace_orders_snapshot_once" BEFORE UPDATE OF "accepted_pricing_snapshot_id" ON "marketplace_orders"
FOR EACH ROW EXECUTE FUNCTION guard_fb06064579da790f9fdf940c();

-- marketplace_orders_snapshot_belongs_to_order
CREATE FUNCTION guard_8449e284b2c58cd0677f8a4a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."accepted_pricing_snapshot_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "pricing_snapshots" s
    WHERE s."id" = NEW."accepted_pricing_snapshot_id"
      AND s."order_id" = NEW."id"
      AND s."client_total_minor" = NEW."total_amount_minor"
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'ORDER_PRICING_SNAPSHOT_MISMATCH', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "marketplace_orders_snapshot_belongs_to_order" BEFORE UPDATE OF "accepted_pricing_snapshot_id","total_amount_minor" ON "marketplace_orders"
FOR EACH ROW EXECUTE FUNCTION guard_8449e284b2c58cd0677f8a4a();

-- ledger_transactions_post_guard
CREATE FUNCTION guard_d5251235d020865aab341a09() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" = 'posted'
  AND (
    NEW."debit_total_minor" != NEW."credit_total_minor"
    OR NEW."debit_total_minor" <= 0
    OR NEW."debit_total_minor" != COALESCE((
      SELECT SUM(e."amount_minor") FROM "ledger_entries" e
      WHERE e."transaction_id" = NEW."id" AND e."side" = 'DEBIT'
    ), 0)
    OR NEW."credit_total_minor" != COALESCE((
      SELECT SUM(e."amount_minor") FROM "ledger_entries" e
      WHERE e."transaction_id" = NEW."id" AND e."side" = 'CREDIT'
    ), 0)
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'LEDGER_TRANSACTION_UNBALANCED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ledger_transactions_post_guard" BEFORE UPDATE OF "status","debit_total_minor","credit_total_minor" ON "ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION guard_d5251235d020865aab341a09();

-- ledger_transactions_posted_immutable_update
CREATE FUNCTION guard_8b093d369091db16edbcef78() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status" = 'posted' THEN
RAISE EXCEPTION USING MESSAGE = 'POSTED_LEDGER_TRANSACTION_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ledger_transactions_posted_immutable_update" BEFORE UPDATE ON "ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION guard_8b093d369091db16edbcef78();

-- ledger_transactions_posted_immutable_delete
CREATE FUNCTION guard_0ba701ea4e72089d37793e0a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status" = 'posted' THEN
RAISE EXCEPTION USING MESSAGE = 'POSTED_LEDGER_TRANSACTION_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ledger_transactions_posted_immutable_delete" BEFORE DELETE ON "ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION guard_0ba701ea4e72089d37793e0a();

-- ledger_entries_posted_immutable_update
CREATE FUNCTION guard_bdfc72e71ce4e3a2696f0455() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "ledger_transactions" t WHERE t."id" = OLD."transaction_id" AND t."status" = 'posted') THEN
RAISE EXCEPTION USING MESSAGE = 'POSTED_LEDGER_ENTRY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ledger_entries_posted_immutable_update" BEFORE UPDATE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION guard_bdfc72e71ce4e3a2696f0455();

-- ledger_entries_posted_immutable_delete
CREATE FUNCTION guard_7db14af7f0d1f270f0b9d6ec() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "ledger_transactions" t WHERE t."id" = OLD."transaction_id" AND t."status" = 'posted') THEN
RAISE EXCEPTION USING MESSAGE = 'POSTED_LEDGER_ENTRY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ledger_entries_posted_immutable_delete" BEFORE DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION guard_7db14af7f0d1f270f0b9d6ec();

-- legal_service_proposal_versions_immutable_update
CREATE FUNCTION guard_3ddc1bab87818088e278f997() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SERVICE_PROPOSAL_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_service_proposal_versions_immutable_update" BEFORE UPDATE ON "legal_service_proposal_versions"
FOR EACH ROW EXECUTE FUNCTION guard_3ddc1bab87818088e278f997();

-- legal_service_proposal_versions_immutable_delete
CREATE FUNCTION guard_f4e06e29a9561b32e8fcd9cd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SERVICE_PROPOSAL_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_service_proposal_versions_immutable_delete" BEFORE DELETE ON "legal_service_proposal_versions"
FOR EACH ROW EXECUTE FUNCTION guard_f4e06e29a9561b32e8fcd9cd();

-- proposal_acceptances_immutable_update
CREATE FUNCTION guard_4757450c66165abd5aab5e87() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'PROPOSAL_ACCEPTANCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "proposal_acceptances_immutable_update" BEFORE UPDATE ON "proposal_acceptances"
FOR EACH ROW EXECUTE FUNCTION guard_4757450c66165abd5aab5e87();

-- proposal_acceptances_immutable_delete
CREATE FUNCTION guard_77062224cd5aa159afdecbe3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'PROPOSAL_ACCEPTANCE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "proposal_acceptances_immutable_delete" BEFORE DELETE ON "proposal_acceptances"
FOR EACH ROW EXECUTE FUNCTION guard_77062224cd5aa159afdecbe3();

-- marketplace_policy_commission_range
CREATE FUNCTION guard_16cbc9546e185390d66b72a9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."marketplace_commission_rate_basis_points" NOT BETWEEN 0 AND 10000 THEN
RAISE EXCEPTION USING MESSAGE = 'MARKETPLACE_COMMISSION_RATE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "marketplace_policy_commission_range" BEFORE INSERT ON "pricing_policy_versions"
FOR EACH ROW EXECUTE FUNCTION guard_16cbc9546e185390d66b72a9();

-- file_scan_result_source_guard
CREATE FUNCTION guard_b1441ae8285d7e342118bd48() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
    SELECT 1
    FROM "document_analyses" a
    JOIN "document_files" f ON f."id" = a."uploaded_file_id"
    WHERE a."id" = NEW."analysis_id"
      AND f."id" = NEW."file_id"
      AND a."workspace_id" = NEW."workspace_id"
      AND f."workspace_id" = NEW."workspace_id"
      AND a."owner_user_id" = NEW."owner_user_id"
      AND f."owner_user_id" = NEW."owner_user_id"
      AND lower(f."sha256") = lower(NEW."source_sha256")
      AND a."status" = 'quarantined'
      AND f."kind" = 'analysis_quarantined'
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'file_scan_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "file_scan_result_source_guard" BEFORE INSERT ON "file_scan_results"
FOR EACH ROW EXECUTE FUNCTION guard_b1441ae8285d7e342118bd48();

-- file_scan_result_immutable_update
CREATE FUNCTION guard_dfd81a9321f8b997bf071180() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'file_scan_result_immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "file_scan_result_immutable_update" BEFORE UPDATE ON "file_scan_results"
FOR EACH ROW EXECUTE FUNCTION guard_dfd81a9321f8b997bf071180();

-- analysis_document_versions_source_guard
CREATE FUNCTION guard_683e27d4efe1a6df4e62253d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "document_analyses" analysis
  WHERE analysis."id" = NEW."analysis_id"
    AND analysis."workspace_id" = NEW."workspace_id"
    AND analysis."owner_user_id" = NEW."owner_user_id"
    AND (
      (NEW."source_kind" = 'extracted'
        AND NEW."version" = 1
        AND NEW."parent_version_id" IS NULL
        AND NEW."idempotency_key" IS NULL
        AND NEW."selection_sha256" IS NULL
        AND json_array_length(NEW."revision_ids_json") = 0
        AND NEW."created_by_user_id" IS NULL
        AND analysis."status" IN ('processing','persisting','completed'))
      OR
      (NEW."source_kind" = 'corrected'
        AND NEW."version" > 1
        AND NEW."parent_version_id" IS NOT NULL
        AND length(NEW."idempotency_key") BETWEEN 16 AND 160
        AND length(NEW."selection_sha256") = 64
        AND json_array_length(NEW."revision_ids_json") > 0
        AND NEW."created_by_user_id" = NEW."owner_user_id"
        AND analysis."status" = 'completed')
    )
    AND NEW."r2_key" LIKE 'analysis-versions/%'
) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_document_version_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_document_versions_source_guard" BEFORE INSERT ON "analysis_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_683e27d4efe1a6df4e62253d();

-- analysis_document_versions_parent_guard
CREATE FUNCTION guard_cfaed9207e782a843bcceb0d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."version" > 1 AND NOT EXISTS (
  SELECT 1 FROM "analysis_document_versions" parent
  WHERE parent."id" = NEW."parent_version_id"
    AND parent."analysis_id" = NEW."analysis_id"
    AND parent."workspace_id" = NEW."workspace_id"
    AND parent."owner_user_id" = NEW."owner_user_id"
    AND parent."version" = NEW."version" - 1
) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_document_version_parent_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_document_versions_parent_guard" BEFORE INSERT ON "analysis_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_cfaed9207e782a843bcceb0d();

-- analysis_document_versions_immutable_update
CREATE FUNCTION guard_dd82ded735620f4b60aa88a6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'analysis_document_version_immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_document_versions_immutable_update" BEFORE UPDATE ON "analysis_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_dd82ded735620f4b60aa88a6();

-- suggested_revisions_source_guard
CREATE FUNCTION guard_da528314c9ef5f25114ba97c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "document_analyses" analysis
  JOIN "document_risks" risk ON risk."analysis_id" = analysis."id"
  JOIN "analysis_document_versions" version ON version."analysis_id" = analysis."id"
  WHERE analysis."id" = NEW."analysis_id"
    AND analysis."workspace_id" = NEW."workspace_id"
    AND analysis."owner_user_id" = NEW."owner_user_id"
    AND risk."id" = NEW."risk_id"
    AND version."id" = NEW."source_version_id"
    AND version."workspace_id" = NEW."workspace_id"
    AND version."owner_user_id" = NEW."owner_user_id"
    AND version."version" = 1
    AND version."source_kind" = 'extracted'
    AND risk."excerpt" = NEW."original_text"
    AND risk."proposed_wording" = NEW."proposed_text"
) THEN
RAISE EXCEPTION USING MESSAGE = 'suggested_revision_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "suggested_revisions_source_guard" BEFORE INSERT ON "suggested_revisions"
FOR EACH ROW EXECUTE FUNCTION guard_da528314c9ef5f25114ba97c();

-- suggested_revisions_identity_guard
CREATE FUNCTION guard_9479efc08f0d3ef5a341cda1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id" IS DISTINCT FROM OLD."id"
  OR NEW."analysis_id" IS DISTINCT FROM OLD."analysis_id"
  OR NEW."risk_id" IS DISTINCT FROM OLD."risk_id"
  OR NEW."source_version_id" IS DISTINCT FROM OLD."source_version_id"
  OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
  OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
  OR NEW."original_text" IS DISTINCT FROM OLD."original_text"
  OR NEW."proposed_text" IS DISTINCT FROM OLD."proposed_text"
  OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'suggested_revision_identity_immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "suggested_revisions_identity_guard" BEFORE UPDATE ON "suggested_revisions"
FOR EACH ROW EXECUTE FUNCTION guard_9479efc08f0d3ef5a341cda1();

-- suggested_revisions_lifecycle_guard
CREATE FUNCTION guard_cab44f24bdf6c2523ee0c530() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (OLD."status" = 'pending' AND NEW."status" IN ('pending','accepted','rejected','applied','stale','ambiguous'))
  OR (OLD."status" = 'accepted' AND NEW."status" IN ('accepted','rejected','applied','stale','ambiguous'))
  OR (OLD."status" = 'rejected' AND NEW."status" IN ('rejected','accepted'))
  OR (OLD."status" IN ('applied','stale','ambiguous') AND NEW."status" = OLD."status")
) THEN
RAISE EXCEPTION USING MESSAGE = 'suggested_revision_lifecycle_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "suggested_revisions_lifecycle_guard" BEFORE UPDATE ON "suggested_revisions"
FOR EACH ROW EXECUTE FUNCTION guard_cab44f24bdf6c2523ee0c530();

-- suggested_revisions_applied_version_guard
CREATE FUNCTION guard_6dbf983850a9ca24f0cf0e6e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" = 'applied' AND NOT EXISTS (
  SELECT 1 FROM "analysis_document_versions" version
  WHERE version."id" = NEW."applied_version_id"
    AND version."analysis_id" = NEW."analysis_id"
    AND version."workspace_id" = NEW."workspace_id"
    AND version."owner_user_id" = NEW."owner_user_id"
    AND version."source_kind" = 'corrected'
) THEN
RAISE EXCEPTION USING MESSAGE = 'suggested_revision_applied_version_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "suggested_revisions_applied_version_guard" BEFORE UPDATE ON "suggested_revisions"
FOR EACH ROW EXECUTE FUNCTION guard_6dbf983850a9ca24f0cf0e6e();

-- analysis_document_versions_revision_guard
CREATE FUNCTION guard_6e4bb975614c69b586837cca() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."source_kind" = 'corrected' AND (
  (SELECT count(*) FROM json_each(NEW."revision_ids_json")) <>
    (SELECT count(DISTINCT value) FROM json_each(NEW."revision_ids_json"))
  OR EXISTS (
  SELECT 1
  FROM json_each(NEW."revision_ids_json") selected
  LEFT JOIN "suggested_revisions" revision ON revision."id" = selected."value"
  WHERE revision."id" IS NULL
    OR revision."analysis_id" <> NEW."analysis_id"
    OR revision."workspace_id" <> NEW."workspace_id"
    OR revision."owner_user_id" <> NEW."owner_user_id"
    OR revision."status" NOT IN ('pending','accepted')
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_document_version_revision_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_document_versions_revision_guard" BEFORE INSERT ON "analysis_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_6e4bb975614c69b586837cca();

-- analysis_report_exports_variant_insert_guard
CREATE FUNCTION guard_9f1ed68d8d8ac6ee015a25fa() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (NEW."variant" = 'analysis_report' AND NEW."source_version_id" IS NULL)
  OR
  (NEW."variant" IN ('corrected_clean','corrected_redline') AND EXISTS (
    SELECT 1 FROM "analysis_document_versions" version
    WHERE version."id" = NEW."source_version_id"
      AND version."analysis_id" = NEW."analysis_id"
      AND version."workspace_id" = NEW."workspace_id"
      AND version."owner_user_id" = NEW."owner_user_id"
      AND version."source_kind" = 'corrected'
  ))
) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_report_export_variant_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_report_exports_variant_insert_guard" BEFORE INSERT ON "analysis_report_exports"
FOR EACH ROW EXECUTE FUNCTION guard_9f1ed68d8d8ac6ee015a25fa();

-- analysis_report_exports_variant_update_guard
CREATE FUNCTION guard_80dc1ef8aed3ab4bac3ccd55() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."variant" IS DISTINCT FROM OLD."variant"
  OR NEW."source_version_id" IS DISTINCT FROM OLD."source_version_id" THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_report_export_variant_immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_report_exports_variant_update_guard" BEFORE UPDATE ON "analysis_report_exports"
FOR EACH ROW EXECUTE FUNCTION guard_80dc1ef8aed3ab4bac3ccd55();

-- comparison_exports_insert_guard
CREATE FUNCTION guard_0e6b3d3ee696694a8aa389dd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "document_comparisons" comparison
  WHERE comparison."id"=NEW."comparison_id"
    AND comparison."workspace_id"=NEW."workspace_id"
    AND comparison."owner_user_id"=NEW."owner_user_id"
    AND comparison."status" IN ('completed','completed_partial')
    AND comparison."deleted_at" IS NULL
) THEN
RAISE EXCEPTION USING MESSAGE = 'comparison_export_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "comparison_exports_insert_guard" BEFORE INSERT ON "comparison_exports"
FOR EACH ROW EXECUTE FUNCTION guard_0e6b3d3ee696694a8aa389dd();

-- comparison_exports_update_guard
CREATE FUNCTION guard_badefac1441ce69cf02a8e1d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
    OR NEW."comparison_id"<>OLD."comparison_id" OR NEW."workspace_id"<>OLD."workspace_id"
    OR NEW."owner_user_id"<>OLD."owner_user_id" OR NEW."format"<>OLD."format"
    OR NEW."file_name"<>OLD."file_name" OR NEW."mime_type"<>OLD."mime_type"
    OR NEW."idempotency_key"<>OLD."idempotency_key" OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'comparison_export_identity_immutable', ERRCODE = '23514';
END IF;
IF NOT (
    (OLD."status"='queued' AND NEW."status" IN ('processing','failed'))
    OR (OLD."status"='processing' AND NEW."status" IN ('processing','retrying','completed','failed'))
    OR (OLD."status"='retrying' AND NEW."status" IN ('processing','failed'))
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'comparison_export_transition_invalid', ERRCODE = '23514';
END IF;
IF NEW."status"='completed' AND (
    NEW."r2_key" NOT LIKE 'comparison-exports/%'
    OR (NEW."format"='pdf' AND (NEW."mime_type"<>'application/pdf' OR NEW."r2_key" NOT LIKE '%.pdf'))
    OR (NEW."format"='docx' AND (NEW."mime_type"<>'application/vnd.openxmlformats-officedocument.wordprocessingml.document' OR NEW."r2_key" NOT LIKE '%.docx'))
    OR NEW."size_bytes" IS NULL OR NEW."size_bytes"<1000
    OR NEW."sha256" IS NULL OR length(NEW."sha256")<>64
    OR NEW."completed_at" IS NULL OR NEW."error_code" IS NOT NULL
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'comparison_export_completion_invalid', ERRCODE = '23514';
END IF;
IF NEW."status"<>'completed' AND (
    NEW."r2_key" IS NOT NULL OR NEW."size_bytes" IS NOT NULL OR NEW."sha256" IS NOT NULL OR NEW."completed_at" IS NOT NULL
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'comparison_export_incomplete_has_artifact', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "comparison_exports_update_guard" BEFORE UPDATE ON "comparison_exports"
FOR EACH ROW EXECUTE FUNCTION guard_badefac1441ce69cf02a8e1d();

-- comparison_changes_decision_insert_guard
CREATE FUNCTION guard_833c3ef5541db8952556d12c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."review_decision" IS NOT NULL
  OR NEW."decided_by_user_id" IS NOT NULL
  OR NEW."decided_at" IS NOT NULL
  OR NEW."review_decision_version" <> 0
  OR NEW."review_decision_event_id" IS NOT NULL THEN
RAISE EXCEPTION USING MESSAGE = 'comparison_change_decision_insert_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "comparison_changes_decision_insert_guard" BEFORE INSERT ON "comparison_changes"
FOR EACH ROW EXECUTE FUNCTION guard_833c3ef5541db8952556d12c();

-- comparison_changes_decision_update_guard
CREATE FUNCTION guard_b5bf853732c84e59e9516265() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."review_decision" IS NOT DISTINCT FROM OLD."review_decision"
    AND NEW."decided_by_user_id" IS NOT DISTINCT FROM OLD."decided_by_user_id"
    AND NEW."decided_at" IS NOT DISTINCT FROM OLD."decided_at"
    AND NEW."review_decision_version" = OLD."review_decision_version"
    AND NEW."review_decision_event_id" IS NOT DISTINCT FROM OLD."review_decision_event_id"
  )
  OR
  (
    NEW."review_decision" IS NOT DISTINCT FROM OLD."review_decision"
    AND OLD."decided_by_user_id" IS NOT NULL
    AND NEW."decided_by_user_id" IS NULL
    AND NEW."decided_at" IS NOT DISTINCT FROM OLD."decided_at"
    AND NEW."review_decision_version" = OLD."review_decision_version"
    AND NEW."review_decision_event_id" IS NOT DISTINCT FROM OLD."review_decision_event_id"
  )
  OR
  (
    NEW."review_decision_version" = OLD."review_decision_version" + 1
    AND length(NEW."review_decision_event_id") = 36
    AND NEW."review_decision_event_id" IS DISTINCT FROM OLD."review_decision_event_id"
    AND (
      (
        NEW."review_decision" IS NULL
        AND NEW."decided_by_user_id" IS NULL
        AND NEW."decided_at" IS NULL
      )
      OR
      (
        NEW."review_decision" IN ('accepted','rejected')
        AND NEW."decided_by_user_id" IS NOT NULL
        AND NEW."decided_at" IS NOT NULL
        AND NEW."reviewed_at" IS NOT NULL
      )
    )
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'comparison_change_decision_transition_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "comparison_changes_decision_update_guard" BEFORE UPDATE OF "review_decision","decided_by_user_id","decided_at","review_decision_version","review_decision_event_id" ON "comparison_changes"
FOR EACH ROW EXECUTE FUNCTION guard_b5bf853732c84e59e9516265();

-- comparison_changes_decision_tenant_guard
CREATE FUNCTION guard_81b8f47451f74165bdf9844d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."review_decision" IS NOT NULL
  AND NEW."decided_by_user_id" IS NOT NULL
  AND NOT EXISTS (
  SELECT 1 FROM "document_comparisons" comparison
  WHERE comparison."id" = NEW."comparison_id"
    AND comparison."owner_user_id" = NEW."decided_by_user_id"
    AND comparison."status" IN ('completed','completed_partial')
    AND comparison."deleted_at" IS NULL
) THEN
RAISE EXCEPTION USING MESSAGE = 'comparison_change_decision_tenant_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "comparison_changes_decision_tenant_guard" BEFORE UPDATE OF "review_decision","decided_by_user_id","decided_at","review_decision_version","review_decision_event_id" ON "comparison_changes"
FOR EACH ROW EXECUTE FUNCTION guard_81b8f47451f74165bdf9844d();

-- analysis_version_object_writes_identity_guard
CREATE FUNCTION guard_ab5163b01304193a6caaab20() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id" IS DISTINCT FROM OLD."id"
  OR NEW."analysis_id" IS DISTINCT FROM OLD."analysis_id"
  OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
  OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id"
  OR NEW."target_version" <> OLD."target_version"
  OR NEW."source_kind" IS DISTINCT FROM OLD."source_kind"
  OR NEW."r2_key" IS DISTINCT FROM OLD."r2_key"
  OR NEW."size_bytes" <> OLD."size_bytes"
  OR NEW."sha256" IS DISTINCT FROM OLD."sha256"
  OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_version_object_write_identity_immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_version_object_writes_identity_guard" BEFORE UPDATE ON "analysis_version_object_writes"
FOR EACH ROW EXECUTE FUNCTION guard_ab5163b01304193a6caaab20();

-- analysis_version_object_writes_transition_guard
CREATE FUNCTION guard_d22cb59103006c84606f5a8d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (OLD."status" = 'pending' AND NEW."status" = 'pending'
    AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NULL
    AND NEW."attempt_count" = OLD."attempt_count" + 1
    AND NEW."last_error_code" IS NOT NULL)
  OR (OLD."status" = 'pending' AND NEW."status" = 'attaching'
    AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NULL
    AND NEW."attempt_count" = OLD."attempt_count"
    AND NEW."last_error_code" IS NULL)
  OR (OLD."status" IN ('pending','attaching') AND NEW."status" = 'deleting'
    AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NULL
    AND NEW."attempt_count" = OLD."attempt_count" + 1
    AND NEW."last_error_code" IS NULL)
  OR (OLD."status" IN ('attaching','deleting') AND NEW."status" = 'attached'
    AND NEW."version_id" IS NOT NULL AND NEW."reconciled_at" IS NOT NULL
    AND NEW."attempt_count" = OLD."attempt_count"
    AND NEW."last_error_code" IS NULL)
  OR (OLD."status" = 'deleting' AND NEW."status" = 'deleted'
    AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NOT NULL
    AND NEW."attempt_count" = OLD."attempt_count"
    AND NEW."last_error_code" IS NULL)
  OR (OLD."status" = 'deleting' AND NEW."status" = 'pending'
    AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NULL
    AND NEW."attempt_count" = OLD."attempt_count"
    AND NEW."last_error_code" IS NOT NULL)
) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_version_object_write_transition_invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_version_object_writes_transition_guard" BEFORE UPDATE ON "analysis_version_object_writes"
FOR EACH ROW EXECUTE FUNCTION guard_d22cb59103006c84606f5a8d();

-- analysis_document_versions_object_write_guard
CREATE FUNCTION guard_f7e099baf06e0851e0a4f9e1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."object_write_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "analysis_version_object_writes" write
  WHERE write."id" = NEW."object_write_id"
    AND write."analysis_id" = NEW."analysis_id"
    AND write."workspace_id" = NEW."workspace_id"
    AND write."owner_user_id" = NEW."owner_user_id"
    AND write."target_version" = NEW."version"
    AND write."source_kind" = NEW."source_kind"
    AND write."r2_key" = NEW."r2_key"
    AND write."size_bytes" = NEW."size_bytes"
    AND write."sha256" = NEW."sha256"
    AND write."status" = 'attaching'
) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_document_version_object_write_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_document_versions_object_write_guard" BEFORE INSERT ON "analysis_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_f7e099baf06e0851e0a4f9e1();

-- analysis_document_versions_object_write_attach
CREATE FUNCTION guard_27216e9fac8485cf658c5dc8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."object_write_id" IS NOT NULL THEN
UPDATE "analysis_version_object_writes"
  SET "status" = 'attached',
      "version_id" = NEW."id",
      "last_error_code" = NULL,
      "updated_at" = NEW."created_at",
      "reconciled_at" = NEW."created_at"
  WHERE "id" = NEW."object_write_id" AND "status" = 'attaching';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_document_versions_object_write_attach" AFTER INSERT ON "analysis_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_27216e9fac8485cf658c5dc8();

-- analysis_version_object_writes_attachment_guard
CREATE FUNCTION guard_5a89cfb83bd55b0b45cdfab9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" = 'attached' AND NOT EXISTS (
  SELECT 1 FROM "analysis_document_versions" version
  WHERE version."id" = NEW."version_id"
    AND version."object_write_id" = NEW."id"
    AND version."analysis_id" = NEW."analysis_id"
    AND version."workspace_id" = NEW."workspace_id"
    AND version."owner_user_id" = NEW."owner_user_id"
    AND version."version" = NEW."target_version"
    AND version."source_kind" = NEW."source_kind"
    AND version."r2_key" = NEW."r2_key"
    AND version."size_bytes" = NEW."size_bytes"
    AND version."sha256" = NEW."sha256"
) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_version_object_write_attachment_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_version_object_writes_attachment_guard" BEFORE UPDATE ON "analysis_version_object_writes"
FOR EACH ROW EXECUTE FUNCTION guard_5a89cfb83bd55b0b45cdfab9();

-- analysis_document_versions_object_write_immutable
CREATE FUNCTION guard_feada48687278494ca7599c8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'analysis_document_version_object_write_immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_document_versions_object_write_immutable" BEFORE UPDATE OF "object_write_id" ON "analysis_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_feada48687278494ca7599c8();

-- analysis_case_link_events_insert_guard
CREATE FUNCTION guard_f4bb1886ae24782e993962b8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."actor_user_id" <> NEW."owner_user_id"
  OR NOT EXISTS (
    SELECT 1 FROM "document_analyses" analysis
    WHERE analysis."id" = NEW."analysis_id"
      AND analysis."workspace_id" = NEW."workspace_id"
      AND analysis."owner_user_id" = NEW."owner_user_id"
      AND analysis."case_id" IS NOT DISTINCT FROM NEW."from_case_id"
      AND analysis."case_link_revision" + 1 = NEW."mutation_version"
  )
  OR (NEW."from_case_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cases" source_case
    WHERE source_case."id" = NEW."from_case_id"
      AND source_case."workspace_id" = NEW."workspace_id"
  ))
  OR (NEW."to_case_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cases" target_case
    WHERE target_case."id" = NEW."to_case_id"
      AND target_case."workspace_id" = NEW."workspace_id"
      AND target_case."archived_at" IS NULL
  )) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_case_link_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_case_link_events_insert_guard" BEFORE INSERT ON "analysis_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_f4bb1886ae24782e993962b8();

-- document_analyses_case_projection_guard
CREATE FUNCTION guard_da75d10873c54c2cdaa73cb2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "analysis_case_link_events" event
  WHERE event."analysis_id" = NEW."id"
    AND event."workspace_id" = NEW."workspace_id"
    AND event."owner_user_id" = NEW."owner_user_id"
    AND event."actor_user_id" IS NOT DISTINCT FROM NEW."case_linked_by_user_id"
    AND event."from_case_id" IS NOT DISTINCT FROM OLD."case_id"
    AND event."to_case_id" IS NOT DISTINCT FROM NEW."case_id"
    AND event."mutation_version" = NEW."case_link_revision"
    AND NEW."case_link_revision" = OLD."case_link_revision" + 1
) THEN
RAISE EXCEPTION USING MESSAGE = 'document_analysis_case_projection_guard', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_analyses_case_projection_guard" BEFORE UPDATE OF "case_id","case_link_revision","case_linked_by_user_id" ON "document_analyses"
FOR EACH ROW EXECUTE FUNCTION guard_da75d10873c54c2cdaa73cb2();

-- analysis_case_link_events_project
CREATE FUNCTION guard_41eaa113ae76d6f1cec345f2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
UPDATE "document_analyses"
  SET "case_id" = NEW."to_case_id",
      "case_link_revision" = NEW."mutation_version",
      "case_linked_by_user_id" = NEW."actor_user_id",
      "updated_at" = NEW."created_at"
  WHERE "id" = NEW."analysis_id"
    AND "workspace_id" = NEW."workspace_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "case_id" IS NOT DISTINCT FROM NEW."from_case_id"
    AND "case_link_revision" = NEW."mutation_version" - 1;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_case_link_events_project" AFTER INSERT ON "analysis_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_41eaa113ae76d6f1cec345f2();

-- analysis_case_link_events_case_unlinked
CREATE FUNCTION guard_3b0b25496e3e39906a4b05aa() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."from_case_id" IS NOT NULL THEN
INSERT INTO "case_events" ("id","case_id","actor_user_id","event_type","metadata_json","created_at")
  VALUES (NEW.id || ':unlinked',NEW.from_case_id,NEW.actor_user_id,'analysis_unlinked',json_build_object('analysisId',NEW.analysis_id,'mutationVersion',NEW.mutation_version),NEW.created_at);
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_case_link_events_case_unlinked" AFTER INSERT ON "analysis_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_3b0b25496e3e39906a4b05aa();

-- analysis_case_link_events_case_linked
CREATE FUNCTION guard_5e7b6da26847f1ef813e1b88() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."to_case_id" IS NOT NULL THEN
INSERT INTO "case_events" ("id","case_id","actor_user_id","event_type","metadata_json","created_at")
  VALUES (NEW.id || ':linked',NEW.to_case_id,NEW.actor_user_id,'analysis_linked',json_build_object('analysisId',NEW.analysis_id,'mutationVersion',NEW.mutation_version),NEW.created_at);
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_case_link_events_case_linked" AFTER INSERT ON "analysis_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_5e7b6da26847f1ef813e1b88();

-- analysis_case_link_events_audit
CREATE FUNCTION guard_f700233db51b1aee3be38798() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
INSERT INTO "workspace_audit_events" ("id","workspace_id","actor_user_id","entity_type","entity_id","action","metadata_json","created_at")
  VALUES (NEW.id || ':audit',NEW.workspace_id,NEW.actor_user_id,'document_analysis',NEW.analysis_id,'analysis_case_link_changed',json_build_object('fromCaseId',NEW.from_case_id,'toCaseId',NEW.to_case_id,'mutationVersion',NEW.mutation_version),NEW.created_at);
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_case_link_events_audit" AFTER INSERT ON "analysis_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_f700233db51b1aee3be38798();

-- analysis_case_link_events_no_update
CREATE FUNCTION guard_7fd5a44ea0e34aabe4973467() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'analysis_case_link_event_immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_case_link_events_no_update" BEFORE UPDATE ON "analysis_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_7fd5a44ea0e34aabe4973467();

-- analysis_case_link_events_no_delete
CREATE FUNCTION guard_df9e5f8b5052d2fc1959d169() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "document_analyses" WHERE "id" = OLD."analysis_id") THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_case_link_event_immutable', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "analysis_case_link_events_no_delete" BEFORE DELETE ON "analysis_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_df9e5f8b5052d2fc1959d169();

-- document_case_link_events_insert_guard
CREATE FUNCTION guard_930e05ae5881496570166aa7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."actor_user_id" <> NEW."owner_user_id"
  OR NOT EXISTS (
    SELECT 1 FROM "documents" document
    WHERE document."id" = NEW."document_id"
      AND document."workspace_id" = NEW."workspace_id"
      AND document."owner_user_id" = NEW."owner_user_id"
      AND document."status" <> 'Архив'
      AND document."case_id" IS NOT DISTINCT FROM NEW."from_case_id"
      AND document."case_link_revision" + 1 = NEW."mutation_version"
  )
  OR (NEW."from_case_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cases" source_case
    WHERE source_case."id" = NEW."from_case_id"
      AND source_case."workspace_id" = NEW."workspace_id"
  ))
  OR (NEW."to_case_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "cases" target_case
    WHERE target_case."id" = NEW."to_case_id"
      AND target_case."workspace_id" = NEW."workspace_id"
      AND target_case."archived_at" IS NULL
  )) THEN
RAISE EXCEPTION USING MESSAGE = 'document_case_link_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_case_link_events_insert_guard" BEFORE INSERT ON "document_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_930e05ae5881496570166aa7();

-- documents_case_projection_guard
CREATE FUNCTION guard_50126ee9a9a63806281a9dc6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "document_case_link_events" event
  WHERE event."document_id" = NEW."id"
    AND event."workspace_id" = NEW."workspace_id"
    AND event."owner_user_id" = NEW."owner_user_id"
    AND event."actor_user_id" IS NOT DISTINCT FROM NEW."case_linked_by_user_id"
    AND event."from_case_id" IS NOT DISTINCT FROM OLD."case_id"
    AND event."to_case_id" IS NOT DISTINCT FROM NEW."case_id"
    AND event."mutation_version" = NEW."case_link_revision"
    AND NEW."case_link_revision" = OLD."case_link_revision" + 1
    AND NEW."plan_step_id" IS NULL
) THEN
RAISE EXCEPTION USING MESSAGE = 'documents_case_projection_guard', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "documents_case_projection_guard" BEFORE UPDATE OF "case_id","case_link_revision","case_linked_by_user_id","plan_step_id" ON "documents"
FOR EACH ROW EXECUTE FUNCTION guard_50126ee9a9a63806281a9dc6();

-- document_case_link_events_project
CREATE FUNCTION guard_83e41131cdb5b67bba98aba2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
UPDATE "documents"
  SET "case_id" = NEW."to_case_id",
      "plan_step_id" = NULL,
      "case_link_revision" = NEW."mutation_version",
      "case_linked_by_user_id" = NEW."actor_user_id",
      "updated_at" = NEW."created_at"
  WHERE "id" = NEW."document_id"
    AND "workspace_id" = NEW."workspace_id"
    AND "owner_user_id" = NEW."owner_user_id"
    AND "case_id" IS NOT DISTINCT FROM NEW."from_case_id"
    AND "case_link_revision" = NEW."mutation_version" - 1;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_case_link_events_project" AFTER INSERT ON "document_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_83e41131cdb5b67bba98aba2();

-- document_case_link_events_case_unlinked
CREATE FUNCTION guard_f87a0627543e1f1f29463602() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."from_case_id" IS NOT NULL THEN
INSERT INTO "case_events" ("id","case_id","actor_user_id","event_type","metadata_json","created_at")
  VALUES (NEW.id || ':unlinked',NEW.from_case_id,NEW.actor_user_id,'document_unlinked',json_build_object('documentId',NEW.document_id,'mutationVersion',NEW.mutation_version),NEW.created_at);
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_case_link_events_case_unlinked" AFTER INSERT ON "document_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_f87a0627543e1f1f29463602();

-- document_case_link_events_case_linked
CREATE FUNCTION guard_fcb63d1c7d64819d299d3325() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."to_case_id" IS NOT NULL THEN
INSERT INTO "case_events" ("id","case_id","actor_user_id","event_type","metadata_json","created_at")
  VALUES (NEW.id || ':linked',NEW.to_case_id,NEW.actor_user_id,'document_linked',json_build_object('documentId',NEW.document_id,'mutationVersion',NEW.mutation_version),NEW.created_at);
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_case_link_events_case_linked" AFTER INSERT ON "document_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_fcb63d1c7d64819d299d3325();

-- document_case_link_events_audit
CREATE FUNCTION guard_a7f564ea58df033c71862267() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
INSERT INTO "workspace_audit_events" ("id","workspace_id","actor_user_id","entity_type","entity_id","action","metadata_json","created_at")
  VALUES (NEW.id || ':audit',NEW.workspace_id,NEW.actor_user_id,'document',NEW.document_id,'document_case_link_changed',json_build_object('fromCaseId',NEW.from_case_id,'toCaseId',NEW.to_case_id,'mutationVersion',NEW.mutation_version),NEW.created_at);
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_case_link_events_audit" AFTER INSERT ON "document_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_a7f564ea58df033c71862267();

-- document_case_link_events_no_update
CREATE FUNCTION guard_c5a0d622f65f4b2249488ace() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'document_case_link_event_immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_case_link_events_no_update" BEFORE UPDATE ON "document_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_c5a0d622f65f4b2249488ace();

-- document_case_link_events_no_delete
CREATE FUNCTION guard_ede7be02d267ee2e99396eca() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "documents" WHERE "id" = OLD."document_id") THEN
RAISE EXCEPTION USING MESSAGE = 'document_case_link_event_immutable', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "document_case_link_events_no_delete" BEFORE DELETE ON "document_case_link_events"
FOR EACH ROW EXECUTE FUNCTION guard_ede7be02d267ee2e99396eca();

-- user_legal_bookmark_events_insert_guard
CREATE FUNCTION guard_1831f18b669d3ac8bd578e78() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."actor_user_id" <> NEW."user_id"
  OR NOT EXISTS (
    SELECT 1 FROM "user_legal_bookmarks" bookmark
    WHERE bookmark."id" = NEW."bookmark_id"
      AND bookmark."workspace_id" = NEW."workspace_id"
      AND bookmark."user_id" = NEW."user_id"
      AND bookmark."source_id" = NEW."source_id"
      AND bookmark."version_id" = NEW."version_id"
      AND bookmark."case_id" IS NOT DISTINCT FROM NEW."case_id"
      AND bookmark."revision" = NEW."revision"
      AND ((NEW."event_type" = 'archived' AND bookmark."archived_at" IS NOT NULL)
        OR (NEW."event_type" <> 'archived' AND bookmark."archived_at" IS NULL))
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'user_legal_bookmark_event_projection_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_legal_bookmark_events_insert_guard" BEFORE INSERT ON "user_legal_bookmark_events"
FOR EACH ROW EXECUTE FUNCTION guard_1831f18b669d3ac8bd578e78();

-- user_legal_bookmark_events_audit
CREATE FUNCTION guard_c77f864ea0550af53380b7a2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
INSERT INTO "workspace_audit_events" ("id","workspace_id","actor_user_id","entity_type","entity_id","action","metadata_json","created_at")
  VALUES (NEW."id" || ':audit',NEW."workspace_id",NEW."actor_user_id",'legal_bookmark',NEW."bookmark_id",'legal_bookmark_' || NEW."event_type",json_build_object('sourceId',NEW."source_id",'versionId',NEW."version_id",'caseId',NEW."case_id",'revision',NEW."revision",'commentSha256',NEW."comment_sha256"),NEW."created_at");
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_legal_bookmark_events_audit" AFTER INSERT ON "user_legal_bookmark_events"
FOR EACH ROW EXECUTE FUNCTION guard_c77f864ea0550af53380b7a2();

-- user_legal_bookmark_events_no_update
CREATE FUNCTION guard_820d5c8136c3100ca46a7eef() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'user_legal_bookmark_event_immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_legal_bookmark_events_no_update" BEFORE UPDATE ON "user_legal_bookmark_events"
FOR EACH ROW EXECUTE FUNCTION guard_820d5c8136c3100ca46a7eef();

-- user_legal_bookmark_events_no_delete
CREATE FUNCTION guard_d676f4bae0ba550d48905c91() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "user_legal_bookmarks" WHERE "id" = OLD."bookmark_id") THEN
RAISE EXCEPTION USING MESSAGE = 'user_legal_bookmark_event_immutable', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "user_legal_bookmark_events_no_delete" BEFORE DELETE ON "user_legal_bookmark_events"
FOR EACH ROW EXECUTE FUNCTION guard_d676f4bae0ba550d48905c91();

-- knowledge_base_feedback_events_insert_guard
CREATE FUNCTION guard_11e57a6f0f28fea479c994b1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "knowledge_base_feedback" feedback
  WHERE feedback."id" = NEW."feedback_id"
    AND feedback."article_id" = NEW."article_id"
    AND feedback."version_id" = NEW."version_id"
    AND feedback."workspace_id" = NEW."workspace_id"
    AND feedback."user_id" = NEW."user_id"
    AND feedback."helpful" = NEW."helpful"
    AND feedback."revision" = NEW."revision"
) THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_feedback_event_projection_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_feedback_events_insert_guard" BEFORE INSERT ON "knowledge_base_feedback_events"
FOR EACH ROW EXECUTE FUNCTION guard_11e57a6f0f28fea479c994b1();

-- knowledge_base_feedback_events_audit
CREATE FUNCTION guard_d55182b02619f977d796187e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
INSERT INTO "workspace_audit_events" ("id","workspace_id","actor_user_id","entity_type","entity_id","action","metadata_json","created_at")
  VALUES (NEW."id" || ':audit',NEW."workspace_id",NEW."user_id",'knowledge_base_feedback',NEW."feedback_id",'knowledge_base_feedback_recorded',json_build_object('articleId',NEW."article_id",'versionId',NEW."version_id",'helpful',NEW."helpful",'revision',NEW."revision"),NEW."created_at");
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_feedback_events_audit" AFTER INSERT ON "knowledge_base_feedback_events"
FOR EACH ROW EXECUTE FUNCTION guard_d55182b02619f977d796187e();

-- knowledge_base_feedback_events_no_update
CREATE FUNCTION guard_48cf27fc560f27149bdf8932() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_feedback_event_immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_feedback_events_no_update" BEFORE UPDATE ON "knowledge_base_feedback_events"
FOR EACH ROW EXECUTE FUNCTION guard_48cf27fc560f27149bdf8932();

-- knowledge_base_feedback_events_no_delete
CREATE FUNCTION guard_b83d4230cad8adde7a1b14c9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "knowledge_base_feedback" WHERE "id" = OLD."feedback_id") THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_feedback_event_immutable', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "knowledge_base_feedback_events_no_delete" BEFORE DELETE ON "knowledge_base_feedback_events"
FOR EACH ROW EXECUTE FUNCTION guard_b83d4230cad8adde7a1b14c9();

-- knowledge_base_articles_new_actor_guard
CREATE FUNCTION guard_9f35a0768886032650eac31b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."created_by_user_id" IS NULL OR NEW."updated_by_user_id" IS NULL THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_article_actor_required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_articles_new_actor_guard" BEFORE INSERT ON "knowledge_base_articles"
FOR EACH ROW EXECUTE FUNCTION guard_9f35a0768886032650eac31b();

-- knowledge_base_articles_created_event
CREATE FUNCTION guard_ff84076b76b533e5275447cd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
INSERT INTO "knowledge_base_authoring_events" ("id","article_id","version_id","actor_user_id","action","previous_status","new_status","content_sha256","metadata_json","created_at")
  VALUES (lower(hex(randomblob(16))),NEW."id",NULL,NEW."created_by_user_id",'article_created',NULL,NEW."status",NULL,json_build_object('slug',NEW."slug",'category',NEW."category"),NEW."created_at");
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_articles_created_event" AFTER INSERT ON "knowledge_base_articles"
FOR EACH ROW EXECUTE FUNCTION guard_ff84076b76b533e5275447cd();

-- knowledge_base_articles_identity_updated_event
CREATE FUNCTION guard_f26cbaed5a8680c4f3db9af1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."slug" <> NEW."slug" OR OLD."category" <> NEW."category" THEN
INSERT INTO "knowledge_base_authoring_events" ("id","article_id","version_id","actor_user_id","action","previous_status","new_status","content_sha256","metadata_json","created_at")
  VALUES (lower(hex(randomblob(16))),NEW."id",NULL,NEW."updated_by_user_id",'article_updated',NEW."status",NEW."status",NULL,json_build_object('previousSlug',OLD."slug",'slug',NEW."slug",'previousCategory',OLD."category",'category',NEW."category"),NEW."updated_at");
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_articles_identity_updated_event" AFTER UPDATE OF "slug","category" ON "knowledge_base_articles"
FOR EACH ROW EXECUTE FUNCTION guard_f26cbaed5a8680c4f3db9af1();

-- knowledge_base_articles_status_event
CREATE FUNCTION guard_a821bb64fcf8be6ff47ce1ae() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status" <> NEW."status" THEN
INSERT INTO "knowledge_base_authoring_events" ("id","article_id","version_id","actor_user_id","action","previous_status","new_status","content_sha256","metadata_json","created_at")
  VALUES (lower(hex(randomblob(16))),NEW."id",NULL,NEW."status_changed_by_user_id",'status_changed',OLD."status",NEW."status",NULL,'{}',NEW."status_changed_at");
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_articles_status_event" AFTER UPDATE OF "status" ON "knowledge_base_articles"
FOR EACH ROW EXECUTE FUNCTION guard_a821bb64fcf8be6ff47ce1ae();

-- knowledge_base_articles_no_delete
CREATE FUNCTION guard_c88c0751c41b005ce31f4a44() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_article_delete_forbidden', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "knowledge_base_articles_no_delete" BEFORE DELETE ON "knowledge_base_articles"
FOR EACH ROW EXECUTE FUNCTION guard_c88c0751c41b005ce31f4a44();

-- knowledge_base_authoring_events_no_update
CREATE FUNCTION guard_434cbfe102d0ea27eb8e9509() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_authoring_event_immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_authoring_events_no_update" BEFORE UPDATE ON "knowledge_base_authoring_events"
FOR EACH ROW EXECUTE FUNCTION guard_434cbfe102d0ea27eb8e9509();

-- knowledge_base_authoring_events_no_delete
CREATE FUNCTION guard_d8454c8640e0237b5f255012() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_authoring_event_immutable', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "knowledge_base_authoring_events_no_delete" BEFORE DELETE ON "knowledge_base_authoring_events"
FOR EACH ROW EXECUTE FUNCTION guard_d8454c8640e0237b5f255012();

-- lawyer_review_reply_pending_insert_guard
CREATE FUNCTION guard_9ae5a3d76de10792564c57be() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" <> 'pending' THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer review reply must start pending', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_reply_pending_insert_guard" BEFORE INSERT ON "lawyer_review_replies"
FOR EACH ROW EXECUTE FUNCTION guard_9ae5a3d76de10792564c57be();

-- lawyer_review_reply_author_insert_guard
CREATE FUNCTION guard_f1711b7bc15d45e3aa5c6a4d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
		SELECT 1 FROM "lawyer_reviews" r
		JOIN "lawyer_review_moderation" m ON m."review_id"=r."id" AND m."decision"='approved'
		JOIN "lawyer_profiles" p ON p."id"=r."lawyer_profile_id"
		WHERE r."id"=NEW."review_id" AND r."status"='approved'
			AND p."id"=NEW."lawyer_profile_id" AND p."user_id"=NEW."author_user_id"
			AND p."status"='public_approved'
	) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer review reply author unavailable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_reply_author_insert_guard" BEFORE INSERT ON "lawyer_review_replies"
FOR EACH ROW EXECUTE FUNCTION guard_f1711b7bc15d45e3aa5c6a4d();

-- lawyer_review_reply_version_insert_guard
CREATE FUNCTION guard_0c29b5ec06f3999d0874eb05() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."version" <> COALESCE((
		SELECT MAX(existing."version") + 1 FROM "lawyer_review_replies" existing
		WHERE existing."review_id"=NEW."review_id"
	), 1) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer review reply version conflict', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_reply_version_insert_guard" BEFORE INSERT ON "lawyer_review_replies"
FOR EACH ROW EXECUTE FUNCTION guard_0c29b5ec06f3999d0874eb05();

-- lawyer_review_reply_content_immutable
CREATE FUNCTION guard_8543444daafbcd586a3d5c94() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."review_id" <> OLD."review_id"
	OR NEW."version" <> OLD."version"
	OR NEW."lawyer_profile_id" <> OLD."lawyer_profile_id"
	OR NEW."author_user_id" <> OLD."author_user_id"
	OR NEW."client_request_id" <> OLD."client_request_id"
	OR NEW."body" <> OLD."body"
	OR NEW."created_at" <> OLD."created_at"
	OR OLD."status" <> 'pending'
	OR NEW."status" NOT IN ('approved','rejected')
	OR NEW."updated_at" <= OLD."updated_at" THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer review reply content is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_reply_content_immutable" BEFORE UPDATE ON "lawyer_review_replies"
FOR EACH ROW EXECUTE FUNCTION guard_8543444daafbcd586a3d5c94();

-- lawyer_review_reply_moderation_pending_guard
CREATE FUNCTION guard_a4fe79ea2a43f1ba9262fdfc() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
	SELECT 1 FROM "lawyer_review_replies" reply
	WHERE reply."id"=NEW."reply_id" AND reply."status"='pending'
) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer review reply is not pending', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_reply_moderation_pending_guard" BEFORE INSERT ON "lawyer_review_reply_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_a4fe79ea2a43f1ba9262fdfc();

-- lawyer_review_reply_moderation_apply_status
CREATE FUNCTION guard_6b64965dab0f3050690ff754() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
UPDATE "lawyer_review_replies"
	SET "status"=NEW."decision", "updated_at"=NEW."created_at"
	WHERE "id"=NEW."reply_id" AND "status"='pending';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_reply_moderation_apply_status" AFTER INSERT ON "lawyer_review_reply_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_6b64965dab0f3050690ff754();

-- lawyer_review_reply_moderation_immutable_update
CREATE FUNCTION guard_fc2aa3ac381f24284da693c1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer review reply moderation is append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_review_reply_moderation_immutable_update" BEFORE UPDATE ON "lawyer_review_reply_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_fc2aa3ac381f24284da693c1();

-- lawyer_review_reply_moderation_immutable_delete
CREATE FUNCTION guard_9d881860bfedd6e427b2b81b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer review reply moderation cannot be deleted', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_review_reply_moderation_immutable_delete" BEFORE DELETE ON "lawyer_review_reply_moderation"
FOR EACH ROW EXECUTE FUNCTION guard_9d881860bfedd6e427b2b81b();

-- user_document_index_jobs_identity_immutable
CREATE FUNCTION guard_c8bbaa11987d99d56f8f81a9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."analysis_id" <> OLD."analysis_id"
	OR NEW."document_version_id" <> OLD."document_version_id"
	OR NEW."workspace_id" <> OLD."workspace_id"
	OR NEW."owner_user_id" <> OLD."owner_user_id"
	OR NEW."source_hash" <> OLD."source_hash"
	OR NEW."created_at" <> OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'user document index identity is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_document_index_jobs_identity_immutable" BEFORE UPDATE ON "user_document_index_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_c8bbaa11987d99d56f8f81a9();

-- user_document_vector_chunks_source_guard
CREATE FUNCTION guard_41c4a7ee783912ce61cc3f69() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
	SELECT 1 FROM "user_document_index_jobs" job
	WHERE job."id"=NEW."job_id" AND job."status"='processing'
) THEN
RAISE EXCEPTION USING MESSAGE = 'user document vector job unavailable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_document_vector_chunks_source_guard" BEFORE INSERT ON "user_document_vector_chunks"
FOR EACH ROW EXECUTE FUNCTION guard_41c4a7ee783912ce61cc3f69();

-- ai_model_price_versions_actor_guard
CREATE FUNCTION guard_ed0ca6957a8e601dc7f25ee8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=NEW."created_by_user_id") THEN
RAISE EXCEPTION USING MESSAGE = 'AI_MODEL_PRICE_ACTOR_UNAVAILABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_model_price_versions_actor_guard" BEFORE INSERT ON "ai_model_price_versions"
FOR EACH ROW EXECUTE FUNCTION guard_ed0ca6957a8e601dc7f25ee8();

-- ai_model_price_versions_no_update
CREATE FUNCTION guard_f7eeb7b06e9813657da6f4b3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_MODEL_PRICE_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_model_price_versions_no_update" BEFORE UPDATE ON "ai_model_price_versions"
FOR EACH ROW EXECUTE FUNCTION guard_f7eeb7b06e9813657da6f4b3();

-- ai_model_price_versions_no_delete
CREATE FUNCTION guard_a7336e53d26cdfa9b612f871() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_MODEL_PRICE_VERSION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ai_model_price_versions_no_delete" BEFORE DELETE ON "ai_model_price_versions"
FOR EACH ROW EXECUTE FUNCTION guard_a7336e53d26cdfa9b612f871();

-- ai_provider_usage_events_no_update
CREATE FUNCTION guard_ccc8d4a49e7c747ec2b96d80() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_PROVIDER_USAGE_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_provider_usage_events_no_update" BEFORE UPDATE ON "ai_provider_usage_events"
FOR EACH ROW EXECUTE FUNCTION guard_ccc8d4a49e7c747ec2b96d80();

-- ai_provider_usage_events_no_delete
CREATE FUNCTION guard_d8e3c9613be9df53e748bb73() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_PROVIDER_USAGE_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ai_provider_usage_events_no_delete" BEFORE DELETE ON "ai_provider_usage_events"
FOR EACH ROW EXECUTE FUNCTION guard_d8e3c9613be9df53e748bb73();

-- ai_cost_guard_policy_actor_guard
CREATE FUNCTION guard_063695030826dc474608d08c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=NEW."created_by_user_id") THEN
RAISE EXCEPTION USING MESSAGE = 'AI_COST_GUARD_ACTOR_UNAVAILABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_cost_guard_policy_actor_guard" BEFORE INSERT ON "ai_cost_guard_policy_versions"
FOR EACH ROW EXECUTE FUNCTION guard_063695030826dc474608d08c();

-- ai_cost_guard_policy_no_update
CREATE FUNCTION guard_cff3db712f0d9e8c4fc40bef() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_COST_GUARD_POLICY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_cost_guard_policy_no_update" BEFORE UPDATE ON "ai_cost_guard_policy_versions"
FOR EACH ROW EXECUTE FUNCTION guard_cff3db712f0d9e8c4fc40bef();

-- ai_cost_guard_policy_no_delete
CREATE FUNCTION guard_df2cd18e796b43749e55c501() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_COST_GUARD_POLICY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ai_cost_guard_policy_no_delete" BEFORE DELETE ON "ai_cost_guard_policy_versions"
FOR EACH ROW EXECUTE FUNCTION guard_df2cd18e796b43749e55c501();

-- ai_cost_control_event_actor_guard
CREATE FUNCTION guard_7db993a4aa7df1f9d561e8ef() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."actor_user_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=NEW."actor_user_id") THEN
RAISE EXCEPTION USING MESSAGE = 'AI_COST_CONTROL_ACTOR_UNAVAILABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_cost_control_event_actor_guard" BEFORE INSERT ON "ai_cost_control_events"
FOR EACH ROW EXECUTE FUNCTION guard_7db993a4aa7df1f9d561e8ef();

-- ai_cost_control_events_no_update
CREATE FUNCTION guard_33d473d90a4b2294fc6a2612() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_COST_CONTROL_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_cost_control_events_no_update" BEFORE UPDATE ON "ai_cost_control_events"
FOR EACH ROW EXECUTE FUNCTION guard_33d473d90a4b2294fc6a2612();

-- ai_cost_control_events_no_delete
CREATE FUNCTION guard_3cba6844b2e15609342ba391() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_COST_CONTROL_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ai_cost_control_events_no_delete" BEFORE DELETE ON "ai_cost_control_events"
FOR EACH ROW EXECUTE FUNCTION guard_3cba6844b2e15609342ba391();

-- system_status_incident_actor_guard
CREATE FUNCTION guard_3dbaa9ff9f767b85a0ca3350() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=NEW."created_by_user_id") THEN
RAISE EXCEPTION USING MESSAGE = 'SYSTEM_STATUS_ACTOR_UNAVAILABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "system_status_incident_actor_guard" BEFORE INSERT ON "system_status_incidents"
FOR EACH ROW EXECUTE FUNCTION guard_3dbaa9ff9f767b85a0ca3350();

-- system_status_incident_no_delete
CREATE FUNCTION guard_ae98a699847fac602a2b0e83() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'SYSTEM_STATUS_INCIDENT_DELETE_FORBIDDEN', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "system_status_incident_no_delete" BEFORE DELETE ON "system_status_incidents"
FOR EACH ROW EXECUTE FUNCTION guard_ae98a699847fac602a2b0e83();

-- system_status_incident_component_no_update
CREATE FUNCTION guard_c92f9ede83c8db040ba0e21b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'SYSTEM_STATUS_COMPONENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "system_status_incident_component_no_update" BEFORE UPDATE ON "system_status_incident_components"
FOR EACH ROW EXECUTE FUNCTION guard_c92f9ede83c8db040ba0e21b();

-- system_status_incident_component_no_delete
CREATE FUNCTION guard_a64e964194bac1ad3fbb161b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'SYSTEM_STATUS_COMPONENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "system_status_incident_component_no_delete" BEFORE DELETE ON "system_status_incident_components"
FOR EACH ROW EXECUTE FUNCTION guard_a64e964194bac1ad3fbb161b();

-- system_status_update_actor_guard
CREATE FUNCTION guard_f5fee8abdfdf3a3d7d1e20a7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=NEW."created_by_user_id") THEN
RAISE EXCEPTION USING MESSAGE = 'SYSTEM_STATUS_UPDATE_ACTOR_UNAVAILABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "system_status_update_actor_guard" BEFORE INSERT ON "system_status_updates"
FOR EACH ROW EXECUTE FUNCTION guard_f5fee8abdfdf3a3d7d1e20a7();

-- system_status_update_no_update
CREATE FUNCTION guard_5bca9ed3cf989b46821c2f9f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'SYSTEM_STATUS_UPDATE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "system_status_update_no_update" BEFORE UPDATE ON "system_status_updates"
FOR EACH ROW EXECUTE FUNCTION guard_5bca9ed3cf989b46821c2f9f();

-- system_status_update_no_delete
CREATE FUNCTION guard_7149a1b98de45866eada2619() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'SYSTEM_STATUS_UPDATE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "system_status_update_no_delete" BEFORE DELETE ON "system_status_updates"
FOR EACH ROW EXECUTE FUNCTION guard_7149a1b98de45866eada2619();

-- platform_audit_access_chain_guard
CREATE FUNCTION guard_3eae3334b771d0730cae2545() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
	NOT EXISTS (
		SELECT 1 FROM "platform_audit_access_events"
		WHERE "actor_user_id"=NEW."actor_user_id"
	)
	AND NEW."previous_hash"<>'0000000000000000000000000000000000000000000000000000000000000000'
)
OR (
	EXISTS (
		SELECT 1 FROM "platform_audit_access_events"
		WHERE "actor_user_id"=NEW."actor_user_id"
	)
	AND NOT EXISTS (
		SELECT 1 FROM "platform_audit_access_events" AS parent
		WHERE parent."actor_user_id"=NEW."actor_user_id"
		  AND parent."event_hash"=NEW."previous_hash"
		  AND NOT EXISTS (
			SELECT 1 FROM "platform_audit_access_events" AS child
			WHERE child."actor_user_id"=parent."actor_user_id"
			  AND child."previous_hash"=parent."event_hash"
		  )
	)
) THEN
RAISE EXCEPTION USING MESSAGE = 'PLATFORM_AUDIT_ACCESS_CHAIN_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "platform_audit_access_chain_guard" BEFORE INSERT ON "platform_audit_access_events"
FOR EACH ROW EXECUTE FUNCTION guard_3eae3334b771d0730cae2545();

-- platform_audit_access_actor_guard
CREATE FUNCTION guard_f47bb1ce90a83f8ce1b56a58() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
	SELECT 1
	FROM "auth_sessions" AS session
	JOIN "platform_staff_assignments" AS assignment
	  ON assignment."id"=NEW."actor_assignment_id"
	 AND assignment."user_id"=NEW."actor_user_id"
	LEFT JOIN "auth_devices" AS device ON device."id"=session."device_id"
	WHERE session."id"=NEW."actor_session_id"
	  AND session."user_id"=NEW."actor_user_id"
	  AND session."revoked_at" IS NULL
	  AND session."assurance_level"='mfa'
	  AND session."mfa_verified_at"=NEW."actor_mfa_verified_at"
	  AND unixepoch(NEW."created_at")-unixepoch(session."mfa_verified_at") BETWEEN 0 AND 900
	  AND session."expires_at">NEW."created_at"
	  AND coalesce(session."idle_expires_at",session."expires_at")>NEW."created_at"
	  AND (session."device_id" IS NULL OR (device."id" IS NOT NULL AND device."revoked_at" IS NULL))
	  AND assignment."role"='administrator'
	  AND assignment."granted_at"<=NEW."created_at"
	  AND assignment."expires_at">NEW."created_at"
	  AND assignment."revoked_at" IS NULL
	  AND EXISTS (
		SELECT 1 FROM "auth_totp_credentials" AS totp
		WHERE totp."user_id"=NEW."actor_user_id"
		  AND totp."status"='active'
		  AND totp."verified_at" IS NOT NULL
		  AND totp."verified_at"<=NEW."actor_mfa_verified_at"
		  AND totp."disabled_at" IS NULL
	  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'PLATFORM_AUDIT_ACCESS_DENIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "platform_audit_access_actor_guard" BEFORE INSERT ON "platform_audit_access_events"
FOR EACH ROW EXECUTE FUNCTION guard_f47bb1ce90a83f8ce1b56a58();

-- platform_audit_access_no_update
CREATE FUNCTION guard_fd48812b2bcfb6b3ec199b80() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'PLATFORM_AUDIT_ACCESS_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "platform_audit_access_no_update" BEFORE UPDATE ON "platform_audit_access_events"
FOR EACH ROW EXECUTE FUNCTION guard_fd48812b2bcfb6b3ec199b80();

-- platform_audit_access_no_delete
CREATE FUNCTION guard_90a8404e37c122d936434561() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'PLATFORM_AUDIT_ACCESS_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "platform_audit_access_no_delete" BEFORE DELETE ON "platform_audit_access_events"
FOR EACH ROW EXECUTE FUNCTION guard_90a8404e37c122d936434561();

-- ai_quality_review_contents_no_update
CREATE FUNCTION guard_46addc5720b7087185ab9cf1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_QUALITY_REVIEW_CONTENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_quality_review_contents_no_update" BEFORE UPDATE ON "ai_quality_review_contents"
FOR EACH ROW EXECUTE FUNCTION guard_46addc5720b7087185ab9cf1();

-- ai_runtime_config_sequence_guard
CREATE FUNCTION guard_e264edc1f23fa2b567685f84() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."version"<>(SELECT coalesce(max("version"),0)+1 FROM "ai_runtime_config_versions" WHERE "environment"=NEW."environment") THEN
RAISE EXCEPTION USING MESSAGE = 'AI_RUNTIME_CONFIG_VERSION_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_runtime_config_sequence_guard" BEFORE INSERT ON "ai_runtime_config_versions"
FOR EACH ROW EXECUTE FUNCTION guard_e264edc1f23fa2b567685f84();

-- ai_runtime_config_chain_guard
CREATE FUNCTION guard_47212cc954be3c50e6e8cfc7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
	NOT EXISTS (SELECT 1 FROM "ai_runtime_config_versions" WHERE "environment"=NEW."environment")
	AND NEW."previous_hash"<>'0000000000000000000000000000000000000000000000000000000000000000'
) OR (
	EXISTS (SELECT 1 FROM "ai_runtime_config_versions" WHERE "environment"=NEW."environment")
	AND NOT EXISTS (
		SELECT 1 FROM "ai_runtime_config_versions" parent
		WHERE parent."environment"=NEW."environment" AND parent."event_hash"=NEW."previous_hash"
		AND NOT EXISTS (
			SELECT 1 FROM "ai_runtime_config_versions" child
			WHERE child."environment"=parent."environment" AND child."previous_hash"=parent."event_hash"
		)
	)
) THEN
RAISE EXCEPTION USING MESSAGE = 'AI_RUNTIME_CONFIG_CHAIN_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_runtime_config_chain_guard" BEFORE INSERT ON "ai_runtime_config_versions"
FOR EACH ROW EXECUTE FUNCTION guard_47212cc954be3c50e6e8cfc7();

-- ai_runtime_config_actor_guard
CREATE FUNCTION guard_1f461f047f1b1538a307cf20() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
	SELECT 1
	FROM "auth_sessions" session
	JOIN "platform_staff_assignments" assignment
	  ON assignment."id"=NEW."actor_assignment_id" AND assignment."user_id"=NEW."actor_user_id"
	LEFT JOIN "auth_devices" device ON device."id"=session."device_id"
	WHERE session."id"=NEW."actor_session_id"
	  AND session."user_id"=NEW."actor_user_id"
	  AND session."revoked_at" IS NULL
	  AND session."assurance_level"='mfa'
	  AND session."mfa_verified_at"=NEW."actor_mfa_verified_at"
	  AND unixepoch(NEW."created_at")-unixepoch(session."mfa_verified_at") BETWEEN 0 AND 900
	  AND session."expires_at">NEW."created_at"
	  AND coalesce(session."idle_expires_at",session."expires_at")>NEW."created_at"
	  AND (session."device_id" IS NULL OR (device."id" IS NOT NULL AND device."revoked_at" IS NULL))
	  AND assignment."role"='administrator'
	  AND assignment."granted_at"<=NEW."created_at"
	  AND assignment."expires_at">NEW."created_at"
	  AND assignment."revoked_at" IS NULL
	  AND EXISTS (
		SELECT 1 FROM "auth_totp_credentials" totp
		WHERE totp."user_id"=NEW."actor_user_id"
		  AND totp."status"='active' AND totp."verified_at" IS NOT NULL
		  AND totp."verified_at"<=NEW."actor_mfa_verified_at" AND totp."disabled_at" IS NULL
	  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'AI_RUNTIME_CONFIG_ACCESS_DENIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_runtime_config_actor_guard" BEFORE INSERT ON "ai_runtime_config_versions"
FOR EACH ROW EXECUTE FUNCTION guard_1f461f047f1b1538a307cf20();

-- ai_runtime_config_no_update
CREATE FUNCTION guard_7462c4ce46861285270855f3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_RUNTIME_CONFIG_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_runtime_config_no_update" BEFORE UPDATE ON "ai_runtime_config_versions"
FOR EACH ROW EXECUTE FUNCTION guard_7462c4ce46861285270855f3();

-- ai_runtime_config_no_delete
CREATE FUNCTION guard_0a683d546dabf08ebaa540b0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_RUNTIME_CONFIG_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ai_runtime_config_no_delete" BEFORE DELETE ON "ai_runtime_config_versions"
FOR EACH ROW EXECUTE FUNCTION guard_0a683d546dabf08ebaa540b0();

-- legal_corpus_alert_run_guard
CREATE FUNCTION guard_d62db84306ad1ff7b4ff8706() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."source_sync_run_id" IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM "source_sync_runs" run
	WHERE run."id"=NEW."source_sync_run_id"
	  AND run."environment"=NEW."environment"
	  AND run."source_kind"=NEW."source_kind"
	  AND run."run_type" IN ('scheduled_corpus','manual_corpus')
	  AND run."status"='failed'
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_ALERT_RUN_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_alert_run_guard" BEFORE INSERT ON "legal_corpus_alert_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_d62db84306ad1ff7b4ff8706();

-- legal_corpus_alert_identity_guard
CREATE FUNCTION guard_38c8c579f5dbd385c14076b0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."environment"<>OLD."environment"
	OR NEW."source_kind"<>OLD."source_kind"
	OR coalesce(NEW."source_sync_run_id",'')<>coalesce(OLD."source_sync_run_id",'')
	OR NEW."alert_type"<>OLD."alert_type"
	OR NEW."alert_key"<>OLD."alert_key"
	OR NEW."severity"<>OLD."severity"
	OR NEW."reason"<>OLD."reason"
	OR coalesce(NEW."observed_value",-1)<>coalesce(OLD."observed_value",-1)
	OR coalesce(NEW."threshold_value",-1)<>coalesce(OLD."threshold_value",-1)
	OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_ALERT_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_alert_identity_guard" BEFORE UPDATE ON "legal_corpus_alert_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_38c8c579f5dbd385c14076b0();

-- legal_corpus_alert_no_delete
CREATE FUNCTION guard_b2fd21d24dcb4d1e88494700() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_ALERT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_alert_no_delete" BEFORE DELETE ON "legal_corpus_alert_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_b2fd21d24dcb4d1e88494700();

-- legal_source_applicability_insert_guard
CREATE FUNCTION guard_2906316080185f59d579889c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
		SELECT 1 FROM "legal_review_queue" review
		INNER JOIN "legal_source_versions" version
			ON version."id"=review."version_id" AND version."source_id"=review."source_id"
		WHERE review."id"=NEW."review_id"
		  AND review."source_id"=NEW."source_id"
		  AND review."version_id"=NEW."version_id"
		  AND review."status"='in_review'
		  AND review."assigned_to_user_id"=NEW."reviewed_by_user_id"
		  AND review."decision" IS NULL
		  AND version."status"='pending_review'
	) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_APPLICABILITY_REVIEW_INVALID', ERRCODE = '23514';
END IF;
IF COALESCE((
		CAST(json_extract(NEW."evidence_json", '$.schemaVersion') AS numeric)=1
		AND json_extract(NEW."evidence_json", '$.recordId')=NEW."id"
		AND json_extract(NEW."evidence_json", '$.reviewId')=NEW."review_id"
		AND json_extract(NEW."evidence_json", '$.sourceId')=NEW."source_id"
		AND json_extract(NEW."evidence_json", '$.versionId')=NEW."version_id"
		AND json_extract(NEW."evidence_json", '$.effectiveAt')=NEW."effective_at"
		AND json_extract(NEW."evidence_json", '$.expiresAt') IS NOT DISTINCT FROM NEW."expires_at"
		AND json_extract(NEW."evidence_json", '$.reviewedByUserId')=NEW."reviewed_by_user_id"
		AND json_extract(NEW."evidence_json", '$.reviewerSessionId')=NEW."reviewer_session_id"
		AND json_extract(NEW."evidence_json", '$.mfaVerifiedAt')=NEW."mfa_verified_at"
		AND json_extract(NEW."evidence_json", '$.createdAt')=NEW."created_at"
	),0)=0 THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_APPLICABILITY_EVIDENCE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_applicability_insert_guard" BEFORE INSERT ON "legal_source_applicability_records"
FOR EACH ROW EXECUTE FUNCTION guard_2906316080185f59d579889c();

-- legal_review_queue_approval_applicability_insert_guard
CREATE FUNCTION guard_4cd018a5c1021f137ac51a79() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"='approved' THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_APPROVAL_APPLICABILITY_REQUIRED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_review_queue_approval_applicability_insert_guard" BEFORE INSERT ON "legal_review_queue"
FOR EACH ROW EXECUTE FUNCTION guard_4cd018a5c1021f137ac51a79();

-- legal_review_queue_approval_applicability_update_guard
CREATE FUNCTION guard_cb6c27b3b0202c6afc5316e0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"='approved' AND OLD."status"<>'approved' THEN
IF NOT EXISTS (
		SELECT 1 FROM "legal_source_applicability_records" applicability
		WHERE applicability."review_id"=NEW."id"
		  AND applicability."source_id"=NEW."source_id"
		  AND applicability."version_id"=NEW."version_id"
		  AND applicability."reviewed_by_user_id"=NEW."decided_by_user_id"
		  AND applicability."reviewer_session_id"=
			json_extract(NEW."decision_evidence_json", '$.reviewerSessionId')
		  AND applicability."mfa_verified_at"=
			json_extract(NEW."decision_evidence_json", '$.mfaVerifiedAt')
		  AND applicability."created_at"=NEW."decided_at"
	) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_APPROVAL_APPLICABILITY_REQUIRED', ERRCODE = '23514';
END IF;
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_review_queue_approval_applicability_update_guard" BEFORE UPDATE ON "legal_review_queue"
FOR EACH ROW EXECUTE FUNCTION guard_cb6c27b3b0202c6afc5316e0();

-- legal_source_applicability_update_guard
CREATE FUNCTION guard_70d9d78d22f4aba908e7ded6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_APPLICABILITY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_source_applicability_update_guard" BEFORE UPDATE ON "legal_source_applicability_records"
FOR EACH ROW EXECUTE FUNCTION guard_70d9d78d22f4aba908e7ded6();

-- legal_source_applicability_delete_guard
CREATE FUNCTION guard_b2eb3dc04c9c9c4936e03ab4() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_SOURCE_APPLICABILITY_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_source_applicability_delete_guard" BEFORE DELETE ON "legal_source_applicability_records"
FOR EACH ROW EXECUTE FUNCTION guard_b2eb3dc04c9c9c4936e03ab4();

-- source_sync_runs_insert_guard
CREATE FUNCTION guard_5751a63c99f995b5d07c7f03() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."source_kind" NOT IN ('lex','advice')
     OR NEW."environment" NOT IN ('development','staging','production') THEN
RAISE EXCEPTION USING MESSAGE = 'source sync scope invalid', ERRCODE = '23514';
END IF;
IF NEW."status" NOT IN ('running','success','partial','failed','cancelled') THEN
RAISE EXCEPTION USING MESSAGE = 'source sync status invalid', ERRCODE = '23514';
END IF;
IF (NEW."status"='running' AND NEW."finished_at" IS NOT NULL)
     OR (NEW."status"<>'running' AND NEW."finished_at" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'source sync completion evidence invalid', ERRCODE = '23514';
END IF;
IF NEW."discovered_count"<0 OR NEW."fetched_count"<0
     OR NEW."changed_count"<0 OR NEW."verified_count"<0
     OR NEW."error_count"<0 OR NEW."fetched_count">NEW."discovered_count"
     OR NEW."changed_count"+NEW."verified_count">NEW."fetched_count" THEN
RAISE EXCEPTION USING MESSAGE = 'SOURCE_SYNC_COUNTERS_INVALID', ERRCODE = '23514';
END IF;
IF NEW."run_type" IN ('initial_corpus','scheduled_corpus','manual_corpus')
    AND NEW."status"='success'
    AND (
      NEW."discovered_count"=0
      OR NEW."fetched_count"<>NEW."discovered_count"
      OR NEW."verified_count"<>NEW."discovered_count"
      OR NEW."changed_count"<>0
      OR NEW."error_count"<>0
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_SUCCESS_UNVERIFIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "source_sync_runs_insert_guard" BEFORE INSERT ON "source_sync_runs"
FOR EACH ROW EXECUTE FUNCTION guard_5751a63c99f995b5d07c7f03();

-- source_sync_runs_update_guard
CREATE FUNCTION guard_a235a6caaa735b761cd7a9a2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
     OR NEW."environment"<>OLD."environment"
     OR NEW."source_kind"<>OLD."source_kind"
     OR NEW."run_type"<>OLD."run_type"
     OR NEW."lock_key"<>OLD."lock_key"
     OR NEW."started_at"<>OLD."started_at"
     OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'SOURCE_SYNC_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
IF OLD."status"<>'running' AND (
    NEW."status"<>OLD."status"
    OR NEW."discovered_count"<>OLD."discovered_count"
    OR NEW."fetched_count"<>OLD."fetched_count"
    OR NEW."changed_count"<>OLD."changed_count"
    OR NEW."verified_count"<>OLD."verified_count"
    OR NEW."error_count"<>OLD."error_count"
    OR coalesce(NEW."finished_at",'')<>coalesce(OLD."finished_at",'')
    OR coalesce(NEW."error_summary",'')<>coalesce(OLD."error_summary",'')
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'SOURCE_SYNC_TERMINAL_IMMUTABLE', ERRCODE = '23514';
END IF;
IF NEW."status" NOT IN ('running','success','partial','failed','cancelled') THEN
RAISE EXCEPTION USING MESSAGE = 'source sync status invalid', ERRCODE = '23514';
END IF;
IF (NEW."status"='running' AND NEW."finished_at" IS NOT NULL)
     OR (NEW."status"<>'running' AND NEW."finished_at" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'source sync completion evidence invalid', ERRCODE = '23514';
END IF;
IF NEW."discovered_count"<0 OR NEW."fetched_count"<0
     OR NEW."changed_count"<0 OR NEW."verified_count"<0
     OR NEW."error_count"<0 OR NEW."fetched_count">NEW."discovered_count"
     OR NEW."changed_count"+NEW."verified_count">NEW."fetched_count" THEN
RAISE EXCEPTION USING MESSAGE = 'SOURCE_SYNC_COUNTERS_INVALID', ERRCODE = '23514';
END IF;
IF NEW."run_type" IN ('initial_corpus','scheduled_corpus','manual_corpus')
    AND NEW."status"='success'
    AND (
      NEW."discovered_count"=0
      OR NEW."fetched_count"<>NEW."discovered_count"
      OR NEW."verified_count"<>NEW."discovered_count"
      OR NEW."changed_count"<>0
      OR NEW."error_count"<>0
    ) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_SUCCESS_UNVERIFIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "source_sync_runs_update_guard" BEFORE UPDATE ON "source_sync_runs"
FOR EACH ROW EXECUTE FUNCTION guard_a235a6caaa735b761cd7a9a2();

-- source_sync_runs_delete_guard
CREATE FUNCTION guard_8efd4bd841a33fceb3646a46() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'SOURCE_SYNC_RUN_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "source_sync_runs_delete_guard" BEFORE DELETE ON "source_sync_runs"
FOR EACH ROW EXECUTE FUNCTION guard_8efd4bd841a33fceb3646a46();

-- document_evaluation_chain_guard
CREATE FUNCTION guard_dc99fa66c24f560e24b29bf5() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
	NOT EXISTS (SELECT 1 FROM "document_evaluation_review_events" WHERE "actor_user_id"=NEW."actor_user_id")
	AND NEW."previous_hash"<>'0000000000000000000000000000000000000000000000000000000000000000'
)
OR (
	EXISTS (SELECT 1 FROM "document_evaluation_review_events" WHERE "actor_user_id"=NEW."actor_user_id")
	AND NOT EXISTS (
		SELECT 1 FROM "document_evaluation_review_events" AS parent
		WHERE parent."actor_user_id"=NEW."actor_user_id"
		  AND parent."event_hash"=NEW."previous_hash"
		  AND NOT EXISTS (
			SELECT 1 FROM "document_evaluation_review_events" AS child
			WHERE child."actor_user_id"=parent."actor_user_id"
			  AND child."previous_hash"=parent."event_hash"
		  )
	)
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_EVALUATION_CHAIN_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_evaluation_chain_guard" BEFORE INSERT ON "document_evaluation_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_dc99fa66c24f560e24b29bf5();

-- document_evaluation_actor_guard
CREATE FUNCTION guard_b8a55b53522343bb2b43e48c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
	SELECT 1
	FROM "auth_sessions" AS session
	JOIN "platform_staff_assignments" AS assignment
	  ON assignment."id"=NEW."actor_assignment_id"
	 AND assignment."user_id"=NEW."actor_user_id"
	LEFT JOIN "auth_devices" AS device ON device."id"=session."device_id"
	WHERE session."id"=NEW."actor_session_id"
	  AND session."user_id"=NEW."actor_user_id"
	  AND session."revoked_at" IS NULL
	  AND session."assurance_level"='mfa'
	  AND session."mfa_verified_at"=NEW."actor_mfa_verified_at"
	  AND unixepoch(NEW."created_at")-unixepoch(session."mfa_verified_at") BETWEEN 0 AND 900
	  AND session."expires_at">NEW."created_at"
	  AND coalesce(session."idle_expires_at",session."expires_at")>NEW."created_at"
	  AND (session."device_id" IS NULL OR (device."id" IS NOT NULL AND device."revoked_at" IS NULL))
	  AND assignment."role"='legal_reviewer'
	  AND assignment."granted_at"<=NEW."created_at"
	  AND assignment."expires_at">NEW."created_at"
	  AND assignment."revoked_at" IS NULL
	  AND EXISTS (
		SELECT 1 FROM "auth_totp_credentials" AS totp
		WHERE totp."user_id"=NEW."actor_user_id"
		  AND totp."status"='active'
		  AND totp."verified_at" IS NOT NULL
		  AND totp."verified_at"<=NEW."actor_mfa_verified_at"
		  AND totp."disabled_at" IS NULL
	  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_EVALUATION_ACCESS_DENIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_evaluation_actor_guard" BEFORE INSERT ON "document_evaluation_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_b8a55b53522343bb2b43e48c();

-- document_evaluation_review_guard
CREATE FUNCTION guard_7fdc56baec273d9d21a57381() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."request_action"='review' AND (
	NEW."review_version"<>(
		SELECT coalesce(max("review_version"),0)+1
		FROM "document_evaluation_review_events"
		WHERE "evaluation_run_id"=NEW."evaluation_run_id"
		  AND "package_id"=NEW."package_id"
		  AND "request_action"='review'
	)
	OR NOT EXISTS (
		SELECT 1
		FROM "document_files" AS file
		JOIN "document_analyses" AS analysis
		  ON analysis."id"=NEW."analysis_id"
		 AND analysis."uploaded_file_id"=file."id"
		 AND analysis."workspace_id"=file."workspace_id"
		 AND analysis."owner_user_id"=file."owner_user_id"
		JOIN "file_scan_results" AS scan
		  ON scan."id"=NEW."scan_result_id"
		 AND scan."analysis_id"=analysis."id"
		 AND scan."file_id"=file."id"
		 AND scan."workspace_id"=analysis."workspace_id"
		 AND scan."owner_user_id"=analysis."owner_user_id"
		JOIN "ai_runs" AS run
		  ON run."id"=NEW."analysis_run_id"
		 AND run."workspace_id"=analysis."workspace_id"
		 AND run."user_id"=analysis."owner_user_id"
		WHERE file."id"=NEW."file_id"
		  AND file."kind"='analysis_safe'
		  AND file."sha256"=NEW."artifact_sha256"
		  AND file."size_bytes"=NEW."artifact_bytes"
		  AND (
			(NEW."actual_format"='docx' AND file."mime_type"='application/vnd.openxmlformats-officedocument.wordprocessingml.document')
			OR (NEW."actual_format" IN ('text_pdf','scanned_pdf') AND file."mime_type"='application/pdf')
			OR (NEW."actual_format"='jpg' AND file."mime_type"='image/jpeg')
			OR (NEW."actual_format"='png' AND file."mime_type"='image/png')
			OR (NEW."actual_format"='zip' AND file."mime_type"='application/zip')
		  )
		  AND analysis."status"='completed'
		  AND analysis."summary_json" IS NOT NULL
		  AND json_valid(analysis."summary_json") = true
		  AND analysis."result_sha256"=NEW."analysis_result_sha256"
		  AND analysis."error_code" IS NULL
		  AND scan."verdict"='clean'
		  AND scan."provider"=NEW."scan_provider"
		  AND scan."source_sha256"=NEW."artifact_sha256"
		  AND run."status"='completed'
		  AND run."provider"=NEW."provider"
		  AND run."model"=NEW."provider_model"
		  AND run."provider_response_id"=NEW."provider_response_id"
		  AND run."completed_at"=NEW."completed_at"
		  AND run."error_code" IS NULL
	)
	OR NEW."critical_risks_detected"<>(
		SELECT count(*) FROM "document_risks"
		WHERE "analysis_id"=NEW."analysis_id" AND "level"='critical'
	)
	OR (
		NEW."comparison_reviewed"=1 AND NOT EXISTS (
			SELECT 1 FROM "document_comparisons"
			WHERE "id"=NEW."comparison_id"
			  AND "status"='completed' AND "stage"='completed'
			  AND "deleted_at" IS NULL
			  AND NEW."file_id" IN ("version_one_file_id","version_two_file_id")
		)
	)
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_EVALUATION_REVIEW_STALE_OR_UNVERIFIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_evaluation_review_guard" BEFORE INSERT ON "document_evaluation_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_7fdc56baec273d9d21a57381();

-- document_evaluation_events_no_update
CREATE FUNCTION guard_d757ea455e96db2bcd3874b5() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_EVALUATION_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_evaluation_events_no_update" BEFORE UPDATE ON "document_evaluation_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_d757ea455e96db2bcd3874b5();

-- document_evaluation_events_no_delete
CREATE FUNCTION guard_4649f6f1cc4ee58c57d12e91() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_EVALUATION_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "document_evaluation_events_no_delete" BEFORE DELETE ON "document_evaluation_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_4649f6f1cc4ee58c57d12e91();

-- task_reminder_email_jobs_insert_guard
CREATE FUNCTION guard_046fb4c6e540c2007b778d26() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"<>'pending'
	OR NEW."attempt_count"<>0
	OR NEW."provider_message_id" IS NOT NULL
	OR NEW."error_code" IS NOT NULL
	OR NEW."sent_at" IS NOT NULL
	OR NOT EXISTS (
		SELECT 1 FROM "task_reminders" reminder
		JOIN "tasks" task ON task."id"=reminder."task_id"
		JOIN "cases" legal_case ON legal_case."id"=task."case_id" AND legal_case."workspace_id"=task."workspace_id"
		JOIN "workspace_members" member ON member."workspace_id"=task."workspace_id" AND member."user_id"=task."owner_user_id"
		WHERE reminder."id"=NEW."reminder_id"
			AND reminder."channel"='email'
			AND reminder."status"='pending'
			AND reminder."updated_at"=NEW."reminder_updated_at"
			AND task."workspace_id"=NEW."workspace_id"
			AND task."owner_user_id"=NEW."user_id"
			AND task."status" NOT IN ('completed','cancelled')
			AND legal_case."archived_at" IS NULL
			AND member."status"='active'
	) THEN
RAISE EXCEPTION USING MESSAGE = 'TASK_REMINDER_EMAIL_SOURCE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "task_reminder_email_jobs_insert_guard" BEFORE INSERT ON "task_reminder_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_046fb4c6e540c2007b778d26();

-- task_reminder_email_jobs_identity_immutable
CREATE FUNCTION guard_11e64649d86da1658bd1fa81() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id" IS DISTINCT FROM OLD."id"
	OR NEW."reminder_id" IS DISTINCT FROM OLD."reminder_id"
	OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
	OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
	OR NEW."reminder_updated_at" IS DISTINCT FROM OLD."reminder_updated_at"
	OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'TASK_REMINDER_EMAIL_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "task_reminder_email_jobs_identity_immutable" BEFORE UPDATE ON "task_reminder_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_11e64649d86da1658bd1fa81();

-- task_reminder_email_jobs_transition_guard
CREATE FUNCTION guard_ed6a07ec9eb848e788651810() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
	(OLD."status" IN ('pending','retrying') AND NEW."status"='sending'
		AND NEW."attempt_count"=OLD."attempt_count"+1
		AND NEW."provider_message_id" IS NULL AND NEW."error_code" IS NULL AND NEW."sent_at" IS NULL)
	OR (OLD."status"='sending' AND NEW."status" IN ('retrying','failed')
		AND NEW."attempt_count"=OLD."attempt_count"
		AND NEW."provider_message_id" IS NULL AND NEW."error_code" IS NOT NULL AND NEW."sent_at" IS NULL)
	OR (OLD."status"='sending' AND NEW."status"='sent'
		AND NEW."attempt_count"=OLD."attempt_count"
		AND NEW."provider_message_id" IS NOT NULL AND NEW."error_code" IS NULL AND NEW."sent_at" IS NOT NULL)
	OR (OLD."status" IN ('pending','sending','retrying') AND NEW."status"='cancelled'
		AND NEW."attempt_count"=OLD."attempt_count"
		AND NEW."provider_message_id" IS NULL AND NEW."sent_at" IS NULL)
) THEN
RAISE EXCEPTION USING MESSAGE = 'TASK_REMINDER_EMAIL_TRANSITION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "task_reminder_email_jobs_transition_guard" BEFORE UPDATE ON "task_reminder_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_ed6a07ec9eb848e788651810();

-- task_reminder_email_jobs_sent_guard
CREATE FUNCTION guard_756e1546b1bacd9039ee92c2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"='sent' AND NOT EXISTS (
	SELECT 1 FROM "task_reminders" reminder
	JOIN "tasks" task ON task."id"=reminder."task_id"
	JOIN "cases" legal_case ON legal_case."id"=task."case_id" AND legal_case."workspace_id"=task."workspace_id"
	JOIN "workspace_members" member ON member."workspace_id"=task."workspace_id" AND member."user_id"=task."owner_user_id"
	WHERE reminder."id"=NEW."reminder_id"
		AND reminder."channel"='email'
		AND reminder."status"='pending'
		AND reminder."updated_at"=NEW."reminder_updated_at"
		AND task."workspace_id"=NEW."workspace_id"
		AND task."owner_user_id"=NEW."user_id"
		AND task."status" NOT IN ('completed','cancelled')
		AND legal_case."archived_at" IS NULL
		AND member."status"='active'
) THEN
RAISE EXCEPTION USING MESSAGE = 'TASK_REMINDER_EMAIL_SOURCE_STALE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "task_reminder_email_jobs_sent_guard" BEFORE UPDATE ON "task_reminder_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_756e1546b1bacd9039ee92c2();

-- staging_email_delivery_probe_identity_immutable
CREATE FUNCTION guard_29d863af97db469b981ae861() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."probe_key" IS DISTINCT FROM OLD."probe_key"
	OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'STAGING_EMAIL_DELIVERY_PROBE_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "staging_email_delivery_probe_identity_immutable" BEFORE UPDATE ON "staging_email_delivery_probes"
FOR EACH ROW EXECUTE FUNCTION guard_29d863af97db469b981ae861();

-- staging_email_delivery_probe_transition_guard
CREATE FUNCTION guard_0553a43f85d9f8aab54574c3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
	(OLD."status" IN ('pending','retrying') AND NEW."status"='sending'
		AND NEW."attempt_count"=OLD."attempt_count"+1
		AND NEW."provider_message_id" IS NULL AND NEW."error_code" IS NULL AND NEW."sent_at" IS NULL)
	OR (OLD."status"='sending' AND NEW."status"='retrying'
		AND NEW."attempt_count"=OLD."attempt_count"
		AND NEW."provider_message_id" IS NULL AND NEW."error_code" IS NOT NULL AND NEW."sent_at" IS NULL)
	OR (OLD."status"='sending' AND NEW."status"='failed'
		AND NEW."attempt_count"=OLD."attempt_count"
		AND NEW."provider_message_id" IS NULL AND NEW."error_code" IS NOT NULL AND NEW."sent_at" IS NULL)
	OR (OLD."status"='sending' AND NEW."status"='sent'
		AND NEW."attempt_count"=OLD."attempt_count"
		AND NEW."provider_message_id" IS NOT NULL AND NEW."error_code" IS NULL AND NEW."sent_at" IS NOT NULL)
) THEN
RAISE EXCEPTION USING MESSAGE = 'STAGING_EMAIL_DELIVERY_PROBE_TRANSITION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "staging_email_delivery_probe_transition_guard" BEFORE UPDATE ON "staging_email_delivery_probes"
FOR EACH ROW EXECUTE FUNCTION guard_0553a43f85d9f8aab54574c3();

-- analysis_version_object_writes_insert_guard
CREATE FUNCTION guard_58cc8fd680e79434a8028bbe() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status" <> 'pending'
  OR NEW."version_id" IS NOT NULL
  OR NEW."attempt_count" <> 0
  OR NEW."last_error_code" IS NOT NULL
  OR NEW."reconciled_at" IS NOT NULL
  OR NEW."r2_key" <>
    'analysis-versions/' || NEW."workspace_id" || '/' || NEW."analysis_id" || '/' ||
    NEW."id" || '-' || NEW."target_version" || '-' || NEW."sha256" || '.md'
  OR NOT EXISTS (
    SELECT 1 FROM "document_analyses" analysis
    WHERE analysis."id" = NEW."analysis_id"
      AND analysis."workspace_id" = NEW."workspace_id"
      AND analysis."owner_user_id" = NEW."owner_user_id"
      AND analysis."status" IN ('processing','persisting','completed')
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'analysis_version_object_write_source_mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_version_object_writes_insert_guard" BEFORE INSERT ON "analysis_version_object_writes"
FOR EACH ROW EXECUTE FUNCTION guard_58cc8fd680e79434a8028bbe();

-- user_document_index_jobs_source_guard
CREATE FUNCTION guard_9639949c47e507747ea60f0c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "analysis_document_versions" version
  JOIN "document_analyses" analysis ON analysis."id"=version."analysis_id"
  WHERE version."id"=NEW."document_version_id"
    AND version."analysis_id"=NEW."analysis_id"
    AND version."workspace_id"=NEW."workspace_id"
    AND version."owner_user_id"=NEW."owner_user_id"
    AND version."sha256"=NEW."source_hash"
    AND analysis."workspace_id"=NEW."workspace_id"
    AND analysis."owner_user_id"=NEW."owner_user_id"
    AND analysis."status" IN ('persisting','completed')
) THEN
RAISE EXCEPTION USING MESSAGE = 'user document index source unavailable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_document_index_jobs_source_guard" BEFORE INSERT ON "user_document_index_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_9639949c47e507747ea60f0c();

-- operational_job_redrive_actor_guard
CREATE FUNCTION guard_fb38bb4e0f4e5ad4e1b95db5() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=NEW."actor_user_id") THEN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_JOB_REDRIVE_ACTOR_UNAVAILABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "operational_job_redrive_actor_guard" BEFORE INSERT ON "operational_job_redrive_events"
FOR EACH ROW EXECUTE FUNCTION guard_fb38bb4e0f4e5ad4e1b95db5();

-- operational_job_redrive_sequence_guard
CREATE FUNCTION guard_4cf62b8b8cf7c17a8ff17a72() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."version" <> COALESCE((SELECT MAX("version") + 1 FROM "operational_job_redrive_events" WHERE "source_job_id"=NEW."source_job_id"), 1) OR COALESCE(NEW."previous_event_hash",'') <> COALESCE((SELECT "event_hash" FROM "operational_job_redrive_events" WHERE "source_job_id"=NEW."source_job_id" ORDER BY "version" DESC LIMIT 1),'') THEN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_JOB_REDRIVE_SEQUENCE_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "operational_job_redrive_sequence_guard" BEFORE INSERT ON "operational_job_redrive_events"
FOR EACH ROW EXECUTE FUNCTION guard_4cf62b8b8cf7c17a8ff17a72();

-- operational_job_redrive_apply
CREATE FUNCTION guard_8b3750913cf20c25e62f05da() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
UPDATE "job_runs" SET "status"='retrying',"lease_owner"=NULL,"lease_expires_at"=NULL,"next_attempt_at"=NEW."created_at","finished_at"=NULL,"updated_at"=NEW."created_at" WHERE "id"=NEW."source_job_id";
UPDATE "job_outbox" SET "status"='pending',"available_at"=NEW."created_at","lease_owner"=NULL,"lease_expires_at"=NULL,"next_attempt_at"=NULL,"dispatched_at"=NULL,"error_code"=NULL,"updated_at"=NEW."created_at" WHERE "id"=NEW."outbox_id";
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "operational_job_redrive_apply" AFTER INSERT ON "operational_job_redrive_events"
FOR EACH ROW EXECUTE FUNCTION guard_8b3750913cf20c25e62f05da();

-- operational_job_redrive_no_update
CREATE FUNCTION guard_96f6a42df10e0367d2cdd22f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_JOB_REDRIVE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "operational_job_redrive_no_update" BEFORE UPDATE ON "operational_job_redrive_events"
FOR EACH ROW EXECUTE FUNCTION guard_96f6a42df10e0367d2cdd22f();

-- operational_job_redrive_no_delete
CREATE FUNCTION guard_e9db3a852e245f29004f4438() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_JOB_REDRIVE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "operational_job_redrive_no_delete" BEFORE DELETE ON "operational_job_redrive_events"
FOR EACH ROW EXECUTE FUNCTION guard_e9db3a852e245f29004f4438();

-- document_analyses_completed_result_guard
CREATE FUNCTION guard_2f925d5e798e9be80a97a6e9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"='completed' AND (
		NEW."summary_json" IS NULL OR json_valid(NEW."summary_json") <> true
		OR NEW."error_code" IS NOT NULL
		OR NEW."result_sha256" IS NULL
		OR length(NEW."result_sha256")<>64
		OR NEW."result_sha256" ~ '^.*[^0-9a-f].*$'
	) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_COMPLETED_RESULT_INVALID', ERRCODE = '23514';
END IF;
IF OLD."status"='completed' AND (
		NEW."status"<>OLD."status"
		OR NEW."summary_json"<>OLD."summary_json"
		OR coalesce(NEW."error_code",'')<>coalesce(OLD."error_code",'')
		OR coalesce(NEW."result_sha256",'')<>coalesce(OLD."result_sha256",'')
	) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_COMPLETED_RESULT_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_analyses_completed_result_guard" BEFORE UPDATE OF "status","summary_json","error_code","result_sha256" ON "document_analyses"
FOR EACH ROW EXECUTE FUNCTION guard_2f925d5e798e9be80a97a6e9();

-- case_lifecycle_insert_guard
CREATE FUNCTION guard_faedba256a3b92b85d44cd53() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
		SELECT 1 FROM "cases" AS c
		JOIN "workspace_members" AS member
		  ON member."workspace_id"=c."workspace_id"
		 AND member."user_id"=NEW."actor_user_id"
		 AND member."status"='active'
		WHERE c."id"=NEW."case_id"
		  AND c."workspace_id"=NEW."workspace_id"
		  AND c."status"=NEW."from_status"
		  AND coalesce(c."archived_at",'')=coalesce(NEW."from_archived_at",'')
		  AND NEW."lifecycle_revision"=c."lifecycle_revision"+1
	)
	OR NEW."unresolved_task_count"<>(
		SELECT count(*) FROM "tasks"
		WHERE "case_id"=NEW."case_id" AND "status" NOT IN ('completed','cancelled')
	)
	OR NEW."unresolved_plan_step_count"<>(
		SELECT count(*) FROM "action_plan_steps" AS step
		JOIN "action_plans" AS plan ON plan."id"=step."plan_id"
		WHERE plan."case_id"=NEW."case_id" AND step."status" NOT IN ('completed','cancelled')
	)
	OR (
		NEW."lifecycle_revision"=1
		AND NEW."previous_hash"<>'0000000000000000000000000000000000000000000000000000000000000000'
	)
	OR (
		NEW."lifecycle_revision">1
		AND NOT EXISTS (
			SELECT 1 FROM "case_lifecycle_events" AS parent
			WHERE parent."case_id"=NEW."case_id"
			  AND parent."lifecycle_revision"=NEW."lifecycle_revision"-1
			  AND parent."event_hash"=NEW."previous_hash"
		)
	)
	OR NOT (
		(NEW."action"='complete' AND NEW."from_status" NOT IN ('completed','archived')
		 AND NEW."from_archived_at" IS NULL AND NEW."to_status"='completed' AND NEW."to_archived_at" IS NULL)
		OR (NEW."action"='reopen' AND NEW."from_status"='completed'
		 AND NEW."from_archived_at" IS NULL AND NEW."to_status"='open' AND NEW."to_archived_at" IS NULL)
		OR (NEW."action"='archive' AND NEW."from_status"='completed'
		 AND NEW."from_archived_at" IS NULL AND NEW."to_status"='archived' AND NEW."to_archived_at"=NEW."created_at")
		OR (NEW."action"='restore' AND NEW."from_status"='archived'
		 AND NEW."from_archived_at" IS NOT NULL AND NEW."to_status"='completed' AND NEW."to_archived_at" IS NULL)
	) THEN
RAISE EXCEPTION USING MESSAGE = 'CASE_LIFECYCLE_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "case_lifecycle_insert_guard" BEFORE INSERT ON "case_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_faedba256a3b92b85d44cd53();

-- case_lifecycle_apply_projection
CREATE FUNCTION guard_50a604040aa941126333ae3e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
UPDATE "cases"
	SET "status"=NEW."to_status",
		"archived_at"=NEW."to_archived_at",
		"completed_at"=CASE
			WHEN NEW."action"='complete' THEN NEW."created_at"
			WHEN NEW."action"='reopen' THEN NULL
			ELSE "completed_at"
		END,
		"completed_by_user_id"=CASE
			WHEN NEW."action"='complete' THEN NEW."actor_user_id"
			WHEN NEW."action"='reopen' THEN NULL
			ELSE "completed_by_user_id"
		END,
		"archived_by_user_id"=CASE WHEN NEW."action"='archive' THEN NEW."actor_user_id" ELSE NULL END,
		"lifecycle_revision"=NEW."lifecycle_revision",
		"current_revision"="current_revision"+1,
		"updated_at"=NEW."created_at"
	WHERE "id"=NEW."case_id" AND "workspace_id"=NEW."workspace_id";
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "case_lifecycle_apply_projection" AFTER INSERT ON "case_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_50a604040aa941126333ae3e();

-- case_lifecycle_events_no_update
CREATE FUNCTION guard_4f9b4703f01b0ea7288dc217() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'CASE_LIFECYCLE_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "case_lifecycle_events_no_update" BEFORE UPDATE ON "case_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_4f9b4703f01b0ea7288dc217();

-- case_lifecycle_events_no_delete
CREATE FUNCTION guard_e5856db55d126170ac991002() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'CASE_LIFECYCLE_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "case_lifecycle_events_no_delete" BEFORE DELETE ON "case_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_e5856db55d126170ac991002();

-- builder_document_versions_insert_guard
CREATE FUNCTION guard_7ddd12847ff4f3ea727667c9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"<>'pending' OR NEW."attempt_count"<>0 OR NEW."last_error_code" IS NOT NULL
	OR NOT EXISTS (SELECT 1 FROM "workspace_members" member WHERE member."workspace_id"=NEW."workspace_id" AND member."user_id"=NEW."owner_user_id" AND member."status"='active')
	OR NOT EXISTS (SELECT 1 FROM "documents" document JOIN "document_answers" answers ON answers."document_id"=document."id" JOIN "document_current_content" content ON content."document_id"=document."id" WHERE document."id"=NEW."document_id" AND document."workspace_id"=NEW."workspace_id" AND document."owner_user_id"=NEW."owner_user_id" AND document."revision"=NEW."document_revision" AND document."archived_at" IS NULL) THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_DOCUMENT_VERSION_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_versions_insert_guard" BEFORE INSERT ON "builder_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_7ddd12847ff4f3ea727667c9();

-- builder_document_versions_identity_immutable
CREATE FUNCTION guard_847c9e9afd1b68f620d12581() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id" OR NEW."document_id" IS DISTINCT FROM OLD."document_id" OR NEW."version"<>OLD."version" OR NEW."document_revision"<>OLD."document_revision" OR NEW."source" IS DISTINCT FROM OLD."source" OR NEW."r2_key" IS DISTINCT FROM OLD."r2_key" OR NEW."size_bytes"<>OLD."size_bytes" OR NEW."sha256" IS DISTINCT FROM OLD."sha256" OR NEW."idempotency_key_sha256" IS DISTINCT FROM OLD."idempotency_key_sha256" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_DOCUMENT_VERSION_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_versions_identity_immutable" BEFORE UPDATE ON "builder_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_847c9e9afd1b68f620d12581();

-- builder_document_versions_transition_guard
CREATE FUNCTION guard_9fef88612439cbe86358da94() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT ((OLD."status"='pending' AND NEW."status"='pending' AND NEW."attempt_count"=OLD."attempt_count"+1 AND NEW."last_error_code" IS NOT NULL) OR (OLD."status"='pending' AND NEW."status"='ready' AND NEW."attempt_count"=OLD."attempt_count" AND NEW."last_error_code" IS NULL)) THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_DOCUMENT_VERSION_TRANSITION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_versions_transition_guard" BEFORE UPDATE ON "builder_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_9fef88612439cbe86358da94();

-- builder_document_version_restore_insert_guard
CREATE FUNCTION guard_26202bf07c40c4ae2a5aa376() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (SELECT 1 FROM "workspace_members" member WHERE member."workspace_id"=NEW."workspace_id" AND member."user_id"=NEW."owner_user_id" AND member."status"='active')
	OR NOT EXISTS (SELECT 1 FROM "documents" document WHERE document."id"=NEW."document_id" AND document."workspace_id"=NEW."workspace_id" AND document."owner_user_id"=NEW."owner_user_id" AND document."revision"=NEW."from_revision" AND document."archived_at" IS NULL)
	OR NOT EXISTS (SELECT 1 FROM "builder_document_versions" version WHERE version."id"=NEW."source_version_id" AND version."workspace_id"=NEW."workspace_id" AND version."owner_user_id"=NEW."owner_user_id" AND version."document_id"=NEW."document_id" AND version."sha256"=NEW."content_sha256" AND version."status"='ready') THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_DOCUMENT_RESTORE_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_version_restore_insert_guard" BEFORE INSERT ON "builder_document_version_restore_events"
FOR EACH ROW EXECUTE FUNCTION guard_26202bf07c40c4ae2a5aa376();

-- builder_document_version_restore_immutable_update
CREATE FUNCTION guard_3473487bf0705b6ab1642870() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_DOCUMENT_RESTORE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_version_restore_immutable_update" BEFORE UPDATE ON "builder_document_version_restore_events"
FOR EACH ROW EXECUTE FUNCTION guard_3473487bf0705b6ab1642870();

-- builder_version_writes_identity_guard
CREATE FUNCTION guard_e872bda6ab927cef74153bf3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id" OR NEW."owner_user_id" IS DISTINCT FROM OLD."owner_user_id" OR NEW."document_id" IS DISTINCT FROM OLD."document_id" OR NEW."target_version"<>OLD."target_version" OR NEW."source_revision"<>OLD."source_revision" OR NEW."target_revision"<>OLD."target_revision" OR NEW."source" IS DISTINCT FROM OLD."source" OR NEW."source_entity_id" IS DISTINCT FROM OLD."source_entity_id" OR NEW."r2_key" IS DISTINCT FROM OLD."r2_key" OR NEW."size_bytes"<>OLD."size_bytes" OR NEW."sha256" IS DISTINCT FROM OLD."sha256" OR NEW."idempotency_key_sha256" IS DISTINCT FROM OLD."idempotency_key_sha256" OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_VERSION_WRITE_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_version_writes_identity_guard" BEFORE UPDATE ON "builder_document_version_object_writes"
FOR EACH ROW EXECUTE FUNCTION guard_e872bda6ab927cef74153bf3();

-- builder_version_writes_transition_guard
CREATE FUNCTION guard_9bf2a1a846761e36dc795a43() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT ((OLD."status"='pending' AND NEW."status"='pending' AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NULL AND NEW."attempt_count"=OLD."attempt_count"+1 AND NEW."last_error_code" IS NOT NULL) OR (OLD."status"='pending' AND NEW."status"='attaching' AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NULL AND NEW."attempt_count"=OLD."attempt_count" AND NEW."last_error_code" IS NULL) OR (OLD."status" IN ('pending','attaching') AND NEW."status"='deleting' AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NULL AND NEW."attempt_count"=OLD."attempt_count"+1 AND NEW."last_error_code" IS NULL) OR (OLD."status" IN ('attaching','deleting') AND NEW."status"='attached' AND NEW."version_id" IS NOT NULL AND NEW."reconciled_at" IS NOT NULL AND NEW."attempt_count"=OLD."attempt_count" AND NEW."last_error_code" IS NULL) OR (OLD."status"='deleting' AND NEW."status"='deleted' AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NOT NULL AND NEW."attempt_count"=OLD."attempt_count" AND NEW."last_error_code" IS NULL) OR (OLD."status"='deleting' AND NEW."status"='pending' AND NEW."version_id" IS NULL AND NEW."reconciled_at" IS NULL AND NEW."attempt_count"=OLD."attempt_count" AND NEW."last_error_code" IS NOT NULL)) THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_VERSION_WRITE_TRANSITION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_version_writes_transition_guard" BEFORE UPDATE ON "builder_document_version_object_writes"
FOR EACH ROW EXECUTE FUNCTION guard_9bf2a1a846761e36dc795a43();

-- builder_document_versions_projected_write_required
CREATE FUNCTION guard_26dd20189c5ae759150d2bbe() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."source" IN ('suggestion','analysis_correction') AND NEW."object_write_id" IS NULL THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_VERSION_WRITE_REQUIRED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_versions_projected_write_required" BEFORE INSERT ON "builder_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_26dd20189c5ae759150d2bbe();

-- builder_document_versions_object_write_guard
CREATE FUNCTION guard_1b4c0697fcc01160078fddf6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."object_write_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "builder_document_version_object_writes" write WHERE write."id"=NEW."object_write_id" AND write."workspace_id"=NEW."workspace_id" AND write."owner_user_id"=NEW."owner_user_id" AND write."document_id"=NEW."document_id" AND write."target_version"=NEW."version" AND write."target_revision"=NEW."document_revision" AND write."source"=NEW."source" AND write."r2_key"=NEW."r2_key" AND write."size_bytes"=NEW."size_bytes" AND write."sha256"=NEW."sha256" AND write."idempotency_key_sha256"=NEW."idempotency_key_sha256" AND write."status"='attaching') THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_VERSION_WRITE_MISMATCH', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_versions_object_write_guard" BEFORE INSERT ON "builder_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_1b4c0697fcc01160078fddf6();

-- builder_document_versions_object_write_attach
CREATE FUNCTION guard_1f4daba878b2e687553dc30c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"='ready' AND NEW."object_write_id" IS NOT NULL THEN
UPDATE "builder_document_version_object_writes" SET "status"='attached',"version_id"=NEW."id","last_error_code"=NULL,"updated_at"=NEW."updated_at","reconciled_at"=NEW."updated_at" WHERE "id"=NEW."object_write_id" AND "status"='attaching';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_versions_object_write_attach" AFTER UPDATE OF "status" ON "builder_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_1f4daba878b2e687553dc30c();

-- builder_version_writes_attachment_guard
CREATE FUNCTION guard_7cedc8840ff6de753c68f476() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"='attached' AND (NOT EXISTS (SELECT 1 FROM "builder_document_versions" version WHERE version."id"=NEW."version_id" AND version."object_write_id"=NEW."id" AND version."workspace_id"=NEW."workspace_id" AND version."owner_user_id"=NEW."owner_user_id" AND version."document_id"=NEW."document_id" AND version."version"=NEW."target_version" AND version."document_revision"=NEW."target_revision" AND version."source"=NEW."source" AND version."r2_key"=NEW."r2_key" AND version."size_bytes"=NEW."size_bytes" AND version."sha256"=NEW."sha256" AND version."status"='ready') OR NOT EXISTS (SELECT 1 FROM "documents" document WHERE document."id"=NEW."document_id" AND document."workspace_id"=NEW."workspace_id" AND document."owner_user_id"=NEW."owner_user_id" AND document."revision"=NEW."target_revision") OR (NEW."source"='suggestion' AND NOT EXISTS (SELECT 1 FROM "document_change_proposals" proposal WHERE proposal."id"=NEW."source_entity_id" AND proposal."document_id"=NEW."document_id" AND proposal."status"='applied' AND proposal."owner_accepted"=1 AND proposal."collaborator_accepted"=1)) OR (NEW."source"='analysis_correction' AND NOT EXISTS (SELECT 1 FROM "analysis_document_versions" version WHERE version."id"=NEW."source_entity_id" AND version."workspace_id"=NEW."workspace_id" AND version."owner_user_id"=NEW."owner_user_id" AND version."source_kind"='corrected'))) THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_VERSION_WRITE_ATTACHMENT_MISMATCH', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_version_writes_attachment_guard" BEFORE UPDATE ON "builder_document_version_object_writes"
FOR EACH ROW EXECUTE FUNCTION guard_7cedc8840ff6de753c68f476();

-- builder_document_versions_object_write_immutable
CREATE FUNCTION guard_ced4eae616a3fbad696ae490() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_VERSION_WRITE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_document_versions_object_write_immutable" BEFORE UPDATE OF "object_write_id" ON "builder_document_versions"
FOR EACH ROW EXECUTE FUNCTION guard_ced4eae616a3fbad696ae490();

-- admin_domain_audit_events_no_update
CREATE FUNCTION guard_91de3d1fdf4273e325c4707c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'admin domain audit events are append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "admin_domain_audit_events_no_update" BEFORE UPDATE ON "admin_domain_audit_events"
FOR EACH ROW EXECUTE FUNCTION guard_91de3d1fdf4273e325c4707c();

-- admin_domain_audit_events_no_delete
CREATE FUNCTION guard_bf7b885582520262266ba44f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'admin domain audit events are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "admin_domain_audit_events_no_delete" BEFORE DELETE ON "admin_domain_audit_events"
FOR EACH ROW EXECUTE FUNCTION guard_bf7b885582520262266ba44f();

-- lawyer_profile_lifecycle_events_append_only_update
CREATE FUNCTION guard_3a21ef2c86826f2decc64ad5() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile lifecycle events are append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_lifecycle_events_append_only_update" BEFORE UPDATE ON "lawyer_profile_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_3a21ef2c86826f2decc64ad5();

-- lawyer_profile_lifecycle_events_append_only_delete
CREATE FUNCTION guard_4c6094d5b68a6f525daabd5f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile lifecycle events are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_lifecycle_events_append_only_delete" BEFORE DELETE ON "lawyer_profile_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_4c6094d5b68a6f525daabd5f();

-- lawyer_profile_lifecycle_event_state_guard
CREATE FUNCTION guard_48234750605a6a463e1436c7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "lawyer_profiles" p
  WHERE p."id"=NEW."lawyer_profile_id"
    AND p."profile_revision"=NEW."from_profile_revision"
    AND p."status"=NEW."from_profile_status"
    AND p."marketplace_status"=NEW."from_marketplace_status"
)
OR (
  NEW."action"='restore'
  AND (
    NEW."from_marketplace_status" NOT IN ('suspended','blocked','archived')
    OR NEW."to_profile_status"<>'pending'
    OR NEW."to_marketplace_status" NOT IN ('profile_incomplete','pending_review')
  )
)
OR (
  NEW."action"='suspend'
  AND (
    NEW."from_marketplace_status" IN ('suspended','blocked','archived')
    OR NEW."to_profile_status"<>'pending'
    OR NEW."to_marketplace_status"<>'suspended'
  )
)
OR (
  NEW."action"='block'
  AND (
    NEW."from_marketplace_status" IN ('suspended','blocked','archived')
    OR NEW."to_profile_status"<>'pending'
    OR NEW."to_marketplace_status"<>'blocked'
  )
)
OR (
  NEW."action"='archive'
  AND (
    NEW."from_marketplace_status" IN ('suspended','blocked','archived')
    OR NEW."to_profile_status"<>'pending'
    OR NEW."to_marketplace_status"<>'archived'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile lifecycle event state invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_lifecycle_event_state_guard" BEFORE INSERT ON "lawyer_profile_lifecycle_events"
FOR EACH ROW EXECUTE FUNCTION guard_48234750605a6a463e1436c7();

-- lawyer_profiles_restricted_marketplace_requires_lifecycle_event
CREATE FUNCTION guard_57f789593b10ca02dff09c50() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
  NEW."marketplace_status" IN ('suspended','blocked','archived')
  OR (
    OLD."marketplace_status" IN ('suspended','blocked','archived')
    AND (
      NEW."marketplace_status"<>OLD."marketplace_status"
      OR NEW."status"<>OLD."status"
      OR NEW."profile_revision"<>OLD."profile_revision"
    )
  )
)
AND NOT EXISTS (
  SELECT 1
  FROM "lawyer_profile_lifecycle_events" e
  WHERE e."lawyer_profile_id"=NEW."id"
    AND e."from_profile_revision"=OLD."profile_revision"
    AND e."to_profile_revision"=NEW."profile_revision"
    AND e."from_profile_status"=OLD."status"
    AND e."to_profile_status"=NEW."status"
    AND e."from_marketplace_status"=OLD."marketplace_status"
    AND e."to_marketplace_status"=NEW."marketplace_status"
) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile lifecycle evidence required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profiles_restricted_marketplace_requires_lifecycle_event" BEFORE UPDATE OF "status","marketplace_status","profile_revision","public_approved_at" ON "lawyer_profiles"
FOR EACH ROW EXECUTE FUNCTION guard_57f789593b10ca02dff09c50();

-- demo_payment_runs_identity_immutable
CREATE FUNCTION guard_2af89ab063aee3bf927e7b66() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'DEMO_PAYMENT_IDENTITY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "demo_payment_runs_identity_immutable" BEFORE UPDATE OF "external_id","workspace_id","user_id","flow_type","provider","is_simulation","amount_minor","currency","installment_count","idempotency_key","created_at" ON "demo_payment_runs"
FOR EACH ROW EXECUTE FUNCTION guard_2af89ab063aee3bf927e7b66();

-- demo_payment_runs_no_delete
CREATE FUNCTION guard_a7392a4afa944e430e671153() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'DEMO_PAYMENT_RUN_APPEND_ONLY', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "demo_payment_runs_no_delete" BEFORE DELETE ON "demo_payment_runs"
FOR EACH ROW EXECUTE FUNCTION guard_a7392a4afa944e430e671153();

-- demo_payment_events_immutable_update
CREATE FUNCTION guard_45c8b72af0e26839c62b8c84() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'DEMO_PAYMENT_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "demo_payment_events_immutable_update" BEFORE UPDATE ON "demo_payment_events"
FOR EACH ROW EXECUTE FUNCTION guard_45c8b72af0e26839c62b8c84();

-- demo_payment_events_immutable_delete
CREATE FUNCTION guard_50ebfc46d79cdc9c61d63e92() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'DEMO_PAYMENT_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "demo_payment_events_immutable_delete" BEFORE DELETE ON "demo_payment_events"
FOR EACH ROW EXECUTE FUNCTION guard_50ebfc46d79cdc9c61d63e92();

-- dependency_health_checks_no_update
CREATE FUNCTION guard_6a407e832623006c98069b94() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'DEPENDENCY_HEALTH_CHECK_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "dependency_health_checks_no_update" BEFORE UPDATE ON "dependency_health_checks"
FOR EACH ROW EXECUTE FUNCTION guard_6a407e832623006c98069b94();

-- dependency_health_checks_no_delete
CREATE FUNCTION guard_fd86a15e5c2a2b89161e47d2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'DEPENDENCY_HEALTH_CHECK_APPEND_ONLY', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "dependency_health_checks_no_delete" BEFORE DELETE ON "dependency_health_checks"
FOR EACH ROW EXECUTE FUNCTION guard_fd86a15e5c2a2b89161e47d2();

-- ai_slo_telemetry_no_update
CREATE FUNCTION guard_6a8ff21a6c76e6f9ef9e064b() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_SLO_TELEMETRY_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_slo_telemetry_no_update" BEFORE UPDATE ON "ai_slo_telemetry_events"
FOR EACH ROW EXECUTE FUNCTION guard_6a8ff21a6c76e6f9ef9e064b();

-- ai_slo_telemetry_no_delete
CREATE FUNCTION guard_62d1915e4b86dcb2f6976a2c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_SLO_TELEMETRY_APPEND_ONLY', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ai_slo_telemetry_no_delete" BEFORE DELETE ON "ai_slo_telemetry_events"
FOR EACH ROW EXECUTE FUNCTION guard_62d1915e4b86dcb2f6976a2c();

-- operational_job_redrive_projection_guard
CREATE FUNCTION guard_50a6e987811873fea5386f5e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "job_runs" AS j
  JOIN "job_outbox" AS o
    ON o."id"=NEW."outbox_id"
   AND o."idempotency_key"=j."idempotency_key"
  WHERE j."id"=NEW."source_job_id"
    AND j."queue_name" LIKE NEW."environment" || '-%'
    AND j."status"=NEW."previous_job_status"
    AND o."status"=NEW."previous_outbox_status"
    AND j."job_type"=o."job_type"
    AND j."subject_id"=o."subject_id"
    AND COALESCE(j."workspace_id",'')=COALESCE(o."workspace_id",'')
    AND j."correlation_id"=o."correlation_id"
    AND COALESCE(j."error_code",'')=COALESCE(NEW."previous_error_code",'')
    AND j."attempt"=NEW."previous_attempt"
    AND COALESCE(o."dispatched_at",'')=COALESCE(NEW."previous_dispatched_at",'')
    AND (j."lease_expires_at" IS NULL OR j."lease_expires_at"<=NEW."created_at")
    AND (
      j."status"='retrying'
      OR j."error_code" IN (
        'ASYNC_RUNTIME_DISABLED','JOB_SCHEMA_VERSION_MISMATCH','JOB_HANDLER_NOT_ENABLED',
        'JOB_TRANSIENT_FAILURE','JOB_LEASE_LOST',
        'DOCUMENT_ANALYSIS_PROVIDER_UNAVAILABLE','DOCUMENT_ANALYSIS_PERSISTENCE_FAILED',
        'USER_DOCUMENT_INDEX_FAILED','OCR_PROVIDER_UNAVAILABLE','OCR_PERSISTENCE_FAILED',
        'DOCUMENT_EXPORT_NOT_READY','DOCUMENT_EXPORT_OBJECT_FAILED',
        'EMAIL_CONFIGURATION_UNAVAILABLE','EMAIL_PROVIDER_UNAVAILABLE',
        'OPERATIONAL_ALERT_CONFIGURATION_UNAVAILABLE','OPERATIONAL_ALERT_PROVIDER_UNAVAILABLE',
        'LEGAL_SOURCE_SYNC_FAILED','LEGAL_SOURCE_PARSE_FAILED','LEGAL_SOURCE_INDEX_FAILED',
        'NOTIFICATION_PERSISTENCE_FAILED','MALWARE_SCANNER_UNAVAILABLE',
        'MALWARE_SCAN_OBJECT_FAILED','MALWARE_SCAN_PERSISTENCE_FAILED'
      )
    )
) THEN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_JOB_REDRIVE_NOT_ALLOWED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "operational_job_redrive_projection_guard" BEFORE INSERT ON "operational_job_redrive_events"
FOR EACH ROW EXECUTE FUNCTION guard_50a6e987811873fea5386f5e();

-- lawyer_profile_trust_designations_append_only_update
CREATE FUNCTION guard_e53ad7ff30ed62069b18906d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile trust designations are append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_trust_designations_append_only_update" BEFORE UPDATE ON "lawyer_profile_trust_designations"
FOR EACH ROW EXECUTE FUNCTION guard_e53ad7ff30ed62069b18906d();

-- lawyer_profile_trust_designations_append_only_delete
CREATE FUNCTION guard_69483c103384451c18001d84() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile trust designations are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_trust_designations_append_only_delete" BEFORE DELETE ON "lawyer_profile_trust_designations"
FOR EACH ROW EXECUTE FUNCTION guard_69483c103384451c18001d84();

-- staging_legal_eval_attempt_transition_guard
CREATE FUNCTION guard_66262f62b01c10471ec5c952() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status"<>'running'
  OR NEW."status" NOT IN ('completed','failed')
  OR NEW."id"<>OLD."id"
  OR NEW."evaluation_run_id"<>OLD."evaluation_run_id"
  OR NEW."scenario_id"<>OLD."scenario_id"
  OR NEW."attempt_number"<>OLD."attempt_number"
  OR NEW."corpus_version"<>OLD."corpus_version"
  OR NEW."locale"<>OLD."locale"
  OR NEW."account_type"<>OLD."account_type"
  OR NEW."prompt_sha256"<>OLD."prompt_sha256"
  OR NEW."user_id"<>OLD."user_id"
  OR NEW."workspace_id"<>OLD."workspace_id"
  OR NEW."worker_version_id"<>OLD."worker_version_id"
  OR NEW."worker_version_created_at"<>OLD."worker_version_created_at"
  OR NEW."started_at"<>OLD."started_at" THEN
RAISE EXCEPTION USING MESSAGE = 'STAGING_LEGAL_EVALUATION_ATTEMPT_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "staging_legal_eval_attempt_transition_guard" BEFORE UPDATE ON "staging_legal_evaluation_attempts"
FOR EACH ROW EXECUTE FUNCTION guard_66262f62b01c10471ec5c952();

-- staging_legal_eval_attempt_no_delete
CREATE FUNCTION guard_a6a08f91077142b9d60d7fda() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'STAGING_LEGAL_EVALUATION_ATTEMPT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "staging_legal_eval_attempt_no_delete" BEFORE DELETE ON "staging_legal_evaluation_attempts"
FOR EACH ROW EXECUTE FUNCTION guard_a6a08f91077142b9d60d7fda();

-- staging_legal_eval_agent_chain_guard
CREATE FUNCTION guard_a49e69d9536bd0bb780ae327() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
  NOT EXISTS (SELECT 1 FROM "staging_legal_evaluation_agent_reviews" WHERE "reviewer_id"=NEW."reviewer_id")
  AND NEW."previous_hash"<>'0000000000000000000000000000000000000000000000000000000000000000'
) OR (
  EXISTS (SELECT 1 FROM "staging_legal_evaluation_agent_reviews" WHERE "reviewer_id"=NEW."reviewer_id")
  AND NOT EXISTS (
    SELECT 1 FROM "staging_legal_evaluation_agent_reviews" parent
    WHERE parent."reviewer_id"=NEW."reviewer_id"
      AND parent."event_hash"=NEW."previous_hash"
      AND NOT EXISTS (
        SELECT 1 FROM "staging_legal_evaluation_agent_reviews" child
        WHERE child."reviewer_id"=parent."reviewer_id"
          AND child."previous_hash"=parent."event_hash"
      )
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'STAGING_LEGAL_EVALUATION_AGENT_CHAIN_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "staging_legal_eval_agent_chain_guard" BEFORE INSERT ON "staging_legal_evaluation_agent_reviews"
FOR EACH ROW EXECUTE FUNCTION guard_a49e69d9536bd0bb780ae327();

-- staging_legal_eval_agent_attempt_guard
CREATE FUNCTION guard_53c1b79e98bf05a48570cf99() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "staging_legal_evaluation_attempts" attempt
  JOIN "ai_runs" run ON run."id"=attempt."ai_run_id"
  JOIN "conversation_messages" question ON question."id"=run."request_message_id"
  JOIN "conversation_messages" answer ON answer."id"=run."response_message_id"
  WHERE attempt."id"=NEW."attempt_id"
    AND attempt."evaluation_run_id"=NEW."evaluation_run_id"
    AND attempt."scenario_id"=NEW."scenario_id"
    AND attempt."ai_run_id"=NEW."ai_run_id"
    AND attempt."status"='completed'
    AND run."status"='completed'
) THEN
RAISE EXCEPTION USING MESSAGE = 'STAGING_LEGAL_EVALUATION_AGENT_EVIDENCE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "staging_legal_eval_agent_attempt_guard" BEFORE INSERT ON "staging_legal_evaluation_agent_reviews"
FOR EACH ROW EXECUTE FUNCTION guard_53c1b79e98bf05a48570cf99();

-- staging_legal_eval_agent_no_update
CREATE FUNCTION guard_546100109ba358f956801bf4() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'STAGING_LEGAL_EVALUATION_AGENT_REVIEW_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "staging_legal_eval_agent_no_update" BEFORE UPDATE ON "staging_legal_evaluation_agent_reviews"
FOR EACH ROW EXECUTE FUNCTION guard_546100109ba358f956801bf4();

-- staging_legal_eval_agent_no_delete
CREATE FUNCTION guard_816e15ccaf68e6afd0a65970() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'STAGING_LEGAL_EVALUATION_AGENT_REVIEW_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "staging_legal_eval_agent_no_delete" BEFORE DELETE ON "staging_legal_evaluation_agent_reviews"
FOR EACH ROW EXECUTE FUNCTION guard_816e15ccaf68e6afd0a65970();

-- ai_quality_review_chain_guard
CREATE FUNCTION guard_34ece2a3a93c8430c24bb134() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
  NOT EXISTS (SELECT 1 FROM "ai_quality_review_events" WHERE "actor_user_id"=NEW."actor_user_id")
  AND NEW."previous_hash"<>'0000000000000000000000000000000000000000000000000000000000000000'
) OR (
  EXISTS (SELECT 1 FROM "ai_quality_review_events" WHERE "actor_user_id"=NEW."actor_user_id")
  AND NOT EXISTS (
    SELECT 1 FROM "ai_quality_review_events" AS parent
    WHERE parent."actor_user_id"=NEW."actor_user_id" AND parent."event_hash"=NEW."previous_hash"
      AND NOT EXISTS (SELECT 1 FROM "ai_quality_review_events" AS child WHERE child."actor_user_id"=parent."actor_user_id" AND child."previous_hash"=parent."event_hash")
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'AI_QUALITY_REVIEW_CHAIN_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_quality_review_chain_guard" BEFORE INSERT ON "ai_quality_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_34ece2a3a93c8430c24bb134();

-- ai_quality_review_actor_guard
CREATE FUNCTION guard_ace166c689d3dd0ddb59df9d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "auth_sessions" AS session
  JOIN "platform_staff_assignments" AS assignment ON assignment."id"=NEW."actor_assignment_id" AND assignment."user_id"=NEW."actor_user_id"
  LEFT JOIN "auth_devices" AS device ON device."id"=session."device_id"
  WHERE session."id"=NEW."actor_session_id" AND session."user_id"=NEW."actor_user_id"
    AND session."revoked_at" IS NULL AND session."assurance_level"='mfa' AND session."mfa_verified_at"=NEW."actor_mfa_verified_at"
    AND unixepoch(NEW."created_at")-unixepoch(session."mfa_verified_at") BETWEEN 0 AND 900
    AND session."expires_at">NEW."created_at" AND coalesce(session."idle_expires_at",session."expires_at")>NEW."created_at"
    AND (session."device_id" IS NULL OR (device."id" IS NOT NULL AND device."revoked_at" IS NULL))
    AND assignment."role"='legal_reviewer' AND assignment."granted_at"<=NEW."created_at" AND assignment."expires_at">NEW."created_at" AND assignment."revoked_at" IS NULL
    AND EXISTS (SELECT 1 FROM "auth_totp_credentials" AS totp WHERE totp."user_id"=NEW."actor_user_id" AND totp."status"='active' AND totp."verified_at" IS NOT NULL AND totp."verified_at"<=NEW."actor_mfa_verified_at" AND totp."disabled_at" IS NULL)
) THEN
RAISE EXCEPTION USING MESSAGE = 'AI_QUALITY_REVIEW_ACCESS_DENIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_quality_review_actor_guard" BEFORE INSERT ON "ai_quality_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_ace166c689d3dd0ddb59df9d();

-- ai_quality_review_view_guard
CREATE FUNCTION guard_ecea1034f8e6325d5cb8655e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."request_action"='view' AND NOT EXISTS (SELECT 1 FROM "ai_feedback" WHERE "id"=NEW."feedback_id" AND "updated_at"=NEW."feedback_updated_at") THEN
RAISE EXCEPTION USING MESSAGE = 'AI_QUALITY_REVIEW_STALE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_quality_review_view_guard" BEFORE INSERT ON "ai_quality_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_ecea1034f8e6325d5cb8655e();

-- ai_quality_review_resolve_guard
CREATE FUNCTION guard_08ea804da460a1364e310a2a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."request_action"='resolve' AND (
  NOT EXISTS (SELECT 1 FROM "ai_feedback" WHERE "id"=NEW."feedback_id" AND "updated_at"=NEW."feedback_updated_at")
  OR NEW."review_version"<>(SELECT coalesce(max("review_version"),0)+1 FROM "ai_quality_review_events" WHERE "feedback_id"=NEW."feedback_id" AND "request_action"='resolve')
  OR NOT EXISTS (SELECT 1 FROM "ai_quality_review_contents" WHERE "event_id"=NEW."id" AND "feedback_id"=NEW."feedback_id" AND "reviewer_user_id"=NEW."actor_user_id" AND "captured_feedback_updated_at"=NEW."feedback_updated_at")
) THEN
RAISE EXCEPTION USING MESSAGE = 'AI_QUALITY_REVIEW_STALE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_quality_review_resolve_guard" BEFORE INSERT ON "ai_quality_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_08ea804da460a1364e310a2a();

-- ai_quality_review_events_no_update
CREATE FUNCTION guard_4c9252c2a7bfba22fe267a36() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_QUALITY_REVIEW_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_quality_review_events_no_update" BEFORE UPDATE ON "ai_quality_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_4c9252c2a7bfba22fe267a36();

-- ai_quality_review_events_no_delete
CREATE FUNCTION guard_091ba70ca665f11a934c5fa7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_QUALITY_REVIEW_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "ai_quality_review_events_no_delete" BEFORE DELETE ON "ai_quality_review_events"
FOR EACH ROW EXECUTE FUNCTION guard_091ba70ca665f11a934c5fa7();

-- legal_eval_human_chain_guard
CREATE FUNCTION guard_c13726b6ef8f7bac09431989() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (NOT EXISTS (SELECT 1 FROM "legal_evaluation_human_attestations" WHERE "reviewer_user_id"=NEW."reviewer_user_id") AND NEW."previous_hash"<>'0000000000000000000000000000000000000000000000000000000000000000')
  OR (EXISTS (SELECT 1 FROM "legal_evaluation_human_attestations" WHERE "reviewer_user_id"=NEW."reviewer_user_id") AND NOT EXISTS (SELECT 1 FROM "legal_evaluation_human_attestations" parent WHERE parent."reviewer_user_id"=NEW."reviewer_user_id" AND parent."event_hash"=NEW."previous_hash" AND NOT EXISTS (SELECT 1 FROM "legal_evaluation_human_attestations" child WHERE child."reviewer_user_id"=parent."reviewer_user_id" AND child."previous_hash"=parent."event_hash"))) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_CHAIN_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_chain_guard" BEFORE INSERT ON "legal_evaluation_human_attestations"
FOR EACH ROW EXECUTE FUNCTION guard_c13726b6ef8f7bac09431989();

-- legal_eval_human_actor_guard
CREATE FUNCTION guard_6c9ae9c8b409f7b3f0e2b474() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "auth_sessions" session
  JOIN "platform_staff_assignments" assignment ON assignment."id"=NEW."reviewer_assignment_id" AND assignment."user_id"=NEW."reviewer_user_id"
  LEFT JOIN "auth_devices" device ON device."id"=session."device_id"
  WHERE session."id"=NEW."reviewer_session_id" AND session."user_id"=NEW."reviewer_user_id"
    AND session."revoked_at" IS NULL AND session."assurance_level"='mfa' AND session."mfa_verified_at"=NEW."reviewer_mfa_verified_at"
    AND unixepoch(NEW."created_at")-unixepoch(session."mfa_verified_at") BETWEEN 0 AND 900
    AND session."expires_at">NEW."created_at" AND coalesce(session."idle_expires_at",session."expires_at")>NEW."created_at"
    AND (session."device_id" IS NULL OR (device."id" IS NOT NULL AND device."revoked_at" IS NULL))
    AND assignment."role"='legal_reviewer' AND assignment."granted_at"<=NEW."created_at" AND assignment."expires_at">NEW."created_at" AND assignment."revoked_at" IS NULL
    AND EXISTS (SELECT 1 FROM "auth_totp_credentials" totp WHERE totp."user_id"=NEW."reviewer_user_id" AND totp."status"='active' AND totp."verified_at" IS NOT NULL AND totp."verified_at"<=NEW."reviewer_mfa_verified_at" AND totp."disabled_at" IS NULL)
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_ACCESS_DENIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_actor_guard" BEFORE INSERT ON "legal_evaluation_human_attestations"
FOR EACH ROW EXECUTE FUNCTION guard_6c9ae9c8b409f7b3f0e2b474();

-- legal_eval_human_no_update
CREATE FUNCTION guard_2e6303550c7c5e75b93357f9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_no_update" BEFORE UPDATE ON "legal_evaluation_human_attestations"
FOR EACH ROW EXECUTE FUNCTION guard_2e6303550c7c5e75b93357f9();

-- legal_eval_human_no_delete
CREATE FUNCTION guard_b32b83866b70dbe034026da3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_no_delete" BEFORE DELETE ON "legal_evaluation_human_attestations"
FOR EACH ROW EXECUTE FUNCTION guard_b32b83866b70dbe034026da3();

-- legal_eval_human_record_chain_guard
CREATE FUNCTION guard_dd0b10f66244fa21590bec81() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (NOT EXISTS (SELECT 1 FROM "legal_evaluation_human_review_records" WHERE "reviewer_user_id"=NEW."reviewer_user_id")
  AND NEW."previous_hash"<>'0000000000000000000000000000000000000000000000000000000000000000')
  OR (EXISTS (SELECT 1 FROM "legal_evaluation_human_review_records" WHERE "reviewer_user_id"=NEW."reviewer_user_id")
    AND NOT EXISTS (
      SELECT 1 FROM "legal_evaluation_human_review_records" parent
      WHERE parent."reviewer_user_id"=NEW."reviewer_user_id" AND parent."event_hash"=NEW."previous_hash"
        AND NOT EXISTS (
          SELECT 1 FROM "legal_evaluation_human_review_records" child
          WHERE child."reviewer_user_id"=parent."reviewer_user_id" AND child."previous_hash"=parent."event_hash"
        )
    )) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_RECORD_CHAIN_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_record_chain_guard" BEFORE INSERT ON "legal_evaluation_human_review_records"
FOR EACH ROW EXECUTE FUNCTION guard_dd0b10f66244fa21590bec81();

-- legal_eval_human_record_attestation_guard
CREATE FUNCTION guard_64ab25354f3196f33cda2cf3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "legal_evaluation_human_attestations" attestation
  WHERE attestation."id"=NEW."attestation_id"
    AND attestation."evaluation_run_id"=NEW."evaluation_run_id"
    AND attestation."corpus_version"=NEW."corpus_version"
    AND attestation."disposition"='confirmed_correct'
    AND attestation."reviewer_user_id"=NEW."reviewer_user_id"
    AND attestation."scenario_count"=314
    AND attestation."completed_run_count"=314
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_RECORD_ATTESTATION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_record_attestation_guard" BEFORE INSERT ON "legal_evaluation_human_review_records"
FOR EACH ROW EXECUTE FUNCTION guard_64ab25354f3196f33cda2cf3();

-- legal_eval_human_record_attempt_guard
CREATE FUNCTION guard_5405acf92c87b12923180753() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "staging_legal_evaluation_attempts" attempt
  WHERE attempt."id"=NEW."attempt_id"
    AND attempt."evaluation_run_id"=NEW."evaluation_run_id"
    AND attempt."scenario_id"=NEW."scenario_id"
    AND attempt."ai_run_id"=NEW."ai_run_id"
    AND upper(attempt."prompt_sha256")=NEW."prompt_sha256"
    AND upper(attempt."response_sha256")=NEW."response_sha256"
    AND attempt."status"='completed'
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_RECORD_ATTEMPT_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_record_attempt_guard" BEFORE INSERT ON "legal_evaluation_human_review_records"
FOR EACH ROW EXECUTE FUNCTION guard_5405acf92c87b12923180753();

-- legal_eval_human_record_actor_guard
CREATE FUNCTION guard_7d701972f3e5dc29f5c9f062() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "auth_sessions" session
  JOIN "platform_staff_assignments" assignment ON assignment."id"=NEW."reviewer_assignment_id" AND assignment."user_id"=NEW."reviewer_user_id"
  LEFT JOIN "auth_devices" device ON device."id"=session."device_id"
  WHERE session."id"=NEW."reviewer_session_id" AND session."user_id"=NEW."reviewer_user_id"
    AND session."revoked_at" IS NULL AND session."assurance_level"='mfa' AND session."mfa_verified_at"=NEW."reviewer_mfa_verified_at"
    AND unixepoch(NEW."created_at")-unixepoch(session."mfa_verified_at") BETWEEN 0 AND 900
    AND session."expires_at">NEW."created_at" AND coalesce(session."idle_expires_at",session."expires_at")>NEW."created_at"
    AND (session."device_id" IS NULL OR (device."id" IS NOT NULL AND device."revoked_at" IS NULL))
    AND assignment."role"='legal_reviewer' AND assignment."granted_at"<=NEW."created_at" AND assignment."expires_at">NEW."created_at" AND assignment."revoked_at" IS NULL
    AND EXISTS (SELECT 1 FROM "auth_totp_credentials" totp WHERE totp."user_id"=NEW."reviewer_user_id" AND totp."status"='active' AND totp."verified_at" IS NOT NULL AND totp."verified_at"<=NEW."reviewer_mfa_verified_at" AND totp."disabled_at" IS NULL)
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_RECORD_ACCESS_DENIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_record_actor_guard" BEFORE INSERT ON "legal_evaluation_human_review_records"
FOR EACH ROW EXECUTE FUNCTION guard_7d701972f3e5dc29f5c9f062();

-- legal_eval_human_record_no_update
CREATE FUNCTION guard_afae3a16686f88472569aa8d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_RECORD_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_record_no_update" BEFORE UPDATE ON "legal_evaluation_human_review_records"
FOR EACH ROW EXECUTE FUNCTION guard_afae3a16686f88472569aa8d();

-- legal_eval_human_record_no_delete
CREATE FUNCTION guard_7328c9676cbe3507956b412f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_EVALUATION_HUMAN_RECORD_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_eval_human_record_no_delete" BEFORE DELETE ON "legal_evaluation_human_review_records"
FOR EACH ROW EXECUTE FUNCTION guard_7328c9676cbe3507956b412f();

-- legal_corpus_versions_no_delete
CREATE FUNCTION guard_1060e2eaf63d29b0fb2b09dc() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_VERSION_DELETE_FORBIDDEN', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_versions_no_delete" BEFORE DELETE ON "legal_corpus_versions"
FOR EACH ROW EXECUTE FUNCTION guard_1060e2eaf63d29b0fb2b09dc();

-- legal_corpus_admin_events_immutable_guard
CREATE FUNCTION guard_2bcafbe9d97e71420c6a8dab() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_ADMIN_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_admin_events_immutable_guard" BEFORE UPDATE ON "legal_corpus_admin_events"
FOR EACH ROW EXECUTE FUNCTION guard_2bcafbe9d97e71420c6a8dab();

-- legal_corpus_admin_events_no_delete
CREATE FUNCTION guard_a4ff1e32c2becab42d341ac1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_ADMIN_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_admin_events_no_delete" BEFORE DELETE ON "legal_corpus_admin_events"
FOR EACH ROW EXECUTE FUNCTION guard_a4ff1e32c2becab42d341ac1();

-- legal_corpus_owner_publications_insert_guard
CREATE FUNCTION guard_abc143cb28c3d57fe6dfe060() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "document_analyses" analysis
  JOIN "document_files" file ON file.id=analysis.uploaded_file_id
  JOIN "file_extractions" extraction ON extraction.analysis_id=analysis.id
  JOIN "file_scan_results" scan ON scan.id=NEW.scan_result_id
    AND scan.analysis_id=analysis.id AND scan.file_id=file.id
    AND scan.workspace_id=analysis.workspace_id AND scan.owner_user_id=analysis.owner_user_id
  JOIN "platform_staff_assignments" assignment
    ON assignment.id=NEW.actor_assignment_id AND assignment.user_id=NEW.actor_user_id
  JOIN "legal_corpus_documents" document ON document.id=NEW.document_id
  JOIN "legal_corpus_variants" variant ON variant.id=NEW.variant_id AND variant.document_id=document.id
  JOIN "legal_corpus_versions" version ON version.id=NEW.version_id AND version.variant_id=variant.id
  WHERE analysis.id=NEW.analysis_id
    AND analysis.workspace_id=NEW.workspace_id
    AND analysis.owner_user_id=NEW.actor_user_id
    AND analysis.status='completed'
    AND file.id=NEW.file_id
    AND file.workspace_id=NEW.workspace_id
    AND file.owner_user_id=NEW.actor_user_id
    AND file.kind='analysis_safe'
    AND file.archived_at IS NULL
    AND lower(file.sha256)=NEW.source_sha256
    AND scan.verdict='clean'
    AND lower(scan.source_sha256)=NEW.source_sha256
    AND extraction.file_id=file.id
    AND extraction.workspace_id=analysis.workspace_id
    AND extraction.owner_user_id=analysis.owner_user_id
    AND extraction.status='completed'
    AND lower(extraction.text_sha256)=NEW.extraction_sha256
    AND assignment.role='legal_reviewer'
    AND assignment.granted_at<=NEW.created_at
    AND assignment.expires_at>NEW.created_at
    AND assignment.revoked_at IS NULL
    AND julianday(NEW.actor_mfa_verified_at)<=julianday(NEW.created_at)
    AND julianday(NEW.actor_mfa_verified_at)>=julianday(NEW.created_at)-(15.0/1440.0)
    AND document.provider='juro_owner'
    AND document.source_class='OWNER_TRUSTED_GLOBAL'
    AND document.scope='global'
    AND document.visibility='global'
    AND document.trusted=1
    AND document.verification_status='owner_approved'
    AND document.approval_required=0
    AND variant.language=NEW.language
    AND variant.current_version_id=version.id
    AND version.content_sha256=NEW.content_sha256
    AND NEW.rights_confirmed=1
    AND NEW.legal_review_confirmed=1
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_PUBLICATION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_publications_insert_guard" BEFORE INSERT ON "legal_corpus_owner_publications"
FOR EACH ROW EXECUTE FUNCTION guard_abc143cb28c3d57fe6dfe060();

-- legal_corpus_owner_publications_immutable_guard
CREATE FUNCTION guard_d0b3d722a522f7b393bf29b9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_PUBLICATION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_publications_immutable_guard" BEFORE UPDATE ON "legal_corpus_owner_publications"
FOR EACH ROW EXECUTE FUNCTION guard_d0b3d722a522f7b393bf29b9();

-- legal_corpus_owner_publications_no_delete
CREATE FUNCTION guard_b752fd226be7a6d85bda17f7() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_PUBLICATION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_publications_no_delete" BEFORE DELETE ON "legal_corpus_owner_publications"
FOR EACH ROW EXECUTE FUNCTION guard_b752fd226be7a6d85bda17f7();

-- legal_corpus_owner_withdrawals_insert_guard
CREATE FUNCTION guard_8273b7b170abb6e07c1bac8a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "legal_corpus_owner_publications" publication
  JOIN "legal_corpus_documents" document
    ON document.id=publication.document_id AND document.id=NEW.document_id
  JOIN "platform_staff_assignments" assignment
    ON assignment.id=NEW.actor_assignment_id AND assignment.user_id=NEW.actor_user_id
  WHERE publication.id=NEW.publication_id
    AND publication.environment=NEW.environment
    AND publication.actor_user_id=NEW.actor_user_id
    AND assignment.role='legal_reviewer'
    AND assignment.granted_at<=NEW.created_at
    AND assignment.expires_at>NEW.created_at
    AND assignment.revoked_at IS NULL
    AND julianday(NEW.actor_mfa_verified_at)<=julianday(NEW.created_at)
    AND julianday(NEW.actor_mfa_verified_at)>=julianday(NEW.created_at)-(15.0/1440.0)
    AND document.provider='juro_owner'
    AND document.availability_status='ready'
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_WITHDRAWAL_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_withdrawals_insert_guard" BEFORE INSERT ON "legal_corpus_owner_withdrawals"
FOR EACH ROW EXECUTE FUNCTION guard_8273b7b170abb6e07c1bac8a();

-- legal_corpus_owner_withdrawals_apply
CREATE FUNCTION guard_adabbc2cf5a938e5020a5d9d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
UPDATE "legal_corpus_documents"
  SET "availability_status"='disabled',"updated_at"=NEW.created_at
  WHERE "id"=NEW.document_id AND "provider"='juro_owner' AND "availability_status"='ready';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_withdrawals_apply" AFTER INSERT ON "legal_corpus_owner_withdrawals"
FOR EACH ROW EXECUTE FUNCTION guard_adabbc2cf5a938e5020a5d9d();

-- legal_corpus_owner_withdrawals_immutable_guard
CREATE FUNCTION guard_1e15e545c600907852e092d8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_WITHDRAWAL_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_withdrawals_immutable_guard" BEFORE UPDATE ON "legal_corpus_owner_withdrawals"
FOR EACH ROW EXECUTE FUNCTION guard_1e15e545c600907852e092d8();

-- legal_corpus_owner_withdrawals_no_delete
CREATE FUNCTION guard_1a1a01c6cac03d8e49bed9ff() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_WITHDRAWAL_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_withdrawals_no_delete" BEFORE DELETE ON "legal_corpus_owner_withdrawals"
FOR EACH ROW EXECUTE FUNCTION guard_1a1a01c6cac03d8e49bed9ff();

-- legal_corpus_owner_ingestions_immutable_guard
CREATE FUNCTION guard_cfdd283f4e408d49a8f5b5b0() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_INGESTION_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_ingestions_immutable_guard" BEFORE UPDATE ON "legal_corpus_owner_ingestions"
FOR EACH ROW EXECUTE FUNCTION guard_cfdd283f4e408d49a8f5b5b0();

-- legal_corpus_owner_ingestions_no_delete
CREATE FUNCTION guard_9239f86a47fc8b629bb9d1f5() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_INGESTION_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_ingestions_no_delete" BEFORE DELETE ON "legal_corpus_owner_ingestions"
FOR EACH ROW EXECUTE FUNCTION guard_9239f86a47fc8b629bb9d1f5();

-- legal_corpus_owner_ingestion_withdrawals_insert_guard
CREATE FUNCTION guard_2e1173b212f7e4af86f41bfe() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "legal_corpus_owner_ingestions" publication
  JOIN "legal_corpus_documents" document
    ON document.id=publication.document_id AND document.id=NEW.document_id
  JOIN "platform_staff_assignments" assignment
    ON assignment.id=NEW.actor_assignment_id AND assignment.user_id=NEW.actor_user_id
  WHERE publication.id=NEW.publication_id
    AND publication.environment=NEW.environment
    AND publication.actor_user_id=NEW.actor_user_id
    AND assignment.role IN ('administrator','legal_reviewer')
    AND assignment.granted_at<=NEW.created_at
    AND assignment.expires_at>NEW.created_at
    AND assignment.revoked_at IS NULL
    AND julianday(NEW.actor_mfa_verified_at)<=julianday(NEW.created_at)
    AND julianday(NEW.actor_mfa_verified_at)>=julianday(NEW.created_at)-(15.0/1440.0)
    AND document.provider='juro_owner'
    AND document.availability_status='ready'
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_INGESTION_WITHDRAWAL_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_ingestion_withdrawals_insert_guard" BEFORE INSERT ON "legal_corpus_owner_ingestion_withdrawals"
FOR EACH ROW EXECUTE FUNCTION guard_2e1173b212f7e4af86f41bfe();

-- legal_corpus_owner_ingestion_withdrawals_apply
CREATE FUNCTION guard_5f48d00b1b393ce82e518fd2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
UPDATE "legal_corpus_documents"
  SET "availability_status"='disabled',"updated_at"=NEW.created_at
  WHERE "id"=NEW.document_id AND "provider"='juro_owner' AND "availability_status"='ready';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_ingestion_withdrawals_apply" AFTER INSERT ON "legal_corpus_owner_ingestion_withdrawals"
FOR EACH ROW EXECUTE FUNCTION guard_5f48d00b1b393ce82e518fd2();

-- legal_corpus_owner_ingestion_withdrawals_immutable_guard
CREATE FUNCTION guard_aa7fa01f2116ea0dde76036f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_INGESTION_WITHDRAWAL_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_ingestion_withdrawals_immutable_guard" BEFORE UPDATE ON "legal_corpus_owner_ingestion_withdrawals"
FOR EACH ROW EXECUTE FUNCTION guard_aa7fa01f2116ea0dde76036f();

-- legal_corpus_owner_ingestion_withdrawals_no_delete
CREATE FUNCTION guard_6e22e04032831dc6f889f198() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_INGESTION_WITHDRAWAL_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_ingestion_withdrawals_no_delete" BEFORE DELETE ON "legal_corpus_owner_ingestion_withdrawals"
FOR EACH ROW EXECUTE FUNCTION guard_6e22e04032831dc6f889f198();

-- legal_corpus_versions_immutable_guard
CREATE FUNCTION guard_1f9cd1b810fcb7c6d940969f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  OLD."id"=NEW."id"
  AND OLD."variant_id"=NEW."variant_id"
  AND OLD."previous_version_id" IS NOT DISTINCT FROM NEW."previous_version_id"
  AND OLD."version_number"=NEW."version_number"
  AND OLD."status"=NEW."status"
  AND OLD."valid_from" IS NOT DISTINCT FROM NEW."valid_from"
  AND OLD."valid_to" IS NULL
  AND NEW."valid_to" IS NOT NULL
  AND (OLD."valid_from" IS NULL OR NEW."valid_to">=OLD."valid_from")
  AND OLD."version_date" IS NOT DISTINCT FROM NEW."version_date"
  AND OLD."content_sha256"=NEW."content_sha256"
  AND OLD."raw_object_key" IS NOT DISTINCT FROM NEW."raw_object_key"
  AND OLD."normalized_object_key" IS NOT DISTINCT FROM NEW."normalized_object_key"
  AND OLD."source_url" IS NOT DISTINCT FROM NEW."source_url"
  AND OLD."fetched_at"=NEW."fetched_at"
  AND OLD."change_type"=NEW."change_type"
  AND OLD."created_at"=NEW."created_at"
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_VERSION_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_versions_immutable_guard" BEFORE UPDATE ON "legal_corpus_versions"
FOR EACH ROW EXECUTE FUNCTION guard_1f9cd1b810fcb7c6d940969f();

-- legal_corpus_owner_upload_requests_insert_guard
CREATE FUNCTION guard_5bed89063ea08467c2a89227() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "document_analyses" analysis
  JOIN "document_files" file ON file.id=analysis.uploaded_file_id
  JOIN "platform_staff_assignments" assignment
    ON assignment.id=NEW.actor_assignment_id AND assignment.user_id=NEW.actor_user_id
  WHERE analysis.id=NEW.analysis_id
    AND analysis.workspace_id=NEW.workspace_id
    AND analysis.owner_user_id=NEW.actor_user_id
    AND analysis.status='quarantined'
    AND file.id=NEW.file_id
    AND file.workspace_id=NEW.workspace_id
    AND file.owner_user_id=NEW.actor_user_id
    AND file.kind='analysis_quarantined'
    AND file.archived_at IS NULL
    AND lower(file.sha256)=NEW.source_sha256
    AND assignment.role IN ('administrator','legal_reviewer')
    AND assignment.granted_at<=NEW.created_at
    AND assignment.expires_at>NEW.created_at
    AND assignment.revoked_at IS NULL
    AND julianday(NEW.actor_mfa_verified_at)<=julianday(NEW.created_at)
    AND julianday(NEW.actor_mfa_verified_at)>=julianday(NEW.created_at)-(15.0/1440.0)
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_UPLOAD_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_upload_requests_insert_guard" BEFORE INSERT ON "legal_corpus_owner_upload_requests"
FOR EACH ROW EXECUTE FUNCTION guard_5bed89063ea08467c2a89227();

-- legal_corpus_owner_upload_requests_authorization_immutable
CREATE FUNCTION guard_ffd906523607cbcf35bbe2f9() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW.id<>OLD.id OR NEW.environment<>OLD.environment OR NEW.analysis_id<>OLD.analysis_id
  OR NEW.workspace_id<>OLD.workspace_id OR NEW.file_id<>OLD.file_id
  OR NEW.source_sha256<>OLD.source_sha256 OR NEW.title<>OLD.title OR NEW.language<>OLD.language
  OR NEW.rights_confirmed<>OLD.rights_confirmed OR NEW.reason<>OLD.reason
  OR NEW.actor_user_id<>OLD.actor_user_id OR NEW.actor_session_id<>OLD.actor_session_id
  OR NEW.actor_assignment_id<>OLD.actor_assignment_id OR NEW.actor_mfa_verified_at<>OLD.actor_mfa_verified_at
  OR NEW.authorization_hash<>OLD.authorization_hash OR NEW.created_at<>OLD.created_at THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_UPLOAD_AUTHORIZATION_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_upload_requests_authorization_immutable" BEFORE UPDATE ON "legal_corpus_owner_upload_requests"
FOR EACH ROW EXECUTE FUNCTION guard_ffd906523607cbcf35bbe2f9();

-- legal_corpus_owner_upload_requests_no_delete
CREATE FUNCTION guard_07afed12c8ac8039eb75cc6e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_UPLOAD_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_upload_requests_no_delete" BEFORE DELETE ON "legal_corpus_owner_upload_requests"
FOR EACH ROW EXECUTE FUNCTION guard_07afed12c8ac8039eb75cc6e();

-- legal_corpus_owner_ingestions_insert_guard
CREATE FUNCTION guard_31a2c94841b84d6779e5d841() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "document_analyses" analysis
  JOIN "document_files" file ON file.id=analysis.uploaded_file_id
  JOIN "file_extractions" extraction ON extraction.analysis_id=analysis.id
  JOIN "file_scan_results" scan ON scan.id=NEW.scan_result_id
    AND scan.analysis_id=analysis.id AND scan.file_id=file.id
    AND scan.workspace_id=analysis.workspace_id AND scan.owner_user_id=analysis.owner_user_id
  JOIN "platform_staff_assignments" assignment
    ON assignment.id=NEW.actor_assignment_id AND assignment.user_id=NEW.actor_user_id
  JOIN "legal_corpus_documents" document ON document.id=NEW.document_id
  JOIN "legal_corpus_variants" variant ON variant.id=NEW.variant_id AND variant.document_id=document.id
  JOIN "legal_corpus_versions" version ON version.id=NEW.version_id AND version.variant_id=variant.id
  WHERE analysis.id=NEW.analysis_id
    AND analysis.workspace_id=NEW.workspace_id
    AND analysis.owner_user_id=NEW.actor_user_id
    AND analysis.status='completed'
    AND file.id=NEW.file_id
    AND file.workspace_id=NEW.workspace_id
    AND file.owner_user_id=NEW.actor_user_id
    AND file.kind='analysis_safe'
    AND file.archived_at IS NULL
    AND lower(file.sha256)=NEW.source_sha256
    AND scan.verdict='clean'
    AND lower(scan.source_sha256)=NEW.source_sha256
    AND extraction.file_id=file.id
    AND extraction.workspace_id=analysis.workspace_id
    AND extraction.owner_user_id=analysis.owner_user_id
    AND extraction.status='completed'
    AND lower(extraction.text_sha256)=NEW.extraction_sha256
    AND assignment.role IN ('administrator','legal_reviewer')
    AND assignment.granted_at<=NEW.created_at
    AND assignment.expires_at>NEW.created_at
    AND assignment.revoked_at IS NULL
    AND (
      (
        julianday(NEW.actor_mfa_verified_at)<=julianday(NEW.created_at)
        AND julianday(NEW.actor_mfa_verified_at)>=julianday(NEW.created_at)-(15.0/1440.0)
      )
      OR EXISTS (
        SELECT 1 FROM "legal_corpus_owner_upload_requests" request
        WHERE request.analysis_id=NEW.analysis_id
          AND request.workspace_id=NEW.workspace_id
          AND request.file_id=NEW.file_id
          AND request.source_sha256=NEW.source_sha256
          AND request.language=NEW.language
          AND request.reason=NEW.reason
          AND request.actor_user_id=NEW.actor_user_id
          AND request.actor_session_id=NEW.actor_session_id
          AND request.actor_assignment_id=NEW.actor_assignment_id
          AND request.actor_mfa_verified_at=NEW.actor_mfa_verified_at
          AND request.environment=NEW.environment
          AND request.rights_confirmed=1
          AND request.status='scan_queued'
          AND julianday(request.created_at)<=julianday(NEW.created_at)
      )
    )
    AND document.provider='juro_owner'
    AND document.source_class='OWNER_TRUSTED_GLOBAL'
    AND document.scope='global'
    AND document.visibility='global'
    AND document.trusted=1
    AND document.verification_status='owner_approved'
    AND document.approval_required=0
    AND variant.language=NEW.language
    AND variant.current_version_id=version.id
    AND version.content_sha256=NEW.content_sha256
    AND NEW.rights_confirmed=1
    AND NEW.trust_mode='technical_auto_trust'
) THEN
RAISE EXCEPTION USING MESSAGE = 'LEGAL_CORPUS_OWNER_INGESTION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "legal_corpus_owner_ingestions_insert_guard" BEFORE INSERT ON "legal_corpus_owner_ingestions"
FOR EACH ROW EXECUTE FUNCTION guard_31a2c94841b84d6779e5d841();

-- lawyer_task_comments_no_update
CREATE FUNCTION guard_23ed3f64a83b75537ce87e0d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer task comments are immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_task_comments_no_update" BEFORE UPDATE ON "lawyer_task_comments"
FOR EACH ROW EXECUTE FUNCTION guard_23ed3f64a83b75537ce87e0d();

-- lawyer_task_comments_no_delete
CREATE FUNCTION guard_4ca245988c95e2c3d91d5e9f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer task comments are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_task_comments_no_delete" BEFORE DELETE ON "lawyer_task_comments"
FOR EACH ROW EXECUTE FUNCTION guard_4ca245988c95e2c3d91d5e9f();

-- lawyer_document_requests_immutable_fields
CREATE FUNCTION guard_4fe668da3b849796ef014d9e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
  OR NEW."lawyer_request_id"<>OLD."lawyer_request_id"
  OR NEW."workspace_id"<>OLD."workspace_id"
  OR NEW."case_id"<>OLD."case_id"
  OR NEW."lawyer_user_id"<>OLD."lawyer_user_id"
  OR NEW."client_user_id"<>OLD."client_user_id"
  OR NEW."title"<>OLD."title"
  OR NEW."description"<>OLD."description"
  OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer document request identity is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_document_requests_immutable_fields" BEFORE UPDATE ON "lawyer_document_requests"
FOR EACH ROW EXECUTE FUNCTION guard_4fe668da3b849796ef014d9e();

-- lawyer_document_requests_terminal_guard
CREATE FUNCTION guard_71f86f81dbd9b404cf7c5997() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status" IN ('provided','cancelled') THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer document request is terminal', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_document_requests_terminal_guard" BEFORE UPDATE ON "lawyer_document_requests"
FOR EACH ROW EXECUTE FUNCTION guard_71f86f81dbd9b404cf7c5997();

-- lawyer_document_requests_no_delete
CREATE FUNCTION guard_1ef181d943e5ceca0c2c0721() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer document requests are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_document_requests_no_delete" BEFORE DELETE ON "lawyer_document_requests"
FOR EACH ROW EXECUTE FUNCTION guard_1ef181d943e5ceca0c2c0721();

-- lawyer_request_messages_content_immutable
CREATE FUNCTION guard_0009a2c5893a631e99a31eaa() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
  OR NEW."lawyer_request_id"<>OLD."lawyer_request_id"
  OR NEW."author_user_id"<>OLD."author_user_id"
  OR NEW."author_role"<>OLD."author_role"
  OR NEW."body"<>OLD."body"
  OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer request message content is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_messages_content_immutable" BEFORE UPDATE ON "lawyer_request_messages"
FOR EACH ROW EXECUTE FUNCTION guard_0009a2c5893a631e99a31eaa();

-- lawyer_request_messages_read_terminal
CREATE FUNCTION guard_0c69b32146ac99b248da8222() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."read_at" IS NOT NULL AND NEW."read_at" IS DISTINCT FROM OLD."read_at" THEN
RAISE EXCEPTION USING MESSAGE = 'read lawyer request message is terminal', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_messages_read_terminal" BEFORE UPDATE ON "lawyer_request_messages"
FOR EACH ROW EXECUTE FUNCTION guard_0c69b32146ac99b248da8222();

-- lawyer_request_message_attachments_scope_guard
CREATE FUNCTION guard_be5558031d6c02474c427e73() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1
  FROM "lawyer_request_messages" m
  JOIN "lawyer_requests" r ON r."id"=m."lawyer_request_id"
  JOIN "lawyer_profiles" p ON p."id"=r."lawyer_profile_id"
  JOIN "documents" d ON d."id"=NEW."document_id"
  LEFT JOIN "user_profiles" lawyer_user ON lawyer_user."id"=p."user_id"
  WHERE m."id"=NEW."message_id"
    AND m."lawyer_request_id"=NEW."lawyer_request_id"
    AND m."author_user_id"=NEW."shared_by_user_id"
    AND (
      (
        NEW."shared_by_user_id"=r."requester_user_id"
        AND NEW."recipient_user_id"=p."user_id"
        AND d."owner_user_id"=r."requester_user_id"
        AND d."workspace_id"=r."workspace_id"
        AND d."case_id"=r."case_id"
      )
      OR
      (
        NEW."shared_by_user_id"=p."user_id"
        AND NEW."recipient_user_id"=r."requester_user_id"
        AND d."owner_user_id"=p."user_id"
        AND d."workspace_id"=lawyer_user."default_workspace_id"
      )
    )
) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer request message attachment scope is invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_message_attachments_scope_guard" BEFORE INSERT ON "lawyer_request_message_attachments"
FOR EACH ROW EXECUTE FUNCTION guard_be5558031d6c02474c427e73();

-- lawyer_request_message_attachments_identity_immutable
CREATE FUNCTION guard_8ad709c64eff148781252a28() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
  OR NEW."message_id"<>OLD."message_id"
  OR NEW."lawyer_request_id"<>OLD."lawyer_request_id"
  OR NEW."document_id"<>OLD."document_id"
  OR NEW."shared_by_user_id"<>OLD."shared_by_user_id"
  OR NEW."recipient_user_id"<>OLD."recipient_user_id"
  OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer request message attachment identity is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_message_attachments_identity_immutable" BEFORE UPDATE ON "lawyer_request_message_attachments"
FOR EACH ROW EXECUTE FUNCTION guard_8ad709c64eff148781252a28();

-- lawyer_request_message_attachments_viewed_terminal
CREATE FUNCTION guard_496ff39766c7d9dd24dfb966() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status"='viewed' AND NEW."status"<>'viewed' THEN
RAISE EXCEPTION USING MESSAGE = 'viewed lawyer request message attachment is terminal', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_message_attachments_viewed_terminal" BEFORE UPDATE ON "lawyer_request_message_attachments"
FOR EACH ROW EXECUTE FUNCTION guard_496ff39766c7d9dd24dfb966();

-- lawyer_request_message_attachments_no_direct_delete
CREATE FUNCTION guard_6c69348cbb18a9df52f1285a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (SELECT 1 FROM "lawyer_request_messages" WHERE "id"=OLD."message_id")
  AND EXISTS (SELECT 1 FROM "lawyer_requests" WHERE "id"=OLD."lawyer_request_id")
  AND EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=OLD."shared_by_user_id")
  AND EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=OLD."recipient_user_id") THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer request message attachments are append-only', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_request_message_attachments_no_direct_delete" BEFORE DELETE ON "lawyer_request_message_attachments"
FOR EACH ROW EXECUTE FUNCTION guard_6c69348cbb18a9df52f1285a();

-- operational_feature_actor_guard
CREATE FUNCTION guard_da966381943938465dbc9702() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (SELECT 1 FROM "user_profiles" WHERE "id"=NEW."actor_user_id") THEN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_FEATURE_ACTOR_UNAVAILABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "operational_feature_actor_guard" BEFORE INSERT ON "operational_feature_flag_versions"
FOR EACH ROW EXECUTE FUNCTION guard_da966381943938465dbc9702();

-- operational_feature_sequence_guard
CREATE FUNCTION guard_7f67d7968e939b830f3a77ef() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."version" <> COALESCE((
	SELECT MAX("version") + 1 FROM "operational_feature_flag_versions"
	WHERE "environment"=NEW."environment" AND "feature_key"=NEW."feature_key"
), 1)
OR COALESCE(NEW."previous_event_hash",'') <> COALESCE((
	SELECT "event_hash" FROM "operational_feature_flag_versions"
	WHERE "environment"=NEW."environment" AND "feature_key"=NEW."feature_key"
	ORDER BY "version" DESC LIMIT 1
),'') THEN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_FEATURE_SEQUENCE_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "operational_feature_sequence_guard" BEFORE INSERT ON "operational_feature_flag_versions"
FOR EACH ROW EXECUTE FUNCTION guard_7f67d7968e939b830f3a77ef();

-- operational_feature_no_update
CREATE FUNCTION guard_a1a91d613cf35d29ee018414() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_FEATURE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "operational_feature_no_update" BEFORE UPDATE ON "operational_feature_flag_versions"
FOR EACH ROW EXECUTE FUNCTION guard_a1a91d613cf35d29ee018414();

-- operational_feature_no_delete
CREATE FUNCTION guard_07df891066c827354aca2f4a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'OPERATIONAL_FEATURE_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "operational_feature_no_delete" BEFORE DELETE ON "operational_feature_flag_versions"
FOR EACH ROW EXECUTE FUNCTION guard_07df891066c827354aca2f4a();

-- document_analyses_interactive_retention_guard
CREATE FUNCTION guard_95268a69c993dffdd97ca02d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."resource_scope" = 'interactive_analysis' AND NEW."abandoned_after" IS NULL THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_RETENTION_REQUIRED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_analyses_interactive_retention_guard" BEFORE INSERT ON "document_analyses"
FOR EACH ROW EXECUTE FUNCTION guard_95268a69c993dffdd97ca02d();

-- document_analyses_interactive_count_quota_guard
CREATE FUNCTION guard_66a772ce4a3b50fe68289cfe() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."resource_scope" = 'interactive_analysis' AND (
    SELECT count(*)
    FROM "document_analyses" analysis
    WHERE analysis."workspace_id" = NEW."workspace_id"
      AND analysis."owner_user_id" = NEW."owner_user_id"
      AND analysis."resource_scope" = 'interactive_analysis'
  ) >= 20 THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_COUNT_QUOTA_EXCEEDED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_analyses_interactive_count_quota_guard" BEFORE INSERT ON "document_analyses"
FOR EACH ROW EXECUTE FUNCTION guard_66a772ce4a3b50fe68289cfe();

-- document_analyses_interactive_byte_quota_guard
CREATE FUNCTION guard_0dccc4496926321c809d76f2() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."resource_scope" = 'interactive_analysis' AND (
    SELECT coalesce(sum(file."size_bytes"), 0)
    FROM "document_analyses" analysis
    JOIN "document_files" file ON file."id" = analysis."uploaded_file_id"
    WHERE analysis."workspace_id" = NEW."workspace_id"
      AND analysis."owner_user_id" = NEW."owner_user_id"
      AND analysis."resource_scope" = 'interactive_analysis'
  ) + coalesce((
    SELECT file."size_bytes"
    FROM "document_files" file
    WHERE file."id" = NEW."uploaded_file_id"
      AND file."workspace_id" = NEW."workspace_id"
      AND file."owner_user_id" = NEW."owner_user_id"
  ), 1073741825) > 1073741824 THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_BYTE_QUOTA_EXCEEDED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_analyses_interactive_byte_quota_guard" BEFORE INSERT ON "document_analyses"
FOR EACH ROW EXECUTE FUNCTION guard_0dccc4496926321c809d76f2();

-- document_analyses_deletion_reference_guard
CREATE FUNCTION guard_2274d4bc82ab2f22e193d3fe() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."deletion_requested_at" IS NULL AND NEW."deletion_requested_at" IS NOT NULL AND (
  EXISTS (
    SELECT 1 FROM "legal_corpus_owner_upload_requests" owner_upload
    WHERE owner_upload."analysis_id"=OLD."id" OR owner_upload."file_id"=OLD."uploaded_file_id"
  )
  OR EXISTS (
    SELECT 1 FROM "document_comparisons" comparison
    WHERE comparison."version_one_file_id"=OLD."uploaded_file_id"
       OR comparison."version_two_file_id"=OLD."uploaded_file_id"
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_IN_USE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_analyses_deletion_reference_guard" BEFORE UPDATE OF "deletion_requested_at" ON "document_analyses"
FOR EACH ROW EXECUTE FUNCTION guard_2274d4bc82ab2f22e193d3fe();

-- document_comparisons_analysis_deletion_guard
CREATE FUNCTION guard_f4a8b467bf22015548fb4e72() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "document_analyses" analysis
  WHERE analysis."deletion_requested_at" IS NOT NULL
    AND analysis."uploaded_file_id" IN (NEW."version_one_file_id",NEW."version_two_file_id")
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_DELETION_PENDING', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_comparisons_analysis_deletion_guard" BEFORE INSERT ON "document_comparisons"
FOR EACH ROW EXECUTE FUNCTION guard_f4a8b467bf22015548fb4e72();

-- document_comparisons_analysis_deletion_update_guard
CREATE FUNCTION guard_b1f582b72f4d3d30b7cee773() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "document_analyses" analysis
  WHERE analysis."deletion_requested_at" IS NOT NULL
    AND analysis."uploaded_file_id" IN (NEW."version_one_file_id",NEW."version_two_file_id")
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_DELETION_PENDING', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "document_comparisons_analysis_deletion_update_guard" BEFORE UPDATE OF "version_one_file_id","version_two_file_id" ON "document_comparisons"
FOR EACH ROW EXECUTE FUNCTION guard_b1f582b72f4d3d30b7cee773();

-- owner_corpus_analysis_deletion_guard
CREATE FUNCTION guard_1f12a8400fccf40b48fd21b4() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "document_analyses" analysis
  WHERE analysis."deletion_requested_at" IS NOT NULL
    AND (analysis."id"=NEW."analysis_id" OR analysis."uploaded_file_id"=NEW."file_id")
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_DELETION_PENDING', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "owner_corpus_analysis_deletion_guard" BEFORE INSERT ON "legal_corpus_owner_upload_requests"
FOR EACH ROW EXECUTE FUNCTION guard_1f12a8400fccf40b48fd21b4();

-- owner_corpus_analysis_deletion_update_guard
CREATE FUNCTION guard_8dab3ee0a9ce14fa8c0d3950() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "document_analyses" analysis
  WHERE analysis."deletion_requested_at" IS NOT NULL
    AND (analysis."id"=NEW."analysis_id" OR analysis."uploaded_file_id"=NEW."file_id")
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_DELETION_PENDING', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "owner_corpus_analysis_deletion_update_guard" BEFORE UPDATE OF "analysis_id","file_id" ON "legal_corpus_owner_upload_requests"
FOR EACH ROW EXECUTE FUNCTION guard_8dab3ee0a9ce14fa8c0d3950();

-- analysis_exports_resource_quota_guard
CREATE FUNCTION guard_791c29be836f3a9aec7a966f() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
  (
    (SELECT count(*) FROM "analysis_exports" export WHERE export."analysis_id"=NEW."analysis_id")
    + (SELECT count(*) FROM "analysis_report_exports" export WHERE export."analysis_id"=NEW."analysis_id")
  ) >= 20
  OR (
    SELECT count(*) FROM "workspace_audit_events" event
    WHERE event."entity_type"='analysis_export' AND event."action"='export_requested'
      AND CASE WHEN json_valid(event."metadata_json")
        THEN json_extract(event."metadata_json",'$.analysisId') END=NEW."analysis_id"
  ) >= 20
) THEN
RAISE EXCEPTION USING MESSAGE = 'ANALYSIS_EXPORT_CAPACITY_EXCEEDED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_exports_resource_quota_guard" BEFORE INSERT ON "analysis_exports"
FOR EACH ROW EXECUTE FUNCTION guard_791c29be836f3a9aec7a966f();

-- analysis_exports_cross_idempotency_guard
CREATE FUNCTION guard_bc42b34cfb8428beb7813cb6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "analysis_report_exports" export
  WHERE export."idempotency_key"=NEW."idempotency_key"
) THEN
RAISE EXCEPTION USING MESSAGE = 'ANALYSIS_EXPORT_IDEMPOTENCY_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_exports_cross_idempotency_guard" BEFORE INSERT ON "analysis_exports"
FOR EACH ROW EXECUTE FUNCTION guard_bc42b34cfb8428beb7813cb6();

-- analysis_exports_registry_guard
CREATE FUNCTION guard_c2e21effdfde60a00a4c935d() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "analysis_export_idempotency_registry" registry
  WHERE registry."idempotency_key"=NEW."idempotency_key"
    AND (registry."analysis_id"<>NEW."analysis_id" OR registry."export_kind"<>'json')
) THEN
RAISE EXCEPTION USING MESSAGE = 'ANALYSIS_EXPORT_IDEMPOTENCY_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_exports_registry_guard" BEFORE INSERT ON "analysis_exports"
FOR EACH ROW EXECUTE FUNCTION guard_c2e21effdfde60a00a4c935d();

-- analysis_report_exports_resource_quota_guard
CREATE FUNCTION guard_86170d76a30bd64dbe2f5a77() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
  (
    (SELECT count(*) FROM "analysis_exports" export WHERE export."analysis_id"=NEW."analysis_id")
    + (SELECT count(*) FROM "analysis_report_exports" export WHERE export."analysis_id"=NEW."analysis_id")
  ) >= 20
  OR (
    SELECT count(*) FROM "workspace_audit_events" event
    WHERE event."entity_type"='analysis_export' AND event."action"='export_requested'
      AND CASE WHEN json_valid(event."metadata_json")
        THEN json_extract(event."metadata_json",'$.analysisId') END=NEW."analysis_id"
  ) >= 20
) THEN
RAISE EXCEPTION USING MESSAGE = 'ANALYSIS_EXPORT_CAPACITY_EXCEEDED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_report_exports_resource_quota_guard" BEFORE INSERT ON "analysis_report_exports"
FOR EACH ROW EXECUTE FUNCTION guard_86170d76a30bd64dbe2f5a77();

-- analysis_report_exports_cross_idempotency_guard
CREATE FUNCTION guard_93933f13afd6f19401a1733a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "analysis_exports" export
  WHERE export."idempotency_key"=NEW."idempotency_key"
) THEN
RAISE EXCEPTION USING MESSAGE = 'ANALYSIS_EXPORT_IDEMPOTENCY_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_report_exports_cross_idempotency_guard" BEFORE INSERT ON "analysis_report_exports"
FOR EACH ROW EXECUTE FUNCTION guard_93933f13afd6f19401a1733a();

-- analysis_report_exports_registry_guard
CREATE FUNCTION guard_9d78c1cee8093c200a41dffe() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF EXISTS (
  SELECT 1 FROM "analysis_export_idempotency_registry" registry
  WHERE registry."idempotency_key"=NEW."idempotency_key"
    AND (registry."analysis_id"<>NEW."analysis_id" OR registry."export_kind"<>'report')
) THEN
RAISE EXCEPTION USING MESSAGE = 'ANALYSIS_EXPORT_IDEMPOTENCY_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "analysis_report_exports_registry_guard" BEFORE INSERT ON "analysis_report_exports"
FOR EACH ROW EXECUTE FUNCTION guard_9d78c1cee8093c200a41dffe();

-- user_document_index_deletion_guard
CREATE FUNCTION guard_bb1c5411e5f2942c9c4a819a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"='processing' AND EXISTS (
  SELECT 1 FROM "document_analyses" analysis
  WHERE analysis."id"=NEW."analysis_id" AND analysis."deletion_requested_at" IS NOT NULL
) THEN
RAISE EXCEPTION USING MESSAGE = 'DOCUMENT_ANALYSIS_DELETION_PENDING', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_document_index_deletion_guard" BEFORE UPDATE OF "status" ON "user_document_index_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_bb1c5411e5f2942c9c4a819a();

-- ai_question_intakes_membership_guard
CREATE FUNCTION guard_b5921499afe8fccd8f1d7d3e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
	SELECT 1 FROM "workspace_members" AS member
	WHERE member."workspace_id"=NEW."workspace_id"
		AND member."user_id"=NEW."user_id"
		AND member."status"='active'
) THEN
RAISE EXCEPTION USING MESSAGE = 'AI_QUESTION_INTAKE_ACCESS_DENIED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_question_intakes_membership_guard" BEFORE INSERT ON "ai_question_intakes"
FOR EACH ROW EXECUTE FUNCTION guard_b5921499afe8fccd8f1d7d3e();

-- ai_question_intakes_capacity_guard
CREATE FUNCTION guard_9032fc92624e1da85378decd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (
	SELECT count(*) FROM "ai_question_intakes" AS intake
	WHERE intake."workspace_id"=NEW."workspace_id"
		AND intake."user_id"=NEW."user_id"
		AND intake."expires_at">NEW."created_at"
) >= 5 THEN
RAISE EXCEPTION USING MESSAGE = 'AI_QUESTION_INTAKE_CAPACITY_EXCEEDED', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_question_intakes_capacity_guard" BEFORE INSERT ON "ai_question_intakes"
FOR EACH ROW EXECUTE FUNCTION guard_9032fc92624e1da85378decd();

-- policy_documents_no_update
CREATE FUNCTION guard_ec7bce176e0676b00c6bbfe3() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'policy_documents append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "policy_documents_no_update" BEFORE UPDATE ON "policy_documents"
FOR EACH ROW EXECUTE FUNCTION guard_ec7bce176e0676b00c6bbfe3();

-- policy_documents_no_delete
CREATE FUNCTION guard_8be808435441d54d2d456a29() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'policy_documents append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "policy_documents_no_delete" BEFORE DELETE ON "policy_documents"
FOR EACH ROW EXECUTE FUNCTION guard_8be808435441d54d2d456a29();

-- user_acceptances_policy_guard
CREATE FUNCTION guard_efef243cadf8d85d265ea651() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."policy_document_id" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM "policy_documents"
		WHERE "id" = NEW."policy_document_id"
			AND "document_key" = NEW."document_key"
			AND "document_version" = NEW."document_version"
			AND "locale" = NEW."locale"
			AND "content_sha256" = NEW."content_sha256"
	) THEN
RAISE EXCEPTION USING MESSAGE = 'user_acceptances policy evidence mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_acceptances_policy_guard" BEFORE INSERT ON "user_acceptances"
FOR EACH ROW EXECUTE FUNCTION guard_efef243cadf8d85d265ea651();

-- user_acceptances_no_update
CREATE FUNCTION guard_8a0b11595a529853d2e632e1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'user_acceptances append-only', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "user_acceptances_no_update" BEFORE UPDATE ON "user_acceptances"
FOR EACH ROW EXECUTE FUNCTION guard_8a0b11595a529853d2e632e1();

-- user_acceptances_no_delete
CREATE FUNCTION guard_8bb7a5e6b6f9b38e75142992() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'user_acceptances append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "user_acceptances_no_delete" BEFORE DELETE ON "user_acceptances"
FOR EACH ROW EXECUTE FUNCTION guard_8bb7a5e6b6f9b38e75142992();

-- security_email_jobs_recipient_immutable
CREATE FUNCTION guard_084fd04742c55753e5c35e22() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."recipient_ciphertext" IS DISTINCT FROM OLD."recipient_ciphertext"
	OR NEW."recipient_iv" IS DISTINCT FROM OLD."recipient_iv"
	OR NEW."recipient_key_version" IS DISTINCT FROM OLD."recipient_key_version" THEN
RAISE EXCEPTION USING MESSAGE = 'security email recipient is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "security_email_jobs_recipient_immutable" BEFORE UPDATE OF
	"recipient_ciphertext","recipient_iv","recipient_key_version" ON "security_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_084fd04742c55753e5c35e22();

-- email_change_challenge_attempt_update_guard
CREATE FUNCTION guard_8b4209e91e9542b25d736459() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."attempt_count" < OLD."attempt_count"
  OR NEW."attempt_count" > NEW."max_attempts"
  OR NEW."max_attempts" IS DISTINCT FROM OLD."max_attempts" THEN
RAISE EXCEPTION USING MESSAGE = 'email change challenge attempt state invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "email_change_challenge_attempt_update_guard" BEFORE UPDATE OF "attempt_count","max_attempts" ON "email_change_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_8b4209e91e9542b25d736459();

-- email_change_challenge_evidence_insert_guard
CREATE FUNCTION guard_84311e1c2c205dec286110c8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."current_email_lookup_hash" IS NULL
    AND NEW."current_email_lookup_key_version" IS NULL
    AND NEW."new_email_ciphertext" IS NULL
    AND NEW."new_email_iv" IS NULL
    AND NEW."new_email_key_version" IS NULL
    AND NEW."new_email_lookup_hash" IS NULL
    AND NEW."new_email_lookup_key_version" IS NULL
    AND NEW."current_code_hmac" IS NULL
    AND NEW."current_code_key_version" IS NULL
    AND NEW."new_code_hmac" IS NULL
    AND NEW."new_code_key_version" IS NULL
  )
  OR
  (
    NEW."current_email_lookup_hash" IS NOT NULL
    AND NEW."current_email_lookup_key_version" IS NOT NULL
    AND NEW."new_email_ciphertext" IS NOT NULL
    AND NEW."new_email_iv" IS NOT NULL
    AND NEW."new_email_key_version" IS NOT NULL
    AND NEW."new_email_lookup_hash" IS NOT NULL
    AND NEW."new_email_lookup_key_version" IS NOT NULL
    AND NEW."current_code_hmac" IS NOT NULL
    AND NEW."current_code_key_version" IS NOT NULL
    AND NEW."new_code_hmac" IS NOT NULL
    AND NEW."new_code_key_version" IS NOT NULL
    AND length(NEW."current_email_lookup_hash") = 43
    AND length(NEW."new_email_lookup_hash") = 43
    AND length(NEW."current_code_hmac") = 43
    AND length(NEW."new_code_hmac") = 43
    AND length(NEW."new_email_iv") = 16
    AND length(NEW."new_email_ciphertext") >= 22
    AND length(NEW."current_email_lookup_key_version") BETWEEN 1 AND 32
    AND length(NEW."new_email_key_version") BETWEEN 1 AND 32
    AND length(NEW."new_email_lookup_key_version") BETWEEN 1 AND 32
    AND length(NEW."current_code_key_version") BETWEEN 1 AND 32
    AND length(NEW."new_code_key_version") BETWEEN 1 AND 32
    AND NEW."current_email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."new_email_ciphertext" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."new_email_iv" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."new_email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."current_code_hmac" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."new_code_hmac" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."current_email_lookup_key_version"
      !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."new_email_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."new_email_lookup_key_version"
      !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."current_code_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."new_code_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'email change challenge evidence incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "email_change_challenge_evidence_insert_guard" BEFORE INSERT ON "email_change_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_84311e1c2c205dec286110c8();

-- email_change_challenge_evidence_update_guard
CREATE FUNCTION guard_cb3b0deff77e8f2f029f4332() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."current_email_lookup_hash" IS NULL
    AND NEW."current_email_lookup_key_version" IS NULL
    AND NEW."new_email_ciphertext" IS NULL
    AND NEW."new_email_iv" IS NULL
    AND NEW."new_email_key_version" IS NULL
    AND NEW."new_email_lookup_hash" IS NULL
    AND NEW."new_email_lookup_key_version" IS NULL
    AND NEW."current_code_hmac" IS NULL
    AND NEW."current_code_key_version" IS NULL
    AND NEW."new_code_hmac" IS NULL
    AND NEW."new_code_key_version" IS NULL
  )
  OR
  (
    NEW."current_email_lookup_hash" IS NOT NULL
    AND NEW."current_email_lookup_key_version" IS NOT NULL
    AND NEW."new_email_ciphertext" IS NOT NULL
    AND NEW."new_email_iv" IS NOT NULL
    AND NEW."new_email_key_version" IS NOT NULL
    AND NEW."new_email_lookup_hash" IS NOT NULL
    AND NEW."new_email_lookup_key_version" IS NOT NULL
    AND NEW."current_code_hmac" IS NOT NULL
    AND NEW."current_code_key_version" IS NOT NULL
    AND NEW."new_code_hmac" IS NOT NULL
    AND NEW."new_code_key_version" IS NOT NULL
    AND length(NEW."current_email_lookup_hash") = 43
    AND length(NEW."new_email_lookup_hash") = 43
    AND length(NEW."current_code_hmac") = 43
    AND length(NEW."new_code_hmac") = 43
    AND length(NEW."new_email_iv") = 16
    AND length(NEW."new_email_ciphertext") >= 22
    AND length(NEW."current_email_lookup_key_version") BETWEEN 1 AND 32
    AND length(NEW."new_email_key_version") BETWEEN 1 AND 32
    AND length(NEW."new_email_lookup_key_version") BETWEEN 1 AND 32
    AND length(NEW."current_code_key_version") BETWEEN 1 AND 32
    AND length(NEW."new_code_key_version") BETWEEN 1 AND 32
    AND NEW."current_email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."new_email_ciphertext" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."new_email_iv" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."new_email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."current_code_hmac" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."new_code_hmac" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."current_email_lookup_key_version"
      !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."new_email_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."new_email_lookup_key_version"
      !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."current_code_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."new_code_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'email change challenge evidence incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "email_change_challenge_evidence_update_guard" BEFORE UPDATE OF
  "current_email_lookup_hash","current_email_lookup_key_version",
  "new_email_ciphertext","new_email_iv","new_email_key_version",
  "new_email_lookup_hash","new_email_lookup_key_version",
  "current_code_hmac","current_code_key_version",
  "new_code_hmac","new_code_key_version" ON "email_change_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_cb3b0deff77e8f2f029f4332();

-- email_change_challenge_state_insert_guard
CREATE FUNCTION guard_e47730983523752bd9d6e151() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."consumed_at" IS NOT NULL
  OR NEW."consumed_by_operation_id" IS NOT NULL
  OR NEW."invalidated_at" IS NOT NULL
  OR NEW."codes_queued_at" IS NOT NULL THEN
RAISE EXCEPTION USING MESSAGE = 'email change challenge initial state invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "email_change_challenge_state_insert_guard" BEFORE INSERT ON "email_change_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_e47730983523752bd9d6e151();

-- email_change_challenge_state_update_guard
CREATE FUNCTION guard_34ec39f20f77883a10292b29() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."consumed_at" IS NULL
    AND NEW."consumed_by_operation_id" IS NULL
  )
  OR
  (
    NEW."consumed_at" IS NOT NULL
    AND NEW."consumed_by_operation_id" IS NOT NULL
    AND NEW."codes_queued_at" IS NOT NULL
    AND NEW."invalidated_at" IS NULL
  )
)
OR (
  NEW."consumed_at" IS NOT NULL
  AND NEW."invalidated_at" IS NOT NULL
)
OR (
  OLD."codes_queued_at" IS NOT NULL
  AND NEW."codes_queued_at" IS DISTINCT FROM OLD."codes_queued_at"
)
OR (
  OLD."consumed_at" IS NOT NULL
  AND (
    NEW."consumed_at" IS DISTINCT FROM OLD."consumed_at"
    OR NEW."consumed_by_operation_id"
      IS DISTINCT FROM OLD."consumed_by_operation_id"
  )
)
OR (
  OLD."invalidated_at" IS NOT NULL
  AND NEW."invalidated_at" IS DISTINCT FROM OLD."invalidated_at"
) THEN
RAISE EXCEPTION USING MESSAGE = 'email change challenge state invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "email_change_challenge_state_update_guard" BEFORE UPDATE OF
  "codes_queued_at","consumed_at","consumed_by_operation_id","invalidated_at" ON "email_change_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_34ec39f20f77883a10292b29();

-- security_notification_jobs_content_immutable
CREATE FUNCTION guard_b9f7e4ebda9befa066fa8134() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."user_id" IS DISTINCT FROM OLD."user_id"
  OR NEW."session_id" IS DISTINCT FROM OLD."session_id"
  OR NEW."event_type" IS DISTINCT FROM OLD."event_type"
  OR NEW."delivery_channel" IS DISTINCT FROM OLD."delivery_channel"
  OR NEW."locale" IS DISTINCT FROM OLD."locale"
  OR NEW."recipient_ciphertext" IS DISTINCT FROM OLD."recipient_ciphertext"
  OR NEW."recipient_iv" IS DISTINCT FROM OLD."recipient_iv"
  OR NEW."recipient_key_version" IS DISTINCT FROM OLD."recipient_key_version"
  OR NEW."device_name" IS DISTINCT FROM OLD."device_name"
  OR NEW."country_code" IS DISTINCT FROM OLD."country_code"
  OR NEW."region_code" IS DISTINCT FROM OLD."region_code"
  OR NEW."occurred_at" IS DISTINCT FROM OLD."occurred_at"
  OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'security notification content is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "security_notification_jobs_content_immutable" BEFORE UPDATE OF
  "user_id","session_id","event_type","delivery_channel","locale",
  "recipient_ciphertext","recipient_iv","recipient_key_version",
  "device_name","country_code","region_code","occurred_at","created_at" ON "security_notification_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_b9f7e4ebda9befa066fa8134();

-- account_deletion_challenge_evidence_insert_guard
CREATE FUNCTION guard_54d93f9174403bf37e1365bd() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."email_lookup_hash" IS NULL
    AND NEW."email_lookup_key_version" IS NULL
    AND NEW."code_hmac" IS NULL
    AND NEW."code_key_version" IS NULL
  )
  OR
  (
    NEW."email_lookup_hash" IS NOT NULL
    AND NEW."email_lookup_key_version" IS NOT NULL
    AND NEW."code_hmac" IS NOT NULL
    AND NEW."code_key_version" IS NOT NULL
    AND length(NEW."email_lookup_hash") = 43
    AND length(NEW."email_lookup_key_version") BETWEEN 1 AND 32
    AND length(NEW."code_hmac") = 43
    AND length(NEW."code_key_version") BETWEEN 1 AND 32
    AND NEW."email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."email_lookup_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."code_hmac" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."code_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'account deletion challenge evidence incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_challenge_evidence_insert_guard" BEFORE INSERT ON "account_deletion_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_54d93f9174403bf37e1365bd();

-- account_deletion_challenge_evidence_update_guard
CREATE FUNCTION guard_d1028694aeb582689ed8d744() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
  (
    NEW."email_lookup_hash" IS NULL
    AND NEW."email_lookup_key_version" IS NULL
    AND NEW."code_hmac" IS NULL
    AND NEW."code_key_version" IS NULL
  )
  OR
  (
    NEW."email_lookup_hash" IS NOT NULL
    AND NEW."email_lookup_key_version" IS NOT NULL
    AND NEW."code_hmac" IS NOT NULL
    AND NEW."code_key_version" IS NOT NULL
    AND length(NEW."email_lookup_hash") = 43
    AND length(NEW."email_lookup_key_version") BETWEEN 1 AND 32
    AND length(NEW."code_hmac") = 43
    AND length(NEW."code_key_version") BETWEEN 1 AND 32
    AND NEW."email_lookup_hash" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."email_lookup_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
    AND NEW."code_hmac" !~ '^.*[^A-Za-z0-9_-].*$'
    AND NEW."code_key_version" !~ '^.*[^A-Za-z0-9._-].*$'
  )
) THEN
RAISE EXCEPTION USING MESSAGE = 'account deletion challenge evidence incomplete', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_challenge_evidence_update_guard" BEFORE UPDATE OF
  "email_lookup_hash","email_lookup_key_version",
  "code_hmac","code_key_version" ON "account_deletion_challenges"
FOR EACH ROW EXECUTE FUNCTION guard_d1028694aeb582689ed8d744();

-- ai_document_prefill_handoffs_immutable_update
CREATE FUNCTION guard_cfe6f0fd89b3a336184d0af1() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'AI_DOCUMENT_HANDOFF_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_document_prefill_handoffs_immutable_update" BEFORE UPDATE ON "ai_document_prefill_handoffs"
FOR EACH ROW EXECUTE FUNCTION guard_cfe6f0fd89b3a336184d0af1();

-- ai_document_prefill_handoffs_insert_guard
CREATE FUNCTION guard_c1c683a4ba7fd1c08b108a2e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT EXISTS (
	SELECT 1 FROM "workspace_members" AS member
	WHERE member."workspace_id"=NEW."workspace_id"
		AND member."user_id"=NEW."user_id"
		AND member."status"='active'
)
OR NOT EXISTS (
	SELECT 1 FROM "conversation_messages" AS message
	JOIN "conversations" AS conversation ON conversation."id"=message."conversation_id"
	WHERE message."id"=NEW."assistant_message_id"
		AND message."author_type"='assistant'
		AND message."structured_json" IS NOT NULL
		AND conversation."workspace_id"=NEW."workspace_id"
		AND conversation."owner_user_id"=NEW."user_id"
)
OR NOT EXISTS (
	SELECT 1 FROM "documents" AS document
	WHERE document."id"=NEW."document_id"
		AND document."workspace_id"=NEW."workspace_id"
		AND document."owner_user_id"=NEW."user_id"
		AND document."template_code"=NEW."template_code"
		AND document."status"='Черновик'
) THEN
RAISE EXCEPTION USING MESSAGE = 'AI_DOCUMENT_HANDOFF_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "ai_document_prefill_handoffs_insert_guard" BEFORE INSERT ON "ai_document_prefill_handoffs"
FOR EACH ROW EXECUTE FUNCTION guard_c1c683a4ba7fd1c08b108a2e();

-- builder_analysis_handoff_identity_immutable
CREATE FUNCTION guard_9854c51679871a619486080a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id" IS DISTINCT FROM OLD."id"
	OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
	OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
	OR NEW."document_id" IS DISTINCT FROM OLD."document_id"
	OR NEW."document_revision"<>OLD."document_revision"
	OR NEW."document_content_sha256" IS DISTINCT FROM OLD."document_content_sha256"
	OR NEW."file_id" IS DISTINCT FROM OLD."file_id"
	OR NEW."analysis_id" IS DISTINCT FROM OLD."analysis_id"
	OR NEW."mode" IS DISTINCT FROM OLD."mode"
	OR NEW."locale" IS DISTINCT FROM OLD."locale"
	OR NEW."idempotency_key_sha256" IS DISTINCT FROM OLD."idempotency_key_sha256"
	OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_ANALYSIS_HANDOFF_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_analysis_handoff_identity_immutable" BEFORE UPDATE ON "builder_document_analysis_handoffs"
FOR EACH ROW EXECUTE FUNCTION guard_9854c51679871a619486080a();

-- builder_analysis_handoff_insert_guard
CREATE FUNCTION guard_55b805bbea943624ef8e6bb6() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"<>'pending'
	OR NEW."attempt_count"<>0
	OR NEW."last_error_code" IS NOT NULL
	OR NOT EXISTS (
		SELECT 1 FROM "workspace_members" AS member
		WHERE member."workspace_id"=NEW."workspace_id"
			AND member."user_id"=NEW."user_id"
			AND member."status"='active'
	)
	OR NOT EXISTS (
		SELECT 1 FROM "documents" AS document
		JOIN "document_current_content" AS content ON content."document_id"=document."id"
		WHERE document."id"=NEW."document_id"
			AND document."workspace_id"=NEW."workspace_id"
			AND document."owner_user_id"=NEW."user_id"
			AND document."revision"=NEW."document_revision"
			AND document."archived_at" IS NULL
			AND length(trim(content."final_content"))>=24
	)
	OR NOT EXISTS (
		SELECT 1 FROM "document_files" AS file
		WHERE file."id"=NEW."file_id"
			AND file."workspace_id"=NEW."workspace_id"
			AND file."owner_user_id"=NEW."user_id"
			AND file."document_id"=NEW."document_id"
			AND file."kind"='analysis_snapshot_pending'
			AND file."sha256"=NEW."document_content_sha256"
			AND file."mime_type"='text/markdown; charset=utf-8'
			AND file."archived_at" IS NULL
	)
	OR NOT EXISTS (
		SELECT 1 FROM "document_analyses" AS analysis
		WHERE analysis."id"=NEW."analysis_id"
			AND analysis."workspace_id"=NEW."workspace_id"
			AND analysis."owner_user_id"=NEW."user_id"
			AND analysis."uploaded_file_id"=NEW."file_id"
			AND analysis."status"='initiated'
	) THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_ANALYSIS_HANDOFF_CONFLICT', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_analysis_handoff_insert_guard" BEFORE INSERT ON "builder_document_analysis_handoffs"
FOR EACH ROW EXECUTE FUNCTION guard_55b805bbea943624ef8e6bb6();

-- builder_analysis_handoff_transition_guard
CREATE FUNCTION guard_25d5ec58ec2557ecc39a2a42() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NOT (
	(OLD."status"='pending' AND NEW."status"='pending'
		AND NEW."attempt_count"=OLD."attempt_count"+1
		AND NEW."last_error_code" IS NOT NULL)
	OR (OLD."status"='pending' AND NEW."status"='ready'
		AND NEW."attempt_count"=OLD."attempt_count"
		AND NEW."last_error_code" IS NULL
		AND EXISTS (
			SELECT 1 FROM "document_files" AS file
			JOIN "document_analyses" AS analysis ON analysis."uploaded_file_id"=file."id"
			JOIN "job_outbox" AS outbox ON outbox."subject_id"=analysis."id"
			WHERE file."id"=NEW."file_id"
				AND file."kind"='analysis_safe'
				AND file."sha256"=NEW."document_content_sha256"
				AND analysis."id"=NEW."analysis_id"
				AND analysis."status"='ready'
				AND outbox."job_type"='document.analyze'
				AND outbox."workspace_id"=NEW."workspace_id"
				AND outbox."status"='pending'
		)
	)
) THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_ANALYSIS_HANDOFF_TRANSITION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_analysis_handoff_transition_guard" BEFORE UPDATE ON "builder_document_analysis_handoffs"
FOR EACH ROW EXECUTE FUNCTION guard_25d5ec58ec2557ecc39a2a42();

-- knowledge_base_published_versions_no_delete
CREATE FUNCTION guard_f9379698a43442fd99537f36() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."published_at" IS NOT NULL AND EXISTS (SELECT 1 FROM "knowledge_base_articles" WHERE "id" = OLD."article_id") THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_published_version_immutable', ERRCODE = '23514';
END IF;
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "knowledge_base_published_versions_no_delete" BEFORE DELETE ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_f9379698a43442fd99537f36();

-- knowledge_base_published_versions_no_update
CREATE FUNCTION guard_f2b223bd334606d2228ab679() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."published_at" IS NOT NULL THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_published_version_immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_published_versions_no_update" BEFORE UPDATE ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_f2b223bd334606d2228ab679();

-- knowledge_base_versions_created_event
CREATE FUNCTION guard_a620081e25612af58e2bdecc() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
INSERT INTO "knowledge_base_authoring_events" ("id","article_id","version_id","actor_user_id","action","previous_status","new_status","content_sha256","metadata_json","created_at")
  VALUES (lower(hex(randomblob(16))),NEW."article_id",NEW."id",NEW."created_by_user_id",'draft_created',NULL,'draft',NEW."content_sha256",json_build_object('versionNumber',NEW."version_number",'hashVersion',NEW."content_hash_version"),NEW."created_at");
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_versions_created_event" AFTER INSERT ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_a620081e25612af58e2bdecc();

-- knowledge_base_versions_draft_update_guard
CREATE FUNCTION guard_dec5b42b3b39a9b5edb2020a() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."published_at" IS NULL AND (NEW."updated_by_user_id" IS NULL OR NEW."updated_at" IS NULL OR NEW."updated_at" = OLD."updated_at" OR NEW."content_hash_version" <> 'full-v2') THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_draft_update_evidence_required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_versions_draft_update_guard" BEFORE UPDATE OF "title_ru","title_uz","title_en","summary_ru","summary_uz","summary_en","body_ru_json","body_uz_json","body_en_json","related_slugs_json","content_sha256","content_hash_version" ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_dec5b42b3b39a9b5edb2020a();

-- knowledge_base_versions_draft_updated_event
CREATE FUNCTION guard_7b594436cd9cebaf607e4530() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."published_at" IS NULL THEN
INSERT INTO "knowledge_base_authoring_events" ("id","article_id","version_id","actor_user_id","action","previous_status","new_status","content_sha256","metadata_json","created_at")
  VALUES (lower(hex(randomblob(16))),NEW."article_id",NEW."id",NEW."updated_by_user_id",'draft_updated','draft','draft',NEW."content_sha256",json_build_object('versionNumber',NEW."version_number",'hashVersion',NEW."content_hash_version"),NEW."updated_at");
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_versions_draft_updated_event" AFTER UPDATE OF "title_ru","title_uz","title_en","summary_ru","summary_uz","summary_en","body_ru_json","body_uz_json","body_en_json","related_slugs_json","content_sha256","content_hash_version" ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_7b594436cd9cebaf607e4530();

-- knowledge_base_versions_new_actor_guard
CREATE FUNCTION guard_cdc4117c15b723b671b236b8() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."created_by_user_id" IS NULL OR NEW."updated_by_user_id" IS NULL OR NEW."updated_at" IS NULL OR NEW."content_hash_version" <> 'full-v2' THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_version_actor_required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_versions_new_actor_guard" BEFORE INSERT ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_cdc4117c15b723b671b236b8();

-- knowledge_base_versions_no_delete
CREATE FUNCTION guard_a25d3bf7618e76df8d6d3516() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_version_delete_forbidden', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "knowledge_base_versions_no_delete" BEFORE DELETE ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_a25d3bf7618e76df8d6d3516();

-- knowledge_base_versions_publish_guard
CREATE FUNCTION guard_391f395a9ed45299488e594c() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."published_at" IS NULL AND NEW."published_at" IS NOT NULL AND NEW."published_by_user_id" IS NULL THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_publication_actor_required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_versions_publish_guard" BEFORE UPDATE OF "published_at" ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_391f395a9ed45299488e594c();

-- knowledge_base_versions_published_event
CREATE FUNCTION guard_556e0783070f6420aaedc8ec() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."published_at" IS NULL AND NEW."published_at" IS NOT NULL THEN
INSERT INTO "knowledge_base_authoring_events" ("id","article_id","version_id","actor_user_id","action","previous_status","new_status","content_sha256","metadata_json","created_at")
  VALUES (lower(hex(randomblob(16))),NEW."article_id",NEW."id",NEW."published_by_user_id",'published','draft','published',NEW."content_sha256",json_build_object('versionNumber',NEW."version_number",'hashVersion',NEW."content_hash_version"),NEW."published_at");
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_versions_published_event" AFTER UPDATE OF "published_at" ON "knowledge_base_article_versions"
FOR EACH ROW EXECUTE FUNCTION guard_556e0783070f6420aaedc8ec();

-- system_status_incident_update_guard
CREATE FUNCTION guard_7a1017ba104f29e70f6d4340() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
  OR NEW."public_reference"<>OLD."public_reference"
  OR NEW."severity"<>OLD."severity"
  OR NEW."title_ru"<>OLD."title_ru"
  OR NEW."title_uz"<>OLD."title_uz"
  OR NEW."title_en" IS DISTINCT FROM OLD."title_en"
  OR NEW."summary_ru"<>OLD."summary_ru"
  OR NEW."summary_uz"<>OLD."summary_uz"
  OR NEW."summary_en" IS DISTINCT FROM OLD."summary_en"
  OR NEW."started_at"<>OLD."started_at"
  OR NEW."created_by_user_id"<>OLD."created_by_user_id"
  OR NEW."created_at"<>OLD."created_at"
  OR NOT (
    (OLD."state"='investigating' AND NEW."state" IN ('identified','monitoring','resolved'))
    OR (OLD."state"='identified' AND NEW."state" IN ('monitoring','resolved'))
    OR (OLD."state"='monitoring' AND NEW."state"='resolved')
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'SYSTEM_STATUS_INCIDENT_UPDATE_FORBIDDEN', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "system_status_incident_update_guard" BEFORE UPDATE ON "system_status_incidents"
FOR EACH ROW EXECUTE FUNCTION guard_7a1017ba104f29e70f6d4340();

-- account_deletion_requests_verification_guard
CREATE FUNCTION guard_16aae5ed02719e4f1731b640() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."verification_challenge_id" IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM "account_deletion_challenges"
		WHERE "id" = NEW."verification_challenge_id"
			AND "user_id" = NEW."user_id"
			AND "session_id" = NEW."requested_session_id"
			AND "consumed_at" = NEW."verified_at"
			AND "consumed_by_operation_id" IS NOT NULL
			AND NEW."verification_method" = 'email_otp'
	) THEN
RAISE EXCEPTION USING MESSAGE = 'account_deletion_requests verification mismatch', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "account_deletion_requests_verification_guard" BEFORE INSERT ON "account_deletion_requests"
FOR EACH ROW EXECUTE FUNCTION guard_16aae5ed02719e4f1731b640();

-- builder_version_writes_insert_guard
CREATE FUNCTION guard_416e62d91556fa06cd6dc451() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF NEW."status"<>'pending' OR NEW."version_id" IS NOT NULL OR NEW."attempt_count"<>0 OR NEW."last_error_code" IS NOT NULL OR NEW."reconciled_at" IS NOT NULL
	OR NOT EXISTS (SELECT 1 FROM "workspace_members" member JOIN "documents" document ON document."workspace_id"=member."workspace_id" WHERE member."workspace_id"=NEW."workspace_id" AND member."user_id"=NEW."owner_user_id" AND member."status"='active' AND document."id"=NEW."document_id" AND document."workspace_id"=NEW."workspace_id" AND document."owner_user_id"=NEW."owner_user_id" AND document."revision"=NEW."source_revision" AND document."archived_at" IS NULL)
	OR NEW."r2_key" NOT LIKE 'builder-document-versions/' || NEW."workspace_id" || '/' || NEW."document_id" || '/' || NEW."id" || '-%'
	OR (NEW."source"='suggestion' AND NOT EXISTS (SELECT 1 FROM "document_change_proposals" proposal WHERE proposal."id"=NEW."source_entity_id" AND proposal."document_id"=NEW."document_id" AND proposal."status"='pending' AND proposal."old_text"<>proposal."new_text"))
	OR (NEW."source"='analysis_correction' AND NOT EXISTS (SELECT 1 FROM "builder_document_analysis_handoffs" handoff JOIN "analysis_document_versions" version ON version."analysis_id"=handoff."analysis_id" WHERE version."id"=NEW."source_entity_id" AND version."workspace_id"=NEW."workspace_id" AND version."owner_user_id"=NEW."owner_user_id" AND version."source_kind"='corrected' AND handoff."document_id"=NEW."document_id" AND handoff."status"='ready')) THEN
RAISE EXCEPTION USING MESSAGE = 'BUILDER_VERSION_WRITE_SOURCE_MISMATCH', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "builder_version_writes_insert_guard" BEFORE INSERT ON "builder_document_version_object_writes"
FOR EACH ROW EXECUTE FUNCTION guard_416e62d91556fa06cd6dc451();

-- knowledge_base_articles_identity_update_guard
CREATE FUNCTION guard_58a74837f77c90837a3c0bad() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF (OLD."slug" <> NEW."slug" OR OLD."category" <> NEW."category") AND (
  NEW."updated_by_user_id" IS NULL OR NEW."updated_at" = OLD."updated_at"
  OR EXISTS (SELECT 1 FROM "knowledge_base_article_versions" WHERE "article_id"=OLD."id" AND "published_at" IS NOT NULL)
) THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_article_identity_immutable_or_actor_missing', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_articles_identity_update_guard" BEFORE UPDATE OF "slug","category" ON "knowledge_base_articles"
FOR EACH ROW EXECUTE FUNCTION guard_58a74837f77c90837a3c0bad();

-- knowledge_base_articles_status_guard
CREATE FUNCTION guard_55003f4cee99ce1f1f2fad4e() RETURNS trigger LANGUAGE plpgsql AS $guard$
BEGIN
IF OLD."status" <> NEW."status" AND (
  NEW."status_changed_by_user_id" IS NULL OR NEW."status_changed_at" IS NULL
  OR NEW."status_changed_at" IS NOT DISTINCT FROM OLD."status_changed_at"
  OR (NEW."status"='published' AND NOT EXISTS (SELECT 1 FROM "knowledge_base_article_versions" WHERE "article_id"=NEW."id" AND "published_at" IS NOT NULL))
) THEN
RAISE EXCEPTION USING MESSAGE = 'knowledge_base_article_status_evidence_required', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "knowledge_base_articles_status_guard" BEFORE UPDATE OF "status" ON "knowledge_base_articles"
FOR EACH ROW EXECUTE FUNCTION guard_55003f4cee99ce1f1f2fad4e();

RESET search_path;
