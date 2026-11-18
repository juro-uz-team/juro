# JURO Domain & Route Inventory

Status: **live baseline, not a completion certificate**

Evidence cutoff: **2026-09-02 16:56 UZT (2026-09-02 11:56 UTC)**

Repository baseline: `origin/main` at documentation merge `1bdece2d98d3abde1e93e595d023242a95da2a8e`; live platform Worker `9e7ff503-894e-4be1-a0dc-5ad413fc9ba8`, website Worker v13, and public Sites v97 were verified independently after deployment

This inventory separates live production, protected staging, provider-owned Sites surfaces, code-only hostnames, and legacy DNS. It intentionally does not inspect or change the legislation database, legal-corpus contents, Lex.uz ingestion, Advice.uz ingestion, vectors, or legal-source records, following the owner's explicit scope exclusion.

## Evidence and classification rules

Sources used:

- Cloudflare DNS dashboard for the `juro.uz` zone: 22 active records, including seven Worker hostnames;
- Wrangler 4.115.0 deployment and version metadata for the platform, admin, staging, and legacy app router Workers;
- Sites project `appgprj_6a5e1b9547e88191bf759bbeae44d315`, live version 97;
- live HTTPS GETs with redirects enabled;
- a confirmed Cloudflare DNS deletion receipt plus post-change queries through `1.1.1.1`, `8.8.8.8`, and both authoritative nameservers;
- an authenticated, read-only Chrome Lawyer route audit plus negative Business/Admin role-boundary checks that intentionally recorded structure and route outcomes without reading client, matter, document, or message content;
- production Chrome crawls of all 78 sitemap URLs at the actual 1536 px viewport and at the ten required widths from 320 through 1920 px, recording only route/structure, overflow, broken-image, not-found, console, and network outcomes;
- `https://juro.uz/sitemap.xml` and rendered canonical/robots metadata;
- the current GitHub tree: 161 platform `page.tsx` route definitions and 227 API `route.ts` definitions.

Status meanings follow the execution brief: `VERIFIED`, `PARTIAL`, `BROKEN`, `MISSING`, `REDUNDANT`, `DEPRECATED`, `SECURITY RISK`, and `NOT APPLICABLE`.

An HTTP `200` after a redirect proves reachability and the public/auth boundary only. It does not prove an authenticated workflow or backend mutation.

## Host inventory

