# JURO Execution Changelog

Status: **living changelog; the full execution goal remains active**

Evidence cutoff: **2026-09-02 12:45 UZT**

This file records verified production increments. It must not be read as a claim that every item in the execution brief is complete.

## DNS retirement and authenticated Lawyer evidence receipt (2026-09-02)

- Deleted only Cloudflare record `4435f48bc863cc0ccaddd74a21791e5d`, `A ftp.juro.uz → 95.46.96.77`, DNS-only, dashboard TTL Auto/public TTL 300, after exact action-time confirmation.
- Verified the record disappeared in Cloudflare and `ftp.juro.uz` returned NXDOMAIN through `1.1.1.1`, `8.8.8.8`, `tadeo.ns.cloudflare.com`, and `tess.ns.cloudflare.com`.
- Verified the pre/post apex MX, `mail` CNAME, and `send` MX/TXT contract was unchanged. Public, app, lawyer, admin, and status endpoints returned final HTTP `200`. No other DNS record changed.
- Completed read-only Chrome QA with a real Lawyer session across 16 discovered protected routes on the dedicated host; 15 role routes also passed at 390 × 844. There was no login fallback, 404, horizontal overflow, visible alert, or console error, and protected settings loaders settled to a visible H1.
- Read no private client, matter, message, document, or session content and used no state-changing control. Business, Pending Lawyer, Staff/Admin, Lawyer/client mutations, and broader Definition-of-Done gates remain open.
- This receipt changes documentation only. It performs no runtime deployment, migration, database write, secret, binding, payment, auth-policy, legal-corpus, vector, embedding, or staging-capacity operation.

## v101 mobile interaction-target production release (2026-09-02)

- Raised the AI options summary, both mobile AI-mode controls, notification actions, and the privacy deletion control to a minimum 44 CSS px target. Added canonical notification route layouts so both Individual and Business notification pages load the existing notification stylesheet.
- Passed 12/12 focused accessibility tests, lint, type-check, 1,167 core tests, 217 Worker/runtime tests, production build, and artifact budgets.
- PR #129 passed final exact-head CI `33595599646` and two complete zero-finding security diff scans: initial scan `d4ae3e1a-a276-4f3d-ba00-3b1a1ad02a2f` and focused follow-up scan `fea3204e-c3a2-43ba-8210-4fc02a27bb00`. It merged as `498ab8944575134163cadcc6c74deeadd3a93fac`; post-merge CI `33596215521` passed.
- Production workflow `33596214731` activated platform Worker version `9e7ff503-894e-4be1-a0dc-5ad413fc9ba8` through deployment `08bc17ea-be50-4b1b-a4bc-2ed8110ede8f` at 100% traffic. Website, Admin, and public Sites were unchanged.
- Authenticated Chrome at 320 x 844 and 390 x 844 verified a 44 px AI options summary, two 44 x 44 AI-mode controls, 200 notification actions with a 44 px minimum height and no overlap, and one privacy deletion control with a 44 px minimum height. The destructive control was not clicked and no form was submitted.
- All three checked routes had zero horizontal overflow, zero resources with an exposed HTTP error status, and zero console errors. The temporary viewport override was reset and the QA tabs were closed.
- The public status snapshot generated at `2026-09-02T06:08:14.064Z` was operational with 8/8 components and no active incidents. This is point-in-time evidence only.
- Performed no migration, database write, DNS change, binding, secret, payment, auth-policy, legal-corpus, vector, embedding, or staging-capacity operation. The broader role matrix and obsolete FTP DNS retirement remain open.

## v121 production accessibility release

