# Private native application operations

The native deployment uses PostgreSQL 17 with pgvector, Node services for the platform, public website and administration interface, and a separate background-job process. PostgreSQL stores application records, legal catalogs, vector metadata, queue leases and captured email. Immutable source and generated-file bytes live in a local content-addressed directory, with namespace/key mappings and hashes in PostgreSQL.

This deployment is restricted to loopback and SSH tunnels. Domain configuration and production Cloudflare resources are outside its operational commands. Legal imports retain activation, quarantine and historical eligibility; importing a record never publishes it. Search collections under import remain unavailable until their integrity and coverage have been verified.

## Prepare the host

Install Node.js 22.13 or newer, Docker with Compose, Poppler (`poppler-utils`), Tesseract with English, Russian, Uzbek Latin and Uzbek Cyrillic language data, and ClamAV with current signatures. Install locked dependencies in `apps/platform` and `apps/website` using `npm ci`. The admin service uses the platform's installed TypeScript runtime.

Copy `.env.self-hosted.example` to `.env.self-hosted` and restrict its permissions to the service account. Generate the database password and internal admin token; configure the identity keyring and direct AI-provider credentials using the existing application formats. Encrypted identities cannot be recovered from the database alone; recovery requires the matching identity keyring.

Set `OBJECT_STORAGE_PATH` to an absolute operational directory such as `/home/ubuntu/juro-self-hosted/.data/objects`. It contains live application data and must remain outside disposable migration storage. To relocate it, stop application services and object writers, preserve all content-addressed files with a same-filesystem rename where possible, update the private configuration, and migrate any `storage.object_reclamation.root` records while holding the old and new object-store advisory locks. Restart services and verify existing citations, uploads, exports and deletion before retiring the old path.

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

The separate `juro-self-hosted-source-observer` service refreshes publisher observations from the accepted public inventory. It runs a bounded pass, waits one minute, and retries after failures; PostgreSQL leases recover interrupted passes. Publisher fetching and normalization have a shared 15-second task deadline and stop on service shutdown. This verifies existing sources without importing or activating new corpus revisions. The existing batch and crawl limits remain in effect, so background refresh does not guarantee that every inventory observation stays fresh. Requests still require a fresh observation and recover missing or stale observations on demand.

Object deletion records durable reclamation candidates and removes unreferenced bytes before reporting success. Shared content remains while another object references it. The job process retries interrupted reclamation and removes abandoned temporary writes. Open readers keep their file descriptors; backups pin referenced files until backup links exist. Completed backups retain their own copies, so apply the appropriate private-data retention policy to backup directories as well.

Email is captured in `storage.captured_emails`; only authorized operators should inspect it because messages may contain authentication codes. Payments, automatic legal ingestion, development authentication bypasses and synthetic production probes are disabled. User-triggered document work uses local malware scanning and conversion. AI calls go directly to the configured providers.

## Vector search

The configured current and historical collections have separate partial HNSW cosine indexes over the original 1,536-dimensional vectors. Creating an index does not enable a collection: its readiness gate remains closed until integrity and retrieval verification pass. Large eligible sets use approximate nearest-neighbor search with iterative filtering; filtered sets of at most 10,000 candidates use exact distances. Namespace, release and evidence predicates apply before results are returned. An underfilled approximate scan retries with exact ordering, and a 15-second statement timeout fails the lane rather than silently accepting incomplete results. Validate recall and filtered-query plans when adding a collection or materially changing its distribution. Archived collections remain unavailable until verified; a new active collection also needs an index appropriate to its dimensions and metric.

## Indexed retrieval limits and artifact reuse

Indexed Retrieval shares a ten-second deadline across session setup, query formulation, queueing, query embedding, both candidate lanes, catalog validation and evidence reads. Nested native readers inherit the remaining budget. Cancellation stops queued database work, cancels active PostgreSQL queries and aborts object and publisher reads. A failed attempt follows the existing official-source fallback or unavailability path; it must not publish a partial successful evidence packet. Token-fenced publisher lease cleanup has a separate two-second budget. Performance qualification must include live formulation; fixed-plan probes measure only the downstream portion.

Each native corpus search binding keeps at most 512 MiB of authenticated immutable sparse artifacts in memory. Cache identities include pinned artifact hashes and sizes; ordinal projections also include the release identity. This cache retains neither question text nor generated answers. Restarting a process empties it, so first-touch latency must be measured separately from steady-state retrieval.

Accepted corpus selections bind qualification proofs to a committed product revision. The platform build embeds its clean Git revision and records it in `.next/BUILD_ID`; runtime composition requires the executing revision, build identity and clean source checkout to agree. Source-run handlers capture their revision when loaded, and shared runtimes reject callers from another build. Rebuild and restart after code changes, then qualify and select the matching acceptance. Dirty source, missing output, or a stale build cannot claim an accepted revision.

