# JURO QA Test Report

Status: **living evidence report, not full Definition of Done**

Evidence cutoff: **2026-09-02 16:56 UZT**

Scope in this report: deployed v101 mobile interaction-target evidence dated 2026-09-02, the later bounded DNS-retirement and authenticated Lawyer receipts, a 78-route public production Chrome crawl at desktop and all ten required responsive widths, a native-Tab RU/UZ/EN public entry-page traversal, retained v121 production accessibility evidence, v120 read-only production operations evidence, retained v118 dashboard keyboard-focus evidence, retained v117 Individual touch-target evidence, unchanged public Sites v97 and website Worker v13, plus retained v116 responsive accessibility evidence. Older release evidence is retained as history. Legislation database, legal corpus, Lex.uz/Advice.uz ingestion, vectors, and staging-capacity remediation are excluded by owner instruction.

## Current production health checkpoint (2026-09-02)

| Area | Public-safe evidence | Result |
| --- | --- | --- |
| Status response | HTTP `200`; generated `2026-09-02T11:56:13.706Z` | PASS |
| Overall | operational; 8/8 components; zero active or recent incidents | PASS AS POINT-IN-TIME EVIDENCE |
| OpenAI | checked `2026-09-02T11:42:48.699Z`; 3,804 ms; no safe error code | OPERATIONAL |
| Anthropic | checked `2026-09-02T11:42:59.226Z`; 10,129 ms; no safe error code | OPERATIONAL |
| Fresh infrastructure evidence | D1 210 ms; queues 1,965 ms; private R2 3,148 ms; DLQ zero; checks between `11:52:11Z` and `11:55:49Z` | OPERATIONAL |
| Freshness boundary | OTP/email evidence was about 8.7 hours old; provider evidence was about 13 minutes old | CHECKPOINT ONLY; NOT AN SLA |

## Public full responsive Chrome matrix (2026-09-02)

| Area | Evidence | Result |
| --- | --- | --- |
| Browser | isolated Google Chrome 152.0.7977.66; temporary profile removed after the run | PASS |
| Sitemap scope | 78 production URLs: 26 RU + 26 UZ + 26 EN | CHECKED |
| Required widths | 320, 360, 375, 390, 430, 768, 1024, 1280, 1440, and 1920 CSS px | 10/10 CHECKED |
| Route/viewport scope | 78 URLs × 10 widths | 780 CHECKS |
| Final page contract | requested URL and HTTP `200`; exactly one `main`; at least one visible H1 | 780/780 PASS AFTER TRANSIENT RECHECK |
| Layout and assets | zero document-level horizontal overflow; zero completed broken images; no localized not-found surface | 780/780 PASS AFTER TRANSIENT RECHECK |
| Console/network | clean on successful checks; the high-rate pass recorded 23 resets/QUIC errors at 768 px and three resets at 1024 px | 754 INITIAL PASS; 26 TRANSIENTS RETESTED |
| Transient recheck | only the 26 affected route/viewport pairs, isolated lower-load Chrome with QUIC disabled | 26/26 PASS |
| Evidence boundary | structural production evidence only; no claim for visual pixel equivalence, orientation change, touch gestures, soft keyboard, zoom, screen readers, or authenticated feature pages at every width | HONESTLY PARTIAL |

## Public sitemap desktop Chrome validation (2026-09-02)

| Area | Evidence | Result |
| --- | --- | --- |
| Sitemap scope | current production sitemap; 26 RU + 26 UZ + 26 EN URLs | 78/78 CHECKED |
| Browser and viewport | real Chrome; actual 1536 px desktop viewport; sequential navigation to every URL | PASS FOR THIS VIEWPORT |
| Route identity | final `location.href` matched the requested sitemap URL | 78/78 PASS |
| Landmarks and headings | exactly one `main` and at least one visible H1 | 78/78 PASS |
| Layout | document scroll width did not exceed the viewport by more than 1 CSS px | 78/78 PASS |
| Images and error surface | no completed image with a zero natural width; no localized not-found text | 78/78 PASS |
| Console | no warning/error entry after each route navigation and hydration wait | 78/78 PASS |
| Evidence boundary | no claim for keyboard traversal on the remaining 75 sitemap URLs, zoom, screen readers, dialogs, form/error states, or visual pixel equivalence | HONESTLY PARTIAL |

