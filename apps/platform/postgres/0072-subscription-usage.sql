SET search_path TO app, public;

CREATE TABLE subscription_usage (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  metric text NOT NULL CHECK (metric IN ('drafts', 'pages')),
  operation_id text NOT NULL,
  request_hash text NOT NULL,
  period_start text NOT NULL,
  period_end text NOT NULL,
  units integer NOT NULL CHECK (units >= 0),
  status text NOT NULL CHECK (status IN ('reserved', 'consumed', 'released')),
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (workspace_id, user_id, metric, operation_id)
);
CREATE INDEX subscription_usage_balance
  ON subscription_usage (workspace_id, metric, period_start, status);
CREATE INDEX ai_usage_ledger_workspace_balance
  ON ai_usage_ledger (workspace_id, feature, period_start, status);

CREATE TABLE document_analysis_quotes (
  analysis_id text PRIMARY KEY REFERENCES document_analyses(id) ON DELETE CASCADE,
  source_hash text NOT NULL,
  pages integer NOT NULL CHECK (pages > 0),
  selectable boolean NOT NULL,
  first_page integer CHECK (first_page > 0),
  last_page integer CHECK (last_page >= first_page AND last_page <= pages),
  confirmed_at text,
  CHECK ((first_page IS NULL) = (last_page IS NULL))
);

CREATE FUNCTION app.subscription_capacity(workspace_key text)
RETURNS TABLE(active_cases integer, storage_bytes bigint, file_bytes integer, read_only boolean)
LANGUAGE sql STABLE SET search_path TO app, public AS $$
  SELECT
    CASE effective
      WHEN 'starter' THEN 5 WHEN 'advanced' THEN 20
      WHEN 'company' THEN 50 WHEN 'lawyer' THEN 50
      WHEN 'free' THEN 1
    END,
    CASE effective
      WHEN 'starter' THEN 1000000000 WHEN 'advanced' THEN 5000000000
      WHEN 'company' THEN 15000000000 WHEN 'lawyer' THEN 10000000000
      WHEN 'free' THEN 100000000
    END,
    CASE WHEN effective = 'free' THEN 5000000
      WHEN effective IN ('starter','advanced','company','lawyer') THEN 25000000
    END,
    COALESCE(lapsed, false)
  FROM (
    SELECT CASE WHEN s.status IN ('active','trialing')
      AND (s.started_at IS NULL OR CASE WHEN pg_input_is_valid(s.started_at,'timestamptz') THEN s.started_at::timestamptz <= now() ELSE false END)
      AND (s.current_period_ends_at IS NULL OR CASE WHEN pg_input_is_valid(s.current_period_ends_at,'timestamptz') THEN s.current_period_ends_at::timestamptz > now() ELSE false END)
      THEN s.plan_code ELSE 'free' END AS effective,
      w.type='business' AND s.plan_code='company'
        AND CASE WHEN pg_input_is_valid(s.current_period_ends_at,'timestamptz')
          THEN s.current_period_ends_at::timestamptz <= now() ELSE false END AS lapsed
    FROM workspaces w LEFT JOIN subscriptions s ON s.workspace_id=w.id
    WHERE w.id=workspace_key
  ) terms;
$$;

CREATE FUNCTION app.enforce_active_case_capacity() RETURNS trigger
LANGUAGE plpgsql SET search_path TO app, public AS $$
DECLARE
  capacity record;
BEGIN
  IF NEW.archived_at IS NOT NULL OR NEW.status = 'completed' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.archived_at IS NULL AND OLD.status <> 'completed'
    AND OLD.workspace_id = NEW.workspace_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('case-capacity:' || NEW.workspace_id, 0));
  SELECT * INTO capacity FROM subscription_capacity(NEW.workspace_id);
  IF capacity.read_only THEN RAISE EXCEPTION 'WORKSPACE_TERM_EXPIRED'; END IF;
  IF capacity.active_cases IS NOT NULL AND (
    SELECT count(*) FROM cases
    WHERE workspace_id=NEW.workspace_id AND archived_at IS NULL AND status <> 'completed'
  ) >= capacity.active_cases THEN RAISE EXCEPTION 'ACTIVE_CASE_LIMIT'; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER active_case_capacity
  BEFORE INSERT OR UPDATE OF workspace_id, archived_at, status ON cases
  FOR EACH ROW EXECUTE FUNCTION enforce_active_case_capacity();

