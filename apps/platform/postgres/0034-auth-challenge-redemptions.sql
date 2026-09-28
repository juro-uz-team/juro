CREATE TABLE app.auth_challenge_redemptions (
  id text PRIMARY KEY,
  expires_at timestamptz NOT NULL
);
CREATE INDEX auth_challenge_redemptions_expiry ON app.auth_challenge_redemptions (expires_at);
