# Retire replaced corpus evidence

Status: accepted — 2026-10-19; retirement scope supersedes the old-corpus retention requirement in the corpus verification policy and qualifies ADR 0012's evidence-reopening behavior.

The owner chose to delete the replaced legal corpus and its evidence to reclaim storage, accepting loss of original full-text citation reopening rather than retaining that corpus indefinitely. Affected citations must explicitly communicate that their original evidence is unavailable; deletion does not establish that the cited law is outdated, and later evidence must never be silently substituted. The replacement corpus, classification-assisted retrieval and Legal Answer integration activate together.

This decision covers the replaced corpus, not private application data, saved conversations, or the newly prepared corpus and embeddings. The owner accepts an Indexed Retrieval outage during construction so old corpus storage can be reclaimed before building the replacement. Exact resource boundaries must be established before deletion. Storage estimates credit verified reclaimable space and separately account for peak construction requirements; rollback cannot assume the deleted corpus remains available.

Saved Legal Answers remain readable with explicit unavailable-evidence handling and an action to ask again using the replacement corpus. Re-answering creates a new Legal Answer rather than rewriting the old one. Retirement is distinguished from a transient source fetch failure, and neither condition by itself establishes that a cited law has changed.

Retain the small immutable acceptance and generation identities needed to identify retirement and prevent reuse; delete their old source and search payloads. This preserves provenance without retaining a usable copy of the replaced corpus. A retired selection must remain explicitly unavailable until a qualified replacement is activated, including when older fallback configuration still exists.
