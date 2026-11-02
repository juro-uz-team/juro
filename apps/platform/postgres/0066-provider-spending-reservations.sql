CREATE TABLE provider_spending_budgets (
  id text PRIMARY KEY,
  limit_microusd bigint NOT NULL CHECK (limit_microusd > 0),
  experiment_limit_microusd bigint NOT NULL CHECK (experiment_limit_microusd > 0),
  opening_receipt_sha256 text CHECK (opening_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE provider_spending_reservations (
  id uuid PRIMARY KEY,
  budget_id text NOT NULL REFERENCES provider_spending_budgets(id),
  experiment_id text NOT NULL,
  maximum_microusd bigint NOT NULL CHECK (maximum_microusd > 0),
  accounted_microusd bigint CHECK (accounted_microusd >= 0),
  state text NOT NULL CHECK (state IN ('reserved','dispatched','settled','unknown')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '3 minutes'),
  CHECK ((state = 'settled') = (accounted_microusd IS NOT NULL))
);
CREATE INDEX provider_spending_reservations_budget ON provider_spending_reservations(budget_id);

-- Reviewed billing bounds are separate from observed/discounted usage prices.
-- A missing or expired contract must never become a guessed allowance.
CREATE TABLE provider_billing_contracts (
  price_version_id text PRIMARY KEY,
  maximum_input_tokens bigint NOT NULL CHECK (maximum_input_tokens > 0),
  maximum_input_tokens_per_item bigint CHECK (maximum_input_tokens_per_item > 0),
  maximum_output_tokens bigint NOT NULL CHECK (maximum_output_tokens >= 0),
  input_rate_upper_microusd bigint NOT NULL CHECK (input_rate_upper_microusd >= 0),
  output_rate_upper_microusd bigint NOT NULL CHECK (output_rate_upper_microusd >= 0),
  review_receipt_sha256 text NOT NULL CHECK (review_receipt_sha256 ~ '^[a-f0-9]{64}$'),
  source_url text NOT NULL,
  valid_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
