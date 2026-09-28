# Validate Legal Answers programmatically

Status: accepted. Supersedes the independent model review requirements in ADRs 0020, 0023 and 0025.

The owner explicitly requested removing model verification to reduce latency. Both Fast and Deep draft once and then use programmatic validation. No legacy draft path may invoke a verification model. Fast retains GPT-6 Luna and Deep retains GPT-5.6 Terra.

When the complete admitted evidence fits the existing context budget, pass it directly to the writer without a separate model assessment. Oversized evidence still requires bounded selection of complete provisions. The single acquisition pass and no automatic correction policy remain.

Programmatic checks enforce draft shape, citation membership, unique finding/action membership, source identity, text integrity and requested temporal endpoints. Final publication still validates source freshness and withholds claims and actions whose cited evidence is unavailable. No legal keyword rules, hardcoded answers or numerical membership heuristics substitute for legal reasoning.

These checks cannot establish entailment, correct interpretation, substantive answerability or completeness. The writer remains responsible for those properties. New substantive results carry `validationMethod: programmatic`, including saved results, and the UI states that legal interpretation has not been independently reviewed. Structurally admissible delivery returns `answered`, never semantic `complete`, and does not receive `good_coverage`; known gaps remain explicit and return `partial`. The internal verification completeness flag stays false. Historical results retain their original metadata.

The internal legacy verification contract remains compatible with stored/test data; its `supported` field means structurally admissible when the method is programmatic. It must not be presented as semantic approval. A Main Point without any admissible finding is withheld because code cannot establish its substantive answerability.

Correctness and usable-answer latency remain release qualification requirements. Removing a provider call is not evidence that either target has been met.

Search formulation and evidence assessment receive separate instructions. Query generation must not receive the assessment directive to return no further queries, evidence-selection fields or semantic approval language. The single writer uses concise general instructions covering every requested decision in its substantive issues, preserving operative qualifications and practical steps. Correction-only instructions are supplied only to callers explicitly requesting correction; runtime programmatic delivery remains one pass.
