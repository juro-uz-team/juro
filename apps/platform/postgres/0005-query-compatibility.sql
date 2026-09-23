-- Catalog discovery remains scoped to the connection's application or legal schema.
CREATE VIEW public.sqlite_master AS
SELECT 'table'::text AS type, tablename AS name, tablename AS tbl_name, NULL::text AS sql
FROM pg_catalog.pg_tables WHERE schemaname = current_schema();

-- A malformed JSON expression is used to abort a failed conditional ownership
-- guard. Do not constant-fold it before the CASE branch is selected.
ALTER FUNCTION public.json_extract(text,text) STABLE;
