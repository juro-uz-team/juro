-- Preserve historical application records and their original constraints.

-- Historical call-provider values describe existing records; they do not enable Cloudflare services.

SET search_path TO app, public;

CREATE TABLE "investor_demo_accounts" (
  "account_key" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "dataset_version" bigint DEFAULT 1 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "synthetic_disclosure" text NOT NULL,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("account_key" IN ('client_demo','lawyer_demo','admin_demo')),
  CHECK ("status" IN ('active','disabled')),
  CHECK ("dataset_version" > 0),
  CHECK (length(trim("synthetic_disclosure")) BETWEEN 10 AND 500)
);

CREATE TABLE "investor_demo_dataset_events" (
  "id" text PRIMARY KEY NOT NULL,
  "dataset_version" bigint NOT NULL,
  "event_type" text NOT NULL,
  "actor_user_id" text,
  "summary_json" text NOT NULL,
  "created_at" text NOT NULL,
  CHECK ("dataset_version" > 0),
  CHECK ("event_type" IN ('seeded','reset','disabled'))
);

CREATE TABLE "lawyer_call_events" (
  "id" text PRIMARY KEY NOT NULL,
  "room_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "event_type" text NOT NULL,
  "metadata_json" text NOT NULL,
  "created_at" text NOT NULL,
  CHECK ("event_type" IN ('prepared','joined','left','ended','reconnected'))
);

CREATE TABLE "lawyer_call_participants" (
  "room_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "device_readiness_json" text NOT NULL,
  "prepared_at" text NOT NULL,
  "joined_at" text,
  "last_seen_at" text NOT NULL,
  "left_at" text,
  PRIMARY KEY ("room_id","user_id"),
  CHECK ("role" IN ('client','lawyer'))
);

CREATE TABLE "lawyer_call_rooms" (
  "id" text PRIMARY KEY NOT NULL,
  "consultation_id" text NOT NULL,
  "provider" text DEFAULT 'cloudflare_realtime_turn' NOT NULL,
  "status" text DEFAULT 'waiting' NOT NULL,
  "started_at" text,
  "ended_at" text,
  "ended_by_user_id" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("provider" IN ('cloudflare_realtime_turn','cloudflare_stun_only')),
  CHECK ("status" IN ('waiting','active','ended'))
);

CREATE TABLE "lawyer_call_signals" (
  "id" text PRIMARY KEY NOT NULL,
  "room_id" text NOT NULL,
  "sender_user_id" text NOT NULL,
  "recipient_user_id" text NOT NULL,
  "signal_type" text NOT NULL,
  "payload_json" text NOT NULL,
  "created_at" text NOT NULL,
  "expires_at" text NOT NULL,
  CHECK ("signal_type" IN ('offer','answer','ice','restart'))
);

CREATE TABLE "lawyer_conflict_search_events" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "query_sha256" text NOT NULL,
  "result_count" bigint NOT NULL,
  "created_at" text NOT NULL,
  CHECK (length("query_sha256")=64),
  CHECK ("result_count" BETWEEN 0 AND 200)
);

CREATE TABLE "lawyer_knowledge_items" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "case_id" text,
  "client_user_id" text,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "content" text NOT NULL,
  "source_url" text,
  "folder" text NOT NULL,
  "tags_json" text DEFAULT '[]' NOT NULL,
  "favorite" bigint DEFAULT 0 NOT NULL,
  "archived_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("kind" IN ('ai_answer','legal_position','source','template','clause','monitoring','note','document')),
  CHECK (length(trim("title")) BETWEEN 2 AND 240),
  CHECK (length(trim("content")) BETWEEN 1 AND 20000),
  CHECK (length(trim("folder")) BETWEEN 1 AND 120),
  CHECK ("favorite" IN (0,1))
);

CREATE TABLE "lawyer_profile_deletion_requests" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "requested_by_user_id" text NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "reason" text,
  "decision_reason" text,
  "reviewed_by_user_id" text,
  "requested_at" text NOT NULL,
  "reviewed_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("status" IN ('requested','approved','rejected','cancelled')),
  CHECK (("status"='requested' AND "reviewed_at" IS NULL AND "reviewed_by_user_id" IS NULL)
    OR ("status"='cancelled' AND "reviewed_at" IS NULL AND "reviewed_by_user_id" IS NULL)
    OR ("status" IN ('approved','rejected') AND "reviewed_at" IS NOT NULL AND "reviewed_by_user_id" IS NOT NULL))
);

