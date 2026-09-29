import assert from "node:assert/strict";
import test from "node:test";
import { sqliteD1Fixture } from "./helpers/sqlite-d1";
import { recordDependencyHealthEvidence } from "../worker/dependency-health-evidence";
import { consumeNativeHealth, nativeHealthEnabled, nativeHealthQueueName, runNativeDependencyHealth } from "../worker/native-dependency-health";
import type { PlatformJobEnv } from "../worker/platform-jobs";

for (const environment of ["production", "staging"] as const) {
  test(`native ${environment} health requires the worker round trip and isolates its queue`, async context => {
    const { sqlite, d1 } = sqliteD1Fixture();
    context.after(() => sqlite.close());
    context.mock.method(globalThis, "fetch", async () => { assert.fail("No provider requests permitted"); });
    const sent: unknown[] = [];
    const env = { APP_ENV: environment, DB: d1, NATIVE_DEPENDENCY_PROBES_ENABLED: "true",
      NATIVE_HEALTH_QUEUE: { async send(body: unknown) { sent.push(body); } },
    } as unknown as PlatformJobEnv;
    for (const key of ["private_r2", "document_builder", "malware_scanner", "lawyer_area"] as const) {
      await recordDependencyHealthEvidence(env, { key, state: "operational", evidenceKind: "synthetic_probe", startedAt: Date.now() });
    }
    assert.equal((await runNativeDependencyHealth(env))?.queue.enqueued, 1);
    const read = () => d1.prepare("SELECT state FROM dependency_health_checks WHERE dependency_key='queues'").all();
    assert.equal((await read()).results.length, 0, "Producer must not publish green evidence");
    let acknowledgements = 0;
    const batch = { queue: nativeHealthQueueName(environment), messages: [{
      id: "native-health-test", body: sent[0], timestamp: new Date(), attempts: 1,
      ack() { acknowledgements++; }, retry() { assert.fail("Valid probe must not retry"); },
    }], ackAll() {}, retryAll() {} } as MessageBatch<unknown>;
    assert.equal(await consumeNativeHealth({ ...batch, queue: "other-work" }, env), false);
    assert.equal(await consumeNativeHealth(batch, env), true);
    assert.equal(acknowledgements, 1);
    assert.deepEqual((await read()).results.map(row => ({ ...row })), [{ state: "operational" }]);
    assert.equal((await runNativeDependencyHealth(env))?.queue.skipped, 1);
  });
}

test("native health does not run in private development or without its explicit runtime flag", async () => {
  for (const APP_ENV of ["development", "staging", "production"]) {
    const env = { APP_ENV, NATIVE_DEPENDENCY_PROBES_ENABLED: "false" } as PlatformJobEnv;
    assert.equal(nativeHealthEnabled(env), false);
    assert.equal(await runNativeDependencyHealth(env), null);
  }
  assert.equal(nativeHealthEnabled({ APP_ENV: "development", NATIVE_DEPENDENCY_PROBES_ENABLED: "true" }), false);
});
