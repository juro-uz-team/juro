# JURO Mobile and Responsive Audit

Status: **partial Chrome responsive evidence; no physical-device certification**

Evidence cutoff: **2026-09-02 16:47 UZT**

## Public production responsive matrix

An isolated **Google Chrome 152.0.7977.66** session navigated all 78 production sitemap URLs at each required width: 320 × 844, 360 × 800, 375 × 812, 390 × 844, 430 × 932, 768 × 1024, 1024 × 768, 1280 × 800, 1440 × 900, and 1920 × 1080. This produced **780 route/viewport checks**.

Every route ultimately retained the requested URL and HTTP `200`, exactly one `main`, at least one visible H1, document width within one CSS pixel of the viewport, zero completed broken images, no localized not-found surface, and no console warning/error or non-aborted network failure. The first high-rate pass encountered 26 transport failures (`ERR_CONNECTION_RESET` or `ERR_QUIC_PROTOCOL_ERROR`) rather than layout failures: 23 at 768 px and three at 1024 px. An isolated lower-load recheck with QUIC disabled passed all **26/26** affected route/viewport pairs. The transient failures are retained as operational evidence rather than hidden.

This is complete public structural coverage for the requested width list. It is not screenshot/pixel equivalence, orientation change, physical-device, touch-gesture, soft-keyboard, zoom, screen-reader, or state-changing interaction evidence.

## Checked viewports

| Viewport | Public site | Lawyer login | Individual shell |
| --- | --- | --- | --- |
| 320 × 844 | 78/78 structural PASS | not repeated in this pass | v101 AI/notifications/privacy target checks retained |
| 360 × 800 | 78/78 structural PASS | not repeated in this pass | not repeated in this pass |
| 375 × 812 | 78/78 structural PASS | not repeated in this pass | not repeated in this pass |
| 390 × 844 | 78/78 structural PASS; active locale 44 × 44 | overflow 0; overlap 0; Turnstile visible | overflow 0; case link 44 px; four settings tabs 44 px; one H1/main; v118 composer/card focus visible; all four quick cards fully scrolled into view |
| 430 × 932 | 78/78 structural PASS | not repeated in this pass | not repeated in this pass |
| 768 × 1024 | 78/78 structural PASS; all locale links 44 × 44 | overlap 0 | overflow 0; case link and settings tabs 44 px; one H1/main |
| 1024 × 768 | 78/78 structural PASS; all locale links 44 × 44 | overlap 0 | overflow 0; case link and settings tabs 44 px; one H1/main |
| 1280 × 800 | 78/78 structural PASS | not repeated in this pass | not repeated in this pass |
| 1440 × 900 | 78/78 structural PASS; all locale links 44 × 44 | overlap 0 | overflow 0; case link and settings tabs 44 px; one H1/main |
| 1920 × 1080 | 78/78 structural PASS | not repeated in this pass | not repeated in this pass |

Local pre-release checks additionally covered 320 × 720. Production v115 evidence covers 390 × 844 theme controls, reveal visibility, and Lighthouse accessibility. These are lab/browser measurements, not field Core Web Vitals or physical-device results.

## Authenticated Lawyer responsive receipt

- A real Lawyer session completed 15 protected role routes at 390 × 844 with the temporary Chrome viewport override.
- Every checked route stayed on `lawyer.juro.uz`, retained a main landmark, avoided login fallback and 404, and had zero document-level horizontal overflow.
- Settings, security, and privacy initially showed their protected loading state; after it settled, each exposed one visible H1 and no visible alert. This prevents a premature loading-state snapshot from being misreported as a heading defect.
- The viewport override was reset to the normal 1536 px desktop width, and the user-owned tab was returned to `/ru/dashboard`.

## Resolved defects

1. Auth theme controls previously covered the login heading at 768 and 1024 px. v116 reserves the top control row at every viewport.
2. Public locale links were approximately 33 px wide on tablet/desktop. v116 enforces a 44 px minimum width.
3. The Individual case-row link was 17 px high and profile/settings tabs were 42 px high. v117 raises both to the 44 px touch-target floor across the checked matrix.
4. The dashboard quick-action rail previously left the second and fourth keyboard-focused cards mostly clipped at 390 px. v118 uses nearest-edge native scrolling on focus and adds explicit composer/card focus rings; production Chrome showed every card fully visible.

## Open responsive gates

- The full width list and orientation-change production passes for authenticated feature pages; the new 10-width matrix covers the public sitemap only.
- Soft-keyboard, safe-area, 200%/400% zoom, long RU/UZ strings, tables, dialogs, upload progress, and error recovery.
- Physical iOS/Android and non-Chrome testing remain explicitly excluded unless the owner changes scope.
