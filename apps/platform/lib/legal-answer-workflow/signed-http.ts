import { executeSignedInAnswer } from "./signed-request";
import { prepareSignedAnswerRequest } from "./request-adapter";
import { requestLifetime, withinSignal } from "./lifetime";
import { createAnswerEventStream } from "./answer-stream";
import { rejectAnswerRequest } from "./request-boundary";

type Actor = { db: D1Database; workspaceId: string; userId: string };
type Dependencies = Parameters<typeof executeSignedInAnswer>[1];
type PreparedRequest = Awaited<ReturnType<typeof prepareSignedAnswerRequest>>;
type Configuration = {
  publicOrigin: string; deadlineMs: number;
  submittedAt?: number;
  authenticate(request: Request, signal: AbortSignal): Promise<Actor>;
  admit?(actor: Actor, request: PreparedRequest, signal: AbortSignal): Promise<Response | null>;
  dependencies(actor: Actor, request: PreparedRequest, signal: AbortSignal): Promise<Dependencies & { deadlineMs?: number }>;
};

const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };

export async function readAnswerPayload(request: Request, signal: AbortSignal): Promise<unknown> {
  if (!request.body) throw new Error("REQUEST_BODY_REQUIRED");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await withinSignal(signal, () => reader.read());
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 64 * 1024) throw new Error("REQUEST_BODY_LIMIT");
      chunks.push(next.value);
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** Same-origin signed delivery: only a committed answer becomes the terminal SSE result. */
export async function handleSignedAnswerHttp(request: Request, configuration: Configuration): Promise<Response> {
  const submittedAt = configuration.submittedAt ?? Date.now();
  const rejected = rejectAnswerRequest(request, configuration.publicOrigin);
  if (rejected) return rejected;
  const disconnected = new AbortController();
  const lifetime = requestLifetime(submittedAt, configuration.deadlineMs, AbortSignal.any([request.signal, disconnected.signal]));
  const { signal } = lifetime;
  let actor: Actor;
  try { actor = await withinSignal(signal, () => configuration.authenticate(request, signal)); }
  catch {
    lifetime.dispose();
    return Response.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401, headers });
  }
  let input: PreparedRequest;
  try {
    input = await prepareSignedAnswerRequest({ ...actor, payload: await readAnswerPayload(request, signal), signal });
  } catch {
    lifetime.dispose();
    return Response.json({ code: "LEGAL_ANSWER_REQUEST_INVALID" }, { status: 400, headers });
  }
  let dependencies: Dependencies & { deadlineMs?: number };
  let deadlineMs: number;
  try {
    const rejected = await configuration.admit?.(actor, input, signal);
    if (rejected) { lifetime.dispose(); return rejected; }
    dependencies = await withinSignal(signal, () => configuration.dependencies(actor, input, signal));
    deadlineMs = Math.min(configuration.deadlineMs, dependencies.deadlineMs ?? configuration.deadlineMs);
    lifetime.setDuration(deadlineMs);
  } catch {
    lifetime.dispose();
    return Response.json({ code: "LEGAL_ANSWER_CONFIGURATION_UNAVAILABLE" }, { status: 503, headers });
  }
  const stream = createAnswerEventStream({ lifetime, disconnected,
    async execute(onBudgetSelected, onProgress, onWriting) {
      const result = await executeSignedInAnswer({ ...actor, ...input, submittedAt,
        deadlineMs, signal, onBudgetSelected, onProgress, onWriting }, dependencies);
      return result.kind === "completed" ? { runId: result.runId, conversationId: result.conversationId,
        messageId: result.responseMessageId, result: result.response } : null;
    },
  });
  return new Response(stream, { headers: { ...headers, "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no" } });
}
