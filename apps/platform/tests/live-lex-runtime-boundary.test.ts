import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("..", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

// Chat corpus-first ordering, source reopening, historical isolation and bounded
// repair are exercised through legal-chat-research, official-research and
// corpus-research tests. The former route-specific retrieval helper is gone.
test("document analysis and monitoring retain their independent live Lex boundaries", async () => {
  const [processor, monitor, scheduler] = await Promise.all([
    source("lib/document-analysis/processor.ts"),
    source("app/api/platform/monitoring/route.ts"),
    source("worker/platform-scheduled.ts"),
  ]);
  assert.match(processor, /retrieveLiveLexSourcesForDocument/);
  assert.match(monitor, /legal_monitoring_metadata/);
  assert.match(scheduler, /runLexMetadataMonitor/);
  for (const value of [processor, monitor, scheduler]) {
    assert.doesNotMatch(value, /retrieveInteractiveVerifiedLegalSources/);
    assert.doesNotMatch(value, /pending_review/);
  }
  assert.doesNotMatch(processor, /semanticSearch/);
});
