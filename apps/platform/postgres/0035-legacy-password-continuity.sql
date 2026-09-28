-- Preserve the exact work factor used by existing production credentials.
-- New passwords still use 600,000 iterations; successful legacy login upgrades
-- the hash without changing the password-change timestamp.
ALTER TABLE app.user_password_credentials DROP CONSTRAINT user_password_iterations_check;
ALTER TABLE app.user_password_credentials ADD CONSTRAINT user_password_iterations_check
  CHECK (iterations = 100000 OR iterations BETWEEN 310000 AND 1000000);
