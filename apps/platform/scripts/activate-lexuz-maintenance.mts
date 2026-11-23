import { createHash, randomUUID } from "node:crypto";
import { open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { parsePinnedCandidateRelease } from "../lib/legal-corpus/legal-candidate-index";
import { preparedCandidateConfigurationSchema } from "../lib/legal-corpus/prepared-candidate-configuration";
import { stableSourceSnapshotJson } from "../lib/legal-corpus/source-snapshot";
import { createCorpusTransport } from "../lib/legal-answer-workflow/corpus-transport";
import { parseAnswerRuntimeConfiguration } from "../lib/legal-answer-workflow/runtime-configuration";
import { preparedEvidenceStoreFormat } from "../lib/storage/prepared-evidence-objects";
import { createPreparedStoredReader } from "../lib/legal-answer-workflow/prepared-stored-reader";
import { readOfficialProvision, type EvidenceScope } from "../lib/legal-answer-workflow/evidence";

const digest = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const worker = z.object({ path: z.string().refine(isAbsolute), sha256: hash });
const indexedWorker = worker.extend({ release: z.unknown() });
const schema = z.object({
  format: z.literal("prepared-corpus-release-candidate-v1"),
  current: indexedWorker,
  history: indexedWorker,
  sources: worker,
  qualificationRequired: z.literal(true),
  replacements: z.array(z.tuple([z.string(), z.string().nullable()])),
  publicationWorks: z.array(hash),
  partialPublicationWorks: z.array(hash).default([]),
  probe: z.object({ embedding: z.array(z.number().finite()).length(3072), termHashes: z.array(hash).min(1).max(64) }),
});

const [candidatePath, candidatePin, runtimePath, currentUrl, historyUrl, sourceUrl] = process.argv.slice(2);
const token = process.env.PREPARED_TRANSPORT_TOKEN;
const databaseUrl = process.env.JURO_PREPARED_BUILD_DATABASE_URL;
if (!candidatePath || !runtimePath || !currentUrl || !historyUrl || !sourceUrl || !token || !databaseUrl
  || !hash.safeParse(candidatePin).success || !isAbsolute(runtimePath)) throw new Error("MAINTENANCE_ACTIVATION_ARGUMENTS");
const rawCandidate = await readFile(candidatePath);
if (digest(rawCandidate) !== candidatePin) throw new Error("MAINTENANCE_CANDIDATE_INTEGRITY");
const candidate = schema.parse(JSON.parse(rawCandidate.toString("utf8")));
const [current, history] = [candidate.current, candidate.history].map(item => parsePinnedCandidateRelease(item.release));
if (current.capability !== "current" || history.capability !== "history"
  || current.environment !== history.environment) throw new Error("MAINTENANCE_RELEASE_PAIR");
const rawConfig = await readFile(runtimePath);
const previous = parseAnswerRuntimeConfiguration(JSON.parse(rawConfig.toString("utf8")), process.env);
if (previous.corpus.current.release.environment !== current.environment) throw new Error("MAINTENANCE_ENVIRONMENT");

const binding = {
  current: { release: current, url: currentUrl, workerSha256: candidate.current.sha256 },
  history: { release: history, url: historyUrl, workerSha256: candidate.history.sha256 },
  sources: { url: sourceUrl, workerSha256: candidate.sources.sha256 },
  replacements: candidate.replacements,
};
const signal = AbortSignal.timeout(30_000);
const hit = z.object({ vectorOrdinal: z.number().int().nonnegative(), membershipOrdinal: z.number().int().nonnegative(),
  vectorScore: z.number(), keywordScore: z.number() });
const verification = [];
for (const lane of [binding.current, binding.history]) {
  const transport = createCorpusTransport({ ...lane, token });
  const configuration = preparedCandidateConfigurationSchema.parse(lane.release.configuration);
  const request = { version: "prepared-search-v1", releaseId: lane.release.id, environment: lane.release.environment,
    configuration, endpoint: lane.release.capability === "current" ? { kind: "current" }
      : { kind: "timestamp", instant: `${previous.legalDatabaseAsOf}T00:00:00.000Z` },
    limit: 50, ...candidate.probe };
  const requestSha256 = digest(stableSourceSnapshotJson(request));
  const result = z.object({ requestSha256: hash, releaseId: z.string(),
    lanes: z.object({ dense: z.literal("complete"), sparse: z.literal("complete") }), hits: z.array(hit).min(1) })
    .parse(await transport.execute({ ...request, requestSha256 } as Parameters<typeof transport.execute>[0], signal));
  const known = result.hits.find(item => item.vectorOrdinal === 0 && item.vectorScore > 0.99);
  if (!known || !result.hits.some(item => item.keywordScore > 0)
    || result.requestSha256 !== requestSha256 || result.releaseId !== lane.release.id) throw new Error("MAINTENANCE_RETRIEVAL_SMOKE");
  const record = z.object({ package_sha256: hash, records: z.array(z.object({ work: z.string().min(1) })).length(1) })
    .parse(await transport.readExact({ artifacts: configuration.artifacts,
      references: [[known.vectorOrdinal, known.membershipOrdinal]] }, signal));
  if (record.package_sha256 !== configuration.artifacts.packageSha256) throw new Error("MAINTENANCE_SOURCE_SMOKE");
  verification.push({ release: lane.release.id, source: record.records[0].work, package: record.package_sha256 });
}
const { artifacts } = preparedCandidateConfigurationSchema.parse(current.configuration);
const sources = createCorpusTransport({ ...binding.sources, token });
const browseSchema = z.object({ entries: z.array(z.object({ work: hash, edition: z.iso.date().nullable(), language: z.string() })) });
const documentSchema = z.object({ entry: z.object({ work: hash }),
  units: z.array(z.object({ text: z.string(), locator: z.string() })).min(1), extractionGaps: z.boolean() });
const sampled: Array<{ work: string; scope: EvidenceScope["kind"]; language: string; sha256: string }> = [];
const partial: Array<{ work: string; language: string; sha256: string }> = [];
for (const language of ["ru", "uz", "uzc", "en"]) {
  const browse = browseSchema.parse(await sources.browseSources({ artifacts, page: 0, query: "", language, category: "" }, signal));
  const entry = browse.entries.find(item => Boolean(item.edition) !== sampled.some(result => result.scope === "historical"))
    ?? browse.entries[0];
  if (!entry) continue;
  const stored = documentSchema.parse(await sources.browseSources({ artifacts, work: entry.work, offset: 0 }, signal));
  if (stored.entry.work !== entry.work) throw new Error("MAINTENANCE_BROWSE_SMOKE");
  if (stored.extractionGaps) {
    if (!stored.units.some(unit => unit.text.trim())) throw new Error("MAINTENANCE_BROWSE_SMOKE");
    partial.push({ work: entry.work, language, sha256: digest(stableSourceSnapshotJson(stored.units)) });
    continue;
  }
  const scope: EvidenceScope = entry.edition ? { kind: "historical", at: entry.edition } : { kind: "current" };
  const release = scope.kind === "current" ? current : history;
  const readerInput = { release, worker: { ...binding.sources, token } };
  const storedReader = createPreparedStoredReader(readerInput);
  const position = stored.units.find(unit => unit.locator)?.locator;
  if (!position) throw new Error("MAINTENANCE_SOURCE_POSITION_MISSING");
  const citation = await storedReader.provisions.lookup({ work: entry.work, position,
    scope, language: entry.language, wholeDocument: true }, signal);
  if (!citation) throw new Error("MAINTENANCE_CITATION_SMOKE");
  const reopened = await readOfficialProvision(citation.locator, createPreparedStoredReader(readerInput), scope, signal);
  sampled.push({ work: entry.work, scope: scope.kind, language, sha256: reopened.sha256 });
}
if (!sampled.length && !partial.length) throw new Error("MAINTENANCE_CITATION_SMOKE");
const qualification = stableSourceSnapshotJson({ candidatePin, verification, sampled, partial }) + "\n";
const qualificationSha256 = digest(qualification);
const qualificationPath = join(dirname(candidatePath), `qualification-${qualificationSha256}.json`);
await writeFile(qualificationPath, qualification, { flag: "wx" }).catch(async error => {
  if (error.code !== "EEXIST" || digest(await readFile(qualificationPath)) !== qualificationSha256) throw error;
});

// The registered generation owns each saved citation's reopen route.
const manifest = Buffer.from(stableSourceSnapshotJson({
  format: preparedEvidenceStoreFormat, currentRelease: previous.corpus.current.release,
  historyRelease: previous.corpus.history.release,
  corpusAdditions: [{ currentRelease: current, historyRelease: history, sourceRoute: {
    packageSha256: artifacts.packageSha256, workIndexSha256: artifacts.workIndexSha256,
    url: sourceUrl, workerSha256: candidate.sources.sha256, tokenEnvironment: "PREPARED_TRANSPORT_TOKEN",
  } }],
  additionQualificationSha256: qualificationSha256,
}));
const generationSha256 = digest(manifest);
const next = { ...JSON.parse(rawConfig.toString("utf8")), generationSha256, corpusAdditions: [binding] };
parseAnswerRuntimeConfiguration(next, process.env);
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
const pending = `${runtimePath}.${randomUUID()}.next`;
const previousPath = `${runtimePath}.${digest(rawConfig)}.previous`;
const payload = stableSourceSnapshotJson(next) + "\n";
try {
  await client.query("SELECT pg_advisory_lock(hashtextextended('native-corpus-selection',0))");
  if (digest(await readFile(runtimePath)) !== digest(rawConfig)) throw new Error("MAINTENANCE_SELECTION_CHANGED");
  await client.query("BEGIN");
  await client.query(`INSERT INTO storage.corpus_evidence_stores (generation_sha256,namespace,manifest)
    VALUES($1,$2,$3) ON CONFLICT (generation_sha256) DO NOTHING`,
  [generationSha256, `legal-prepared-${generationSha256}`, manifest]);
  await client.query(`INSERT INTO storage.corpus_publication_sources (work,package_sha256,generation_sha256)
    SELECT work,$2,$3 FROM unnest($1::text[]) AS work ON CONFLICT(work) DO UPDATE
      SET package_sha256=excluded.package_sha256,generation_sha256=excluded.generation_sha256
      WHERE excluded.work <> ALL($4::text[])
        AND corpus_publication_sources.package_sha256 <> excluded.package_sha256`,
  [candidate.publicationWorks, artifacts.packageSha256, generationSha256, candidate.partialPublicationWorks]);
  await client.query("COMMIT");
  const existing = await stat(runtimePath);
  await writeFile(previousPath, rawConfig, { flag: "wx", mode: 0o600 }).catch(async error => {
    if (error.code !== "EEXIST" || digest(await readFile(previousPath)) !== digest(rawConfig)) throw error;
  });
  const file = await open(pending, "wx", existing.mode & 0o777);
  try {
    if (process.platform !== "win32") {
      await file.chown(existing.uid, existing.gid);
      await file.chmod(existing.mode & 0o777);
    }
    await file.writeFile(payload);
    await file.sync();
  } finally { await file.close(); }
  await rename(pending, runtimePath);
  if (digest(await readFile(runtimePath)) !== digest(payload)) throw new Error("MAINTENANCE_SELECTION_READBACK");
  console.log(generationSha256);
} finally {
  await rm(pending, { force: true });
  client.release(true);
  await pool.end();
}
