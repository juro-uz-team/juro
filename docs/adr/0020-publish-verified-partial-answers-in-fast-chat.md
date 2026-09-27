# Publish verified partial answers in fast chat

Status: accepted for implementation; runtime qualification remains required

Fast chat uses one whole-answer draft and a separate verification. It publishes
only supported claims, with unresolved coverage and factual questions preserved,
and does not automatically rewrite an independently verified partial answer.
Deep chat retains at most one correction and another verification. Both paths
retain source identity, complete evidence, claim dependencies, temporal checks
and final publisher validation. An unavailable verifier cannot approve a draft.

Research assesses newly admitted evidence and stops after both search lanes add
no authenticated evidence in a recovery round. The initial round always permits
one recovery attempt, including after transient read failures. Such a stop records unresolved coverage;
it does not establish completeness. Productive research may still use all three
rounds. A repeated search result cannot justify another assessment of identical
evidence or silently clear an existing gap.

Fast chat uses GPT-6 Astra with low/standard reasoning to combine Question
Interpretation and initial indexed search planning in one bounded call.
Interpreted topics alone did not reliably express the general governing
mechanisms needed for discovery; separate planning adds a serial model call.
The combined output preserves exact user facts, selected private context and
Temporal Scope validation, and requires a query association for every topic.
These formulations are request-local discovery proposals, not evidence or
Official Coverage. Only initial indexed retrieval consumes them; public
discovery keeps independent private-name classification, and subsequent
research retains its assessment-driven repair plans. Invalid combined output
cannot produce a ready Question Interpretation.

Remaining Fast operations use GPT-6 Luna with standard reasoning: no
deliberation for query formulation and drafting, and medium effort for
coverage assessment and independent verification. Client
watchdogs are 15 seconds for interpretation, 45 seconds for formulation and
assessment, and 60 seconds for drafting and verification. Deep chat uses
GPT-5.6 Terra with a 120-second client watchdog; whole-answer writing and
verification retain its maximum/pro profile.

These are operational bounds, not revised qualification criteria. Indexed
Retrieval still includes all required indexed work under its shared ten-second
deadline and targets five-second p95 at five concurrent questions. A model
watchdog cannot extend that deadline. Recall, semantic coverage and complete
chat outcomes require separate qualification, including every unavailable or
timed-out attempt. A Supported Partial Answer must remain visibly partial.
