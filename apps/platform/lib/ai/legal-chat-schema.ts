import { z } from "zod";
import { MAX_LEGAL_EVIDENCE_SOURCES } from "../legal/legal-evidence-budget";
import type { LegalDatabaseFreshness } from "../legal/verified-retrieval";
import { aiText, type AiOutputLocale } from "./localization";
import { questionInterpretationFailureText } from "./legal-answer-failure";
import {
  sanitizeClarificationQuestions,
} from "./legal-output-safety";
import { legalEvidenceSourceClass } from "./legal-evidence-mode";
export { deriveLegalEvidenceMode } from "./legal-evidence-mode";

const sourceIdList = z.array(z.string().min(1).max(160)).max(12);

export const legalFindingSchema = z.object({
  title: z.string().min(1).max(240),
  explanation: z.string().min(1).max(4_000),
  sourceIds: sourceIdList,
  requirementIds: z.array(z.string().min(1).max(240)).max(40).optional(),
  answerRole: z.enum(["governing_rule", "qualification", "procedure", "consequence"]).optional(),
}).strict();

/**
 * Non-authoritative context attached by JURO, never by the model. A secondary
 * public-web material can explain background but cannot establish legislation,
 * so it is presented here instead of under `confirmedFindings`.
 */
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

/**
 * These fields are attached from the validated corpus packet by JURO. They are
 * deliberately absent from the provider schema so the model cannot invent
 * document metadata, provenance, language, or live/indexed state.
 */
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
  description: z.string().min(1).max(2_000),
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
  actionPlan: z.array(actionStepSchema).max(16),
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
  sourceValidationStatus: z.enum(["validated", "unavailable"]).optional(),
  coverageStatus: z.enum(["good_coverage", "partial_coverage", "weak_coverage", "no_coverage"]).optional(),
  referenceNotes: z.array(legalReferenceNoteSchema).max(8).optional(),
  coverageGaps: z.array(z.string().min(1).max(1_000)).max(240).optional(),
  failureReason: z.enum(["question_interpretation_unavailable", "official_research_unavailable"]).optional(),
}).strict();

export type LegalChatResponse = z.infer<typeof legalChatResponseSchema>;

/**
 * Source-access fields are attached by the server after direct retrieval has
 * been validated. They are intentionally absent from the provider contract:
 * OpenAI Structured Outputs requires every property in an object schema to be
 * listed as required, whereas these fields must remain server-owned.
 * `referenceNotes` is server-owned for a second reason: the model must not be
 * able to choose which material is demoted to non-authoritative context.
 */
export const legalChatModelResponseSchema = legalChatResponseSchema
  .omit({
    sourceAccessMode: true,
    evidenceMode: true,
    sourcesRetrievedAt: true,
    sourceValidationStatus: true,
    coverageStatus: true,
    referenceNotes: true,
    coverageGaps: true,
    failureReason: true,
    conditionalBranches: true,
    sources: true,
    answer: true,
    language: true,
    jurisdiction: true,
    answerMode: true,
    reasoningMode: true,
    legalDatabaseAsOf: true,
    assumptions: true,
    requiredDocuments: true,
    successOutlook: true,
    summarySourceIds: true,
  })
  .extend({
    actionPlan: z.array(actionStepSchema.omit({requirementIds: true})).max(16),
    summary: z.string().min(1).max(650),
    summarySourceIds: sourceIdList,
    confirmedFindings: z.array(legalFindingSchema.extend({
      requirementIds: z.array(z.string().min(1).max(240)).max(40),
      answerRole: legalFindingSchema.shape.answerRole.unwrap(),
    })).max(16),
    conditionalBranches: legalConditionalBranchListSchema,
  });

export const legalChatJsonSchema = z.toJSONSchema(legalChatModelResponseSchema, {
  target: "draft-7",
  unrepresentable: "throw",
}) as Record<string, unknown>;

function answerCoverageSchema(requirements: readonly {id: string}[]) {
  return z.object(Object.fromEntries(requirements.map((_, index) => [
    `r${index + 1}`, z.array(z.number().int().min(0).max(15)).max(16),
  ]))).strict();
}