- Added a visible focus ring to the case-search container and raised action-plan scenario, refresh, and security-session controls to a minimum 44 CSS px target.
- Passed 11/11 focused accessibility tests, lint, type-check, 33 rendered-route tests, 1,166 core tests, 217 Worker/runtime tests, production build, and artifact budgets.
- PR #127 passed exact-head CI `33586952165` and complete 0-finding security scan `421746e4-7a82-40dd-80ed-1c4d8310c17c`, then merged as `4210bb18088e572eef7ddc5a30491f5c63811bac`. Post-merge CI `33589980918` passed.
- Production workflow `33589981236` activated platform Worker v207 `8dc48732-f611-4ed0-abdf-ef57c2fa0936` through deployment `a302b677-ea56-4a93-8b2b-ade4e5827801` at 100% traffic. Website, Admin, and public Sites were unchanged.
- Authenticated Chrome verified a visible `2.4px solid` case-search focus ring with `1.6px` offset, 16 scenario controls at least 44 px tall, a 44 × 44 refresh control, and three security-session controls at least 44 px tall. No session action was clicked and no private case or session content was read.
- The cases, action-plan, and security routes had zero horizontal overflow at the 390 × 844 mobile override, zero failed resources with an exposed HTTP error status, and zero console errors. The viewport override was reset.
- The public status snapshot generated at `2026-09-02T04:32:30.760Z` was operational with 8/8 components and no active incidents. This is point-in-time evidence only.
- Performed no migration, database write, DNS change, binding, secret, payment, auth-policy, legal-corpus, vector, embedding, or staging-capacity operation. The role matrix and obsolete FTP DNS retirement remain open.

## v120 production-operations evidence

- Replaced the earlier point-in-time-only provider statement with a content-free 24-hour production history: OpenAI 97/98 and Anthropic 98/99 operational probes, one isolated timeout each, and no billing/balance error in the window.
- Confirmed 41 consecutive successful OpenAI probes and 29 consecutive successful Anthropic probes after their last timeouts. The public status snapshot at `2026-09-02T02:02:51.223Z` was operational with 8/8 components and no active incidents.
- Proved `ftp.juro.uz` is not an operational FTP service: port 21 timed out, HTTP exposed the default AlmaLinux test page, HTTPS hostname validation failed, and repository search found no product dependency.
- Prepared an exact reversible DNS retirement and rollback contract. No DNS mutation occurred because the available OAuth token lacks DNS-record permission and the authorized Chrome session required Cloudflare sign-in.
- This increment changes documentation only. It performs no runtime deployment, migration, database write, DNS write, secret, payment, auth-policy, legal-corpus, vector, embedding, or staging-capacity operation.

## v118 Dashboard keyboard-focus release

- Adds an explicit focus ring to the dashboard AI composer and quick-action cards, and uses nearest-edge native scrolling when a quick card receives keyboard focus.
- Passed the focused accessibility suite 10/10, lint, type-check, the full platform test command, 217 Worker/runtime tests, production artifact validation and budgets, exact-head CI `33578000481`, post-merge CI `33578605701`, and complete 0-finding security scan `cad38f72-f2c0-40ed-a3ed-7cd0b525d76e`.
- Merged PR #124 as `617ec64ffcb21633f7b8bb734d28639de8b099e1` and activated platform Worker v206 `1ec688d4-e085-4aa9-a34d-df02b0c1ae1c` through deployment `63cb71bb-5482-4bcf-9bd0-e652c81c9ef0` at 100% traffic. Public Sites v97 and website Worker v13 were unchanged.
- Production Chrome at 390 × 844 proved one main, one visible H1, zero horizontal overflow, a visible composer focus ring, all four quick cards fully visible as keyboard focus advanced, and zero console messages.
- The retained 18-route authenticated Individual read-only audit resolved every route correctly with one main/H1, zero overflow, and no new console errors. No state-changing action or private document inspection was performed.
- The status snapshot generated at `2026-09-02T01:32:20.313Z` was operational with 8/8 components and no active incidents. This is point-in-time evidence only.
- Performed no migration, database write, website/Sites, DNS, binding, secret, payment, auth-policy, legal-corpus, vector, embedding, or staging-capacity operation. Role-specific and state-changing journeys remain open.

## v117 Individual touch-target release

- Raises the existing Individual case-row navigation link from 17 CSS px to a 44 px minimum touch target without changing its route or tenant boundary.
- Raises all four Individual profile/settings tabs from 42 to 44 CSS px and adds a focused source-level regression contract.
- Passed focused touch-target tests 9/9, lint, type-check, the full platform suites (1,164 core and 217 Worker/runtime tests), production artifact validation, exact-head CI `33574360732`, post-merge CI `33574968921`, and complete 0-finding security scan `d803816b-0e51-42e8-9d6e-359ea36ccc04`.
- Merged PR #122 as `40667c017358011a3017da0bea379839fb328297` and activated platform Worker v204 `12ae95e6-5eac-4f14-8257-a30dff56128d` at 100% traffic. Public Sites v97 and website Worker v13 were unchanged.
- Production Chrome proved 44 px case links, four 44 px settings tabs, one main landmark, a visible H1, and zero horizontal overflow at 390, 768, 1024, and 1440 px.
- The status snapshot generated at `2026-09-02T00:26:20.487Z` was operational with 8/8 components and no active incidents. This is point-in-time evidence only.
- Performed no migration, database write, legal-corpus, vector, embedding, staging-capacity, DNS, secret, payment, or auth-policy operation.

