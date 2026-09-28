-- Preserve the source guards attached to the additional production metadata.
CREATE TRIGGER demo_payment_runs_fee_identity_immutable
  BEFORE UPDATE OF service_kind,payment_method,legal_area,fee_policy_version_id,
    case_transfer_fee_rule_id,lawyer_service_amount_minor,consultation_fee_amount_minor,
    case_transfer_fee_amount_minor,juro_service_markup_minor,client_total_minor,
    lawyer_payout_minor,breakdown_json
  ON app.demo_payment_runs FOR EACH ROW
  EXECUTE FUNCTION app.reject_billing_history_mutation('DEMO_PAYMENT_FEE_SNAPSHOT_IMMUTABLE');

ALTER TABLE app.standalone_signed_pdf_shares
  ADD CONSTRAINT signed_share_secret_shape_check CHECK (
    num_nulls(public_token_ciphertext,public_token_iv,public_token_key_version) IN (0,3)
    AND num_nulls(access_code_ciphertext,access_code_iv,access_code_key_version) IN (0,3)
    AND (public_token_ciphertext IS NULL OR (public_token = '' AND token_hash <> ''))
    AND (access_code_ciphertext IS NULL OR (access_code = '' AND access_code_hash <> ''))
  );

ALTER TABLE app.lawyer_request_messages
  ADD CONSTRAINT lawyer_request_message_pin_shape_check
    CHECK ((pinned_at IS NULL) = (pinned_by_user_id IS NULL));

CREATE FUNCTION app.guard_lawyer_message_reply() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.reply_to_message_id IS DISTINCT FROM OLD.reply_to_message_id THEN
      RAISE EXCEPTION USING MESSAGE = 'lawyer request message content is immutable', ERRCODE = '23514';
    END IF;
  ELSIF NEW.reply_to_message_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM app.lawyer_request_messages parent
    WHERE parent.id = NEW.reply_to_message_id AND parent.lawyer_request_id = NEW.lawyer_request_id
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'lawyer request message reply scope is invalid', ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lawyer_request_messages_reply_scope_guard
  BEFORE INSERT OR UPDATE OF reply_to_message_id ON app.lawyer_request_messages
  FOR EACH ROW EXECUTE FUNCTION app.guard_lawyer_message_reply();

-- Existing moderation remains valid; preserve the production consent path too.
CREATE FUNCTION app.guard_lawyer_publication_evidence() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.status IN ('public_approved','rejected') OR NEW.public_approved_at IS NOT NULL)
    AND NOT (
      NEW.status = 'public_approved'
      AND NEW.marketplace_status = 'public_approved'
      AND NEW.publication_consent_at IS NOT NULL
      AND NEW.publication_consent_at = NEW.public_approved_at
      AND NEW.user_id = OLD.user_id
    )
    AND NOT EXISTS (
      SELECT 1 FROM app.lawyer_profile_moderation m
      WHERE m.lawyer_profile_id = NEW.id AND m.profile_revision = NEW.profile_revision
        AND ((NEW.status = 'public_approved' AND m.decision = 'approved')
          OR (NEW.status = 'rejected' AND m.decision = 'rejected'))
    ) THEN
    RAISE EXCEPTION USING MESSAGE = 'lawyer profile moderation or publication consent evidence required', ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER lawyer_profiles_status_requires_moderation ON app.lawyer_profiles;
CREATE TRIGGER lawyer_profiles_status_requires_moderation
  BEFORE UPDATE OF status,public_approved_at ON app.lawyer_profiles
  FOR EACH ROW EXECUTE FUNCTION app.guard_lawyer_publication_evidence();
