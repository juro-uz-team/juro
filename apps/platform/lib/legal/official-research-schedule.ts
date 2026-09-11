type Discovery = (query: string, locale: "ru" | "uz", signal: AbortSignal) => Promise<string[]>;

/** One request's optional discovery. Results remain untrusted URL candidates;
 * callers must still fetch, authenticate and assess any evidence they use. */
export function scheduleOfficialDiscovery(input: {
  query: Promise<string>;
  locale: "ru" | "uz";
  discover: Discovery;
  delayMs: number;
  signal?: AbortSignal;
  requestId?: string;
}) {
  const controller = new AbortController();
  const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
  // The planning promise can reject before the delayed discovery is needed.
  // Keep its rejection handled while preserving it for the eventual consumer.
  void input.query.catch(() => undefined);
  const readQuery = (waitSignal: AbortSignal = signal) => new Promise<string>((resolve, reject) => {
    if (waitSignal.aborted) {reject(waitSignal.reason); return;}
    const abort = () => {waitSignal.removeEventListener("abort", abort); reject(waitSignal.reason);};
    waitSignal.addEventListener("abort", abort, {once: true});
    input.query.then(query => {waitSignal.removeEventListener("abort", abort); resolve(query);},
      error => {waitSignal.removeEventListener("abort", abort); reject(error);});
  });
  let pending: Promise<string[]> | undefined;
  let closed = false;
  const observe = (phase: string, elapsedMs?: number) => console.info(JSON.stringify({
    event: "legal.official_discovery_schedule", requestId: input.requestId, phase, elapsedMs,
  }));
  const start = (trigger: "indexed_slow" | "live_required") => pending ??= (async () => {
    const query = await readQuery();
    signal.throwIfAborted();
    const started = performance.now();
    observe(trigger);
    try {
      const result = await input.discover(query, input.locale, signal);
      observe("completed", Math.round(performance.now() - started));
      return result;
    } catch (error) {
      observe(signal.aborted ? "cancelled" : "failed", Math.round(performance.now() - started));
      throw error;
    }
  })();
  const timer = setTimeout(() => {if (!closed) void start("indexed_slow").catch(() => undefined);}, input.delayMs);
  return {
    discover: async (query: string, locale: "ru" | "uz", callerSignal: AbortSignal) => {
      callerSignal.throwIfAborted();
      if (closed) throw new Error("OFFICIAL_DISCOVERY_CLOSED");
      if (query !== await readQuery(AbortSignal.any([signal, callerSignal])) || locale !== input.locale) {
        return input.discover(query, locale, AbortSignal.any([signal, callerSignal]));
      }
      clearTimeout(timer);
      const abort = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener("abort", abort, {once: true});
      try {callerSignal.throwIfAborted(); return await start("live_required");}
      finally {callerSignal.removeEventListener("abort", abort);}
    },
    close: async () => {
      closed = true;
      clearTimeout(timer);
      controller.abort(new DOMException("Unused official discovery cancelled", "AbortError"));
      await pending?.catch(() => undefined);
    },
  };
}
