import { z } from "zod";
import type { ReferenceDiscoveryResult } from "./runtime-reference-discovery";
import {createRuntimeExecutionObserver, parseRuntimeExecutionHeader, readExecutionDiagnostic, type ServiceExecutionObservation} from "../ai/runtime-execution-observation";
import {pinnedSourceStatusSchema, type PinnedSourceStatus} from "../legal/source-observation";
import { citationEvidenceLocatorSchema } from "./citation-evidence";
import { citationArticleNumber } from "../legal/citation-article";
import { fitsLegalEvidenceBudget, MAX_LEGAL_EVIDENCE_SOURCES, MAX_LEGAL_EVIDENCE_CHARACTERS } from "../legal/legal-evidence-budget";
import { selectionAssessmentBatches, SelectionEvidenceContextError, SELECTION_ASSESSMENT_BATCH_SIZE } from "./selection-reference-context";
import { legalCoverageScopeSchema } from "../legal/legal-coverage";
import { legalRequirementOriginSchema, questionTemporalEndpointSchema, questionTemporalComparisonSchema, unresolvedQuestionDimensionsSchema, userQuestionContextSchema, questionRelationshipSchema, questionAccountingSchema } from "../legal/question-interpretation";
import { LEGAL_INTERPRETATION_REQUIREMENT_LIMIT, LEGAL_INTERPRETATION_FORMULATION_LIMIT,
  LEGAL_EXPANDED_REQUIREMENT_LIMIT, LEGAL_DISCOVERED_REQUIREMENT_LIMIT,
  LEGAL_TOTAL_FORMULATION_LIMIT, LEGAL_REPAIR_FORMULATION_LIMIT as TARGET_REPAIR_FORMULATION_LIMIT } from "../legal/question-interpretation-limits";

import {
  candidateSchema,
  type CandidatePacket,
  type LegalCandidateIndex,
  type PinnedCandidateRelease,
  type TemporalEndpoint,
} from "./legal-candidate-index";
import { LegalEvidenceError, type ControllingEvidenceResolution, type ResolvedOfficialEvidence } from "./target-evidence";
import {
  acceptsPrivateServiceRequest,
  declaredRequestBodyWithinLimit,
  privateServiceJson,
} from "./private-service-boundary";
import {
  canonicalChunkIdSchema,
  legalEnvironmentSchema,
  legalIdentifierSchema,
  provisionConceptIdSchema,
  provisionRenditionIdSchema,
  sha256Schema,
  textRevisionIdSchema,
  utcInstantSchema,
} from "./target-domain-schemas";

export const TARGET_LEGAL_ANSWER_PATH = "/internal/legal-corpus/target/retrieval/answer";
export const TARGET_LEGAL_ANSWER_CONTRACT_VERSION = "2";
export const TARGET_QUESTION_REQUEST_BYTE_LIMIT = 256_000;