## v116 responsive auth and locale-target release

- Reserves a protected top row for auth theme and locale controls at every viewport, resolving the production heading overlap observed at 768 × 1024 and 1024 × 768.
- Gives every visible public RU/UZ/EN header link a minimum 44 × 44 CSS px target, including tablet and desktop widths.
- Passed focused platform tests 8/8, focused website tests 20/20, lint, type-check, production builds, exact-head CI `33568387883`, post-merge CI `33569063853`, and complete 0-finding security scan `1084b6c7-7516-4b17-b1fb-bda7b183ae2e`.
- Merged PR #120 as `3575ed3aff26904ac2d166c0c2be38f1b94b9755`.
- Activated platform Worker v202 `a88dbd8d-b368-4ff8-911c-0c817df7d9a7` and website Worker v13 `3ee7a1ae-888a-4c98-8f49-de73783e6b7e` at 100% traffic.
- Published Sites v97 from source `77691d0c2f4d7eaeff759ff3f08eded893d2f835` through deployment `appgdep_6a975c1651d0819194779c579abd961b`; v96 remains the immediate rollback.
- Production Chrome proved zero auth heading/control overlap and zero horizontal overflow at 390, 768, 1024, and 1440 px. Public locale targets are 44 × 44 wherever visible; public and lawyer-auth consoles were clean.
- The authenticated Individual dashboard was reachable and responsive. Business correctly redirected this Individual account to its permitted dashboard, lawyer access required explicit reauthentication, and Admin required a protected admin session. These checks prove boundary enforcement, not completed role journeys.
- RU, UZ, EN, `robots.txt`, and the 78-URL sitemap returned `200`; the provider hostname remains `noindex, nofollow, noarchive` while `juro.uz` remains indexable.
- The status snapshot generated at `2026-09-01T23:18:39.567Z` was operational with 8/8 components and no active incidents. This is point-in-time evidence only.
- Performed no migration, database write, legal-corpus, vector, embedding, staging-capacity, DNS, secret, payment, or auth-policy operation.

## v115 mobile accessibility release

- Moves the mobile auth form heading below the fixed theme/language controls, eliminating the overlap observed on the live lawyer login at 390 × 844.
- Enlarges all three public theme buttons from 32 × 32 to 44 × 44 CSS px without introducing horizontal overflow at 390 px.
- Adds source-level regression contracts for both defects.
- Passed 19/19 focused website tests, 14/14 focused platform auth/theme tests, website/platform lint and type-check, both production builds, artifact validation, and local Chrome geometry/visual QA.
- Merged PR #118 as `cd3ee161bb4a54c7bdc71b89c39a402f3ad35c4d` after exact-head CI `33562290115` and a complete 0-finding security diff scan `a255ec0b-c48d-46f7-bf95-119d6f6b389e`; post-merge CI `33562912368` also passed.
- Activated platform Worker `ca427ea9-97cb-45fe-84dc-b468e8bd8995` and website Worker `fad80c80-ee92-44bb-93a3-e250ee314891` at 100% traffic.
- Published public Sites v96 from source `489c56d029f164c030127f7465d528f8f1bdf396` through deployment `appgdep_6a974c2c182481919de7a0a165025b29`; saved v95 is the immediate rollback and v94 remains available.
- Production Chrome at 390 × 844 verified 44 × 44 public theme controls, zero horizontal overflow, 21/21 reveal nodes, zero lawyer-login heading/control overlap, visible Turnstile, and a disabled submit action before verification.
- RU, UZ, EN, and `/ru#start` return `200`; 78/78 sitemap URLs and 120/120 unique discoverable apex links return `200`. The provider hostname retains `X-Robots-Tag: noindex, nofollow, noarchive` while `juro.uz` remains indexable.
- A repeated mobile Lighthouse run scored Accessibility 100, Best Practices 100, SEO 100, and Agentic Browsing 100. The warm production trace recorded LCP 776 ms and CLS 0.00.
- The production `/api/status` snapshot generated at `2026-09-01T22:10:42.083Z` was operational with 8/8 operational components and no active incidents. This is point-in-time evidence, not sustained-health proof.
- Performed no database, legal-corpus, vector, embedding, migration, DNS, binding, or secret operation. Authenticated Business, Lawyer, Pending Lawyer, and Staff/Admin journeys remain separate open gates.

