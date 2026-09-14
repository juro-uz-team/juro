import { legalChatResponseSchema, type LegalChatResponse } from "../ai/legal-chat-schema";
import { aiText } from "../ai/localization";
import type { LegalSourceContext } from "../legal/source-context";
import { legalClaimId, legalDraftClaims, legalDraftSchema, legalVerificationSchema, type LegalDraft, type LegalVerification } from "./answer-contract";
import { assertAnswerEvidence, timeIdentity } from "./evidence-boundary";

export type LegalTime = { kind: "current" } | { kind: "timestamp"; instant: string };
export type LegalTemporalScope = LegalTime | { kind: "comparison"; left: LegalTime; right: LegalTime };
export type LegalEvidence = {
  source: LegalSourceContext;
  text: string;
  textSha256: string;
  endpoint: LegalTime;
  origin: "indexed" | "live";
};
export type AnswerQuestion = {
  question: string;
  locale: "ru" | "uz" | "en";
  mode: "fast" | "deep";
  answerMode: "short" | "detailed";
  temporalScope: LegalTemporalScope;
  evidence: readonly LegalEvidence[];
  unresolved: readonly string[];
  sourceUnavailable?: boolean;
  caseFacts?: readonly string[];
  priorTurns?: readonly { question: string; answer: string }[];
  signal?: AbortSignal;
  onStage?: (stage: "writing" | "verifying" | "correcting") => void;
};
export type AnswerOutcome = {
  kind: "complete" | "partial" | "insufficient_evidence" | "unavailable";
  result: LegalChatResponse;
  errorCode?: string;
  verification?: LegalVerification;
};
export type AnswerModel = {
  write(input: { question: AnswerQuestion; correction: { draft: LegalDraft; verification: LegalVerification } | null }): Promise<unknown>;
  verify(input: { question: AnswerQuestion; draft: LegalDraft; claims: ReturnType<typeof legalDraftClaims>;
    previous: { draft: LegalDraft; verification: LegalVerification } | null }): Promise<unknown>;
};

function emptyAnswer(input: AnswerQuestion): LegalChatResponse {
  const summary = aiText(input.locale,
    "Недостаточно проверенных официальных источников для правового вывода.",
    "Huquqiy xulosa uchun tekshirilgan rasmiy manbalar yetarli emas.",
    "There is not enough verified official evidence for a legal conclusion.");
  return {
    responseKind: "clarification_required", summary, answer: summary, language: input.locale,
    jurisdiction: "UZ", answerMode: input.answerMode, reasoningMode: input.mode,
    clarificationQuestions: [], confirmedFindings: [], assumptions: [], risks: [], sources: [],
    requiredDocuments: [], actionPlan: [], deadlines: [], successOutlook: null, urgency: "normal",
    suggestedDocument: null, suggestLawyer: false, legalDatabaseAsOf: "unavailable",
    evidenceMode: "none", coverageStatus: "no_coverage", coverageGaps: [...input.unresolved],
  };
}

function acceptedClaims(input: AnswerQuestion, draft: LegalDraft, verification: LegalVerification) {
  const evidenceIds = new Set(input.evidence.map(item => item.source.id));
  const claims = legalDraftClaims(draft);
  return claims.filter(claim => {
    const verdicts = verification.claims.filter(item => item.id === claim.id);
    return verdicts.length === 1 && verdicts[0]!.supported && (claim.kind === "question" || claim.kind === "gap"
      || (claim.sourceIds.length > 0 && claim.sourceIds.every(id => evidenceIds.has(id))));
  });
}

