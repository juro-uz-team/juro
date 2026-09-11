import assert from "node:assert/strict";
import test from "node:test";
import {createRuntimeExecutionObserver, parseRuntimeExecutionHeader} from "../lib/ai/runtime-execution-observation";

test("execution observations retain instance identity and count independently started requests", () => {
  const observe = createRuntimeExecutionObserver();
  const first = observe("request-a", "build-a");
  const second = observe("request-b", "build-a");
  assert.equal(first.ordinal, 1);
  assert.equal(second.ordinal, 2);
  assert.equal(first.instanceId, second.instanceId);
  assert.equal(first.requestId, "request-a");
  assert.equal(second.requestId, "request-b");
  assert.equal(first.versionId, "build-a");
  assert.notEqual(createRuntimeExecutionObserver()("request-a", "build-a").instanceId, first.instanceId);
});

test("missing build identity remains unknown and headers require exact request correlation", () => {
  const observation = createRuntimeExecutionObserver()("request-a", undefined);
  assert.equal(observation.versionId, null);
  const header = JSON.stringify({...observation, releaseIds: ["current-release"]});
  assert.deepEqual(parseRuntimeExecutionHeader(header, "request-a"), {...observation, releaseIds: ["current-release"]});
  assert.equal(parseRuntimeExecutionHeader(header, "request-b"), null);
  assert.equal(parseRuntimeExecutionHeader(null, "request-a"), null);
  assert.equal(parseRuntimeExecutionHeader(JSON.stringify({...observation, ordinal: 0, releaseIds: []}), "request-a"), null);
  assert.equal(parseRuntimeExecutionHeader("x".repeat(4097), "request-a"), null);
});
