# JURO Accessibility Audit

Status: **living evidence report, not a WCAG certification**

Evidence cutoff: **2026-09-02 16:47 UZT**

Scope: Chrome-only public, authentication-boundary, authenticated Individual, and authenticated read-only Lawyer checks through the deployed v101 checkpoint, including a later native-Tab traversal of the RU/UZ/EN public entry pages. Legislation database/corpus work, non-Chrome browsers, and physical devices are excluded.

## Verified evidence

- Production v116 Chrome checks covered 390 × 844, 768 × 1024, 1024 × 768, and 1440 × 900 on the public site and lawyer-login boundary. Every checked page had zero horizontal overflow.
- Visible public RU/UZ/EN header links measure 44 × 44 CSS px at 768 px and wider; the current locale remains 44 × 44 on mobile while alternate locales are intentionally hidden below 620 px.
- The v116 lawyer-login heading has 0 px² overlap with both theme and language controls at all four checked viewports. Turnstile remained visible and the submit action stayed protected until verification completed.
- The authenticated Individual dashboard retained one visible H1, one main landmark, zero horizontal overflow, and 44 px or larger sampled controls at 390, 768, 1024, and 1440 px.
- v117 production Chrome confirmed the Individual case-row link and all four profile/settings tabs are 44 CSS px high at 390, 768, 1024, and 1440 px, with zero horizontal overflow and one main/H1 on both routes.
- v118 production Chrome at 390 × 844 confirmed an explicit focus ring on the dashboard AI composer and on every quick-action card. Keyboard focus moved all four cards fully into the 347 px scroller viewport; recorded `scrollLeft` positions were 2, 334, 666, and 974 px, with no document-level horizontal overflow.
- The same v118 dashboard check retained one main landmark, one visible H1, and a clean Chrome console. This is a focused keyboard regression pass, not a full keyboard or WCAG certification.
- Production v101 desktop Lighthouse scored Accessibility **100** on `https://juro.uz/ru`.
- The v114 local public page retained 21/21 visible reveal sections in RU, UZ, and EN at 1440 × 900 and in RU at 390 × 844.
- The checked desktop and mobile pages had zero document-level horizontal overflow and no console errors or warnings.
- Direct `/ru#start` navigation preserved content visibility and the scrolled header state.
- The local auth accessibility tree exposed the JURO link, light/dark theme controls, RU/UZ locale links, a localized protected-login heading, and the truthful local-development login boundary.
- At 390 × 844, the sampled auth buttons and links were at least 44 CSS px high and the page did not overflow horizontally.
- Source tests preserve keyboard/focus and reduced-motion contracts. The v114 Turnstile wrapper reserves 72 CSS px before the provider challenge renders.
- A real Lawyer session completed 16 discovered protected routes at desktop width and 15 role routes at 390 × 844 without login fallback, 404, horizontal overflow, visible alert, or console error. Each route retained a main landmark; protected settings/security/privacy pages exposed a visible H1 after their asynchronous loader settled.
- A later production Chrome crawl covered all 78 public sitemap URLs at the actual 1536 px desktop viewport across RU, UZ, and EN. Every route retained exactly one `main` and at least one visible H1, with zero horizontal overflow, broken loaded images, not-found text, console warnings, or console errors. This is structural desktop evidence, not a keyboard, screen-reader, zoom, or WCAG certification.
- A native Chrome `Tab` traversal at 1536 × 770 covered all detected focusable controls on the public entry pages: 74 RU, 74 UZ, and 71 EN. Every sequence crossed the document-body transition and wrapped to the first control, with zero stuck focus positions, zero missing `:focus-visible` states, zero missing indicators, and a computed `2.4px solid` gold outline on every sampled real control. The console remained clean in all three locales.
- The Chrome-control harness moved focus but retained `scrollY = 0` after the first viewport instead of reproducing the browser's normal automatic focus scrolling. It therefore reported 52 RU, 52 UZ, and 49 EN focused elements outside the unchanged viewport. Those counts are recorded as a harness limitation, not a page defect and not proof that post-fold focus is visibly scrolled into view.
- A separate isolated Chrome 152 structural crawl covered all 78 public sitemap URLs at 320, 360, 375, 390, 430, 768, 1024, 1280, 1440, and 1920 px. Every checked route ultimately retained exactly one `main`, at least one visible H1, and zero document-level horizontal overflow. This strengthens responsive landmark evidence but does not replace manual zoom, screen-reader, focus, or visual-order review.

## Open manual gates

- Repeat post-fold focus visibility with a Chrome input path that produces native viewport scrolling; extend keyboard traversal beyond the public entry pages and checked dashboard composer/quick-action path to feature workflows, dialogs, focus restoration, and error recovery. Also complete 200%/400% zoom, forced-colors, text-spacing, and Russian/Uzbek screen-reader passes.
- Complete authenticated Business, Pending Lawyer, and Staff/Admin journeys with accounts that actually hold those roles. Authenticated Lawyer coverage is read-only; state-changing collaboration, dialogs, uploads, and error recovery remain open.
- Repeat the full execution-brief viewport matrix on authenticated feature pages, including dense tables, dialogs, uploads, and error states.

Automated tests, an accessibility-tree snapshot, and Lighthouse 100 do not prove full WCAG conformance.
