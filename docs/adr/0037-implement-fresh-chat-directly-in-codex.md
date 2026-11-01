# Implement fresh chat directly in Codex

Status: accepted.

The primary Codex agent implements the legal-chat replacement directly in a fresh session, using GPT-6 Astra with medium reasoning, without consulting or adapting previous chat implementations, prompts, validators, generated candidates or answers. This supersedes ADR 0036's separate implementation-agent and mandatory Docker/filesystem-isolation requirements, and clarifies ADR 0034's development isolation: a behavioral non-reference boundary and preserved baseline are required, not an inaccessible repository or separate runtime.

Retained infrastructure, schemas, UI and persistence interfaces may be inspected for integration, but old chat decisions may not serve as a blueprint. This trades enforced filesystem separation for a simpler direct Codex workflow; do not claim technical source isolation. The production writing contract, retained data boundaries, material completeness, tenant/privacy isolation, provider accounting and verified release remain binding. Prior implementation artifacts remain outside the behavioral reference boundary.
