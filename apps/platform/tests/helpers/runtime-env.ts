import "../../lib/runtime/node-globals";

process.env.PRIVATE_DEVELOPMENT = "true";

/** Each Node test file runs in an isolated process with explicit fake bindings. */
export const env: Record<string, unknown> = {
  EMAIL_DELIVERY: { fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init) },
};
Object.defineProperty(globalThis, "juroRuntime", { value: env, writable: true, configurable: true });
