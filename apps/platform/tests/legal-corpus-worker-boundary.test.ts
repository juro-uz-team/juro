import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { rejectDisabledLegacyCorpusWrite } from "../worker/legal-corpus-worker";

test("retired legacy mutations remain fenced without shipping the scheduled pipeline", () => {
  for (const path of [
    "/internal/legal-corpus/search-index-build/v1/build",
    "/internal/legal-corpus/ai-search-projection/v1/build",
    "/internal/legal-corpus/ai-search/configure-candidate",
  ]) {
    const response = rejectDisabledLegacyCorpusWrite(
      new Request(`http://legal-corpus.internal${path}`, { method: "POST" }),
      { LEGAL_CORPUS_LEGACY_WRITES_ENABLED: "false" },
    );
    assert.equal(response?.status, 503);
  }
  const corpusWorker = readFileSync(new URL("../worker/legal-corpus-worker.ts", import.meta.url), "utf8");
  assert.doesNotMatch(corpusWorker,
    /handleLegalCorpusScheduled|runNextLegalCorpusIngestionJob|runNextLegalCorpusQdrantBackfillBatch|async scheduled/u);
  assert.doesNotMatch(corpusWorker,
    /LEGAL_TARGET_READINESS_PATH|TARGET_CANDIDATE_EVALUATION_PATH|handleTargetCandidateEvaluationRequest/u);
});

test("retired dense integrations are absent while custom retrieval stays bound", () => {
  const platformWorker = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  const platformConfigText = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const platformConfig = JSON.parse(platformConfigText) as {
    vars: Record<string, string>;
    services: Array<{ binding: string; service: string; remote?: boolean }>;
    env: { staging: {
    migrations: Array<{ deleted_classes?: string[] }>;
    durable_objects: { bindings: Array<{ class_name: string }> };
    containers: Array<{ name: string; class_name: string }>;
  } } };
  const corpusConfig = readFileSync(new URL("../wrangler.legal-corpus.jsonc", import.meta.url), "utf8");
  const corpusWorker = readFileSync(new URL("../worker/legal-corpus-worker.ts", import.meta.url), "utf8");
  assert.doesNotMatch(platformWorker, /qdrant\.internal|LegalCorpusQdrantContainer/u);
  assert.doesNotMatch(platformConfigText, /LEGAL_CORPUS_READ_SERVICE/u);
  assert.match(platformConfigText, /"binding": "LEGAL_RETRIEVAL_SERVICE"/u);
  assert.equal(platformConfig.vars.LEGAL_RETRIEVAL_ENVIRONMENT, "production");
  assert.deepEqual(
    platformConfig.services.find(({ binding }) => binding === "LEGAL_RETRIEVAL_SERVICE"),
    {
      binding: "LEGAL_RETRIEVAL_SERVICE",
      service: "juro-legal-corpus",
      remote: true,
    },
  );
  assert.doesNotMatch(corpusConfig, /QDRANT|LEGAL_AI_SEARCH_NAMESPACE|LEGAL_AI_SEARCH_SOURCE_BUCKET/u);
  assert.deepEqual(platformConfig.env.staging.migrations.at(-1)?.deleted_classes,
    ["LegalCorpusQdrantContainer"]);
  assert.equal(platformConfig.env.staging.durable_objects.bindings.some(
    ({ class_name }) => class_name === "LegalCorpusQdrantContainer"), false);
  assert.equal(platformConfig.env.staging.containers.some(({ name, class_name }) =>
    name === "juro-staging-legal-corpus-qdrant"
      || class_name === "LegalCorpusQdrantContainer"), false);
  assert.match(corpusConfig, /"binding": "LEGAL_CORPUS_REASONING_SERVICE"/u);
  assert.match(corpusConfig, /"binding": "LEGAL_CUSTOM_SEARCH_SERVICE"/u);
  assert.match(corpusConfig, /"binding": "LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE"/u);
  assert.match(corpusWorker, /extends WorkerEntrypoint/u);
  assert.match(corpusWorker, /openLegalResearch\(input:CorpusSessionInput\)/u);
  assert.doesNotMatch(corpusWorker, /TARGET_LEGAL_ANSWER_PATH|createRuntimeTargetLegalAnswerRetriever/u);
  assert.match(corpusWorker, /url\.pathname === TARGET_ACTIVATION_SET_EVALUATION_PATH/u);
  assert.match(corpusWorker, /env\.LEGAL_DB\.prepare\("SELECT 1 AS ready"\)/u);
});

test("dedicated Worker retains only body-free control and R2-native retrieval bindings", () => {
  const config = JSON.parse(readFileSync(
    new URL("../wrangler.legal-corpus.jsonc", import.meta.url), "utf8")) as {
    main: string;
    triggers: { crons: string[] };
    r2_buckets: Array<{ binding: string }>;
    env: Record<"staging" | "production", {
      vars: Record<string, string>;
      triggers: { crons: string[] };
      d1_databases: Array<{ binding: string; migrations_dir: string }>;
      r2_buckets: Array<{ binding: string; bucket_name: string }>;
      services: Array<{ binding: string; service: string }>;
    }>;
  };
  assert.equal(config.main, "./worker/legal-corpus-worker.ts");
  for (const environment of [config, config.env.staging, config.env.production]) {
    assert.deepEqual(environment.triggers.crons, []);
    assert.equal(environment.r2_buckets.some(({ binding }) => binding === "BACKUP_BUCKET"), false);
  }
  for (const environment of [config.env.staging, config.env.production]) {
    assert.equal(environment.vars.LEGAL_CORPUS_LEGACY_WRITES_ENABLED, "false");
    assert.equal(environment.vars.LEGAL_CORPUS_ENABLED, undefined);
  }
  assert.equal(config.env.production.d1_databases[0]?.binding, "LEGAL_DB");
  assert.equal(config.env.production.d1_databases[0]?.migrations_dir, "./legal-drizzle");
  assert.equal(config.env.production.r2_buckets.some(({ binding }) =>
    binding === "LEGAL_CUSTOM_ARTIFACT_BUCKET"), true);
  assert.equal(config.env.production.services.some(({ binding }) =>
    binding === "LEGAL_CUSTOM_SEARCH_SERVICE"), true);
  assert.equal(config.env.production.services.some(({ binding }) =>
    binding === "LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE"), true);
});
