import { z } from "zod";
import {parseLegalEvidenceRouting, hasRequiredEvidenceReference, legalEvidenceReferenceContexts} from "./legal-evidence-routing";
import {assessedGuidanceActions, assessedGuidanceCoverage, assessedGuidanceGaps} from "./legal-guidance-assessment";
import {assessedFindingSources, assessedFindingCoverage, assessedFindingGaps, assessedGoverningFindings, assessedMainPointSupported} from "./legal-finding-assessment";
import { MAX_LEGAL_EVIDENCE_SOURCES } from "../legal/legal-evidence-budget";
import {retainRecoveredLegalEvidence, type RecoveredLegalEvidence} from "./legal-evidence-recovery";
import {answerVerificationFailureText} from "./legal-answer-failure";

/**
 * Claim/source filtering and coverage checks adapt the grounding concepts in
 * toxirerkinov70-commits/huquq-ai@1bce500c69b8213373d8ce0b40d56be7d83f6aec.
 * MIT License, Copyright (c) 2026 Toxir Erkinov. This implementation adds
 * exact request-scoped Lex span IDs/hashes and JURO's provider-neutral schema.
 */

import { containsLegalSourceUiNoise } from "../legal/source-parser";
import { groundingNumericTokens } from "../legal/grounding-numbers";
import { canonicalSecondaryInternetUrl } from "../legal/secondary-internet-url";
import { parsePrivateDocumentLocator } from "../document-analysis/private-document-locator";
import { AiUnavailableError } from "../document-builder/ai/openai";
import {
  containsSensitiveAgentContent,
  containsUnvalidatedHttpLink,
  groundedTextComparisonKey,
  nonRepeatingLegalText,
  plainGroundedText,
  sanitizeClarificationQuestions,
} from "./legal-output-safety";
import {
  classifyLegalIntent,
  planLegalResearch,
  rewriteLegalFollowUp,
  type LegalIntentDecision,
  type LegalResearchPlan,
} from "./legal-query-planner";
import {
  forceClarificationWithoutVerifiedSources,
  actionStepSchema,
  legalAssumptionSchema,
  legalRiskSchema,
  legalFindingSchema,
  type LegalChatResponse,
} from "./legal-chat-schema";
import { attachSecondaryReferenceContext } from "./secondary-reference-result";
import { aiText, type AiDiscoveryLocale, type AiOutputLocale } from "./localization";
import {
  aiProviderStatus,
  type AiProviderStatus,
  type LegalAiProvider,
  type LegalEvidenceRoutingDecision,
  type LegalAiRunOptions,
  type LegalAiRunResult,
  type LegalChatRequest,
  type LegalSourceContext,
  type LegalSourceSpan,
} from "./provider";

const claimTypeSchema = z.enum(["legal_basis", "action", "deadline", "risk", "fact"]);

export const legalGatewayClaimSchema = z.object({
  // A gateway claim retains both fields of the largest generated proposition.
  text: z.string().trim().min(1).max(
    legalFindingSchema.shape.title.maxLength! + 2 + legalFindingSchema.shape.explanation.maxLength!,
  ),
  type: claimTypeSchema,
  sourceId: z.string().trim().min(1).max(160).nullable(),
  sourceSpanId: z.string().trim().min(1).max(200).nullable(),
  confidence: z.number().min(0).max(1),
}).strict();

export const legalGatewaySourceSchema = z.object({
  sourceId: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(500),
  article: z.string().trim().max(240).nullable(),
  paragraph: z.string().trim().max(240).nullable(),
  canonicalUrl: z.string().url().max(2_000),
  accessedAt: z.string().datetime({ offset: true }),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const legalGatewayProviderMetadataSchema = z.object({
  provider: z.enum(["openai", "anthropic"]),
  model: z.string().trim().min(1).max(160),
  providerResponseId: z.string().trim().max(240).nullable(),
  // Existing writer/answer assessments plus routing before and after source recovery.
  attempts: z.number().int().min(1).max(12),
  latencyMs: z.number().int().nonnegative(),
  fallbackFromProvider: z.enum(["openai", "anthropic"]).nullable(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
}).strict();

export const legalGatewayAnswerSchema = z.object({
  answer: z.string().trim().min(1).max(20_000),
  claims: z.array(legalGatewayClaimSchema).max(64),
  sources: z.array(legalGatewaySourceSchema).max(MAX_LEGAL_EVIDENCE_SOURCES),
  nextSteps: z.array(z.string().trim().min(1).max(
    actionStepSchema.shape.title.maxLength! + 2 + actionStepSchema.shape.description.maxLength!,
  )).max(16),
  uncertainty: z.array(z.string().trim().min(1).max(Math.max(
    legalAssumptionSchema.shape.statement.maxLength! + 2 + legalAssumptionSchema.shape.impact.maxLength!,
    legalRiskSchema.shape.title.maxLength! + 2 + legalRiskSchema.shape.explanation.maxLength!,
  ))).max(24),
  providerMetadata: legalGatewayProviderMetadataSchema,
}).strict();

export const groundedLegalPreliminarySchema = z.object({
  kind: z.literal("grounded_answer"),
  message: z.string().trim().min(1).max(4_500),
  claim: legalGatewayClaimSchema,
  source: legalGatewaySourceSchema,
}).strict();

export type LegalGatewayClaim = z.infer<typeof legalGatewayClaimSchema>;
export type LegalGatewayAnswer = z.infer<typeof legalGatewayAnswerSchema>;
export type GroundedLegalPreliminary = z.infer<typeof groundedLegalPreliminarySchema>;

export type LegalAiGatewayRunOptions = LegalAiRunOptions & {
  /** One request-owned, scoped retrieval through the authenticated source ladder. */
  recoverEvidence?: (input: LegalChatRequest, missingRequirementIds: readonly string[]) => Promise<RecoveredLegalEvidence>;
  /** Receives only a claim that has passed the authoritative Lex span gate. */
  onGroundedPreliminary?: (preliminary: GroundedLegalPreliminary) => void | Promise<void>;
};

export type ValidatedLegalGatewayResult = {
  evidenceRouting?: {outcome: "assessed" | "unavailable"; requirementIndexes: number[]; safeErrorCode: string | null};
  /** Final authenticated context, present only after revalidation with recovered evidence. */
  recoveredEvidence?: RecoveredLegalEvidence;
  evidenceRecovery?: {outcome: "adopted" | "not_adopted" | "unavailable"; requirementIndexes: number[]; safeErrorCode: string | null};
  contentRepair?: {
    outcome: "repaired" | "incomplete" | "unavailable" | "rejected";
    requirementIndexes: number[];
    safeErrorCode: string | null;
  };
  run: LegalAiRunResult;
  answer: LegalGatewayAnswer;
  removedClaimCount: number;
  coverageDiagnostics: {
    mainPointIncomplete?: true;
    findingAssessmentUnavailable?: true;
    requirementCount: number;
    writerOmissionCount: number;
    validatorRejectionCount: number;
    validatedRequirementCount: number;
    proposedFindingCount: number;
    /** Surviving provider findings; excludes server-authored source-only fallback findings. */
    validatedFindingCount: number;
    proposedActionCount: number;
    validatedActionCount: number;
    validatedGuidanceRequirementCount: number;
    missingGuidanceRequirementCount: number;
    completeRequirementCount: number;
    /** Request-local requirement positions avoid logging question text or IDs.
     * Finding support and independently assessed practical coverage are distinct. */
    unresolvedCoverage: Array<{requirementIndex: number; finding: "omitted" | "rejected" | "assessment_unavailable" | null; guidanceMissing: boolean}>;
  };
};

export interface LegalAiGateway {
  classifyIntent(question: string): LegalIntentDecision;
  rewriteFollowUp(input: {
    question: string;
    locale: AiOutputLocale;
    conversationHistory?: readonly { user: string; assistant: string }[];
  }): { query: string; rewritten: boolean };
  planOfficialResearch(input: {
    question: string;
    locale: AiDiscoveryLocale;
    conversationHistory?: readonly { user: string; assistant: string }[];
  }): LegalResearchPlan;
  generateGroundedAnswer(
    input: LegalChatRequest,
    options?: LegalAiGatewayRunOptions,
  ): Promise<ValidatedLegalGatewayResult>;
  validateAnswerContract(input: {
    result: LegalChatResponse;
    run: LegalAiRunResult;
    sources: readonly LegalSourceContext[];
    question?: string;
    applicableAt?: LegalChatRequest["applicableAt"];
    temporalComparison?: LegalChatRequest["temporalComparison"];
    retrievalQuery?: string;
    coverageRequirements?: LegalChatRequest["coverageRequirements"];
    locale: AiOutputLocale;
    answerMode: "short" | "detailed";
    reasoningMode: "fast" | "deep";
    legalDatabaseAsOf: string;
    availableDocumentTemplateCodes?: readonly string[];
  }): ValidatedLegalGatewayResult;
  providerHealth(): AiProviderStatus;
}

type CandidateClaim = Omit<LegalGatewayClaim, "sourceId" | "sourceSpanId" | "confidence"> & {
  sourceIds: readonly string[];
  rawText?: string;
  supportText?: string;
};

const SOURCE_FALLBACK_CODES = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "INVALID_AI_OUTPUT",
] as const);

function officialLexUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && (url.hostname === "lex.uz" || url.hostname === "www.lex.uz");
  } catch {
    return false;
  }
}

function trustedPrivateSource(source: LegalSourceContext): boolean {
  return source.sourceType === "internal"
    && source.sourceClass === "USER_TRUSTED_PRIVATE"
    && source.verificationState === "user_supplied"
    && source.status === "user_supplied"
    && parsePrivateDocumentLocator(source.officialUrl) !== null
    && /^[a-f0-9]{64}$/u.test(source.contentSha256)
    && source.sourceQuality?.passed === true;
}

function trustedSecondarySource(source: LegalSourceContext): boolean {
  return source.sourceType === "advice"
    && source.sourceClass === "SECONDARY_REFERENCE"
    && source.verificationState === "web_cited"
    && source.status === "unconfirmed"
    && canonicalSecondaryInternetUrl(source.officialUrl) === source.officialUrl
    && /^[a-f0-9]{64}$/u.test(source.contentSha256)
    && source.sourceQuality?.passed === true;
}

