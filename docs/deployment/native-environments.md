# Native staging and production

`main` is the production release branch. `staging` is the staging release branch. Both run the native validation workflow before deployment; pull requests run validation without deployment credentials. Promote reviewed changes from staging into main. A timestamp alone does not identify the source of a deployed Cloudflare bundle.

GitHub environments named `staging` and `production` hold separate `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS` secrets. Pin the actual SSH host key from a trusted session. Set the environment variable `DEPLOY_ENABLED=true` only after its host and application configuration have been provisioned and verified. The workflow fails visibly if configuration is missing and does not fall back to Cloudflare. Configure deployment-branch policies to admit only staging for the staging environment and main for production.

The deployment account invokes `/usr/local/bin/juro-deploy ENVIRONMENT REVISION`. Install the reviewed `scripts/deploy-self-hosted.mjs` entry point there and keep its operator configuration under `/etc/juro/`. Each environment needs separate deployment roots, database credentials/database, object storage, identity keys, service names and listener ports. Staging uses test accounts and must not run against production private data or email queues. A shared immutable public corpus requires an explicitly read-only arrangement; application records must remain isolated.

Deployment builds an immutable clean release at the validated Git SHA, verifies that it is still the environment branch tip, runs the configured backup and release-qualification commands, and activates that release. Retain the previous release. Automatic database downgrades are prohibited; migrations must be compatible with the retained application release. A failed activation restores the previous application services and reports failure.

The backup and qualification commands are operator-installed executables. Qualification must validate the selected corpus against the new compiled product revision and run the environment's user-flow probes. A successful build or root-page response does not establish account-email delivery or legal-retrieval acceptance. Production qualification must not create synthetic activity in real user accounts.

For example, `/etc/juro/staging.json` has the following structure (the referenced executables and environment file must exist before deployment):

```json
{
  "root": "/srv/juro/staging",
  "repository": "https://github.com/MoozUpus/juro.git",
  "environmentFile": "/etc/juro/staging.env",
  "backupCommand": "/usr/local/lib/juro/backup-staging",
  "qualifyCommand": "/usr/local/lib/juro/qualify-staging",
  "investorAssets": "/srv/juro/shared/public-investor-assets"
}
```

Use a separate production configuration with root `/srv/juro/production`. Environment files must set `DEPLOYMENT_ENVIRONMENT`, `DATABASE_URL`, `OBJECT_STORAGE_PATH`, `PORT`, `WEBSITE_PORT` and `ADMIN_PORT`. Database names are `juro_production` and `juro_staging`; object directories must resolve inside their environment's `data/` directory. Staging requires `EMAIL_DELIVERY_MODE=capture`; live delivery checks use a separate operator configuration. Production ports are 3000/3001/3002; staging ports are 3100/3101/3102. Native services still bind only to loopback. Before migrating from the original private instance, stop its old `juro-self-hosted-*` units so they cannot contend for production ports. Do not enable deployment until the public runtime and reverse proxy are configured and verified.

Public instances set `PRIVATE_DEVELOPMENT=false`, `NODE_ENV=production`, `DEPLOYMENT_ENVIRONMENT`, canonical HTTPS `APP_URL` and `PUBLIC_SITE_URL`, and a per-environment `AUTH_CHALLENGE_SECRET` containing 32 random bytes encoded as hexadecimal. They require a valid `IDENTITY_KEYRING`. Authentication uses a locally bundled ALTCHA widget and same-origin challenge endpoint; action, hostname, expiry and single-use redemption are checked locally. Apply the challenge-redemption migration before starting public services. Existing account rate limits remain in force.

Use `deploy/Caddyfile` for TLS termination. Supply `ACME_EMAIL`, `SITE_HOST`, `APP_HOST`, `STAGING_SITE_HOST`, `STAGING_APP_HOST`, `STAGING_ACCESS_USER` and a bcrypt `STAGING_ACCESS_HASH` through the Caddy service environment. Staging is password protected and captures test email. Caddy overwrites `X-Real-IP` with its actual peer address; application listeners accept only local proxy connections, exact configured hosts and valid client addresses. Do not place another proxy in front without revisiting this trust boundary. Only TCP 80/443 require public ingress; retain SSH access and keep database, application, admin and proxy-management ports private.

The platform rejects external requests to internal/admin UI and API paths. Operator access requires an SSH tunnel to the local HTTPS proxy, with local hostname resolution preserving the canonical application origin; Caddy then identifies the connection as loopback. Authentication, roles and MFA still apply. The separate admin console remains on a loopback listener and uses `PLATFORM_INTERNAL_ORIGIN` (defaulting to the platform's local port) for authenticated internal calls. Public site responses can be indexed; staging and application responses remain noindex. Verify both the operator tunnel and private admin handoff when provisioning the environment.

Replacing the old GitHub workflows does not itself move DNS, migrate production data, configure Resend, or establish off-server backups. Complete the public cutover procedures before enabling native production deployments.
