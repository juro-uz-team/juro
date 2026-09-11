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

export function questionInterpretationInput(questions: readonly string[], locale: "ru" | "uz" | "en" | null) {
  return {questions: questions.map((question, questionIndex) => ({questionIndex,
    tokens: [...question.matchAll(/\S+/gu)].map((match, index) => [index, match[0]]),
  })), currentQuestionIndex: 0, locale, jurisdiction: "UZ"};
}

function questionRangeSelection(questions: readonly string[], questionIndex: number, value: unknown) {
  const range = questionTokenRangeSchema.parse(value);
  const question = questions[questionIndex];
  const tokens = question === undefined ? [] : [...question.matchAll(/\S+/gu)];
  const start = tokens[range.startToken];
  const end = tokens[range.endToken];
  if (!question || !start || !end || range.endToken < range.startToken) throw new TypeError("QUESTION_SOURCE_RANGE_INVALID");
  const endIndex = end.index! + end[0].length;
  return {before:question.slice(0,start.index),selected:question.slice(start.index,endIndex),after:question.slice(endIndex)};
}

function questionRangeText(questions: readonly string[], questionIndex: number, value: unknown): string {
  return questionRangeSelection(questions,questionIndex,value).selected;
}

function materializeQuestionOrigins(value: unknown, questions: readonly string[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = {...value} as Record<string, unknown>;
  const materializeOrigin = (value: unknown) => {
    if (!value || typeof value !== "object" || !("startToken" in value)) return value;
    const origin = indexedQuestionOriginSchema.parse(value);
    return {kind: origin.kind, questionIndex: origin.questionIndex,
      tokenRange:{startToken:origin.startToken,endToken:origin.endToken},
      quotation: questionRangeText(questions, origin.questionIndex, {startToken: origin.startToken, endToken: origin.endToken})};
  };
  if (Array.isArray(record.requirements)) record.requirements = record.requirements.map(requirement =>
    requirement && typeof requirement === "object" ? {...requirement, origin: materializeOrigin(requirement.origin)} : requirement);
  if (record.questionAccounting && typeof record.questionAccounting === "object" && !Array.isArray(record.questionAccounting)) {
    record.questionAccounting = Object.fromEntries(Object.entries(record.questionAccounting).map(([key, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [key, value];
      const entry = {...value} as Record<string, unknown>;
      for (const [rangeKey, quoteKey, questionIndex] of [
        ["contextRange", "contextQuotation", Number(key.slice(1))],
        ["currentQuestionRange", "currentQuestionQuotation", 0],
      ] as const) if (rangeKey in entry) {
        entry[quoteKey] = entry[rangeKey] === null ? null : questionRangeText(questions, questionIndex, entry[rangeKey]);
        delete entry[rangeKey];
      }
      return [key, entry];
    }));
  }
  return record;
}

export const legalRequirementOriginSchema = z.union([questionRequirementOriginSchema, z.object({
  kind: z.literal("inspected_candidate"),
  itemKey: z.string().min(1).max(700),
  provisionRenditionId: z.string().min(1).max(200),
  textRevisionId: z.string().min(1).max(200),
  languageFamily: z.enum(["uz", "ru", "en"]),
}).strict()]);
export type LegalRequirementOrigin = z.infer<typeof legalRequirementOriginSchema>;

/** Select an occurrence from trusted request context, never from model-authored prose. */
export function questionScopeSelection(requirement: {origin?: LegalRequirementOrigin; questionContext?: UserQuestionContext}) {
  const {origin,questionContext} = requirement;
  if (!origin || origin.kind === "inspected_candidate" || !origin.tokenRange) return undefined;
  if (!questionContext || questionContext.sourceQuestionIndex !== origin.questionIndex) {
    throw new TypeError("QUESTION_REQUIREMENT_CONTEXT_INVALID");
  }
  const selection = questionRangeSelection(questionContext.questions,origin.questionIndex,origin.tokenRange);
  if (selection.selected !== origin.quotation) throw new TypeError("QUESTION_REQUIREMENT_RANGE_MISMATCH");
  return selection;
}

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

export function questionInterpretationJsonSchemaForQuestions(questions: number | readonly string[]) {
  const questionCount = typeof questions === "number" ? questions : questions.length;
  if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 7) throw new TypeError("QUESTION_ACCOUNTING_COUNT_INVALID");
  const rangeForQuestion = (index: number) => {
    const maxToken = typeof questions === "number" ? 7_999 : [...questions[index]!.matchAll(/\S+/gu)].length - 1;
    if (maxToken < 0) throw new TypeError("QUESTION_SOURCE_EMPTY");
    return questionTokenRangeSchema.extend({startToken:z.number().int().min(0).max(maxToken),
      endToken:z.number().int().min(0).max(maxToken)});
  };
  const origins = Array.from({length:questionCount},(_,index) => indexedQuestionOriginSchema.extend({
    questionIndex:z.literal(index),...rangeForQuestion(index).shape,
  }));
  const originSchema = origins.length === 1 ? origins[0]! : z.union(origins);
  return z.toJSONSchema(compactQuestionInterpretationSchema.omit({standaloneQuestion: true}).extend({
    relationship: questionRelationshipSchema,
    questionAccounting: z.object(Object.fromEntries(Array.from({length: questionCount}, (_, index) =>
      [`q${index}`, questionAccountingEntrySchema.omit({requirementIndexes: true,contextQuotation:true,currentQuestionQuotation:true})
        .extend({contextRange:rangeForQuestion(index).nullable(),currentQuestionRange:rangeForQuestion(0).nullable()})]))).strict(),
    scopeSource: z.literal("user_question"),
    requirements: z.array(compactQuestionInterpretationSchema.shape.requirements.element.omit({searchPhrase: true, statement: true})
      .extend({origin:originSchema}))
      .min(1).max(LEGAL_INTERPRETATION_REQUIREMENT_LIMIT),
  }), {io: "output"});
}
export const compactQuestionInterpretationJsonSchema = questionInterpretationJsonSchemaForQuestions(1);

function sourceScopeDiscoveryQuery(anchor: string, questionIndex: number,
  accounting: z.infer<typeof questionAccountingSchema>, questions: readonly string[]): string {
  // A question-level context selection can describe another topic or omit a
  // follow-up's changed action. Preserve complete user context whenever it fits
  // one discovery formulation; the exact anchor still identifies its scope.
  const complete = [...new Set([anchor, questions[0], questions[questionIndex]])]
    .join(" ").replace(/\s+/gu, " ").trim();
  if (complete.length <= 500) return complete;
  const context = [accounting.q0?.contextQuotation ?? questions[0],
    accounting[`q${questionIndex}`]?.contextQuotation ?? questions[questionIndex]]
    .filter((text): text is string => Boolean(text) && text !== anchor);
  // Only discovery is bounded. The full source questions remain attached to
  // mandatory coverage and are supplied to support assessment unchanged.
  return [...new Set([anchor, ...context])].join(" ").replace(/\s+/gu, " ").trim().slice(0, 500);
}

function canonicalEndpoint(endpoint: z.infer<typeof interpretedTemporalEndpointSchema>, questions: readonly string[]) {
  if (endpoint.kind === "current") return endpoint;
  const quotation = endpoint.origin.quotation;
  if (!questions[endpoint.origin.questionIndex]?.includes(quotation)) throw new TypeError("QUESTION_TEMPORAL_ORIGIN_INVALID");
  const instant = new Date(endpoint.instant).toISOString();
  const dates = [...quotation.matchAll(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?\b/gu)]
    .map(match => match[0].includes("T") ? match[0] : `${match[0]}T00:00:00Z`);
  for (const match of quotation.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/gu)) {
    dates.push(`${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}T00:00:00Z`);
  }
  // Calendar vocabulary comes from the supported locales, independently of
  // the legal topic. A year alone must never become an invented January date.
  const normalized = quotation.normalize("NFKC").toLocaleLowerCase().replace(/[.,]/gu, " ").replace(/\s+/gu, " ").trim();
  for (const locale of ["en", "ru", "uz"]) for (let month = 0; month < 12; month++) {
    const parts = new Intl.DateTimeFormat(locale, {day: "numeric", month: "long", year: "numeric", timeZone: "UTC"})
      .formatToParts(new Date(Date.UTC(2000, month, 1)));
    const name = parts.find(part => part.type === "month")!.value.toLocaleLowerCase();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const patterns = [new RegExp(`(?:^|\\s)(\\d{1,2})[ -]+${escaped}[ -]+(\\d{4})(?:\\s|$)`, "u"),
      new RegExp(`(?:^|\\s)${escaped} (\\d{1,2}) (\\d{4})(?:\\s|$)`, "u")];
    for (const pattern of patterns) {
      const match = pattern.exec(normalized);
      if (match) dates.push(`${match[2]}-${String(month + 1).padStart(2, "0")}-${match[1]!.padStart(2, "0")}T00:00:00Z`);
    }
    const uzbek = new RegExp(`(?:^|\\s)(\\d{4})[ -]+yil (\\d{1,2})[ -]+${escaped}(?:\\s|$)`, "u").exec(normalized);
    if (uzbek) dates.push(`${uzbek[1]}-${String(month + 1).padStart(2, "0")}-${uzbek[2]!.padStart(2, "0")}T00:00:00Z`);
  }
  if (!dates.some(date => {
    const calendarDate = date.slice(0, 10);
    const calendarInstant = Date.parse(`${calendarDate}T00:00:00Z`);
    return Number.isFinite(calendarInstant) && new Date(calendarInstant).toISOString().startsWith(calendarDate)
      && Number.isFinite(Date.parse(date)) && new Date(date).toISOString() === instant;
  })) {
    throw new TypeError("QUESTION_TEMPORAL_REFERENCE_UNGROUNDED");
  }
  return {...endpoint, instant};
}

