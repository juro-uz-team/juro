CREATE FUNCTION public.append_json_array(state jsonb, value jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$ SELECT state || jsonb_build_array(value) $$;
CREATE AGGREGATE public.json_group_array(jsonb) (
  SFUNC = public.append_json_array, STYPE = jsonb, INITCOND = '[]'
);
CREATE FUNCTION public.date(value text, modifier text) RETURNS text
LANGUAGE sql STABLE STRICT AS $$
  SELECT to_char((value::timestamptz AT TIME ZONE 'UTC') + modifier::interval, 'YYYY-MM-DD')
$$;
CREATE FUNCTION public.datetime(value text) RETURNS text
LANGUAGE sql STABLE STRICT AS $$
  SELECT to_char(CASE WHEN value='now' THEN current_timestamp ELSE value::timestamptz END AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')
$$;
-- Preserve append order when multiple consent events share a timestamp.
ALTER TABLE app.consents ADD COLUMN rowid bigint GENERATED ALWAYS AS IDENTITY;
