import assert from "node:assert/strict";
import {test} from "node:test";
import {runSourceObserverLoop} from "../lib/runtime/source-observer-loop";

test("observer retries after a failed pass and never overlaps refreshes", async () => {
  const controller = new AbortController();
  const events: string[] = [];
  let attempts = 0;
  await runSourceObserverLoop({signal: controller.signal,
    async refresh() {
      events.push("refresh");
      if (++attempts === 1) throw new Error("publisher unavailable");
      controller.abort();
    },
    reportError() { events.push("error"); },
    async wait() { events.push("wait"); },
  });
  assert.deepEqual(events, ["refresh", "error", "wait", "refresh"]);
});

test("observer shutdown interrupts its idle wait", async () => {
  const controller = new AbortController();
  let attempts = 0;
  await runSourceObserverLoop({signal: controller.signal,
    async refresh() { attempts++; setImmediate(() => controller.abort()); },
    reportError(error) { throw error; },
  });
  assert.equal(attempts, 1);
});

test("observer does not start work after shutdown", async () => {
  const controller = new AbortController();
  controller.abort();
  await runSourceObserverLoop({signal: controller.signal,
    async refresh() { assert.fail("unexpected refresh"); },
    reportError(error) { throw error; },
  });
});