function projectVerifiedAnswer(input: AnswerQuestion, draft: LegalDraft, verification: LegalVerification): AnswerOutcome {
  const accepted = new Map(acceptedClaims(input,draft,verification).map(claim=>[claim.id,claim]));
  const questions = draft.questions.filter((_,index)=>accepted.has(legalClaimId("question",index)));
  const reviewedGaps = draft.unresolved.filter((_,index)=>accepted.has(legalClaimId("gap",index)));
  const incompleteMessage = aiText(input.locale,"Не все существенные вопросы подтверждены; остальные части требуют проверки.",
    "Barcha muhim masalalar tasdiqlanmagan; qolgan qismlar tekshiruv talab qiladi.",
    "Not all material issues are supported; the remaining parts require verification.");
  const hasSourceGaps = verification.sourceGaps.some(source=>source.passages.some(passage=>passage.missingContent.length));
  const verificationGaps = verification.gaps.length || hasSourceGaps || verification.coverage.some(item=>item.gaps.length)
    ? [incompleteMessage] : [];
  const findings = draft.findings.filter((_, index) => accepted.has(legalClaimId("finding",index)));
  if (!findings.length) return { kind: "insufficient_evidence", verification, result: {
    ...emptyAnswer(input), coverageGaps: [...new Set([...input.unresolved, ...reviewedGaps, ...verificationGaps])],
    clarificationQuestions: questions,
  } };
  const actions = draft.actions.filter((_, index) => accepted.has(legalClaimId("action",index)));
  const risks = draft.risks.filter((_, index) => accepted.has(legalClaimId("risk",index)));
  const sourceIds = new Set([
    ...(accepted.has("mainPoint") ? draft.mainPoint.sourceIds : []),
    ...findings.flatMap(item => item.sourceIds), ...actions.flatMap(item => item.sourceIds), ...risks.flatMap(item => item.sourceIds),
  ]);
  const sources = input.evidence.filter(item => sourceIds.has(item.source.id)).map(({ source, origin }) => ({
    sourceId: source.id, actTitle: source.actTitle, actIdentifier: source.actIdentifier,
    article: source.article ?? null, excerpt: source.excerpt ?? null, originalUrl: source.officialUrl,
    status: source.status, effectiveDate: source.effectiveDate ?? null, verifiedAt: source.verifiedAt,
    sourceClass: source.sourceClass, sourceOrigin: origin,
  }));
  const requiredTimes = input.temporalScope.kind === "comparison" ? [input.temporalScope.left, input.temporalScope.right] : [input.temporalScope];
  const missingTime = requiredTimes.some(time => !input.evidence.some(item => sourceIds.has(item.source.id)
    && timeIdentity(item.endpoint) === timeIdentity(time)));
  const identityGaps = missingTime ? [aiText(input.locale,
    "Не для каждого запрошенного периода подтверждена правовая часть ответа.",
    "So‘ralgan har bir davr uchun javobning huquqiy qismi tasdiqlanmagan.",
    "The answer does not have supported legal findings for every requested time period.")] : [];
  const completeCoverage = verification.coverage.length > 0 && verification.coverage.every(item =>
    !item.gaps.length && item.findingIds.length > 0 && item.actionIds.length > 0
    && item.findingIds.every(id => accepted.get(id)?.kind === "finding")
    && item.actionIds.every(id => accepted.get(id)?.kind === "action"));
  const coverageGaps = completeCoverage ? [] : [aiText(input.locale,
    "Не для каждого существенного вопроса подтверждены правовое объяснение и практические шаги.",
    "Har bir muhim masala uchun huquqiy tushuntirish va amaliy qadamlar tasdiqlanmagan.",
    "Supported legal explanations and practical steps do not cover every material issue.")];
  const outageGaps = input.sourceUnavailable ? [aiText(input.locale,
    "Часть официальных источников временно недоступна; полнота ответа не подтверждена.",
    "Ayrim rasmiy manbalar vaqtincha mavjud emas; javobning to‘liqligi tasdiqlanmagan.",
    "Some official sources are temporarily unavailable; the answer's completeness is not confirmed.")] : [];
  const complete = verification.complete && legalDraftClaims(draft).every(item => accepted.has(item.id))
    && actions.length > 0 && !draft.unresolved.length && !verification.gaps.length && !hasSourceGaps && !input.unresolved.length
    && !input.sourceUnavailable && !missingTime && completeCoverage;
  const partialSummary = aiText(input.locale, "Ниже — подтвержденная часть ответа; остальные вопросы требуют проверки.",
    "Quyida javobning tasdiqlangan qismi; qolgan masalalar tekshiruv talab qiladi.",
    "The supported parts are explained below; the remaining issues need verification.");
  const result = legalChatResponseSchema.parse({ ...emptyAnswer(input),
    responseKind: findings.length ? "answer" : "clarification_required",
    summary: accepted.has("mainPoint") ? draft.mainPoint.text : partialSummary,
    summarySourceIds: accepted.has("mainPoint") ? draft.mainPoint.sourceIds : [],
    answer: accepted.has("mainPoint") ? draft.mainPoint.text : partialSummary,
    confirmedFindings: findings, actionPlan: actions, risks, sources,
    clarificationQuestions: questions,
    coverageGaps: [...new Set([...input.unresolved, ...reviewedGaps, ...verificationGaps,
      ...identityGaps, ...coverageGaps, ...outageGaps])],
    evidenceMode: findings.length ? "official" : "none", coverageStatus: complete ? "good_coverage" : findings.length ? "partial_coverage" : "no_coverage",
    legalDatabaseAsOf: input.evidence.map(item => item.source.verifiedAt).sort()[0] ?? "unavailable",
    sourceAccessMode: input.evidence.every(item => item.origin === "indexed") ? "approved_package"
      : input.evidence.every(item => item.origin === "live") ? "direct" : "mixed",
    sourceValidationStatus: "validated",
  });
  return { kind: complete ? "complete" : "partial", result, verification };
}

