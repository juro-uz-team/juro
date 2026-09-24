import {setTimeout as pause} from "node:timers/promises";

/** Separate from queue draining: a slow publisher must not delay private jobs. */
export async function runSourceObserverLoop(input: {
  signal: AbortSignal;
  refresh: () => Promise<unknown>;
  reportError: (error: unknown) => void;
  wait?: (signal: AbortSignal) => Promise<void>;
}) {
  const wait = input.wait ?? (signal => pause(60_000, undefined, {signal}));
  while (!input.signal.aborted) {
    try { await input.refresh(); }
    catch (error) { if (!input.signal.aborted) input.reportError(error); }
    if (input.signal.aborted) break;
    try { await wait(input.signal); }
    catch (error) { if (!input.signal.aborted) throw error; }
  }
}
