"use client";

import { AlertTriangle, CheckCircle2, Circle, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import type { AiReviewResult, ValidationIssue } from "../../../lib/document-builder/types";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderText } from "../builder-localization";

export function ReviewPanel({
  review,
  onApply,
  onNavigate,
  locale = "ru",
}: {
  review: AiReviewResult | null;
  onApply: (issue: ValidationIssue) => void;
  onNavigate: (anchor?: string) => void;
  locale?: PlatformLocale;
}) {
  const copy = builderText(locale, {
    ru: {
      title: "Результат проверки JURO",
      aiRules: "AI + детерминированные правила",
      rules: "Детерминированные правила",
      completed: "Завершена",
      aiUnavailable: "AI недоступен",
      completeness: "Юридическая полнота",
      dataCompleteness: "Заполненность данных",
      risk: "Уровень рисков",
      protection: "Защита сторон",
      scoreDetails: "Как рассчитана оценка",
      levels: { critical: "Критично", recommended: "Рекомендуется", optional: "Необязательно" },
      original: "Исходный текст",
      proposed: "Предложенный текст",
      navigate: "Перейти к разделу",
      apply: "Исправить автоматически",
      clean: "Критических замечаний не найдено",
      cleanHint: "Проверьте документ самостоятельно перед подписанием.",
      disclaimer: "Оценка JURO является вспомогательной технической проверкой и не является официальным юридическим заключением.",
      contentLanguage: "Формулировки замечаний и предложений отображаются на языке документа.",
      risks: { Высокий: "Высокий", Средний: "Средний", Низкий: "Низкий" },
      protections: { Высокая: "Высокая", Средняя: "Средняя", Низкая: "Низкая" },
    },
    uz: {
      title: "JURO tekshiruvi natijasi",
      aiRules: "AI va deterministik qoidalar",
      rules: "Deterministik qoidalar",
      completed: "Yakunlandi",
      aiUnavailable: "AI mavjud emas",
      completeness: "Yuridik to‘liqlik",
      dataCompleteness: "Ma’lumotlar to‘liqligi",
      risk: "Xavf darajasi",
      protection: "Tomonlar himoyasi",
      scoreDetails: "Baho qanday hisoblandi",
      levels: { critical: "Jiddiy", recommended: "Tavsiya etiladi", optional: "Ixtiyoriy" },
      original: "Dastlabki matn",
      proposed: "Taklif etilgan matn",
      navigate: "Bo‘limga o‘tish",
      apply: "Avtomatik tuzatish",
      clean: "Jiddiy kamchilik topilmadi",
      cleanHint: "Imzolashdan oldin hujjatni mustaqil tekshiring.",
      disclaimer: "JURO bahosi yordamchi texnik tekshiruv bo‘lib, rasmiy yuridik xulosa hisoblanmaydi.",
      contentLanguage: "Izohlar va taklif qilingan matn hujjat tilida ko‘rsatiladi.",
      risks: { Высокий: "Yuqori", Средний: "O‘rtacha", Низкий: "Past" },
      protections: { Высокая: "Yuqori", Средняя: "O‘rtacha", Низкая: "Past" },
    },
    en: {
      title: "JURO review result",
      aiRules: "AI and deterministic checks",
      rules: "Deterministic checks",
      completed: "Completed",
      aiUnavailable: "AI unavailable",
      completeness: "Legal completeness",
      dataCompleteness: "Data completeness",
      risk: "Risk level",
      protection: "Party protection",
      scoreDetails: "How the score is calculated",
      levels: { critical: "Critical", recommended: "Recommended", optional: "Optional" },
      original: "Original wording",
      proposed: "Suggested wording",
      navigate: "Go to section",
      apply: "Apply automatically",
      clean: "No critical issues found",
      cleanHint: "Review the document yourself before signing.",
      disclaimer: "The JURO score is an assistive technical review, not a formal legal opinion.",
      contentLanguage: "Issue details and suggested wording follow the selected document language.",
      risks: { Высокий: "High", Средний: "Medium", Низкий: "Low" },
      protections: { Высокая: "High", Средняя: "Medium", Низкая: "Low" },
    },
  });

  if (!review) return null;
  return <section className="dbt-review-panel" aria-live="polite">
    <header><div><Sparkles size={21}/><span><strong>{copy.title}</strong><small>{review.status === "completed" ? copy.aiRules : copy.rules}</small></span></div><span className={`dbt-review-status ${review.status}`}>{review.status === "completed" ? copy.completed : copy.aiUnavailable}</span></header>
    {locale === "en" && <p className="dbt-inline-note">{copy.contentLanguage}</p>}
    {review.message && <div className="dbt-review-message"><AlertTriangle size={18}/><p>{review.message}</p></div>}
    <div className="dbt-quality-grid"><article><strong>{review.quality.legalCompleteness}%</strong><span>{copy.completeness}</span></article><article><strong>{review.quality.dataCompleteness}%</strong><span>{copy.dataCompleteness}</span></article><article><strong>{copy.risks[review.quality.riskLevel]}</strong><span>{copy.risk}</span></article><article><strong>{copy.protections[review.quality.partyProtection]}</strong><span>{copy.protection}</span></article></div>
    <details className="dbt-quality-explain"><summary className="juro-disclosure-summary"><ShieldCheck size={17}/>{copy.scoreDetails}</summary>{review.quality.explanation.map((item) => <p key={item}>{item}</p>)}</details>
    <div className="dbt-issues">{review.issues.length ? review.issues.map((issue) => <article className={`dbt-issue ${issue.level}`} key={issue.id}><div className="dbt-issue-icon">{issue.level === "critical" ? <AlertTriangle size={18}/> : issue.level === "recommended" ? <Circle size={17}/> : <CheckCircle2 size={18}/>}</div><div><span className="dbt-issue-level">{copy.levels[issue.level]}</span><h3>{issue.title}</h3><p>{issue.message}</p>{issue.originalText && issue.proposedText && <div className="dbt-diff"><div><small>{copy.original}</small><p>{issue.originalText}</p></div><div><small>{copy.proposed}</small><p>{issue.proposedText}</p></div></div>}<div className="dbt-issue-actions">{issue.anchor && <button type="button" onClick={() => onNavigate(issue.anchor)}>{copy.navigate}</button>}{issue.patch && <button type="button" className="primary" onClick={() => onApply(issue)}><WandSparkles size={15}/>{copy.apply}</button>}</div></div></article>) : <div className="dbt-review-clean"><CheckCircle2 size={24}/><strong>{copy.clean}</strong><p>{copy.cleanHint}</p></div>}</div>
    <p className="dbt-review-disclaimer">{copy.disclaimer}</p>
  </section>;
}
