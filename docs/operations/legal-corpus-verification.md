# Legal corpus verification

Accepted 2026-09-05 by owner direction to simplify migration and release work.
This policy supersedes repeated verification and fixed observation requirements
in earlier architecture and runbook text. It does not mark an unperformed check
as passed or change runtime evidence validation.

## Reuse completed evidence

Use the accepted source, materialization, embedding and release manifests when
their immutable roots, policies and resource identities match the work. Read
the relevant manifest and current configuration once; do not download or hash
the entire unchanged corpus again. Preserve recorded waivers as waivers.
Process only new or changed inputs and resume failed work from its checkpoint.
A new ticket, retry or environment does not by itself invalidate source evidence;
environment-specific bindings and newly copied objects still need their own check.

## Verify new work once

Compute byte/hash checks, counts, identities and provenance while writing or
copying new artifacts. Seal their complete inventory once. For each newly
populated Vectorize index, wait for its final mutation, then perform one exact
ID/count/metadata comparison with that inventory. Resume an interrupted listing
from its valid checkpoint; restart it only if a mutation invalidated the snapshot.
Count-only matching and sampling cannot establish complete index membership.
Later activation tickets reference this result rather than rerunning it.

Runtime retrieval continues to verify eligibility, temporal scope, source
locators and evidence byte/hash integrity. Reuse of prior operational proof
never permits quoting an unchecked or corrupt object.

## Keep tests focused

Run relevant tests and type-check for changed code. Run the full local suite once
for a completed implementation change, not at every ticket boundary. Test retry,
corruption and restore behavior with bounded fixtures, not multiple live corpus
replays. No second full build, second source scan or full remote restore is
required merely to prove determinism.

For an actual deployment or capability activation, use one recorded smoke set
covering the affected language, temporal, Citation and Source Ladder behavior.
Keep it to at most 20 requests and 10 minutes; combine coverage in the same
requests and reuse unchanged capability results. Stop on a concrete failure or
timeout, record the unverified case, and address that cause. Reaching the time
limit is not a pass and does not justify starting an unbounded verification job.

The locked benchmark remains available for retrieval-quality changes; it is not
a mandatory repeated migration gate. Small smoke sets do not establish its
aggregate quality or p95 thresholds. Record only the observations actually made.
There are no mandatory 14/30/90-day waits or synthetic-request quotas. Monitor
after activation as ordinary operation, without blocking tickets on elapsed time.

## Recovery and retirement

The owner-directed [corpus retirement decision](../adr/0030-retire-replaced-corpus-evidence.md)
overrides the following retention and recovery-copy requirements for the replaced
old corpus and its evidence. Do not preserve those resources solely to satisfy
this policy. Exact target isolation and removal of active readers/writers still
apply; private application data and the new corpus remain outside that exception.
Deletion timing and replacement availability must be resolved before execution.

For a shared native corpus, deploy the retirement-aware reader before retiring
the selected acceptance. Apply the retirement and evidence-store migrations to
the corpus database as well as the application databases; the application
`db:migrate` command targets only `DATABASE_URL`. Grant the existing scoped
corpus runtime roles read access to `storage.corpus_retirements`,
`storage.retired_corpus_objects`, and `storage.corpus_evidence_stores` and verify
those reads using each environment's actual corpus connection. Do not grant
runtime retirement or evidence-store publication privileges.

Finish both deployment preparation and activation while retained acceptance
proofs are available. Then stop admissions and drain or terminate pinned corpus
readers and writers before committing the reviewed retirement inventory. An
empty provider key does not establish that corpus access has stopped. Keep
legacy receipt-v1 evidence namespaces fixed: new evidence uses receipt-v2 with
an immutable registered namespace and generation. Never repoint old receipts
to a replacement store.

Reuse an accessible recovery point when it covers the state an operation could
replace or delete. Additive off-side work retains the active release and does not
require a new all-resource backup. When coverage is missing, capture only the
affected mutable state once before changing it. Never drop unbacked data to
avoid a slow export. Immutable evidence and prior compatible releases stay intact.

Use existing restore proof for an unchanged storage format and restore path.
If that path changes, exercise the affected behavior with a bounded isolated
fixture. A full restore is for actual recovery or a specific defect that needs
it, not a routine prerequisite for building, activation or retirement.

Before deleting legacy resources, verify the exact targets have no active
readers/writers and that an accessible recovery artifact covers anything being
removed. Retain the current and prior custom releases and immutable evidence.
Check the changed route and rollback selection once; do not recreate all indexes
or repeat production canaries. Forward migrations preserve applied migration
history and exclude private application data.

## Completion record

Keep one short record with changed resources, reused manifest/recovery pointers,
the new build or delta result, commands/tests run and unresolved failures.
Operational records contain no secrets, legal text or vectors. A machine result
and its brief explanation are enough; parallel reports, repeated independent
sign-offs and ceremonial verification packages are not required.
