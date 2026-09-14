import {z} from "zod";
import {legalCoverageScopeSchema} from "./legal-coverage";
import {detectArticleNumbers} from "./legal-language";
import {LEGAL_INTERPRETATION_REQUIREMENT_LIMIT} from "./question-interpretation-limits";

export const unresolvedQuestionDimensionsSchema = z.array(z.enum([
  "actor", "personal_status", "action_stage", "forum", "claim_kind",
])).max(5);
export type UnresolvedQuestionDimensions = z.infer<typeof unresolvedQuestionDimensionsSchema>;
export const userQuestionContextSchema = z.object({
  questions: z.array(z.string().min(1).max(8_000)).min(1).max(7),
  sourceQuestionIndex: z.number().int().min(0).max(6),
}).strict().refine(value => value.sourceQuestionIndex < value.questions.length,
  "The source question must exist in this request context");
export type UserQuestionContext = z.infer<typeof userQuestionContextSchema>;

export const questionRelationshipSchema = z.enum(["independent", "continuation", "correction"]);
export const questionAccountingEntrySchema = z.object({
  disposition: z.enum(["active", "context_only", "superseded"]),
  requirementIndexes: z.array(z.number().int().min(0).max(LEGAL_INTERPRETATION_REQUIREMENT_LIMIT - 1))
    .max(LEGAL_INTERPRETATION_REQUIREMENT_LIMIT),
  currentQuestionQuotation: z.string().min(1).max(500).nullable(),
  contextQuotation: z.string().min(1).max(500).nullable().default(null),
  explanation: z.string().min(1).max(240).nullable(),
}).strict();
export const questionAccountingSchema = z.record(z.string(), questionAccountingEntrySchema);

const questionTokenRangeSchema = z.object({
  startToken: z.number().int().min(0).max(7_999),
  endToken: z.number().int().min(0).max(7_999),
}).strict();
export const questionRequirementOriginSchema = z.object({
  kind: z.enum(["explicit_question", "conditional_reading"]),
  questionIndex: z.number().int().min(0).max(6),
  quotation: z.string().min(1).max(500),
  tokenRange: questionTokenRangeSchema.optional(),
}).strict();
const indexedQuestionOriginSchema = questionRequirementOriginSchema.omit({quotation: true, tokenRange: true})
  .extend(questionTokenRangeSchema.shape);

export const legalRequirementOriginSchema = z.union([questionRequirementOriginSchema, z.object({
  kind: z.literal("inspected_candidate"),
  itemKey: z.string().min(1).max(700),
  provisionRenditionId: z.string().min(1).max(200),
  textRevisionId: z.string().min(1).max(200),
  languageFamily: z.enum(["uz", "ru", "en"]),
}).strict()]);
export type LegalRequirementOrigin = z.infer<typeof legalRequirementOriginSchema>;

export const questionTemporalEndpointSchema = z.discriminatedUnion("kind", [
  z.object({kind: z.literal("current")}).strict(),
  z.object({kind: z.literal("timestamp"), instant: z.string().datetime({offset: true})}).strict(),
]);
export const questionTemporalComparisonSchema = z.object({
  left: questionTemporalEndpointSchema,
  right: questionTemporalEndpointSchema,
}).strict();
const interpretedTemporalEndpointSchema = z.discriminatedUnion("kind", [
  z.object({kind: z.literal("current")}).strict(),
  z.object({kind: z.literal("timestamp"), instant: z.string().datetime({offset: true}),
    origin: z.object({questionIndex: z.number().int().min(0).max(6), quotation: z.string().min(1).max(500)}).strict(),
  }).strict(),
]);

/** The provider and every retrieval adapter share one independent-scope shape.
 * Origins identify user wording; they never attest that a legal rule is true. */
export const compactQuestionInterpretationSchema = z.object({
  relationship: questionRelationshipSchema.optional(),
  questionAccounting: questionAccountingSchema.optional(),
  scopeSource: z.literal("user_question").optional(),
  answerLanguage: z.enum(["ru", "uz", "en"]).default("ru"),
  standaloneQuestion: z.string().trim().min(1).max(900),
  requirements: z.array(z.object({
    origin: questionRequirementOriginSchema,
    statement: z.string().trim().min(1).max(500),
    searchPhrase: z.string().trim().max(500).default(""),
    unresolvedDimensions: unresolvedQuestionDimensionsSchema.default([]),
    scopeKind: legalCoverageScopeSchema,
    priority: z.enum(["core", "supporting"]),
  }).strict()).min(1).max(LEGAL_INTERPRETATION_REQUIREMENT_LIMIT),
  temporalEndpoint: interpretedTemporalEndpointSchema.nullable(),
  comparison: z.object({left: interpretedTemporalEndpointSchema, right: interpretedTemporalEndpointSchema}).strict().nullable(),
  missingFacts: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict();