const SERVICE_BINDING_MARKER = "target-legal-answer-v1";
export const TARGET_INITIAL_FORMULATION_LIMIT = LEGAL_INTERPRETATION_FORMULATION_LIMIT;
// One bounded repair pass: one missing requirement plus up to three grounded
// additions. Keep them independent so unrelated propositions cannot dilute a query.
export const TARGET_TOTAL_FORMULATION_LIMIT = LEGAL_TOTAL_FORMULATION_LIMIT;
export const targetQuestionPlanningHintsSchema = z.object({
  relationship: questionRelationshipSchema.optional(),
  questionAccounting: questionAccountingSchema.optional(),
  answerLanguage: z.enum(["ru", "uz", "en"]),
  standaloneQuestion: z.string().trim().min(1).max(900),
  requirements: z.array(z.object({
    statement: z.string().trim().min(1).max(500),
    priority: z.enum(["core", "supporting"]),
    scopeKind: legalCoverageScopeSchema.optional(),
    // Server-owned recovery can retain a requirement discovered from an
    // inspected provision. This provenance never grants evidence eligibility;
    // selected candidates still undergo the complete membership/source checks.
    origin: legalRequirementOriginSchema.optional(),
    unresolvedDimensions: unresolvedQuestionDimensionsSchema.optional(),
    questionContext: userQuestionContextSchema.optional(),
  }).strict()).min(1).max(LEGAL_INTERPRETATION_REQUIREMENT_LIMIT),
  formulations: z.array(z.string().trim().min(1).max(500)).min(1).max(LEGAL_INTERPRETATION_FORMULATION_LIMIT),
  formulationRequirementIndexes: z.array(z.array(z.number().int().min(0).max(LEGAL_INTERPRETATION_REQUIREMENT_LIMIT - 1))
    .min(1).max(LEGAL_INTERPRETATION_REQUIREMENT_LIMIT)).min(1).max(LEGAL_INTERPRETATION_FORMULATION_LIMIT).optional(),
  temporalEndpoint: questionTemporalEndpointSchema.optional(),
  comparison: questionTemporalComparisonSchema.optional(),
  missingFacts: z.array(z.string().min(1).max(500)).max(20).optional(),
}).strict().superRefine((value, context) => {
  if (value.formulationRequirementIndexes && (value.formulationRequirementIndexes.length !== value.formulations.length
    || value.formulationRequirementIndexes.some(indexes => indexes.some(index => index >= value.requirements.length)))) {
    context.addIssue({ code: "custom", message: "Formulation requirements must reference the supplied requirement inventory" });
  }
});
export type TargetQuestionPlanningHints = z.infer<typeof targetQuestionPlanningHintsSchema>;
const questionSchema = z.object({
  id: legalIdentifierSchema,
  question: z.string().trim().min(1).max(8_000),
  contextualQuestion: z.string().trim().min(1).max(900).optional(),
  priorUserQuestions: z.array(z.string().trim().min(1).max(8_000)).max(6).optional(),
  planningHints: targetQuestionPlanningHintsSchema.optional(),
  applicableAt: utcInstantSchema.optional(),
}).strict();
const requirementSchema = z.object({
  id: legalIdentifierSchema,
  statement: z.string().trim().min(1).max(1_000),
  priority: z.enum(["core", "supporting"]).optional(),
  scopeKind: legalCoverageScopeSchema.optional(),
  origin: legalRequirementOriginSchema.optional(),
  unresolvedDimensions: unresolvedQuestionDimensionsSchema.optional(),
  questionContext: userQuestionContextSchema.optional(),
}).strict();
const readingSchema = z.object({
  id: legalIdentifierSchema,
  statement: z.string().trim().min(1).max(1_500),
  requirements: z.array(requirementSchema).min(1).max(LEGAL_EXPANDED_REQUIREMENT_LIMIT),
}).strict();
const formulationSchema = z.object({
  id: legalIdentifierSchema,
  text: z.string().trim().min(1).max(900),
  legalTitleSpans: z.array(z.string().trim().min(3).max(300)).max(12).optional(),
  privateNameSpans: z.array(z.string().trim().min(1).max(300)).max(24),
  readingIds: z.array(legalIdentifierSchema).min(1),
  requirementIds: z.array(legalIdentifierSchema).min(1),
  kind: z.enum(["exact", "legal_register", "cross_language", "repair"]),
}).strict();
const missingCaseFactSchema = z.object({
  id: legalIdentifierSchema,
  question: z.string().trim().min(1).max(1_000),
  material: z.boolean(),
}).strict();
const temporalEndpointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current") }).strict(),
  z.object({ kind: z.literal("timestamp"), instant: utcInstantSchema }).strict(),
]);
const comparisonScopeSchema = z.object({
  left: temporalEndpointSchema,
  right: temporalEndpointSchema,
}).strict();
export const questionInterpretationPlanSchema = z.object({
  relationship: questionRelationshipSchema.optional(),
  questionAccounting: questionAccountingSchema.optional(),
  id: legalIdentifierSchema,
  originalLanguage: z.string().trim().min(2).max(35),
  answerLanguage: z.string().trim().min(2).max(35),
  readings: z.array(readingSchema).min(1).max(12),
  formulations: z.array(formulationSchema).min(1).max(64),
  missingCaseFacts: z.array(missingCaseFactSchema).max(20),
  temporalEndpoint: temporalEndpointSchema.optional(),
  comparison: comparisonScopeSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.temporalEndpoint && value.comparison) {
    context.addIssue({ code: "custom", message: "Choose one endpoint or a comparison" });
  }
});