/** Recover provider ellipsis shorthand only when it identifies one exact user
 * span. This changes neither the requirement nor its source question. */
function exactQuestionQuotation(question: string | undefined, quotation: string): string | null {
  if (!question) return null;
  if (question.includes(quotation)) return quotation;
  const pieces = quotation.split(/(?:\.{3}|…)/u).map(piece => piece.trim());
  if (pieces.length < 2 || pieces.length > 8 || pieces.some(piece => piece.length < 2)
    || pieces.reduce((length, piece) => length + piece.length, 0) < 8) return null;
  const first = pieces[0]!, last = pieces.at(-1)!;
  let match: {start: number; end: number} | undefined;
  for (let start = question.indexOf(first); start >= 0; start = question.indexOf(first, start + 1)) {
    const minimumEnd = start + first.length;
    for (let endStart = question.indexOf(last, minimumEnd); endStart >= 0 && endStart + last.length - start <= 500;
      endStart = question.indexOf(last, endStart + 1)) {
      let cursor = minimumEnd;
      let valid = true;
      for (const piece of pieces.slice(1, -1)) {
        const at = question.indexOf(piece, cursor);
        if (at < 0 || at + piece.length > endStart) {valid = false; break;}
        cursor = at + piece.length;
      }
      if (!valid) continue;
      if (match) return null;
      match = {start, end: endStart + last.length};
    }
  }
  return match ? question.slice(match.start, match.end) : null;
}