/** Every planned scope gets an explicit slot; an empty slot remains a visible gap. */
export function legalChatJsonSchemaForCoverage(requirements: readonly {id: string}[] = [], part?: "findings" | "guidance", repair = false) {
  const base = repair ? legalChatModelResponseSchema.extend({summary: z.string().max(1_500),
    actionPlan: z.array(actionStepSchema.omit({requirementIds: true}).extend({
      retainedFindingIndexes: z.array(z.number().int().min(0).max(15)).max(16),
    })).max(16),
  }) : legalChatModelResponseSchema;
  const schema = part === "findings" ? base.omit({actionPlan: true, risks: true,
    deadlines: true, conditionalBranches: true})
    : part === "guidance" ? base.omit({confirmedFindings: true,
      summarySourceIds: true, deadlines: true, conditionalBranches: true}) : base;
  // Guidance needs the same question inventory as findings, but finding
  // indexes have no meaning in its separate practical-action response.
  if (!requirements.length) return z.toJSONSchema(schema, {target: "draft-7", unrepresentable: "throw"}) as Record<string, unknown>;
  if (part === "guidance") return z.toJSONSchema(schema.extend({
    guidanceCoverage: answerCoverageSchema(requirements),
  }), {target: "draft-7", unrepresentable: "throw"}) as Record<string, unknown>;
  return z.toJSONSchema(schema.extend({
    confirmedFindings: z.array(legalFindingSchema.omit({requirementIds: true}).extend({
      answerRole: legalFindingSchema.shape.answerRole.unwrap(),
    })).max(16),
    coverage: answerCoverageSchema(requirements),
    ...(part !== "findings" ? {guidanceCoverage: answerCoverageSchema(requirements)} : {}),
  }), {target: "draft-7", unrepresentable: "throw"}) as Record<string, unknown>;
}

export function restoreLegalSourceIds(ids: readonly string[], sources: readonly { id: string }[]): string[] {
  const sourceByAlias = new Map(sources.map((source, index) => [`s${index + 1}`, source.id]));
  return ids.map(id => sourceByAlias.get(id) ?? id);
}