## Public entry-page native keyboard validation (2026-09-02)

| Area | Evidence | Result |
| --- | --- | --- |
| Browser and viewport | real Chrome; 1536 × 770; native control-level `Tab` keypresses on `https://juro.uz/{ru,uz,en}` | CHECKED |
| Traversal scope | RU 74, UZ 74, EN 71 detected focusable controls | 219 CONTROL POSITIONS CHECKED |
| Order and wrap | every locale reached the document-body transition and wrapped to the first control; zero stuck positions | PASS FOR SEQUENCE |
| Focus indicator | every real control matched `:focus-visible`; computed outline was `2.4px solid` gold; zero missing indicators | PASS FOR CHECKED CONTROLS |
| Console | no warning/error entries after each locale traversal | PASS |
| Harness limitation | focus advanced after the first viewport while automated `scrollY` remained `0`; 52 RU, 52 UZ, and 49 EN positions were therefore outside the unchanged viewport | NOT A PAGE FAILURE; VIEWPORT AUTO-SCROLL UNVERIFIED |
| Evidence boundary | public entry pages only; does not prove post-fold automatic focus scrolling, feature workflows, dialogs, focus restoration, zoom, forced colors, text spacing, screen readers, or WCAG conformance | HONESTLY PARTIAL |

## DNS retirement and authenticated Lawyer validation (2026-09-02)

| Area | Evidence | Result |
| --- | --- | --- |
| Exact DNS target | Cloudflare record `4435f48bc863cc0ccaddd74a21791e5d`; A `ftp.juro.uz → 95.46.96.77`; DNS-only; TTL Auto/public 300 | PASS |
| Cloudflare change | owner-confirmed deletion; exact row count became zero; no other record edited | PASS |
| Recursive DNS | `1.1.1.1` and `8.8.8.8` returned NXDOMAIN | PASS |
| Authoritative DNS | `tadeo.ns.cloudflare.com` and `tess.ns.cloudflare.com` returned NXDOMAIN | PASS |
| Mail boundary | apex MX, `mail` CNAME, and `send` MX/TXT matched the pre-change snapshot | PASS FOR CONFIGURATION EQUALITY |
| Production hosts | public, app, lawyer, admin, and status checks returned final HTTP `200` | PASS FOR REACHABILITY |
| Lawyer desktop shell | real Lawyer session; 16 protected routes; no login fallback, 404, horizontal overflow, visible alert, or console error | PASS FOR READ-ONLY SHELL |
| Lawyer mobile shell | 15 role routes at 390 × 844; no login fallback, 404, or horizontal overflow; settings loaders settled to visible H1 | PASS FOR RESPONSIVE READ-ONLY SHELL |
| Approved Lawyer → Business isolation | after a forced reload confirmed the approved persona, `app.juro.uz/ru/business/dashboard` returned to `lawyer.juro.uz/ru/dashboard` | PASS FOR NEGATIVE ROLE BOUNDARY |
| Approved Lawyer → Admin isolation | `admin.juro.uz/ru/dashboard` returned `app.juro.uz/ru/admin/console?reason=admin-session`; the generic screen required staff plus MFA/TOTP confirmed within 15 minutes and did not enumerate roles | PASS FOR NEGATIVE ROLE BOUNDARY |
| Privacy boundary | no private client, matter, message, document, or session content read; no state-changing control used | PASS |
| Change boundary | one confirmed DNS deletion; no runtime deploy, migration, database write, secret, payment, auth-policy, corpus/vector/embedding, or staging-capacity operation | PASS |

## v101 mobile interaction-target production validation (2026-09-02)