function verifiedLexSource(source: LegalSourceContext): boolean {
  return source.sourceType === "lex"
    && ["direct_validated", "verified"].includes(source.verificationState)
    && source.sourceQuality?.passed === true
    && officialLexUrl(source.officialUrl);
}

/**
 * The three publication tiers. `authoritative` may be published as law.
 * `private` is the asker's own document: it can confirm a fact about their
 * situation. `secondary` is public-web reference material: it can explain
 * background but can never establish legislation, a normative deadline, a
 * calculation or a mandatory action, so it is published only as a reference
 * note. Anything else is not publishable at all.
 */
type LegalSourceTier = "authoritative" | "private" | "secondary";

function sourceTier(source: LegalSourceContext): LegalSourceTier | null {
  if (verifiedLexSource(source)) return "authoritative";
  if (trustedPrivateSource(source)) return "private";
  if (trustedSecondarySource(source)) return "secondary";
  return null;
}

function claimTypeForSource(claim: CandidateClaim, source: LegalSourceContext): LegalGatewayClaim["type"] {
  return sourceTier(source) === "authoritative" ? claim.type : "fact";
}

/**
 * Interrogatives, copulas, connectives and answer-format imperatives carry no
 * proposition, so they must not be treated as something a provision has to
 * repeat. This is a closed grammatical class in ru/uz/en — not a legal, topical
 * or synonym vocabulary — so it cannot bias the gate toward any subject matter.
 */
const GRAMMATICAL_FUNCTION_WORD = /^(?:котор\p{L}*|этого|также|чтобы|можно|нужно|нужны|надо|какие|какой|какая|когда|почему|должен|должны|есть|дайте|укажите|ответьте|скажите|uchun|bilan|bo\p{L}*yicha|kerak|keyin|oldin|nima|nimalar|nimani|qanday|qaysi|qachon|nega|bo\p{L}?lishi|bo\p{L}?ladi|javob|please|should|could|would|which|there|about)$/iu;

