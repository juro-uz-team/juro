-- Retain historical probe URLs while permitting the canonical header-only
-- reachability check. Existing observations and append-only guards are unchanged.
ALTER TABLE app.legal_source_health_checks
  DROP CONSTRAINT legal_source_health_checks_endpoint_check;
ALTER TABLE app.legal_source_health_checks
  ADD CONSTRAINT legal_source_health_checks_endpoint_check CHECK (
    endpoint_url IN ('https://lex.uz/robots.txt','https://advice.uz/robots.txt','https://lex.uz/uz/')
  );
