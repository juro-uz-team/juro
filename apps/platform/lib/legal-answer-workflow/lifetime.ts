import { legalAnswerDeadlineMs } from "./deadline";
/** Races uncooperative adapters as well as forwarding cancellation to cooperative ones. */
export async function withinSignal<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    const value = await Promise.race([operation(), aborted]);
    signal.throwIfAborted();
    return value;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function requestLifetime(submittedAt: number, durationMs: number, caller?: AbortSignal, initialDurationMs = durationMs,
  compositionReserveMs?: number) {
  if (!Number.isFinite(submittedAt) || !Number.isFinite(durationMs) || durationMs <= 0 || durationMs > legalAnswerDeadlineMs) {
    throw new Error("REQUEST_DEADLINE_INVALID");
  }
  if (!Number.isFinite(initialDurationMs) || initialDurationMs <= 0 || initialDurationMs > durationMs) throw new Error("REQUEST_DEADLINE_INVALID");
  if (compositionReserveMs !== undefined && (!Number.isFinite(compositionReserveMs) || compositionReserveMs < 0
    || compositionReserveMs >= durationMs)) throw new Error("REQUEST_DEADLINE_INVALID");
  const total = new AbortController();
  const research = new AbortController();
  const writing = new AbortController();
  const signal = AbortSignal.any([total.signal, ...(caller ? [caller] : [])]);
  const researchSignal = AbortSignal.any([signal, research.signal]);
  const writingSignal = AbortSignal.any([signal, writing.signal]);
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let researchTimer: ReturnType<typeof setTimeout> | undefined;
  let writingTimer: ReturnType<typeof setTimeout> | undefined;
  let activeDeadlineAt = submittedAt + initialDurationMs;
  const clear = () => {
    clearTimeout(totalTimer);
    clearTimeout(researchTimer);
    clearTimeout(writingTimer);
  };
  const schedule = (selected: number) => {
    if (!Number.isFinite(selected) || selected <= 0 || selected > durationMs) throw new Error("REQUEST_DEADLINE_INVALID");
    signal.throwIfAborted();
    const now = Date.now(), remaining = submittedAt + selected - now;
    if (now >= activeDeadlineAt || remaining <= 0 || remaining > selected + 1000) throw new Error("REQUEST_DEADLINE");
    clear();
    activeDeadlineAt = submittedAt + selected;
    const researchRemaining = remaining - (compositionReserveMs ?? Math.min(8000, selected * 0.35));
    const writingRemaining = remaining - Math.min(1500, selected * 0.1);
    totalTimer = setTimeout(() => total.abort(new Error("REQUEST_DEADLINE")), remaining);
    if (researchRemaining <= 0) research.abort(new Error("RESEARCH_DEADLINE"));
    else researchTimer = setTimeout(() => research.abort(new Error("RESEARCH_DEADLINE")), researchRemaining);
    if (writingRemaining <= 0) writing.abort(new Error("WRITING_DEADLINE"));
    else writingTimer = setTimeout(() => writing.abort(new Error("WRITING_DEADLINE")), writingRemaining);
  };
  schedule(initialDurationMs);
  return { submittedAt, signal, researchSignal, writingSignal, setDuration(selected: number) {
    researchSignal.throwIfAborted();
    writingSignal.throwIfAborted();
    schedule(selected);
  }, dispose() {
    clear();
    total.abort(new Error("REQUEST_FINISHED"));
  } };
}
