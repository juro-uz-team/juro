import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { failAiRun, reserveAiRun, type AiRunReplay } from "../ai/run-store";
import type { BranchSelection } from "./branches";
import { planAnswerBranch } from "./branches";
import type { LegalRequest, OfficialProvision, WorkflowPorts } from "./contracts";
import type { CitationRecord } from "./citation-storage";
import { loadAnswerContext } from "./history";
import { requestLifetime, withinSignal } from "./lifetime";
import { persistSignedInAnswer } from "./persistence";
import { entryInstruction, unreadResearchInstruction, researchWritingInstruction } from "./prompts";
import { serializeLegalOutcome } from "./serialization";
import { runLegalAnswer } from "./workflow";
import { loadPrivateAnswerDocuments } from "./private-documents";
import type { ProvisionObjects } from "./evidence";
import type { VerifiedAnswerVoice } from "./voice-input";
import { answerFailureCode } from "./failure";
import { loadCaseContext } from "./case-context";
import type { IdentityKeyring } from "../auth/keyring";

type SignedRequest = {
  db: D1Database; workspaceId: string; userId: string; conversationId: string | null;
  question: string; language: LegalRequest["language"]; format: LegalRequest["format"]; mode: LegalRequest["mode"];
  legalContextDate?: string;
  voiceRecordingId?: string;
  documentIds: readonly string[]; branch?: BranchSelection; idempotencyKey: string;
  submittedAt: number; deadlineMs: number; signal: AbortSignal;
  onBudgetSelected?: LegalRequest["onBudgetSelected"];
  onProgress?: LegalRequest["onProgress"];
  onWriting?: LegalRequest["onWriting"];
};
type Execution = Pick<WorkflowPorts, "model" | "corpus" | "drain"> & {
  citations(evidence: readonly OfficialProvision[], signal: AbortSignal): Promise<readonly CitationRecord[]>;
  usage(): Parameters<typeof persistSignedInAnswer>[0]["usage"];
};
type SignedDependencies = {
  memoryKeyring?: IdentityKeyring;
  model: string; legalDatabaseAsOf: string; sourceVersionHash: string;
  monthlyLimit?: number | null;
  validateVoice?(input: { db: D1Database; workspaceId: string; userId: string;
    recordingId: string; question: string; signal: AbortSignal }): Promise<VerifiedAnswerVoice>;
  privateObjects: ProvisionObjects;
  createExecution(input: { request: LegalRequest; runId: string; model: string }): Promise<Execution>;
};
const requestFields = z.object({
  question: z.string().trim().min(1).max(12_000), language: z.enum(["en", "ru", "uz"]),
  format: z.enum(["short", "detailed"]), mode: z.enum(["fast", "deep"]),
  legalContextDate: z.iso.date().optional(),
  voiceRecordingId: z.string().min(1).max(240).optional(),
  documentIds: z.array(z.string().min(1).max(240)).max(12),
  idempotencyKey: z.string().min(1).max(240), conversationId: z.string().min(1).max(240).nullable(),
  branch: z.object({ operation: z.enum(["follow_up", "edit", "regenerate"]),
    responseMessageId: z.string().min(1).max(240) }).strict().optional(),
});
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Server-side entrypoint: actor identity and document loading come from authenticated application adapters. */
export async function executeSignedInAnswer(input: SignedRequest, dependencies: SignedDependencies) {
  const fields = requestFields.parse(input);
  if (input.conversationId && !input.branch) throw new Error("CONVERSATION_BRANCH_REQUIRED");
  if (new Set(fields.documentIds).size !== fields.documentIds.length) throw new Error("DOCUMENT_SELECTION_DUPLICATE");
  const lifetime = requestLifetime(input.submittedAt, input.deadlineMs, input.signal);
  const { signal } = lifetime;
  let reserved: Awaited<ReturnType<typeof reserveAiRun>> | undefined;
  try {
    const branch = await withinSignal(signal, () => planAnswerBranch({ ...input, question: fields.question }));
    const replacing = branch.operation === "regenerate" || branch.operation === "edit";
    const context = await loadAnswerContext({ ...input,
      parentBranchId: replacing ? branch.selectedBranchId : branch.parentBranchId, signal });
    // A replacement reuses the selected question's attachments, but never feeds
    // the answer being replaced back into the model as conversation context.
    const history = replacing ? context.history.slice(0, -2) : context.history;
    const caseContext = await loadCaseContext({ ...input, signal, keyring: dependencies.memoryKeyring });
    const contextDocumentIds = [...new Set([...fields.documentIds, ...context.documentIds])];
    const privateDocuments = contextDocumentIds.length
      ? await loadPrivateAnswerDocuments({ ...input, documentIds: contextDocumentIds, objects: dependencies.privateObjects, signal }) : [];
    if (privateDocuments.length !== contextDocumentIds.length
      || new Set(privateDocuments.map(document => document.id)).size !== privateDocuments.length
      || privateDocuments.some(document => !contextDocumentIds.includes(document.id))) {
      throw new Error("DOCUMENT_CONTEXT_MISMATCH");
    }
    const request: LegalRequest = { question: fields.question, language: fields.language,
      format: fields.format, mode: fields.mode, actor: { tenantId: input.workspaceId, userId: input.userId },
      ...(fields.legalContextDate ? { legalContextDate: fields.legalContextDate } : {}),
      history, privateDocuments, caseContext: caseContext.context, submittedAt: input.submittedAt, deadlineMs: input.deadlineMs,
      onBudgetSelected: input.onBudgetSelected, onProgress: input.onProgress, onWriting: input.onWriting, signal };
    reserved = await reserveAiRun({ ...input, requestHash: hash(fields), provider: "openai", model: dependencies.model,
      monthlyLimit: dependencies.monthlyLimit,
      answerMode: fields.format, reasoningMode: fields.mode, legalDatabaseAsOf: dependencies.legalDatabaseAsOf,
      instructionHash: hash([entryInstruction, unreadResearchInstruction, researchWritingInstruction]),
      sourceVersionHash: dependencies.sourceVersionHash });
    if (reserved.kind !== "reserved") return reserved;
    signal.throwIfAborted();
    const reservation = reserved;
    if (fields.voiceRecordingId && !dependencies.validateVoice) throw new Error("VOICE_VALIDATION_UNAVAILABLE");
    const voice = fields.voiceRecordingId ? await withinSignal(signal, () => dependencies.validateVoice!({ ...input,
      recordingId: fields.voiceRecordingId!, question: fields.question, signal })) : undefined;
    const execution = await withinSignal(signal, () => dependencies.createExecution({ request,
      runId: reservation.runId, model: dependencies.model }));
    let delivery: AiRunReplay | undefined;
    await runLegalAnswer(request, { ...execution, publication: { publish: async ({ outcome, request: settledRequest, signal: publicationSignal }) => {
      const evidence = outcome.kind === "answer" ? outcome.evidence : outcome.checkedEvidence;
      const citations = await withinSignal(publicationSignal, () => execution.citations(evidence, publicationSignal));
      if (citations.length !== evidence.length || citations.some(citation =>
        !evidence.some(provision => isDeepStrictEqual(provision, citation.evidence)))) {
        throw new Error("PUBLICATION_EVIDENCE_MISMATCH");
      }
      const response = serializeLegalOutcome(outcome, request, { sources: citations.map(citation => citation.source),
        legalDatabaseAsOf: dependencies.legalDatabaseAsOf });
      const saved = await persistSignedInAnswer({ ...input, ...reservation, question: fields.question,
        documentIds: contextDocumentIds, caseContext: caseContext.receipt,
        memoryKeyring: dependencies.memoryKeyring,
        deadlineMs: settledRequest.deadlineMs, model: dependencies.model, response, citations, voice,
        signal: publicationSignal, usage: execution.usage() });
      delivery = { kind: "completed", runId: reservation.runId, conversationId: saved.conversationId,
        responseMessageId: saved.responseMessageId, response };
      return { answerId: saved.responseMessageId, outcome };
    } } });
    if (!delivery) throw new Error("PUBLICATION_DELIVERY_MISSING");
    return delivery;
  } catch (error) {
    if (reserved?.kind === "reserved") {
      // Release the user's cycle; actual provider spending remains in its separate settlement ledger.
      await failAiRun({ ...input, ...reserved, errorCode: answerFailureCode(error, signal.aborted) });
    }
    throw error;
  } finally {
    lifetime.dispose();
  }
}
