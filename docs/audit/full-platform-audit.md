# JURO Full Platform Audit

Status: **partial, evidence-backed audit; the full execution goal remains active**

Evidence cutoff: **2026-09-02 16:56 UZT (2026-09-02 11:56 UTC)**

Baseline: documentation main `1bdece2d98d3abde1e93e595d023242a95da2a8e`; runtime merge `498ab8944575134163cadcc6c74deeadd3a93fac`, platform Worker `9e7ff503-894e-4be1-a0dc-5ad413fc9ba8`, website Worker v13, public Sites v97.

The owner excluded legislation databases, legal corpus ingestion, vectors, embeddings, and staging-capacity remediation. This document therefore records product, release, browser, access-boundary, and public operational evidence without claiming completion of the excluded scope.

## Executive result

The public site, protected login boundary, authenticated Individual shell, and authenticated read-only Lawyer shell are deployed and responsive in Chrome. Public locale targets and auth-heading overlap defects found after v115 are fixed in v116; v117 closes the sampled Individual touch-target gaps; v118 closes the dashboard keyboard-focus clipping defect; v101 closes the owner-requested mobile interaction-target increment. A later 780-check production Chrome matrix covers all 78 public sitemap URLs at the ten required widths from 320 through 1920 px with zero confirmed structural/layout defect. Production role enforcement behaved correctly for the checked Individual account, while the separately authenticated Lawyer session retained its dedicated host and route family.

This does not complete the Definition of Done. End-to-end Business, Pending Lawyer, Staff/Admin, state-changing Lawyer/client collaboration, upload, billing, and destructive account workflows still require authorized role-specific accounts and controlled test data. The obsolete `ftp.juro.uz` exposure is resolved and no longer an open gate.

## Verified release evidence

| Gate | Evidence | Result |
| --- | --- | --- |
| Pull request | PR #124, merge `617ec64f…` | PASS |
| CI | exact head `33578000481`; post-merge `33578605701` | PASS |
| Security | scan `cad38f72-f2c0-40ed-a3ed-7cd0b525d76e`, complete three-surface coverage, 0 findings | PASS FOR DIFF |
| Platform deploy | v206 `1ec688d4-e085-4aa9-a34d-df02b0c1ae1c`, 100% | PASS |
| Public Worker deploy | v13 `3ee7a1ae-888a-4c98-8f49-de73783e6b7e`, 100% | PASS |
| Sites deploy | v97, deployment `appgdep_6a975c1651d0819194779c579abd961b` | PASS |
| Public routes | RU/UZ/EN, robots and sitemap 200; 78 sitemap URLs | PASS |
| Public responsive structure | 78 URLs × 10 required widths; URL/200, one main, visible H1, zero overflow/broken image/not-found; 26 transient transport failures passed isolated recheck | 780/780 PASS AFTER RECHECK |
| Indexing split | apex indexable; provider host noindex/nofollow/noarchive | PASS |
| Point-in-time status | operational, 8/8, 0 active/recent incidents at `2026-09-02T11:56:13.706Z`; OpenAI and Anthropic operational | PASS FOR SNAPSHOT; NOT AN SLA |
| Provider recovery history | 24 hours: OpenAI 97/98 and Anthropic 98/99 operational probes; 41 and 29 consecutive successes after the last timeouts | PASS FOR OBSERVED WINDOW; NOT AN SLA |
| Legacy FTP retirement | only record `4435f48bc863cc0ccaddd74a21791e5d` deleted; recursive and authoritative NXDOMAIN; production/email contract unchanged | PASS |
| Authenticated Lawyer shell | 16 protected routes on the dedicated host; no login fallback, 404, horizontal overflow, visible alert, or console error; 15 routes also checked at 390 × 844 | PASS FOR READ-ONLY SHELL |

## Journey and boundary matrix

| Surface | Live evidence | Status |
| --- | --- | --- |
| Public RU/UZ/EN | all 78 sitemap URLs at 320/360/375/390/430/768/1024/1280/1440/1920 px; canonical and robots correct; 44 px locale targets where visible | VERIFIED FOR STRUCTURE; MANUAL VISUAL STATES OPEN |
| Anonymous auth | lawyer login retains dedicated persona, Turnstile, protected submit, zero overlap/overflow | VERIFIED |
| Individual | 18 authenticated read-only routes resolved to the correct path with one main, one visible H1, zero overflow at 390 px, and zero new console errors; v118 dashboard composer and four quick cards passed the focused keyboard check; no private document opened | VERIFIED FOR READ-ONLY SHELL |
| Business | direct Business dashboard request redirected this Individual account to its allowed Individual dashboard | VERIFIED ENFORCEMENT; JOURNEY OPEN |
| Lawyer | a real Lawyer session reached 16 discovered same-origin routes on the dedicated host; asynchronous settings/profile loaders settled to a visible H1; no private content or mutation was used | VERIFIED FOR READ-ONLY SHELL; STATE CHANGES OPEN |
| Pending Lawyer | no pending-lawyer account was available | OPEN |
| Staff/Admin | direct Admin request required a protected admin session | VERIFIED ENFORCEMENT; JOURNEY OPEN |
| State-changing features | no form submission, email send, upload, payment, deletion, or role mutation was performed | OPEN |

## Remaining release gates

- Complete keyboard coverage beyond the focused dashboard path, plus screen-reader, high-zoom, forced-colors, and text-spacing passes.
- Complete role-specific Business, Pending Lawyer, and Staff/Admin journeys, plus state-changing Lawyer/client collaboration with controlled test data.
- Exercise controlled test-data flows for document creation, upload/scan, comparison, cases, consultations, billing, support, and account lifecycle.
- Record durable analytics/KPI evidence and cost-control evidence against real production telemetry without exposing private data.
- Keep the bounded 24-hour provider recovery evidence separate from an availability SLA or future-health claim.
- Keep `ftp.juro.uz` absent and recreate the saved DNS-only A record only if a legitimate external dependency is proven.

The next role-specific browser gate is Pending Lawyer, followed by Staff/Admin and Business. It requires an owner-prepared real session; no identity or approval state may be fabricated.
