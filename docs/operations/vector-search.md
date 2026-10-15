# Vector search runtime

Shared vector search lives in `/srv/juro/shared/vector-search`, independently of application release directories. Production and staging connect through their configured loopback endpoints.

| Directory | Contents |
| --- | --- |
| `generations/<generation UUID>/` | Original checkpoints, vector matrices and metadata pages |
| `runtime/standard.py` | Qualified implementation serving the standard collections |
| `runtime/native.py` | Qualified implementation serving the native collection and shared history |
| `venv/` | Python runtime dependencies |

Two permanent system services run as the unprivileged `juro-vector-search` account:

- `juro-vector-search-standard.service`: loopback port 8770.
- `juro-vector-search-native.service`: loopback port 8771.

Their unit definitions are in `/etc/systemd/system/` and are enabled at boot. Both use this directory as their working directory and have read-only filesystem protection. The native service retains its 3 GiB memory limit and two-CPU quota. The two implementations remain separate to preserve their qualified behavior; combining them requires independent retrieval qualification.

Generation files are shared between services when they use the same generation. Moving a generation within the filesystem must preserve its contents and checkpoint identity. Startup validates matrix and metadata hashes; verify candidate results against the previous service before retiring its paths. Directory presence alone does not establish that a generation is disposable: reconcile service manifests and database selections before pruning.

Do not point live services into release backups, acquisition workspaces, self-hosted setup directories or corpus repair directories. Application release retention must never prune this shared runtime or its generation data.
