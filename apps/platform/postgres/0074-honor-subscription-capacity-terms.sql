SET search_path TO app, public;

CREATE OR REPLACE FUNCTION app.subscription_capacity(workspace_key text)
RETURNS TABLE(active_cases integer, storage_bytes bigint, file_bytes integer, read_only boolean)
LANGUAGE sql STABLE SET search_path TO app, public AS $$
  WITH workspace_plan AS (
    SELECT s.plan_code AS code,
           (s.status IN ('active', 'trialing')
             AND (NULLIF(s.started_at, '') IS NULL OR CASE WHEN pg_input_is_valid(s.started_at, 'timestamptz')
               THEN s.started_at::timestamptz <= now() ELSE false END)
             AND (s.current_period_ends_at IS NULL OR CASE WHEN pg_input_is_valid(s.current_period_ends_at, 'timestamptz')
               THEN s.current_period_ends_at::timestamptz > now() ELSE false END)
             AND s.plan_code IN ('free', 'starter', 'advanced', 'company', 'lawyer', 'individual', 'business', 'legal_team')) AS active,
           CASE WHEN pg_input_is_valid(v.entitlements_json, 'jsonb') THEN v.entitlements_json::jsonb END AS snapshot,
           COALESCE(w.type = 'business' AND s.plan_code = 'company'
             AND CASE WHEN pg_input_is_valid(s.current_period_ends_at, 'timestamptz')
               THEN s.current_period_ends_at::timestamptz <= now() ELSE false END, false) AS lapsed
    FROM workspaces w
    LEFT JOIN subscriptions s ON s.workspace_id = w.id
    LEFT JOIN subscription_plan_versions v ON v.id = s.plan_version_id
    WHERE w.id = workspace_key
  ), catalogue(code, active_cases, storage_bytes, file_bytes) AS (
    VALUES ('free', 1, 100000000::bigint, 5000000), ('starter', 5, 1000000000, 25000000),
           ('advanced', 20, 5000000000, 25000000), ('company', 50, 15000000000, 25000000),
           ('lawyer', 50, 10000000000, 25000000)
  ), terms AS (
    SELECT c.active_cases, c.storage_bytes, c.file_bytes, p.lapsed,
           CASE WHEN p.active AND c.code IS NOT NULL AND p.snapshot->>'access' = p.code AND NOT EXISTS (
             SELECT 1 FROM unnest(ARRAY['answers','drafts','pages','pagesPerRun','activeCases','storageBytes','fileBytes']) AS fields(name)
             WHERE NOT CASE WHEN jsonb_typeof(p.snapshot->'limits'->fields.name) = 'number' THEN
               (p.snapshot->'limits'->>fields.name)::numeric BETWEEN 1 AND 9007199254740991
               AND (p.snapshot->'limits'->>fields.name)::numeric = trunc((p.snapshot->'limits'->>fields.name)::numeric)
             ELSE false END
           ) THEN p.snapshot->'limits' END AS limits
    FROM workspace_plan p LEFT JOIN catalogue c ON c.code = CASE WHEN p.active THEN p.code ELSE 'free' END
  )
  SELECT CASE WHEN limits IS NULL THEN active_cases ELSE least((limits->>'activeCases')::numeric, 2147483647)::integer END,
         COALESCE((limits->>'storageBytes')::numeric::bigint, storage_bytes),
         CASE WHEN limits IS NULL THEN file_bytes ELSE least((limits->>'fileBytes')::numeric, 2147483647)::integer END,
         lapsed
  FROM terms;
$$;
