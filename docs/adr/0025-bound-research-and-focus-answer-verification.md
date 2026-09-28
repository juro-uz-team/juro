# Bound research and focus answer verification

Status: accepted for implementation; quality and latency qualification remains required.

Both chat modes use one research acquisition pass followed by one assessment and independent answer verification. Indexed retrieval runs once; absent evidence or structural source/reference failures may invoke official retrieval once before assessment. Gaps discovered by assessment remain explicit in a Supported Partial Answer or Insufficient-Evidence Result until a further user request. Automatic semantic research recovery and answer correction loops are removed, superseding those parts of ADR 0020; targeted official fallback in ADR 0013 remains within this bounded pass.

Independent verification checks the proposed answer's actual legal claims, decisive qualifications, practical advice and response to the user's requested decisions. It no longer requires an exhaustive passage-by-passage or source-by-source inventory of additional useful issues. This revises ADR 0023's complete-source omission inventory: all admitted evidence remains available to detect restrictions and contradictions, and source identity, full provisions, temporal applicability, citation admission and dependent-claim withholding remain mandatory. Missing independent issues can remain undiscovered; omitted qualifications that make a published claim false are never excused by this narrower audit.

Fast and Deep initially retain their model choices while sharing the bounded research and no-correction policy. The owner authorizes removing the distinction if it prevents the required quality and latency outcome. The existing usable-answer targets remain qualification requirements, not timeout guarantees; a quick failure is not a successful answer.