export type QuestionInterpretationPlan = z.infer<typeof questionInterpretationPlanSchema>;
export function parseQuestionInterpretationPlan(value: unknown): QuestionInterpretationPlan {
  return questionInterpretationPlanSchema.parse(value);
}
export const revalidatedCandidateSchema = z.object({
  candidate: candidateSchema,
  canonicalChunkId: canonicalChunkIdSchema,
  provisionRenditionId: provisionRenditionIdSchema,
  textRevisionId: textRevisionIdSchema,
  provisionConceptId: provisionConceptIdSchema,
  languageFamily: z.enum(["uz", "ru", "en"]),
  textualAuthority: z.enum(["controlling", "official_translation", "unknown"]),
}).strict();
export type RevalidatedCandidate = z.infer<typeof revalidatedCandidateSchema>;
export function parseRevalidatedCandidates(value: unknown): RevalidatedCandidate[] {
  return z.array(revalidatedCandidateSchema).parse(value);
}

export const selectionCandidateSchema = z.object({
  candidate: revalidatedCandidateSchema,
  citationLabel: z.string().trim().min(1).max(2_300),
  provisionText: z.string().trim().min(1).max(MAX_LEGAL_EVIDENCE_CHARACTERS),
}).strict();
export type SelectionCandidate = z.infer<typeof selectionCandidateSchema>;

const repairDecisionSchema = z.object({
  outcome: z.literal("repair"),
  retainedItemKeys: z.array(z.string().min(1).max(700)).max(MAX_LEGAL_EVIDENCE_SOURCES).optional(),
  repairFormulation: formulationSchema,
  additionalRequirements: z.array(z.object({
    readingId: legalIdentifierSchema,
    requirement: requirementSchema,
  }).strict()).max(LEGAL_DISCOVERED_REQUIREMENT_LIMIT).optional(),
}).strict();
const rejectedDecisionSchema = z.object({ outcome: z.literal("rejected") }).strict();
const selectedDecisionSchema = z.object({
  outcome: z.literal("selected"),
  mainPoint: z.string().trim().min(1).max(4_000),
  propositions: z.array(z.object({
    requirementId: legalIdentifierSchema,
    statement: z.string().trim().min(1).max(4_000),
  }).strict()).min(1).max(40),
  selections: z.array(z.object({
    itemKey: z.string().min(1).max(700),
    requirementIds: z.array(legalIdentifierSchema).min(1),
  }).strict()).min(1).max(300),
  whatToDoNext: z.array(z.string().trim().min(1).max(2_000)).max(20),
}).strict();
const partialDecisionSchema = selectedDecisionSchema.extend({
  outcome: z.literal("partial"),
  uncoveredSupportingRequirementIds: z.array(legalIdentifierSchema).min(1),
}).strict();
export const selectionDecisionSchema = z.discriminatedUnion("outcome", [
  repairDecisionSchema,
  rejectedDecisionSchema,
  selectedDecisionSchema,
  partialDecisionSchema,
]);
export type SelectionDecision = z.infer<typeof selectionDecisionSchema>;
export function parseSelectionDecision(value: unknown): SelectionDecision {
  return selectionDecisionSchema.parse(value);
}

