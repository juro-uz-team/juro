# Draft during bounded Fast research

Status: accepted for implementation; runtime qualification remains required.

Fast research may return a provisional issue draft in the same call that assesses coverage and selects evidence, removing a serial rereading and generation step. This extends ADR 0023 without letting research approve public claims: the coordinator admits a proposal only within the existing 24-source/64,000-character answer budget, with all cited sources retained and no restored source outside the drafting input; any subsequent search invalidates it, and independent verification plus final publisher validation still precede publication.

Larger selection packets and Deep research retain standalone drafting. The proposal travels explicitly through the research result to the answer engine, rather than hidden model state; a discarded or absent proposal falls back to normal writing, and no evidence is truncated or omitted to obtain reuse.

The combined call retains the Fast assessment profile (Luna, medium/standard, 45-second watchdog), so its draft shares that reasoning budget. This revises ADR 0020's no-deliberation drafting choice only for combined research; standalone drafting and independent verification retain their existing profiles. The watchdog is not a latency target or a qualification result.
