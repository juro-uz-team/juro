import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { canonicalSecondaryInternetUrl } from "../lib/legal/secondary-internet-url";

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

test("secondary citation URL boundary rejects authority and credential confusion", () => {
  assert.equal(canonicalSecondaryInternetUrl("http://example.org/article"), null);
  assert.equal(canonicalSecondaryInternetUrl("https://user:pass@example.org/article"), null);
  assert.equal(canonicalSecondaryInternetUrl("https://127.0.0.1/article"), null);
  assert.equal(canonicalSecondaryInternetUrl("https://service.internal/article"), null);
  assert.equal(canonicalSecondaryInternetUrl("https://lex.uz/ru/docs/1"), null);
  assert.equal(canonicalSecondaryInternetUrl("https://example.org/article?token=secret"), null);
  assert.equal(
    canonicalSecondaryInternetUrl("https://Example.org/article?utm_source=test&topic=law#fragment"),
    "https://example.org/article?topic=law",
  );
});

test("shared web-search transport requests provider-observed source identities", async () => {
  const adapter = await source("../lib/document-builder/ai/openai.ts");
  assert.match(adapter, /include: \["web_search_call\.action\.sources"\]/u);
  assert.match(adapter, /tool_choice: "required"/u);
  assert.match(adapter, /external_web_access: true/u);
});

test("secondary web research retains its independent immutable operator switch", async () => {
  const [migration, flags] = await Promise.all([
    source("../drizzle/0145_ai_secondary_web_research_flag.sql"),
    source("../lib/operations/operational-feature-flags.ts"),
  ]);
  assert.match(migration, /ai_secondary_web_research/u);
  assert.match(migration, /operational_feature_no_update/u);
  assert.match(migration, /operational_feature_no_delete/u);
  assert.match(flags, /"ai_secondary_web_research"/u);
});