| Host / URL | Environment | Purpose, role, auth, language | Discovery source | Live HTTP / redirect evidence | Indexing and sensitivity | Issue / next action | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [juro.uz](https://juro.uz/) | production | Public website; anonymous; RU/UZ/EN | Cloudflare apex A records; Sites hosting metadata | `200`; `/`, `/ru`, `/uz`, `/en` all `200`; 78/78 sitemap URLs and 120/120 discoverable apex links `200` after v97 with self-canonical metadata; later Chrome crawls retained URL/200, one `main`, visible H1, zero horizontal overflow, zero broken loaded images, no not-found text, and clean successful console/network state across all 78 routes at the actual 1536 px desktop viewport and ten required widths from 320 through 1920 px. Twenty-six transport resets/QUIC failures in the high-rate matrix passed 26/26 isolated rechecks | `index, follow`; public | v97 preserves the custom-domain indexing contract; saved v96 is the immediate rollback. Structural responsive coverage is complete; manual visual/state coverage remains separate | `VERIFIED` |
| [www.juro.uz](https://www.juro.uz/) | production alias | Public website alias | Proxied CNAME | One redirect to `https://juro.uz/`, final `200` | Redirect-only; public | Keep as canonical alias | `VERIFIED` |
| [juro-legaltech.muzaffarbekmurodoff.chatgpt.site](https://juro-legaltech.muzaffarbekmurodoff.chatgpt.site/) | production provider surface | Sites service hostname; anonymous; RU/UZ/EN content clone | Sites deployment result | `200`; canonical points to `https://juro.uz/ru` | v97 returns `X-Robots-Tag: noindex, nofollow, noarchive` on the localized route, `robots.txt`, and `sitemap.xml` | Duplicate-host indexing boundary remains enforced while `juro.uz` remains indexable | `VERIFIED` |
| [app.juro.uz](https://app.juro.uz/) | production | Client and business platform; auth required; RU/UZ | Platform Worker `9e7ff503-894e-4be1-a0dc-5ad413fc9ba8` and `apps/platform/wrangler.jsonc` | One redirect to localized login, final `200`; authenticated Individual shell was sampled at four retained viewports, 18 read-only routes, and the v118 mobile dashboard focus path; an approved Lawyer attempt at `/ru/business/dashboard` returned to the Lawyer dashboard | HTML and header both `noindex`; private data | Individual read-only shell and negative Lawyer-to-Business isolation are verified; a positive authenticated Business journey and state-changing flows remain incomplete | `PARTIAL` |
| [lawyer.juro.uz](https://lawyer.juro.uz/) | production | Lawyer entry and workspace; public entry plus protected routes; RU/UZ | Platform Worker and platform host router | Login preserves the lawyer persona; a real Lawyer session reached 16 same-origin protected routes without login fallback, 404, horizontal overflow, visible alert, or console error; 15 role routes also passed at 390 × 844 | `noindex`; private/professional data | Authenticated read-only shell is verified; state-changing consultations, client communication, uploads, pricing, and account lifecycle remain open | `PARTIAL` |
| [admin.juro.uz](https://admin.juro.uz/) | production | Staff/admin entry; strong auth required; RU | Cloudflare Worker domain; `juro` Worker service binding to `juro-admin` | An approved Lawyer attempt redirected to `app.juro.uz/ru/admin/console?reason=admin-session`, final `200`; the generic boundary required staff plus MFA/TOTP confirmed within 15 minutes and did not enumerate roles | `noindex`; highly sensitive | Negative Lawyer-to-Admin isolation is verified; a positive authenticated staff/fresh-MFA Chrome journey remains open | `PARTIAL` |
| [status.juro.uz](https://status.juro.uz/) | production | Public-safe operational status; anonymous | Cloudflare Worker domain; `STATUS_HOSTNAME` | Root and `/api/status` return `200`; snapshot generated `2026-09-02T11:56:13.706Z` reports operational, 8/8 components, and no active/recent incidents. OpenAI and Anthropic were operational at their latest checks | `noindex`; public-safe telemetry | Provider evidence was about 13 minutes old, while OTP/email evidence was about 8.7 hours old; this point-in-time result is not an SLA | `VERIFIED` for the checked snapshot |
| [staging.app.juro.uz](https://staging.app.juro.uz/) | staging | Protected platform; test accounts; RU/UZ | Cloudflare Worker domain and Access | `/ru/lawyer/auth` returns `302` to Cloudflare Access with `no-store` | Access-protected; private test data | Main now uses this shared canonical staging origin; authenticated post-Access runtime QA and a safe staging deployment remain incomplete | `PARTIAL` |
| [admin.staging.juro.uz](https://admin.staging.juro.uz/) | staging | Protected staff console | Cloudflare Worker domain and `apps/admin/wrangler.jsonc` | Redirects to Cloudflare Access login, final login page `200` | Access-protected; highly sensitive | Staging health is stale/degraded; staff browser QA remains incomplete | `PARTIAL` |
| [status.staging.juro.uz](https://status.staging.juro.uz/) | staging | Public-safe staging status | Cloudflare Worker domain; `STATUS_HOSTNAME` | Root and `/api/status` return `200` | `noindex`; public-safe telemetry | All eight components are degraded/stale; active cron delivery fails before persistence because staging D1 has reached its maximum size | `BROKEN` |
| `api.juro.uz` | code/docs legacy | Historical API hostname | Repository documentation only | DNS resolution fails; HTTP status `000` | Not indexable; intended API sensitivity unknown | Remove stale references or provision only with an approved route contract | `DEPRECATED` |
| `app.staging.juro.uz` | rejected legacy alias | Non-canonical staging spelling retained only in negative regression tests | PR #80 / `lawyer-entry-routing.test.ts` | DNS resolution fails; current platform routing returns no lawyer origin for this host | Not indexable | Keep rejected; use only `staging.app.juro.uz` | `DEPRECATED` |
| `lawyer.staging.juro.uz` | rejected legacy alias | Former accepted-but-unroutable lawyer staging hostname | PR #80 / Worker and auth host routing | DNS resolution fails; current platform routing returns no lawyer origin for this host | Not indexable | Keep rejected; shared staging uses `staging.app.juro.uz/{locale}/lawyer/**` behind Access | `DEPRECATED` |
| `staging.juro.uz` | historical docs | Old staging alias | Historical route documentation | DNS resolution fails; HTTP status `000` | Not indexable | Keep marked historical; remove from current-state prose | `DEPRECATED` |
| `local.juro.uz` | local-only | Development identity fixture, not a network service | Dev-login code and tests | DNS resolution fails as expected | Not applicable; synthetic/local data | Keep explicitly local-only | `NOT APPLICABLE` |
| `ftp.juro.uz` | retired legacy hostname | Former DNS-only A record to `95.46.96.77`, dashboard TTL Auto/public TTL 300; record ID `4435f48bc863cc0ccaddd74a21791e5d` | Cloudflare DNS dashboard plus recursive and authoritative DNS queries | Deleted with the owner's exact action-time confirmation; the dashboard row disappeared and `1.1.1.1`, `8.8.8.8`, `tadeo.ns.cloudflare.com`, and `tess.ns.cloudflare.com` all returned NXDOMAIN | No longer exposes the unrelated/default origin | Keep absent. If a legitimate dependency is proven, recreate only the saved DNS-only A record and repeat production/email checks | `DEPRECATED` |
| `mail.juro.uz` | email/legacy | DNS-only CNAME to apex; not a product web app | Cloudflare DNS | HTTPS `403` | Email infrastructure; not in sitemap | Confirm the DNS-only CNAME is intentional and does not expose an origin | `PARTIAL` |
| `send.juro.uz` | email | MX/TXT only for sending; no web service expected | Cloudflare DNS | No A/AAAA/CNAME; HTTP resolution fails as expected | Email infrastructure; not indexable | No web action; retain only while the mail provider uses it | `NOT APPLICABLE` |

The retained pre-change dashboard inventory contained three A records, two CNAME records, four MX records, six TXT records, and seven Worker hostname records. The later bounded change deleted only the saved `ftp` A record in authenticated Chrome. Pre/post DNS snapshots matched for apex MX, `mail` CNAME, and `send` MX/TXT records; public, app, lawyer, admin, and status hosts all returned final HTTP `200`. No other DNS record was edited.

## Production DNS and Lawyer receipt

- Before deletion, Cloudflare showed exactly `A ftp.juro.uz → 95.46.96.77`, DNS-only, TTL Auto; public recursive evidence showed TTL 300. The detail row exposed record ID `4435f48bc863cc0ccaddd74a21791e5d`.
- After the confirmed deletion, the exact dashboard row count was zero and both recursive plus both authoritative resolvers returned NXDOMAIN.
- Apex MX remained the three Cloudflare Email Routing destinations; `mail.juro.uz` remained a CNAME to `juro.uz`; `send.juro.uz` retained its SES MX and SPF TXT. These are equality checks against the pre-change snapshot, not a general mail-delivery certification.
- A real Lawyer session stayed on `lawyer.juro.uz`, exposed no login/password form, and completed 16 discovered protected routes read-only. Every route retained one main landmark; after asynchronous profile/settings loading settled, each checked page had a visible H1. No private content or state-changing control was read or used.
- After a forced reload still confirmed the approved Lawyer persona, a direct Business dashboard attempt returned to the Lawyer dashboard. A direct Admin-host attempt returned the generic protected-entry boundary requiring staff plus MFA/TOTP confirmed within 15 minutes. These negative checks prove the checked Lawyer session lacked Business/Admin access; they do not prove the positive Business or Staff/Admin journeys.

## Public sitemap route matrix

The sitemap contains 26 route shapes for each of RU, UZ, and EN: **78 URLs total**. Every URL below returned `200`, retained itself as canonical, returned `meta robots=index, follow`, and appeared in the sitemap. A later real-Chrome desktop crawl at the actual 1536 px viewport navigated all 78 URLs and found zero route, one-main, visible-H1, horizontal-overflow, broken-loaded-image, not-found-text, or console warning/error failures. A subsequent 780-check Chrome matrix proved the same route identity, landmark/H1 structure, and zero horizontal overflow at the ten required widths; 26 transient transport failures passed isolated recheck. This closes the sitemap-wide public structural width gate; interaction states, zoom, assistive technology, and full visual-regression coverage remain `PARTIAL`.

| Route shape | RU URL | UZ URL | EN URL | HTTP / canonical / sitemap | Result |
| --- | --- | --- | --- | --- | --- |
| home | [RU](https://juro.uz/ru) | [UZ](https://juro.uz/uz) | [EN](https://juro.uz/en) | `200`, self-canonical, present | `VERIFIED` |
| trust | [RU](https://juro.uz/ru/trust) | [UZ](https://juro.uz/uz/trust) | [EN](https://juro.uz/en/trust) | same | `VERIFIED` |
| video | [RU](https://juro.uz/ru/video) | [UZ](https://juro.uz/uz/video) | [EN](https://juro.uz/en/video) | same | `VERIFIED` |
| lawyers | [RU](https://juro.uz/ru/lawyers) | [UZ](https://juro.uz/uz/lawyers) | [EN](https://juro.uz/en/lawyers) | same | `VERIFIED` |
| legal centre | [RU](https://juro.uz/ru/legal) | [UZ](https://juro.uz/uz/legal) | [EN](https://juro.uz/en/legal) | same | `VERIFIED` |
| legal-information | [RU](https://juro.uz/ru/legal/legal-information) | [UZ](https://juro.uz/uz/legal/legal-information) | [EN](https://juro.uz/en/legal/legal-information) | same | `VERIFIED` |
| user-agreement | [RU](https://juro.uz/ru/legal/user-agreement) | [UZ](https://juro.uz/uz/legal/user-agreement) | [EN](https://juro.uz/en/legal/user-agreement) | same | `VERIFIED` |
| public-offer | [RU](https://juro.uz/ru/legal/public-offer) | [UZ](https://juro.uz/uz/legal/public-offer) | [EN](https://juro.uz/en/legal/public-offer) | same | `VERIFIED` |
| privacy-policy | [RU](https://juro.uz/ru/legal/privacy-policy) | [UZ](https://juro.uz/uz/legal/privacy-policy) | [EN](https://juro.uz/en/legal/privacy-policy) | same | `VERIFIED` |
| personal-data-processing-policy | [RU](https://juro.uz/ru/legal/personal-data-processing-policy) | [UZ](https://juro.uz/uz/legal/personal-data-processing-policy) | [EN](https://juro.uz/en/legal/personal-data-processing-policy) | same | `VERIFIED` |
| personal-data-consent | [RU](https://juro.uz/ru/legal/personal-data-consent) | [UZ](https://juro.uz/uz/legal/personal-data-consent) | [EN](https://juro.uz/en/legal/personal-data-consent) | same | `VERIFIED` |
| cross-border-ai-consent | [RU](https://juro.uz/ru/legal/cross-border-ai-consent) | [UZ](https://juro.uz/uz/legal/cross-border-ai-consent) | [EN](https://juro.uz/en/legal/cross-border-ai-consent) | same | `VERIFIED` |
| cookie-policy | [RU](https://juro.uz/ru/legal/cookie-policy) | [UZ](https://juro.uz/uz/legal/cookie-policy) | [EN](https://juro.uz/en/legal/cookie-policy) | same | `VERIFIED` |
| payments-subscriptions-refunds | [RU](https://juro.uz/ru/legal/payments-subscriptions-refunds) | [UZ](https://juro.uz/uz/legal/payments-subscriptions-refunds) | [EN](https://juro.uz/en/legal/payments-subscriptions-refunds) | same | `VERIFIED` |
| ai-use-policy | [RU](https://juro.uz/ru/legal/ai-use-policy) | [UZ](https://juro.uz/uz/legal/ai-use-policy) | [EN](https://juro.uz/en/legal/ai-use-policy) | same | `VERIFIED` |
| marketplace-client-rules | [RU](https://juro.uz/ru/legal/marketplace-client-rules) | [UZ](https://juro.uz/uz/legal/marketplace-client-rules) | [EN](https://juro.uz/en/legal/marketplace-client-rules) | same | `VERIFIED` |
| lawyer-platform-terms | [RU](https://juro.uz/ru/legal/lawyer-platform-terms) | [UZ](https://juro.uz/uz/legal/lawyer-platform-terms) | [EN](https://juro.uz/en/legal/lawyer-platform-terms) | same | `VERIFIED` |
| document-storage-rules | [RU](https://juro.uz/ru/legal/document-storage-rules) | [UZ](https://juro.uz/uz/legal/document-storage-rules) | [EN](https://juro.uz/en/legal/document-storage-rules) | same | `VERIFIED` |
| electronic-communications-consent | [RU](https://juro.uz/ru/legal/electronic-communications-consent) | [UZ](https://juro.uz/uz/legal/electronic-communications-consent) | [EN](https://juro.uz/en/legal/electronic-communications-consent) | same | `VERIFIED` |
| marketing-consent | [RU](https://juro.uz/ru/legal/marketing-consent) | [UZ](https://juro.uz/uz/legal/marketing-consent) | [EN](https://juro.uz/en/legal/marketing-consent) | same | `VERIFIED` |
| acceptable-use-policy | [RU](https://juro.uz/ru/legal/acceptable-use-policy) | [UZ](https://juro.uz/uz/legal/acceptable-use-policy) | [EN](https://juro.uz/en/legal/acceptable-use-policy) | same | `VERIFIED` |
| complaints-disputes | [RU](https://juro.uz/ru/legal/complaints-disputes) | [UZ](https://juro.uz/uz/legal/complaints-disputes) | [EN](https://juro.uz/en/legal/complaints-disputes) | same | `VERIFIED` |
| data-subject-request-form | [RU](https://juro.uz/ru/legal/data-subject-request-form) | [UZ](https://juro.uz/uz/legal/data-subject-request-form) | [EN](https://juro.uz/en/legal/data-subject-request-form) | same | `VERIFIED` |
| knowledge: contract-review-preparation | [RU](https://juro.uz/ru/knowledge/contract-review-preparation) | [UZ](https://juro.uz/uz/knowledge/contract-review-preparation) | [EN](https://juro.uz/en/knowledge/contract-review-preparation) | same | `VERIFIED` |
| knowledge: facts-for-action-plan | [RU](https://juro.uz/ru/knowledge/facts-for-action-plan) | [UZ](https://juro.uz/uz/knowledge/facts-for-action-plan) | [EN](https://juro.uz/en/knowledge/facts-for-action-plan) | same | `VERIFIED` |
| knowledge: when-lawyer-review-is-needed | [RU](https://juro.uz/ru/knowledge/when-lawyer-review-is-needed) | [UZ](https://juro.uz/uz/knowledge/when-lawyer-review-is-needed) | [EN](https://juro.uz/en/knowledge/when-lawyer-review-is-needed) | same | `VERIFIED` |

## Platform route families

The current tree defines 161 page files and 227 API route files. Dynamic parameters expand those definitions into more concrete URLs, so the file counts are not live-route counts.

| Family | Representative URL | Anonymous production result | Auth / role expectation | Coverage status |
| --- | --- | --- | --- | --- |
| Authentication | `https://app.juro.uz/ru/auth/login` | `200` | Anonymous entry | `VERIFIED` |
| Client dashboard | `https://app.juro.uz/ru/individual/dashboard` | Redirect to login with `returnTo`, final `200` | Client | `PARTIAL`: boundary verified, authenticated flow open |
| Business dashboard | `https://app.juro.uz/ru/business/dashboard` | Protected platform route; approved Lawyer returned to the Lawyer dashboard | Business member/owner | `PARTIAL`: negative Lawyer boundary verified; positive Business journey open |
| Lawyer dashboard | `https://lawyer.juro.uz/ru/lawyer/dashboard` | Redirect to lawyer login with `returnTo`, final `200` when anonymous | Lawyer | `PARTIAL`: authenticated read-only shell verified; mutations and end-to-end client collaboration open |
| Admin console | `https://admin.juro.uz/ru/admin/console` | Approved Lawyer received the generic `reason=admin-session` protected boundary | Staff + fresh MFA | `PARTIAL`: negative Lawyer boundary verified; positive staff flow open |
| Status | `https://status.juro.uz/api/status` | `200` | Public-safe | `VERIFIED` |
| Guest AI | `https://app.juro.uz/api/guest/ai` | Method/body-specific API | Anonymous with rate/abuse controls | `PARTIAL`: not mutated in this audit |
| Document Builder | `/{locale}/{accountType}/document-builder/**` | Protected | Client/Business/Lawyer according to route | `PARTIAL`: local/CI evidence exists; production session replay open |
| Cases, plans, documents, consultations | `/{locale}/{accountType}/cases/**` and related API families | Protected | Tenant-scoped user or lawyer | `PARTIAL`: route definitions found; full role/data matrix open |
| Internal staging legal evaluation | `/api/platform/internal/staging/legal-evaluation` | Staging-only | Restricted internal | `NOT APPLICABLE` in this audit because legislation DB work was excluded |

## Confirmed gaps and priorities

1. **Resolved — provider-host indexing:** Sites v97 is live. The provider hostname returns `X-Robots-Tag: noindex, nofollow, noarchive`, while `juro.uz` retains `index, follow`; 78/78 sitemap URLs and 120/120 discoverable apex links return `200`.
2. **P1 — staging observability:** the staging status endpoint is reachable but reports all eight components degraded from stale evidence. Active Cloudflare schedules were verified, and a live five-minute cron failed in `claimSchedule` with `D1_ERROR: Exceeded maximum DB size`; capacity remediation stays in the separately excluded legislation/corpus scope.
3. **Resolved — legacy origin exposure:** only record `4435f48bc863cc0ccaddd74a21791e5d` (`A ftp.juro.uz → 95.46.96.77`) was deleted. Recursive and authoritative DNS now return NXDOMAIN; email and production routes matched the pre-change contract. The exact recreation values remain documented as rollback.
4. **Resolved code-only drift:** PR #80 removed the accepted `app.staging.juro.uz` and `lawyer.staging.juro.uz` aliases from platform auth and Worker routing. The canonical staging host remains `staging.app.juro.uz` behind Cloudflare Access; the staging Worker itself was not redeployed in this increment.
5. **Open evidence gate:** negative approved-Lawyer checks now prove that Business and Admin surfaces reject that persona. Positive authenticated Business, Pending Lawyer, and Staff/Admin Chrome runs are still required before these families can be marked `VERIFIED`. Authenticated Individual and Lawyer shell coverage is read-only; state-changing flows remain open. No session was fabricated.
6. **Monitor — production AI providers:** v120 records a bounded 24-hour history with 195/197 operational probes, one isolated timeout per provider, and 41/29 consecutive operational checks after those timeouts. Continue normal monitoring; this observed recovery window is not an availability SLA.