const officialCitationSchema = z.object({
  label: z.string().min(1).max(2_300),
  url: z.string().url(),
}).strict();
const lawStatementSchema = z.object({
  evidenceLocator: citationEvidenceLocatorSchema.optional(),
  currentSourceStatus: pinnedSourceStatusSchema.nullable().optional(),
  requirementId: legalIdentifierSchema,
  provisionConceptId: provisionConceptIdSchema,
  provisionRenditionId: provisionRenditionIdSchema,
  proposition: z.string().min(1).max(4_000),
  controllingQuotation: z.string().min(1).max(500_000),
  officialCitations: z.array(officialCitationSchema).min(1),
  evidenceSha256: sha256Schema,
  officialTranslation: z.object({
    label: z.literal("Official Translation"),
    quotation: z.string().min(1).max(500_000),
  }).strict().optional(),
}).strict();
const answerSchema = z.object({
  kind: z.enum(["legal_answer", "conditional_answer"]),
  sourceLadder: z.literal("indexed_official_corpus"),
  mainPoint: z.string().min(1).max(4_000),
  whatTheLawSays: z.array(lawStatementSchema).min(1).max(120),
  whatToDoNext: z.array(z.string().min(1).max(2_000)).max(20),
  focusedQuestions: z.array(z.string().min(1).max(1_000)).max(20),
  formulationsUsed: z.number().int().min(1).max(TARGET_TOTAL_FORMULATION_LIMIT),
  repairQueriesUsed: z.number().int().min(0).max(TARGET_REPAIR_FORMULATION_LIMIT),
  temporalEndpoint: temporalEndpointSchema,
  coverageRequirements: z.array(requirementSchema).max(240).optional(),
}).strict();
const partialAnswerSchema = answerSchema.extend({
  kind: z.literal("partial_legal_answer"),
  nextTier: z.literal("live_official_search"),
  uncoveredSupportingRequirementIds: z.array(legalIdentifierSchema).min(1),
}).strict();
const clarificationSchema = z.object({
  kind: z.literal("clarification_required"),
  sourceLadder: z.literal("indexed_official_corpus"),
  focusedQuestions: z.array(z.string().min(1).max(1_000)).min(1),
  safeErrorCode: z.enum(["FORMULATION_BUDGET_EXCEEDED", "EVIDENCE_CEILING_EXCEEDED"]),
  coverageRequirements: z.array(requirementSchema).max(240).optional(),
}).strict();
const sourceUnavailableSchema = z.object({
  kind: z.literal("source_unavailability"),
  sourceLadder: z.literal("indexed_official_corpus"),
  nextTier: z.literal("live_official_search"),
  discoveredOfficialUrls: z.array(z.string().url()).max(12).optional(),
  coverageRequirements: z.array(requirementSchema).max(240).optional(),
  safeErrorCode: z.enum([
    "QUESTION_INTERPRETATION_UNAVAILABLE",
    "INDEXED_CANDIDATE_UNAVAILABLE",
    "INDEXED_REVALIDATION_FAILED",
    "INDEXED_EVIDENCE_UNAVAILABLE",
    "INDEXED_EVIDENCE_CONTEXT_EXCEEDED",
  ]),
}).strict();
const insufficientSchema = z.object({
  kind: z.literal("insufficient_indexed_coverage"),
  sourceLadder: z.literal("indexed_official_corpus"),
  nextTier: z.literal("live_official_search"),
  uncoveredRequirementIds: z.array(legalIdentifierSchema),
  discoveredOfficialUrls: z.array(z.string().url()).max(12).optional(),
  coverageRequirements: z.array(requirementSchema).max(240).optional(),
}).strict();
const lineageSchema = z.object({
  id: legalIdentifierSchema,
  predecessorConceptId: provisionConceptIdSchema,
  successorConceptId: provisionConceptIdSchema.nullable(),
  transition: z.enum([
    "unchanged",
    "modified",
    "renumbered",
    "moved",
    "split",
    "merged",
    "repealed",
  ]),
  evidenceUrl: z.string().url(),
  reviewState: z.literal("accepted"),
}).strict();
const comparisonAnswerSchema = z.object({
  kind: z.literal("comparison_answer"),
  sourceLadder: z.literal("indexed_official_corpus"),
  temporalScope: comparisonScopeSchema.extend({ kind: z.literal("comparison") }).strict(),
  left: answerSchema,
  right: answerSchema,
  transitions: z.array(lineageSchema).min(1).max(144),
  mainPoint: z.string().min(1).max(8_000),
  endpointFormulationSearches: z.number().int().min(2)
    .max(TARGET_TOTAL_FORMULATION_LIMIT * 2),
}).strict();
const retrievalResultSchema = z.discriminatedUnion("kind", [
  answerSchema,
  partialAnswerSchema,
  comparisonAnswerSchema,
  clarificationSchema,
  sourceUnavailableSchema,
  insufficientSchema,
]);

export type TargetLegalAnswerResult = z.infer<typeof retrievalResultSchema>;
export type TargetLegalAnswerRetriever = {
  answer(input: z.input<typeof questionSchema>): Promise<TargetLegalAnswerResult>;
};

