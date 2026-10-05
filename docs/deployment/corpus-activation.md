# Corpus acceptance during application deployment

When `CORPUS_DATABASE_URL` is configured, the native deployment operator configuration must also provide `corpusCommand`: an executable absolute path outside the environment's release directories. An explicitly configured command is used even without that database setting. Install the reviewed deployment coordinator and hook in the operator-controlled directory; updating repository files alone does not replace `/usr/local/lib/juro` executables.

The coordinator invokes the hook without a shell using these positional arguments:

```text
corpusCommand PHASE ENVIRONMENT REVISION RELEASE PREVIOUS
```

`PREVIOUS` is an empty string for an initial deployment. Standard output must contain exactly one JSON receipt; diagnostics belong on standard error. Every receipt has this shape:

```json
{
  "version": 1,
  "phase": "prepare",
  "environment": "production",
  "revision": "<40-character Git revision>",
  "release": "/srv/juro/production/releases/<release>",
  "previous": "/srv/juro/production/releases/<previous-release>",
  "originalSelectionSha256": "<64-character original acceptance hash>",
  "selectionState": "original"
}
```

Use `previous: null` for an initial deployment. The hook authenticates the operator-prepared acceptance bundle for the exact revision and original selection; the coordinator cannot grant compatibility or fabricate qualification results.

The `prepare` phase runs after backup checks, migrations and HTTP qualification, before installing services. It must report `original`. The branch tip is checked again after preparation. The `activate` phase runs after candidate services and the current symlink have switched; it must report `committed`, with the same original acceptance hash. The hook must perform the existing corpus acceptance validation and atomically check the original selection before publication.

If installation, symlink switching or activation fails, `status` must prove `original` with the preparation's exact original hash before the coordinator restores previous services and their symlink. A committed selection, ambiguity, invalid receipt or unavailable hook preserves the deployment lock and avoids restoring incompatible old services. A failed restoration also retains the lock. Database migrations are never reversed automatically.

The environment's `.deploy-lock/owner.json` identifies the environment, revision, release and previous release for all phases. Hook output and exit status are retained privately in the candidate's `.scratch/deployment/corpus-{phase}.json`. Inspect that evidence and the actual corpus selection before recovering a retained lock; do not remove it merely to rerun deployment. Application accounts retain read-only access to published corpus artifacts; proof publication and acceptance mutation require the separately configured operator authority.

## Operator installation and authority

Install `scripts/corpus-deployment-hook.mjs`, `corpus-deployment-worker.mjs` and
`corpus-deployment-contract.mjs` together under a root-owned, non-writable
operator directory, for example `/usr/local/lib/juro/`. A fixed executable
wrapper `/usr/local/sbin/juro-corpus-deployment` runs only:

```sh
#!/bin/sh
exec /usr/local/bin/node /usr/local/lib/juro/corpus-deployment-hook.mjs "$@"
```

Configure an environment's external `corpusCommand` wrapper to execute
`sudo -n /usr/local/sbin/juro-corpus-deployment "$@"`. A narrowly scoped sudoers
entry permits the production account to invoke only that root-owned wrapper:

```sudoers
juro-production ALL=(root) NOPASSWD: /usr/local/sbin/juro-corpus-deployment
```

Do not grant arbitrary Node, shell or candidate script execution as root. The
hook rejects a staging invocation by the production deployment account and vice
versa. Direct operator/root invocations still require the exact bundle and lock.

Provision `juro-corpus-operator` as a dedicated no-login account, without the
production application's group or private environment access. It needs traversal
of `/srv/juro/<environment>` and its `releases` directory, plus read access to
published corpus objects through a corpus-only group. Install the `acl` package.
During `prepare`, the hook grants this account read/traverse ACLs on the exact
validated candidate using `setfacl -R -P`; physical traversal skips symlinks,
including the required `.env.self-hosted` symlink. Private credentials must stay
outside candidate trees. The root wrapper never imports candidate code: it
launches the product executor through `runuser`, transfers only corpus operator
settings through anonymous IPC and independently checks deployment process pins.
The worker cannot access root SSH keys or production's private application DB.

## Immutable revision bundle

### Compatible application releases

