# Use fine-grained membership lookups

Status: accepted — 2026-09-11

For the self-hosted PostgreSQL membership representation, ADR 0019 extends the
publication and request-time authentication contract described here. The original
object-backed reader retains this decision's requirements.

The R2-native search runtime keeps accepted membership inventories immutable. Their coarse partitions contain complete legal identities and evidence locators, making individual candidate validation read much more data than it needs.

A Membership Lookup is an immutable physical projection of an accepted inventory. Its builder verifies every original partition against the accepted hash, preserves every member and ordinal, checks uniqueness and partition ownership, and writes smaller content-addressed leaves beneath hash-verified directory pages. It does not change search ranking, legal identities, eligibility, evidence, embeddings or the active Search Release.

D1 records an append-only lookup root bound to the Search Release, original inventory hash and exact member count. Runtime readers use it only when those bindings agree. They verify the root, directories and selected leaves before applying the existing temporal and evidence checks. A missing registration uses the original inventory; a corrupt registered lookup fails validation. Authenticated membership facts may be reused only within the same answer request and pinned inventory.

Publishing a lookup requires complete source-to-projection parity and corruption checks before registration, followed by local-browser verification of the active retrieval path. Applied migrations and accepted source artifacts remain unchanged. The legacy reader remains available for releases without a registered lookup.