## v114 mainline performance release

- Based directly on current `origin/main` rather than the superseded stacked v102-v113 chain.
- Defers initial public-page geometry measurement through two animation frames and publishes motion readiness only after layout reads complete.
- Replaces the site-header `scrollY` callback with an observer sentinel, removing the named 46 ms `SiteChrome` forced-reflow source from the repeat local trace.
- Uses content-sized mobile auth rows and reserves at least 72 CSS px through the nested Turnstile boundary.
- Passed 7/7 focused auth tests, 46/46 website tests, website/platform type-check and lint, website and platform production builds, platform artifact budgets, and local Chrome responsive/reveal/console checks.
- Local Chrome recorded LCP 1,334 ms, CLS 0.00, no top-level JURO forced-reflow function, and 83 ms of unattributed layout work with no estimated savings. This is local lab evidence, not a production or field claim.
- Merged PR #117 as `98af3130d34b255e14159a864d44747fdc9c8c95` after exact-head CI `33553792614` and security scan `76bb90c9-cd9d-4ee2-a54f-3b2ea6a5f10c` reported zero findings; post-merge CI `33557373604` also passed.
- Production workflow `33557372781` activated website Worker `5f04e052-c2ef-4af7-820a-b29819bcdef9` and platform Worker `cef2e39c-4f56-4743-9287-b036192f1771` at 100% traffic.
- Retained website `d6ff54c8-0bbc-4921-a54e-581027689a41` and platform `9c434c4e-52af-41cd-b680-eb0730b87e37` as rollback versions.
- Production Chrome verified RU/UZ/EN at 21/21 reveals, direct `/ru#start`, zero overflow, and a clean public console. A throttled mobile trace recorded LCP 1,744 ms and CLS 0.00 with no estimated DevTools savings; remaining forced layout was primarily framework/unattributed rather than eliminated.
- Production `/api/status` returned HTTP 200, `operational`, 8/8 operational components, and zero active incidents at the checked snapshot. This is point-in-time evidence, not a sustained-health claim.
- Production QA found the 32 px public theme targets and a mobile lawyer-auth heading overlap; both are resolved by the v115 release above.

## v101 production release

- Merged PR #103 as `840f1144f3ba8562a7866cd4bda99525be392758` after exact-head CI and a 0-finding security diff scan.
- Activated website Worker `d6ff54c8-0bbc-4921-a54e-581027689a41` and platform Worker `9c434c4e-52af-41cd-b680-eb0730b87e37`.
- Verified 21/21 reveal sections across RU/UZ/EN and direct `/ru#start`, no horizontal overflow at 1440 × 900 and 390 × 844, and no console errors or warnings.
- Recorded warm LCP 519 ms / CLS 0.01 and cold LCP 2,717 ms / TTFB 1,769 ms; desktop Lighthouse scored Accessibility, Best Practices, SEO, and Agentic Browsing at 100 each.
- Retained truthful point-in-time production status evidence: operational, 8/8 components, 0 active incidents. Sustained provider health and authenticated role journeys remain separate gates.

## Platform Worker v189

- Merged PR #95 as `d133a470a49166875d9112b938ae3f7d765ee170`.
- Deployed Worker version ID `102dcb2d-f79f-4172-9a3a-19d55d51f6ed` at 100% traffic through workflow `33404885913`.
- Replaced cross-host status favicon metadata with absolute same-origin icon URLs selected from a Worker-owned, allowlisted status origin.
- Covered the status root rewrite, unlocalized `/status`, RU/UZ localized routes, production/staging status hosts, localhost development, and the app-host fallback.
- Preserved the existing CSP, DNS, bindings, secrets, databases, Sites release, authentication, and legislation/corpus scope.
- Verified five production routes in Chrome with no console errors or warnings; raw HTML and asset requests confirmed same-origin icons and `200 image/png` responses.
- Retained Worker v188 ID `57387083-9f7f-4cd8-a9f2-84414f2604d6` as rollback.

