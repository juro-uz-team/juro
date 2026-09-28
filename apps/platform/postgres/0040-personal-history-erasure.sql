-- Native history cleanup is atomic with the existing guarded account tombstone.
-- Audit identities, decisions and timestamps remain; personal free text is erased.
CREATE FUNCTION app.account_erasure_matches_user(subject_id text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = app, public AS $$
  SELECT pg_trigger_depth() > 0 AND EXISTS (
    SELECT 1 FROM app.account_deletion_requests r
    JOIN app.user_profiles u ON u.id = r.user_id
    WHERE r.id = current_setting('juro.completed_account_erasure',true)
      AND r.user_id = subject_id AND r.status = 'completed'
      AND u.lifecycle_status = 'deleted'
      AND u.deletion_completed_at = r.completed_at
  );
$$;

CREATE FUNCTION app.account_history_redaction_allowed(
  previous_row jsonb, next_row jsonb, subject_column text, profile_subject boolean, redaction jsonb
) RETURNS boolean LANGUAGE sql STABLE SET search_path = app, public AS $$
  SELECT coalesce(
    next_row @> redaction
    AND next_row - ARRAY(SELECT jsonb_object_keys(redaction)) = previous_row - ARRAY(SELECT jsonb_object_keys(redaction))
    AND CASE WHEN profile_subject THEN EXISTS (
      SELECT 1 FROM app.lawyer_profiles p WHERE p.id = previous_row ->> subject_column
        AND app.account_erasure_matches_user(p.user_id)
    ) ELSE app.account_erasure_matches_user(previous_row ->> subject_column) END,
    false
  );
$$;

-- Keep each original guard, with an exception only for the exact redacted fields
-- of the closing subject during the nested account-completion trigger.
DO $$
DECLARE
  guard record;
  definition text;
  predicate text;
BEGIN
  FOR guard IN SELECT * FROM (VALUES
    ('lawyer_profile_moderation','lawyer_profile_moderation_append_only_update','lawyer_profile_id',true,'{"reason":"[deleted by account closure]"}'),
    ('lawyer_profile_lifecycle_events','lawyer_profile_lifecycle_events_append_only_update','lawyer_profile_id',true,'{"reason":"[deleted by account closure]"}'),
    ('lawyer_profile_revisions','lawyer_profile_revisions_no_update','lawyer_profile_id',true,'{"reason":"[deleted by account closure]","previous_snapshot_json":"{}","next_snapshot_json":"{}"}'),
    ('lawyer_profile_deletion_requests','lawyer_profile_deletion_requests_terminal_guard','lawyer_profile_id',true,'{"reason":null,"decision_reason":null}'),
    ('lawyer_request_messages','lawyer_request_messages_content_immutable','author_user_id',false,'{"body":"[deleted by account closure]"}'),
    ('lawyer_request_internal_notes','lawyer_request_internal_notes_identity_immutable','author_user_id',false,'{"body":"[deleted by account closure]"}'),
    ('lawyer_task_comments','lawyer_task_comments_no_update','author_user_id',false,'{"body":"[deleted by account closure]"}'),
    ('lawyer_document_requests','lawyer_document_requests_immutable_fields','lawyer_user_id',false,'{"title":"[deleted by account closure]","description":"[deleted by account closure]"}'),
    ('investor_demo_dataset_events','investor_demo_dataset_events_no_update','actor_user_id',false,'{"summary_json":"{\"redacted\":true}"}')
  ) AS guards(table_name,trigger_name,subject_column,profile_subject,redaction)
  LOOP
    SELECT pg_get_triggerdef(t.oid) INTO STRICT definition FROM pg_trigger t
    WHERE t.tgrelid = ('app.' || guard.table_name)::regclass AND t.tgname = guard.trigger_name;
    IF position(' WHEN ' IN definition) > 0 THEN
      RAISE EXCEPTION 'Unexpected existing trigger predicate';
    END IF;
    predicate := format(' WHEN (NOT app.account_history_redaction_allowed(to_jsonb(OLD),to_jsonb(NEW),%L,%L,%L::jsonb)) ',
      guard.subject_column,guard.profile_subject,guard.redaction);
    definition := replace(definition,' EXECUTE FUNCTION ',predicate || 'EXECUTE FUNCTION ');
    EXECUTE format('DROP TRIGGER %I ON app.%I',guard.trigger_name,guard.table_name);
    EXECUTE definition;
  END LOOP;
END;
$$;

CREATE FUNCTION app.guard_personal_history_erasure() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, public AS $$
DECLARE row_data jsonb := to_jsonb(OLD);
BEGIN
  IF app.account_erasure_matches_user(row_data ->> 'lawyer_user_id')
    OR (TG_TABLE_NAME = 'lawyer_knowledge_items' AND app.account_erasure_matches_user(row_data ->> 'client_user_id'))
    OR (TG_TABLE_NAME = 'lawyer_time_entries' AND app.account_erasure_includes_case(row_data ->> 'case_id')) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING MESSAGE = TG_ARGV[0], ERRCODE = '23514';
END;
$$;
DROP TRIGGER lawyer_knowledge_items_no_delete ON app.lawyer_knowledge_items;
CREATE TRIGGER lawyer_knowledge_items_no_delete BEFORE DELETE ON app.lawyer_knowledge_items
  FOR EACH ROW EXECUTE FUNCTION app.guard_personal_history_erasure('LAWYER_KNOWLEDGE_ARCHIVE_REQUIRED');
DROP TRIGGER lawyer_time_entries_no_delete ON app.lawyer_time_entries;
CREATE TRIGGER lawyer_time_entries_no_delete BEFORE DELETE ON app.lawyer_time_entries
  FOR EACH ROW EXECUTE FUNCTION app.guard_personal_history_erasure('LAWYER_TIME_ENTRY_APPEND_ONLY');
DROP TRIGGER lawyer_conflict_search_events_no_delete ON app.lawyer_conflict_search_events;
CREATE TRIGGER lawyer_conflict_search_events_no_delete BEFORE DELETE ON app.lawyer_conflict_search_events
  FOR EACH ROW EXECUTE FUNCTION app.guard_personal_history_erasure('LAWYER_CONFLICT_SEARCH_APPEND_ONLY');

CREATE FUNCTION app.erase_completed_account_history() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, public AS $$
DECLARE
  request_id text;
  previous_context text;
BEGIN
  SELECT id INTO STRICT request_id FROM app.account_deletion_requests
  WHERE user_id = NEW.id AND status = 'completed' AND completed_at = NEW.deletion_completed_at;
  previous_context := current_setting('juro.completed_account_erasure',true);
  PERFORM set_config('juro.completed_account_erasure',request_id,true);

  DELETE FROM app.lawyer_knowledge_items WHERE lawyer_user_id = NEW.id OR client_user_id = NEW.id;
  DELETE FROM app.lawyer_time_entries WHERE lawyer_user_id = NEW.id;
  DELETE FROM app.lawyer_conflict_search_events WHERE lawyer_user_id = NEW.id;
  DELETE FROM app.investor_demo_accounts WHERE user_id = NEW.id;
  DELETE FROM app.lawyer_request_message_typing WHERE user_id = NEW.id;
  DELETE FROM app.lawyer_call_signals WHERE sender_user_id = NEW.id OR recipient_user_id = NEW.id;
  DELETE FROM app.lawyer_call_participants WHERE user_id = NEW.id;
  DELETE FROM app.lawyer_call_events WHERE actor_user_id = NEW.id;
  UPDATE app.lawyer_request_messages SET body = '[deleted by account closure]' WHERE author_user_id = NEW.id;
  UPDATE app.lawyer_request_internal_notes SET body = '[deleted by account closure]' WHERE author_user_id = NEW.id;
  UPDATE app.lawyer_task_comments SET body = '[deleted by account closure]' WHERE author_user_id = NEW.id;
  UPDATE app.lawyer_document_requests SET title = '[deleted by account closure]', description = '[deleted by account closure]'
    WHERE lawyer_user_id = NEW.id;
  UPDATE app.investor_demo_dataset_events SET summary_json = '{"redacted":true}' WHERE actor_user_id = NEW.id;
  UPDATE app.lawyer_consultations SET internal_note = NULL,result_note = NULL
    WHERE client_user_id = NEW.id OR lawyer_profile_id IN (SELECT id FROM app.lawyer_profiles WHERE user_id = NEW.id);

  -- Archive visible profiles using their existing lifecycle evidence contract.
  INSERT INTO app.lawyer_profile_lifecycle_events(
    id,lawyer_profile_id,from_profile_revision,to_profile_revision,actor_user_id,action,reason,
    from_profile_status,to_profile_status,from_marketplace_status,to_marketplace_status,created_at
  ) SELECT gen_random_uuid()::text,id,profile_revision,profile_revision,NEW.id,'archive','Account closed',
      status,'pending',marketplace_status,'archived',NEW.deletion_completed_at
    FROM app.lawyer_profiles WHERE user_id = NEW.id AND marketplace_status NOT IN ('suspended','blocked','archived');
  UPDATE app.lawyer_profiles SET status = 'pending',marketplace_status = 'archived',public_approved_at = NULL
    WHERE user_id = NEW.id AND marketplace_status NOT IN ('suspended','blocked','archived');
  UPDATE app.lawyer_profiles SET
    display_name = 'Closed JURO account',specialties_json = '[]',languages_json = '[]',
    experience_years = NULL,price_description = NULL,availability_status = 'unknown',next_available_at = NULL,
    advocate_status = 'not_declared',firm_name = NULL,bio = NULL,city = NULL,region = NULL,education = NULL,
    consultation_formats_json = '[]',profile_photo_key = NULL,profile_photo_mime = NULL,
    profile_photo_sha256 = NULL,profile_photo_size_bytes = NULL,additional_services_json = '[]',
    juro_approval_status = 'not_approved',juro_approved_at = NULL,juro_approved_by_user_id = NULL,
    top_lawyer_status = 'not_featured',top_lawyer_criteria = NULL,top_lawyer_at = NULL,accepting_new_requests = 0
    WHERE user_id = NEW.id;
  UPDATE app.lawyer_trials SET status = 'disabled',updated_at = NEW.deletion_completed_at
    WHERE lawyer_profile_id IN (SELECT id FROM app.lawyer_profiles WHERE user_id = NEW.id);
  UPDATE app.lawyer_profile_moderation SET reason = '[deleted by account closure]'
    WHERE lawyer_profile_id IN (SELECT id FROM app.lawyer_profiles WHERE user_id = NEW.id);
  UPDATE app.lawyer_profile_lifecycle_events SET reason = '[deleted by account closure]'
    WHERE lawyer_profile_id IN (SELECT id FROM app.lawyer_profiles WHERE user_id = NEW.id);
  UPDATE app.lawyer_profile_revisions SET reason = '[deleted by account closure]',previous_snapshot_json = '{}',next_snapshot_json = '{}'
    WHERE lawyer_profile_id IN (SELECT id FROM app.lawyer_profiles WHERE user_id = NEW.id);
  UPDATE app.lawyer_profile_deletion_requests SET reason = NULL,decision_reason = NULL
    WHERE lawyer_profile_id IN (SELECT id FROM app.lawyer_profiles WHERE user_id = NEW.id);

  PERFORM set_config('juro.completed_account_erasure',coalesce(previous_context,''),true);
  RETURN NEW;
END;
$$;
CREATE TRIGGER user_profiles_erase_personal_history AFTER UPDATE OF lifecycle_status ON app.user_profiles
  FOR EACH ROW WHEN (OLD.lifecycle_status = 'active' AND NEW.lifecycle_status = 'deleted')
  EXECUTE FUNCTION app.erase_completed_account_history();
