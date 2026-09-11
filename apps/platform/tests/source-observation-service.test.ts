import assert from "node:assert/strict";
import test from "node:test";
import {createSourceObservationClient, handleSourceObservationRequest} from "../lib/legal-corpus/source-observation-service";
import type {SourceObservation} from "../lib/legal/source-observation";

test("observation refresh crosses the private service boundary with exact publisher identity and time", async () => {
  const url = "https://lex.uz/ru/docs/777";
  const observation: SourceObservation = {version: 2, officialUrl: url, observedAt: "2026-09-11T00:00:00.000Z",
    current: true, normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)};
  let reads = 0;
  const observe = async (actual: string) => {assert.equal(actual, url); reads++; return observation;};
  const publicResponse = await handleSourceObservationRequest(new Request("https://example.com/internal/legal-corpus/source-observation", {method: "POST"}),
    {APP_ENV: "development"}, {observe});
  assert.equal(publicResponse.status, 404); assert.equal(reads, 0);
  const client = createSourceObservationClient({environment: "development", service: {fetch(input, init) {
    return handleSourceObservationRequest(new Request(input, init), {APP_ENV: "development"}, {observe});
  }} as Fetcher});
  assert.deepEqual(await client(url), observation);
  assert.equal(reads, 1);
  const old = createSourceObservationClient({environment: "development", service: {async fetch() {
    return Response.json({current: true, checkedAt: observation.observedAt});
  }} as unknown as Fetcher});
  await assert.rejects(old(url));
  const wrong = createSourceObservationClient({environment: "development", service: {async fetch() {
    return Response.json({version: 1, observation: {...observation, officialUrl: "https://lex.uz/en/docs/777"}});
  }} as unknown as Fetcher});
  await assert.rejects(wrong(url));
});
