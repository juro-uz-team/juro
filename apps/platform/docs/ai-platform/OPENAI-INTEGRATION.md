# OpenAI integration

## Interactive reliability staging checkpoint — 2026-08-12

The deployed staging artifact applies one 30-second absolute execution budget to
interactive legal chat. Bounded D1-only verified retrieval, OpenAI, an eligible
Anthropic fallback, validation and persistence share that deadline; fallback
does not receive a second full window. SSE can send a source-bound preliminary
excerpt or clarification state after retrieval, while the final answer remains
strictly validated and durably persisted before it is chargeable. Content-free
SLO telemetry records target evaluation only. The current staging Worker is
`f79f560a-bc9d-449f-aa7c-a421e2af2d9e`; its latest OpenAI telemetry record is
inside both targets (`3063 ms` first useful server event, `4510 ms` end to
end). An earlier live record (`148 ms` first useful, `7455 ms` end to end) is
retained as history. The sample count remains below the configured minimum of
20 and must not be presented as p50/p95 compliance. Production is unchanged. See
[AI-RELIABILITY-SLO.md](./AI-RELIABILITY-SLO.md).

## Runtime checkpoint — 2026-08-04

Read-only staging metadata confirms the v26 OpenAI probe remains successful and
two completed OpenAI `ai_runs` exist after the seven historical
`PROVIDER_UNAVAILABLE` records. The latest completed OpenAI run is
`2026-08-03T18:45:09.229Z`; the latest historical failure is
`2026-08-03T07:06:30.603Z`. Therefore the earlier blanket unavailable message
does not describe the current provider transport. Authenticated UI, verified
citation and legal-quality gates remain open. See
`STAGING-AI-RUNTIME-2026-08-04.md`.

## Guest request path

The feature-gated guest endpoint uses the same server-only provider adapter as
registered chat. Before execution it enforces safe origin, Turnstile, signed
session/IP limits and an atomic one-answer reservation. It retrieves approved
legal sources, verifies citations and freshness, validates `LegalChatResponse`,
and persists encrypted input/output only. A clarification releases the answer;
only a validated final response consumes it. Provider failure never creates a
success response or charge. Migration `0065` and staging provider/browser proof
remain open.

Updated: 2026-08-03

## Implemented boundary

OpenAI is the primary provider for `POST /api/platform/ai`. Calls are made only from the Worker through the Responses API. The browser never receives a provider key.

- staging model variables: `OPENAI_CHAT_MODEL=gpt-5.6-luna` and `OPENAI_DEEP_MODEL=gpt-5.6-terra`;
- secret name: `OPENAI_API_KEY`;
- transport: the Worker requests Responses API SSE and parses semantic `response.output_text.delta` and terminal events across arbitrary network-chunk boundaries;
- browser stream: JURO sends only bounded status metadata while generation is in progress; unvalidated legal text is never rendered as a partial answer;
- terminal gate: the final answer is emitted only after JSON parse, strict Zod validation, verified-source enforcement, persistence, and usage-ledger completion;
- stop: the browser aborts the JURO stream, the Worker aborts the provider request, and the reserved usage ledger is released with `AI_CANCELLED`;
- privacy: a one-way, domain-separated hash of the internal user identifier is sent as `safety_identifier`; email, name, question text, and workspace identifier are not used for that field;
- model controls: fast/deep map to explicit reasoning effort and short/detailed map to explicit response verbosity;
- disconnect cleanup: request/response cancellation removes abort listeners and prevents terminal writes to a closed stream;
- strict output: Responses API `text.format` with the server-owned `LegalChatResponse` JSON Schema; draft metadata and provider-incompatible validation annotations are removed only from the provider grammar while the unchanged Zod schema remains the server validation boundary;
- response validation: JSON parse followed by strict Zod validation;
- source boundary: only server-retrieved, verified source IDs with non-empty excerpts may support confirmed findings, risks, deadlines, or citations;
- no verified excerpt: the result is canonicalized to `clarification_required`, legal claims are removed, and the reserved answer cycle is released;
- retry: at most two attempts for provider/network conditions;
- browser retry state: uncertain transport replay keeps the exact idempotency
  key; a D1-confirmed failed/released run returns a bounded terminal state and
  an explicit retry receives a fresh key instead of looping as `processing`;
