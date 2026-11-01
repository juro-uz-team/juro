import { assertSafeWrite, ApiAuthError } from "../auth/safe-write";
import { issueQuestionIntake, openQuestionIntake, finalizeQuestionIntake, QuestionIntakeError,
  questionIntakeCreateSchema, questionIntakeConsumeSchema } from "../ai/question-intake";
import type { IdentityKeyring } from "../auth/keyring";
import { readAnswerPayload } from "./signed-http";
import { withinSignal } from "./lifetime";

type Operation = "create" | "consume" | "finalize";
type Actor = { db: D1Database; userId: string; workspaceId: string };
const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

export async function handleQuestionIntakeHttp(request: Request, operation: Operation, configuration: {
  authenticate(request: Request, signal: AbortSignal): Promise<Actor>;
  keyring(): IdentityKeyring;
}) {
  if (request.method !== "POST") return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405, headers });
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]);
  try {
    assertSafeWrite(request);
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return Response.json({ code: "REQUEST_CONTENT_TYPE_INVALID" }, { status: 415, headers });
    }
    const raw = await readAnswerPayload(request, signal);
    const payload = (operation === "create" ? questionIntakeCreateSchema : questionIntakeConsumeSchema).parse(raw);
    const selected = request.headers.get("x-juro-workspace-id");
    if (selected !== null && selected !== payload.workspaceId) return Response.json({ code: "WORKSPACE_ACCESS_DENIED" }, { status: 403, headers });
    const actorHeaders = new Headers(request.headers);
    actorHeaders.set("x-juro-workspace-id", payload.workspaceId);
    const actor = await withinSignal(signal, () => configuration.authenticate(new Request(request.url, { headers: actorHeaders }), signal));
    if (actor.workspaceId !== payload.workspaceId) return Response.json({ code: "WORKSPACE_ACCESS_DENIED" }, { status: 403, headers });
    if (operation === "create" && "question" in payload) {
      const result = await withinSignal(signal, () => issueQuestionIntake({ ...actor, keyring: configuration.keyring(), question: payload.question }));
      return Response.json(result, { headers });
    }
    if (!("handle" in payload)) throw new Error("REQUEST_INVALID");
    if (operation === "consume") {
      const question = await withinSignal(signal, () => openQuestionIntake({ ...actor, keyring: configuration.keyring(), handle: payload.handle }));
      return Response.json({ question }, { headers });
    }
    await withinSignal(signal, () => finalizeQuestionIntake({ ...actor, handle: payload.handle }));
    return Response.json({ ok: true }, { headers });
  } catch (error) {
    const status = error instanceof ApiAuthError ? error.status : error instanceof QuestionIntakeError
      ? error.code === "AI_QUESTION_INTAKE_CAPACITY_EXCEEDED" ? 429
        : error.code === "AI_QUESTION_INTAKE_ENCRYPTION_UNAVAILABLE" ? 503 : 404
      : error instanceof Error && error.message === "WORKSPACE_ACCESS_DENIED" ? operation === "create" ? 403 : 404 : 400;
    return Response.json({ code: status === 401 ? "AUTHENTICATION_REQUIRED" : "QUESTION_INTAKE_UNAVAILABLE" }, { status, headers });
  }
}
