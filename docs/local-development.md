# Local development on the host

Start Docker Desktop with Linux containers and install Node.js 22.13 or newer on the host. From the repository root:

```powershell
npm run local
```

Only PostgreSQL 17 with pgvector runs in Docker. The platform, website, admin service and background worker run directly on your PC. The launcher installs dependencies when missing, applies pending migrations, and starts host processes in the background. Existing host dependencies are reused; after dependency changes, run `npm --prefix apps/platform ci` and `npm --prefix apps/website ci` before restarting.

Next.js reads source directly from your checkout and uses native filesystem notifications. Saving a page, component or stylesheet updates the open browser through Fast Refresh. There is no Docker bind-mount polling overhead. Logs and process-control state live in the ignored `.data/local/` directory.

The first page visit compiles that route; later visits reuse the development cache. Follow `npm run local:logs` to see compilation progress. Running `npm run local` again reuses existing host processes.

| Service | Address |
| --- | --- |
| Platform | http://localhost:3000 |
| Registration | http://localhost:3000/en/auth/register |
| Website | http://localhost:3001 |
| Admin | http://localhost:3002 |
| PostgreSQL | 127.0.0.1:55432 |

Use `localhost` consistently in the browser. Authentication, workspace permissions and staff authorization remain enabled; the admin service requires a staff account.

## Email and account creation

For quick local testing, choose **Local developer sign-in: personal** or **Local developer sign-in: lawyer** on the login page. Direct links also switch the current browser session:

- Personal: <http://localhost:3000/api/auth/dev-login?accountType=individual&returnTo=/en/individual/dashboard>
- Lawyer: <http://localhost:3000/api/auth/dev-login?accountType=lawyer&returnTo=/en/lawyer/dashboard>

These create normal persisted sessions without a password or verification email. The personal account uses `developer@local.juro.uz`; the separate lawyer account uses `developer+lawyer@local.juro.uz`. When `LOCAL_AUTH_EMAIL` is configured, the lawyer address adds `+lawyer` before its domain. Both accounts have completed onboarding, and the lawyer profile is approved when first created. Repeated logins reuse the same accounts, workspaces, and saved data without resetting lawyer profile edits or moderation state. A lawyer dashboard `returnTo` also selects the lawyer account when `accountType` is omitted.

The launcher enables this shortcut by default. Set `LOCAL_AUTH_BYPASS=false` in `.env.self-hosted`, then stop and restart the local stack to disable it. The runtime only honors the option in private, non-production mode, and the route only accepts local hostnames. It does not grant staff/admin access.

Register through the platform. Development emails are captured in the local database, including verification and password-reset codes. Read the latest five messages with:

```powershell
npm run local:mail
```

The launcher selects capture delivery even if `.env.self-hosted` contains existing Resend settings. No email delivery account is needed for local registration.

## Configuration and persistence

The launcher fills missing settings in the ignored `.env.self-hosted`: `DATABASE_URL`, the database password, identity-encryption keyring, admin token, challenge secret and localhost origins. Existing provider credentials and identity keys are preserved. Keep this file with your local data: replacing the identity keyring prevents decryption of existing accounts.

The launcher connects to the local database at `127.0.0.1:55432`. PostgreSQL records stay in the existing Docker volume. Uploaded/generated files live in `.data/objects`; dependencies and build caches stay on the host. When switching from the previous Docker workspace, the launcher stops that container and copies its immutable files without overwriting existing host files. The old Docker volumes remain available.

Document processing requires Poppler (`pdfinfo`, `pdftotext`, `pdftoppm`), Tesseract with English, Russian, Uzbek Latin and Uzbek Cyrillic, and ClamAV (`clamscan`) on the host PATH. Install these separately and keep ClamAV signatures updated with `freshclam`. They are not installed by `npm run local`. Upload scanning fails closed when ClamAV or its signatures are unavailable; ordinary UI development does not require these tools.

AI requests use the existing `OPENAI_API_KEY` and can incur normal provider charges. A fresh database has no imported official legal corpus, user history, or marketplace profiles. Corpus retrieval remains subject to the existing import and acceptance checks. Live payments and automatic corpus ingestion remain disabled by the private runtime.

The host development launcher reports an unqualified source revision. Git discovery stops at the application directory to avoid expensive synchronous scans across the checkout. Use the native deployment and qualification workflow when testing an accepted indexed corpus.

## Manage the stack

```powershell
npm run local:status
npm run local:logs
npm run local:stop
```

Stopping terminates the managed host processes and stops PostgreSQL, preserving data. Start again with `npm run local`. After editing custom server/worker code or environment settings, use `npm run local:stop` followed by `npm run local`.

Ports 3000, 3001, 3002 and 55432 must be free. All services bind to host loopback; application origin and session checks remain intact.

For native Linux installation, corpus provisioning and backup procedures, see [self-hosted operations](self-hosted-operations.md).
