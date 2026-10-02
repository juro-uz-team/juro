# Own hybrid official-corpus retrieval

Status: accepted — 2026-09-03; regular API transport amendment accepted 2026-09-05, superseding the 2026-09-04 Batch amendment; supersedes ADR 0004's selection of Cloudflare AI Search

JURO will own Hybrid Candidate Fusion for the Indexed Official Corpus. Immutable application-built BM25 lexicons, postings and corpus statistics live in private R2; application-generated `text-embedding-3-large` representations live as reusable private R2 artifacts and in an off-side Cloudflare Vectorize index; the existing private `LegalCandidateIndex` Interface returns one complete Candidate Packet only after every declared sparse and dense lane participates. This replaces AI Search because its opaque, slow indexing and provider-owned chunking prevent JURO from meeting deterministic release, laptop-independent recovery and freshness requirements, while putting sparse postings in D1 would recreate the non-increasable 10 GB capacity risk.

## Consequences

- By owner direction on 2026-10-02, operational live query embeddings record
  estimated provider exposure in an append-only usage ledger without requiring
  a manually provisioned monthly monetary allowance. A calendar boundary or
  exhausted query grant must not disable live retrieval. This supersedes the
  live-query spending gate below, while explicit qualification/evaluation and
  corpus construction, embedding and repair authorization caps remain in force.
  Request and abuse controls, user-plan allowances, provider usage accounting,
  evidence integrity and release qualification remain required.

- By owner direction on 2026-09-05, the
  [verification policy](../operations/legal-corpus-verification.md) replaces
  repeated full-corpus replays, routine full backup/restore rehearsals,
  independent verification packages and fixed staging/canary/stability waits.
  Reuse compatible accepted manifests and recovery evidence, verify new writes
  during construction, check each new index inventory once, and use bounded
  capability smoke tests before activation. Runtime evidence integrity,
  query-processing policy, spend limits and recoverability before deletion remain required.

- One Search Release pins an immutable Corpus Snapshot, JURO-owned Retrieval Chunk policy, sparse artifact set, dense artifact set, Vectorize index, embedding model/dimensions, metadata/filter policy and RRF policy. Sparse and dense components seal and activate together; a partial lane is Source Unavailability.
- R2 is authoritative for immutable BM25 artifacts, reusable document embeddings, candidate-to-evidence mappings and exhaustive release inventories. Vectorize is disposable. D1 retains body-free release roots, gates, budgets, Activation Sets and rollback history, but no bodies, term dictionaries, postings, positions, vectors or exhaustive runtime mappings. See ADR 0008.
- JURO uses unweighted reciprocal-rank fusion with `k = 60`. If both word and character n-gram sparse analyzers are required by evaluation, they first fuse into one Sparse Candidate Lane so sparse retrieval does not receive two votes against the Dense Candidate Lane.
- Retrieval Chunks are deterministic, provision-owned and provider-independent. Document and query embeddings use the same explicitly pinned 1,536-dimensional representation and transformation. Query embeddings are request-local and never persisted.
- A private Workflow coordinates each build; bounded Queue consumers perform idempotent posting, manifest and provider-lifecycle work; a Container may perform deterministic external sort/reduce only when a representative prototype proves Worker limits inadequate. Large state and every restart checkpoint live in R2.
- Document embeddings use the regular OpenAI `/v1/embeddings` API by owner
  decision. The builder deduplicates deterministic structured inputs and reuses
  hash-verified R2 artifacts before submitting bounded requests through the
  environment's authenticated, logging/cache-disabled AI Gateway. Durable
  Workflow/Queue orchestration retains input identities, budget reservations,
  attempt receipts and restart checkpoints. It reconciles response indices,
  model, dimensions, finite vectors and usage, then verifies immutable R2
  persistence before Vectorize. OpenAI Batch and its Files lifecycle are outside
  the build contract. Regular-rate exact-token authorization and measured account
  limits apply; uncertain provider outcomes retain their budget reservation
  until reconciled and do not imply a free or exactly-once retry.
- Live Retrieval Formulations are sent unchanged to both candidate lanes; query embeddings remain synchronous and request-local with separate query/evaluation budgets, as decided in ADR 0007. A four-hour emergency response may
  reuse an existing exact embedding or build changed inputs within the same
  authorization and integrity gates. If a complete release is unavailable,
  retrieval continues to Live Official Search; both lanes must reconcile before
  activation.
- The same owner-approved OpenAI key may serve staging and production, but each environment stores it independently behind a distinct authenticated, logging-disabled and cache-disabled AI Gateway. The root Cloudflare bootstrap token remains only in the ignored root `.env` until the migration program is resolved, then is scrubbed after verified final readback and revoked by the owner.
- AI Search's partial Porter/trigram build remains non-authoritative historical evidence. Its corpus projection, token measurements and privacy observations may inform the replacement, but its provider results cannot qualify the custom backend. Legacy retirement follows demonstrated custom operation, exact unused-resource checks and existing recovery coverage; no fixed observation period is required.
- Question Interpretation, Retrieval Eligibility, D1 revalidation, hash-verified R2 hydration, Provision Set selection, Official Coverage, the strict Source Ladder and Legal Answer behavior do not change.