Membership lookup readers accept existing three-nibble leaves and new four-nibble leaves. Derived lookup roots remain catalog-pinned and hash-checked against the original mapping inventory. Retain these lookup objects with the operational corpus and include them in backup verification. Creating a lookup or index does not qualify source authority or open a collection's readiness gate.

Temporal eligibility probes use a metadata index before selecting exact or approximate search. The probe's index order does not change the distance ranking; namespace and metadata predicates still apply within the same repeatable-read transaction.

Acceptance requires at least 95% dense recall@50 on every fixed benchmark query and full Indexed Retrieval p95 at most five seconds at five simultaneous questions. A timeout, fallback or unavailable attempt does not satisfy that benchmark. Legal-answer correctness remains a separate check. Textual authority is preserved audit metadata, not a source eligibility gate, as specified in ADR 0005. Current evidence still requires a verified publisher observation; historical evidence retains its original endpoint and authenticated source identity. Neither pathway may bypass complete-article, hash or citation checks.

## Optional exhaustive vector candidates

The native corpus adapter can use a loopback candidate process by setting `VECTOR_CANDIDATE_URL=http://127.0.0.1:8770/query`. This setting does not open collection readiness. The process scans original float32 group vectors with a conservative floating-point error guard; PostgreSQL still checks the verified source generation, expands original identities, applies original filters and computes final scores. An unavailable process fails the request. Unsupported query scopes retain the existing database path.

Install Python 3.12 and an isolated virtual environment, then install `apps/platform/server/vector-candidates-requirements.txt`. From `apps/platform`, prepare each selected verified generation with `node --env-file=../../.env.self-hosted --import tsx scripts/prepare-vector-candidates.mts /absolute/operational/vector-candidates GENERATION_UUID ...`. Interrupted preparation resumes from authenticated pages; source revisions must still match. Keep completed matrices, metadata pages and checkpoints immutable. Completed per-page `.f32` files are preparation scratch: serving verifies their hashes against the corresponding matrix bytes and does not need those duplicate files.

Preparation derives temporal coverage from original member metadata within the verified source snapshot, preserving gaps between revisions. Missing or invalid bounds remain unrestricted candidates for PostgreSQL to validate. Older exports are upgraded with checkpointed metadata pages while retaining their original vector bytes. Restart the candidate process after a completed upgrade and qualify it before activation.

Start the process with the virtual environment's Python and `apps/platform/server/vector_candidates.py --manifest /absolute/operational/vector-candidates/GENERATION_UUID/checkpoint.json`, repeating `--manifest` for other collections. Select one generation per collection. Bind only to loopback; manage it as a user service with restart-on-failure. Wait for the `phase: ready` journal record before configuring the native adapter. Requests carry the remaining shared deadline; queued and active work checks deadline and caller disconnect between bounded scan blocks.

Run `python apps/platform/tests/vector_candidates_test.py` with that virtual environment for numerical/temporal/artifact checks. Native adapter tests additionally require PostgreSQL. Re-run representative, held-out and five-question full native qualification before changing readiness. Matrices are derived from verified PostgreSQL groups and can be regenerated after restore; they are not original corpus evidence. Rebuild after a source-generation change and restart the candidate process with the newly selected manifests.

## Backup and recovery verification

Run `npm run backup --prefix apps/platform -- /absolute/new/backup-directory --verify-restore`. Add `--sudo-docker` when the service account requires sudo for Docker. The destination must not exist. The command exports a consistent PostgreSQL snapshot, records table counts, preserves every referenced immutable object, copies public assets (including locally preserved investor media) and the private environment file, and records hashes. Verification restores into a fresh temporary database and compares every table count, original float32 vector value, namespace, vector metadata, collection configuration, object mapping and file hash, then removes only that temporary database. Bounded pages limit verification memory; index restoration uses 2 GB maintenance memory with parallel maintenance disabled.

Objects are hard-linked when the destination is on the same filesystem. Such a snapshot protects against application-level deletion but is not an independent disk backup. Do not modify content-addressed files in place. A restore must recover both PostgreSQL data and the object directory, and must use the matching identity keyring. Restore each `public-assets/<application>/` directory into `apps/<application>/public/`; these files have a separate hash manifest.

The isolated deployment retains application storage only. After successful recovery verification, preserve the compact verification report and remove the temporary backup directory, including its dump, object links, public-asset copies and private configuration copy. Confirm the temporary restore database was dropped. No scheduled backup retention is configured; any future disaster-recovery backup policy is a separate operational decision.

Applied migrations under `apps/platform/postgres` are checksum-verified and immutable. Original SQLite migration files remain compatibility history. Add a new PostgreSQL migration for every subsequent schema change.
