# Let corpus research flow directly into writing

Status: accepted.

Legal chat follows question → AI-led corpus research → writing from retrieved laws → save and deliver. The research agent decides when the complete provisions retrieved for the actual question are sufficient and may proceed directly to writing without returning a separate coverage-assessment result or obtaining approval from another model. This replaces the mandatory externally enforced coverage-before-writing stage to reduce serial model work; interpretation, relevance and material completeness remain responsibilities of the same workflow rather than mandatory separate calls.

The corpus is trusted under ADR0039, and provisions are selected only after the question arrives. Named material gaps trigger bounded corpus research or an explicit insufficient-evidence result, never law supplied from model memory. Normal request admission establishes authorized user context; subsequent operations preserve access boundaries without repeated whole-workflow authentication stages. Output formatting, citation association, deadlines, spending controls and atomic persistence remain application responsibilities.

The agent's decision is not proof of legal completeness. Actual answers require source-based verification of material coverage and correct application. This decision does not guarantee a fixed number of provider calls or establish measured latency.
