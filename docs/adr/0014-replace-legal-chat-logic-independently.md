# Replace legal chat logic independently

Status: accepted

Legal chat logic will be rewritten independently of its existing orchestration, generation, assessment and repair implementation. The interface and existing capabilities remain, together with database schemas and data, applied migrations, stored embeddings and indexing. Replacement callers use existing storage contracts and retain saved-content compatibility; shared functionality used by other products is outside wholesale deletion.

Repeated component gains have not established complete Legal Answers in the recorded content checks. The owner chose an independent implementation over maintaining parallel old and new engines. On an isolated local Git branch, first account for retained dependencies and then completely delete old chat logic before implementing its replacement. The deletion checkpoint may temporarily leave local chat nonfunctional. No intermediate push or deployment is allowed; production retains its existing deployment until the whole replacement passes its answer and compatibility checks. Independently checked legal examples define correctness, rather than old-engine outputs. This accepts a broader integration effort in exchange for avoiding dependency on the implementation being replaced.

The replacement uses conversation context, bounded research, one writer for the complete answer and separate verification, with at most one focused correction. A single writer owns consistency across the Main Point, legal explanation, practical guidance and risks; independent verification retains a separate check on support and completeness. This replaces the existing split generation and layered repair design instead of wrapping it. Exact runtime limits remain part of the implementation specification.