CREATE TABLE "lawyer_profile_publication_events" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "actor_user_id" text NOT NULL,
  "profile_revision" bigint NOT NULL,
  "previous_profile_status" text NOT NULL,
  "previous_marketplace_status" text NOT NULL,
  "publication_consent_at" text NOT NULL,
  "created_at" text NOT NULL,
  CHECK ("profile_revision" > 0),
  CHECK ("publication_consent_at"="created_at")
);

CREATE TABLE "lawyer_profile_revisions" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "previous_revision" bigint NOT NULL,
  "next_revision" bigint NOT NULL,
  "actor_user_id" text NOT NULL,
  "previous_snapshot_json" text NOT NULL,
  "next_snapshot_json" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" text NOT NULL,
  CHECK ("next_revision" = "previous_revision" + 1),
  CHECK (length(trim("reason")) BETWEEN 3 AND 120)
);

CREATE TABLE "lawyer_request_internal_notes" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "case_id" text NOT NULL,
  "author_user_id" text NOT NULL,
  "body" text NOT NULL,
  "document_id" text,
  "converted_task_id" text,
  "created_at" text NOT NULL,
  CHECK (length(trim("body")) BETWEEN 1 AND 4000)
);

CREATE TABLE "lawyer_request_message_typing" (
  "lawyer_request_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "expires_at" text NOT NULL,
  "updated_at" text NOT NULL,
  PRIMARY KEY ("lawyer_request_id","user_id"),
  CHECK ("role" IN ('client','lawyer')),
  CHECK ("expires_at">"updated_at")
);

CREATE TABLE "lawyer_time_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_user_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "case_id" text NOT NULL,
  "lawyer_request_id" text NOT NULL,
  "source" text NOT NULL,
  "status" text NOT NULL,
  "description" text NOT NULL,
  "billable" bigint DEFAULT 0 NOT NULL,
  "started_at" text NOT NULL,
  "ended_at" text,
  "duration_seconds" bigint,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("source" IN ('timer','manual')),
  CHECK ("status" IN ('running','completed')),
  CHECK ("billable" IN (0,1)),
  CHECK (length(trim("description")) BETWEEN 1 AND 500),
  CHECK (
    ("status"='running' AND "source"='timer' AND "ended_at" IS NULL AND "duration_seconds" IS NULL)
    OR ("status"='completed' AND "ended_at" IS NOT NULL AND "duration_seconds" BETWEEN 1 AND 604800)
  )
);

CREATE TABLE "lawyer_trials" (
  "id" text PRIMARY KEY NOT NULL,
  "lawyer_profile_id" text NOT NULL,
  "starts_at" text NOT NULL,
  "ends_at" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "post_expiry_mode" text DEFAULT 'stay_published' NOT NULL,
  "reminder_30_sent_at" text,
  "reminder_7_sent_at" text,
  "reminder_1_sent_at" text,
  "reminder_expired_sent_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CHECK ("starts_at" < "ends_at"),
  CHECK ("status" IN ('active','extended','converted','disabled')),
  CHECK ("post_expiry_mode" IN ('stay_published','limit_new_requests','hide_profile'))
);

