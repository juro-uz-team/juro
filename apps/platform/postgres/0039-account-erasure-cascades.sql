-- Ordinary history deletion remains forbidden. During a fenced account purge,
-- the case owner has explicitly entered irreversible erasure and the existing
-- case foreign keys must be able to remove that case's dependent private history.
CREATE FUNCTION app.capture_account_erasure_case() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, public AS $$
DECLARE
  purge record;
  scope jsonb;
BEGIN
  SELECT id,user_id,purge_lease_owner INTO purge
  FROM app.account_deletion_requests
  WHERE user_id = OLD.owner_user_id AND status = 'purging'
    AND purge_irreversible_at IS NOT NULL
    AND purge_lease_owner IS NOT NULL
    AND purge_lease_expires_at::timestamptz > clock_timestamp()
  FOR SHARE;
  IF NOT FOUND THEN RETURN OLD; END IF;

  scope := coalesce(nullif(current_setting('juro.account_erasure_cases',true),''),'{}')::jsonb;
  scope := scope || jsonb_build_object(OLD.id,jsonb_build_object(
    'request',purge.id,'user',purge.user_id,'lease',purge.purge_lease_owner,
    'tasks',(SELECT coalesce(jsonb_agg(id),'[]'::jsonb) FROM app.tasks WHERE case_id = OLD.id)
  ));
  PERFORM set_config('juro.account_erasure_cases',scope::text,true);
  RETURN OLD;
END;
$$;
CREATE TRIGGER cases_capture_account_erasure
  BEFORE DELETE ON app.cases FOR EACH ROW
  EXECUTE FUNCTION app.capture_account_erasure_case();

CREATE FUNCTION app.account_erasure_includes_case(case_id text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path = app, public AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.account_deletion_requests request
    CROSS JOIN LATERAL (
      SELECT coalesce(nullif(current_setting('juro.account_erasure_cases',true),''),'{}')::jsonb -> case_id AS entry
    ) scope
    WHERE request.id = scope.entry ->> 'request'
      AND request.user_id = scope.entry ->> 'user'
      AND request.purge_lease_owner = scope.entry ->> 'lease'
      AND request.status = 'purging'
      AND request.purge_irreversible_at IS NOT NULL
      AND request.purge_lease_owner IS NOT NULL
      AND request.purge_lease_expires_at::timestamptz > clock_timestamp()
      -- Only a real FK cascade qualifies; a direct DELETE must stay forbidden.
      AND pg_trigger_depth() > 1
  );
$$;

CREATE FUNCTION app.guard_case_history_erasure() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, public AS $$
BEGIN
  IF NOT app.account_erasure_includes_case(OLD.case_id) THEN
    RAISE EXCEPTION USING MESSAGE = TG_ARGV[0], ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER case_lifecycle_events_no_delete ON app.case_lifecycle_events;
CREATE TRIGGER case_lifecycle_events_no_delete
  BEFORE DELETE ON app.case_lifecycle_events FOR EACH ROW
  EXECUTE FUNCTION app.guard_case_history_erasure('CASE_LIFECYCLE_EVENT_IMMUTABLE');

DROP TRIGGER lawyer_time_entries_no_delete ON app.lawyer_time_entries;
CREATE TRIGGER lawyer_time_entries_no_delete
  BEFORE DELETE ON app.lawyer_time_entries FOR EACH ROW
  EXECUTE FUNCTION app.guard_case_history_erasure('LAWYER_TIME_ENTRY_APPEND_ONLY');

DROP TRIGGER lawyer_document_requests_no_delete ON app.lawyer_document_requests;
CREATE TRIGGER lawyer_document_requests_no_delete
  BEFORE DELETE ON app.lawyer_document_requests FOR EACH ROW
  EXECUTE FUNCTION app.guard_case_history_erasure('lawyer document requests are append-only');

CREATE FUNCTION app.guard_task_comment_erasure() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, public AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM jsonb_each(
      coalesce(nullif(current_setting('juro.account_erasure_cases',true),''),'{}')::jsonb
    ) scope
    WHERE scope.value -> 'tasks' ? OLD.task_id
      AND app.account_erasure_includes_case(scope.key)
  ) THEN
    RAISE EXCEPTION USING MESSAGE = 'lawyer task comments are append-only', ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;
DROP TRIGGER lawyer_task_comments_no_delete ON app.lawyer_task_comments;
CREATE TRIGGER lawyer_task_comments_no_delete
  BEFORE DELETE ON app.lawyer_task_comments FOR EACH ROW
  EXECUTE FUNCTION app.guard_task_comment_erasure();