## Platform Worker v188

- Merged PR #93 as `f14c3d9bd6b0645f3d9ef5da3bca7ab412138aae`.
- Deployed Worker version ID `57387083-9f7f-4cd8-a9f2-84414f2604d6` at 100% traffic through workflow `33347775254`.
- Replaced the misleading whole-cron D1 latency with a direct `SELECT 1 AS ok` probe.
- Added a 2,000 ms high-latency threshold with safe public code `PROBE_LATENCY_HIGH`.
- Preserved content-free diagnostics and ensured observability persistence cannot fail completed product work.
- Verified fresh production D1 evidence: `35 ms`, `operational`, `synthetic_probe`.
- Preserved truthful overall `degraded` status while OpenAI, Anthropic, and document analysis remain unavailable.
- Retained Worker v187 ID `65ce3f7f-3469-4c43-854c-d073309befed` as rollback.

## Public Sites v95

- Published saved version 95 from source `855ba2161b716daabb96ac469456c101e5d3bb2c`.
- Restored the provider-host duplicate-indexing boundary with `X-Robots-Tag: noindex, nofollow, noarchive`.
- Preserved `index, follow` and self-canonical localized URLs on `juro.uz`.
- Verified 78/78 sitemap URLs and 149/149 discoverable JURO-zone links return `200`.
- Verified the custom domain and provider hostname in Chrome with no console errors.
- Retained saved Sites v94 as rollback.

## Platform Worker v187

- Merged PR #91 as `8213511b9dcc89125a283672290bc9bca60a6e3f`.
- Deployed Worker version ID `65ce3f7f-3469-4c43-854c-d073309befed`.
- Made degraded dependency evidence respect each probe's cooldown.
- Added a bounded real-provider document-analysis probe with OpenAI-to-Anthropic fallback.
- Removed the direct named-provider dependency from the document-analysis component health composition; the routed feature probe now represents the OR condition.
- Added regression tests for cooldown behavior, fallback bounds, and safe provider diagnostics.
- Verified provider evidence at 10.36–15.82 minute intervals and document-analysis evidence after 26.2 minutes instead of the previous 3–6 minute failure cadence.
- Preserved public redaction of provider-specific billing diagnostics.
- Retained Worker v186 ID `7b269272-4fc4-4911-97ab-8dfc28c260d0` as rollback.

## Latest validation summary

- 4/4 focused status-metadata tests passed.
- 1,142/1,142 platform core tests passed.
- 217/217 Worker/runtime tests passed.
- Lint, type-check, Cloudflare matrix, generated types, production artifact validation, dependency audits, and licence policy passed.
- PR, post-merge CI, and production deployment workflows passed.
- The security diff scan reported zero reportable findings and exposed functional/CSP coverage gaps in the initial patch; those gaps were corrected before merge and verified by focused tests plus live Chrome/HTTP checks.
- PR #95 exact-head CI `33352197361`, post-merge CI `33404886188`, and production workflow `33404885913` passed.
- Production `/api/status` returns HTTP `200`, remains truthfully `degraded`, reports 6/8 components operational, reports no active incidents, and publishes direct D1 evidence at 192 ms in the checked snapshot.

## Current limitations

- The checked v114 production snapshot reports fresh successful OpenAI and Anthropic probes, but sustained provider health is not yet proven.
- Authenticated read-only Chrome QA now covers the individual dashboard and seven primary individual routes; the individual account is redirected away from a business-only route, and the lawyer host requires lawyer reauthentication. State-changing individual flows plus Business, Lawyer, Pending Lawyer, and Staff/Admin journeys remain incomplete.
- Staging scheduler persistence remains blocked by the excluded staging D1 capacity issue.
- Legacy origin ownership/TLS risk and the full manual accessibility, responsive, performance, and E2E matrices remain open.
- All legislation-database, corpus, Lex.uz, Advice.uz, vector, and source-record work remains excluded from this increment.