CREATE TABLE "monitoring_email_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "preference_id" text NOT NULL,
  "notification_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "user_id" text NOT NULL,
  "frequency" text NOT NULL,
  "locale" text NOT NULL,
  "cursor_from" text NOT NULL,
  "cursor_through" text NOT NULL,
  "event_count" bigint NOT NULL,
  "official_url" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "attempt_count" bigint DEFAULT 0 NOT NULL,
  "provider_message_id" text,
  "error_code" text,
  "sent_at" text,
  "created_at" text NOT NULL,
  "updated_at" text NOT NULL,
  CONSTRAINT "monitoring_email_job_id_check" CHECK ("id" ~ '^monitoring-email:.*$' AND length("id") BETWEEN 32 AND 180),
  CONSTRAINT "monitoring_email_job_frequency_check" CHECK ("frequency" IN ('immediate','daily','weekly')),
  CONSTRAINT "monitoring_email_job_locale_check" CHECK ("locale" IN ('ru','uz')),
  CONSTRAINT "monitoring_email_job_cursor_check" CHECK ("cursor_from" < "cursor_through"),
  CONSTRAINT "monitoring_email_job_event_count_check" CHECK ("event_count" BETWEEN 1 AND 10000),
  CONSTRAINT "monitoring_email_job_url_check" CHECK (
		length("official_url") BETWEEN 24 AND 2048
		AND ("official_url" ~ '^https://lex[.]uz/.*/docs/.*$' OR "official_url" ~ '^https://www[.]lex[.]uz/.*/docs/.*$')
		AND instr("official_url",'?')=0
		AND instr("official_url",'#')=0
	),
  CONSTRAINT "monitoring_email_job_status_check" CHECK ("status" IN ('pending','sending','retrying','sent','failed','cancelled')),
  CONSTRAINT "monitoring_email_job_attempt_check" CHECK ("attempt_count">=0),
  CONSTRAINT "monitoring_email_job_evidence_check" CHECK (
		("status" IN ('pending','sending') AND "provider_message_id" IS NULL AND "error_code" IS NULL AND "sent_at" IS NULL)
		OR ("status"='retrying' AND "provider_message_id" IS NULL AND "error_code" IS NOT NULL AND "sent_at" IS NULL)
		OR ("status"='sent' AND "provider_message_id" IS NOT NULL AND length("provider_message_id") BETWEEN 1 AND 180 AND "error_code" IS NULL AND "sent_at" IS NOT NULL)
		OR ("status"='failed' AND "provider_message_id" IS NULL AND "error_code" IS NOT NULL AND "sent_at" IS NULL)
		OR ("status"='cancelled' AND "provider_message_id" IS NULL AND "error_code" IS NOT NULL AND "sent_at" IS NULL)
	)
);

CREATE TABLE "monitoring_task_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "task_id" text NOT NULL,
  "workspace_id" text NOT NULL,
  "case_id" text NOT NULL,
  "change_event_id" text NOT NULL,
  "created_by_user_id" text NOT NULL,
  "official_url" text NOT NULL,
  "source_title" text NOT NULL,
  "source_identifier" text,
  "source_detected_at" text NOT NULL,
  "source_last_checked_at" text NOT NULL,
  "snapshot_json" text NOT NULL,
  "created_at" text NOT NULL,
  CHECK (length(trim("source_title")) BETWEEN 1 AND 1000),
  CHECK (json_valid("snapshot_json") = true),
  CHECK (
    substr("official_url",1,length('https://lex.uz/'))='https://lex.uz/' OR
    substr("official_url",1,length('https://www.lex.uz/'))='https://www.lex.uz/'
  )
);

CREATE TABLE "signed_share_verification_guards" (
  "share_id" text PRIMARY KEY NOT NULL,
  "failed_attempt_count" bigint DEFAULT 0 NOT NULL,
  "window_started_at" text NOT NULL,
  "locked_until" text,
  "updated_at" text NOT NULL,
  CONSTRAINT "signed_share_verification_failed_attempts_check" CHECK ("failed_attempt_count" >= 0 AND "failed_attempt_count" <= 5),
  CONSTRAINT "signed_share_verification_lock_check" CHECK ("locked_until" IS NULL OR "locked_until" > "window_started_at")
);

