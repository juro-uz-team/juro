import { createHash } from "node:crypto";
import { answerFailureCode } from "./failure";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { IdentityKeyring } from "../auth/keyring";
import type { LegalChatResponse } from "../ai/legal-chat-schema";
import { completeGuestAiRun, failGuestAiRun, guestAiClarificationRuns, reserveGuestAiRun,
  revealGuestAiRunQuestion, revealGuestAiRunResult, type GuestAiSession } from "../ai/guest-session";
import type { executeSignedInAnswer } from "./signed-request";
import type { LegalRequest } from "./contracts";
import { citationStatements } from "./citation-storage";
import { requestLifetime, withinSignal } from "./lifetime";
import { entryInstruction, unreadResearchInstruction, researchWritingInstruction } from "./prompts";
import { serializeLegalOutcome } from "./serialization";
import { runLegalAnswer } from "./workflow";

const fieldsSchema = z.object({
  question: z.string().trim().min(1).max(12_000), language: z.enum(["en", "ru", "uz"]),
  format: z.enum(["short", "detailed"]), mode: z.enum(["fast", "deep"]),
  legalContextDate: z.iso.date().optional(), idempotencyKey: z.string().min(8).max(128),
});
type Dependencies = Pick<Parameters<typeof executeSignedInAnswer>[1],
  "model" | "legalDatabaseAsOf" | "sourceVersionHash" | "createExecution">;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Guest account policy and encrypted persistence surround the same fresh evidence workflow. */
export async function executeGuestAnswer(input: z.infer<typeof fieldsSchema> & {
  db: D1Database; session: GuestAiSession; keyring: IdentityKeyring;
  submittedAt: number; deadlineMs: number; signal: AbortSignal;
  onBudgetSelected?: LegalRequest["onBudgetSelected"];
  onProgress?: LegalRequest["onProgress"];
  onWriting?: LegalRequest["onWriting"];
}, dependencies: Dependencies) {
  const fields = fieldsSchema.parse(input);
  const lifetime = requestLifetime(input.submittedAt, input.deadlineMs, input.signal);
  const { signal } = lifetime;
  let reservation: Awaited<ReturnType<typeof reserveGuestAiRun>> | undefined;
  try {
    const access = await withinSignal(signal, () => input.db.prepare(`SELECT id FROM guest_ai_sessions
      WHERE id=? AND token_hmac=? AND token_key_version=? AND expires_at>?`)
      .bind(input.session.id, input.session.tokenHmac, input.session.tokenKeyVersion, new Date().toISOString()).first());
    if (!access) throw new Error("GUEST_SESSION_UNAVAILABLE");
    reservation = await withinSignal(signal, () => reserveGuestAiRun({ ...input,
      question: fields.question, requestHash: hash(fields), provider: "openai", model: dependencies.model,
      legalDatabaseAsOf: dependencies.legalDatabaseAsOf, sourceVersionHash: dependencies.sourceVersionHash,
      instructionHash: hash([entryInstruction, unreadResearchInstruction, researchWritingInstruction]) }));
    if (reservation.kind === "completed") {
      const response: LegalChatResponse = JSON.parse(await withinSignal(signal, () => revealGuestAiRunResult({
        keyring: input.keyring, run: reservation!.run })));
      return { kind: "completed" as const, runId: reservation.run.id, response };
    }
    if (reservation.kind !== "created") return { kind: reservation.kind, runId: reservation.run.id };
    const run = reservation.run;
    const history: Array<LegalRequest["history"][number]> = [];
    const prior = await withinSignal(signal, () => guestAiClarificationRuns(input.db, input.session));
    for (const previous of prior) {
      const [question, answer] = await withinSignal(signal, () => Promise.all([
        revealGuestAiRunQuestion({ keyring: input.keyring, run: previous }),
        revealGuestAiRunResult({ keyring: input.keyring, run: previous }),
      ]));
      history.push({ role: "user", content: question }, { role: "assistant", content: answer });
    }
    const request: LegalRequest = { ...fields, history, privateDocuments: [], submittedAt: input.submittedAt,
      deadlineMs: input.deadlineMs, onBudgetSelected: input.onBudgetSelected, onProgress: input.onProgress, onWriting: input.onWriting, signal,
      actor: { tenantId: `guest:${input.session.id}`, userId: input.session.id } };
    const execution = await withinSignal(signal, () => dependencies.createExecution({ request, runId: run.id, model: dependencies.model }));
    let delivery: LegalChatResponse | undefined;
    await runLegalAnswer(request, { ...execution, publication: { publish: async ({ outcome, request: settledRequest, signal: publicationSignal }) => {
      const evidence = outcome.kind === "answer" ? outcome.evidence : outcome.checkedEvidence;
      const citations = await withinSignal(publicationSignal, () => execution.citations(evidence, publicationSignal));
      if (citations.length !== evidence.length || citations.some(citation =>
        !evidence.some(provision => isDeepStrictEqual(provision, citation.evidence)))) throw new Error("PUBLICATION_EVIDENCE_MISMATCH");
      const response = serializeLegalOutcome(outcome, request, { sources: citations.map(citation => citation.source),
        legalDatabaseAsOf: dependencies.legalDatabaseAsOf });
      const now = new Date().toISOString();
      const deadlineAt = input.submittedAt + settledRequest.deadlineMs;
      publicationSignal.throwIfAborted();
      await completeGuestAiRun({ ...input, run, resultJson: JSON.stringify(response), responseKind: response.responseKind,
        provider: "openai", model: dependencies.model, ...execution.usage(),
        additionalStatements: [
          ...citationStatements({ db: input.db, guestRunId: run.id, now, citations }),
          input.db.prepare(`SELECT CASE WHEN unixepoch('subsec') * 1000 < ? AND EXISTS (
            SELECT 1 FROM guest_ai_runs r JOIN guest_ai_sessions s ON s.id=r.session_id
            WHERE r.id=? AND r.status='completed' AND s.token_hmac=? AND s.token_key_version=?
              AND s.expires_at>? AND s.state=?
          ) THEN 1 ELSE json_extract('GUEST_PUBLICATION_FENCE_FAILED','$') END AS live`)
            .bind(deadlineAt, run.id, input.session.tokenHmac, input.session.tokenKeyVersion, now,
              response.responseKind === "answer" ? "consumed" : "available"),
        ] });
      delivery = response;
      return { answerId: run.id, outcome };
    } } });
    if (!delivery) throw new Error("PUBLICATION_DELIVERY_MISSING");
    return { kind: "completed" as const, runId: run.id, response: delivery };
  } catch (error) {
    if (reservation?.kind === "created") await failGuestAiRun({ db: input.db, run: reservation.run,
      errorCode: answerFailureCode(error, signal.aborted) });
    throw error;
  } finally { lifetime.dispose(); }
}
