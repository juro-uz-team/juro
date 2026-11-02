import type { WritingDraft } from "../../lib/legal-answer-workflow/writing-stream";
import type { PlatformLocale } from "../../lib/platform/routing";
import { LegalAnswerView, type LegalAnswerViewResult } from "./LegalAnswerView";

/** Project public prose only; sources and authority arrive after validation. */
export function writingResult(draft: WritingDraft): LegalAnswerViewResult {
  const fields = new Map(draft.blocks.map(block => [block.key.replace(/^turn\/content\//u, ""), block.text]));
  const text = (key: string) => fields.get(key) ?? "";
  const indices = (prefix: string) => [...new Set([...fields.keys()].flatMap(key => {
    if (!key.startsWith(`${prefix}/`)) return [];
    const index = key.slice(prefix.length + 1).split("/")[0];
    return /^\d+$/u.test(index) ? [Number(index)] : [];
  }))].sort((a, b) => a - b);
  const result: LegalAnswerViewResult = {
    responseKind: "answer", summary: text("summary"), answer: "", sources: [],
    confirmedFindings: [], issues: [], actionPlan: [], assumptions: [], risks: [],
    deadlines: [], requiredDocuments: [], referenceNotes: [], conditionalBranches: [],
    clarificationQuestions: [], urgency: "normal", suggestedDocument: null, legalDatabaseAsOf: "",
  };
  for (const index of indices("issues")) {
    const prefix = `issues/${index}`;
    const explanation = text(`${prefix}/explanation`) || indices(`${prefix}/explanation`)
      .map(i => text(`${prefix}/explanation/${i}/statement`)).join("\n\n");
    const findingIndex = result.confirmedFindings.push({ title: text(`${prefix}/title`), explanation }) - 1;
    const actionIndices = indices(`${prefix}/actions`).map(i => result.actionPlan.push({
      title: text(`${prefix}/actions/${i}/title`), description: text(`${prefix}/actions/${i}/description`),
    }) - 1);
    result.issues!.push({ findingIndex, actionIndices });
  }
  result.conditionalBranches = indices("conditionalBranches").map(i => ({ condition: text(`conditionalBranches/${i}/condition`), outcome: text(`conditionalBranches/${i}/outcome`), sourceIds: [] }));
  result.assumptions = indices("assumptions").map(i => ({ statement: text(`assumptions/${i}/statement`), impact: text(`assumptions/${i}/impact`) }));
  result.risks = indices("risks").map(i => ({ title: text(`risks/${i}/title`), explanation: text(`risks/${i}/explanation`), level: "low" }));
  result.deadlines = indices("deadlines").map(i => ({ title: text(`deadlines/${i}/title`), calculationMethod: text(`deadlines/${i}/calculationMethod`), dueDate: null, confidence: "" }));
  result.requiredDocuments = indices("requiredDocuments").map(i => ({ name: text(`requiredDocuments/${i}/name`), reason: text(`requiredDocuments/${i}/reason`), required: false }));
  result.referenceNotes = indices("referenceNotes").map(i => ({ title: text(`referenceNotes/${i}/title`), note: text(`referenceNotes/${i}/note`), sourceIds: [] }));
  result.clarificationQuestions = indices("clarificationQuestions").map(i => text(`clarificationQuestions/${i}`));
  return result;
}

export function AnswerWriting({ draft, locale = "en" }: { draft: WritingDraft | null; locale?: PlatformLocale }) {
  // Research issue updates can still be revised and do not contain the Main Point.
  // Start the reading view with the final writer's ordered prose, not a provisional issue.
  if (!draft?.blocks.some(block => block.key === "turn/content/summary" && block.text.length > 0)) return null;
  return <div data-answer-writing>
    <LegalAnswerView result={writingResult(draft)} locale={locale} streaming />
    {draft.notices?.map((notice, index) => <p key={index} role="status" className="ai-answer-revision">{notice}</p>)}
  </div>;
}
