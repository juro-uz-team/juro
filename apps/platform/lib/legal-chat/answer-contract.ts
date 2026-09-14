import { z } from "zod";
import { actionStepSchema, legalFindingSchema, legalRiskSchema } from "../ai/legal-chat-schema";

export const legalDraftSchema = z.object({
  mainPoint: z.object({ text: z.string().min(1).max(1500), sourceIds: z.array(z.string().min(1).max(160)).max(12) }).strict(),
  findings: z.array(legalFindingSchema.omit({ requirementIds: true, answerRole: true })).max(16),
  actions: z.array(actionStepSchema.omit({ requirementIds: true })).max(16),
  risks: z.array(legalRiskSchema).max(16),
  questions: z.array(z.string().min(1).max(500)).max(8),
  unresolved: z.array(z.string().min(1).max(1000)).max(40),
}).strict();
export type LegalDraft = z.infer<typeof legalDraftSchema>;

export const legalVerificationSchema = z.object({
  coverage: z.array(z.object({
    issue: z.string().min(1).max(1000),
    findingIds: z.array(z.string().min(1).max(80)).max(16),
    actionIds: z.array(z.string().min(1).max(80)).max(16),
    gaps: z.array(z.string().min(1).max(1000)).max(16),
  }).strict()).max(24),
  claims: z.array(z.object({
    id: z.string().min(1).max(80), supported: z.boolean(), reason: z.string().min(1).max(1500),
  }).strict()).max(49),
  complete: z.boolean(), gaps: z.array(z.string().min(1).max(1000)).max(40),
  questions: z.array(z.string().min(1).max(500)).max(8),
}).strict();
export type LegalVerification = z.infer<typeof legalVerificationSchema>;

export function legalDraftClaims(draft: LegalDraft) {
  return [
    { id: "mainPoint", text: draft.mainPoint.text, sourceIds: draft.mainPoint.sourceIds },
    ...draft.findings.map((item, index) => ({ id: `finding:${index}`, text: `${item.title}\n${item.explanation}`, sourceIds: item.sourceIds })),
    ...draft.actions.map((item, index) => ({ id: `action:${index}`, text: `${item.title}\n${item.description}`, sourceIds: item.sourceIds })),
    ...draft.risks.map((item, index) => ({ id: `risk:${index}`, text: `${item.level}\n${item.title}\n${item.explanation}`, sourceIds: item.sourceIds })),
  ];
}
