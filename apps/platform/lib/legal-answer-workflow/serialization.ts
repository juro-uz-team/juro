import type { LegalChatResponse } from "../ai/legal-chat-schema";
import type { LegalOutcome, LegalRequest } from "./contracts";

export type AnswerPresentation = {
  legalDatabaseAsOf: string;
  sources: LegalChatResponse["sources"];
};

/** The retained type is a serialized compatibility contract, imported without runtime validators. */
export function serializeLegalOutcome(outcome: LegalOutcome, request: LegalRequest,
  presentation: AnswerPresentation): LegalChatResponse {
  const evidence = outcome.kind === "answer" ? outcome.evidence : outcome.checkedEvidence;
  const identities = new Set(presentation.sources.map(source => source.sourceId));
  if (identities.size !== presentation.sources.length || presentation.sources.length !== evidence.length
    || presentation.sources.some(source => !evidence.some(item =>
      item.identity === source.sourceId && item.sourceUrl === source.originalUrl))) {
    throw new Error("CITATION_PRESENTATION_MISMATCH");
  }
  if (outcome.kind === "conversation") {
    if (evidence.length) throw new Error("CONVERSATION_EVIDENCE_INVALID");
    return { responseKind: "answer", summary: outcome.text, answer: outcome.text,
      confirmedFindings: [], actionPlan: [], conditionalBranches: [],
      language: request.language, jurisdiction: "UZ", answerMode: request.format, reasoningMode: request.mode,
      clarificationQuestions: [], coverageGaps: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
      referenceNotes: [], urgency: "normal", sources: [], legalDatabaseAsOf: presentation.legalDatabaseAsOf,
      successOutlook: null, suggestedDocument: null, suggestLawyer: false,
      evidenceMode: "none", validationMethod: "programmatic", sourceValidationStatus: "unavailable" };
  }
  if (outcome.kind !== "answer") {
    const clarification = outcome.kind === "clarification_required";
    const summary = clarification ? {
      en: "Please clarify the details below so I can address your legal question.",
      ru: "Уточните детали ниже, чтобы я мог разобраться в вашем правовом вопросе.",
      uz: "Huquqiy savolingizni ko‘rib chiqishim uchun quyidagi tafsilotlarni aniqlashtiring.",
    }[request.language] : outcome.researchIncomplete ? {
      en: "Research could not finish. This does not mean the applicable law is absent from the corpus.",
      ru: "Исследование не удалось завершить. Это не означает, что применимые нормы отсутствуют в базе.",
      uz: "Izlanishni yakunlab bo‘lmadi. Bu qo‘llaniladigan normalar bazada yo‘q degani emas.",
    }[request.language] : {
      en: "The applicable law could not be verified sufficiently to answer.",
      ru: "Не удалось достаточно проверить применимое право для ответа.",
      uz: "Javob berish uchun qo‘llaniladigan huquqni yetarlicha tekshirib bo‘lmadi.",
    }[request.language];
    return { responseKind: "clarification_required", summary, answer: summary,
      confirmedFindings: [], actionPlan: [], conditionalBranches: [],
      language: request.language, jurisdiction: "UZ", answerMode: request.format, reasoningMode: request.mode,
      clarificationQuestions: outcome.clarificationQuestions,
      coverageGaps: outcome.kind === "insufficient_evidence" ? outcome.gaps.map(gap => gap.description) : [],
      assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
      referenceNotes: outcome.kind === "insufficient_evidence" ? outcome.revisionNotes ?? [] : [], urgency: "normal",
      sources: structuredClone(presentation.sources), legalDatabaseAsOf: presentation.legalDatabaseAsOf,
      successOutlook: null, suggestedDocument: null, suggestLawyer: false,
      evidenceMode: presentation.sources.length ? "official" : "none", validationMethod: "programmatic",
      // An unfinished legal assessment does not establish a search/document outage.
      // Keep its specific gaps visible instead of selecting legacy outage copy.
      sourceValidationStatus: "unavailable",
    };
  }
  const content = outcome.content;
  const actionPlan: LegalChatResponse["actionPlan"] = [];
  const issues = content.issues.map((issue, findingIndex) => ({ findingIndex,
    actionIndices: issue.actions.map(action => {
      actionPlan.push({ ...action, requirementIds: issue.requirementIds });
      return actionPlan.length - 1;
    }),
  }));
  return {
    responseKind: "answer", summary: content.summary, summarySourceIds: content.summarySourceIds,
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
    sourceValidationStatus: "validated", coverageGaps: [],
  };
}