- recovery read: `GET /api/platform/ai/runs/:idempotencyKey` is authenticated,
  tenant-scoped and no-store; after an uncertain stream failure the client
  polls bounded status and reloads only a completed persisted structured answer;
- refusal: `AI_REFUSED` is returned as a non-fallback safety result;
- timeout and invalid output: typed failures, no raw provider body returned to the browser;
- audit: provider, actual model, provider response ID, token usage, latency, attempts, instruction hash, source-version hash, and correlation ID are stored server-side.
- memory (local candidate): up to 20 decrypted user-owned global/current-workspace records are included as explicitly untrusted context; their normalized content participates in the idempotency request hash, but plaintext is not written to logs or audit metadata.

The implementation does not send a user-provided URL as legislation. User text and document text are marked as untrusted data in provider instructions.

## Current staging evidence

On 2026-08-03, the closed one-time probe `staging-openai-legal-chat-v25` exercised the real staging `OPENAI_API_KEY`, Responses API, `gpt-5.6-sol`, the complete legal-chat structure, unchanged Zod parser, no-source clarification rule, and source boundary. The D1 technical record completed with `status=succeeded`, `input_tokens=799`, `output_tokens=165`, `latency_ms=4702`, and no error code. No prompt, model output, provider body, or secret value was persisted. The probe flag was immediately returned to `false`; all 45 Worker bindings remained present.

The live fix is staging Worker version `c8aff902-c151-4a6b-a5dd-2ce5480236d5` from commit `35b3cd0`. The preceding v24 record failed with bounded code `PROBE_OPENAI_HTTP_400_INVALID_JSON_SCHEMA`, proving that transport and authentication reached OpenAI but Zod's raw draft-7 schema was rejected before generation. Provider-schema normalization removed that failure without weakening application validation.

The follow-up closed lifecycle probe `staging-openai-legal-chat-v26` was deployed from commit `351a0b0` as staging Worker version `a2b2357e-0dc8-4b83-9c45-8813f48d0968`. It completed real OpenAI requests in both RU and UZ and verified the service-layer lifecycle against `juro-staging`: tenant fixture creation, run/usage reservation, strict provider parsing, no-source clarification, conversation/message/branch/version persistence, audit evidence, non-chargeable ledger release, idempotent replay, and cleanup. The bounded D1 evidence is `status=succeeded`, `model=gpt-5.6-sol`, `input_tokens=2038`, `output_tokens=295`, `latency_ms=6493`, `error_code=NULL`, started `2026-08-03T12:30:59.178Z` and finished `2026-08-03T12:31:11.566Z`. The flag was returned to `false`, all 45 bindings remained present, and post-run counts for synthetic users, workspaces, conversations, runs, ledgers, and idempotency rows were all zero.

The remaining live gate is an Access-authenticated browser request in RU and UZ, plus a verified-source citation flow and explicit stop/disconnect trace. D1 run/ledger persistence, no-source clarification, invalid-output handling, and provider fallback have service-level or contract evidence. The key must never be pasted into chat, Git, logs, screenshots, or client configuration.
## Verification and remaining work

- local transport, source-boundary, and usage-ledger tests cover split SSE frames, malformed events, terminal structured JSON, and cancellation without charge;
- the full platform regression, environment matrix, staging artifact, and protected staging deployment postflight passed;
- the exact RU/UZ legal-chat provider contract, no-source safety boundary, D1 run/ledger lifecycle, non-chargeable clarification, persistence, audit, replay, and cleanup are verified by the real staging lifecycle probe;
- an authenticated end-user RU/UZ browser stream, stop/disconnect trace, and verified-source citation flow remain to be verified through the protected UI/API flow;
- exact completed-response idempotent replay, bounded automatic status recovery,
  and terminal-failure recovery are implemented locally; durable partial-token
  resume is not implemented;
- edit/regenerate/branch history;
- hybrid Vectorize retrieval and reranking;
- encrypted user memory is implemented and tested locally; staging migration, a valid keyring, authenticated RU/UZ UI/provider verification and retention purge remain open;
- live provider cost verification;
- production binding or deployment.