| Area | Evidence | Result |
| --- | --- | --- |
| Focused regression | platform shell accessibility suite | 12/12 PASS |
| Static and full test gates | lint, type-check, 1,167 core tests, 217 Worker/runtime tests | PASS |
| Production artifact | CSS 565.7 KiB; initial JS 294.1 KiB; largest lazy increment 212.1 KiB; fonts 453.6 KiB; images 564.4 KiB; Worker 3,643.7 KiB | PASS |
| Exact-head CI/security | CI `33595599646`; complete zero-finding scans `d4ae3e1a-a276-4f3d-ba00-3b1a1ad02a2f` and `fea3204e-c3a2-43ba-8210-4fc02a27bb00` | PASS |
| Post-merge CI | `33596215521` on `498ab8944575134163cadcc6c74deeadd3a93fac` | PASS |
| Worker deployment | version `9e7ff503-894e-4be1-a0dc-5ad413fc9ba8`; deployment `08bc17ea-be50-4b1b-a4bc-2ed8110ede8f`; 100% traffic | PASS |
| Production AI targets | authenticated Chrome at 320/390 x 844; options summary 44 px; two mode controls 44 x 44 px | PASS |
| Production notification targets | authenticated Chrome; 200 real-card actions; minimum 178.6 x 44 px; zero overlap; no action clicked | PASS |
| Production privacy target | authenticated Chrome; one deletion control, minimum 191 x 44 px at 320 and 261 x 44 px at 390; no click or submission | PASS |
| Production mobile routes | AI chat, notifications, privacy at 320/390 x 844; zero horizontal overflow, failed resources with exposed HTTP error status, or console errors | PASS |
| Production status | `2026-09-02T06:08:14.064Z`; operational; 8/8; 0 active incidents | PASS AS POINT-IN-TIME EVIDENCE |
| Change boundary | no migration, database write, website/Sites, DNS, secret, payment, auth-policy, corpus/vector/embedding, or staging-capacity operation | PASS |

## v121 production accessibility validation

| Area | Evidence | Result |
| --- | --- | --- |
| Focused regression | platform shell accessibility suite | 11/11 PASS |
| Static and full test gates | lint, type-check, 33 rendered-route tests, 1,166 core tests, 217 Worker/runtime tests | PASS |
| Production artifact | production build and artifact budgets | PASS |
| Exact-head CI/security | CI `33586952165`; complete 0-finding scan `421746e4-7a82-40dd-80ed-1c4d8310c17c` | PASS |
| Post-merge CI | `33589980918` on `4210bb18088e572eef7ddc5a30491f5c63811bac` | PASS |
| Worker deployment | platform v207 `8dc48732-f611-4ed0-abdf-ef57c2fa0936`; deployment `a302b677-ea56-4a93-8b2b-ade4e5827801`; 100% traffic | PASS |
| Production case focus | authenticated Chrome; `2.4px solid` outline, `1.6px` offset; zero desktop overflow | PASS |
| Production action-plan targets | 16 scenario controls, minimum height 44 px; refresh 44 × 44 px | PASS |
| Production security targets | three session action controls, minimum height 44 px; no action clicked | PASS |
| Production mobile routes | cases, action plan, security at 390 × 844; zero horizontal overflow, failed resources, or console errors | PASS |
| Production status | `2026-09-02T04:32:30.760Z`; operational; 8/8; 0 active incidents | PASS AS POINT-IN-TIME EVIDENCE |
| Change boundary | no migration, database write, website/Sites, DNS, secret, payment, auth-policy, corpus/vector/embedding, or staging-capacity operation | PASS |

## v120 production-operations validation

| Area | Evidence | Result |
| --- | --- | --- |
| Provider history | 24-hour content-free D1 history: OpenAI 97/98 operational, Anthropic 98/99 operational; one timeout each, no billing/balance error | PASS FOR BOUNDED RECOVERY WINDOW |
| Recovery sequence | 41 consecutive OpenAI and 29 consecutive Anthropic operational probes after the last timeout | PASS FOR OBSERVED SEQUENCE; NOT AN SLA |
| Public status | `2026-09-02T02:02:51.223Z`; operational; 8/8; 0 active incidents; latest provider evidence matched D1 | PASS AS CURRENT SNAPSHOT |
| Legacy FTP reachability | `ftp.juro.uz` resolves to `95.46.96.77`; FTP timeout; HTTP default AlmaLinux page; invalid hostname TLS | FAIL / RETIREMENT REQUIRED |
| DNS safety boundary | API token rejected DNS-record access; Chrome reached Cloudflare sign-in; no record was changed | PASS FOR NO UNAUTHORIZED MUTATION |
| Change boundary | documentation only; no runtime deploy, migration, DNS, secret, payment, auth-policy, corpus/vector/embedding, or staging-capacity operation | PASS |