export function parseLegalChatResponse(value: unknown, context?: {
  locale: AiOutputLocale;
  answerMode: "short" | "detailed";
  reasoningMode: "fast" | "deep";
  legalDatabaseAsOf: string;
  sources?: readonly { id: string }[];
  coverageRequirements?: readonly {id: string}[];
  synthesisPart?: "findings" | "guidance";
  contentRepair?: {retained: Pick<LegalChatResponse, "summary" | "summarySourceIds"> & Partial<Pick<LegalChatResponse, "confirmedFindings">>};
}): LegalChatResponse {
  if (!context || !value || typeof value !== "object" || Array.isArray(value)) {
    return legalChatResponseSchema.parse(value);
  }
  const record = {...value} as Record<string, unknown>;
  // A partial repair need not invent a new Main Point. The retained candidate
  // is revalidated against the complete merged findings by the gateway.
  const retainedSummary = Boolean(context.contentRepair && (typeof record.summary !== "string" || !record.summary.trim()));
  if (retainedSummary && context.contentRepair) Object.assign(record, {summary: context.contentRepair.retained.summary,
    summarySourceIds: context.contentRepair.retained.summarySourceIds ?? []});
  if (context.synthesisPart === "findings") Object.assign(record, {actionPlan: [], risks: [], deadlines: [], conditionalBranches: []});
  if (context.synthesisPart === "guidance") Object.assign(record, {confirmedFindings: [], summarySourceIds: [], deadlines: [], conditionalBranches: []});
  const requirements = context.coverageRequirements ?? [];
  const coverage = requirements.length && context.synthesisPart !== "guidance"
    ? answerCoverageSchema(requirements).parse(record.coverage) : null;
  const findingCount = Array.isArray(record.confirmedFindings) ? record.confirmedFindings.length : 0;
  const guidanceCoverage = requirements.length && context.synthesisPart !== "findings"
    ? answerCoverageSchema(requirements).parse(record.guidanceCoverage) : null;
  const actionCount = Array.isArray(record.actionPlan) ? record.actionPlan.length : 0;
  if (guidanceCoverage && Object.values(guidanceCoverage).some(indices => indices.some(index => index >= actionCount))) {
    throw new TypeError("ANSWER_COVERAGE_ACTION_UNAVAILABLE");
  }
  if (coverage && Object.values(coverage).some(indices => indices.some(index => index >= findingCount))) {
    throw new TypeError("ANSWER_COVERAGE_FINDING_UNAVAILABLE");
  }
  const claims = Object.fromEntries(["confirmedFindings", "conditionalBranches", "risks", "actionPlan", "deadlines"]
    .filter(key => Array.isArray(record[key])).map(key => [key, (record[key] as unknown[]).map((item, findingIndex) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const claim = {...item} as Record<string, unknown>;
      if (Array.isArray(claim.sourceIds)) claim.sourceIds = claim.sourceIds.map(id =>
        typeof id === "string" ? restoreLegalSourceIds([id], context.sources ?? [])[0] : id);
      const scopeCoverage = key === "confirmedFindings" ? coverage : key === "actionPlan" ? guidanceCoverage : null;
      const requirementIds = scopeCoverage ? requirements.flatMap((requirement, index) =>
        scopeCoverage[`r${index + 1}`]!.includes(findingIndex) ? [requirement.id] : []) : null;
      if (key === "actionPlan" && context.contentRepair && "retainedFindingIndexes" in claim) {
        const indexes = z.array(z.number().int().min(0).max(15)).max(16).parse(claim.retainedFindingIndexes);
        const retained = context.contentRepair.retained.confirmedFindings ?? [];
        const rules = [...new Set(indexes)].map(index => {
          const rule = retained[index];
          if (!rule || !rule.requirementIds?.some(id => requirementIds?.includes(id))) {
            throw new TypeError("REPAIR_RULE_CONTEXT_UNAVAILABLE");
          }
          return rule;
        });
        // These are candidate claims, not reused approvals. Both providers
        // independently assess the composed action before gateway validation.
        if (rules.length) {
          const description = z.string().min(1).parse(claim.description);
          const sourceIds = z.array(z.string()).parse(claim.sourceIds);
          claim.description = [description, ...rules.map(rule => rule.explanation)].join("\n\n");
          claim.sourceIds = [...new Set([...sourceIds,
            ...rules.flatMap(rule => rule.sourceIds)])];
        }
        delete claim.retainedFindingIndexes;
      }
      return {...claim, ...(scopeCoverage ? {
        requirementIds,
      } : {})};
    })]));
  // Source cards and the legacy answer copy are rebuilt after validation.
  // The concise summary can cover several independently grounded findings.
  const findings = Array.isArray(record.confirmedFindings) ? record.confirmedFindings : [];
  const main = findings.find(finding => finding?.answerRole === "governing_rule") ?? findings[0];
  const summary = typeof record.summary === "string" ? record.summary
    : main && typeof main.explanation === "string"
      ? main.explanation.slice(0, 1_500) : " ";
  const responseRecord = {...record};
  delete responseRecord.coverage;
  delete responseRecord.guidanceCoverage;
  delete responseRecord.failureReason;
  return legalChatResponseSchema.parse({ ...responseRecord, ...claims,
    ...(Array.isArray(record.summarySourceIds) ? {summarySourceIds: record.summarySourceIds.map(id =>
      typeof id === "string" && !retainedSummary ? restoreLegalSourceIds([id], context.sources ?? [])[0] : id)} : {}),
    summary, answer: summary, sources: [], language: context.locale, jurisdiction: "UZ",
    answerMode: context.answerMode, reasoningMode: context.reasoningMode,
    legalDatabaseAsOf: context.legalDatabaseAsOf,
    assumptions: [], requiredDocuments: [], successOutlook: null,
  });
}