type Dependencies = {
  onReleaseResolved?: (releaseId: string) => void;
  verifyCurrentSource?: (evidence: ResolvedOfficialEvidence) => Promise<PinnedSourceStatus>;
  environment: z.infer<typeof legalEnvironmentSchema>;
  now?: () => number;
  interpreter: {
    interpret(input: {
      question: string;
      priorUserQuestions: string[];
    }): Promise<QuestionInterpretationPlan>;
  };
  releaseResolver: {
    resolve(endpoint: TemporalEndpoint): Promise<PinnedCandidateRelease | null>;
    resolveComparison?(
      left: TemporalEndpoint,
      right: TemporalEndpoint,
    ): Promise<{ left: PinnedCandidateRelease; right: PinnedCandidateRelease } | null>;
  };
  candidateIndex: LegalCandidateIndex;
  candidateCatalog: {
    revalidate(
      packet: CandidatePacket,
      endpoint: TemporalEndpoint,
      release: PinnedCandidateRelease,
      currentAt: string,
    ): Promise<RevalidatedCandidate[]>;
  };
  referenceDiscovery?: (candidates: readonly SelectionCandidate[], endpoint: TemporalEndpoint,
    release: PinnedCandidateRelease, currentAt: string) => Promise<ReferenceDiscoveryResult>;
  evidenceResolver: {
    resolveControlling(
      provisionRenditionId: string,
      endpoint: TemporalEndpoint,
      context: { release: PinnedCandidateRelease; currentAt: string },
    ): Promise<ControllingEvidenceResolution>;
  };
  provisionSelector: {
    select(input: {
      plan: QuestionInterpretationPlan;
      candidates: SelectionCandidate[];
      repairAttempted: boolean;
    }): Promise<SelectionDecision>;
  };
  lineageResolver?: {
    resolve(leftConceptIds: string[], rightConceptIds: string[]): Promise<z.input<typeof lineageSchema>[]>;
  };
};

const MAX_SELECTION_CANDIDATES = 48;
export const TARGET_SUPPORT_CANDIDATE_LIMIT = MAX_SELECTION_CANDIDATES + 12;
export const TARGET_SELECTION_REQUEST_BYTE_LIMIT = 400_000;
const MAX_SELECTION_CANDIDATES_PER_FORMULATION = 8;

export function createTargetLegalAnswerClient(input: {
  service: Fetcher;
  environment: z.infer<typeof legalEnvironmentSchema>;
  signal?: AbortSignal;
  onExecutionObserved?: (observation: ServiceExecutionObservation | null) => void;
}) {
  return {
    async answer(question: z.input<typeof questionSchema>): Promise<TargetLegalAnswerResult> {
      const parsedQuestion = questionSchema.safeParse(question);
      if (!parsedQuestion.success) {
        console.warn(JSON.stringify({ event: "legal_target_client_failed", stage: "request_validation",
          issues: parsedQuestion.error.issues.map(issue => ({ code: issue.code, path: issue.path })) }));
        throw parsedQuestion.error;
      }
      const response = await Promise.resolve().then(() => input.service.fetch(
        `http://legal-corpus.internal${TARGET_LEGAL_ANSWER_PATH}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-service-binding": SERVICE_BINDING_MARKER,
            "x-juro-legal-environment": input.environment,
            "x-juro-target-answer-contract": TARGET_LEGAL_ANSWER_CONTRACT_VERSION,
          },
          body: JSON.stringify(parsedQuestion.data),
          signal: input.signal,
        },
      )).catch(error => {
        console.warn(JSON.stringify({ event: "legal_target_client_failed", stage: "service_fetch",
          errorName: error instanceof Error ? error.name : "unknown" }));
        throw error;
      });
      if (!response.ok) {
        console.warn(JSON.stringify({ event: "legal_target_client_failed", stage: "service_response", status: response.status }));
        throw new TypeError("TARGET_LEGAL_ANSWER_UNAVAILABLE");
      }
      if (response.headers.get("x-juro-target-answer-contract") !== TARGET_LEGAL_ANSWER_CONTRACT_VERSION) {
        console.warn(JSON.stringify({event: "legal_target_client_failed", stage: "service_contract",
          requiredVersion: TARGET_LEGAL_ANSWER_CONTRACT_VERSION,
          receivedVersion: response.headers.get("x-juro-target-answer-contract")}));
        throw new TypeError("TARGET_LEGAL_ANSWER_CONTRACT_UNAVAILABLE");
      }
      const result = z.object({ result: retrievalResultSchema }).strict().parse(await response.json()).result;
      readExecutionDiagnostic(() => input.onExecutionObserved?.(
        parseRuntimeExecutionHeader(response.headers.get("x-juro-runtime-execution"), parsedQuestion.data.id)), undefined);
      return result;
    },
  };
}
