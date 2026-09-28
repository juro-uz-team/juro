import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("the first legal-D1 migration is control-only and body-free", () => {
  const migration = readFileSync(
    new URL("../legal-drizzle/0001_target_control.sql", import.meta.url),
    "utf8",
  );
  assert.match(migration, /CREATE TABLE `legal_target_control`/u);
  assert.match(migration, /environment/u);
  assert.match(migration, /migration_state/u);
  assert.doesNotMatch(migration, /content_text|exact_quote|body_text|sparse_postings/iu);
});

test("native retrieval binds PostgreSQL catalogs and local evidence objects", () => {
  const runtime = readFileSync(new URL("../lib/runtime/self-hosted.ts", import.meta.url), "utf8");
  assert.match(runtime, /database\("legal"\)/u);
  assert.match(runtime, /LEGAL_EVIDENCE_BUCKET: corpusBucket/u);
  assert.match(runtime, /LEGAL_HISTORY_EVIDENCE_BUCKET: corpusBucket/u);
  assert.match(runtime, /new LocalObjectStore\(corpus\.pool, corpusRoot, name, true\)/u);
  assert.match(runtime, /LEGAL_RETRIEVAL_SERVICE: retrieval/u);
  assert.match(runtime, /createNativeCorpusService/u);
  assert.match(runtime, /fallback:legal/u);
  assert.doesNotMatch(runtime, /LEGAL_AI_SEARCH_NAMESPACE|LEGAL_AI_SEARCH_SOURCE_BUCKET/u);
});
