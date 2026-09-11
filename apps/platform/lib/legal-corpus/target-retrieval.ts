import { z } from "zod";
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
const observeTargetExecution = createRuntimeExecutionObserver();
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

export function planFromQuestionPlanningHints(
  id: string,
  untrustedHints: TargetQuestionPlanningHints,
): QuestionInterpretationPlan {
  const hints = targetQuestionPlanningHintsSchema.parse(untrustedHints);
  const requirements = hints.requirements.map((requirement, index) => ({
    id: `requirement-${index + 1}`,
    ...requirement,
  }));
  const requirementIds = requirements.map((requirement) => requirement.id);
  const hasOneFormulationPerRequirement = hints.formulations.length === requirements.length;
  return questionInterpretationPlanSchema.parse({
    relationship: hints.relationship,
    questionAccounting: hints.questionAccounting,
    id: `plan-${id}`.slice(0, 200),
    originalLanguage: hints.answerLanguage,
    answerLanguage: hints.answerLanguage,
    readings: [{
      id: "reading-1",
      statement: hints.standaloneQuestion,
      requirements,
    }],
    formulations: hints.formulations.map((text, index) => ({
      id: `formulation-${index + 1}`,
      text,
      legalTitleSpans: [],
      privateNameSpans: [],
      readingIds: ["reading-1"],
      requirementIds: hints.formulationRequirementIndexes
        ? hints.formulationRequirementIndexes[index]!.map(requirementIndex => requirements[requirementIndex]!.id)
        : hasOneFormulationPerRequirement
        ? [requirements[index]!.id]
        : requirementIds,
      kind: "legal_register" as const,
    })),
    missingCaseFacts: (hints.missingFacts ?? []).map((question, index) => ({id: `missing-fact-${index + 1}`, question, material: true})),
    ...(hints.temporalEndpoint ? {temporalEndpoint: hints.temporalEndpoint} : {}),
    ...(hints.comparison ? {comparison: hints.comparison} : {}),
  });
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
    release: PinnedCandidateRelease, currentAt: string) => Promise<RevalidatedCandidate[]>;
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

function requirementInventory(plan: QuestionInterpretationPlan): {
  readingIds: Set<string>;
  requirementIds: Set<string>;
  requirementReading: Map<string, string>;
} | null {
  const readingIds = new Set<string>();
  const requirementIds = new Set<string>();
  const requirementReading = new Map<string, string>();
  for (const reading of plan.readings) {
    if (readingIds.has(reading.id)) return null;
    readingIds.add(reading.id);
    for (const requirement of reading.requirements) {
      if (requirementIds.has(requirement.id)) return null;
      requirementIds.add(requirement.id);
      requirementReading.set(requirement.id, reading.id);
    }
  }
  return { readingIds, requirementIds, requirementReading };
}

function formulationsRespectPlan(
  plan: QuestionInterpretationPlan,
  formulations: readonly z.infer<typeof formulationSchema>[],
): boolean {
  const inventory = requirementInventory(plan);
  if (!inventory) return false;
  const readingCounts = new Map([...inventory.readingIds].map((id) => [id, 0]));
  for (const formulation of formulations) {
    const readingIds = [...new Set(formulation.readingIds)];
    const requirementIds = [...new Set(formulation.requirementIds)];
    if (
      readingIds.some((id) => !inventory.readingIds.has(id))
      || requirementIds.some((id) => !inventory.requirementIds.has(id))
      || requirementIds.some((id) => !readingIds.includes(inventory.requirementReading.get(id)!))
    ) return false;
    const createsSecond = readingIds.some((id) => (readingCounts.get(id) ?? 0) > 0);
    if (createsSecond && [...readingCounts.values()].some((count) => count === 0)) return false;
    readingIds.forEach((id) => readingCounts.set(id, (readingCounts.get(id) ?? 0) + 1));
  }
  return [...readingCounts.values()].every((count) => count > 0);
}

function candidateInterpretation(
  plan: QuestionInterpretationPlan,
  formulations: readonly z.infer<typeof formulationSchema>[],
) {
  return {
    id: plan.id,
    formulations: formulations.map(({
      id, text, legalTitleSpans, privateNameSpans, readingIds, requirementIds,
    }) => ({
      id,
      text,
      legalTitleSpans,
      privateNameSpans,
      readingIds,
      requirementIds,
    })),
  };
}

function insufficient(plan: QuestionInterpretationPlan, covered = new Set<string>()): TargetLegalAnswerResult {
  return insufficientSchema.parse({
    kind: "insufficient_indexed_coverage",
    sourceLadder: "indexed_official_corpus",
    nextTier: "live_official_search",
    coverageRequirements: plan.readings.flatMap(reading => reading.requirements),
    uncoveredRequirementIds: plan.readings
      .flatMap((reading) => reading.requirements)
      .map((requirement) => requirement.id)
      .filter((id) => !covered.has(id)),
  });
}