export function forceClarificationWithoutVerifiedSources(
  result: LegalChatResponse,
  options: {
    locale: AiOutputLocale;
    answerMode: "short" | "detailed";
    reasoningMode: "fast" | "deep";
    legalDatabaseAsOf: string;
  },
): LegalChatResponse {
  // No verified source is available. This does not establish which search
  // tiers ran, or whether research started. No provider-authored prose may remain in the terminal
  // payload, because an answer written from the model's general knowledge is
  // indistinguishable, to the reader, from one grounded in Uzbek law. Only
  // fixed refusal text and sanitized follow-up questions survive — a
  // "question" can otherwise smuggle an unsupported deadline, document list
  // or legal premise. This step does not charge the answer limit.
  const clarificationQuestions = sanitizeClarificationQuestions(
    result.clarificationQuestions,
    options.locale,
  );
  if (clarificationQuestions.length === 0) {
    clarificationQuestions.push(aiText(
      options.locale,
      "Какие ключевые даты, документы и действия сторон уже известны?",
      "Qaysi asosiy sanalar, hujjatlar va tomonlarning harakatlari ma’lum?",
      "Which key dates, documents and actions by the parties are already known?",
    ));
  }
  return {
    ...result,
    responseKind: "clarification_required",
    summary: aiText(options.locale, "Для надёжного ответа нужны дополнительные факты и проверенный правовой источник.", "Ishonchli javob uchun qo‘shimcha faktlar va tekshirilgan huquqiy manba kerak.", "A reliable answer requires more facts and a verified legal source."),
    answer: aiText(options.locale, "JURO пока не сформировал правовой вывод: релевантный фрагмент не удалось получить напрямую из доступных официальных источников. Ответьте на уточняющие вопросы или попробуйте позже — этот шаг не списывает лимит ответа.", "JURO hozircha huquqiy xulosa tuzmadi: tegishli parcha mavjud rasmiy manbalardan bevosita olinmadi. Aniqlashtiruvchi savollarga javob bering yoki keyinroq urinib ko‘ring — bu bosqich javob limitidan yechilmaydi.", "JURO has not formed a legal conclusion because a relevant passage could not be retrieved directly from available official sources. Answer the clarification questions or try again later; this step does not use your answer allowance."),
    conditionalBranches: [],
    language: options.locale,
    jurisdiction: "UZ",
    answerMode: options.answerMode,
    reasoningMode: options.reasoningMode,
    clarificationQuestions,
    confirmedFindings: [],
    referenceNotes: [],
    assumptions: [],
    risks: [],
    sources: [],
    requiredDocuments: [],
    actionPlan: [],
    deadlines: [],
    successOutlook: null,
    suggestedDocument: null,
    suggestLawyer: result.suggestLawyer || result.urgency !== "normal",
    legalDatabaseAsOf: options.legalDatabaseAsOf,
    evidenceMode: "none",
  };
}

