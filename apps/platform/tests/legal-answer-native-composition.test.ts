import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("native composition binds the retained corpus database and private objects to the pinned read-only runtime", () => {
  const entry = readFileSync(new URL("../lib/legal-answer-workflow/platform-entry.ts", import.meta.url), "utf8");
  const runtime = readFileSync(new URL("../lib/legal-answer-workflow/configured-runtime.ts", import.meta.url), "utf8");
  assert.match(entry, /import\s*\{\s*corpusDatabase\s*\}\s*from\s*"\.\.\/storage\/connection"/);
  assert.match(entry, /openConfiguredAnswerRuntime\(config,\s*\{\s*corpusPool:\s*corpusDatabase\(\)\.pool/);
  assert.match(entry, /privateObjects:\s*\{\s*async get\(key, caller\)/);
  assert.match(entry, /requireR2\(\)\.get\(key\)/);
  assert.match(runtime, /openRegisteredEvidenceStore\(bindings\.corpusPool, configuration\.generationSha256, deadlineAt, signal, \{ readOnly: true \}\)/);
  assert.match(runtime, /createConfiguredAnswerRuntime\(configuration, \{ store, privateObjects: bindings\.privateObjects \}\)/);
});