function sourceUnavailable(
  safeErrorCode: z.infer<typeof sourceUnavailableSchema>["safeErrorCode"],
): TargetLegalAnswerResult {
  return sourceUnavailableSchema.parse({
    kind: "source_unavailability",
    sourceLadder: "indexed_official_corpus",
    nextTier: "live_official_search",
    safeErrorCode,
  });
}

function stableCandidateIdentity(entry: RevalidatedCandidate): string {
  return [
    entry.canonicalChunkId,
    entry.provisionRenditionId,
    entry.textRevisionId,
    entry.provisionConceptId,
    entry.languageFamily,
    entry.textualAuthority,
  ].join("\u001f");
}

function mergeCandidateCoverage(
  preferred: RevalidatedCandidate,
  other: RevalidatedCandidate,
): RevalidatedCandidate {
  return {
    ...preferred,
    candidate: {
      ...preferred.candidate,
      formulationIds: [...new Set([
        ...preferred.candidate.formulationIds,
        ...other.candidate.formulationIds,
      ])].sort(),
      ...((preferred.candidate.formulationMatches || other.candidate.formulationMatches) ? {
        formulationMatches: [...new Map([
          ...(preferred.candidate.formulationMatches ?? []),
          ...(other.candidate.formulationMatches ?? []),
        ].map((match) => [match.formulationId, match])).values()].sort((left, right) =>
          left.formulationId.localeCompare(right.formulationId)),
      } : {}),
      readingIds: [...new Set([
        ...preferred.candidate.readingIds,
        ...other.candidate.readingIds,
      ])].sort(),
      retrievalRequirementIds: [...new Set([
        ...preferred.candidate.retrievalRequirementIds,
        ...other.candidate.retrievalRequirementIds,
      ])].sort(),
    },
  };
}

const MAX_SELECTION_CANDIDATES = 48;
export const TARGET_SUPPORT_CANDIDATE_LIMIT = MAX_SELECTION_CANDIDATES + 12;
export const TARGET_SELECTION_REQUEST_BYTE_LIMIT = 400_000;
const MAX_SELECTION_CANDIDATES_PER_FORMULATION = 8;

function assertAssessmentContext(input: {plan: QuestionInterpretationPlan; candidates: SelectionCandidate[]; repairAttempted: boolean}): void {
  selectionAssessmentBatches(input.candidates, SELECTION_ASSESSMENT_BATCH_SIZE);
  if (new TextEncoder().encode(JSON.stringify(input)).byteLength > TARGET_SELECTION_REQUEST_BYTE_LIMIT) {
    throw new SelectionEvidenceContextError();
  }
}

function candidateScore(entry: RevalidatedCandidate): number {
  return entry.candidate.fusionScore
    + entry.candidate.vectorScore / 1_000
    + entry.candidate.keywordScore / 1_000_000;
}

/** Bounds pre-selection evidence while retaining candidates from every
 * formulation. The associations here are retrieval provenance only. */
export function boundedSelectionPool(candidates: readonly RevalidatedCandidate[], retainedItemKeys: readonly string[] = []): RevalidatedCandidate[] {
  if (retainedItemKeys.length > MAX_LEGAL_EVIDENCE_SOURCES) throw new RangeError("RETAINED_EVIDENCE_CEILING_EXCEEDED");
  const ranked = [...candidates].sort((left, right) =>
    candidateScore(right) - candidateScore(left)
    || left.candidate.itemKey.localeCompare(right.candidate.itemKey));
  const selected = new Map<string, RevalidatedCandidate>();
  const retained = new Set(retainedItemKeys);
  for (const candidate of ranked) {
    if (retained.has(candidate.candidate.itemKey)) selected.set(candidate.provisionRenditionId, candidate);
  }
  const formulationIds = [...new Set(candidates.flatMap((candidate) =>
    candidate.candidate.formulationIds))].sort();
  const nextPosition = new Map(formulationIds.map((id) => [id, 0]));
  const rankedByFormulation = new Map(formulationIds.map((formulationId) => [
    formulationId,
    candidates.filter((candidate) =>
      candidate.candidate.formulationIds.includes(formulationId)).sort((left, right) => {
      const leftMatch = left.candidate.formulationMatches?.find((match) =>
        match.formulationId === formulationId);
      const rightMatch = right.candidate.formulationMatches?.find((match) =>
        match.formulationId === formulationId);
      return (leftMatch?.rank ?? left.candidate.vectorRank)
        - (rightMatch?.rank ?? right.candidate.vectorRank)
        || (rightMatch?.fusionScore ?? candidateScore(right))
          - (leftMatch?.fusionScore ?? candidateScore(left))
        || left.candidate.itemKey.localeCompare(right.candidate.itemKey);
    }),
  ]));
  for (let contribution = 0;
    contribution < MAX_SELECTION_CANDIDATES_PER_FORMULATION;
    contribution += 1) {
    for (const formulationId of formulationIds) {
      if (selected.size >= MAX_SELECTION_CANDIDATES) break;
      const formulationRanked = rankedByFormulation.get(formulationId) ?? [];
      let position = nextPosition.get(formulationId) ?? 0;
      while (position < formulationRanked.length
        && selected.has(formulationRanked[position]!.provisionRenditionId)) position += 1;
      nextPosition.set(formulationId, position + 1);
      const candidate = formulationRanked[position];
      if (candidate) {
        selected.set(candidate.provisionRenditionId, candidate);
      }
    }
  }
  for (const candidate of ranked) {
    if (selected.size >= MAX_SELECTION_CANDIDATES) break;
    if (!selected.has(candidate.provisionRenditionId)) {
      selected.set(candidate.provisionRenditionId, candidate);
    }
  }
  return [...selected.values()];
}

