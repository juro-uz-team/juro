# Staging provider connectivity probe

Status: **replacement implementation is local and not deployed; answer-quality and health/SLO certification remain open.**

Provider contract checks use the retained structured transports. OpenAI additionally exercises the replacement chat storage path with an isolated clarification, allowance release, saved-answer reopen and idempotent replay. This verifies connectivity and storage compatibility, not legal-answer correctness. Technical response completion is recorded with no first-useful Legal Answer or token timing. Historical deployments measured an earlier implementation and do not certify this replacement.

The rolling diagnostic runs only when both conditions are true:

- `APP_ENV=staging`;
- `STAGING_SYNTHETIC_PROBES_ENABLED=true`.

The environment gate is checked before provider or storage operations, has no HTTP endpoint, does not
accept a user trigger, and is inert in development and production. The
five-minute scheduler creates a new opaque execution ID, rotates RU/UZ coverage
and runs OpenAI contract/storage checks alongside the configured Anthropic contract check
under one shared 30-second deadline. The lifecycle path cleans up every
synthetic tenant/content row after completion.

Only technical metadata is retained: provider/model, terminal state, safe error
code, bounded timing/usage and append-only SLO evidence. It never stores a
prompt, answer, document, URL, account identifier, provider body or secret.
If technical SLO persistence fails, the provider probe is downgraded to failed
instead of producing a green result. Rolling v28 technical rows are bounded by
their documented retention; the append-only SLO ledger is not pruned by that
cleanup. Earlier probe generations remain untouched. A local storage failure is reported as a persistence failure and does not mark the provider unavailable.

`MALWARE_SCANNER_PROBE_ENABLED` and
`STAGING_DOCUMENT_ANALYSIS_PROBE_ENABLED` are independent staging-only feature
  flags. Both remain disabled by default after each bounded staging evidence
  window; production also keeps both literal values at `false`. They run
only after the regular outbox work,
use a deterministic non-user tenant and private R2 objects, and remove the
synthetic document/object projections when the check ends. The scanner probe
uses EICAR only; the document probe uses a synthetic DOCX and the normal
scanner → analysis handlers. A failed scanner or analysis remains fail-closed
and records degraded evidence rather than a false operational state.

The document probe makes at most one bounded live provider attempt for each
explicit `staging-document-analysis-vN-YYYYMMDD` UTC execution key. A durable
`scheduled_runs` claim is created before any scanner, R2 or provider side
effect, so repeated five-minute cron invocations cannot create repeated
synthetic analyses. A failed or interrupted claim remains blocked rather than
being retried automatically; a same-window retry requires a deliberate probe
version change or an operator reset after inspecting the terminal record and
synthetic-resource cleanup. It is therefore a staging validation control, not
a production health claim. Roll back either control by setting the
corresponding staging flag to `false` or restoring the prior staging Worker;
production remains inert even if a flag value were misconfigured because the
runtime additionally requires `APP_ENV=staging`. Leave additive D1 evidence
intact. A private backup and isolated restore are required before any new
migrations are applied. See [AI-RELIABILITY-SLO.md](./AI-RELIABILITY-SLO.md).
