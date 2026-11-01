import assert from "node:assert/strict";
import test from "node:test";
import { resolveSavedSourceRoute } from "../lib/legal-answer-workflow/saved-source-routing";

const hash = "a".repeat(64), index = "b".repeat(64);
const release = { id: "retained", capability: "current", environment: "staging",
  instances: [{ id: "fixture", shardId: "fixture" }], configuration: { backend: "prepared-corpus-v1",
    navigationBackend: "pgvector", identity: "fixture", embeddingModel: "openai/text-embedding-3-large", dimensions: 3072,
    artifacts: { packageSha256: hash, workIndexSha256: index, vectorCompletionSha256: hash, vectorIdentitySha256: hash,
      membershipSha256: hash, navigationSha256: hash, sparseSha256: hash }, evidenceSemantics: "discovery-only",
    categoryRanking: { mode: "disabled" }, gatewayIdentity: "fixture", providerProjectIdentity: "fixture",
    gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false } };
const route = { packageSha256: hash, workIndexSha256: index, url: "http://127.0.0.1:8111",
  workerSha256: "c".repeat(64), tokenEnvironment: "RETAINED_SOURCE_TOKEN" };
const manifest = Buffer.from(JSON.stringify({ currentRelease: release }));
const env = { LEGAL_ANSWER_RETAINED_SOURCES: JSON.stringify([route]), RETAINED_SOURCE_TOKEN: "t".repeat(40),
  LEGAL_ANSWER_RUNTIME_CONFIG: "/missing/new-active-config.json" };

test("saved package routing uses its registered release without active configuration or provider credentials", () => {
  const resolved = resolveSavedSourceRoute(manifest, hash, env);
  assert.deepEqual(resolved.release, release);
  assert.equal(resolved.worker.url, route.url);
  assert.equal(resolved.worker.token, env.RETAINED_SOURCE_TOKEN);
});

test("saved routing rejects absent packages, ambiguous routes and unpinned work indexes", () => {
  assert.throws(() => resolveSavedSourceRoute(manifest, "d".repeat(64), env), /SAVED_SOURCE_RELEASE_UNAVAILABLE/);
  for (const routes of [[], [route, route], [{ ...route, workIndexSha256: hash }]]) {
    assert.throws(() => resolveSavedSourceRoute(manifest, hash, { ...env,
      LEGAL_ANSWER_RETAINED_SOURCES: JSON.stringify(routes) }), /SAVED_SOURCE_ROUTE_UNAVAILABLE/);
  }
  assert.throws(() => resolveSavedSourceRoute(manifest, hash, { ...env, RETAINED_SOURCE_TOKEN: undefined }), /SAVED_SOURCE_CREDENTIAL/);
});
