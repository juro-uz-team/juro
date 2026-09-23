CREATE FUNCTION public.pragma_table_info(table_name text)
RETURNS TABLE(cid integer,name text,type text,"notnull" integer,dflt_value text,pk integer)
LANGUAGE sql STABLE AS $$
  SELECT (c.ordinal_position-1)::integer,c.column_name::text,c.data_type::text,
    CASE WHEN c.is_nullable='NO' THEN 1 ELSE 0 END,c.column_default::text,
    CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage ku
        ON ku.constraint_schema=tc.constraint_schema AND ku.constraint_name=tc.constraint_name
      WHERE tc.table_schema=c.table_schema AND tc.table_name=c.table_name
        AND tc.constraint_type='PRIMARY KEY' AND ku.column_name=c.column_name
    ) THEN 1 ELSE 0 END
  FROM information_schema.columns c
  WHERE c.table_schema=current_schema() AND c.table_name=$1 ORDER BY c.ordinal_position
$$;
