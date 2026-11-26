import type { LegalChatResponse } from "../ai/legal-chat-schema";
import type { LegalOutcome, LegalRequest } from "./contracts";

export type AnswerPresentation = {
  legalDatabaseAsOf: string;
  sources: LegalChatResponse["sources"];
};

export function publicationEvidence(outcome: LegalOutcome) {
  return outcome.kind === "answer" ? outcome.evidence : [];
}

// shortcut: catches recurring research wording, use structured next checks if new variants recur.
const researchStatus = [
  /research (?:could not|did not|didn[’']t) (?:finish|complete)|\b(?:source|research) coverage\b|navigation data|(?:could not|unable to) (?:verify|confirm)[^.]*\b(?:available|retrieved|supplied) (?:sources|materials|evidence)\b/iu,
  /исследование не удалось|из доступных (?:материалов|источников) (?:подтвердить|проверить) не удалось|не удалось подтвердить по (?:полному|найденному|доступному) тексту|навигационные данные|покрытие не (?:подтверждено|доказано)/iu,
  /izlanishni yakunlab bo[l‘’'ʻ]|mavjud (?:manbalar|materiallar)[^.]*tasdiqlab bo[l‘’'ʻ]/iu,
];
const isResearchStatus = (text: string) => researchStatus.some(pattern => pattern.test(text));

function publicSummary(text: string): string {
  const clauses = text.split(/(?<=[.!?])\s+(?=\p{Lu})|;\s+/u);
  const retained = clauses.filter(clause => !isResearchStatus(clause));
  if (retained.length === clauses.length) return text;
  return retained.map(clause => /[.!?]$/u.test(clause) ? clause : `${clause}.`).join(" ");
}

/** The retained type is a serialized compatibility contract, imported without runtime validators. */
export function serializeLegalOutcome(outcome: LegalOutcome, request: LegalRequest,
  presentation: AnswerPresentation): LegalChatResponse {
  const evidence = publicationEvidence(outcome);
  const identities = new Set(presentation.sources.map(source => source.sourceId));
  if (identities.size !== presentation.sources.length || presentation.sources.length !== evidence.length
    || presentation.sources.some(source => !evidence.some(item =>
      item.identity === source.sourceId && item.sourceUrl === source.originalUrl))) {
    throw new Error("CITATION_PRESENTATION_MISMATCH");
  }
  if (outcome.kind === "conversation") {
    if (outcome.checkedEvidence.length) throw new Error("CONVERSATION_EVIDENCE_INVALID");
    return { responseKind: "answer",
      presentationKind: "conversation", summary: outcome.text, answer: outcome.text,
      confirmedFindings: [], actionPlan: [], conditionalBranches: [],
      language: request.language, jurisdiction: "UZ", answerMode: request.format, reasoningMode: request.mode,
      clarificationQuestions: [], coverageGaps: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
      referenceNotes: [], urgency: "normal", sources: [], legalDatabaseAsOf: presentation.legalDatabaseAsOf,
      successOutlook: null, suggestedDocument: null, suggestLawyer: false,
      evidenceMode: "none", validationMethod: "programmatic", sourceValidationStatus: "unavailable" };
  }
  if (outcome.kind !== "answer") {
    const summary = (outcome.guidance && publicSummary(outcome.guidance)) || {
      en: "Start by identifying the outcome you need and collecting the relevant documents and dates. Before filing or paying, check the current requirements for your situation with the responsible authority in Uzbekistan.",
      ru: "Начните с того, какого результата вы хотите добиться, и соберите документы и даты по ситуации. Перед подачей заявления или оплатой уточните действующие требования для вашего случая в компетентном органе Узбекистана.",
      uz: "Avval qanday natijaga erishmoqchi ekaningizni aniqlang va tegishli hujjatlar hamda sanalarni to‘plang. Ariza topshirish yoki to‘lov qilishdan oldin holatingizga tegishli amaldagi talablarni O‘zbekistondagi vakolatli idoradan aniqlang.",
    }[request.language];
    return { responseKind: "answer", presentationKind: "practical_guidance", summary, answer: summary,
      confirmedFindings: [], actionPlan: [], conditionalBranches: [],
      language: request.language, jurisdiction: "UZ", answerMode: request.format, reasoningMode: request.mode,
      clarificationQuestions: outcome.clarificationQuestions,
      coverageGaps: [],
      assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
      referenceNotes: [], urgency: "normal",
      sources: [], legalDatabaseAsOf: presentation.legalDatabaseAsOf,
      successOutlook: null, suggestedDocument: null, suggestLawyer: false,
      evidenceMode: "none",
    };
  }
  const content = outcome.content;
  const summary = publicSummary(content.summary);
  const coverageGaps = outcome.gaps?.map(gap => gap.description).filter(gap => !isResearchStatus(gap)) ?? [];
  const actionPlan: LegalChatResponse["actionPlan"] = [];
  const issues = content.issues.map((issue, findingIndex) => ({ findingIndex,
    actionIndices: issue.actions.map(action => {
      actionPlan.push({ ...action, requirementIds: issue.requirementIds });
      return actionPlan.length - 1;
    }),
  }));
  return {
    responseKind: "answer", presentationKind: "legal_answer",
    summary: summary || content.issues[0].title, summarySourceIds: summary ? content.summarySourceIds : content.issues[0].sourceIds,
    answer: content.issues.map(issue => `${issue.title}\n${issue.explanation}`).join("\n\n"),
    confirmedFindings: content.issues.map(issue => ({ title: issue.title, explanation: issue.explanation,
      sourceIds: issue.sourceIds, requirementIds: issue.requirementIds })),
    issues, actionPlan, conditionalBranches: content.conditionalBranches,
    language: request.language, jurisdiction: "UZ", answerMode: request.format, reasoningMode: request.mode,
    clarificationQuestions: content.clarificationQuestions, assumptions: content.assumptions,
    risks: content.risks, deadlines: content.deadlines, requiredDocuments: content.requiredDocuments,
    referenceNotes: content.referenceNotes, urgency: content.urgency,
    sources: structuredClone(presentation.sources), legalDatabaseAsOf: presentation.legalDatabaseAsOf,
    successOutlook: null, suggestedDocument: null, suggestLawyer: false,
    sourceAccessMode: "direct", evidenceMode: "official", validationMethod: "programmatic",
    sourceValidationStatus: "validated", coverageGaps,
    ...(coverageGaps.length ? { coverageStatus: "partial_coverage" as const } : {}),
  };
}
