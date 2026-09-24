CREATE FUNCTION public.transaction_guard_failure(guard_code text) RETURNS integer
LANGUAGE plpgsql VOLATILE STRICT AS $$
BEGIN
  RAISE EXCEPTION USING MESSAGE = guard_code, ERRCODE = 'P0001';
END;
$$;