## v118 Dashboard keyboard-focus validation

| Area | Evidence | Result |
| --- | --- | --- |
| Focused regression | platform shell accessibility suite | 10/10 PASS |
| Static and full test gates | lint, type-check, full platform test command, 217 Worker/runtime tests | PASS |
| Production artifact | CSS 565.0 KiB; initial JS 294.1 KiB; largest lazy increment 212.1 KiB; fonts 453.6 KiB; images 564.4 KiB; Worker 3,640.6 KiB | PASS |
| Exact-head CI/security | CI `33578000481`; complete 0-finding scan `cad38f72-f2c0-40ed-a3ed-7cd0b525d76e` across all three changed artifacts | PASS |
| Post-merge CI | `33578605701` on `617ec64ffcb21633f7b8bb734d28639de8b099e1` | PASS |
| Worker deployment | platform v206 `1ec688d4-e085-4aa9-a34d-df02b0c1ae1c`; deployment `63cb71bb-5482-4bcf-9bd0-e652c81c9ef0`; 100% traffic | PASS |
| Production Chrome focus path | 390 × 844; composer focus ring visible; four quick cards fully visible after Tab; scroller positions 2/334/666/974 px; one main/H1; overflow 0 | PASS |
| Authenticated read-only route audit | 18 Individual routes; correct final paths; one main and one visible H1; overflow 0; zero new console errors | PASS FOR READ-ONLY SHELL |
| Production status | `2026-09-02T01:32:20.313Z`; operational; 8/8; 0 active incidents | PASS AS POINT-IN-TIME EVIDENCE |
| Change boundary | no migration, database write, website/Sites, DNS, secret, payment, auth-policy, corpus/vector/embedding, or staging-capacity operation | PASS |

## v117 Individual touch-target validation

| Area | Evidence | Result |
| --- | --- | --- |
| Focused regression | platform shell accessibility suite | 9/9 PASS |
| Static and full test gates | lint, type-check, 1,164 core tests, 217 Worker/runtime tests | PASS |
| Production artifact | production build, binding/manifest validation, all size budgets | PASS |
| Exact-head CI/security | CI `33574360732`; complete 0-finding scan `d803816b-0e51-42e8-9d6e-359ea36ccc04` | PASS |
| Post-merge CI | `33574968921` on `40667c017358011a3017da0bea379839fb328297` | PASS |
| Worker deployment | platform v204 `12ae95e6-5eac-4f14-8257-a30dff56128d`; 100% traffic | PASS |
| Production Chrome matrix | 390/768/1024/1440 px; case link 44 px; four settings tabs 44 px; overflow 0; one main and visible H1 | PASS |
| Production status | `2026-09-02T00:26:20.487Z`; operational; 8/8; 0 active incidents | PASS AS POINT-IN-TIME EVIDENCE |
| Change boundary | no migration, database write, corpus/vector/embedding, DNS, secret, payment, or auth-policy operation | PASS |

## v116 responsive auth and locale-target validation

