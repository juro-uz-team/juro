import assert from "node:assert/strict";
import test from "node:test";
import {createProviderCandidateIndex, parsePinnedCandidateRelease,
  toPinnedCandidateConfiguration} from "../lib/legal-corpus/legal-candidate-index";

function configuration() {
  return {backend: "prepared-corpus-v1", identity: "prepared-configuration",
    embeddingModel: "openai/text-embedding-3-large", dimensions: 3072,
    artifacts: {packageSha256: "a".repeat(64), vectorCompletionSha256: "b".repeat(64),
      membershipSha256: "c".repeat(64), workIndexSha256: "d".repeat(64),
      navigationSha256: "e".repeat(64), sparseSha256: "f".repeat(64)},
    evidenceSemantics: "discovery-only", categoryRanking: {mode: "disabled"},
    gatewayIdentity: "gateway", providerProjectIdentity: "project",
    gatewayPayloadLogging: false, gatewayCaching: false, similarityCaching: false};
}

test("prepared release preserves every artifact pin and rejects legacy or incomplete configuration", () => {
  const input = configuration();
  assert.deepEqual(toPinnedCandidateConfiguration(input), input);
  for (const changed of [
    {...input, dimensions: 1536},
    {...input, backend: "prepared-corpus-v2"},
    {...input, evidenceSemantics: "eligible"},
    {...input, gatewayCaching: true},
    {...input, metadataSchema: ["valid_from", "valid_to"]},
    {...input, artifacts: {...input.artifacts, sparseSha256: undefined}},
    {...input, categoryRanking: {mode: "qualified"}},
  ]) assert.throws(() => toPinnedCandidateConfiguration(changed));
  const qualified = {...input, categoryRanking: {mode: "qualified",
    policySha256: "1".repeat(64), qualificationSha256: "2".repeat(64)}};
  assert.deepEqual(toPinnedCandidateConfiguration(qualified), qualified);
});

test("legacy provider rejects a prepared release before attestation or search", async () => {
  let calls = 0;
  const provider = createProviderCandidateIndex({
    async attest() { calls++; throw Error("Unexpected legacy attestation"); },
    async search() { calls++; throw Error("Unexpected legacy search"); },
  }, {});
  const release = parsePinnedCandidateRelease({id: "prepared-release", environment: "production",
    capability: "current", instances: [{id: "prepared-instance", shardId: "prepared-shard"}],
    configuration: configuration()});
  const result = await provider.retrieve({id: "question", formulations: [{id: "formulation",
    text: "Which provisions apply?", privateNameSpans: [], readingIds: ["reading"],
    requirementIds: ["requirement"]}]}, {kind: "current"}, release);
  assert.equal(result.availability, "unavailable");
  assert.equal(result.candidates.length, 0);
  assert.equal(calls, 0);
});
