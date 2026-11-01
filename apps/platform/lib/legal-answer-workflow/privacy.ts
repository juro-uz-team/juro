import { AsyncLocalStorage } from "node:async_hooks";
import { AsyncLocalStorageProviderSingleton } from "@langchain/core/singletons";

/** Questions, private documents and answers must not enter automatic SDK traces. */
export function withoutAnswerTracing<T>(operation: () => T): T {
  for (const name of ["LANGCHAIN_TRACING", "LANGCHAIN_TRACING_V2", "LANGSMITH_TRACING", "LANGCHAIN_VERBOSE"]) {
    const value = process.env[name]?.trim().toLowerCase();
    if (value && value !== "false" && value !== "0") throw new Error("ANSWER_TRACING_CONFIGURATION_FORBIDDEN");
  }
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
  // Clear ambient callbacks/context variables only for this async request. Never
  // alter process environment or another concurrent request's tracing context.
  return AsyncLocalStorageProviderSingleton.getInstance().run(undefined, () =>
    AsyncLocalStorageProviderSingleton.runWithConfig({ callbacks: [] }, operation));
}