ALTER TABLE "investor_demo_accounts" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "investor_demo_accounts" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "investor_demo_dataset_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_call_events" ADD FOREIGN KEY ("room_id") REFERENCES "lawyer_call_rooms"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_call_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_call_participants" ADD FOREIGN KEY ("room_id") REFERENCES "lawyer_call_rooms"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_call_participants" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_call_rooms" ADD FOREIGN KEY ("consultation_id") REFERENCES "lawyer_consultations"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_call_rooms" ADD FOREIGN KEY ("ended_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_call_signals" ADD FOREIGN KEY ("room_id") REFERENCES "lawyer_call_rooms"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_call_signals" ADD FOREIGN KEY ("sender_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_call_signals" ADD FOREIGN KEY ("recipient_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_conflict_search_events" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_knowledge_items" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_knowledge_items" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_knowledge_items" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_knowledge_items" ADD FOREIGN KEY ("client_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_profile_deletion_requests" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_profile_deletion_requests" ADD FOREIGN KEY ("requested_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_profile_deletion_requests" ADD FOREIGN KEY ("reviewed_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_profile_publication_events" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_profile_publication_events" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_profile_revisions" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_profile_revisions" ADD FOREIGN KEY ("actor_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_request_internal_notes" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_request_internal_notes" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_request_internal_notes" ADD FOREIGN KEY ("author_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_request_internal_notes" ADD FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON UPDATE no action ON DELETE set null;

ALTER TABLE "lawyer_request_internal_notes" ADD FOREIGN KEY ("converted_task_id") REFERENCES "tasks"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "lawyer_request_message_typing" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_request_message_typing" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_time_entries" ADD FOREIGN KEY ("lawyer_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_time_entries" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_time_entries" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_time_entries" ADD FOREIGN KEY ("lawyer_request_id") REFERENCES "lawyer_requests"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "lawyer_trials" ADD FOREIGN KEY ("lawyer_profile_id") REFERENCES "lawyer_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_email_jobs" ADD FOREIGN KEY ("preference_id") REFERENCES "monitoring_preferences"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_email_jobs" ADD FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_email_jobs" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_email_jobs" ADD FOREIGN KEY ("user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_task_sources" ADD FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_task_sources" ADD FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_task_sources" ADD FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON UPDATE no action ON DELETE cascade;

ALTER TABLE "monitoring_task_sources" ADD FOREIGN KEY ("change_event_id") REFERENCES "legal_monitoring_change_events"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "monitoring_task_sources" ADD FOREIGN KEY ("created_by_user_id") REFERENCES "user_profiles"("id") ON UPDATE no action ON DELETE restrict;

ALTER TABLE "signed_share_verification_guards" ADD FOREIGN KEY ("share_id") REFERENCES "standalone_signed_pdf_shares"("id") ON UPDATE no action ON DELETE cascade;

CREATE INDEX "investor_demo_accounts_status_idx"
  ON "investor_demo_accounts" ("status","updated_at");

CREATE UNIQUE INDEX "investor_demo_accounts_user_uidx"
  ON "investor_demo_accounts" ("user_id");

CREATE INDEX "investor_demo_dataset_events_version_idx"
  ON "investor_demo_dataset_events" ("dataset_version","created_at");

CREATE INDEX "lawyer_call_events_room_idx"
  ON "lawyer_call_events" ("room_id","created_at");

CREATE INDEX "lawyer_call_participants_presence_idx"
  ON "lawyer_call_participants" ("room_id","last_seen_at");

CREATE UNIQUE INDEX "lawyer_call_rooms_consultation_uidx"
  ON "lawyer_call_rooms" ("consultation_id");

CREATE INDEX "lawyer_call_rooms_status_idx"
  ON "lawyer_call_rooms" ("status","updated_at");

CREATE INDEX "lawyer_call_signals_expiry_idx"
  ON "lawyer_call_signals" ("expires_at");

CREATE INDEX "lawyer_call_signals_recipient_idx"
  ON "lawyer_call_signals" ("room_id","recipient_user_id","created_at","id");

CREATE INDEX "lawyer_conflict_search_events_user_idx"
  ON "lawyer_conflict_search_events" ("lawyer_user_id","created_at");

CREATE INDEX "lawyer_knowledge_items_case_idx"
  ON "lawyer_knowledge_items" ("lawyer_user_id","case_id","updated_at");

CREATE INDEX "lawyer_knowledge_items_client_idx"
  ON "lawyer_knowledge_items" ("lawyer_user_id","client_user_id","updated_at");

CREATE INDEX "lawyer_knowledge_items_user_idx"
  ON "lawyer_knowledge_items" ("lawyer_user_id","archived_at","updated_at");

CREATE UNIQUE INDEX "lawyer_profile_deletion_requests_open_uidx"
  ON "lawyer_profile_deletion_requests" ("lawyer_profile_id")
  WHERE "status"='requested';

CREATE INDEX "lawyer_profile_deletion_requests_status_idx"
  ON "lawyer_profile_deletion_requests" ("status","requested_at");

CREATE INDEX "lawyer_profile_publication_events_actor_idx"
  ON "lawyer_profile_publication_events" ("actor_user_id","created_at");

CREATE UNIQUE INDEX "lawyer_profile_publication_events_revision_uidx"
  ON "lawyer_profile_publication_events" ("lawyer_profile_id","profile_revision");

CREATE INDEX "lawyer_profile_revisions_created_idx"
  ON "lawyer_profile_revisions" ("lawyer_profile_id","created_at");

CREATE UNIQUE INDEX "lawyer_profile_revisions_version_uidx"
  ON "lawyer_profile_revisions" ("lawyer_profile_id","next_revision");

CREATE INDEX "lawyer_request_internal_notes_request_idx"
  ON "lawyer_request_internal_notes" ("lawyer_request_id","created_at" DESC);

CREATE INDEX "lawyer_request_message_typing_expiry_idx"
  ON "lawyer_request_message_typing" ("expires_at");

CREATE INDEX "lawyer_time_entries_case_idx"
  ON "lawyer_time_entries" ("lawyer_user_id","case_id","started_at");

CREATE UNIQUE INDEX "lawyer_time_entries_one_running_uidx"
  ON "lawyer_time_entries" ("lawyer_user_id") WHERE "status"='running';

CREATE INDEX "lawyer_trials_expiry_idx"
  ON "lawyer_trials" ("status","ends_at");

CREATE UNIQUE INDEX "lawyer_trials_profile_uidx"
  ON "lawyer_trials" ("lawyer_profile_id");

CREATE UNIQUE INDEX "monitoring_email_jobs_notification_uidx" ON "monitoring_email_jobs" ("notification_id");

CREATE INDEX "monitoring_email_jobs_status_idx" ON "monitoring_email_jobs" ("status","updated_at","id");

CREATE INDEX "monitoring_email_jobs_user_idx" ON "monitoring_email_jobs" ("user_id","created_at");

CREATE UNIQUE INDEX "monitoring_email_jobs_window_uidx" ON "monitoring_email_jobs" ("preference_id","cursor_from","cursor_through");

CREATE UNIQUE INDEX "monitoring_task_sources_case_event_actor_uidx"
  ON "monitoring_task_sources" ("case_id","change_event_id","created_by_user_id");

CREATE INDEX "monitoring_task_sources_event_idx"
  ON "monitoring_task_sources" ("change_event_id","created_at");

CREATE UNIQUE INDEX "monitoring_task_sources_task_uidx"
  ON "monitoring_task_sources" ("task_id");

CREATE INDEX "signed_share_verification_guards_lock_idx" ON "signed_share_verification_guards" ("locked_until");

-- investor_demo_dataset_events_no_delete
CREATE FUNCTION guard_investor_demo_dataset_events_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'INVESTOR_DEMO_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "investor_demo_dataset_events_no_delete" BEFORE DELETE ON "investor_demo_dataset_events"
FOR EACH ROW EXECUTE FUNCTION guard_investor_demo_dataset_events_no_delete();

-- investor_demo_dataset_events_no_update
CREATE FUNCTION guard_investor_demo_dataset_events_no_update() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'INVESTOR_DEMO_EVENT_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "investor_demo_dataset_events_no_update" BEFORE UPDATE ON "investor_demo_dataset_events"
FOR EACH ROW EXECUTE FUNCTION guard_investor_demo_dataset_events_no_update();

-- lawyer_conflict_search_events_no_delete
CREATE FUNCTION guard_lawyer_conflict_search_events_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LAWYER_CONFLICT_SEARCH_APPEND_ONLY', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_conflict_search_events_no_delete" BEFORE DELETE ON "lawyer_conflict_search_events"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_conflict_search_events_no_delete();

-- lawyer_conflict_search_events_no_update
CREATE FUNCTION guard_lawyer_conflict_search_events_no_update() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LAWYER_CONFLICT_SEARCH_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_conflict_search_events_no_update" BEFORE UPDATE ON "lawyer_conflict_search_events"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_conflict_search_events_no_update();

-- lawyer_knowledge_items_identity_guard
CREATE FUNCTION guard_lawyer_knowledge_items_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
  OR NEW."lawyer_user_id"<>OLD."lawyer_user_id"
  OR NEW."workspace_id"<>OLD."workspace_id"
  OR NEW."client_user_id" IS DISTINCT FROM OLD."client_user_id"
  OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'LAWYER_KNOWLEDGE_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_knowledge_items_identity_guard" BEFORE UPDATE ON "lawyer_knowledge_items"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_knowledge_items_identity_guard();

-- lawyer_knowledge_items_no_delete
CREATE FUNCTION guard_lawyer_knowledge_items_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LAWYER_KNOWLEDGE_ARCHIVE_REQUIRED', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_knowledge_items_no_delete" BEFORE DELETE ON "lawyer_knowledge_items"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_knowledge_items_no_delete();

-- lawyer_profile_deletion_requests_identity_guard
CREATE FUNCTION guard_lawyer_profile_deletion_requests_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
  OR NEW."lawyer_profile_id"<>OLD."lawyer_profile_id"
  OR NEW."requested_by_user_id"<>OLD."requested_by_user_id"
  OR NEW."requested_at"<>OLD."requested_at"
  OR NEW."created_at"<>OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile deletion request identity is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_deletion_requests_identity_guard" BEFORE UPDATE ON "lawyer_profile_deletion_requests"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_profile_deletion_requests_identity_guard();

-- lawyer_profile_deletion_requests_no_delete
CREATE FUNCTION guard_lawyer_profile_deletion_requests_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile deletion requests are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_deletion_requests_no_delete" BEFORE DELETE ON "lawyer_profile_deletion_requests"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_profile_deletion_requests_no_delete();

-- lawyer_profile_deletion_requests_terminal_guard
CREATE FUNCTION guard_lawyer_profile_deletion_requests_terminal_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF OLD."status" IN ('approved','rejected','cancelled') THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile deletion request is terminal', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_deletion_requests_terminal_guard" BEFORE UPDATE ON "lawyer_profile_deletion_requests"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_profile_deletion_requests_terminal_guard();

-- lawyer_profile_publication_events_no_delete
CREATE FUNCTION guard_lawyer_profile_publication_events_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile publication events are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_publication_events_no_delete" BEFORE DELETE ON "lawyer_profile_publication_events"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_profile_publication_events_no_delete();

-- lawyer_profile_publication_events_no_update
CREATE FUNCTION guard_lawyer_profile_publication_events_no_update() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile publication events are immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_publication_events_no_update" BEFORE UPDATE ON "lawyer_profile_publication_events"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_profile_publication_events_no_update();

-- lawyer_profile_revisions_no_delete
CREATE FUNCTION guard_lawyer_profile_revisions_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile revisions are append-only', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_revisions_no_delete" BEFORE DELETE ON "lawyer_profile_revisions"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_profile_revisions_no_delete();

-- lawyer_profile_revisions_no_update
CREATE FUNCTION guard_lawyer_profile_revisions_no_update() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'lawyer profile revisions are immutable', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_profile_revisions_no_update" BEFORE UPDATE ON "lawyer_profile_revisions"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_profile_revisions_no_update();

-- lawyer_request_internal_notes_identity_immutable
CREATE FUNCTION guard_lawyer_request_internal_notes_identity_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
  OR NEW."lawyer_request_id"<>OLD."lawyer_request_id"
  OR NEW."case_id"<>OLD."case_id"
  OR NEW."author_user_id"<>OLD."author_user_id"
  OR NEW."body"<>OLD."body"
  OR NEW."document_id" IS DISTINCT FROM OLD."document_id"
  OR NEW."created_at"<>OLD."created_at"
  OR OLD."converted_task_id" IS NOT NULL
  OR NEW."converted_task_id" IS NULL THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer request internal note is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_internal_notes_identity_immutable" BEFORE UPDATE ON "lawyer_request_internal_notes"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_request_internal_notes_identity_immutable();

-- lawyer_request_internal_notes_scope_guard
CREATE FUNCTION guard_lawyer_request_internal_notes_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NOT EXISTS (
  SELECT 1 FROM "lawyer_requests" request
  WHERE request."id"=NEW."lawyer_request_id"
    AND request."case_id"=NEW."case_id"
) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer request internal note scope is invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_internal_notes_scope_guard" BEFORE INSERT ON "lawyer_request_internal_notes"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_request_internal_notes_scope_guard();

-- lawyer_request_internal_notes_task_scope_guard
CREATE FUNCTION guard_lawyer_request_internal_notes_task_scope_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."converted_task_id" IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM "tasks" task
  WHERE task."id"=NEW."converted_task_id"
    AND task."case_id"=NEW."case_id"
    AND task."owner_user_id"=NEW."author_user_id"
) THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer request internal note task scope is invalid', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_internal_notes_task_scope_guard" BEFORE UPDATE OF "converted_task_id" ON "lawyer_request_internal_notes"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_request_internal_notes_task_scope_guard();

-- lawyer_request_message_typing_identity_immutable
CREATE FUNCTION guard_lawyer_request_message_typing_identity_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."lawyer_request_id"<>OLD."lawyer_request_id"
  OR NEW."user_id"<>OLD."user_id"
  OR NEW."role"<>OLD."role" THEN
RAISE EXCEPTION USING MESSAGE = 'lawyer request typing identity is immutable', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_request_message_typing_identity_immutable" BEFORE UPDATE ON "lawyer_request_message_typing"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_request_message_typing_identity_immutable();

-- lawyer_time_entries_identity_guard
CREATE FUNCTION guard_lawyer_time_entries_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."id"<>OLD."id"
  OR NEW."lawyer_user_id"<>OLD."lawyer_user_id"
  OR NEW."workspace_id"<>OLD."workspace_id"
  OR NEW."case_id"<>OLD."case_id"
  OR NEW."lawyer_request_id"<>OLD."lawyer_request_id"
  OR NEW."source"<>OLD."source"
  OR NEW."started_at"<>OLD."started_at"
  OR NEW."created_at"<>OLD."created_at"
  OR OLD."status"='completed' THEN
RAISE EXCEPTION USING MESSAGE = 'LAWYER_TIME_ENTRY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "lawyer_time_entries_identity_guard" BEFORE UPDATE ON "lawyer_time_entries"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_time_entries_identity_guard();

-- lawyer_time_entries_no_delete
CREATE FUNCTION guard_lawyer_time_entries_no_delete() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'LAWYER_TIME_ENTRY_APPEND_ONLY', ERRCODE = '23514';
RETURN OLD;
END;
$guard$;
CREATE TRIGGER "lawyer_time_entries_no_delete" BEFORE DELETE ON "lawyer_time_entries"
FOR EACH ROW EXECUTE FUNCTION guard_lawyer_time_entries_no_delete();

-- monitoring_email_jobs_identity_immutable
CREATE FUNCTION guard_monitoring_email_jobs_identity_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."id" IS DISTINCT FROM OLD."id"
	OR NEW."preference_id" IS DISTINCT FROM OLD."preference_id"
	OR NEW."notification_id" IS DISTINCT FROM OLD."notification_id"
	OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
	OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
	OR NEW."frequency" IS DISTINCT FROM OLD."frequency"
	OR NEW."locale" IS DISTINCT FROM OLD."locale"
	OR NEW."cursor_from" IS DISTINCT FROM OLD."cursor_from"
	OR NEW."cursor_through" IS DISTINCT FROM OLD."cursor_through"
	OR NEW."event_count" IS DISTINCT FROM OLD."event_count"
	OR NEW."official_url" IS DISTINCT FROM OLD."official_url"
	OR NEW."created_at" IS DISTINCT FROM OLD."created_at" THEN
RAISE EXCEPTION USING MESSAGE = 'MONITORING_EMAIL_IDENTITY_IMMUTABLE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "monitoring_email_jobs_identity_immutable" BEFORE UPDATE ON "monitoring_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_monitoring_email_jobs_identity_immutable();

-- monitoring_email_jobs_insert_guard
CREATE FUNCTION guard_monitoring_email_jobs_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."status"<>'pending'
	OR NEW."attempt_count"<>0
	OR NEW."provider_message_id" IS NOT NULL
	OR NEW."error_code" IS NOT NULL
	OR NEW."sent_at" IS NOT NULL
	OR NOT EXISTS (
		SELECT 1
		FROM "monitoring_preferences" preference
		JOIN "notifications" notification
			ON notification."id"=NEW."notification_id"
			AND notification."workspace_id"=preference."workspace_id"
			AND notification."user_id"=preference."user_id"
			AND notification."type"='legislation_monitor'
		JOIN "workspace_members" member
			ON member."workspace_id"=preference."workspace_id"
			AND member."user_id"=preference."user_id"
			AND member."status"='active'
		WHERE preference."id"=NEW."preference_id"
			AND preference."workspace_id"=NEW."workspace_id"
			AND preference."user_id"=NEW."user_id"
			AND preference."frequency"=NEW."frequency"
			AND preference."locale"=NEW."locale"
			AND preference."last_delivered_at"=NEW."cursor_from"
			AND instr(preference."channels_json",'"email"')>0
	) THEN
RAISE EXCEPTION USING MESSAGE = 'MONITORING_EMAIL_SOURCE_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "monitoring_email_jobs_insert_guard" BEFORE INSERT ON "monitoring_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_monitoring_email_jobs_insert_guard();

-- monitoring_email_jobs_sent_guard
CREATE FUNCTION guard_monitoring_email_jobs_sent_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NEW."status"='sent' AND NOT EXISTS (
	SELECT 1
	FROM "monitoring_preferences" preference
	JOIN "notifications" notification
		ON notification."id"=NEW."notification_id"
		AND notification."workspace_id"=preference."workspace_id"
		AND notification."user_id"=preference."user_id"
		AND notification."type"='legislation_monitor'
	JOIN "workspace_members" member
		ON member."workspace_id"=preference."workspace_id"
		AND member."user_id"=preference."user_id"
		AND member."status"='active'
	WHERE preference."id"=NEW."preference_id"
		AND preference."workspace_id"=NEW."workspace_id"
		AND preference."user_id"=NEW."user_id"
		AND preference."last_delivered_at">=NEW."cursor_through"
		AND instr(preference."channels_json",'"email"')>0
) THEN
RAISE EXCEPTION USING MESSAGE = 'MONITORING_EMAIL_SOURCE_STALE', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "monitoring_email_jobs_sent_guard" BEFORE UPDATE ON "monitoring_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_monitoring_email_jobs_sent_guard();

-- monitoring_email_jobs_transition_guard
CREATE FUNCTION guard_monitoring_email_jobs_transition_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NOT (
	(OLD."status" IN ('pending','retrying') AND NEW."status"='sending'
		AND NEW."attempt_count"=OLD."attempt_count"+1
		AND NEW."provider_message_id" IS NULL AND NEW."error_code" IS NULL AND NEW."sent_at" IS NULL)
	OR (OLD."status"='sending' AND NEW."status"='sending'
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
		AND NEW."provider_message_id" IS NULL AND NEW."error_code" IS NOT NULL AND NEW."sent_at" IS NULL)
) THEN
RAISE EXCEPTION USING MESSAGE = 'MONITORING_EMAIL_TRANSITION_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "monitoring_email_jobs_transition_guard" BEFORE UPDATE ON "monitoring_email_jobs"
FOR EACH ROW EXECUTE FUNCTION guard_monitoring_email_jobs_transition_guard();

-- monitoring_task_sources_insert_guard
CREATE FUNCTION guard_monitoring_task_sources_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
IF NOT EXISTS (
    SELECT 1 FROM "tasks" t
    WHERE t."id"=NEW."task_id"
      AND t."workspace_id"=NEW."workspace_id"
      AND t."case_id"=NEW."case_id"
      AND t."owner_user_id"=NEW."created_by_user_id"
      AND t."plan_step_id" IS NULL
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MONITORING_TASK_SCOPE_INVALID', ERRCODE = '23514';
END IF;
IF NOT EXISTS (
    SELECT 1
    FROM "legal_monitoring_change_events" e
    JOIN "legal_monitoring_metadata" m ON m."id"=e."metadata_id"
    WHERE e."id"=NEW."change_event_id"
      AND e."canonical_url"=NEW."official_url"
      AND e."detected_at"=NEW."source_detected_at"
      AND m."act_title"=NEW."source_title"
      AND m."canonical_id" IS NOT DISTINCT FROM NEW."source_identifier"
      AND m."last_checked_at"=NEW."source_last_checked_at"
      AND m."http_status" BETWEEN 200 AND 299
      AND m."last_error_code" IS NULL
  ) THEN
RAISE EXCEPTION USING MESSAGE = 'MONITORING_TASK_SOURCE_INVALID', ERRCODE = '23514';
END IF;
IF CAST(json_extract(NEW."snapshot_json",'$.schemaVersion') AS numeric)<>1
     OR json_extract(NEW."snapshot_json",'$.evidenceKind')<>'lex_metadata_monitor'
     OR json_extract(NEW."snapshot_json",'$.changeEventId')<>NEW."change_event_id"
     OR json_extract(NEW."snapshot_json",'$.officialUrl')<>NEW."official_url"
     OR json_extract(NEW."snapshot_json",'$.sourceTitle')<>NEW."source_title"
     OR json_extract(NEW."snapshot_json",'$.detectedAt')<>NEW."source_detected_at"
     OR json_extract(NEW."snapshot_json",'$.sourceLastCheckedAt')<>NEW."source_last_checked_at" THEN
RAISE EXCEPTION USING MESSAGE = 'MONITORING_TASK_SNAPSHOT_INVALID', ERRCODE = '23514';
END IF;
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "monitoring_task_sources_insert_guard" BEFORE INSERT ON "monitoring_task_sources"
FOR EACH ROW EXECUTE FUNCTION guard_monitoring_task_sources_insert_guard();

-- monitoring_task_sources_no_update
CREATE FUNCTION guard_monitoring_task_sources_no_update() RETURNS trigger LANGUAGE plpgsql SET search_path = app, public AS $guard$
BEGIN
RAISE EXCEPTION USING MESSAGE = 'MONITORING_TASK_SOURCE_IMMUTABLE', ERRCODE = '23514';
RETURN NEW;
END;
$guard$;
CREATE TRIGGER "monitoring_task_sources_no_update" BEFORE UPDATE ON "monitoring_task_sources"
FOR EACH ROW EXECUTE FUNCTION guard_monitoring_task_sources_no_update();

RESET search_path;