function unavailableAnswer(input: AnswerQuestion, errorCode: string): AnswerOutcome {
  const text = aiText(input.locale,
    "Проверка ответа временно недоступна. Это не означает, что применимых норм нет. Повторите запрос.",
    "Javobni tekshirish vaqtincha mavjud emas. Bu tegishli normalar yo‘qligini anglatmaydi. Qayta urinib ko‘ring.",
    "Answer verification is temporarily unavailable. This does not mean that no law applies. Please retry.");
  return { kind: "unavailable", errorCode, result: { ...emptyAnswer(input), summary: text, answer: text,
    failureReason: errorCode === "OFFICIAL_RESEARCH_UNAVAILABLE" ? "official_research_unavailable" : "answer_verification_unavailable",
    sourceValidationStatus: "unavailable" } };
}

export async function answerFromEvidence(input: AnswerQuestion, model: AnswerModel): Promise<AnswerOutcome> {
  try { await assertAnswerEvidence(input); }
  catch { return unavailableAnswer(input, "EVIDENCE_UNAVAILABLE"); }
  if (input.signal?.aborted) return unavailableAnswer(input, "AI_CANCELLED");
  if (!input.evidence.length) return input.sourceUnavailable ? unavailableAnswer(input, "OFFICIAL_RESEARCH_UNAVAILABLE")
    : { kind: "insufficient_evidence", result: emptyAnswer(input) };
  let draft: LegalDraft;
  let verification: LegalVerification;
  try {
    input.onStage?.("writing");
    draft = legalDraftSchema.parse(await model.write({ question: input, correction: null }));
    if (input.signal?.aborted) return unavailableAnswer(input, "AI_CANCELLED");
    input.onStage?.("verifying");
    verification = legalVerificationSchema.parse(await model.verify({ question: input, draft, claims: legalDraftClaims(draft), previous: null }));
  } catch { return unavailableAnswer(input, input.signal?.aborted ? "AI_CANCELLED" : "ANSWER_PROVIDER_UNAVAILABLE"); }
  if (input.signal?.aborted) return unavailableAnswer(input, "AI_CANCELLED");
  const first = projectVerifiedAnswer(input, draft, verification);
  if (first.kind === "complete") return first;
  if (input.signal?.aborted) return unavailableAnswer(input, "AI_CANCELLED");
  try {
    input.onStage?.("correcting");
    const correction = { draft, verification };
    const corrected = legalDraftSchema.parse(await model.write({ question: input, correction }));
    if (input.signal?.aborted) return unavailableAnswer(input, "AI_CANCELLED");
    input.onStage?.("verifying");
    const checked = legalVerificationSchema.parse(await model.verify({ question: input, draft: corrected, claims: legalDraftClaims(corrected), previous: correction }));
    if (input.signal?.aborted) return unavailableAnswer(input, "AI_CANCELLED");
    const final = projectVerifiedAnswer(input, corrected, checked);
    const acceptedCorrection = new Map(acceptedClaims(input,corrected,checked).map(claim=>[claim.id,claim]));
    const retained = acceptedClaims(input,draft,verification).filter(claim=>claim.kind!=="question"&&claim.kind!=="gap").every(prior=>{
      const mappings=checked.retention.filter(item=>item.priorId===prior.id);
      return mappings.length===1 && mappings[0]!.currentIds.length>0
        && mappings[0]!.currentIds.every(id=>acceptedCorrection.get(id)?.kind===prior.kind);
    });
    if(!retained && first.kind==="partial") return {...first,errorCode:"ANSWER_CORRECTION_REGRESSED"};
    return final.kind === "insufficient_evidence" && first.kind === "partial" ? first : final;
  } catch {
    if (input.signal?.aborted) return unavailableAnswer(input, "AI_CANCELLED");
    if (first.kind !== "partial") return unavailableAnswer(input, "ANSWER_CORRECTION_UNAVAILABLE");
    return { ...first, errorCode: "ANSWER_CORRECTION_UNAVAILABLE" };
  }
}
