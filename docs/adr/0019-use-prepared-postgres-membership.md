# Use publication-verified PostgreSQL membership

Status: accepted — 2026-09-25

The owner accepted a prepared PostgreSQL retrieval projection that replaces
object-directory traversal with direct candidate membership lookup. This extends
ADR 0009 for the self-hosted runtime. Its original request-local reuse rule and
per-read object authentication continue to govern the object-backed reader.

A prepared generation retains the exact original inventory manifest and partition
bytes. Atomic publication verifies their hashes, identities, counts, deterministic
partition placement, unique member identities and ordinals, and exhaustive parity
between those authenticated bytes and the derived rows. Published rows and source
bytes are immutable. Direct updates, moves, deletion and truncation are fenced in
PostgreSQL, including publication concurrent with construction.

Each request reads the accepted Search Release inventory binding and selects only
a verified generation matching its release, inventory hash and member count.
Changing that accepted inventory makes the old generation inapplicable. Derived
membership rows replace the original object pages as the active membership
representation; retained original pages need not be reopened per request. This
trust rests on authenticated publication and database immutability, rather than a
cross-request cache of previously read membership facts. A missing generation uses
the original reader; a selected generation with missing or invalid members fails
validation.

Original source artifacts remain retained for compatibility and audit. Candidate
provenance, temporal eligibility, evidence locators and citation identities remain
unchanged. Every request still freshly authenticates physical parent evidence
bytes. This decision does not authorize caching those bytes across requests or
accepting outdated publisher text. Full native latency and semantic qualification
remain required before historical activation.
