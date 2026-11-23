CREATE TABLE app.auth_google_accounts (
  subject_hash text PRIMARY KEY,
  user_id text NOT NULL UNIQUE REFERENCES app.user_profiles(id) ON DELETE CASCADE,
  linked_at text NOT NULL
);

CREATE TABLE app.auth_google_proofs (
  token_hash text PRIMARY KEY,
  expires_at text NOT NULL
);

CREATE INDEX auth_google_proofs_expiry_idx ON app.auth_google_proofs(expires_at);

CREATE FUNCTION app.remove_deleted_google_account() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM app.auth_google_accounts WHERE user_id=NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER remove_deleted_google_account
AFTER UPDATE OF lifecycle_status ON app.user_profiles
FOR EACH ROW WHEN (NEW.lifecycle_status='deleted' AND OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status)
EXECUTE FUNCTION app.remove_deleted_google_account();
