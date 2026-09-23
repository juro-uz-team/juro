CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION public.json_valid(value text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  PERFORM value::jsonb;
  RETURN true;
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END;
$$;

CREATE FUNCTION public.json_extract(value text, path text) RETURNS text
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE item jsonb;
BEGIN
  item := jsonb_path_query_first(value::jsonb, path::jsonpath);
  RETURN CASE item WHEN 'true'::jsonb THEN '1' WHEN 'false'::jsonb THEN '0' ELSE item #>> '{}' END;
END;
$$;

CREATE FUNCTION public.json_type(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT CASE jsonb_typeof(value::jsonb)
    WHEN 'string' THEN 'text'
    WHEN 'number' THEN CASE WHEN value ~ '[.eE]' THEN 'real' ELSE 'integer' END
    ELSE jsonb_typeof(value::jsonb) END
$$;

CREATE FUNCTION public.json_type(value text, path text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT public.json_type(jsonb_path_query_first(value::jsonb, path::jsonpath)::text)
$$;

CREATE FUNCTION public.json_array_length(value text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT jsonb_array_length(value::jsonb) $$;

CREATE FUNCTION public.json_each(source text) RETURNS TABLE(key text, value text)
LANGUAGE plpgsql IMMUTABLE STRICT AS $$
BEGIN
  IF jsonb_typeof(source::jsonb) = 'array' THEN
    RETURN QUERY SELECT (ordinality - 1)::text, item #>> '{}' FROM jsonb_array_elements(source::jsonb) WITH ORDINALITY AS a(item, ordinality);
  ELSE
    RETURN QUERY SELECT e.key, e.value #>> '{}' FROM jsonb_each(source::jsonb) AS e;
  END IF;
END;
$$;

CREATE FUNCTION public.canonical_json(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT value::jsonb::text $$;
CREATE FUNCTION public.instr(value text, needle text) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT strpos(value, needle) $$;
CREATE FUNCTION public.hex(value bytea) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT upper(encode(value, 'hex')) $$;
CREATE FUNCTION public.randomblob(size integer) RETURNS bytea
LANGUAGE sql VOLATILE STRICT AS $$ SELECT gen_random_bytes(size) $$;
CREATE FUNCTION public.zeroblob(size integer) RETURNS bytea
LANGUAGE sql IMMUTABLE STRICT AS $$ SELECT decode(repeat('00', size), 'hex') $$;
CREATE FUNCTION public.julianday(value text) RETURNS double precision
LANGUAGE sql STABLE STRICT AS $$ SELECT extract(epoch FROM value::timestamptz)::double precision / 86400 + 2440587.5 $$;
CREATE FUNCTION public.unixepoch(value text) RETURNS bigint
LANGUAGE sql STABLE STRICT AS $$ SELECT floor(extract(epoch FROM value::timestamptz))::bigint $$;
