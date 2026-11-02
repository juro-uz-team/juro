-- Additive module data. Shared users, membership, contacts, cases, tasks and
-- documents remain in their existing tables. No pilot access is seeded.
SET search_path TO app, public;

CREATE TABLE practice_workspaces (
 workspace_id text PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false, pilot_until timestamptz,
 features jsonb NOT NULL DEFAULT '{}', seat_limit integer CHECK(seat_limit>0),
 provider_details jsonb NOT NULL DEFAULT '{}', settings jsonb NOT NULL DEFAULT '{}',
 granted_by text NOT NULL REFERENCES user_profiles(id), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE practice_contacts (
 contact_id text PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK(kind IN ('person','company')), email text,
 company_name text, requisites jsonb NOT NULL DEFAULT '{}',
 linked_user_id text REFERENCES user_profiles(id),
 UNIQUE(workspace_id,contact_id)
);
CREATE INDEX practice_contacts_workspace ON practice_contacts(workspace_id,contact_id);
CREATE TABLE practice_pipelines (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, stages jsonb NOT NULL CHECK(jsonb_array_length(stages)>0),
 UNIQUE(workspace_id,id)
);
CREATE TABLE practice_matters (
 case_id text PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 contact_id text NOT NULL, pipeline_id text NOT NULL, stage_id text NOT NULL,
 source text NOT NULL, service_type text NOT NULL DEFAULT 'legal_services',
 responsible_user_id text NOT NULL REFERENCES user_profiles(id),
 expected_minor bigint NOT NULL DEFAULT 0 CHECK(expected_minor>=0), currency text NOT NULL DEFAULT 'UZS',
 next_action text NOT NULL DEFAULT '', client_status text NOT NULL DEFAULT '',
 custom_fields jsonb NOT NULL DEFAULT '{}', revision integer NOT NULL DEFAULT 1,
 FOREIGN KEY(workspace_id,contact_id) REFERENCES practice_contacts(workspace_id,contact_id),
 FOREIGN KEY(workspace_id,pipeline_id) REFERENCES practice_pipelines(workspace_id,id),
 UNIQUE(workspace_id,case_id)
);
CREATE INDEX practice_matters_scope ON practice_matters(workspace_id,responsible_user_id,stage_id);
CREATE TABLE practice_assignments (
 case_id text NOT NULL REFERENCES practice_matters(case_id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
 PRIMARY KEY(case_id,user_id)
);
CREATE TABLE practice_tasks (
 task_id text PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 assignee_user_id text NOT NULL REFERENCES user_profiles(id),
 priority text NOT NULL CHECK(priority IN ('low','normal','high','urgent')),
 client_visible boolean NOT NULL DEFAULT false
);
CREATE TABLE practice_entries (
 id text PRIMARY KEY, case_id text NOT NULL REFERENCES practice_matters(case_id) ON DELETE CASCADE,
 author_user_id text NOT NULL REFERENCES user_profiles(id),
 kind text NOT NULL CHECK(kind IN ('note','message','milestone')),
 body text NOT NULL, client_visible boolean NOT NULL DEFAULT false,
 confirmed_by text REFERENCES user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX practice_entries_case ON practice_entries(case_id,created_at);
CREATE TABLE practice_invitations (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 contact_id text NOT NULL, token_hash text NOT NULL UNIQUE,
 invited_by text NOT NULL REFERENCES user_profiles(id), expires_at timestamptz NOT NULL,
 accepted_by text REFERENCES user_profiles(id), accepted_at timestamptz,
 confirmed_by text REFERENCES user_profiles(id), confirmed_at timestamptz, revoked_at timestamptz,
 FOREIGN KEY(workspace_id,contact_id) REFERENCES practice_contacts(workspace_id,contact_id)
);
CREATE TABLE practice_document_templates (
 id text PRIMARY KEY, workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, kind text NOT NULL, language text NOT NULL CHECK(language IN ('ru','uz','en')),
 content jsonb NOT NULL, docx_key text, fields jsonb NOT NULL DEFAULT '[]',
 is_draft boolean NOT NULL DEFAULT true, created_by text REFERENCES user_profiles(id),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE practice_documents (
 document_id text PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
 workspace_id text NOT NULL, case_id text NOT NULL,
 state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','review','changes_requested','agreed','awaiting_signed','signed_confirmed','cancelled','archived')),
 content jsonb NOT NULL, revision integer NOT NULL DEFAULT 1,
 client_visible boolean NOT NULL DEFAULT false, agreed_version_id text, published_version_id text,
 signed_file_id text REFERENCES document_files(id), signed_confirmed_by text REFERENCES user_profiles(id),
 signed_confirmed_at timestamptz, FOREIGN KEY(workspace_id,case_id) REFERENCES practice_matters(workspace_id,case_id)
);
CREATE TABLE practice_document_versions (
 id text PRIMARY KEY, document_id text NOT NULL REFERENCES practice_documents(document_id) ON DELETE CASCADE,
 revision integer NOT NULL, content jsonb NOT NULL, author_user_id text NOT NULL REFERENCES user_profiles(id),
 reason text NOT NULL, sha256 text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(document_id,revision), UNIQUE(document_id,id)
);
ALTER TABLE practice_documents ADD CONSTRAINT practice_agreed_version_fk
 FOREIGN KEY(document_id,agreed_version_id) REFERENCES practice_document_versions(document_id,id);
ALTER TABLE practice_documents ADD CONSTRAINT practice_published_version_fk
 FOREIGN KEY(document_id,published_version_id) REFERENCES practice_document_versions(document_id,id);
CREATE TABLE practice_document_reviews (
 id text PRIMARY KEY, document_id text NOT NULL REFERENCES practice_documents(document_id) ON DELETE CASCADE,
 revision integer NOT NULL, author_user_id text NOT NULL REFERENCES user_profiles(id),
 kind text NOT NULL CHECK(kind IN ('comment','proposal','approval')), anchor text NOT NULL DEFAULT '',
 body text NOT NULL, proposal jsonb, state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','accepted','rejected')),
 resolved_by text REFERENCES user_profiles(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE practice_signatures (
 id text PRIMARY KEY, version_id text NOT NULL REFERENCES practice_document_versions(id),
 file_id text NOT NULL REFERENCES document_files(id), confirmed_by text NOT NULL REFERENCES user_profiles(id),
 confirmed_at timestamptz NOT NULL DEFAULT now(), UNIQUE(version_id,file_id)
);
CREATE TABLE practice_files (
 file_id text PRIMARY KEY REFERENCES document_files(id) ON DELETE CASCADE,
 case_id text NOT NULL REFERENCES practice_matters(case_id) ON DELETE CASCADE,
 client_visible boolean NOT NULL DEFAULT false, uploaded_by text NOT NULL REFERENCES user_profiles(id),
 purpose text NOT NULL CHECK(purpose IN ('material','signed','payment_evidence','template')),
 version_id text REFERENCES practice_document_versions(id)
);
CREATE TABLE practice_invoices (
 id text PRIMARY KEY, workspace_id text NOT NULL, case_id text NOT NULL,
 document_id text REFERENCES practice_documents(document_id), number text NOT NULL,
 issued_on date NOT NULL, due_on date NOT NULL, currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 lines jsonb NOT NULL, total_minor bigint NOT NULL CHECK(total_minor>=0),
 provider_snapshot jsonb NOT NULL, customer_snapshot jsonb NOT NULL, fx_snapshot jsonb NOT NULL DEFAULT '{}',
 issued_by text NOT NULL REFERENCES user_profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,case_id) REFERENCES practice_matters(workspace_id,case_id),
 UNIQUE(workspace_id,number), UNIQUE(workspace_id,id)
);
CREATE TABLE practice_payments (
 id text PRIMARY KEY, workspace_id text NOT NULL, invoice_id text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor<>0), currency text NOT NULL,
 received_on date NOT NULL, method text NOT NULL, note text NOT NULL DEFAULT '',
 reverses_id text UNIQUE REFERENCES practice_payments(id), refund_of_id text REFERENCES practice_payments(id), evidence_file_id text REFERENCES practice_files(file_id),
 fx_snapshot jsonb NOT NULL DEFAULT '{}',
 confirmed_by text NOT NULL REFERENCES user_profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,invoice_id) REFERENCES practice_invoices(workspace_id,id)
);
CREATE INDEX practice_payments_invoice ON practice_payments(invoice_id,created_at);
CREATE TABLE practice_expenses (
 id text PRIMARY KEY, workspace_id text NOT NULL, case_id text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0), currency text NOT NULL CHECK(currency~'^[A-Z]{3}$'),
 incurred_on date NOT NULL, paid boolean NOT NULL, description text NOT NULL, fx_snapshot jsonb NOT NULL DEFAULT '{}',
 recorded_by text NOT NULL REFERENCES user_profiles(id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES practice_matters(workspace_id,case_id)
);
CREATE TABLE practice_time_entries (
 id text PRIMARY KEY, case_id text NOT NULL REFERENCES practice_matters(case_id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES user_profiles(id), minutes integer NOT NULL CHECK(minutes>0),
 hourly_minor bigint NOT NULL CHECK(hourly_minor>=0), currency text NOT NULL,
 worked_on date NOT NULL, description text NOT NULL, invoice_id text REFERENCES practice_invoices(id)
);
CREATE TABLE practice_commission_rules (
 id text PRIMARY KEY, version integer NOT NULL, source text NOT NULL, plan_code text NOT NULL,
 service_type text NOT NULL, rate_bps integer NOT NULL CHECK(rate_bps BETWEEN 0 AND 10000),
 active boolean NOT NULL DEFAULT false, created_by text NOT NULL REFERENCES user_profiles(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(source,plan_code,service_type,version)
);
CREATE TABLE practice_commissions (
 id text PRIMARY KEY, payment_id text NOT NULL UNIQUE REFERENCES practice_payments(id),
 rule_id text NOT NULL REFERENCES practice_commission_rules(id), rule_version integer NOT NULL,
 base_minor bigint NOT NULL, rate_bps integer NOT NULL, amount_minor bigint NOT NULL,
 basis text NOT NULL DEFAULT 'confirmed_receipt', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE practice_fx_rates (
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 currency text NOT NULL, base_currency text NOT NULL, rate numeric(30,12) NOT NULL CHECK(rate>0),
 rate_on date NOT NULL, recorded_by text NOT NULL REFERENCES user_profiles(id),
 PRIMARY KEY(workspace_id,currency,base_currency,rate_on)
);
CREATE TABLE practice_preferences (
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
 value jsonb NOT NULL, PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE practice_commands (
 workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES user_profiles(id), key text NOT NULL,
 request_hash text NOT NULL, response jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id,key)
);
CREATE TABLE practice_calendar_connections (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
 calendar_id text, encrypted_tokens text NOT NULL, sync_token text,
 state text NOT NULL DEFAULT 'connected', last_error text, last_synced_at timestamptz,
 UNIQUE(workspace_id,user_id)
);
CREATE TABLE practice_oauth_states (
 hash text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES user_profiles(id), verifier text NOT NULL,
 expires_at timestamptz NOT NULL, used_at timestamptz
);
CREATE TABLE practice_events (
 id text PRIMARY KEY, workspace_id text NOT NULL, case_id text NOT NULL,
 organizer_user_id text NOT NULL REFERENCES user_profiles(id),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL CHECK(ends_at>starts_at),
 timezone text NOT NULL DEFAULT 'Asia/Tashkent', status text NOT NULL DEFAULT 'confirmed',
 client_visible boolean NOT NULL DEFAULT false, title text NOT NULL,
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,case_id) REFERENCES practice_matters(workspace_id,case_id)
);
CREATE INDEX practice_events_time ON practice_events(organizer_user_id,starts_at,ends_at);
CREATE TABLE practice_google_events (
 connection_id text NOT NULL REFERENCES practice_calendar_connections(id) ON DELETE CASCADE,
 event_id text NOT NULL REFERENCES practice_events(id) ON DELETE CASCADE,
 google_id text NOT NULL, etag text, synced_revision integer NOT NULL, state text NOT NULL DEFAULT 'synced', remote_snapshot jsonb,
 PRIMARY KEY(connection_id,event_id), UNIQUE(connection_id,google_id)
);
CREATE TABLE practice_calendar_busy (
 connection_id text NOT NULL REFERENCES practice_calendar_connections(id) ON DELETE CASCADE,
 google_id text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 PRIMARY KEY(connection_id,google_id)
);
CREATE TABLE practice_notifications (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
 event_key text NOT NULL, kind text NOT NULL, entity_id text NOT NULL,
 email_state text NOT NULL DEFAULT 'pending', error_code text, attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,event_key)
);
CREATE TABLE practice_recurring_services (
 id text PRIMARY KEY, workspace_id text NOT NULL, case_id text NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor>0), currency text NOT NULL,
 description text NOT NULL, next_on date NOT NULL, interval_months integer NOT NULL CHECK(interval_months BETWEEN 1 AND 12),
 active boolean NOT NULL DEFAULT true, created_by text NOT NULL REFERENCES user_profiles(id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES practice_matters(workspace_id,case_id)
);
CREATE TABLE practice_recurring_runs (
 service_id text NOT NULL REFERENCES practice_recurring_services(id), period_on date NOT NULL,
 invoice_id text NOT NULL REFERENCES practice_invoices(id), PRIMARY KEY(service_id,period_on)
);
CREATE TABLE practice_case_templates (
 id text PRIMARY KEY, workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE,
 name text NOT NULL, fields jsonb NOT NULL DEFAULT '[]', tasks jsonb NOT NULL DEFAULT '[]',
 stages jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE practice_imports (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES user_profiles(id), rows jsonb NOT NULL, columns jsonb NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day'
);
CREATE TABLE practice_ai_drafts (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
 case_id text NOT NULL REFERENCES practice_matters(case_id), user_id text NOT NULL REFERENCES user_profiles(id),
 request_key text NOT NULL, request_hash text NOT NULL, ai_run_id text REFERENCES ai_runs(id),
 result jsonb, state text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,user_id,request_key)
);

-- Financial records and agreed content are historical evidence. Corrections
-- are new records, never updates to a posted receipt or invoice.
CREATE FUNCTION practice_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'PRACTICE_IMMUTABLE_RECORD'; END $$;
CREATE TRIGGER practice_invoice_immutable BEFORE UPDATE ON practice_invoices FOR EACH ROW EXECUTE FUNCTION practice_immutable();
CREATE TRIGGER practice_payment_immutable BEFORE UPDATE ON practice_payments FOR EACH ROW EXECUTE FUNCTION practice_immutable();
CREATE TRIGGER practice_version_immutable BEFORE UPDATE ON practice_document_versions FOR EACH ROW EXECUTE FUNCTION practice_immutable();
CREATE TRIGGER practice_rule_immutable BEFORE UPDATE ON practice_commission_rules FOR EACH ROW EXECUTE FUNCTION practice_immutable();
CREATE TRIGGER practice_commission_immutable BEFORE UPDATE ON practice_commissions FOR EACH ROW EXECUTE FUNCTION practice_immutable();
