import { z } from "zod";
import { executeGuestAnswer } from "./guest-request";
import { requestLifetime, withinSignal } from "./lifetime";
import { readAnswerPayload } from "./signed-http";
import { createAnswerEventStream } from "./answer-stream";
import { rejectAnswerRequest } from "./request-boundary";

const payloadSchema = z.object({
  question: z.string().trim().min(1).max(12_000), locale: z.enum(["en", "ru", "uz"]),
  idempotencyKey: z.string().min(8).max(128), turnstileToken: z.string().max(16_384).optional(),
}).strict();
type Actor = Pick<Parameters<typeof executeGuestAnswer>[0], "db" | "session" | "keyring"> & { cookie?: string };
type Configuration = {
  publicOrigin: string; deadlineMs: number; submittedAt?: number;
  authenticate(request: Request, payload: z.infer<typeof payloadSchema>, signal: AbortSignal): Promise<Actor>;
  dependencies(actor: Actor, signal: AbortSignal): Promise<Parameters<typeof executeGuestAnswer>[1] & { deadlineMs?: number }>;
};
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
export class GuestChallengeRequired extends Error {
  constructor() { super("GUEST_CHALLENGE_REQUIRED"); }
}

/** Guest UI contract: establish the cookie before streaming and deliver only committed results. */
export async function handleGuestAnswerHttp(request: Request, configuration: Configuration): Promise<Response> {
  const rejected = rejectAnswerRequest(request, configuration.publicOrigin);
  if (rejected) return rejected;
  const submittedAt = configuration.submittedAt ?? Date.now();
  const disconnected = new AbortController();
  const lifetime = requestLifetime(submittedAt, configuration.deadlineMs, AbortSignal.any([request.signal, disconnected.signal]));
  const { signal } = lifetime;
  let payload: z.infer<typeof payloadSchema>, actor: Actor;
  try { payload = payloadSchema.parse(await readAnswerPayload(request, signal)); }
  catch {
    lifetime.dispose();
    return Response.json({ code: "GUEST_REQUEST_INVALID" }, { status: 400, headers });
  }
  try { actor = await withinSignal(signal, () => configuration.authenticate(request, payload, signal)); }
  catch (error) {
    lifetime.dispose();
    if (error instanceof GuestChallengeRequired) return Response.json({ code: "GUEST_CHALLENGE_REQUIRED" }, { status: 400, headers });
    return Response.json({ code: "GUEST_SESSION_UNAVAILABLE" }, { status: 403, headers });
  }
  const stream = createAnswerEventStream({ lifetime, disconnected,
    async execute(onBudgetSelected, onProgress, onWriting) {
      const dependencies = await withinSignal(signal, () => configuration.dependencies(actor, signal));
      const deadlineMs = Math.min(configuration.deadlineMs, dependencies.deadlineMs ?? configuration.deadlineMs);
      lifetime.setDuration(deadlineMs);
      const result = await executeGuestAnswer({ ...actor, question: payload.question, language: payload.locale,
        format: "detailed", mode: "fast", idempotencyKey: payload.idempotencyKey,
        submittedAt, deadlineMs, signal, onBudgetSelected, onProgress, onWriting }, dependencies);
      return result.kind === "completed" ? { runId: result.runId, result: result.response } : null;
    },
  });
  return new Response(stream, { headers: { ...headers, "content-type": "text/event-stream; charset=utf-8",
    "x-accel-buffering": "no", ...(actor.cookie ? { "set-cookie": actor.cookie } : {}) } });
}
