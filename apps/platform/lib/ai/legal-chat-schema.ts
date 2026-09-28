import { z } from "zod";
import { MAX_LEGAL_ACTION_DESCRIPTION_LENGTH, MAX_LEGAL_ACTION_STEPS } from "./legal-action-limits";
import { MAX_LEGAL_EVIDENCE_SOURCES } from "../legal/legal-evidence-budget";
export { deriveLegalEvidenceMode } from "./legal-evidence-mode";

const sourceIdList = z.array(z.string().min(1).max(160)).max(12);

export const legalFindingSchema = z.object({
  title: z.string().min(1).max(240),
  explanation: z.string().min(1).max(4_000),
  sourceIds: sourceIdList,
  requirementIds: z.array(z.string().min(1).max(240)).max(40).optional(),
  answerRole: z.enum(["governing_rule", "qualification", "procedure", "consequence"]).optional(),
}).strict();

export const legalReferenceNoteSchema = z.object({
  title: z.string().min(1).max(240),
  note: z.string().min(1).max(3_000),
  sourceIds: sourceIdList,
}).strict();

export const legalConditionalBranchSchema = z.object({
  condition: z.string().min(1).max(1_000),
  outcome: z.string().min(1).max(3_000),
  sourceIds: sourceIdList,
}).strict();

const legalConditionalBranchListSchema = z.array(legalConditionalBranchSchema).max(8);

export const legalAssumptionSchema = z.object({
  statement: z.string().min(1).max(1_000),
  impact: z.string().min(1).max(2_000),
}).strict();

export const legalRiskSchema = z.object({
  level: z.enum(["low", "medium", "high", "critical"]),
  title: z.string().min(1).max(240),
  explanation: z.string().min(1).max(3_000),
  sourceIds: sourceIdList,
}).strict();

const legalSourceRefModelSchema = z.object({
  sourceId: z.string().min(1).max(160),
  actTitle: z.string().min(1).max(500),
  actIdentifier: z.string().max(240).nullable(),
  article: z.string().max(240).nullable(),
  excerpt: z.string().max(1_200).nullable(),
  originalUrl: z.string().url().max(2_000),
  status: z.enum(["current", "historical", "repealed", "pending_effect", "unconfirmed"]),
  effectiveDate: z.string().max(64).nullable(),
  verifiedAt: z.string().max(64),
}).strict();

export const legalSourceRefSchema = legalSourceRefModelSchema.extend({
  documentType: z.string().max(160).nullable().optional(),
  documentNumber: z.string().max(240).nullable().optional(),
  adoptingAuthority: z.string().max(500).nullable().optional(),
  sourceClass: z.enum([
    "OFFICIAL_LEGISLATION",
    "OFFICIAL_GOVERNMENT_GUIDANCE",
    "OWNER_TRUSTED_GLOBAL",
    "TENANT_TRUSTED_PRIVATE",
    "USER_TRUSTED_PRIVATE",
    "DERIVED_TRANSLATION",
    "SECONDARY_REFERENCE",
  ]).optional(),
  language: z.enum(["uz-Latn", "uz-Cyrl", "ru", "en"]).optional(),
  sourceOrigin: z.enum(["indexed", "live", "web"]).optional(),
}).strict();

export const requiredDocumentSchema = z.object({
  name: z.string().min(1).max(240),
  reason: z.string().min(1).max(1_000),
  required: z.boolean(),
}).strict();

export const actionStepSchema = z.object({
  title: z.string().min(1).max(240),
  description: z.string().min(1).max(MAX_LEGAL_ACTION_DESCRIPTION_LENGTH),
  sourceIds: sourceIdList,
  requirementIds: z.array(z.string().min(1).max(240)).max(40).optional(),
}).strict();

export const legalDeadlineSchema = z.object({
  title: z.string().min(1).max(240),
  dueDate: z.string().max(64).nullable(),
  sourceDate: z.string().max(64).nullable(),
  calculationMethod: z.string().min(1).max(1_500),
  confidence: z.enum(["preliminary", "confirmed"]),
  sourceIds: sourceIdList,
}).strict();