| Area | Evidence | Result |
| --- | --- | --- |
| Platform focused regression | auth/Turnstile CSS suite | 8/8 PASS |
| Website focused regression | homepage production suite | 20/20 PASS |
| Static and build gates | website/platform lint, type-check, production build and artifact validation | PASS |
| Exact-head CI/security | CI `33568387883`; complete 0-finding scan `1084b6c7-7516-4b17-b1fb-bda7b183ae2e` | PASS |
| Post-merge CI | `33569063853` on `3575ed3aff26904ac2d166c0c2be38f1b94b9755` | PASS |
| Worker deployment | platform v202 `a88dbd8d-b368-4ff8-911c-0c817df7d9a7`; website v13 `3ee7a1ae-888a-4c98-8f49-de73783e6b7e`; 100% traffic | PASS |
| Sites deployment | v97, source `77691d0c2f4d7eaeff759ff3f08eded893d2f835`, deployment `appgdep_6a975c1651d0819194779c579abd961b` | PASS |
| Public Chrome matrix | 390/768/1024/1440 px; overflow 0; one main and visible H1; visible locale links 44 × 44 | PASS |
| Lawyer auth Chrome matrix | same four viewports; heading/theme overlap 0 px²; heading/language overlap 0 px²; Turnstile visible | PASS |
| Authenticated Individual shell | same four viewports; overflow 0; one main/H1; sampled visible controls at least 44 px | PASS FOR READ-ONLY SHELL |
| Role enforcement | Business redirected to allowed Individual dashboard; Lawyer required reauthentication; Admin required protected admin session | PASS FOR BOUNDARIES; ROLE JOURNEYS OPEN |
| Live routes and indexing | RU/UZ/EN, robots and sitemap 200; 78 sitemap URLs; provider host noindex split preserved | PASS |
| Live console | checked public and lawyer-auth pages | 0 errors, 0 warnings |
| Production status | `2026-09-01T23:18:39.567Z`; operational; 8/8; 0 active incidents | PASS AS POINT-IN-TIME EVIDENCE |

## v115 mobile accessibility release validation

| Area | Evidence | Result |
| --- | --- | --- |
| Website regression | focused homepage production suite | 19/19 PASS |
| Platform auth/theme regression | focused Turnstile/auth/theme suites | 14/14 PASS |
| Website static gates | type-check and lint | PASS |
| Platform static gates | type-check and lint | PASS |
| Production artifacts | website and platform production builds with artifact validation | PASS |
| Platform artifact budgets | CSS 564.9 KiB; initial JS 294.1 KiB; largest lazy increment 212.1 KiB; fonts 453.6 KiB; images 564.4 KiB; Worker 3,640.6 KiB | PASS |
| Public mobile Chrome | theme controls 44 × 44 at 390 × 844; zero horizontal overflow | PASS |
| Mobile auth Chrome | theme/form-heading overlap 0 px² at 390 × 844; zero horizontal overflow | PASS |
| Exact-head CI/security | CI `33562290115`; complete 0-finding scan `a255ec0b-c48d-46f7-bf95-119d6f6b389e` | PASS |
| Post-merge CI | workflow `33562912368` on merge `cd3ee161bb4a54c7bdc71b89c39a402f3ad35c4d` | PASS |
| Worker deployment | platform `ca427ea9-97cb-45fe-84dc-b468e8bd8995`; website `fad80c80-ee92-44bb-93a3-e250ee314891`; 100% traffic | PASS |
| Public Sites deployment | v96, source `489c56d029f164c030127f7465d528f8f1bdf396`, deployment `appgdep_6a974c2c182481919de7a0a165025b29` | PASS |
| Live route/link checks | RU/UZ/EN and `/ru#start` 200; sitemap 78/78; unique discoverable apex links 120/120 | PASS |
| Production public Chrome | 390 × 844; theme controls 44 × 44; 21/21 reveals; zero overflow; RU/UZ/EN canonical/indexing checks | PASS |
| Production lawyer auth Chrome | login heading/theme overlap 0 px²; Turnstile visible; submit disabled before verification; zero overflow | PASS |
| Production Lighthouse/trace | repeated mobile Lighthouse 100/100/100/100; warm LCP 776 ms; CLS 0.00 | PASS AS LAB EVIDENCE |
| Production status | snapshot `2026-09-01T22:10:42.083Z`; operational; 8/8 components; 0 active incidents | PASS AS POINT-IN-TIME EVIDENCE |

## v114 production release validation

