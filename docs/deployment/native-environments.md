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

Use a separate production configuration with root `/srv/juro/production`. Environment files must set `DEPLOYMENT_ENVIRONMENT`, `DATABASE_URL`, `OBJECT_STORAGE_PATH`, `PORT`, `WEBSITE_PORT` and `ADMIN_PORT`. Database names are `juro_production` and `juro_staging`; object directories must resolve inside their environment's `data/` directory. Staging requires `EMAIL_DELIVERY_MODE=capture`; live delivery checks use a separate operator configuration. Production ports are 3000/3001/3002; staging ports are 3100/3101/3102. Native services still bind only to loopback. Before migrating from the original private instance, stop its old `juro-self-hosted-*` units so they cannot contend for production ports. Do not enable deployment until the public runtime and reverse proxy are configured; the private application entry points do not accept public hostnames.

Replacing the old GitHub workflows does not itself move DNS, migrate production data, configure Resend, or establish off-server backups. Complete the public cutover procedures before enabling native production deployments.
