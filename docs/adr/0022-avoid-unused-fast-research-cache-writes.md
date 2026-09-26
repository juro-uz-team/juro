# Avoid unused cache writes in Fast research and verification

Fast research assessment and answer verification use explicit provider prompt
caching without cache breakpoints. This processes their request-specific inputs
at the ordinary uncached rate instead of paying to write prefixes that these
stages usually do not reuse within the request. Independent requests may repeat
an identical prefix; this policy deliberately forgoes that potential saving.

Interpretation, formulation and writing retain the provider's default caching.
Deep mode also retains it, including its correction cycle. Do not globally
disable caching: interpretation has a reusable instruction and schema prefix.

For the configured models, explicit mode without breakpoints disables cache
reads and writes. The shared provider adapter exposes the mode; the legal chat
profile owns this stage-specific choice. See the provider's
[prompt caching contract](https://developers.openai.com/api/docs/guides/prompt-caching).

This changes processing cost, not the evidence, instructions, model, reasoning
effort, structured response schema, independent verification or publication
checks. It does not establish the end-to-end latency target. Revisit the policy
if representative traffic demonstrates substantial prefix reuse in these
stages; calculate both cache-read savings and cache-write premiums.