export function parseCompactQuestionInterpretation(value: unknown, questions: readonly string[], options: {requireQuestionAccounting?: boolean} = {}) {
  value = materializeQuestionOrigins(value, questions);
  let supplied = value && typeof value === "object" && "scopeSource" in value && value.scopeSource === "user_question"
    ? {...value, standaloneQuestion: (questions[0] ?? "").slice(0, 900)} : value;
  if (supplied && typeof supplied === "object" && "requirements" in supplied && Array.isArray(supplied.requirements)
    && "questionAccounting" in supplied) {
    const requirements = supplied.requirements;
    const rawAccounting = z.record(z.string(), questionAccountingEntrySchema.omit({requirementIndexes: true})
      .extend({requirementIndexes: questionAccountingEntrySchema.shape.requirementIndexes.optional()})).parse(supplied.questionAccounting);
    const accounting = questionAccountingSchema.parse(Object.fromEntries(Object.entries(rawAccounting).map(([key, entry]) => {
      const questionIndex = Number(key.slice(1));
      const ownIndexes = requirements.flatMap((requirement, index) => {
        const origin = questionRequirementOriginSchema.safeParse(requirement?.origin);
        return origin.success && origin.data.questionIndex === questionIndex ? [index] : [];
      });
      const contextQuotation = entry.contextQuotation
        ? exactQuestionQuotation(questions[questionIndex], entry.contextQuotation) : null;
      // Optional discovery context is not scope authority. A bad suggestion
      // falls back to actual user text; it can never become a searched fact.
      return [key, {...entry, contextQuotation,
        requirementIndexes: entry.requirementIndexes ?? (key === "q0" ? requirements.map((_, index) => index) : ownIndexes)}];
    })));
    supplied = {...supplied, questionAccounting: accounting, requirements: requirements.map((requirement: unknown) => {
      if (!requirement || typeof requirement !== "object" || "statement" in requirement || !("origin" in requirement)) return requirement;
      const origin = questionRequirementOriginSchema.parse(requirement.origin);
      return {...requirement, statement: origin.quotation,
        searchPhrase: sourceScopeDiscoveryQuery(origin.quotation, origin.questionIndex, accounting, questions)};
    })};
  }
  const plan = compactQuestionInterpretationSchema.parse(supplied);
  if (options.requireQuestionAccounting && !plan.questionAccounting) throw new TypeError("QUESTION_ACCOUNTING_UNAVAILABLE");
  if (plan.questionAccounting) {
    const entries = plan.questionAccounting;
    if (!plan.relationship || Object.keys(entries).length !== questions.length
      || questions.some((_, index) => !entries[`q${index}`]) || entries.q0?.disposition !== "active") {
      throw new TypeError("QUESTION_ACCOUNTING_INCOMPLETE");
    }
    for (const [key, entry] of Object.entries(entries)) {
      if (entry.contextQuotation && !exactQuestionQuotation(questions[Number(key.slice(1))], entry.contextQuotation)) {
        throw new TypeError("QUESTION_ACCOUNTING_CONTEXT_INVALID");
      }
      if (new Set(entry.requirementIndexes).size !== entry.requirementIndexes.length
        || entry.requirementIndexes.some(index => index >= plan.requirements.length)
        || (entry.disposition === "active") !== (entry.requirementIndexes.length > 0)) {
        throw new TypeError("QUESTION_ACCOUNTING_REQUIREMENTS_INVALID");
      }
      if (entry.disposition !== "active" && (!entry.explanation || !entry.currentQuestionQuotation
        || !exactQuestionQuotation(questions[0], entry.currentQuestionQuotation))) {
        throw new TypeError("QUESTION_ACCOUNTING_ORIGIN_INVALID");
      }
      if (key !== "q0" && plan.relationship === "independent" && entry.disposition === "active") {
        throw new TypeError("QUESTION_ACCOUNTING_RELATIONSHIP_CONFLICT");
      }
    }
    if (plan.relationship !== "independent" && !Object.entries(entries)
      .some(([key, entry]) => key !== "q0" && entry.disposition === "active")) {
      throw new TypeError("QUESTION_ACCOUNTING_ANTECEDENT_UNAVAILABLE");
    }
    plan.requirements.forEach((requirement, index) => {
      if (!entries[`q${requirement.origin.questionIndex}`]?.requirementIndexes.includes(index)) {
        throw new TypeError("QUESTION_ACCOUNTING_SCOPE_UNASSIGNED");
      }
    });
  }
  if (plan.temporalEndpoint && plan.comparison) throw new TypeError("QUESTION_TEMPORAL_SCOPE_CONFLICT");
  for (const requirement of plan.requirements) {
    const question = questions[requirement.origin.questionIndex];
    if (requirement.origin.tokenRange && questionRangeText(questions,requirement.origin.questionIndex,
      requirement.origin.tokenRange) !== requirement.origin.quotation) {
      throw new TypeError("QUESTION_REQUIREMENT_RANGE_MISMATCH");
    }
    const quotation = exactQuestionQuotation(question, requirement.origin.quotation);
    if (!quotation) throw new TypeError("QUESTION_REQUIREMENT_ORIGIN_INVALID");
    requirement.origin.quotation = quotation;
    const explicitArticles = new Set(detectArticleNumbers(question));
    const contextArticles = new Set(questions.flatMap(question => detectArticleNumbers(question)));
    if (detectArticleNumbers(requirement.statement).some(article => !explicitArticles.has(article))
      || detectArticleNumbers(requirement.searchPhrase).some(article => !contextArticles.has(article))) {
      throw new TypeError("QUESTION_REQUIREMENT_REFERENCE_UNGROUNDED");
    }
  }
  const explicitArticles = new Set(questions.flatMap(question => detectArticleNumbers(question)));
  if (detectArticleNumbers(plan.standaloneQuestion).some(article => !explicitArticles.has(article))) {
    throw new TypeError("QUESTION_REFERENCE_UNGROUNDED");
  }
  return {...plan,
    temporalEndpoint: plan.temporalEndpoint ? canonicalEndpoint(plan.temporalEndpoint, questions) : null,
    comparison: plan.comparison ? {left: canonicalEndpoint(plan.comparison.left, questions), right: canonicalEndpoint(plan.comparison.right, questions)} : null};
}
