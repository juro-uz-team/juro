# JURO UX/UI Audit

Status: **living production audit, not a usability certification**

Evidence cutoff: **2026-09-02 16:47 UZT**

Scope: Chrome-only public, auth, authenticated Individual, and authenticated read-only Lawyer surfaces through the v101 checkpoint, plus a later RU/UZ/EN public entry-page native-Tab traversal and full 78-route public structural coverage at ten required widths. Excluded: legal-data/corpus operations, unsupported browsers, physical devices, and unowned role sessions.

## Outcome

v116 resolves the two production polish defects found during the v115 audit: tablet/desktop auth-heading overlap and sub-44-pixel public locale links. All 78 public sitemap routes now have structural production evidence with zero horizontal overflow at 320, 360, 375, 390, 430, 768, 1024, 1280, 1440, and 1920 px. A later real Lawyer session completed 16 protected routes read-only at desktop width and 15 role routes at 390 × 844 without login fallback, 404, horizontal overflow, visible alert, or console error.

## Surface review

| Surface | Observation | Evidence | Result |
| --- | --- | --- | --- |
| Public header | RU/UZ/EN are 44 × 44 when visible; mobile shows the active locale without crowding | live bounding boxes | RESOLVED |
| Public narrative | one visible H1 and main landmark; canonical/indexing intact | live DOM and HTTP | VERIFIED |
| Public responsive structure | all 78 sitemap URLs retained URL/200, one main, visible H1, zero horizontal overflow/broken images/not-found/console errors across ten widths; 26 transient reset/QUIC pairs passed isolated recheck | 780 Chrome route/viewport checks | VERIFIED FOR STRUCTURE; VISUAL STATES PARTIAL |
| Auth top row | theme and language controls no longer cover the form heading | overlap 0 px² at four viewports | RESOLVED |
| Turnstile | challenge reserves stable height and exposes localized status | 104 px live container; submit protected | VERIFIED |
| Individual shell | clear primary H1, responsive navigation, search/theme/locale/logout controls at least 44 px in the sample | live dashboard matrix | VERIFIED FOR SHELL |
| Lawyer shell | dedicated host, discovered professional route family, settled H1/main structure, zero horizontal overflow at desktop and 390 px | real authenticated read-only route matrix | VERIFIED FOR READ-ONLY SHELL |
| Persona routing | Individual cannot silently become Business, Lawyer, or Admin | redirect/reauth/admin-session boundaries | VERIFIED |
| Public entry-page keyboard path | all 74 RU, 74 UZ, and 71 EN focus positions traversed and wrapped; visible focus styling present on every real control; automation did not reproduce post-fold viewport scrolling | native Chrome `Tab` traversal at 1536 × 770 | VERIFIED FOR ORDER/INDICATOR; SCROLL PARTIAL |

## Open UX gates

- Role-specific onboarding and empty/error/success states for Business, Pending Lawyer, and Admin; state-changing Lawyer/client collaboration remains open.
- Post-fold automatic focus scrolling on the public entry pages, plus full keyboard order, focus restoration, modal trapping, and screen-reader narration across feature workflows.
- Controlled real-data substitutes for uploads, document generation, comparison, payments, and destructive settings.
- Long-content and localization stress tests on every dense workspace page.

No claim is made that every platform page has been visually reviewed.
