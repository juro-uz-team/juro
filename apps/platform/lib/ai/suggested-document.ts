import { z } from "zod";
import { getDocumentByCode } from "../document-builder/registry";
import type { DocumentDefinition, QuestionnaireField } from "../document-builder/registry";
import { createQuestionnaireAnswers, localize, setAnswer } from "../document-builder/registry/engine";
import { createConfiguredDocument } from "../document-builder/storage/configured-documents";
import type { UserProfile } from "../document-builder/types";
import { requireWorkspaceContentEditor } from "../platform/permissions";
import { parseLegalChatResponse } from "./legal-chat-schema";
import type { AiOutputLocale } from "./localization";

export const resolveAiSuggestedDocumentInputSchema = z.object({
  assistantMessageId: z.string().uuid(),
  locale: z.enum(["ru", "uz", "en"]).default("uz"),
}).strict();

export const aiSuggestedDocumentSelectionSchema = z.array(z.object({
  fieldId: z.string().min(1).max(150),
  value: z.string().max(50_000),
}).strict()).max(50).superRefine((items, context) => {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.fieldId)) context.addIssue({ code: "custom", path: [index, "fieldId"], message: "Duplicate field" });
    seen.add(item.fieldId);
  });
});

export const aiSuggestedDocumentRequestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("preview"),
    assistantMessageId: z.string().uuid(),
    locale: z.enum(["ru", "uz", "en"]),
  }).strict(),
  z.object({
    action: z.literal("confirm"),
    assistantMessageId: z.string().uuid(),
    locale: z.enum(["ru", "uz", "en"]),
    fields: aiSuggestedDocumentSelectionSchema,
    sensitiveDataConsent: z.boolean().default(false),
  }).strict(),
]);

export const aiSuggestedDocumentIdempotencyKeySchema = z.string().min(8).max(180)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/u);

export class AiSuggestedDocumentError extends Error {
  constructor(
    readonly code: "AI_SUGGESTED_DOCUMENT_NOT_FOUND" | "AI_SUGGESTED_DOCUMENT_INVALID" | "AI_SUGGESTED_DOCUMENT_UNAVAILABLE" | "AI_SUGGESTED_DOCUMENT_CONFLICT" | "AI_SUGGESTED_DOCUMENT_SENSITIVE_CONSENT_REQUIRED",
  ) {
    super(code);
    this.name = "AiSuggestedDocumentError";
  }
}

type StoredSuggestedDocumentMessage = { structuredJson: string | null; caseId: string | null };

export type AiDocumentPrefillCandidate = {
  fieldId: string;
  label: string;
  value: string;
  source: "profile" | "workspace" | "ai_answer";
  sensitive: boolean;
};

export type AiSuggestedDocumentPreview = {
  templateCode: string;
  categorySlug: string;
  title: string;
  reason: string;
  caseId: string | null;
  candidates: AiDocumentPrefillCandidate[];
};

type SuggestedContext = {
  definition: DocumentDefinition;
  reason: string;
  result: ReturnType<typeof parseLegalChatResponse>;
  caseId: string | null;
};

const selfPartyPrefixes = new Set([
  "applicant", "claimant", "employee", "creditor", "consumer", "requester", "principal", "author",
]);

type ExistingHandoff = {
  documentId: string;
  assistantMessageId: string;
  templateCode: string;
  selectionSha256: string;
};
