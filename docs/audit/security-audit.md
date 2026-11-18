# JURO Security Audit

Status: **release-scoped evidence, not a repository-wide penetration test**

Evidence cutoff: **2026-09-02 14:50 UZT**

## Bounded DNS retirement and authenticated Lawyer evidence

- With the owner's exact action-time confirmation, authenticated Chrome deleted only Cloudflare DNS record `4435f48bc863cc0ccaddd74a21791e5d`: `A ftp.juro.uz → 95.46.96.77`, DNS-only, dashboard TTL Auto/public TTL 300.
- The exact dashboard row disappeared. `1.1.1.1`, `8.8.8.8`, `tadeo.ns.cloudflare.com`, and `tess.ns.cloudflare.com` then returned NXDOMAIN for `ftp.juro.uz A`.
- Pre/post snapshots matched for apex Cloudflare Email Routing MX, `mail.juro.uz` CNAME, and `send.juro.uz` MX/TXT. Public, app, lawyer, admin, and status hosts returned final HTTP `200`. No other DNS record was edited.
- A real Lawyer session remained on the dedicated host and completed 16 protected routes read-only without login fallback, 404, horizontal overflow, visible alert, or console error. The audit collected route/structure outcomes only and did not read private clients, matters, messages, or documents.
- A forced reload still identified that session as the approved Lawyer persona. Opening the Business dashboard from it returned to `lawyer.juro.uz/ru/dashboard`; opening the Admin host returned `app.juro.uz/ru/admin/console?reason=admin-session` and a generic protected-entry screen requiring a staff role plus MFA/TOTP confirmed within 15 minutes. The screen did not enumerate staff roles or reveal which check failed.
- The deletion has no one-click undo. Its bounded rollback is recreation of the saved DNS-only A record with TTL Auto/300, followed by the same DNS, production-route, and mail checks.

## Retained v120 pre-deletion production-operations evidence

- Before deletion, a bounded network check proved that `ftp.juro.uz` did not answer on FTP port 21, exposed the default AlmaLinux server page over plain HTTP, and presented a certificate that failed hostname validation over HTTPS. The DNS-only A record revealed `95.46.96.77`; no JURO code dependency was found.
- That checkpoint proposed deleting only the saved DNS-only A record after Cloudflare sign-in, followed by NXDOMAIN, public-route, protected-boundary, and email-MX verification. The later receipt above records completion; rollback remains recreation of `A ftp.juro.uz → 95.46.96.77`, TTL Auto/public 300, DNS-only.
- No DNS write was attempted through an under-permissioned token. The OAuth API correctly rejected DNS-record access, and Chrome was stopped at Cloudflare sign-in without entering credentials.
- Read-only production dependency history contained no request, response, document, user identifier, or credential. It showed 195/197 operational provider probes in the 24-hour window and no provider billing/balance error; this is operational evidence, not a penetration test or availability SLA.

## v116 diff result

Codex Security scan `1084b6c7-7516-4b17-b1fb-bda7b183ae2e` reviewed the immutable range `97847a68e7955adc0b0b82db8c83c94d16bb3ebb..c5e703fc0b0246d5218da3d6fb89bf420c2ed22a` with complete changed-source coverage and 0 reportable findings. The change is limited to auth/public CSS and regression tests.

The scan followed supporting code far enough to verify that authentication authority remains server-side: same-origin write checks, Turnstile action/hostname binding, bounded OTP reservation, D1-backed sessions, secure cookies, and Worker response headers were not changed.

## Live boundary evidence

| Boundary | Observation | Result |
| --- | --- | --- |
| Individual → Business | redirected to permitted Individual dashboard | ENFORCED |
| Individual → Lawyer | lawyer host required explicit reauthentication | ENFORCED |
| Individual → Admin | admin route required a protected admin session | ENFORCED |
| Approved Lawyer → Business | Business dashboard returned to the authenticated Lawyer dashboard | ENFORCED |
| Approved Lawyer → Admin | Admin host returned the generic protected-entry boundary requiring staff plus fresh MFA/TOTP | ENFORCED |
| Public → auth submit | Turnstile required before submit became available | ENFORCED |
| Public indexing | apex indexable; provider clone noindex | ENFORCED |
| Protected indexing | platform Worker retains noindex headers | UNCHANGED BY v116 |

## Limitations and open security work

- This is not a fresh repository-wide scan, penetration test, or authenticated authorization matrix.
- The new negative-route evidence proves that the checked approved Lawyer session cannot enter Business or Admin surfaces. It does not prove positive Business, Pending Lawyer, or Staff/Admin journeys. Those roles plus state-changing Lawyer/client collaboration, cross-tenant, IDOR, upload, share-link, billing, and account-deletion tests remain open until controlled role accounts and test data are available.
- The legacy `ftp.juro.uz` exposure is resolved. Continue to monitor for a legitimate dependency; recreate only the documented record if one is proven.
- TAC display entitlement could not be verified because the Codex Security access connector was not connected; the sealed local report and SARIF were still generated.
- Legislation databases, legal corpus, vectors, embeddings, and staging-capacity work are explicitly excluded.

No secret, credential value, private document, or production record is included in this report.