An application release that does not change corpus retrieval, model execution,
source interpretation or their dependencies can retain the existing acceptance.
The operator must review the exact candidate diff and dependency changes, retain
that evidence, and issue a root-owned approval at
`/etc/juro/corpus-compatibility/<environment>/<revision>.json` (readable by the
application, with no symlinks or non-root writable ancestors):

```json
{"version":1,"environment":"staging","revision":"<candidate SHA>","acceptedRevision":"<measured SHA>","acceptanceSha256":"<selected manifest SHA256>","reviewSha256":"<review evidence SHA256>"}
```

The deployment bundle below then uses `mode: "retain"`, `acceptedRevision`, and
sets both `expectedParent` and `acceptanceSha256` to the current selection. Its
manifest is the original, unchanged acceptance. Install `corpus-compatibility.mjs`
beside the operator hook. Both phases still authenticate original proof objects,
live vector/membership fences, exact candidate build and service process pins.
Activation does not publish a new acceptance or claim new measurements. Status
reports `original` while that selection is unchanged, allowing safe rollback.

The runtime accepts the measured revision only for the exact approved candidate
and manifest hash. Missing approval preserves strict revision matching; a changed
or missing selection fails closed. This allows staging and production to share
the qualified corpus without one environment invalidating the other's selection.
Any relevant behavior or dependency change requires fresh qualification and the
normal acceptance workflow. Approval is never inferred from a successful build.

Systemd user services using `PrivateTmp` may run in a UID namespace where host
root appears as the kernel's unmapped UID. The runtime translates host root
through `/proc/self/uid_map` and rejects mapped application owners, symlinks and
group/other writable paths. The privileged deployment hook still validates actual
host root ownership. Do not disable service isolation to make these checks pass.
Installed platform and lawyer listeners must render a login form before service
installation succeeds; a healthy static file alone does not prove the runtime
can initialize inside that sandbox.

Before deployment, the operator installs a root-owned bundle at
`/etc/juro/corpus-deployment/<environment>/<revision>.json`. Its ancestors,
manifest file and credential file must also be root-owned and not writable by
other accounts. Prepare the manifest and prepublish its immutable proof objects
using the authorized writer connection, never the application read-only alias.
The hook does not upload or synthesize proofs.

```json
{
  "version": 1,
  "environment": "production",
  "revision": "<40-character Git revision>",
  "previous": "/srv/juro/production/releases/<previous-release>",
  "expectedParent": "<64-character current acceptance hash>",
  "acceptanceSha256": "<64-character canonical qualified manifest hash>",
  "manifest": {
    "file": "/etc/juro/corpus-deployment/production/<revision>-manifest.json",
    "sha256": "<64-character exact manifest file hash>",
    "sizeBytes": 12345
  },
  "environmentFile": "/etc/juro/corpus-operator.env"
}
```

The release timestamp is allocated by deployment. The bundle binds revision,
environment and previous release; the hook accepts only the corresponding
canonical `releases/<revision>-<numeric timestamp>` path and binds that actual
path in every receipt. It verifies clean HEAD, build ID, prepublished proof bytes,
descriptors and live vector/membership/release fences. Activation reuses
`verifyNativeCorpusQualification` and `activateNativeCorpus`, with the original
selection checked under the existing advisory transaction lock and candidate
process/current-symlink pins checked before commit.

The root-only operator environment file contains only `CORPUS_DATABASE_URL` and
`CORPUS_OBJECT_STORAGE_PATH`. Use a dedicated role scoped to the corpus database:
SELECT on published object metadata, native acceptances/selections, vector
collections/generations, membership generations and the two legal release/runtime
root tables; INSERT on native acceptances/selections and their required sequence;
UPDATE on `vector_collections.ready`. PostgreSQL row-lock SELECTs also require an
UPDATE privilege on at least one column of each locked table: grant the narrow
column privilege required by the existing activation queries rather than broad
schema ownership. Apply matching row-security policies for all proof namespaces.
No private application database privileges or proof object writes are required.

The wrapper kills the complete detached worker process group on timeout or
termination. Worker disconnects terminate the executor; database statement and
idle-transaction limits are finite. A failed or uncertain activation requires
`status` readback before rollback, including after timeout. These operational
limits never make an unverified corpus selection eligible.