function emitTargetStageFailure(stage: string, code: string, error?: unknown): void {
  console.warn(JSON.stringify({
    event: "legal_target_stage_failed",
    stage,
    safeErrorCode: code,
    errorName: error instanceof Error ? error.name : "unknown",
  }));
}

function mergeRevalidatedCandidates(
  packets: readonly RevalidatedCandidate[][],
): RevalidatedCandidate[] | null {
  let entries: RevalidatedCandidate[];
  try {
    entries = parseRevalidatedCandidates(packets.flat());
  } catch {
    return null;
  }
  const merged = new Map<string, RevalidatedCandidate>();
  const identityByItemKey = new Map<string, string>();
  for (const entry of entries) {
    const identity = stableCandidateIdentity(entry);
    const knownIdentity = identityByItemKey.get(entry.candidate.itemKey);
    if (knownIdentity && knownIdentity !== identity) return null;
    identityByItemKey.set(entry.candidate.itemKey, identity);
    const existing = merged.get(identity);
    if (!existing) merged.set(identity, entry);
    else if (entry.candidate.fusionScore > existing.candidate.fusionScore) {
      merged.set(identity, mergeCandidateCoverage(entry, existing));
    } else merged.set(identity, mergeCandidateCoverage(existing, entry));
  }
  return [...merged.values()].sort((left, right) =>
    right.candidate.fusionScore - left.candidate.fusionScore
    || left.candidate.itemKey.localeCompare(right.candidate.itemKey));
}

