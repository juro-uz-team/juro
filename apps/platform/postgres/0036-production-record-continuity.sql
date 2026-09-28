-- Preserve production metadata and historical fee evidence during native import.
-- These tables do not activate payment processing or change release flags.
CREATE TABLE app.billing_fee_policy_versions (
  id text PRIMARY KEY,
  version integer NOT NULL UNIQUE,
  mode text NOT NULL DEFAULT 'sandbox' CHECK (mode IN ('sandbox','production')),
  consultation_fee_basis_points integer NOT NULL DEFAULT 100 CHECK (consultation_fee_basis_points BETWEEN 0 AND 10000),
  installment_service_markup_basis_points integer NOT NULL DEFAULT 0 CHECK (installment_service_markup_basis_points BETWEEN 0 AND 10000),
  installment_waives_case_transfer integer NOT NULL DEFAULT 1 CHECK (installment_waives_case_transfer IN (0,1)),
  effective_from text NOT NULL,
  effective_to text,
  created_by_user_id text REFERENCES app.user_profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 2000),
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('system','admin')),
  created_at text NOT NULL,
  CHECK (effective_to IS NULL OR effective_from < effective_to)
);
CREATE INDEX billing_fee_policy_versions_effective_idx
  ON app.billing_fee_policy_versions(mode,effective_from,effective_to);

CREATE TABLE app.billing_case_transfer_fee_rules (
  id text PRIMARY KEY,
  version integer NOT NULL UNIQUE,
  label_ru text NOT NULL CHECK (length(trim(label_ru)) BETWEEN 3 AND 160),
  label_uz text NOT NULL CHECK (length(trim(label_uz)) BETWEEN 3 AND 160),
  legal_area text,
  case_type text,
  fee_basis_points integer NOT NULL CHECK (fee_basis_points IN (200,500)),
  priority integer NOT NULL DEFAULT 100 CHECK (priority BETWEEN 0 AND 10000),
  effective_from text NOT NULL,
  effective_to text,
  created_by_user_id text NOT NULL REFERENCES app.user_profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 2000),
  created_at text NOT NULL,
  CHECK (legal_area IS NOT NULL OR case_type IS NOT NULL),
  CHECK (effective_to IS NULL OR effective_from < effective_to)
);
CREATE INDEX billing_case_transfer_fee_rules_match_idx
  ON app.billing_case_transfer_fee_rules(legal_area,case_type,effective_from,effective_to,priority);

CREATE TABLE app.billing_fee_configuration_events (
  id text PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('fee_policy','case_transfer_rule')),
  entity_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('system_seeded','created')),
  actor_user_id text REFERENCES app.user_profiles(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 3 AND 2000),
  previous_snapshot_json text,
  next_snapshot_json text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX billing_fee_configuration_events_entity_idx
  ON app.billing_fee_configuration_events(entity_type,entity_id,created_at);

-- Retain the source's append-only and immutable billing-history contracts.
CREATE FUNCTION app.reject_billing_history_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE = TG_ARGV[0], ERRCODE = '23514';
END;
$$;
CREATE TRIGGER billing_fee_policy_versions_no_update
  BEFORE UPDATE ON app.billing_fee_policy_versions FOR EACH ROW
  EXECUTE FUNCTION app.reject_billing_history_mutation('BILLING_FEE_POLICY_IMMUTABLE');
CREATE TRIGGER billing_fee_policy_versions_no_delete
  BEFORE DELETE ON app.billing_fee_policy_versions FOR EACH ROW
  EXECUTE FUNCTION app.reject_billing_history_mutation('BILLING_FEE_POLICY_APPEND_ONLY');
CREATE TRIGGER billing_case_transfer_fee_rules_no_update
  BEFORE UPDATE ON app.billing_case_transfer_fee_rules FOR EACH ROW
  EXECUTE FUNCTION app.reject_billing_history_mutation('BILLING_FEE_RULE_IMMUTABLE');
CREATE TRIGGER billing_case_transfer_fee_rules_no_delete
  BEFORE DELETE ON app.billing_case_transfer_fee_rules FOR EACH ROW
  EXECUTE FUNCTION app.reject_billing_history_mutation('BILLING_FEE_RULE_APPEND_ONLY');
CREATE TRIGGER billing_fee_configuration_events_no_update
  BEFORE UPDATE ON app.billing_fee_configuration_events FOR EACH ROW
  EXECUTE FUNCTION app.reject_billing_history_mutation('BILLING_FEE_EVENT_IMMUTABLE');
CREATE TRIGGER billing_fee_configuration_events_no_delete
  BEFORE DELETE ON app.billing_fee_configuration_events FOR EACH ROW
  EXECUTE FUNCTION app.reject_billing_history_mutation('BILLING_FEE_EVENT_APPEND_ONLY');

ALTER TABLE app.demo_payment_runs
  ADD COLUMN service_kind text CHECK (service_kind IN ('subscription','consultation','case_transfer')),
  ADD COLUMN payment_method text CHECK (payment_method IN ('direct','installment')),
  ADD COLUMN legal_area text,
  ADD COLUMN fee_policy_version_id text REFERENCES app.billing_fee_policy_versions(id) ON DELETE RESTRICT,
  ADD COLUMN case_transfer_fee_rule_id text REFERENCES app.billing_case_transfer_fee_rules(id) ON DELETE RESTRICT,
  ADD COLUMN lawyer_service_amount_minor bigint CHECK (lawyer_service_amount_minor > 0),
  ADD COLUMN consultation_fee_amount_minor bigint CHECK (consultation_fee_amount_minor >= 0),
  ADD COLUMN case_transfer_fee_amount_minor bigint CHECK (case_transfer_fee_amount_minor >= 0),
  ADD COLUMN juro_service_markup_minor bigint CHECK (juro_service_markup_minor >= 0),
  ADD COLUMN client_total_minor bigint CHECK (client_total_minor > 0),
  ADD COLUMN lawyer_payout_minor bigint CHECK (lawyer_payout_minor >= 0),
  ADD COLUMN breakdown_json text;

ALTER TABLE app.notifications
  ADD COLUMN target_type text,
  ADD COLUMN target_id text;
ALTER TABLE app.standalone_signed_pdf_shares
  ADD COLUMN public_token_ciphertext text,
  ADD COLUMN public_token_iv text,
  ADD COLUMN public_token_key_version text,
  ADD COLUMN access_code_ciphertext text,
  ADD COLUMN access_code_iv text,
  ADD COLUMN access_code_key_version text;
ALTER TABLE app.lawyer_profiles
  ADD COLUMN publication_consent_at text,
  ADD COLUMN accepting_new_requests integer NOT NULL DEFAULT 1 CHECK (accepting_new_requests IN (0,1));
ALTER TABLE app.lawyer_requests
  ADD COLUMN lawyer_decision_claim_id text,
  ADD COLUMN lawyer_decision_by_user_id text REFERENCES app.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN lawyer_decision_at text;
ALTER TABLE app.lawyer_request_messages
  ADD COLUMN reply_to_message_id text,
  ADD COLUMN pinned_at text,
  ADD COLUMN pinned_by_user_id text;
ALTER TABLE app.lawyer_consultations
  ADD COLUMN attendance_outcome text CHECK (
    attendance_outcome IS NULL OR (
      attendance_outcome = 'no_show' AND status = 'completed' AND result_note IS NULL
    )
  );
