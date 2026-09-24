# Make generative retrieval planning optional

Status: accepted — 2026-09-25

Question Interpretation and complete material-topic coverage remain required, but Indexed Retrieval need not invoke a generative planner for every question. A deterministic path may produce request-local Retrieval Formulations when it preserves the interpreted question and coverage; questions requiring further decomposition retain generative planning. The owner accepted this trade-off to remove an unconditional external-model dependency from retrieval without substituting an incomplete search for a successful result.

All actual interpretation and formulation work remains inside the latency boundary in ADR 0017. Both candidate lanes receive the same unchanged formulations under ADR 0007. Preserved temporal endpoints, corrections, material qualifications and evidence requirements remain mandatory; model omission or topic labels alone do not establish Official Coverage. The existing implementation has not yet demonstrated that the revised architecture meets qualification.
