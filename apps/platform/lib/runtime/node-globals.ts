import { AsyncLocalStorage } from "node:async_hooks";

// Next's shared server modules also load in the standalone background worker.
if (!("AsyncLocalStorage" in globalThis)) {
  Object.defineProperty(globalThis, "AsyncLocalStorage", { value: AsyncLocalStorage, configurable: true });
}