export function enforceLegalDatabaseFreshness(
  result: LegalChatResponse,
  freshness: LegalDatabaseFreshness,
  options: {
    locale: AiOutputLocale;
    answerMode: "short" | "detailed";
    reasoningMode: "fast" | "deep";
  },
): LegalChatResponse {
  if (result.failureReason === "question_interpretation_unavailable") {
    const answer = questionInterpretationFailureText(options.locale);
    return {
      ...forceClarificationWithoutVerifiedSources(result, { ...options, legalDatabaseAsOf: result.legalDatabaseAsOf }),
      summary: answer, answer, clarificationQuestions: [], conditionalBranches: [], coverageGaps: [],
    };
  }
  if (freshness.status === "unavailable") {
    const nonLegislativeFactsOnly = result.sources.length > 0
      && result.sources.every((source) => ["private", "secondary"].includes(
        legalEvidenceSourceClass(source),
      ));
    if (nonLegislativeFactsOnly) {
      const warning = aiText(options.locale, "Факты ниже опираются только на ваши документы и/или справочные интернет-материалы. Достаточная норма Lex.uz не найдена; каждый такой материал не является официальным источником законодательства.", "Quyidagi faktlar faqat hujjatlaringiz va/yoki internetdagi ma’lumotnoma materiallariga tayangan. Yetarli Lex.uz normasi topilmadi; bu materiallar qonunchilik tasdig‘i emas.", "The facts below rely only on your documents and/or public reference materials. No sufficient legal provision was found in Lex.uz; these materials are not official sources of law.");
      return {
        ...result,
        assumptions: [{
          statement: aiText(options.locale, "Правовое основание требует отдельной проверки", "Huquqiy asos alohida tekshirilishi kerak", "The legal basis requires separate verification"),
          impact: warning,
        }, ...result.assumptions].slice(0, 16),
        conditionalBranches: [],
        deadlines: [],
        successOutlook: null,
        suggestLawyer: true,
        legalDatabaseAsOf: freshness.asOf,
      };
    }
    return forceClarificationWithoutVerifiedSources(result, {
      ...options,
      legalDatabaseAsOf: freshness.asOf,
    });
  }
  if (freshness.status === "fresh") {
    return { ...result, legalDatabaseAsOf: freshness.asOf };
  }

  const warning = aiText(options.locale, `Правовая база JURO не обновлялась более ${freshness.maxAgeDays} дней (последняя полная синхронизация: ${freshness.asOf}). Выводы ниже предварительные и требуют проверки по актуальной редакции или юристом.`, `JURO huquqiy bazasi ${freshness.maxAgeDays} kundan ortiq yangilanmagan (oxirgi to‘liq sinxronlash: ${freshness.asOf}). Quyidagi xulosalar dastlabki bo‘lib, amaldagi tahrir yoki yurist tomonidan tekshirilishi kerak.`, `The JURO legal database has not been updated for more than ${freshness.maxAgeDays} days (last full sync: ${freshness.asOf}). The findings below are preliminary and must be checked against the current version or by a lawyer.`);
  const staleAssumption = {
    statement: aiText(options.locale, "Актуальность правовой базы требует подтверждения", "Huquqiy bazaning dolzarbligi tasdiqlanishi kerak", "The currency of the legal database must be verified"),
    impact: warning.slice(0, 2_000),
  };
  const sourceClasses = new Map(result.sources.map((source) => [
    source.sourceId,
    legalEvidenceSourceClass(source),
  ]));
  const usesOnly = (sourceIds: readonly string[], expected: "private" | "secondary") =>
    sourceIds.length > 0 && sourceIds.every(sourceId => sourceClasses.get(sourceId) === expected);
  const confirmedFindings = result.confirmedFindings.filter(finding =>
    usesOnly(finding.sourceIds, "private")
  );
  const conditionalBranches = (result.conditionalBranches ?? []).filter(branch =>
    usesOnly(branch.sourceIds, "private")
  );
  const referenceNotes = (result.referenceNotes ?? []).filter(note =>
    usesOnly(note.sourceIds, "secondary")
  );
  const retainedSourceIds = new Set([
    ...confirmedFindings.flatMap(finding => finding.sourceIds),
    ...conditionalBranches.flatMap(branch => branch.sourceIds),
    ...referenceNotes.flatMap(note => note.sourceIds),
  ]);
  const sources = result.sources.filter(source => retainedSourceIds.has(source.sourceId));
  const privateFactText = [
    ...confirmedFindings.map(finding => `${finding.title}: ${finding.explanation}`),
    ...conditionalBranches.map(branch => `${branch.condition}: ${branch.outcome}`),
  ].join("\n\n").slice(0, 20_000);
  const hasPrivateFacts = privateFactText.length > 0;
  const hasSecondaryReferences = referenceNotes.length > 0;
  const clarificationQuestions = sanitizeClarificationQuestions(
    result.clarificationQuestions,
    options.locale,
  );
  return {
    ...result,
    responseKind: hasPrivateFacts ? "answer" : "clarification_required",
    summary: hasPrivateFacts
      ? aiText(options.locale, "Подтверждены только факты из ваших документов.", "Faqat hujjatlaringizdagi faktlar tasdiqlandi.", "Only facts from your documents were verified.")
      : aiText(options.locale, "Актуальный официальный правовой вывод недоступен.", "Amaldagi rasmiy huquqiy xulosa mavjud emas.", "A current official legal conclusion is unavailable."),
    answer: hasPrivateFacts
      ? `${warning}\n\n${privateFactText}`.slice(0, 20_000)
      : warning,
    clarificationQuestions,
    confirmedFindings,
    conditionalBranches,
    referenceNotes,
    assumptions: [staleAssumption],
    risks: [],
    sources,
    requiredDocuments: [],
    actionPlan: [],
    deadlines: [],
    successOutlook: null,
    urgency: "normal",
    suggestedDocument: null,
    suggestLawyer: true,
    legalDatabaseAsOf: freshness.asOf,
    evidenceMode: hasPrivateFacts
      ? hasSecondaryReferences ? "mixed" : "private_only"
      : hasSecondaryReferences ? "secondary_only" : "none",
    coverageStatus: "no_coverage",
  };
}