export const suggestedDocumentSchema = z.object({
  templateCode: z.string().max(160).nullable(),
  title: z.string().min(1).max(240),
  reason: z.string().min(1).max(1_000),
}).strict();

export const legalChatResponseSchema = z.object({
  // Structured Outputs follows schema property order. Put the first
  // independently verifiable legal unit first so the server can validate and
  // stream a useful answer before the rest of the response finishes.
  confirmedFindings: z.array(legalFindingSchema).max(16),
  // Explicit publication membership; absent on legacy saved answers.
  issues: z.array(z.object({
    findingIndex: z.number().int().nonnegative(),
    actionIndices: z.array(z.number().int().nonnegative()).max(MAX_LEGAL_ACTION_STEPS),
  }).strict()).max(16).optional(),
  responseKind: z.enum(["answer", "clarification_required"]),
  summary: z.string().min(1).max(1_500),
  summarySourceIds: sourceIdList.optional(),
  answer: z.string().min(1).max(20_000),
  conditionalBranches: legalConditionalBranchListSchema.optional(),
  language: z.enum(["ru", "uz", "en"]),
  jurisdiction: z.literal("UZ"),
  answerMode: z.enum(["short", "detailed"]),
  reasoningMode: z.enum(["fast", "deep"]),
  clarificationQuestions: z.array(z.string().min(1).max(500)).max(8),
  assumptions: z.array(legalAssumptionSchema).max(16),
  risks: z.array(legalRiskSchema).max(16),
  sources: z.array(legalSourceRefSchema).max(MAX_LEGAL_EVIDENCE_SOURCES),
  requiredDocuments: z.array(requiredDocumentSchema).max(16),
  actionPlan: z.array(actionStepSchema).max(MAX_LEGAL_ACTION_STEPS),
  deadlines: z.array(legalDeadlineSchema).max(12),
  successOutlook: z.object({
    level: z.enum(["low", "medium", "high"]),
    positiveFactors: z.array(z.string().min(1).max(500)).max(10),
    negativeFactors: z.array(z.string().min(1).max(500)).max(10),
  }).strict().nullable(),
  urgency: z.enum(["normal", "high", "critical"]),
  suggestedDocument: suggestedDocumentSchema.nullable(),
  suggestLawyer: z.boolean(),
  legalDatabaseAsOf: z.string().max(64),
  sourceAccessMode: z.enum(["direct", "approved_package", "mixed"]).optional(),
  evidenceMode: z.enum(["official", "mixed", "secondary_only", "private_only", "none"]).optional(),
  sourcesRetrievedAt: z.string().max(64).nullable().optional(),
  validationMethod: z.literal("programmatic").optional(),
  sourceValidationStatus: z.enum(["validated", "unavailable"]).optional(),
  coverageStatus: z.enum(["good_coverage", "partial_coverage", "weak_coverage", "no_coverage"]).optional(),
  referenceNotes: z.array(legalReferenceNoteSchema).max(8).optional(),
  coverageGaps: z.array(z.string().min(1).max(1_000)).max(240).optional(),
  failureReason: z.enum(["question_interpretation_unavailable", "official_research_unavailable", "answer_verification_unavailable"]).optional(),
}).strict().superRefine((answer,ctx)=>{
  if (!answer.issues) return;
  const findings=answer.issues.map(issue=>issue.findingIndex);
  const actions=answer.issues.flatMap(issue=>issue.actionIndices);
  if (findings.length!==answer.confirmedFindings.length || new Set(findings).size!==findings.length
    || findings.some(index=>index>=answer.confirmedFindings.length)
    || actions.length!==answer.actionPlan.length || new Set(actions).size!==actions.length
    || actions.some(index=>index>=answer.actionPlan.length)) {
    ctx.addIssue({code:"custom",path:["issues"],message:"Issue membership must cover each published finding and action exactly once"});
  }
});

export type LegalChatResponse = z.infer<typeof legalChatResponseSchema>;

export function parseLegalChatResponse(value: unknown): LegalChatResponse {
  return legalChatResponseSchema.parse(value);
}
