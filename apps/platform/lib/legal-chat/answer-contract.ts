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
export type LegalClaimKind = "mainPoint" | "finding" | "action" | "risk" | "question" | "gap";
export function legalClaimId(kind: LegalClaimKind, index = 0): string {
  return kind === "mainPoint" ? kind : `${kind}:${index}`;
}

export const MAX_LEGAL_SOURCE_PASSAGES = 160;
export const legalSourceGapsSchema = z.array(z.object({
  sourceId: z.string().min(1).max(160),
  passages: z.array(z.object({
    id: z.string().min(1).max(80),
    missingContent: z.array(z.string().min(1).max(1000)).max(12),
  }).strict()).max(MAX_LEGAL_SOURCE_PASSAGES),
}).strict()).max(24);

export const legalVerificationSchema = z.object({
  sourceGaps: legalSourceGapsSchema.default([]),
  retention: z.array(z.object({priorId:z.string().min(1).max(80),currentIds:z.array(z.string().min(1).max(80)).max(16)}).strict()).max(97),
  coverage: z.array(z.object({
    issue: z.string().min(1).max(1000),
    findingIds: z.array(z.string().min(1).max(80)).max(16),
    actionIds: z.array(z.string().min(1).max(80)).max(16),
    gaps: z.array(z.string().min(1).max(1000)).max(16),
  }).strict()).max(24),
  claims: z.array(z.object({
    id: z.string().min(1).max(80), supported: z.boolean(), reason: z.string().min(1).max(1500),
  }).strict()).max(97),
  complete: z.boolean(), gaps: z.array(z.string().min(1).max(1000)).max(40),
  questions: z.array(z.string().min(1).max(500)).max(8),
}).strict();
export type LegalVerification = z.infer<typeof legalVerificationSchema>;

export function legalDraftClaims(draft: LegalDraft) {
  const claim = (kind:LegalClaimKind,index:number,text:string,sourceIds:string[]) => ({kind,id:legalClaimId(kind,index),text,sourceIds});
  return [
    claim("mainPoint",0,draft.mainPoint.text,draft.mainPoint.sourceIds),
    ...draft.findings.map((item,index)=>claim("finding",index,`${item.title}\n${item.explanation}`,item.sourceIds)),
    ...draft.actions.map((item,index)=>claim("action",index,`${item.title}\n${item.description}`,item.sourceIds)),
    ...draft.risks.map((item,index)=>claim("risk",index,`${item.level}\n${item.title}\n${item.explanation}`,item.sourceIds)),
    ...draft.questions.map((text,index)=>claim("question",index,text,[])),
    ...draft.unresolved.map((text,index)=>claim("gap",index,text,[])),
  ];
}
