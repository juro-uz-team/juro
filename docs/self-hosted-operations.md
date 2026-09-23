# Private native application operations

The native deployment uses PostgreSQL 17 with pgvector, Node services for the platform, public website and administration interface, and a separate background-job process. PostgreSQL stores application records, legal catalogs, vector metadata, queue leases and captured email. Immutable source and generated-file bytes live in a local content-addressed directory, with namespace/key mappings and hashes in PostgreSQL.

This deployment is restricted to loopback and SSH tunnels. Domain configuration and production Cloudflare resources are outside its operational commands. Legal imports retain activation, quarantine and historical eligibility; importing a record never publishes it. Search collections under import remain unavailable until their integrity and coverage have been verified.

## Prepare the host

Install Node.js 22.13 or newer, Docker with Compose, Poppler (`poppler-utils`), Tesseract with English, Russian, Uzbek Latin and Uzbek Cyrillic language data, and ClamAV with current signatures. Install locked dependencies in `apps/platform` and `apps/website` using `npm ci`. The admin service uses the platform's installed TypeScript runtime.

Copy `.env.self-hosted.example` to `.env.self-hosted` and restrict its permissions to the service account. Generate the database password and internal admin token; configure the identity keyring and direct AI-provider credentials using the existing application formats. The identity keyring must be backed up: encrypted identities cannot be recovered from the database alone.

Run from the checkout root:

```sh
docker compose --env-file .env.self-hosted up -d postgres
npm run db:migrate --prefix apps/platform
npm run build --prefix apps/platform
npm run build --prefix apps/website
node scripts/install-self-hosted-services.mjs --production
```

Enable user-service lingering if these services must survive logout: `sudo loginctl enable-linger "$USER"`. The service installer creates `juro-self-hosted-platform`, `juro-self-hosted-website`, `juro-self-hosted-admin` and `juro-self-hosted-jobs` user units. Inspect them with `systemctl --user status` and `journalctl --user -u UNIT`. After changing application code, rebuild and restart the affected service.

Forward ports 3000, 3001 and 3002 over SSH and browse `http://localhost:3000`, `http://localhost:3001` and `http://localhost:3002`. PostgreSQL binds only to port 55432 on loopback. Keep the localhost hostname consistent for authentication cookies and same-origin checks.

## Background work and external effects

The job process drains transactional outbox records into PostgreSQL queues, claims jobs with expiring leases, renews leases during execution, and fences acknowledgements after lease loss. Exhausted deliveries enter dead-letter queues; document dead-letter handlers finalize failure states, and unsupported dead-letter jobs remain parked for inspection. Domain handlers retain idempotency checks.

Object deletion records durable reclamation candidates and removes unreferenced bytes before reporting success. Shared content remains while another object references it. The job process retries interrupted reclamation and removes abandoned temporary writes. Open readers keep their file descriptors; backups pin referenced files until backup links exist. Completed backups retain their own copies, so apply the appropriate private-data retention policy to backup directories as well.

Email is captured in `storage.captured_emails`; only authorized operators should inspect it because messages may contain authentication codes. Payments, automatic legal ingestion, development authentication bypasses and synthetic production probes are disabled. User-triggered document work uses local malware scanning and conversion. AI calls go directly to the configured providers.

## Backup and recovery verification

Run `npm run backup --prefix apps/platform -- /absolute/new/backup-directory --verify-restore`. Add `--sudo-docker` when the service account requires sudo for Docker. The destination must not exist. The command exports a consistent PostgreSQL snapshot, records table counts, preserves every referenced immutable object, copies public assets (including locally preserved investor media) and the private environment file, and records hashes. Verification restores into a fresh temporary database, compares every table count and object hash, then removes only that temporary database.

Objects are hard-linked when the destination is on the same filesystem. Such a snapshot protects against application-level deletion but is not an independent disk backup. Copy completed backup directories, manifests and private configuration to separately protected storage for disaster recovery. Do not modify content-addressed files in place. A restore must recover both PostgreSQL data and the object directory, and must use the matching identity keyring. Restore each `public-assets/<application>/` directory into `apps/<application>/public/`; these files have a separate hash manifest.

Applied migrations under `apps/platform/postgres` are checksum-verified and immutable. Original SQLite migration files remain compatibility history. Add a new PostgreSQL migration for every subsequent schema change.
