# JURO Control Center operations

The native console is `apps/admin`, using the existing platform PostgreSQL database and internal backend API. It does not create a separate user database. Production public origin is `https://admin.juro.uz`; the Node listener remains loopback on port 3002. The website, platform and lawyer listeners retain their existing ports and ordinary authentication.

## Provisioning

Apply additive migrations `apps/platform/postgres/0042-control-center.sql` and `0043-control-center-coverage.sql` through the existing `npm --prefix apps/platform run db:migrate` release process before starting the new code. Build with `npm run build`; run the existing native service installer/deployment entry point. Preserve database recovery procedures described in the deployment documentation.

Configure the same environment file for the existing native services:

- `ADMIN_CONSOLE_ORIGIN=https://admin.juro.uz`; remove the obsolete production `:3443` origin.
- Independent randomly generated `ADMIN_OTP_SECRET` of at least 32 characters. If omitted, native services atomically provision a private persistent secret under the existing object-storage data volume (`.control-center/otp-secret`). Do not reuse ordinary user authentication secrets.
- Existing `ADMIN_INTERNAL_TOKEN` and `ADMIN_CONSOLE_TOKEN`, generated separately. Keep internal backend listeners private.
- `ADMIN_ALLOWED_EMAIL=muzaffarbekmurodoff@gmail.com` (single mailbox, no invitation or signup).
- `ADMIN_OTP_TTL_SECONDS=300`, `ADMIN_OTP_RESEND_SECONDS=60`, `ADMIN_OTP_MAX_ATTEMPTS=5`, `ADMIN_SESSION_TTL_SECONDS=3600`.
- Existing production `EMAIL_DELIVERY_MODE=resend`, `RESEND_API_KEY` and verified `EMAIL_FROM`. Staging/private environments use the existing capture transport; production rejects capture.
- Existing `DATABASE_URL`, protected identity keyring/mode, object storage and AI provider configuration. The console never displays provider keys.

The runtime `ADMIN_ALLOWED_EMAIL` overrides the source default. For this mailbox correction, an authorized operator must check only that setting in the external production `environmentFile` referenced by `/etc/juro/production.json`, replace the old address if present, and reload the affected native services through the normal deployment procedure. A source release does not rewrite that operator-managed file. Confirm the effective setting in the running platform process; an HTTP health check alone does not verify the allowed mailbox. Existing sessions for a different mailbox fail the per-request mailbox check.

Point `admin.juro.uz` DNS to the existing host and allow existing public HTTPS ingress. The production installer inserts only the admin route into the existing local Caddy configuration when its loopback admin API is available. Otherwise reload `deploy/Caddyfile` with its normal ACME settings; the installer reports that external configuration is required. Caddy terminates TLS, overwrites trusted client IP and forwards to loopback. Do not expose the platform internal API, PostgreSQL or captured email. Validate the actual certificate/domain and one administrator email delivery after deployment; repository builds do not establish that production is running.

## Access and changes

Email OTP is hashed with the independent server secret. Requests have durable IP/email limits; attempts are row-locked and capped. Resending invalidates the previous eligible challenge. The opaque session token is hashed server-side; the browser gets host-only HttpOnly Secure SameSite=Strict cookies. Every protected backend request revalidates the session and configured mailbox. Mutations additionally require matching origin and a double-submit CSRF cookie rotated at login. Logout revokes the database session. An ordinary JURO login or edited profile cannot authorize the console.

User blocking revokes existing ordinary sessions and is enforced by their resolver. Contact edits clear verification. Deletion uses the existing dependency-aware deletion service, retaining its financial records and minimal audit; ownership/dependency restrictions may require resolution before purge. The administrator mailbox account is protected from block/deletion. Administrative audit is append-only through a PostgreSQL trigger.

Moderation uses actual lawyer profile types/advocate declarations/firm fields, existing publication transitions, notification/history services, and durable email delivery records. A failed email does not roll back the decision. Retry failed delivery from System. Keep expired/revoked administrative session rows while referenced by moderation history.

Applied AI versions are read by the real runtime and document analysis; model choices use the existing allowlist/pinned chat models. Global monthly ceilings and function availability are enforced server-side. Template versions are consumed by the real constructor, with already created documents retaining their version. Website FAQ/news/pages consume only published safe plain-text content; drafts do not change published content. Existing static FAQ is the fallback until FAQ content is published.

## Data coverage

This release provides shared-data user management, professional moderation, support replies/notes, versioned constructor templates, AI settings/budgets/circuits, content publishing, search, delivery status and audit. Read-only financial views use existing payment/subscription records and exclude sandbox/demo. Production payment integration remains subject to the project's existing approval/configuration; no provider was enabled or commercial terms changed.

Audience/registration/operational feature aggregates use stored records and Asia/Tashkent periods. Website, app and lawyer page events begin after analytics consent and respect DNT. Registration-form submission records the start; completed registration requires a server-verified contact and the real user session. Server feature events derive from persisted AI/document/consultation transitions and have deterministic IDs against duplicate accounting. No content, auth codes, free-form queries or device fingerprints are collected. Browser IDs are application-scoped; authenticated user IDs link server actions, while cross-subdomain anonymous unique visitors are not summed. Administrators and staging activity are excluded. Consent can be withdrawn in the cookie preferences.

The ordered product funnel uses a configurable 1–90 day window from the initial visit; follow-up steps may occur after the selected acquisition period. Repeat use requires a successful action on a later day. Segments cover application/source/device/account type/plan when available. Cohort retention counts only mature registrations with consented successful feature events. Professional funnels track new profile revisions through submission, review, approval/publication and the first real client request. Historical events are not reconstructed.

Professional verification adds type-specific organization, registration, advocate-license and representative details to existing lawyer profiles, including business-account firms. Supporting PDF/JPEG/PNG documents pass the existing malware scanner and remain in private object storage. Only the owner sees upload metadata; only the authorized Control Center retrieves files, as authenticated downloads. Material changes revoke publication and require another review. Account deletion includes these private objects in the existing purge.

Constructor categories are persisted and consumed by the public constructor. Template versions support question conditions and administrator-written paragraphs; allowed plan codes are enforced in the real save/generate backend. Empty plan restrictions preserve existing access. Existing legal content is not rewritten during deployment.

Financial formulas cover MRR/ARR, ARPU/ARPPU, payment conversion and subscription/revenue churn. Unique paying users derive from real order customer IDs. Gross receipts, recorded refunds, recognized revenue and ledger provider fees remain separate; currencies are not added together. Subscription history starts at migration with an explicit current-state baseline, so earlier churn is unavailable. Refund liabilities are not treated as completed payouts; absent partial-refund/provider reconciliation data stays unavailable. AI costs remain estimates, not net profit.

GitHub main deploys production after required validation. The workflow verifies public admin health and anonymous API denial after activation; successful service activation alone is not proof of public domain readiness. Live email delivery still requires the existing verified Resend sender/credentials. No payment provider is enabled by this release.

Basic validation was performed with an isolated synthetic PostgreSQL database and an in-memory mail transport: OTP/session/CSRF denial, persisted user edit/note/block/unblock, moderation, settings, AI runtime application, template and website publication. No production users were deleted, payments charged or live emails sent.