| Area | Evidence | Result |
| --- | --- | --- |
| Auth layout regression | 7 focused Turnstile/auth CSS tests | PASS |
| Public website regression | complete website suite | 46/46 PASS |
| Website static gates | type-check and lint | PASS |
| Platform static gates | type-check and lint | PASS |
| Production artifacts | website build and platform production build/validation | PASS |
| Platform artifact budgets | CSS 564.8 KiB; initial JS 294.1 KiB; largest lazy increment 212.1 KiB; fonts 453.6 KiB; images 564.4 KiB; Worker 3,640.6 KiB | PASS |
| Chrome performance | local LCP 1,334 ms; CLS 0.00; no top-level JURO forced-reflow function; 83 ms unattributed | PASS AS LOCAL LAB EVIDENCE |
| Chrome responsive/reveal matrix | RU/UZ/EN desktop and RU mobile 21/21; `/ru#start` 21/21; zero overflow; clean console | PASS |
| Local auth layout | 1440 × 900 and 390 × 844; zero overflow; sampled mobile controls at least 44 CSS px | PASS WITH PROVIDER CHALLENGE UNAVAILABLE LOCALLY |
| Exact-head CI and security | CI `33553792614`; 0-finding scan `76bb90c9-cd9d-4ee2-a54f-3b2ea6a5f10c` | PASS |
| Post-merge CI | workflow `33557373604` | PASS |
| Deployment | workflow `33557372781`; website `5f04e052-c2ef-4af7-820a-b29819bcdef9`; platform `cef2e39c-4f56-4743-9287-b036192f1771` | PASS |
| Production public Chrome | RU/UZ/EN 21/21 reveals; `/ru#start`; zero overflow; clean console | PASS |
| Production mobile performance | throttled LCP 1,744 ms; CLS 0.00; no estimated DevTools savings | PASS WITH REMAINING FRAMEWORK/UNATTRIBUTED FORCED LAYOUT |
| Production status | HTTP 200; operational; 8/8 components; 0 active incidents | PASS AS POINT-IN-TIME EVIDENCE |

The first ad-hoc Node invocations used unsupported paths and failed before loading product tests; the exact project test commands were then used and passed. The local production server cannot load `cloudflare:` modules without the project loader, so auth visual QA used the supported Vite/Cloudflare development server after the production artifact itself had already passed validation. These harness corrections are not product failures and are not hidden as uninterrupted green runs.

## v101 release verification

- PR #103 merged as `840f1144f3ba8562a7866cd4bda99525be392758`; the exact reviewed head was `e14532c12a9200bc335f8a506fa452a788069efd`.
- Website Worker `d6ff54c8-0bbc-4921-a54e-581027689a41` and platform Worker `9c434c4e-52af-41cd-b680-eb0730b87e37` became active after successful release workflows.
- Production Chrome verified 21/21 reveals on RU/UZ/EN and direct `/ru#start`, zero overflow at 1440 × 900 and 390 × 844, and a clean console.
- Warm LCP was 519 ms with CLS 0.01; cold LCP was 2,717 ms with TTFB 1,769 ms. Desktop Lighthouse scored Accessibility, Best Practices, SEO, and Agentic Browsing at 100 each.
- Exact-head security diff scan `e4263939-7125-4a85-b1e7-3e77985fb307` reported 0 findings.
- Production status recovered to operational, 8/8 components and 0 active incidents at the retained checkpoint. This point-in-time result does not prove sustained provider health.

## Automated release checks

| Area | Evidence | Result |
| --- | --- | --- |
| Status metadata regressions | 4 focused tests | PASS |
| Platform core application | 1,142 tests | PASS |
| Worker/runtime and infrastructure | 217 tests | PASS |
| TypeScript | `type-check` | PASS |
| Lint | repository lint | PASS |
| Cloudflare configuration | environment matrix validation and generated types check | PASS |
| Production artifact | production artifact validation and budget checks | PASS |
| Dependency and licence policy | production dependency audit, website toolchain audit, licence enforcement | PASS |
| Pull request CI | PR #95 workflow `33352197361` | PASS |
| Post-merge CI | workflow `33404886188` on merge `d133a470a49166875d9112b938ae3f7d765ee170` | PASS |
| Production deployment | workflow `33404885913` | PASS |

During the earlier v187 validation, one initial parallel local run hit a Windows build-directory collision. The suites were rerun sequentially and passed in full; this was not treated as a product failure or hidden as a green parallel run.

## Security review