CREATE FUNCTION app.subscription_storage_bytes(workspace_key text) RETURNS bigint
LANGUAGE sql STABLE SET search_path TO app, public AS $$
  SELECT COALESCE(sum(bytes),0)::bigint FROM (
    SELECT sum(size_bytes) AS bytes FROM document_files WHERE workspace_id=workspace_key
    UNION ALL SELECT sum(size_bytes) FROM builder_document_versions WHERE workspace_id=workspace_key
    UNION ALL SELECT sum(size_bytes) FROM analysis_document_versions WHERE workspace_id=workspace_key
    UNION ALL SELECT sum(size_bytes) FROM analysis_exports WHERE workspace_id=workspace_key
    UNION ALL SELECT sum(size_bytes) FROM analysis_report_exports WHERE workspace_id=workspace_key
    UNION ALL SELECT sum(size_bytes) FROM comparison_exports WHERE workspace_id=workspace_key
  ) records;
$$;

CREATE FUNCTION app.enforce_document_file_capacity() RETURNS trigger
LANGUAGE plpgsql SET search_path TO app, public AS $$
DECLARE
  capacity record;
  previous_bytes bigint := 0;
BEGIN
  IF NEW.workspace_id IS NULL OR NEW.size_bytes IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.workspace_id IS NOT DISTINCT FROM NEW.workspace_id THEN
    previous_bytes := COALESCE(OLD.size_bytes,0);
    IF previous_bytes >= NEW.size_bytes THEN RETURN NEW; END IF;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('file-capacity:' || NEW.workspace_id, 0));
  SELECT * INTO capacity FROM subscription_capacity(NEW.workspace_id);
  IF capacity.read_only THEN RAISE EXCEPTION 'WORKSPACE_TERM_EXPIRED'; END IF;
  IF TG_TABLE_NAME = 'document_files' AND NEW.size_bytes > capacity.file_bytes THEN RAISE EXCEPTION 'SUBSCRIPTION_FILE_LIMIT'; END IF;
  IF capacity.storage_bytes IS NOT NULL AND NEW.size_bytes - previous_bytes +
    subscription_storage_bytes(NEW.workspace_id) > capacity.storage_bytes THEN
    RAISE EXCEPTION 'SUBSCRIPTION_STORAGE_LIMIT';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER document_file_capacity
  BEFORE INSERT OR UPDATE OF workspace_id, size_bytes ON document_files
  FOR EACH ROW EXECUTE FUNCTION enforce_document_file_capacity();

CREATE TRIGGER builder_version_capacity
  BEFORE INSERT OR UPDATE OF workspace_id, size_bytes ON builder_document_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_document_file_capacity();
CREATE TRIGGER analysis_version_capacity
  BEFORE INSERT OR UPDATE OF workspace_id, size_bytes ON analysis_document_versions
  FOR EACH ROW EXECUTE FUNCTION enforce_document_file_capacity();
CREATE TRIGGER analysis_export_capacity
  BEFORE INSERT OR UPDATE OF workspace_id, size_bytes ON analysis_exports
  FOR EACH ROW EXECUTE FUNCTION enforce_document_file_capacity();
CREATE TRIGGER analysis_report_export_capacity
  BEFORE INSERT OR UPDATE OF workspace_id, size_bytes ON analysis_report_exports
  FOR EACH ROW EXECUTE FUNCTION enforce_document_file_capacity();
CREATE TRIGGER comparison_export_capacity
  BEFORE INSERT OR UPDATE OF workspace_id, size_bytes ON comparison_exports
  FOR EACH ROW EXECUTE FUNCTION enforce_document_file_capacity();

CREATE TABLE builder_ai_drafts (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  assignment_id text REFERENCES builder_ai_drafts(id) ON DELETE CASCADE,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  request_hash text NOT NULL,
  units integer NOT NULL CHECK (units >= 0),
  maximum_pages integer NOT NULL CHECK (maximum_pages BETWEEN 1 AND 40),
  included_revision boolean NOT NULL DEFAULT false,
  status text NOT NULL CHECK (status IN ('processing','completed','failed')),
  draft_text text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((status = 'completed') = (draft_text IS NOT NULL))
);
CREATE INDEX builder_ai_drafts_document ON builder_ai_drafts(document_id, created_at DESC);
CREATE UNIQUE INDEX builder_ai_drafts_processing ON builder_ai_drafts(document_id) WHERE status='processing';