export function referencedSourceIds(result: LegalChatResponse): Set<string> {
  return new Set([
    ...result.sources.map((source) => source.sourceId),
    ...result.confirmedFindings.flatMap((finding) => finding.sourceIds),
    ...(result.conditionalBranches ?? []).flatMap((branch) => branch.sourceIds),
    ...(result.referenceNotes ?? []).flatMap((note) => note.sourceIds),
    ...result.risks.flatMap((risk) => risk.sourceIds),
    ...result.actionPlan.flatMap((step) => step.sourceIds),
    ...result.deadlines.flatMap((deadline) => deadline.sourceIds),
  ]);
}

export function enforceLegalChatSourceBoundary(
  result: LegalChatResponse,
  allowedSourceIds: ReadonlySet<string>,
): LegalChatResponse {
  const declaredSourceIds = new Set<string>();
  for (const source of result.sources) {
    if (declaredSourceIds.has(source.sourceId)) {
      throw new Error(`AI_SOURCE_DUPLICATED:${source.sourceId}`);
    }
    declaredSourceIds.add(source.sourceId);
  }
  for (const sourceId of referencedSourceIds(result)) {
    if (!allowedSourceIds.has(sourceId)) {
      throw new Error(`AI_SOURCE_NOT_ALLOWED:${sourceId}`);
    }
  }
  const citedSourceIds = new Set([
    ...result.confirmedFindings.flatMap((finding) => finding.sourceIds),
    ...(result.conditionalBranches ?? []).flatMap((branch) => branch.sourceIds),
    ...(result.referenceNotes ?? []).flatMap((note) => note.sourceIds),
    ...result.risks.flatMap((risk) => risk.sourceIds),
    ...result.actionPlan.flatMap((step) => step.sourceIds),
    ...result.deadlines.flatMap((deadline) => deadline.sourceIds),
  ]);
  for (const sourceId of citedSourceIds) {
    if (!declaredSourceIds.has(sourceId)) {
      throw new Error(`AI_CITATION_REFERENCE_MISSING:${sourceId}`);
    }
  }
  if (result.confirmedFindings.some((finding) => finding.sourceIds.length === 0)) {
    throw new Error("AI_CONFIRMED_FINDING_REQUIRES_CITATION");
  }
  if ((result.conditionalBranches ?? []).some((branch) => branch.sourceIds.length === 0)) {
    throw new Error("AI_CONDITIONAL_BRANCH_REQUIRES_CITATION");
  }
  if ((result.referenceNotes ?? []).some((note) => note.sourceIds.length === 0)) {
    throw new Error("AI_REFERENCE_NOTE_REQUIRES_CITATION");
  }
  if (result.deadlines.some((deadline) =>
    deadline.confidence === "confirmed" && deadline.sourceIds.length === 0
  )) {
    throw new Error("AI_CONFIRMED_DEADLINE_REQUIRES_CITATION");
  }
  return result;
}
