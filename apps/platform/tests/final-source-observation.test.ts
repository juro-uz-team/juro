import assert from "node:assert/strict";
import test from "node:test";
import {validateFinalSourceObservations} from "../lib/legal/final-source-observation";
import type {LegalSourceContext} from "../lib/ai/provider";

test("a source expiring during synthesis must be refreshed against the same pinned text before delivery", async () => {
  const initial = Date.parse("2026-09-11T00:00:00.000Z");
  let now = initial + 299_999;
  const observation = {version: 2 as const, officialUrl: "https://lex.uz/ru/docs/777", observedAt: new Date(initial).toISOString(),
    current: true, normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)};
  const source: LegalSourceContext = {id: "target:source", actTitle: "Law", actIdentifier: null, officialUrl: observation.officialUrl,
    revisionDate: null, lastCheckedAt: observation.observedAt, locale: "ru", publishedAt: null, sourceType: "lex", status: "verified",
    verificationState: "verified", verifiedAt: observation.observedAt, contentSha256: "c".repeat(64), applicabilityStatus: "current",
    currentSourceStatus: {pinnedTextSha256: observation.normalizedTextSha256, observation}};
  let calls = 0;
  const observe = async () => {calls++; return {...observation, observedAt: new Date(now).toISOString()};};
  await validateFinalSourceObservations({sources: [source], sourceIds: [source.id], observe, now: () => now});
  assert.equal(calls, 0);
  now++;
  const refreshed = await validateFinalSourceObservations({sources: [source], sourceIds: [source.id], observe, now: () => now});
  assert.equal(calls, 1);
  assert.equal(refreshed.get(source.id)!.verifiedAt, new Date(now).toISOString());
  assert.equal(source.verifiedAt, observation.observedAt, "Validation does not rewrite the input observation");
  await assert.rejects(validateFinalSourceObservations({sources: [source], sourceIds: [source.id], now: () => now,
    observe: async () => ({...observation, observedAt: new Date(now).toISOString(), normalizedTextSha256: "d".repeat(64)})}));
  await assert.rejects(validateFinalSourceObservations({sources: [source], sourceIds: [source.id], now: () => now,
    observe: async () => {throw new Error("Publisher unavailable");}}), /FINAL_SOURCE_OBSERVATION_UNAVAILABLE/);
  now = initial + 299_999;
  const other = {...source, id: "target:other", officialUrl: "https://lex.uz/ru/docs/888",
    currentSourceStatus: {...source.currentSourceStatus!, observation: null}};
  await assert.rejects(validateFinalSourceObservations({sources: [source, other], sourceIds: [source.id, other.id],
    now: () => now, observe: async (officialUrl) => {
      now += 2;
      return {...observation, officialUrl, observedAt: new Date(now).toISOString()};
    }}), /FINAL_SOURCE_OBSERVATION_UNAVAILABLE/, "Earlier observations cannot expire during a later refresh");
  now = initial + 299_999;
  const live = {...source, id: "live:source", currentSourceStatus: undefined};
  await assert.rejects(validateFinalSourceObservations({sources: [live, other], sourceIds: [live.id, other.id],
    now: () => now, observe: async (officialUrl) => {
      now += 2;
      return {...observation, officialUrl, observedAt: new Date(now).toISOString()};
    }}), /FINAL_SOURCE_OBSERVATION_UNAVAILABLE/, "Compatibility sources must also be fresh at completion");
  const historical = {...source, applicabilityStatus: "historical" as const};
  const retained = await validateFinalSourceObservations({sources: [historical], sourceIds: [source.id], now: () => now,
    observe: async () => {assert.fail("Historical evidence is not replaced with the current revision");}});
  assert.deepEqual(retained.get(source.id), historical);
});