export function createTargetLegalAnswerRetriever(dependencies: Dependencies): TargetLegalAnswerRetriever {
  const environment = legalEnvironmentSchema.parse(dependencies.environment);
  return {
    async answer(untrustedInput) {
      const currentChecks = new Map<string, Promise<PinnedSourceStatus | null>>();
      let drainCurrentChecks = async () => { await Promise.all(currentChecks.values()); };
      const sourceStatusKey = (evidence: ResolvedOfficialEvidence) =>
        JSON.stringify([evidence.officialCitation.url, evidence.evidence.sourceNormalizedSha256]);
      try {
      const currentAt = new Date((dependencies.now ?? Date.now)()).toISOString();
      const request = questionSchema.parse(untrustedInput);
      const correlationBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(request.id));
      const correlationHash = [...new Uint8Array(correlationBytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
      const timed = async <T>(stage: string, operation: () => Promise<T>): Promise<T> => {
        const started = Date.now();
        let outcome: "completed" | "failed" | "unavailable" = "failed";
        try {
          const result = await operation();
          outcome = typeof result === "object" && result !== null && "availability" in result
            && result.availability !== "available" ? "unavailable" : "completed";
          return result;
        } finally {
          console.info(JSON.stringify({event: "legal_target_stage_finished", stage, correlationHash,
            outcome, safeErrorCode: outcome === "unavailable" ? "INDEXED_CANDIDATE_UNAVAILABLE"
              : outcome === "failed" ? "TARGET_STAGE_FAILED" : null,
            callCount: 1, elapsedMs: Date.now() - started}));
        }
      };
      let plan: QuestionInterpretationPlan;
      drainCurrentChecks = () => timed("source_observation_drain", async () => {
        await Promise.all(currentChecks.values());
      });
      try {
        plan = request.planningHints
          ? planFromQuestionPlanningHints(request.id, request.planningHints)
          : questionInterpretationPlanSchema.parse(await dependencies.interpreter.interpret({
              question: request.contextualQuestion ?? request.question,
              priorUserQuestions: request.priorUserQuestions ?? [],
            }));
        if (request.applicableAt) {
          plan = questionInterpretationPlanSchema.parse({
            ...plan,
            temporalEndpoint: { kind: "timestamp", instant: request.applicableAt },
            comparison: undefined,
          });
        }
      } catch {
        return sourceUnavailable("QUESTION_INTERPRETATION_UNAVAILABLE");
      }
      if (
        plan.formulations.length > TARGET_INITIAL_FORMULATION_LIMIT
        || !formulationsRespectPlan(plan, plan.formulations)
      ) {
        return {...sourceUnavailable("QUESTION_INTERPRETATION_UNAVAILABLE"),
          coverageRequirements: plan.readings.flatMap(reading => reading.requirements)};
      }
      if (plan.comparison) {
        const { comparison, temporalEndpoint, ...sharedPlan } = plan;
        void temporalEndpoint;
        let pinned: { left: PinnedCandidateRelease; right: PinnedCandidateRelease } | null = null;
        if (dependencies.releaseResolver.resolveComparison) {
          try {
            pinned = await dependencies.releaseResolver.resolveComparison(comparison.left, comparison.right);
          } catch {
            return sourceUnavailable("INDEXED_CANDIDATE_UNAVAILABLE");
          }
          if (!pinned) return sourceUnavailable("INDEXED_CANDIDATE_UNAVAILABLE");
        }
        const runEndpoint = async (endpoint: TemporalEndpoint, release?: PinnedCandidateRelease) =>
          createTargetLegalAnswerRetriever({
          ...dependencies,
          now: () => Date.parse(currentAt),
          releaseResolver: release ? { resolve: async () => release } : dependencies.releaseResolver,
          interpreter: {
            interpret: async () => ({ ...sharedPlan, temporalEndpoint: endpoint }),
          },
        }).answer({ ...request, planningHints: undefined, applicableAt: undefined });
        const left = await runEndpoint(comparison.left, pinned?.left);
        if (left.kind !== "legal_answer" && left.kind !== "conditional_answer") {
          return left;
        }
        const right = await runEndpoint(comparison.right, pinned?.right);
        if (right.kind !== "legal_answer" && right.kind !== "conditional_answer") {
          return right;
        }
        if (!dependencies.lineageResolver) {
          return sourceUnavailable("INDEXED_REVALIDATION_FAILED");
        }
        let transitions: z.infer<typeof lineageSchema>[];
        const leftConceptIds = [...new Set(left.whatTheLawSays
          .map((statement) => statement.provisionConceptId))];
        const rightConceptIds = [...new Set(right.whatTheLawSays
          .map((statement) => statement.provisionConceptId))];
        try {
          transitions = z.array(lineageSchema).min(1).max(144).parse(
            await dependencies.lineageResolver.resolve(
              leftConceptIds,
              rightConceptIds,
            ),
          );
          const leftSet = new Set(leftConceptIds);
          const rightSet = new Set(rightConceptIds);
          const selectedConcepts = new Set([...leftConceptIds, ...rightConceptIds]);
          const touched = new Set<string>();
          for (const transition of transitions) {
            const connectsEndpoints = transition.successorConceptId !== null
              && ((leftSet.has(transition.predecessorConceptId)
                && rightSet.has(transition.successorConceptId))
                || (rightSet.has(transition.predecessorConceptId)
                  && leftSet.has(transition.successorConceptId)));
            const isSelectedRepeal = transition.transition === "repealed"
              && transition.successorConceptId === null
              && selectedConcepts.has(transition.predecessorConceptId);
            if (!connectsEndpoints && !isSelectedRepeal) throw new TypeError("UNRELATED_LINEAGE");
            touched.add(transition.predecessorConceptId);
            if (transition.successorConceptId) touched.add(transition.successorConceptId);
          }
          if ([...selectedConcepts].some((conceptId) => !touched.has(conceptId))) {
            throw new TypeError("INCOMPLETE_LINEAGE");
          }
        } catch {
          return sourceUnavailable("INDEXED_REVALIDATION_FAILED");
        }
        return comparisonAnswerSchema.parse({
          kind: "comparison_answer",
          sourceLadder: "indexed_official_corpus",
          temporalScope: { kind: "comparison", ...comparison },
          left,
          right,
          transitions,
          mainPoint: `${left.mainPoint} ${right.mainPoint}`,
          endpointFormulationSearches: left.formulationsUsed + right.formulationsUsed,
        });
      }
      const endpoint = plan.temporalEndpoint ?? { kind: "current" } as const;
      const release = await dependencies.releaseResolver.resolve(endpoint);
      const requiredCapability = endpoint.kind === "current" ? "current" : "history";
      if (!release || release.environment !== environment || release.capability !== requiredCapability) {
        return insufficient(plan);
      }
      readExecutionDiagnostic(() => dependencies.onReleaseResolved?.(release.id), undefined);

      const validatedPackets: RevalidatedCandidate[][] = [];
      let initialPacket: CandidatePacket;
      try {
        initialPacket = await timed("initial_search", () => dependencies.candidateIndex.retrieve(
          candidateInterpretation(plan, plan.formulations),
          endpoint,
          release,
          { currentAt },
        ));
      } catch {
        emitTargetStageFailure("candidate_retrieval", "INDEXED_CANDIDATE_UNAVAILABLE");
        return sourceUnavailable("INDEXED_CANDIDATE_UNAVAILABLE");
      }
      if (initialPacket.availability !== "available") {
        return sourceUnavailable("INDEXED_CANDIDATE_UNAVAILABLE");
      }
      try {
        validatedPackets.push(await timed("initial_revalidation", () => dependencies.candidateCatalog.revalidate(
          initialPacket,
          endpoint,
          release,
          currentAt,
        )));
      } catch {
        emitTargetStageFailure("candidate_revalidation", "INDEXED_REVALIDATION_FAILED");
        return sourceUnavailable("INDEXED_REVALIDATION_FAILED");
      }
      let candidates = mergeRevalidatedCandidates(validatedPackets);
      if (!candidates) {
        return sourceUnavailable("INDEXED_REVALIDATION_FAILED");
      }
      if (candidates.length === 0) return insufficient(plan);

      const evidenceByRendition = new Map<string, ControllingEvidenceResolution>();
      const referenceKeys = new Set<string>();
      const referenceArticles = new Map<string, string>();
      let retainedItemKeys: string[] = [];
      const discoveredLocations = () => [...new Set([...evidenceByRendition.values()]
        .map(evidence => evidence.controlling.officialCitation.url))].slice(0, 12);
      const unavailableWithDiscovery = (code: z.infer<typeof sourceUnavailableSchema>["safeErrorCode"]) =>
        sourceUnavailableSchema.parse({ ...sourceUnavailable(code), discoveredOfficialUrls: discoveredLocations(),
          coverageRequirements: plan.readings.flatMap(reading => reading.requirements) });
      const hydrateSelectionCandidates = async (): Promise<SelectionCandidate[]> => {
        const base = boundedSelectionPool(candidates!.filter(candidate => !candidate.candidate.referenceOrigin), retainedItemKeys);
        const pool = [...base, ...candidates!.filter(candidate => referenceKeys.has(candidate.candidate.itemKey)
          && !base.some(item => item.provisionRenditionId === candidate.provisionRenditionId))];
        if (pool.length > TARGET_SUPPORT_CANDIDATE_LIMIT) throw new TypeError("REFERENCE_EVIDENCE_CEILING_EXCEEDED");
        const failureCodes = new Map<string, number>();
        const hydrated = await Promise.all(pool.map(async (candidate) => {
          try {
            let evidence = evidenceByRendition.get(candidate.provisionRenditionId);
            if (!evidence) {
              evidence = await dependencies.evidenceResolver.resolveControlling(
                candidate.provisionRenditionId,
                endpoint,
                { release, currentAt },
              );
              evidenceByRendition.set(candidate.provisionRenditionId, evidence);
              const key = sourceStatusKey(evidence.controlling);
              if (endpoint.kind === "current" && dependencies.verifyCurrentSource
                && !currentChecks.has(key) && currentChecks.size < MAX_LEGAL_EVIDENCE_SOURCES) {
                currentChecks.set(key, dependencies.verifyCurrentSource(evidence.controlling).catch(() => null));
              }
            }
            const expectedArticle = referenceArticles.get(candidate.candidate.itemKey);
            if (expectedArticle && /(?:Article|Статья|Ст\.)\s+(\d+(?:[.-]\d+)?)\s*$/iu.exec(
              evidence.materialCitation.label)?.[1] !== expectedArticle) {
              failureCodes.set("REFERENCE_ARTICLE_MISMATCH", (failureCodes.get("REFERENCE_ARTICLE_MISMATCH") ?? 0) + 1);
              return null;
            }
            const provisionText = (evidence.articleContext ?? evidence.controlling).provisionText;
            if (provisionText.length > MAX_LEGAL_EVIDENCE_CHARACTERS) throw new SelectionEvidenceContextError();
            return selectionCandidateSchema.parse({
              candidate,
              citationLabel: evidence.materialCitation.label,
              provisionText,
            });
          } catch (error) {
            if (!(error instanceof LegalEvidenceError) || error.code !== "SOURCE_UNAVAILABILITY") {
              throw error;
            }
            const code = error && typeof error === "object" && "code" in error
              && typeof error.code === "string" ? error.code : "unknown";
            failureCodes.set(code, (failureCodes.get(code) ?? 0) + 1);
            return null;
          }
        }));
        const verified = hydrated.filter((candidate): candidate is SelectionCandidate => candidate !== null);
        if (verified.length !== pool.length) {
          console.warn(JSON.stringify({
            event: "legal_target_evidence_candidates_dropped",
            candidateCount: pool.length,
            droppedCount: pool.length - verified.length,
            failureCodes: [...failureCodes].map(([code, count]) => ({ code, count })),
          }));
        }
        if (verified.length === 0) throw new TypeError("NO_VERIFIED_SELECTION_CANDIDATES");
        return verified;
      };

      let decision: SelectionDecision;
      try {
        let hydrated = await timed("initial_evidence", hydrateSelectionCandidates);
        if (dependencies.referenceDiscovery) {
          let references: RevalidatedCandidate[] = [];
          try {
            references = await timed("reference_discovery", () => dependencies.referenceDiscovery!(hydrated, endpoint, release, currentAt));
            if (references.length > 12) throw new TypeError("REFERENCE_EVIDENCE_CEILING_EXCEEDED");
          } catch {
            // Optional discovery never substitutes unvalidated reference text.
            // Missing operative evidence can still trigger bounded repair.
            console.warn(JSON.stringify({event: "legal.reference_discovery_unavailable"}));
            references = [];
          }
          if (references.length) {
            validatedPackets.push(references);
            references.forEach(candidate => {
              referenceKeys.add(candidate.candidate.itemKey);
              if (candidate.candidate.referenceOrigin) referenceArticles.set(candidate.candidate.itemKey,
                candidate.candidate.referenceOrigin.article);
            });
            candidates = mergeRevalidatedCandidates(validatedPackets);
            if (!candidates) return unavailableWithDiscovery("INDEXED_REVALIDATION_FAILED");
            hydrated = await timed("reference_evidence", hydrateSelectionCandidates);
          }
        }
        assertAssessmentContext({plan, candidates: hydrated, repairAttempted: false});
        decision = selectionDecisionSchema.parse(await timed("initial_support", () => dependencies.provisionSelector.select({
          plan,
          candidates: hydrated,
          repairAttempted: false,
        })));
      } catch (error) {
        const code = error instanceof SelectionEvidenceContextError ? "INDEXED_EVIDENCE_CONTEXT_EXCEEDED" : "INDEXED_REVALIDATION_FAILED";
        emitTargetStageFailure("requirement_support", code, error);
        return unavailableWithDiscovery(code);
      }
      let repairQueriesUsed = 0;
      if (decision.outcome === "repair") {
        retainedItemKeys = decision.retainedItemKeys ?? [];
        if (retainedItemKeys.some(key => !candidates!.some(candidate => candidate.candidate.itemKey === key))) {
          return unavailableWithDiscovery("INDEXED_REVALIDATION_FAILED");
        }
        if (decision.additionalRequirements?.length) {
          const existingRequirementIds = new Set(plan.readings.flatMap((reading) =>
            reading.requirements.map((requirement) => requirement.id)));
          const additionsByReading = new Map<string, typeof decision.additionalRequirements>();
          for (const addition of decision.additionalRequirements) {
            if (existingRequirementIds.has(addition.requirement.id)
              || !plan.readings.some((reading) => reading.id === addition.readingId)) {
              return sourceUnavailable("INDEXED_REVALIDATION_FAILED");
            }
            existingRequirementIds.add(addition.requirement.id);
            const additions = additionsByReading.get(addition.readingId) ?? [];
            additions.push(addition);
            additionsByReading.set(addition.readingId, additions);
          }
          plan = questionInterpretationPlanSchema.parse({
            ...plan,
            readings: plan.readings.map((reading) => ({
              ...reading,
              requirements: [
                ...reading.requirements,
                ...(additionsByReading.get(reading.id) ?? []).map(({ requirement }) => requirement),
              ],
            })),
          });
        }
        if (decision.repairFormulation.kind !== "repair"
          || !formulationsRespectPlan(plan, [...plan.formulations, decision.repairFormulation])) return insufficient(plan);
        const repair = decision.repairFormulation;
        const repairRequirementIds = [...new Set(repair.requirementIds)];
        if (repairRequirementIds.length > TARGET_REPAIR_FORMULATION_LIMIT) return insufficient(plan);
        const repairFormulations = repairRequirementIds.length === 1 ? [repair]
          : repairRequirementIds.map((requirementId, index) => {
            const reading = plan.readings.find((item) => item.requirements.some((requirement) => requirement.id === requirementId))!;
            const text = reading.requirements.find((requirement) => requirement.id === requirementId)!.statement.slice(0, 900);
            return { ...repair, id: `${repair.id.slice(0, 195)}-${index + 1}`, text,
              readingIds: [reading.id], requirementIds: [requirementId],
              privateNameSpans: repair.privateNameSpans.filter((span) => text.includes(span)),
              legalTitleSpans: repair.legalTitleSpans?.filter((span) => text.includes(span)) };
          });
        if (plan.formulations.length + repairFormulations.length > TARGET_TOTAL_FORMULATION_LIMIT) return insufficient(plan);
        repairQueriesUsed = repairFormulations.length;
        let repairPacket: CandidatePacket;
        try {
          repairPacket = await timed("repair_search", () => dependencies.candidateIndex.retrieve(
            candidateInterpretation(plan, repairFormulations),
            endpoint,
            release,
            { currentAt },
          ));
          if (repairPacket.availability !== "available") {
            return unavailableWithDiscovery("INDEXED_CANDIDATE_UNAVAILABLE");
          }
          validatedPackets.push(await timed("repair_revalidation", () => dependencies.candidateCatalog.revalidate(
            repairPacket,
            endpoint,
            release,
            currentAt,
          )));
        } catch {
          return unavailableWithDiscovery("INDEXED_REVALIDATION_FAILED");
        }
        candidates = mergeRevalidatedCandidates(validatedPackets);
        if (!candidates) {
          return unavailableWithDiscovery("INDEXED_REVALIDATION_FAILED");
        }
        try {
          const hydrated = await timed("repair_evidence", hydrateSelectionCandidates);
          assertAssessmentContext({plan: { ...plan, formulations: [...plan.formulations, ...repairFormulations] },
            candidates: hydrated, repairAttempted: true});
          decision = selectionDecisionSchema.parse(await timed("repair_support", () => dependencies.provisionSelector.select({
            plan: { ...plan, formulations: [...plan.formulations, ...repairFormulations] },
            candidates: hydrated,
            repairAttempted: true,
          })));
        } catch (error) {
          return unavailableWithDiscovery(error instanceof SelectionEvidenceContextError
            ? "INDEXED_EVIDENCE_CONTEXT_EXCEEDED" : "INDEXED_REVALIDATION_FAILED");
        }
      }
      if (decision.outcome !== "selected" && decision.outcome !== "partial") return insufficientSchema.parse({
        ...insufficient(plan),
        // Hash-verified candidate locations are discovery leads, not evidence
        // of coverage. The live tier must fetch and validate them afresh.
        discoveredOfficialUrls: discoveredLocations(),
      });

      const candidateByKey = new Map(candidates.map((entry) => [entry.candidate.itemKey, entry]));
      const selected = decision.selections.flatMap((selection) => {
        const candidate = candidateByKey.get(selection.itemKey);
        return candidate ? [{ candidate, requirementIds: [...new Set(selection.requirementIds)] }] : [];
      });
      const planRequirementIds = new Set(plan.readings.flatMap((reading) =>
        reading.requirements.map((requirement) => requirement.id)));
      if (selected.length !== decision.selections.length
        || selected.some((entry) => entry.requirementIds.some((requirementId) =>
          !planRequirementIds.has(requirementId)))) {
        return sourceUnavailable("INDEXED_REVALIDATION_FAILED");
      }
      const uniqueRenditions = [...new Map(selected.map((entry) => [
        entry.candidate.provisionRenditionId,
        entry.candidate.provisionRenditionId,
      ])).values()];
      if (uniqueRenditions.length > MAX_LEGAL_EVIDENCE_SOURCES) {
        return clarificationSchema.parse({
          kind: "clarification_required",
          sourceLadder: "indexed_official_corpus",
          focusedQuestions: ["Please narrow the question so its complete evidence can fit within the answer context."],
          safeErrorCode: "EVIDENCE_CEILING_EXCEEDED",
          coverageRequirements: plan.readings.flatMap(reading => reading.requirements),
        });
      }
      const requirementIds = planRequirementIds;
      const covered = new Set(selected.flatMap((entry) => entry.requirementIds)
        .filter((id) => requirementIds.has(id)));
      const uncovered = [...requirementIds].filter((id) => !covered.has(id));
      const requirementsById = new Map(plan.readings.flatMap((reading) =>
        reading.requirements.map((requirement) => [requirement.id, requirement] as const)));
      const uncoveredCore = uncovered.filter((id) => requirementsById.get(id)?.priority !== "supporting");
      const uncoveredSupporting = uncovered.filter((id) => requirementsById.get(id)?.priority === "supporting");
      if (uncoveredCore.length > 0) return insufficient(plan, covered);
      if (decision.outcome === "selected" && uncovered.length > 0) {
        return sourceUnavailable("INDEXED_REVALIDATION_FAILED");
      }
      if (decision.outcome === "partial"
        && (uncoveredSupporting.length === 0
          || uncoveredSupporting.some((id) => !decision.uncoveredSupportingRequirementIds.includes(id)))) {
        return sourceUnavailable("INDEXED_REVALIDATION_FAILED");
      }

      try {
        await Promise.all(uniqueRenditions.map(async (id) => {
          if (!evidenceByRendition.has(id)) {
            evidenceByRendition.set(id, await dependencies.evidenceResolver.resolveControlling(
              id, endpoint, { release, currentAt },
            ));
          }
        }));
      } catch {
        return sourceUnavailable("INDEXED_EVIDENCE_UNAVAILABLE");
      }
      // Assessment sees bounded candidate excerpts. Recheck the complete,
      // authenticated text before it can enter the answer context.
      if (!fitsLegalEvidenceBudget(uniqueRenditions.map(id => {
        const evidence = evidenceByRendition.get(id)!;
        return (evidence.articleContext ?? evidence.controlling).provisionText;
      }))) return clarificationSchema.parse({
        kind: "clarification_required",
        sourceLadder: "indexed_official_corpus",
        focusedQuestions: ["Please narrow the question so its complete evidence can fit within the answer context."],
        safeErrorCode: "EVIDENCE_CEILING_EXCEEDED",
        coverageRequirements: plan.readings.flatMap(reading => reading.requirements),
      });
      const propositions = new Map(decision.propositions.map((proposition) => [
        proposition.requirementId,
        proposition.statement,
      ]));
      if ([...covered].some((id) => !propositions.has(id))) return insufficient(plan, covered);
      // Selection may retain a later revision outside the speculative checks.
      // Every selected current revision still requires its authenticated parent.
      const currentStatuses = await timed("source_observation_wait", async () => {
      if (endpoint.kind === "current" && dependencies.verifyCurrentSource) {
        for (let offset = 0; offset < selected.length; offset += 4) {
          await Promise.all(selected.slice(offset, offset + 4).map(async entry => {
            const evidence = evidenceByRendition.get(entry.candidate.provisionRenditionId);
            if (!evidence) return;
            const key = sourceStatusKey(evidence.controlling);
            if (!currentChecks.has(key)) currentChecks.set(key,
              dependencies.verifyCurrentSource!(evidence.controlling).catch(() => null));
            await currentChecks.get(key);
          }));
        }
      }
      return new Map(await Promise.all([...currentChecks].map(async ([url, check]) => [url, await check] as const)));
      });
      const whatTheLawSays = selected.flatMap((entry) => {
        const evidence = evidenceByRendition.get(entry.candidate.provisionRenditionId);
        if (!evidence) return [];
        return entry.requirementIds.flatMap((requirementId) => {
          const proposition = propositions.get(requirementId);
          if (!proposition || !requirementIds.has(requirementId)) return [];
          return [{
            requirementId,
            provisionConceptId: evidence.controlling.provisionConceptId,
            provisionRenditionId: evidence.controlling.provisionRenditionId,
            proposition,
            controllingQuotation: (evidence.articleContext ?? evidence.controlling).provisionText,
            officialCitations: [evidence.materialCitation],
            evidenceSha256: (evidence.articleContext ?? evidence.controlling).evidence.sha256,
            ...(currentStatuses.has(sourceStatusKey(evidence.controlling)) ? {
              currentSourceStatus: currentStatuses.get(sourceStatusKey(evidence.controlling))!,
            } : {}),
            evidenceLocator: {
              version: 1 as const, capability: release.capability,
              kind: evidence.articleContext ? "normalized-article" as const : "provision" as const,
              r2Key: (evidence.articleContext ?? evidence.controlling).evidence.r2Key,
              byteCount: (evidence.articleContext ?? evidence.controlling).evidence.byteCount,
              sha256: (evidence.articleContext ?? evidence.controlling).evidence.sha256,
              officialUrl: evidence.materialCitation.url, languageTag: evidence.controlling.languageTag,
              articleNumber: citationArticleNumber(evidence.materialCitation.label,
                (evidence.articleContext ?? evidence.controlling).provisionText),
            },
            ...(evidence.translation ? {
              officialTranslation: {
                label: "Official Translation" as const,
                quotation: evidence.translation.provisionText,
              },
            } : {}),
          }];
        });
      });
      const materialQuestions = plan.missingCaseFacts
        .filter((fact) => fact.material)
        .map((fact) => fact.question);
      const partial = uncoveredSupporting.length > 0;
      const answer = {
        kind: partial ? "partial_legal_answer" as const
          : materialQuestions.length > 0 ? "conditional_answer" as const : "legal_answer" as const,
        sourceLadder: "indexed_official_corpus",
        mainPoint: decision.mainPoint,
        whatTheLawSays,
        whatToDoNext: decision.whatToDoNext,
        focusedQuestions: materialQuestions,
        formulationsUsed: plan.formulations.length + repairQueriesUsed,
        repairQueriesUsed,
        temporalEndpoint: endpoint,
        coverageRequirements: plan.readings.flatMap(reading => reading.requirements),
        ...(partial ? {
          nextTier: "live_official_search" as const,
          uncoveredSupportingRequirementIds: uncoveredSupporting,
        } : {}),
      };
      return partial ? partialAnswerSchema.parse(answer) : answerSchema.parse(answer);
      } finally {
        // Drain checks even when selection or repair fails; no request-bound
        // fetch is left running after this answer's lifetime.
        await drainCurrentChecks();
      }
    },
  };
}

export async function handleTargetLegalAnswerRequest(
  request: Request,
  input: {
    environment: z.infer<typeof legalEnvironmentSchema>;
    retriever: TargetLegalAnswerRetriever;
    versionId?: string;
    releaseIds?: () => readonly string[];
  },
): Promise<Response> {
  const environment = legalEnvironmentSchema.safeParse(input.environment);
  if (
    !environment.success
    || !acceptsPrivateServiceRequest(request, {
      environment: environment.data,
      marker: SERVICE_BINDING_MARKER,
      method: "POST",
      path: TARGET_LEGAL_ANSWER_PATH,
      requireJson: true,
    })
  ) return privateServiceJson({ code: "TARGET_LEGAL_ANSWER_PRIVATE_ROUTE_REJECTED" }, 404);
  try {
    if (!declaredRequestBodyWithinLimit(request, TARGET_QUESTION_REQUEST_BYTE_LIMIT)) {
      throw new TypeError("TARGET_LEGAL_ANSWER_REQUEST_TOO_LARGE");
    }
    const question = questionSchema.parse(await request.json());
    const execution = observeTargetExecution(question.id, input.versionId);
    const response = privateServiceJson({result: await input.retriever.answer(question)});
    response.headers.set("x-juro-target-answer-contract", TARGET_LEGAL_ANSWER_CONTRACT_VERSION);
    response.headers.set("x-juro-runtime-execution", JSON.stringify({...execution,
      releaseIds: readExecutionDiagnostic(() => input.releaseIds?.() ?? [], [])}));
    return response;
  } catch {
    return privateServiceJson({ code: "TARGET_LEGAL_ANSWER_UNAVAILABLE" }, 503);
  }
}

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
