# JURO platform

This package contains localized account routes, password and OTP authentication, MFA, workspaces, cases, legal retrieval, document creation, analysis, comparison and collaboration. Native Node.js servers run the application and background jobs. PostgreSQL stores transactional data, queue leases and pgvector embeddings; private files use local content-addressed storage.

## Run privately

Follow the repository [self-hosted operations guide](../../docs/self-hosted-operations.md) to prepare PostgreSQL, document tools and the private environment file. Node.js 22.13 or newer is required. Install dependencies with `npm ci`, apply migrations with `npm run db:migrate`, and start the platform with `npm run dev`. Use `npm run jobs` for background processing.

Build with `npm run build` before running `npm start` or rendered application tests. `npm run type-check` checks TypeScript. `npm test` runs tests with a sanitized environment that retains the local database URL and excludes provider credentials. Tests requiring PostgreSQL and document tools must run on a prepared host.

## Code map

- `app/`: application pages and route handlers.
- `server/`: native HTTP and background-job entry points.
- `lib/runtime/`: local storage, document tools, email capture and direct provider configuration.
- `lib/storage/`: PostgreSQL queries, immutable files, vectors and durable queues.
- `worker/`: existing domain handlers called in-process by the native services.
- `postgres/`: checksum-verified PostgreSQL migrations. Applied migrations are immutable.
- `db/schema.ts`: PostgreSQL ORM model. Original SQLite migrations remain compatibility history.

Authentication bypasses are disabled. Every protected operation still checks the session, workspace, ownership and applicable permissions. Email is captured locally. The server binds to loopback and requires `PRIVATE_DEVELOPMENT=true`; production cutover is a separate operation.
