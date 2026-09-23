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

test("corpus retrieval uses local services and preserves disabled legacy writes", () => {
  const runtime = readFileSync(new URL("../lib/runtime/self-hosted.ts", import.meta.url), "utf8");
  const corpus = readFileSync(new URL("../worker/legal-corpus-worker.ts", import.meta.url), "utf8");
  assert.match(runtime, /new PostgresVectorIndex/u);
  assert.match(runtime, /new LocalObjectStore/u);
  assert.match(runtime, /LEGAL_RETRIEVAL_SERVICE/u);
  assert.equal(JSON.parse(readFileSync(new URL("../config/corpus-releases.json", import.meta.url), "utf8")).catalog.LEGAL_CORPUS_LEGACY_WRITES_ENABLED, "false");
  assert.doesNotMatch(corpus, /extends WorkerEntrypoint|cloudflare:workers/u);
  assert.match(corpus, /async openLegalResearch/u);
});
