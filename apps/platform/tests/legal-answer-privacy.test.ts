import assert from "node:assert/strict";
import test from "node:test";
import { AsyncLocalStorage } from "node:async_hooks";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";
import { RunnableLambda } from "@langchain/core/runnables";
import { withoutAnswerTracing } from "../lib/legal-answer-workflow/privacy";

test("answer execution rejects automatic trace or console capture before accessing inputs", () => {
  for (const name of ["LANGCHAIN_TRACING", "LANGCHAIN_TRACING_V2", "LANGSMITH_TRACING", "LANGCHAIN_VERBOSE"]) {
    const before = process.env[name];
    try {
      process.env[name] = "true";
      let accessed = false;
      assert.throws(() => withoutAnswerTracing(() => { accessed = true; }), /ANSWER_TRACING_CONFIGURATION_FORBIDDEN/);
      assert.equal(accessed, false);
      assert.equal(process.env[name], "true");
    } finally {
      if (before === undefined) delete process.env[name]; else process.env[name] = before;
    }
  }
});

test("private execution drops inherited callbacks while preserving concurrent caller context", async () => {
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
  const captured: unknown[] = [];
  const config = { callbacks: [{ name: "artificial-capture", handleChainStart: (_chain: unknown, input: unknown) => {
    captured.push(input);
  } }] };
  const runnable = RunnableLambda.from(async (input: string) => { await Promise.resolve(); return input; });
  await AsyncLocalStorageProviderSingleton.runWithConfig(config, async () => {
    const before = AsyncLocalStorageProviderSingleton.getInstance().getStore();
    const results = await Promise.all([
      withoutAnswerTracing(() => runnable.invoke("private artificial document")),
      runnable.invoke("public artificial caller"),
    ]);
    assert.deepEqual(results, ["private artificial document", "public artificial caller"]);
    assert.equal(AsyncLocalStorageProviderSingleton.getInstance().getStore(), before);
  });
  assert.ok(JSON.stringify(captured).includes("public artificial caller"));
  assert.ok(!JSON.stringify(captured).includes("private artificial document"));
});
