CREATE TABLE app.control_admin_challenges (
 id text PRIMARY KEY, email text NOT NULL, code_hash text NOT NULL, expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX control_admin_challenge_email_idx ON app.control_admin_challenges(email,created_at DESC);
CREATE TABLE app.control_admin_rate_limits (key text PRIMARY KEY, window_start timestamptz NOT NULL, count integer NOT NULL);
CREATE TABLE app.control_admin_sessions (
 id text PRIMARY KEY, email text NOT NULL, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
 revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.control_admin_audit (
 id text PRIMARY KEY, actor_email text NOT NULL, action text NOT NULL, entity_type text, entity_id text,
 metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION app.control_admin_audit_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Control Center audit is append-only'; END; $$;
CREATE TRIGGER control_admin_audit_immutable BEFORE UPDATE OR DELETE ON app.control_admin_audit
 FOR EACH ROW EXECUTE FUNCTION app.control_admin_audit_immutable();
CREATE TABLE app.control_admin_notes (id text PRIMARY KEY, entity_type text NOT NULL, entity_id text NOT NULL,
 body text NOT NULL, actor_email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.control_account_blocks (user_id text PRIMARY KEY REFERENCES app.user_profiles(id) ON DELETE CASCADE,
 reason text NOT NULL, actor_email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.control_settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.control_delivery_jobs (id text PRIMARY KEY, user_id text REFERENCES app.user_profiles(id) ON DELETE SET NULL,
 subject text NOT NULL, body text NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
 last_error text, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz);
CREATE INDEX control_admin_audit_created_idx ON app.control_admin_audit(created_at DESC);
CREATE INDEX control_admin_notes_entity_idx ON app.control_admin_notes(entity_type,entity_id,created_at DESC);
CREATE TABLE app.control_template_versions (id text PRIMARY KEY, code text NOT NULL, version text NOT NULL,
 definition jsonb NOT NULL, published_at timestamptz, actor_email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(code,version));
CREATE INDEX control_template_versions_code_idx ON app.control_template_versions(code,created_at DESC);
CREATE TABLE app.control_product_events (
 id text PRIMARY KEY, event text NOT NULL, application text NOT NULL, visitor_id text NOT NULL,
 session_id text NOT NULL, page text NOT NULL, source text, medium text, campaign text, device text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(application,id)
);
CREATE INDEX control_product_events_period_idx ON app.control_product_events(application,created_at,event);
CREATE TABLE app.control_site_content (id text PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('faq','news','page')),
 slug text NOT NULL, locale text NOT NULL CHECK(locale IN ('ru','uz','en')), position integer NOT NULL DEFAULT 0,
 published_version_id text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,slug,locale));
CREATE TABLE app.control_site_content_versions (id text PRIMARY KEY, content_id text NOT NULL REFERENCES app.control_site_content(id),
 title text NOT NULL, description text NOT NULL, body text NOT NULL, image text, seo_title text, seo_description text,
 actor_email text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE app.control_site_content ADD FOREIGN KEY(published_version_id) REFERENCES app.control_site_content_versions(id);
CREATE TABLE app.control_ai_versions (id text PRIMARY KEY, version integer NOT NULL UNIQUE, settings jsonb NOT NULL,
 system_instructions text NOT NULL DEFAULT '', actor_email text NOT NULL, reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE app.control_ai_versions ADD COLUMN applied_at timestamptz;
ALTER TABLE app.control_site_content_versions ADD COLUMN slug text;
ALTER TABLE app.control_site_content_versions ADD COLUMN locale text;
ALTER TABLE app.control_site_content_versions ADD COLUMN kind text;
ALTER TABLE app.control_site_content_versions ADD COLUMN position integer;
CREATE INDEX control_user_registration_idx ON app.user_profiles(created_at,account_type);
CREATE INDEX control_session_activity_idx ON app.auth_sessions(last_seen_at,user_id);
CREATE INDEX control_ai_period_idx ON app.ai_runs(created_at,user_id);
-- The mailbox administrator does not need a separate JURO user registration.
ALTER TABLE app.lawyer_profile_moderation ALTER COLUMN moderator_user_id DROP NOT NULL;
ALTER TABLE app.lawyer_profile_moderation ADD COLUMN admin_session_id text REFERENCES app.control_admin_sessions(id);
ALTER TABLE app.lawyer_profile_moderation ADD CONSTRAINT control_moderation_actor_check CHECK(moderator_user_id IS NOT NULL OR admin_session_id IS NOT NULL);
ALTER TABLE app.lawyer_profile_lifecycle_events ALTER COLUMN actor_user_id DROP NOT NULL;
ALTER TABLE app.lawyer_profile_lifecycle_events ADD COLUMN admin_session_id text REFERENCES app.control_admin_sessions(id);
ALTER TABLE app.lawyer_profile_lifecycle_events ADD CONSTRAINT control_lifecycle_actor_check CHECK(actor_user_id IS NOT NULL OR admin_session_id IS NOT NULL);
ALTER TABLE app.support_messages ALTER COLUMN author_user_id DROP NOT NULL;
ALTER TABLE app.support_messages ADD COLUMN admin_session_id text REFERENCES app.control_admin_sessions(id);
ALTER TABLE app.support_messages ADD CONSTRAINT control_support_actor_check CHECK(author_user_id IS NOT NULL OR admin_session_id IS NOT NULL);

ALTER TABLE app.ai_cost_guard_policy_versions ALTER COLUMN created_by_user_id DROP NOT NULL;