function legalTerms(value: string, limit = 40): string[] {
  // Uzbek apostrophes are written with several Unicode characters. Treat
  // them as part of the word before tokenization; otherwise a term such as
  // `bo‘lishi` becomes the misleading standalone token `lishi` and can make
  // a correctly grounded Article 14 answer fail the relevance gate.
  const normalized = value.toLocaleLowerCase().replace(/[‘’ʼʻ']/gu, "");
  return [...new Set(normalized.match(/[\p{L}\p{N}]{4,}/gu) ?? [])]
    .filter((term) => !GRAMMATICAL_FUNCTION_WORD.test(term))
    .slice(0, limit);
}

const MIN_SHARED_STEM = 5;
const MAX_COMPARED_TERM_LENGTH = 24;

/**
 * Two words are treated as the same concept when they share a substring of at
 * least five characters. This replaces both a fixed-length prefix root and the
 * per-word normalisation rules it needed: `зарегистрировать` and `регистрации`
 * share `регистра`, and `ustavida` matches `ustavining`, without any synonym
 * table, prefix list or topic vocabulary. Work is bounded by the token length
 * cap, so a long pasted word cannot make this expensive.
 */
function sharesStem(left: string, right: string): boolean {
  const a = left.slice(0, MAX_COMPARED_TERM_LENGTH);
  const b = right.slice(0, MAX_COMPARED_TERM_LENGTH);
  if (a.length < MIN_SHARED_STEM || b.length < MIN_SHARED_STEM) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  for (let start = 0; start + MIN_SHARED_STEM <= shorter.length; start += 1) {
    if (longer.includes(shorter.slice(start, start + MIN_SHARED_STEM))) return true;
  }
  return false;
}

function evidenceTermMatcher(text: string): (term: string) => boolean {
  // The claim is bounded, but its evidence can establish an operative rule
  // anywhere in the verified span. Index all evidence terms once so a late
  // clause is not silently excluded and matching stays linear in source size.
  const terms = new Set(legalTerms(text, Infinity));
  const stems = new Set<string>();
  for (const term of terms) {
    const bounded = term.slice(0, MAX_COMPARED_TERM_LENGTH);
    for (let offset = 0; offset + MIN_SHARED_STEM <= bounded.length; offset += 1) {
      stems.add(bounded.slice(offset, offset + MIN_SHARED_STEM));
    }
  }
  return term => {
    if (terms.has(term)) return true;
    const bounded = term.slice(0, MAX_COMPARED_TERM_LENGTH);
    for (let offset = 0; offset + MIN_SHARED_STEM <= bounded.length; offset += 1) {
      if (stems.has(bounded.slice(offset, offset + MIN_SHARED_STEM))) return true;
    }
    return false;
  };
}

/**
 * Terms shorter than the shared-stem window are abbreviations and short forms
 * (a legal form, a party code) that name the act rather than the requested
 * proposition. Demanding that a provision repeat them only produces false
 * negatives, so length — not a list of words — decides what must be matched.
 */
function numericTokens(value: string): string[] {
  return groundingNumericTokens(value);
}

function normalizedText(value: string): string {
  return plainGroundedText(value).toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

function spanCoverage(text: string, span: LegalSourceSpan): number {
  const terms = legalTerms(plainGroundedText(text));
  if (terms.length === 0) return 0;
  return terms.filter(evidenceTermMatcher(span.text)).length / terms.length;
}

function validateSpanForClaim(
  claim: CandidateClaim,
  source: LegalSourceContext,
  span: LegalSourceSpan,
  allowedUrls: ReadonlySet<string>,
  deferNumericCheck = false,
  exactSpanSemanticallySupported = false,
): boolean {
  const tier = sourceTier(source);
  if (!tier) return false;
  // A non-authoritative source may support a statement that JURO will later
  // demote to a fact or a reference note, but it must never be the evidence
  // behind a mandatory action, a normative deadline or a legal risk. Those
  // candidate types are rejected outright here; the demotion of what survives
  // happens in validateLegalGatewayAnswer, which is the only place that may
  // publish a claim.
  if (tier !== "authoritative" && claim.type !== "legal_basis") return false;
  if (containsSensitiveAgentContent(claim.rawText ?? claim.text)) return false;
  if (containsUnvalidatedHttpLink(claim.rawText ?? claim.text, allowedUrls)) return false;
  if (span.quality !== "high" || containsLegalSourceUiNoise(span.text)) return false;
  if (!/^[a-f0-9]{64}$/u.test(span.textSha256)) return false;
  const spanNumbers = new Set(numericTokens(span.text));
  if (!deferNumericCheck && numericTokens(claim.text).some((token) => !spanNumbers.has(token))) return false;
  if (exactSpanSemanticallySupported) return true;
  const coverage = spanCoverage(claim.text, span);
  if (claim.supportText && legalTerms(claim.supportText).length > 0
    && spanCoverage(claim.supportText, span) < 0.35) return false;
  const termCount = legalTerms(plainGroundedText(claim.text)).length;
  return coverage >= 0.35 && (termCount < 4 || coverage * termCount >= 2);
}

function bestValidatedSpan(
  claim: CandidateClaim,
  sources: ReadonlyMap<string, LegalSourceContext>,
  deferNumericCheck = false,
  independentlySupported = false,
): { source: LegalSourceContext; span: LegalSourceSpan; coverage: number } | null {
  let best: { source: LegalSourceContext; span: LegalSourceSpan; coverage: number } | null = null;
  const allowedUrls = new Set([...sources.values()].map((source) => source.officialUrl));
  for (const sourceId of claim.sourceIds) {
    const source = sources.get(sourceId);
    if (!source) continue;
    for (const span of source.spans ?? []) {
      // A source-level semantic decision identifies this exact evidence span
      // only when the source has one span. Multi-span sources still need the
      // existing span-selection proof; never choose an arbitrary approved row.
      const exactSpanSemanticallySupported = independentlySupported
        && sourceTier(source) === "authoritative" && source.spans?.length === 1;
      if (!validateSpanForClaim(claim, source, span, allowedUrls, deferNumericCheck, exactSpanSemanticallySupported)) continue;
      const coverage = spanCoverage(claim.text, span);
      if (!best || coverage > best.coverage) best = { source, span, coverage };
    }
  }
  return best;
}

function candidateClaims(result: LegalChatResponse): CandidateClaim[] {
  const claim = (title: string, explanation: string) => {
    const rawText = `${title}. ${explanation}`;
    return { text: nonRepeatingLegalText(title, explanation), rawText, supportText: explanation };
  };
  return [
    ...result.confirmedFindings.map((finding) => ({
      ...claim(finding.title, finding.explanation),
      type: "legal_basis" as const,
      sourceIds: finding.sourceIds,
    })),
    ...(result.conditionalBranches ?? []).map((branch) => ({
      ...claim(branch.condition, branch.outcome),
      type: "legal_basis" as const,
      sourceIds: branch.sourceIds,
    })),
    ...result.actionPlan.filter((step) => step.sourceIds.length > 0).map((step) => ({
      ...claim(step.title, step.description),
      type: "action" as const,
      sourceIds: step.sourceIds,
    })),
    ...result.risks.filter((risk) => risk.sourceIds.length > 0).map((risk) => ({
      ...claim(risk.title, risk.explanation),
      type: "risk" as const,
      sourceIds: risk.sourceIds,
    })),
    ...result.deadlines.filter((deadline) => deadline.confidence === "confirmed").map((deadline) => ({
      text: plainGroundedText(`${deadline.title}. ${deadline.dueDate ?? ""} ${deadline.calculationMethod}`),
      rawText: `${deadline.title}. ${deadline.dueDate ?? ""} ${deadline.calculationMethod}`,
      type: "deadline" as const,
      sourceIds: deadline.sourceIds,
    })),
  ];
}

function sourceMetadata(source: LegalSourceContext, span: LegalSourceSpan) {
  return {
    sourceId: source.id,
    title: boundedRequiredMetadata(source.actTitle, 500, "Официальный источник"),
    article: boundedNullableMetadata(span.article ?? source.article, 240),
    paragraph: boundedNullableMetadata(span.paragraph, 240),
    canonicalUrl: source.officialUrl,
    accessedAt: source.verifiedAt,
    contentSha256: source.contentSha256,
  };
}

function groundedProvisionTitle(source: LegalSourceContext, span: LegalSourceSpan): string {
  const article = boundedNullableMetadata(span.article ?? source.article, 160);
  if (!article) return source.actTitle.slice(0, 240);
  const articleNumber = article.match(/\d+(?:[.-]\d+)?/u)?.[0];
  if (!articleNumber) return `${article} — ${source.actTitle}`.slice(0, 240);
  const prefix = source.locale === "ru" ? `Ст. ${articleNumber}` : `${articleNumber}-modda`;
  return `${prefix} — ${source.actTitle}`.slice(0, 240);
}

function boundedNullableMetadata(value: string | null | undefined, maxLength: number): string | null {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function boundedRequiredMetadata(value: string | null | undefined, maxLength: number, fallback: string): string {
  return boundedNullableMetadata(value, maxLength) ?? fallback;
}

function filteredLegacyResult(
  result: LegalChatResponse,
  validClaims: readonly LegalGatewayClaim[],
  validSourceIds: ReadonlySet<string>,
  availableDocumentTemplateCodes: ReadonlySet<string>,
  redundantCitations: ReadonlyMap<string, ReadonlySet<string>>,
  actionOrigins: Map<LegalChatResponse["actionPlan"][number], LegalChatResponse["actionPlan"][number]>,
  findingOrigins: Map<LegalChatResponse["confirmedFindings"][number], LegalChatResponse["confirmedFindings"][number]>,
): LegalChatResponse {
  const retainedSources = (title: string, explanation: string, sourceIds: readonly string[]) =>
    sourceIds.filter(id => !redundantCitations.get(nonRepeatingLegalText(title, explanation))?.has(id));
  const supported = (title: string, explanation: string, sourceIds: readonly string[]) => {
    const text = nonRepeatingLegalText(title, explanation);
    const retained = retainedSources(title, explanation, sourceIds);
    return retained.length > 0 && retained.every(sourceId => validSourceIds.has(sourceId) &&
      validClaims.some(claim => claim.text === text && claim.sourceId === sourceId));
  };
  return {
    ...result,
    confirmedFindings: result.confirmedFindings.filter((finding) =>
      supported(finding.title, finding.explanation, finding.sourceIds),
    ).map((finding) => {
      const retained = {...finding, sourceIds: retainedSources(finding.title, finding.explanation, finding.sourceIds),
        title: plainGroundedText(finding.title), explanation: plainGroundedText(finding.explanation)};
      // Formatting preserves the assessed proposition. Dropping an assessed
      // citation does not preserve the proof of its complete support set.
      if (retained.sourceIds.length === finding.sourceIds.length) findingOrigins.set(retained, finding);
      return retained;
    }),
    conditionalBranches: (result.conditionalBranches ?? []).filter((branch) =>
      supported(branch.condition, branch.outcome, branch.sourceIds),
    ).map((branch) => ({
      ...branch,
      sourceIds: retainedSources(branch.condition, branch.outcome, branch.sourceIds),
      condition: plainGroundedText(branch.condition),
      outcome: plainGroundedText(branch.outcome),
    })),
    risks: result.risks.filter((risk) =>
      supported(risk.title, risk.explanation, risk.sourceIds),
    ).map((risk) => ({ ...risk, sourceIds: retainedSources(risk.title, risk.explanation, risk.sourceIds),
      title: plainGroundedText(risk.title), explanation: plainGroundedText(risk.explanation) })),
    actionPlan: result.actionPlan.filter((step) =>
      supported(step.title, step.description, step.sourceIds),
    ).map((step) => {
      const retained = {...step, sourceIds: retainedSources(step.title, step.description, step.sourceIds),
        title: plainGroundedText(step.title), description: plainGroundedText(step.description)};
      actionOrigins.set(retained, step);
      return retained;
    }),
    deadlines: result.deadlines.filter((deadline) =>
      validClaims.some((claim) => claim.type === "deadline"
        && claim.text.startsWith(`${plainGroundedText(deadline.title)}.`)),
    ).map((deadline) => ({
      ...deadline,
      title: plainGroundedText(deadline.title),
      calculationMethod: plainGroundedText(deadline.calculationMethod),
    })),
    sources: [],
    suggestedDocument: result.suggestedDocument
      && result.suggestedDocument.templateCode
      && availableDocumentTemplateCodes.has(result.suggestedDocument.templateCode)
      && !containsSensitiveAgentContent(`${result.suggestedDocument.title}\n${result.suggestedDocument.reason}`)
      && !containsUnvalidatedHttpLink(`${result.suggestedDocument.title}\n${result.suggestedDocument.reason}`, new Set())
      ? {
        ...result.suggestedDocument,
        title: plainGroundedText(result.suggestedDocument.title),
        reason: plainGroundedText(result.suggestedDocument.reason),
      }
      : null,
  };
}

function groundedVisibleAnswer(
  claims: readonly LegalGatewayClaim[],
  locale: AiOutputLocale,
  labelled = false,
  limit = 3,
): string {
  const seen = new Set<string>();
  const statements = claims.flatMap((claim) => {
    const statement = claim.text.trim();
    const key = groundedTextComparisonKey(statement);
    if (!key || seen.has(key)) return [];
    seen.add(key);
    return [statement];
  }).slice(0, limit);
  if (!labelled) return statements.join(" ");
  return aiText(locale, `Краткий вывод: ${statements.join(" ")}`, `Qisqa xulosa: ${statements.join(" ")}`, `Key finding: ${statements.join(" ")}`);
}

function groundedMainPoint(result: LegalChatResponse, claims: readonly LegalGatewayClaim[],
  requirements: LegalChatRequest["coverageRequirements"] = [], contextualGoverning: ReadonlySet<LegalChatResponse["confirmedFindings"][number]> = new Set(), independentlySupported = false): {text: string | null; acceptedSummary: boolean} {
  const summary = plainGroundedText(result.summary);
  const supportedFindings = result.confirmedFindings.filter((item) => claims.some((claim) =>
    claim.text === nonRepeatingLegalText(item.title, item.explanation)));
  const governingFindings = supportedFindings.filter(item => item.answerRole === "governing_rule" || contextualGoverning.has(item));
  const forumFindings = requirements.filter(requirement => requirement.priority === "core"
    && requirement.scopeKind === "forum").flatMap(requirement => {
      const finding = governingFindings.find(item => item.requirementIds?.includes(requirement.id)
        && item.sourceIds.some(id => requirement.sourceIds.includes(id)));
      return finding ? [finding] : [];
    });
  const summarySourceIds = result.summarySourceIds;
  const summaryClaims = summarySourceIds
    ? claims.filter(claim => claim.sourceId !== null && summarySourceIds.includes(claim.sourceId)) : claims;
  const evidenceText = summaryClaims.map((claim) => claim.text).join(" ");
  const terms = legalTerms(summary);
  const covered = terms.filter(evidenceTermMatcher(evidenceText)).length;
  const acceptedSummary = independentlySupported && summary.length <= 650 && terms.length > 0 && covered / terms.length >= 0.8
    && forumFindings.every(finding => finding.sourceIds.some(id => summarySourceIds?.includes(id)))
    && (!summarySourceIds || (summarySourceIds.length > 0
      && summarySourceIds.every(id => summaryClaims.some(claim => claim.sourceId === id))))
    && numericTokens(summary).every((token) => numericTokens(evidenceText).includes(token))
    && !containsSensitiveAgentContent(summary)
    && !containsUnvalidatedHttpLink(summary, new Set())
    && !/^(?:Ст\.?|Статья|Article)\s*\d/iu.test(summary);
  console.info(JSON.stringify({event: "legal.main_point_validated", acceptedSummary,
    characters: summary.length, termCoverage: terms.length ? covered / terms.length : 0,
    numbersSupported: numericTokens(summary).every(token => numericTokens(evidenceText).includes(token))}));
  if (acceptedSummary) return {text: summary, acceptedSummary: true};
  // Synthesis orders findings with the ordinary governing rule first. Keep
  // that validated conclusion ahead of branches that may contain only exceptions.
  const finding = governingFindings[0] ?? supportedFindings[0];
  const coreIds = new Set(requirements.filter(requirement => requirement.priority === "core").map(requirement => requirement.id));
  const coreFindings = supportedFindings.filter(item => item.requirementIds?.some(id => coreIds.has(id)));
  if (governingFindings.length && coreFindings.length > 1) {
    // A fallback has no independently validated compression. Preserve the
    // complete core explanations, including qualifications and procedures,
    // rather than guessing which clauses can be omitted from the first rule.
    const ordered = [...new Set([...governingFindings.filter(item => coreFindings.includes(item)), ...coreFindings])];
    const text = ordered.map(item => plainGroundedText(item.explanation)).join(" ");
    if (text.length <= 1_500) return {text, acceptedSummary: false};
    console.info(JSON.stringify({event: "legal.main_point_incomplete", findingCount: ordered.length, characters: text.length}));
    return {text: null, acceptedSummary: false};
  }
  // Keep independent forum rules together when their complete validated prose
  // fits a concise summary. Never cut a sentence or its legal conditions.
  const ordinaryRules = [...new Set([finding, ...forumFindings].filter(
    (item): item is NonNullable<typeof item> => Boolean(item)))];
  const ordinaryText = ordinaryRules.map(item => plainGroundedText(item.explanation)).join(" ");
  if (ordinaryRules.length > 1 && ordinaryText.length <= 650) return {text: ordinaryText, acceptedSummary: false};
  if (finding) return {text: plainGroundedText(finding.explanation), acceptedSummary: false};
  const branches = (result.conditionalBranches ?? []).filter((branch) => claims.some((claim) =>
    claim.text === nonRepeatingLegalText(branch.condition, branch.outcome))).slice(0, 3);
  if (branches.length > 0) return {text: branches.map((branch) =>
    `${branches.length > 1 ? "- " : ""}${plainGroundedText(branch.condition)}: ${plainGroundedText(branch.outcome)}`).join("\n\n"), acceptedSummary: false};
  // The finding explanation is already validated. Its title is presentation
  // metadata and must not be pasted in front of the conclusion a second time.
  return {text: plainGroundedText(claims[0]?.text || result.summary), acceptedSummary: false};
}

export function validateGroundedPreliminaryFinding(input: {
  finding: unknown;
  sources: readonly LegalSourceContext[];
  question?: string;
  locale: AiOutputLocale;
}): GroundedLegalPreliminary | null {
  const parsed = legalFindingSchema.safeParse(input.finding);
  if (!parsed.success) return null;
  const candidate: CandidateClaim = {
    text: nonRepeatingLegalText(parsed.data.title, parsed.data.explanation),
    supportText: parsed.data.explanation,
    type: "legal_basis",
    sourceIds: parsed.data.sourceIds,
  };
  const match = bestValidatedSpan(
    candidate,
    new Map(input.sources.map((source) => [source.id, source])),
  );
  if (!match) return null;
  // Streaming preliminaries are intentionally limited to authoritative law.
  // Private files and public-web material may ground terminal factual claims or
  // reference notes only after the complete answer has passed the same
  // tenant-scoped final validation path.
  if (sourceTier(match.source) !== "authoritative") return null;
  const claim: LegalGatewayClaim = {
    text: candidate.text,
    type: candidate.type,
    sourceId: match.source.id,
    sourceSpanId: match.span.id,
    confidence: Math.min(1, Math.max(0.5, match.coverage)),
  };
  return groundedLegalPreliminarySchema.parse({
    kind: "grounded_answer",
    message: groundedVisibleAnswer([claim], input.locale, true),
    claim,
    source: sourceMetadata(match.source, match.span),
  });
}

function preliminaryFromValidatedResult(
  result: ValidatedLegalGatewayResult,
  locale: AiOutputLocale,
): GroundedLegalPreliminary | null {
  // `type: "fact"` marks a claim that was grounded on a private document or on
  // public-web material. Those must never be streamed as a legal conclusion, so
  // only authoritative claim types are eligible to become a preliminary.
  const claim = result.answer.claims.find((candidate) =>
    candidate.sourceId && candidate.sourceSpanId && candidate.type !== "fact");
  if (!claim?.sourceId) return null;
  const source = result.answer.sources.find((candidate) => candidate.sourceId === claim.sourceId);
  if (!source) return null;
  return groundedLegalPreliminarySchema.parse({
    kind: "grounded_answer",
    message: groundedVisibleAnswer([claim], locale, true),
    claim,
    source,
  });
}

function canonicalLegacySource(
  source: LegalSourceContext,
  span: LegalSourceSpan,
): LegalChatResponse["sources"][number] {
  const language = source.locale === "uzc" ? "uz-Cyrl" as const
    : source.locale === "uz" ? "uz-Latn" as const
      : source.locale === "en" ? "en" as const : "ru" as const;
  return {
    sourceId: source.id,
    actTitle: boundedRequiredMetadata(source.actTitle, 500, "Официальный источник"),
    actIdentifier: boundedNullableMetadata(source.actIdentifier, 240),
    article: boundedNullableMetadata(span.article ?? source.article, 240),
    excerpt: null,
    originalUrl: source.officialUrl,
    status: source.sourceClass === "SECONDARY_REFERENCE" ? "unconfirmed" : source.applicabilityStatus ?? "current",
    effectiveDate: boundedNullableMetadata(source.effectiveDate, 64),
    verifiedAt: boundedRequiredMetadata(source.verifiedAt, 64, new Date(0).toISOString()),
    documentType: boundedNullableMetadata(source.documentType, 160),
    documentNumber: boundedNullableMetadata(source.documentNumber ?? source.actIdentifier, 240),
    adoptingAuthority: boundedNullableMetadata(source.adoptingAuthority, 500),
    sourceClass: source.sourceClass ?? "OFFICIAL_LEGISLATION",
    language,
    sourceOrigin: source.verificationState === "web_cited"
      ? "web"
      : source.verificationState === "direct_validated" ? "live" : "indexed",
  };
}

/**
 * Last resort when no provider claim survives: publish one exact sentence of
 * the highest-ranked exact span instead of discarding request-owned evidence.
 * Source tier still decides whether that sentence is law, a private fact, or a
 * non-authoritative reference note.
 */
function sourceGroundedFallback(
  sources: readonly LegalSourceContext[],
  question?: string,
): { claim: LegalGatewayClaim; source: LegalSourceContext; span: LegalSourceSpan } | null {
  const questionTerms = question ? legalTerms(question) : [];
  const sourceMap = new Map(sources.map((source) => [source.id, source]));
  const allowedUrls = new Set(sources.map((source) => source.officialUrl));
  for (const source of sources) {
    if (!sourceTier(source)) continue;
    for (const span of source.spans ?? []) {
      if (questionTerms.length > 0) {
        const sourceTerms = legalTerms([
          source.actTitle,
          source.article,
          span.article,
          span.text,
        ].filter(Boolean).join(" "));
        const matches = questionTerms.filter((term) => sourceTerms.some((candidate) =>
          candidate === term || sharesStem(term, candidate)
        )).length;
        const required = questionTerms.length === 1
          ? 1
          : Math.min(4, Math.max(2, Math.ceil(questionTerms.length / 4)));
        if (matches < required) continue;
      }
      const normalized = span.text
        .replace(/\s+/gu, " ")
        .trim();
      const articleHeadingKey = groundedTextComparisonKey(span.article ?? "")
        .replace(/^(?:статья|ст|модда|modda|article)?\s*\d+(?:[.-]\d+)?\s*/iu, "")
        .trim();
      const sentences = normalized
        .split(/(?<=[.!?])\s+/u)
        .map((part) => part.trim());
      const sentence = (sentences.find((part) => {
        if (part.length < 40) return false;
        const partKey = groundedTextComparisonKey(part)
          .replace(/^(?:статья|ст|модда|modda|article)?\s*\d+(?:[.-]\d+)?\s*/iu, "")
          .trim();
        // Long provision headings often form their own sentence. Prefer the
        // operative text below the heading when it is present.
        return !articleHeadingKey
          || (partKey !== articleHeadingKey
            && !articleHeadingKey.includes(partKey)
            && !partKey.includes(articleHeadingKey));
      }) ?? sentences.find((part) => part.length >= 40) ?? normalized)
        .slice(0, 1_200);
      if (sentence.length < 40 || containsSensitiveAgentContent(sentence)) continue;
      const candidate: CandidateClaim = {
        text: sentence,
        type: "legal_basis",
        sourceIds: [source.id],
      };
      if (!validateSpanForClaim(candidate, source, span, allowedUrls)) continue;
      return {
        claim: {
          text: sentence,
          type: claimTypeForSource(candidate, sourceMap.get(source.id) ?? source),
          sourceId: source.id,
          sourceSpanId: span.id,
          confidence: 1,
        },
        source,
        span,
      };
    }
  }
  return null;
}

/**
 * Preserves verified evidence when synthesis providers are unavailable.
 * Every visible legal sentence is copied from an exact, hashed request-owned
 * span and passes the same claim/span validation as a provider-authored claim.
 * This is deliberately a limited source reader, not a model-free legal
 * opinion: it emits no inferred action, deadline, risk, or outcome.
 */
export function buildVerifiedSourceOnlyFallback(input: {
  sources: readonly LegalSourceContext[];
  question?: string;
  retrievalQuery?: string;
  coverageRequirements?: LegalChatRequest["coverageRequirements"];
  locale: AiOutputLocale;
  answerMode: "short" | "detailed";
  reasoningMode: "fast" | "deep";
  legalDatabaseAsOf: string;
  provider: "openai" | "anthropic";
  model: string;
  attempts: number;
  latencyMs: number;
  reason: "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "INVALID_AI_OUTPUT";
}): ValidatedLegalGatewayResult | null {
  const firstDeterministic = input.sources.find((source) =>
    source.retrievalSelection === "deterministic_fallback");
  const fallbackSources = [
    ...(firstDeterministic ? [firstDeterministic] : []),
    ...input.sources.filter((source) => source.retrievalSelection !== "deterministic_fallback"),
  ];
  const grounded = fallbackSources.flatMap((source) => {
    const fallback = sourceGroundedFallback([source]);
    return fallback ? [fallback] : [];
  }).slice(0, input.answerMode === "short" ? 1 : 4);
  if (grounded.length === 0) return null;

  const exactText = grounded.map(({ claim }) => claim.text).join(" ");
  const response: LegalChatResponse = {
    confirmedFindings: grounded.map(({ claim, source, span }) => ({
      title: groundedProvisionTitle(source, span),
      explanation: claim.text,
      sourceIds: [source.id],
    })),
    responseKind: "clarification_required",
    summary: aiText(input.locale, "Показаны точные положения из проверенных источников.", "Tekshirilgan manbalardagi aniq qoidalar ko‘rsatildi.", "Exact provisions from verified sources are shown."),
    answer: exactText,
    language: input.locale,
    jurisdiction: "UZ",
    answerMode: input.answerMode,
    reasoningMode: input.reasoningMode,
    clarificationQuestions: [],
    assumptions: [],
    risks: [],
    sources: [],
    requiredDocuments: [],
    actionPlan: [],
    deadlines: [],
    successOutlook: null,
    urgency: "normal",
    suggestedDocument: null,
    suggestLawyer: true,
    legalDatabaseAsOf: input.legalDatabaseAsOf,
  };
  const run: LegalAiRunResult = {
    data: response,
    provider: input.provider,
    model: input.model,
    providerResponseId: null,
    attempts: Math.max(1, Math.min(3, Math.trunc(input.attempts))),
    latencyMs: Math.max(0, Math.trunc(input.latencyMs)),
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
    fallbackFromProvider: null,
    sourceFallback: true,
    sourceFallbackReason: input.reason,
  };
  return validateLegalGatewayAnswer({
    result: response,
    run,
    sources: input.sources,
    question: input.question,
    retrievalQuery: input.retrievalQuery,
    coverageRequirements: input.coverageRequirements,
    locale: input.locale,
    answerMode: input.answerMode,
    reasoningMode: input.reasoningMode,
    legalDatabaseAsOf: input.legalDatabaseAsOf,
  });
}

export function validateLegalGatewayAnswer(input: {
  result: LegalChatResponse;
  run: LegalAiRunResult;
  sources: readonly LegalSourceContext[];
  question?: string;
  applicableAt?: LegalChatRequest["applicableAt"];
  temporalComparison?: LegalChatRequest["temporalComparison"];
  retrievalQuery?: string;
  coverageRequirements?: LegalChatRequest["coverageRequirements"];
  locale: AiOutputLocale;
  answerMode: "short" | "detailed";
  reasoningMode: "fast" | "deep";
  legalDatabaseAsOf: string;
  availableDocumentTemplateCodes?: readonly string[];
}): ValidatedLegalGatewayResult {
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const proposedCandidates = candidateClaims(input.result);
  const actionDecisions = assessedGuidanceActions({...input, actions: input.result.actionPlan,
    assessments: input.run.guidanceAssessments ?? []});
  const findingDecisions = assessedFindingSources(input, input.result.confirmedFindings, input.run.findingAssessments ?? []);
  const assessedResult = {...input.result, confirmedFindings: input.result.confirmedFindings.flatMap(finding => {
    const sourceIds = findingDecisions.get(finding);
    return sourceIds ? sourceIds.length ? [{...finding, sourceIds}] : [] : [finding];
  }), actionPlan: input.result.actionPlan.filter(action => actionDecisions.get(action) !== false)};
  const independentlySupportedFindings = new Set(input.result.confirmedFindings.flatMap(finding => {
    const sourceIds = findingDecisions.get(finding);
    return sourceIds?.length ? [JSON.stringify([`${finding.title}. ${finding.explanation}`, [...sourceIds].sort()])] : [];
  }));
  const candidates = candidateClaims(assessedResult);
  const redundantCitations = new Map<string, Set<string>>();
  const assessedActionClaims = new Set([...actionDecisions].filter(([, supported]) => supported)
    .map(([action]) => JSON.stringify([`${action.title}. ${action.description}`, [...action.sourceIds].sort()])));
  const independentlySupportedAction = (claim: CandidateClaim) => claim.type === "action"
    && assessedActionClaims.has(JSON.stringify([claim.rawText, [...claim.sourceIds].sort()]));
  const independentlySupportedFinding = (claim: CandidateClaim) => claim.type === "legal_basis"
    && independentlySupportedFindings.has(JSON.stringify([claim.rawText, [...claim.sourceIds].sort()]));
  const providerValidated = candidates.flatMap((claim): LegalGatewayClaim[] => {
    let matches = [...new Set(claim.sourceIds)].flatMap(sourceId => {
      const match = bestValidatedSpan({ ...claim, supportText: undefined, sourceIds: [sourceId] }, sourceById, true,
        independentlySupportedFinding(claim) || independentlySupportedAction(claim));
      return match ? [match] : [];
    }).sort((left, right) => right.coverage - left.coverage);
    if (matches.some(match => sourceTier(match.source) !== "authoritative")) {
      // Never let private facts or contextual web material supply a number or
      // qualification that would authorize a claim about official law.
      matches = [...new Set(claim.sourceIds)].flatMap(sourceId => {
        const match = bestValidatedSpan({...claim, sourceIds: [sourceId]}, sourceById);
        return match ? [match] : [];
      }).sort((left, right) => right.coverage - left.coverage);
    }
    const supportedNumbers = new Set(matches.flatMap(match => numericTokens(match.span.text)));
    if (numericTokens(claim.text).some(token => !supportedNumbers.has(token))) return [];
    // A rule and its qualification can be established by different cited
    // provisions. Validate the explanation against that verified citation set,
    // rather than requiring every complementary provision to repeat it.
    if (claim.supportText && legalTerms(claim.supportText).length > 0
      && !matches.some(match => spanCoverage(claim.supportText!, match.span) >= 0.35)) return [];
    const terms = legalTerms(plainGroundedText(claim.text), Infinity);
    const covered = new Set<string>();
    const coveredNumbers = new Set<string>();
    const retainedEvidence: string[] = [];
    // Keep equally supporting citations and complementary evidence. A weaker
    // overlap that adds no claim support must not acquire a citation merely
    // because another provision supports the complete statement.
    return matches.flatMap(match => {
      const supported = terms.filter(evidenceTermMatcher(match.span.text));
      const numbers = numericTokens(match.span.text).filter(token => numericTokens(claim.text).includes(token));
      if (match.coverage < matches[0]!.coverage && supported.every(term => covered.has(term))
        && numbers.every(token => coveredNumbers.has(token))) {
        // Lexical overlap cannot prove that a removed citation contributes no
        // qualification. Salvage only explanations directly present in the
        // retained evidence; paraphrases keep the existing fail-closed gate.
        if (claim.supportText && retainedEvidence.some(text =>
          normalizedText(text).includes(normalizedText(claim.supportText!)))) {
          const redundant = redundantCitations.get(claim.text) ?? new Set<string>();
          redundant.add(match.source.id);
          redundantCitations.set(claim.text, redundant);
          return [];
        }
        // A request-bound independent assessment has checked the action's own
        // cited texts and cumulative restrictions. Token overlap alone cannot
        // discard a complementary citation from that approved evidence set.
        if (!independentlySupportedAction(claim) && !independentlySupportedFinding(claim)) return [];
      }
      retainedEvidence.push(match.span.text);
      supported.forEach(term => covered.add(term));
      numbers.forEach(token => coveredNumbers.add(token));
      return [{ text: claim.text, type: claimTypeForSource(claim, match.source),
        sourceId: match.source.id, sourceSpanId: match.span.id,
        confidence: Math.min(1, Math.max(0.5, match.coverage)) }];
    });
  });
  const validationQuestion = [input.question, input.retrievalQuery]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
  console.info(JSON.stringify({event: "legal.answer_evidence_usage", sources: input.sources.map((source, index) => ({
    index, spanCharacters: (source.spans ?? []).reduce((total, span) => total + span.text.length, 0),
    proposedClaims: proposedCandidates.filter(claim => claim.sourceIds.includes(source.id)).length,
    validatedClaims: providerValidated.filter(claim => claim.sourceId === source.id).length,
  }))}));
  const fallback = providerValidated.length === 0
    ? sourceGroundedFallback(input.sources, validationQuestion)
    : null;
  const providerOrFallback = fallback ? [fallback.claim] : providerValidated;
  const alreadyGroundedSourceIds = new Set(providerOrFallback.flatMap((claim) =>
    claim.sourceId ? [claim.sourceId] : [],
  ));
  // Successful synthesis publishes only validated claims. A limited source
  // reader may expose additional verified excerpts, clearly marked incomplete.
  const serverGroundedOfficial = input.run.sourceFallback
    ? input.sources.flatMap((source) => {
      if (sourceTier(source) !== "authoritative" || alreadyGroundedSourceIds.has(source.id)) return [];
      const matched = sourceGroundedFallback([source], validationQuestion);
      return matched ? [matched] : [];
    }).slice(0, 12)
    : [];
  for (const { source } of serverGroundedOfficial) alreadyGroundedSourceIds.add(source.id);
  // Public-web material is already a server-refetched exact span. Preserve up
  // to three such references even when the answer model focused only on the
  // official norm; otherwise useful open-web research silently disappears
  // from the response despite having passed the lower-authority source gate.
  const serverGroundedSecondary = input.sources.flatMap((source) => {
    if (sourceTier(source) !== "secondary" || alreadyGroundedSourceIds.has(source.id)) return [];
    const grounded = sourceGroundedFallback([source]);
    return grounded ? [grounded.claim] : [];
  }).slice(0, 3);
  const validated = [
    ...providerOrFallback,
    ...serverGroundedOfficial.map(({ claim }) => claim),
    ...serverGroundedSecondary,
  ];
  const validSourceIds = new Set(validated.flatMap((claim) => claim.sourceId ? [claim.sourceId] : []));
  // Open-web material counts as a source found — the ladder did return
  // something, so JURO does not refuse — but it can only ever be published as a
  // reference note. Splitting here, before anything is rendered, is what keeps
  // it out of `confirmedFindings` and therefore out of the "confirmed by
  // sources" heading.
  const isSecondaryClaim = (claim: LegalGatewayClaim) => {
    const source = claim.sourceId ? sourceById.get(claim.sourceId) : null;
    return Boolean(source && sourceTier(source) === "secondary");
  };
  const publishable = validated.filter((claim) => !isSecondaryClaim(claim));
  const secondaryClaims = validated.filter(isSecondaryClaim);
  const referenceNotes = secondaryClaims.slice(0, 8).flatMap((claim) => {
    const source = claim.sourceId ? sourceById.get(claim.sourceId) : null;
    if (!source || !claim.sourceId) return [];
    const linkLabel = aiText(input.locale, "Открыть справочный источник", "Ma’lumotnoma manbasini ochish", "Open reference source");
    return [{
      title: source.actTitle.slice(0, 240),
      note: `${claim.text.slice(0, 800)}\n\n[${linkLabel}](${source.officialUrl})`.slice(0, 3_000),
      sourceIds: [claim.sourceId],
    }];
  });
  const firstSpanBySource = new Map<string, LegalSourceSpan>();
  for (const claim of validated) {
    const source = claim.sourceId ? sourceById.get(claim.sourceId) : null;
    const span = source?.spans?.find((candidate) => candidate.id === claim.sourceSpanId);
    if (source && span && !firstSpanBySource.has(source.id)) firstSpanBySource.set(source.id, span);
  }
  const actionOrigins = new Map<LegalChatResponse["actionPlan"][number], LegalChatResponse["actionPlan"][number]>();
  const findingOrigins = new Map<LegalChatResponse["confirmedFindings"][number], LegalChatResponse["confirmedFindings"][number]>();
  const filtered = filteredLegacyResult(
    assessedResult,
    publishable,
    validSourceIds,
    new Set(input.availableDocumentTemplateCodes ?? []),
    redundantCitations,
    actionOrigins,
    findingOrigins,
  );
  const visibleProviderSourceIds = new Set([
    ...filtered.confirmedFindings.flatMap((finding) => finding.sourceIds),
    ...(filtered.conditionalBranches ?? []).flatMap((branch) => branch.sourceIds),
    ...filtered.actionPlan.flatMap((step) => step.sourceIds),
    ...filtered.risks.flatMap((risk) => risk.sourceIds),
    ...filtered.deadlines.flatMap((deadline) => deadline.sourceIds),
  ]);
  const visibleServerGroundedOfficial = serverGroundedOfficial.filter(({ source }) =>
    !visibleProviderSourceIds.has(source.id));
  const serverFinding = ({ claim, source, span }:
    typeof serverGroundedOfficial[number]) => ({
      title: groundedProvisionTitle(source, span),
      explanation: claim.text,
      sourceIds: [source.id],
    });
  const grounded = fallback
    ? {
      ...filtered,
      confirmedFindings: [serverFinding(fallback), ...visibleServerGroundedOfficial
        .filter(({ source }) => source.id !== fallback.source.id)
        .map(serverFinding)],
    }
    : {
      ...filtered,
      confirmedFindings: [
        ...filtered.confirmedFindings,
        ...visibleServerGroundedOfficial.map(serverFinding),
      ],
    };
  const canonicalSources = [...validSourceIds].flatMap((sourceId) => {
    const source = sourceById.get(sourceId);
    const span = firstSpanBySource.get(sourceId);
    return source && span ? [canonicalLegacySource(source, span)] : [];
  });
  const secondaryCanonicalSources = canonicalSources.filter((source) => source.sourceClass === "SECONDARY_REFERENCE");
  const authoritativeCanonicalSources = canonicalSources.filter((source) => source.sourceClass !== "SECONDARY_REFERENCE");
  const retainedTiers = new Set(authoritativeCanonicalSources.map((source) => {
    if (source.sourceClass === "USER_TRUSTED_PRIVATE") return "private";
    return "official";
  }));
  const evidenceMode = retainedTiers.size === 0 ? "none" as const
    : retainedTiers.size > 1 ? "mixed" as const
      : retainedTiers.has("official") ? "official" as const
        : "private_only" as const;
  const governingOrigins = assessedGoverningFindings(input, filtered.confirmedFindings.map(finding => findingOrigins.get(finding) ?? finding),
    input.run.findingAssessments ?? []);
  const contextualGoverning = new Set(filtered.confirmedFindings.filter(finding => governingOrigins.has(findingOrigins.get(finding) ?? finding)));
  const mainPointSupported = assessedMainPointSupported(input, input.result,
    filtered.confirmedFindings.map(finding => findingOrigins.get(finding) ?? finding), input.run.findingAssessments ?? []);
  const mainPoint = groundedMainPoint(grounded, publishable, input.coverageRequirements, contextualGoverning, mainPointSupported);
  const groundedResult: LegalChatResponse = {
    ...grounded,
    responseKind: fallback || input.run.sourceFallback || input.result.responseKind === "clarification_required" || mainPoint.text === null
      ? "clarification_required" : "answer",
    summary: mainPoint.text ?? grounded.summary,
    answer: groundedVisibleAnswer(publishable, input.locale, false, input.answerMode === "detailed" ? 8 : 3),
    referenceNotes: [],
    clarificationQuestions: sanitizeClarificationQuestions(grounded.clarificationQuestions, input.locale),
    assumptions: [],
    requiredDocuments: [],
    successOutlook: null,
    suggestLawyer: grounded.suggestLawyer,
    sources: authoritativeCanonicalSources,
    evidenceMode,
    coverageGaps: [],
  };
  const mainFindings = grounded.confirmedFindings.filter(finding =>
    groundedTextComparisonKey(finding.explanation) === groundedTextComparisonKey(groundedResult.summary)
    || groundedTextComparisonKey(nonRepeatingLegalText(finding.title, finding.explanation))
      === groundedTextComparisonKey(groundedResult.summary)
    || groundedResult.summary.includes(plainGroundedText(finding.explanation)));
  const keptSummary = mainPoint.acceptedSummary;
  groundedResult.summarySourceIds = (keptSummary ? grounded.summarySourceIds : undefined)
    ?? (mainFindings.length ? [...new Set(mainFindings.flatMap(finding => finding.sourceIds))] : undefined)
    ?? [...new Set(publishable.flatMap(claim => claim.sourceId ? [claim.sourceId] : []))];
  // Only findings that survived exact claim/span validation may account for a
  // requirement. Retrieval provenance or a dropped finding cannot cover it.
  const requirements = input.coverageRequirements ?? [];
  const guidanceCoverage = assessedGuidanceCoverage({question: input.question, applicableAt: input.applicableAt,
    temporalComparison: input.temporalComparison, coverageRequirements: requirements, sources: input.sources,
    actions: [...actionOrigins.values()], assessments: input.run.guidanceAssessments ?? []});
  groundedResult.actionPlan = filtered.actionPlan.map(action => ({...action,
    requirementIds: guidanceCoverage.get(actionOrigins.get(action)!) ?? []}));
  const covers = (findings: LegalChatResponse["confirmedFindings"], requirement: typeof requirements[number]) =>
    assessedFindingCoverage(input, findings.map(finding => findingOrigins.get(finding) ?? finding),
      input.run.findingAssessments ?? []).has(requirement.id)
    && findings.some(finding => finding.requirementIds?.includes(requirement.id)
      && (requirement.sourceIds.length === 0
        || finding.sourceIds.some(id => requirement.sourceIds.includes(id))));
  const guidanceCovers = (requirement: typeof requirements[number]) => groundedResult.actionPlan.some(action =>
    action.requirementIds?.includes(requirement.id)
      // Scope membership above comes only from the independent assessment of
      // the complete, citation-validated action set. An absent discovery hint
      // cannot invalidate that proof, just as it cannot invalidate a finding.
      && (requirement.sourceIds.length === 0
        || action.sourceIds.some(id => requirement.sourceIds.includes(id))));
  const uncovered = requirements.filter(requirement => !covers(filtered.confirmedFindings, requirement)
    || (requirement.priority === "core" && !guidanceCovers(requirement)));
  if (uncovered.length > 0) {
    groundedResult.coverageGaps = uncovered.map(requirement => requirement.statement);
    if (uncovered.some(requirement => requirement.priority === "core")) {
      groundedResult.responseKind = "clarification_required";
    }
  }
  if (groundedResult.responseKind === "clarification_required" && authoritativeCanonicalSources.length > 0) {
    groundedResult.summary = aiText(input.locale,
      "Найдены относящиеся к вопросу статьи, но достаточный ответ пока не подтверждён.",
      "Savolga oid moddalar topildi, ammo yetarli javob hali tasdiqlanmadi.",
      "Relevant provisions were found, but a sufficient answer has not yet been verified.");
    groundedResult.answer = input.run.sourceFallback
      ? aiText(input.locale,
        "Статьи найдены, но подготовить и проверить вывод по вашему вопросу сейчас не удалось. Ниже можно открыть найденные положения. Попробуйте повторить запрос позже; лимит ответа не списывается.",
        "Moddalar topildi, ammo hozir savolingiz bo‘yicha xulosani tayyorlash va tekshirish imkoni bo‘lmadi. Quyida ularni ochishingiz mumkin. Keyinroq qayta urinib ko‘ring; javob limiti sarflanmaydi.",
        "Provisions were found, but the conclusion could not be prepared and verified. You can open them below. Please retry later; this does not use your answer allowance.")
      : aiText(input.locale,
        "Ниже приведена подтверждённая часть найденных положений. Её недостаточно для полного вывода по вашему вопросу. Уточнения помогут определить, какие нормы применимы и какие сведения ещё нужно проверить.",
        "Quyida topilgan qoidalarning tasdiqlangan qismi keltirilgan. To‘liq xulosa uchun bu yetarli emas. Aniqliklar amaldagi qoidalar va yetishmayotgan ma’lumotni belgilashga yordam beradi.",
        "The verified part of the available provisions is shown below. It is insufficient for a complete conclusion. Clarifications can help identify the applicable rules and remaining evidence.");
  }
  const safeResult = validSourceIds.size === 0
    ? forceClarificationWithoutVerifiedSources(groundedResult, {
      locale: input.locale,
      answerMode: input.answerMode,
      reasoningMode: input.reasoningMode,
      legalDatabaseAsOf: input.legalDatabaseAsOf,
    })
    : attachSecondaryReferenceContext({
      result: groundedResult,
      secondarySources: secondaryCanonicalSources,
      referenceNotes,
      locale: input.locale,
      contextText: secondaryClaims.map((claim) => claim.text).join(" "),
    });
  const sources = [...validSourceIds].flatMap((sourceId) => {
    const source = sourceById.get(sourceId);
    const span = firstSpanBySource.get(sourceId);
    return source && span ? [sourceMetadata(source, span)] : [];
  });
  if (input.run.findingAssessmentUnavailable) {
    // No published citation is different from no retrieved evidence. A failed
    // answer check cannot diagnose missing sources or missing user facts.
    safeResult.failureReason = "answer_verification_unavailable";
    safeResult.summary = safeResult.answer = answerVerificationFailureText(input.locale);
    safeResult.clarificationQuestions = [];
  } else if (safeResult.failureReason === "answer_verification_unavailable") {
    delete safeResult.failureReason;
  }
  const parsedAnswer = legalGatewayAnswerSchema.safeParse({
    answer: safeResult.answer,
    claims: validated,
    sources,
    nextSteps: safeResult.actionPlan.map((step) => `${step.title}. ${step.description}`),
    uncertainty: [
      ...safeResult.assumptions.map((item) => `${item.statement}. ${item.impact}`),
      ...safeResult.risks.filter((risk) => risk.sourceIds.length === 0).map((risk) => `${risk.title}. ${risk.explanation}`),
    ],
    providerMetadata: {
      provider: input.run.provider,
      model: input.run.model,
      providerResponseId: input.run.providerResponseId,
      attempts: input.run.attempts,
      latencyMs: input.run.latencyMs,
      fallbackFromProvider: input.run.fallbackFromProvider,
      inputTokens: input.run.usage.inputTokens,
      outputTokens: input.run.usage.outputTokens,
      cachedInputTokens: input.run.usage.cachedInputTokens,
    },
  });
  if (!parsedAnswer.success) {
    const issue = parsedAnswer.error.issues[0];
    const path = issue?.path
      .map((part) => String(part).replace(/[^A-Za-z0-9_-]/gu, ""))
      .filter(Boolean)
      .join("_")
      .slice(0, 80) || "root";
    const code = issue?.code.replace(/[^A-Za-z0-9_-]/gu, "").slice(0, 40) || "unknown";
    throw new AiUnavailableError(
      "AI-ответ не прошёл внутренний контракт подтверждённых источников.",
      "INVALID_AI_OUTPUT",
      false,
      null,
      `gateway_contract_${path}_${code}`,
    );
  }
  const answer = parsedAnswer.data;
  const writerOmissions = requirements.filter(requirement => !covers(input.result.confirmedFindings, requirement));
  const rejectedRequirements = requirements.filter(requirement =>
    covers(input.result.confirmedFindings, requirement) && !covers(filtered.confirmedFindings, requirement));
  const {guidanceAssessments: _consumedAssessments, findingAssessments: _consumedFindingAssessments, ...completedRun} = input.run;
  return {
    run: { ...completedRun, data: safeResult },
    answer,
    removedClaimCount: proposedCandidates.filter(claim => !candidateClaims(safeResult)
      .some(visible => visible.text === claim.text && visible.type === claim.type)).length,
    coverageDiagnostics: {
      ...(mainPoint.text === null ? {mainPointIncomplete: true as const} : {}),
      ...(input.run.findingAssessmentUnavailable ? {findingAssessmentUnavailable: true as const} : {}),
      requirementCount: requirements.length,
      writerOmissionCount: input.run.findingAssessmentUnavailable ? 0 : writerOmissions.length,
      validatorRejectionCount: input.run.findingAssessmentUnavailable ? 0 : rejectedRequirements.length,
      validatedRequirementCount: requirements.filter(requirement => covers(filtered.confirmedFindings, requirement)).length,
      proposedFindingCount: input.result.confirmedFindings.length,
      validatedFindingCount: filtered.confirmedFindings.length,
      proposedActionCount: input.result.actionPlan.length,
      validatedActionCount: filtered.actionPlan.length,
      validatedGuidanceRequirementCount: requirements.filter(requirement => requirement.priority === "core" && guidanceCovers(requirement)).length,
      missingGuidanceRequirementCount: requirements.filter(requirement => requirement.priority === "core" && !guidanceCovers(requirement)).length,
      completeRequirementCount: requirements.length - uncovered.length,
      unresolvedCoverage: requirements.flatMap((requirement, requirementIndex) => {
        const finding = covers(filtered.confirmedFindings, requirement) ? null
          : input.run.findingAssessmentUnavailable ? "assessment_unavailable" as const
          : covers(input.result.confirmedFindings, requirement) ? "rejected" as const : "omitted" as const;
        const guidanceMissing = requirement.priority === "core" && !guidanceCovers(requirement);
        return finding || guidanceMissing ? [{requirementIndex, finding, guidanceMissing}] : [];
      }),
    },
  };
}

class DefaultLegalAiGateway implements LegalAiGateway {
  constructor(private readonly provider: LegalAiProvider) {}

  classifyIntent(question: string): LegalIntentDecision {
    return classifyLegalIntent(question);
  }

  rewriteFollowUp(input: Parameters<LegalAiGateway["rewriteFollowUp"]>[0]) {
    return rewriteLegalFollowUp(input);
  }

  planOfficialResearch(input: Parameters<LegalAiGateway["planOfficialResearch"]>[0]) {
    return planLegalResearch(input);
  }

  async generateGroundedAnswer(input: LegalChatRequest, options: LegalAiGatewayRunOptions = {}) {
    const validationQuestion = [input.question, input.retrievalQuery]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ");
    let preliminaryEmitted = false;
    const emitPreliminary = async (preliminary: GroundedLegalPreliminary | null) => {
      if (!preliminary || preliminaryEmitted || !options.onGroundedPreliminary) return;
      preliminaryEmitted = true;
      try {
        await options.onGroundedPreliminary(preliminary);
      } catch {
        // A disconnected client or telemetry observer must not discard the
        // authoritative final provider response.
      }
    };
    const startedAt = Date.now();
    let run: LegalAiRunResult;
    try {
      run = await this.provider.runLegalChat(input, {
        ...options,
        onPartialLegalFinding: options.onGroundedPreliminary
          ? async (finding) => {
            await emitPreliminary(validateGroundedPreliminaryFinding({
              finding,
              sources: input.sources,
              question: validationQuestion,
              locale: input.locale,
            }));
          }
          : undefined,
      });
    } catch (error) {
      const reason = error instanceof AiUnavailableError
        && SOURCE_FALLBACK_CODES.has(error.code as "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "INVALID_AI_OUTPUT")
        ? error.code as "PROVIDER_TIMEOUT" | "PROVIDER_UNAVAILABLE" | "INVALID_AI_OUTPUT"
        : null;
      const fallback = reason && !options.signal?.aborted
        ? buildVerifiedSourceOnlyFallback({
          sources: input.sources,
          question: input.question,
          retrievalQuery: input.retrievalQuery,
          coverageRequirements: input.coverageRequirements,
          locale: input.locale,
          answerMode: input.answerMode,
          reasoningMode: input.reasoningMode,
          legalDatabaseAsOf: input.legalDatabaseAsOf,
          provider: this.provider.name === "anthropic" ? "anthropic" : "openai",
          model: input.runtimeSettings
            ? (input.reasoningMode === "deep"
              ? input.runtimeSettings.openaiDeepModel
              : input.runtimeSettings.openaiChatModel)
            : "juro-source-reader",
          attempts: 1,
          latencyMs: Date.now() - startedAt,
          reason,
        })
        : null;
      if (fallback) return fallback;
      throw error;
    }
    const validate = (candidate: LegalAiRunResult, context = input) => this.validateAnswerContract({
      result: candidate.data,
      run: candidate,
      sources: context.sources,
      question: input.question,
      applicableAt: input.applicableAt,
      temporalComparison: input.temporalComparison,
      retrievalQuery: input.retrievalQuery,
      coverageRequirements: context.coverageRequirements,
      locale: input.locale,
      answerMode: input.answerMode,
      reasoningMode: input.reasoningMode,
      legalDatabaseAsOf: context.legalDatabaseAsOf,
      availableDocumentTemplateCodes: input.availableDocumentTemplates?.map((template) => template.templateCode),
    });
    let validated = validate(run);
    const hasEvidence = (context: LegalChatRequest, requirement: NonNullable<LegalChatRequest["coverageRequirements"]>[number]) => {
      // Live official retrieval can lack a discovery-to-scope mapping. A
      // validated governing finding supplies its own evidence relationship;
      // raw writer citations and unrelated findings cannot authorize repair.
      const requirementIndex = context.coverageRequirements?.findIndex(scope => scope.id === requirement.id);
      const contextualFindingComplete = requirementIndex !== undefined && requirementIndex >= 0
        && validated.coverageDiagnostics.unresolvedCoverage.some(scope => scope.requirementIndex === requirementIndex && scope.finding === null);
      const evidenceIds = [...requirement.sourceIds,
        ...validated.run.data.confirmedFindings.filter(finding => (finding.answerRole === "governing_rule" || contextualFindingComplete)
          && finding.requirementIds?.includes(requirement.id)).flatMap(finding => finding.sourceIds)];
      return evidenceIds.some(id => context.sources.some(source => source.id === id
        && sourceTier(source) === "authoritative" && source.spans?.some(span => span.quality === "high")));
    };
    const canRecover = !input.contentRepair && !options.signal?.aborted && (!options.budget || options.budget.remainingMs > 0);
    let evidenceRouting: Record<string, LegalEvidenceRoutingDecision> | undefined;
    let routingOutcome: ValidatedLegalGatewayResult["evidenceRouting"];
    const assessRouting = async (context: LegalChatRequest, requirementIds: readonly string[]) => {
      if (!this.provider.assessEvidence || !requirementIds.length) return;
      evidenceRouting = {};
      const request = structuredClone(context);
      const identity = JSON.stringify(context);
      const requirementIndexes = requirementIds.map(id => context.coverageRequirements!.findIndex(scope => scope.id === id));
      let assessed: Awaited<ReturnType<NonNullable<LegalAiProvider["assessEvidence"]>>> | undefined;
      let observedAttempts = 0;
      const observedUsage = {inputTokens: 0, outputTokens: 0, cachedInputTokens: 0};
      try {
        assessed = await this.provider.assessEvidence(request, requirementIds, run, {...options,
          onProviderAttemptFinished: async observation => {
            observedAttempts++;
            observedUsage.inputTokens += observation.usage?.inputTokens ?? 0;
            observedUsage.outputTokens += observation.usage?.outputTokens ?? 0;
            observedUsage.cachedInputTokens += observation.usage?.cachedInputTokens ?? 0;
            await options.onProviderAttemptFinished?.(observation);
          }});
        options.signal?.throwIfAborted();
        options.budget?.signal.throwIfAborted();
        if (identity !== JSON.stringify(context) || identity !== JSON.stringify(request)
          || assessed.provider !== run.provider || assessed.model !== run.model) {
          throw new AiUnavailableError("Evidence routing context changed", "INVALID_AI_OUTPUT", false);
        }
        evidenceRouting = parseLegalEvidenceRouting(assessed.data, context, requirementIds);
        routingOutcome = {outcome: "assessed", requirementIndexes, safeErrorCode: null};
      } catch (error) {
        if (options.signal?.aborted || options.budget?.signal.aborted) throw error;
        evidenceRouting = {};
        routingOutcome = {outcome: "unavailable", requirementIndexes,
          safeErrorCode: error instanceof AiUnavailableError ? error.code : "INVALID_AI_OUTPUT"};
      } finally {
        const attempts = observedAttempts || assessed?.attempts || 0;
        const usage = observedAttempts ? observedUsage : assessed?.usage;
        if (attempts && usage && !options.signal?.aborted && !options.budget?.signal.aborted) {
          run = {...run, attempts: run.attempts + attempts, latencyMs: Math.max(0, Date.now() - startedAt),
            usage: {inputTokens: run.usage.inputTokens + usage.inputTokens,
              outputTokens: run.usage.outputTokens + usage.outputTokens,
              cachedInputTokens: run.usage.cachedInputTokens + usage.cachedInputTokens}};
          validated = validate(run);
        }
      }
    };
    const routingRequirementIds = validated.coverageDiagnostics.unresolvedCoverage.flatMap(item => {
      const requirement = input.coverageRequirements?.[item.requirementIndex];
      return requirement?.priority === "core" ? [requirement.id] : [];
    });
    if (canRecover) await assessRouting(input, routingRequirementIds);
    const hasMissingReference = (context: LegalChatRequest, requirement: NonNullable<LegalChatRequest["coverageRequirements"]>[number]) => {
      const evidenceIds = new Set([...requirement.sourceIds,
        ...(evidenceRouting?.[requirement.id]?.support.map(witness => witness.sourceId) ?? []),
        ...legalEvidenceReferenceContexts(context).filter(reference => {
          const disposition = evidenceRouting?.[requirement.id]?.referenceApplicability?.[reference.id];
          return disposition && disposition !== "outside";
        }).map(reference => reference.sourceId),
        ...validated.run.data.confirmedFindings.filter(finding => finding.requirementIds?.includes(requirement.id))
          .flatMap(finding => finding.sourceIds)]);
      return context.sources.some(source => evidenceIds.has(source.id)
        && sourceTier(source) === "authoritative" && hasRequiredEvidenceReference(context, source, evidenceRouting?.[requirement.id]));
    };
    const missing = validated.coverageDiagnostics.unresolvedCoverage.flatMap(item => {
      const requirement = input.coverageRequirements?.[item.requirementIndex];
      if (requirement?.priority !== "core") return [];
      const needsResearch = evidenceRouting === undefined ? !hasEvidence(input, requirement)
        : Boolean(evidenceRouting[requirement.id] && evidenceRouting[requirement.id]!.decision !== "sufficient");
      return needsResearch || hasMissingReference(input, requirement) ? [{...item, requirement}] : [];
    });
    let repairInput = input;
    let recoveredEvidence: RecoveredLegalEvidence | undefined;
    let evidenceRecovery: ValidatedLegalGatewayResult["evidenceRecovery"];
    if (missing.length && canRecover && options.recoverEvidence) {
      const requirementIndexes = missing.map(item => item.requirementIndex);
      try {
        const recovered = await options.recoverEvidence(input, missing.map(item => item.requirement.id));
        options.signal?.throwIfAborted();
        options.budget?.signal.throwIfAborted();
        recoveredEvidence = retainRecoveredLegalEvidence(input, recovered);
        // Newly retrieved text still needs independent claim and scope checks.
        // Its presence alone never establishes a support mapping or coverage.
        if (recoveredEvidence.sources.some(source => sourceTier(source) === "authoritative"
          && !input.sources.some(original => original.id === source.id))) repairInput = {...input, ...recoveredEvidence};
        else if (missing.some(item => hasEvidence({...input, ...recoveredEvidence},
          recoveredEvidence!.coverageRequirements[item.requirementIndex]!))) repairInput = {...input, ...recoveredEvidence};
        evidenceRecovery = {outcome: "not_adopted", requirementIndexes, safeErrorCode: null};
      } catch (error) {
        if (options.signal?.aborted || options.budget?.signal.aborted) throw error;
        evidenceRecovery = {outcome: "unavailable", requirementIndexes,
          safeErrorCode: error instanceof AiUnavailableError ? error.code : "EVIDENCE_RECOVERY_FAILED"};
      }
    }
    if (repairInput !== input && this.provider.assessEvidence) {
      await assessRouting(repairInput, [...routingRequirementIds,
        ...(repairInput.coverageRequirements ?? []).slice(input.coverageRequirements?.length ?? 0)
          .filter(scope => scope.priority === "core").map(scope => scope.id)]);
    }
    const unresolved = validated.coverageDiagnostics.unresolvedCoverage.flatMap(item => {
      const requirement = repairInput.coverageRequirements?.[item.requirementIndex];
      return requirement?.priority === "core" && !hasMissingReference(repairInput, requirement) && (evidenceRouting !== undefined
        ? evidenceRouting[requirement.id]?.decision === "sufficient"
        : (hasEvidence(repairInput, requirement)
          || (repairInput !== input && missing.some(scope => scope.requirement.id === requirement.id))))
        ? [{requirementId: requirement.id, finding: item.finding, guidanceMissing: item.guidanceMissing}] : [];
    });
    for (const requirement of (repairInput.coverageRequirements ?? []).slice(input.coverageRequirements?.length ?? 0)) {
      if (requirement.priority === "core" && !hasMissingReference(repairInput, requirement)
        && (evidenceRouting === undefined || evidenceRouting[requirement.id]?.decision === "sufficient")) {
        unresolved.push({requirementId: requirement.id, finding: "omitted", guidanceMissing: true});
      }
    }
    if (unresolved.length && !input.contentRepair && !options.signal?.aborted
      && (!options.budget || options.budget.remainingMs > 0)) {
      const requirementIndexes = unresolved.map(item => repairInput.coverageRequirements!.findIndex(requirement => requirement.id === item.requirementId));
      let completedRepair: LegalAiRunResult | undefined;
      try {
        // A timed-out finding draft has no retained findings. The validator's
        // source-reader fallback is display evidence, not an assessed draft.
        const repaired = await this.provider.runLegalChat({...repairInput, contentRepair: {
          unresolved, retained: structuredClone(run.initialFindingAssessmentFailure
            ? {...validated.run.data, confirmedFindings: [], summary: run.data.summary,
              summarySourceIds: [], answer: run.data.answer}
            : validated.run.data),
          materialGaps: assessedGuidanceGaps({...input, assessments: run.guidanceAssessments ?? []})
            .filter(gap => unresolved.some(scope => scope.requirementId === gap.requirementId && scope.guidanceMissing)),
          findingGaps: assessedFindingGaps(input, run.findingAssessments ?? [])
            .filter(gap => unresolved.some(scope => scope.requirementId === gap.requirementId && scope.finding)),
        }}, {...options, onPartialLegalFinding: undefined});
        completedRepair = repaired;
        if (repaired.provider === run.provider && repaired.model === run.model) {
          // A later advice assessment timeout cannot erase findings that already
          // passed their independent assessment. Restore only the prior actions
          // and their exact assessment receipts; new unassessed advice stays out.
          // Reuse original candidates so display formatting cannot break receipt
          // identity. Every candidate passes the full citation validator again.
          // Evidence identity checks still reject receipts for a changed packet.
          const candidate = repaired.repairGuidanceAssessmentFailure ? {...repaired,
            data: {...repaired.data, actionPlan: run.data.actionPlan.filter(action => validated.run.data.actionPlan.some(retained =>
              retained.title === plainGroundedText(action.title) && retained.description === plainGroundedText(action.description)
              && retained.sourceIds.every(id => action.sourceIds.includes(id))))},
            guidanceAssessments: run.guidanceAssessments ?? [],
          } : repaired;
          validated = validate({...candidate, attempts: run.attempts + repaired.attempts,
            initialGuidanceAssessmentFailure: run.initialGuidanceAssessmentFailure,
            initialFindingAssessmentFailure: run.initialFindingAssessmentFailure,
            latencyMs: Math.max(0, Date.now() - startedAt), usage: {
              inputTokens: run.usage.inputTokens + repaired.usage.inputTokens,
              outputTokens: run.usage.outputTokens + repaired.usage.outputTokens,
              cachedInputTokens: run.usage.cachedInputTokens + repaired.usage.cachedInputTokens,
            }}, repairInput);
          if (repairInput !== input && recoveredEvidence) {
            validated.recoveredEvidence = recoveredEvidence;
            evidenceRecovery = {...evidenceRecovery!, outcome: "adopted"};
          }
          validated.contentRepair = {outcome: validated.run.data.responseKind === "answer" ? "repaired" : "incomplete",
            requirementIndexes, safeErrorCode: null};
        } else {
          validated.contentRepair = {outcome: "rejected", requirementIndexes, safeErrorCode: "CONTENT_REPAIR_MODEL_CHANGED"};
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        // Exhausted recovery preserves the already validated partial answer;
        // neither a failed writer nor an oversized merge can erase it.
        validated.contentRepair = {outcome: "unavailable", requirementIndexes,
          safeErrorCode: error instanceof AiUnavailableError ? error.code : "CONTENT_REPAIR_FAILED"};
      }
      // A completed provider call consumed tokens even if its candidate could
      // not be accepted. Keep aggregate accounting separate from claim adoption.
      if (completedRepair) {
        const usage = {
          inputTokens: run.usage.inputTokens + completedRepair.usage.inputTokens,
          outputTokens: run.usage.outputTokens + completedRepair.usage.outputTokens,
          cachedInputTokens: run.usage.cachedInputTokens + completedRepair.usage.cachedInputTokens,
        };
        const attempts = run.attempts + completedRepair.attempts;
        const latencyMs = Math.max(0, Date.now() - startedAt);
        validated.run = {...validated.run, usage, attempts, latencyMs, providerResponseId: null};
        validated.answer.providerMetadata = {...validated.answer.providerMetadata, ...usage,
          attempts, latencyMs, providerResponseId: null};
      }
      console.info(JSON.stringify({event: "legal.content_repair_finished", ...validated.contentRepair}));
    }
    if (routingOutcome) validated.evidenceRouting = routingOutcome;
    if (evidenceRecovery) validated.evidenceRecovery = evidenceRecovery;
    await emitPreliminary(preliminaryFromValidatedResult(validated, input.locale));
    return validated;
  }

  validateAnswerContract(input: Parameters<LegalAiGateway["validateAnswerContract"]>[0]) {
    return validateLegalGatewayAnswer(input);
  }

  providerHealth(): AiProviderStatus {
    return aiProviderStatus();
  }
}

export function createLegalAiGateway(provider: LegalAiProvider): LegalAiGateway {
  return new DefaultLegalAiGateway(provider);
}
