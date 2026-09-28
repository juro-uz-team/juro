export type ProviderRequestAbortReason =
  | "caller"
  | "response_headers_timeout"
  | "first_byte_timeout"
  | "total_response_timeout"
  | "absolute_deadline_exceeded";

export class ProviderRequestAbortError extends Error {
  constructor(readonly reason: ProviderRequestAbortReason) {
    super(reason);
    this.name = "ProviderRequestAbortError";
  }
}

function positiveTimeout(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number.`);
  }
  return value;
}

function finiteTimestamp(value: number, name: string): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite Unix timestamp in milliseconds.`);
  }
  return value;
}

export type ProviderRequestFirstContentTiming = {
  /** Epoch time at which the provider request began. */
  startedAt: number;
  /** Epoch time at which the consumer observed the first actual provider content. */
  firstContentAt: number;
  /** Elapsed provider time until the first actual content, never derived from HTTP headers. */
  elapsedMs: number;
};

export type ProviderRequestConsumeContext = {
  /**
   * Records the first actual provider content exactly once.
   *
   * A stream parser should call this only when it has received a non-empty
   * provider delta (or an equivalent body-level content event), not when
   * `fetch` merely resolves with HTTP headers.
   */
  markFirstContent: () => Promise<void>;
};

/**
 * Runs a provider request with independent deadlines for receiving response
 * headers and consuming the complete response body/stream.
 *
 * The total-response deadline starts with the request, while the first-byte
 * deadline is cleared as soon as fetch resolves with response headers. This
 * preserves the historical contract for non-streaming callers. Streaming
 * callers can separately record the first *actual* provider content through
 * `context.markFirstContent()`.
 *
 * `deadlineAt` is an optional absolute request budget shared by all phases.
 * It never extends either existing timeout and is useful when a caller needs
 * primary and fallback providers to share one deadline.
 */
export async function runProviderRequestWithTimeouts<T>(input: {
  /** Optional connection deadline, cleared on headers even for streaming calls. */
  responseHeadersTimeoutMs?: number;
  firstByteTimeoutMs: number;
  totalResponseTimeoutMs: number;
  /**
   * When true, keep the early timer alive until the consumer records a real
   * body-level provider delta. This is for streaming callers only; legacy
   * JSON consumers retain header-timeout semantics.
   */
  requireFirstContent?: boolean;
  /** Absolute Unix timestamp in milliseconds. Optional for backward compatibility. */
  deadlineAt?: number;
  callerSignal?: AbortSignal;
  /** Injectable clock for deterministic timing tests. */
  now?: () => number;
  /** Non-fatal observer for the first actual provider content. */
  onFirstContent?: (timing: ProviderRequestFirstContentTiming) => void | Promise<void>;
  start: (signal: AbortSignal) => Promise<Response>;
  consume: (response: Response, signal: AbortSignal, context: ProviderRequestConsumeContext) => Promise<T>;
}): Promise<T> {
  const firstByteTimeoutMs = positiveTimeout(input.firstByteTimeoutMs, "firstByteTimeoutMs");
  const totalResponseTimeoutMs = positiveTimeout(input.totalResponseTimeoutMs, "totalResponseTimeoutMs");
  const headersTimeout=input.responseHeadersTimeoutMs===undefined?undefined
    :positiveTimeout(input.responseHeadersTimeoutMs,"responseHeadersTimeoutMs");
  const deadlineAt = input.deadlineAt === undefined ? undefined : finiteTimestamp(input.deadlineAt, "deadlineAt");
  const now = input.now ?? Date.now;
  const startedAt = now();
  const controller = new AbortController();
  let abortReason: ProviderRequestAbortReason | null = null;
  let firstContentRecorded = false;

  const abort = (reason: ProviderRequestAbortReason) => {
    if (controller.signal.aborted) return;
    abortReason = reason;
    controller.abort();
  };
  const cancelFromCaller = () => abort("caller");

  if (input.callerSignal?.aborted) {
    throw new ProviderRequestAbortError("caller");
  }
  if (deadlineAt !== undefined && deadlineAt <= startedAt) {
    throw new ProviderRequestAbortError("absolute_deadline_exceeded");
  }
  input.callerSignal?.addEventListener("abort", cancelFromCaller, { once: true });

  const firstByteTimer = setTimeout(() => abort("first_byte_timeout"), firstByteTimeoutMs);
  const totalResponseTimer = setTimeout(() => abort("total_response_timeout"), totalResponseTimeoutMs);
  const headersTimer=headersTimeout===undefined?undefined:setTimeout(()=>abort("response_headers_timeout"),headersTimeout);
  const absoluteDeadlineTimer = deadlineAt === undefined
    ? undefined
    : setTimeout(() => abort("absolute_deadline_exceeded"), Math.max(0, deadlineAt - startedAt));
  const context: ProviderRequestConsumeContext = {
    markFirstContent: async () => {
      if (firstContentRecorded) return;
      firstContentRecorded = true;
      if (input.requireFirstContent) clearTimeout(firstByteTimer);
      const firstContentAt = now();
      try {
        await input.onFirstContent?.({
          startedAt,
          firstContentAt,
          elapsedMs: Math.max(0, firstContentAt - startedAt),
        });
      } catch {
        // Timing observers must never turn a successfully received provider
        // response into a failed legal answer.
      }
    },
  };
  try {
    const response = await input.start(controller.signal);
    if(headersTimer!==undefined)clearTimeout(headersTimer);
    controller.signal.throwIfAborted();
    if (!input.requireFirstContent) clearTimeout(firstByteTimer);
    const result=await input.consume(response, controller.signal, context);
    controller.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (abortReason || (error instanceof Error && error.name === "AbortError" && controller.signal.aborted)) {
      throw new ProviderRequestAbortError(abortReason ?? "total_response_timeout");
    }
    throw error;
  } finally {
    clearTimeout(firstByteTimer);
    clearTimeout(totalResponseTimer);
    if(headersTimer!==undefined)clearTimeout(headersTimer);
    if (absoluteDeadlineTimer !== undefined) clearTimeout(absoluteDeadlineTimer);
    input.callerSignal?.removeEventListener("abort", cancelFromCaller);
  }
}
