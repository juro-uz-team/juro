# Route before research and read complete source extents

Status: accepted.

The first model turn uses the complete request and conversation to decide whether the answer needs legal sources. Requests that do not establish, explain or apply legal rules receive a direct reply without corpus discovery. Legal requests generate research formulations in the requested temporal scope before retrieval starts. This replaces speculative pre-interpretation discovery; no title parser or topic-specific routing rule is used.

Initial legal research acquires one readable complete source from the ranked candidates before the next model turn. This refines the navigation-only opening permitted by ADR0047. Ranking supplies an initial source to inspect, not a determination of applicability or completeness. Further source selection and research remain available, with all acquired evidence retained.

An article is not the only valid evidence boundary. Non-article acts use their existing complete retained section, or the complete document when no narrower safe boundary exists. Documents with recognizable article headings retain the explicit broader-selection requirement when an article boundary is ambiguous. Existing versioned source rendering and saved citation extents remain unchanged.

A failed publisher section selection can fall back to the selected candidate's complete extent. Failed reads retain source navigation and do not mark the source as successfully read. Genuine missing evidence or exhausted request capacity still yields an explicit unfinished result; neither search matches nor successful reading alone establish a supported Legal Answer.