- Security diff scan ID: `97f3ebca-264a-4d1d-aff6-2eec9448ec0c`.
- Findings: 0 reportable security findings.
- Coverage: partial for the initial patch because it did not yet cover every status route/host or live edge behavior.
- Scan usage: 5,883,477 total tokens; 5,850,397 input tokens; 5,589,504 cached input tokens; 33,080 output tokens; 10,553 reasoning tokens.

The scan identified release-blocking functional and CSP coverage gaps in the initial status-metadata patch even though it found no reportable vulnerability. Before merge, the implementation was changed to use a Worker-owned origin header, validate the allowed status hosts, cover both localized and root status routes, and preserve the existing CSP. Focused tests and live Chrome/HTTP verification cover the final release behavior; the scan is not evidence for the entire historical repository.

## Production Worker verification

- Active Worker: v189, ID `102dcb2d-f79f-4172-9a3a-19d55d51f6ed`, 100% traffic.
- Rollback: v188, ID `57387083-9f7f-4cd8-a9f2-84414f2604d6`.
- Public `/api/status` generated at `2026-08-31T15:07:12.161Z`: HTTP `200`, overall `degraded`, 6/8 components operational, 0 active incidents.
- Fresh D1 evidence: `operational`, `192 ms`, `evidenceKind: synthetic_probe`, checked at `2026-08-31T15:05:19.870Z`.
- Public provider codes are redacted to `PROVIDER_UNAVAILABLE`.
- Earlier read-only D1 evidence recorded `PROVIDER_CREDIT_BALANCE_LOW` for OpenAI and Anthropic; that pre-top-up detail is retained as historical evidence, not asserted as the current Anthropic account state.
- Provider failure intervals after v187 were 10.36–15.82 minutes rather than the pre-release 3–6 minute cadence.
- Document-analysis evidence advanced after 26.2 minutes and recorded the routed provider failure instead of repeating every scheduler cycle.
- Chrome rendered the status root, unlocalized status route, RU and UZ localized status routes, and the app-host RU status route with no console errors or warnings. Raw response HTML confirmed that status-host icons resolve to `status.juro.uz` and app-host icons remain on `app.juro.uz`; the existing CSP was unchanged.

The Worker is deployed correctly, but AI and document analysis remain degraded until provider funding/workspace alignment yields fresh successful probes.

## Public Sites v95 verification

- Saved source: `855ba2161b716daabb96ac469456c101e5d3bb2c`.
- Deployment: `appgdep_6a94c1cfc364819190b65a5cb0a7e5ad`.
- `juro.uz`: `/`, RU, UZ, EN, `robots.txt`, and `sitemap.xml` return `200` and remain indexable.
- Provider hostname: the same entry and discovery routes return `200` with `X-Robots-Tag: noindex, nofollow, noarchive`.
- Sitemap crawl: 78/78 URLs returned `200`.
- Discoverable JURO-zone link crawl: 149/149 links returned `200` after redirects; 121 target `juro.uz` and 28 target `app.juro.uz`.
- Chrome smoke passed on both the custom domain and provider hostname with no console errors.
- Rollback: saved Sites v94.

## Artifact budgets for v189

| Artifact | Measured size |
| --- | ---: |
| Client CSS | 564.7 KiB |
| Initial browser JavaScript | 294.1 KiB |
| Largest lazy route increment | 212.1 KiB |
| Fonts | 453.6 KiB |
| Images | 564.4 KiB |
| Worker entry | 3,576.8 KiB |

These are build-budget measurements, not field Core Web Vitals.

## Still unproven

- state-changing authenticated journeys; full Business, Pending Lawyer, and Staff/Admin coverage; state-changing Lawyer/client collaboration;
- full critical-scenario E2E with real authorized test sessions;
- manual keyboard accessibility for all critical flows;
- visual regression across every required viewport;
- field performance baselines and before/after Core Web Vitals for every production route;
- staging reliability, because the excluded staging D1 capacity blocker prevents fresh scheduler persistence;
- sustained provider recovery beyond the current operational snapshot.

The overall execution goal must remain active until these and the other Definition-of-Done gates are proven.
