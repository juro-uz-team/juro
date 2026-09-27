"use client";

import { ExternalLink } from "lucide-react";
import { lazy, Suspense, useId, type ReactNode } from "react";
import { deriveLegalEvidenceMode } from "../../lib/ai/legal-evidence-mode";
import { questionInterpretationFailureText, officialResearchFailureText, answerVerificationFailureText, type LegalAnswerFailureReason } from "../../lib/ai/legal-answer-failure";
import type { PlatformLocale } from "../../lib/platform/routing";

const SafeMarkdown = lazy(() => import("./SafeMarkdown").then((module) => ({ default: module.SafeMarkdown })));

export type LegalAnswerViewSource = {
  sourceId: string;
  actTitle: string;
  actIdentifier?: string | null;
  article?: string | null;
  originalUrl: string;
  status: string;
  effectiveDate?: string | null;
  verifiedAt?: string;
  documentNumber?: string | null;
  sourceClass?: string;
  sourceOrigin?: "indexed" | "live" | "web";
};

export type LegalAnswerViewResult = {
  responseKind: "answer" | "clarification_required";
  summary: string;
  summarySourceIds?: string[];
  answer: string;
  clarificationQuestions: string[];
  confirmedFindings: Array<{ title: string; explanation: string; sourceIds?: string[] }>;
  issues?: Array<{findingIndex:number;actionIndices:number[]}>;
  assumptions: Array<{ statement: string; impact: string }>;
  risks: Array<{ level: "low" | "medium" | "high" | "critical"; title: string; explanation: string; sourceIds?: string[] }>;
  sources: LegalAnswerViewSource[];
  requiredDocuments: Array<{ name: string; reason: string; required: boolean }>;
  actionPlan: Array<{ title: string; description: string; sourceIds?: string[] }>;
  deadlines: Array<{ title: string; dueDate: string | null; calculationMethod: string; confidence: string; sourceIds?: string[] }>;
  urgency: "normal" | "high" | "critical";
  suggestedDocument: { templateCode?: string | null; title: string; reason: string } | null;
  legalDatabaseAsOf: string;
  evidenceMode?: "official" | "mixed" | "secondary_only" | "private_only" | "none";
  referenceNotes?: Array<{ title: string; note: string; sourceIds: string[] }>;
  conditionalBranches?: Array<{ condition: string; outcome: string; sourceIds: string[] }>;
  coverageGaps?: string[];
  coverageStatus?: "good_coverage" | "partial_coverage" | "weak_coverage" | "no_coverage";
  failureReason?: LegalAnswerFailureReason;
};

type AnswerCopy = {
  main: string;
  law: string;
  branches: string;
  next: string;
  important: string;
  deadlines: string;
  prepare: string;
  additional: string;
  clarify: string;
  insufficient: string;
  checked: string;
  checkedBody: string;
  partial: string;
  missing: string;
  authority: Record<NonNullable<LegalAnswerViewResult["evidenceMode"]>, string>;
  citationLabel: string;
  openSource: string;
  criticalUrgency: string;
  priorityUrgency: string;
  secondaryNote: string;
};

const COPY: Record<PlatformLocale, AnswerCopy> = {
  ru: {
    main: "Главное",
    law: "Что говорит закон",
    branches: "Как меняется ответ",
    next: "Что делать дальше",
    important: "Важно учесть",
    deadlines: "Сроки",
    prepare: "Что подготовить",
    additional: "Дополнительные материалы",
    clarify: "Что нужно уточнить",
    insufficient: "Пока нельзя подтвердить ответ",
    checked: "Что удалось проверить",
    checkedBody: "Доступных подтверждений недостаточно для полного правового вывода.",
    partial: "Ответ неполный: остаются неподтверждённые вопросы",
    missing: "Нужны дополнительные факты или подтверждённая применимая норма. JURO не заменяет их предположением из общих знаний модели.",
    authority: {
      official: "Подтверждено официальными источниками",
      mixed: "Официальные и контекстные источники",
      secondary_only: "Только справочные материалы",
      private_only: "Факты из ваших документов",
      none: "Правовое основание не подтверждено",
    },
    citationLabel: "Правовые основания",
    openSource: "Открыть источник",
    criticalUrgency: "Критическая срочность: проверьте ближайший срок и возможность немедленной помощи.",
    priorityUrgency: "Вопрос требует приоритетного внимания.",
    secondaryNote: "Эти материалы поясняют контекст, но не устанавливают правовые нормы, сроки, расчёты или обязательные действия.",
  },
  uz: {
    main: "Asosiysi",
    law: "Qonunda nima deyilgan",
    branches: "Javob qachon o‘zgaradi",
    next: "Keyingi qadamlar",
    important: "Muhim jihatlar",
    deadlines: "Muddatlar",
    prepare: "Nimalarni tayyorlash kerak",
    additional: "Qo‘shimcha materiallar",
    clarify: "Nimani aniqlashtirish kerak",
    insufficient: "Javobni hozircha tasdiqlab bo‘lmaydi",
    checked: "Nimalar tekshirildi",
    checkedBody: "Mavjud tasdiqlar to‘liq huquqiy xulosa uchun yetarli emas.",
    partial: "Javob to‘liq emas: tasdiqlanmagan masalalar qolmoqda",
    missing: "Qo‘shimcha faktlar yoki tasdiqlangan amaldagi norma kerak. JURO ularning o‘rniga modelning umumiy bilimiga asoslangan taxmin bermaydi.",
    authority: {
      official: "Rasmiy manbalar bilan tasdiqlangan",
      mixed: "Rasmiy va kontekst manbalari",
      secondary_only: "Faqat ma’lumotnoma materiallari",
      private_only: "Hujjatlaringizdagi faktlar",
      none: "Huquqiy asos tasdiqlanmagan",
    },
    citationLabel: "Huquqiy asoslar",
    openSource: "Manbani ochish",
    criticalUrgency: "Juda shoshilinch: yaqin muddat va zudlik bilan yordam olish imkonini tekshiring.",
    priorityUrgency: "Masala ustuvor e’tiborni talab qiladi.",
    secondaryNote: "Bu materiallar kontekstni tushuntiradi, lekin huquqiy norma, muddat, hisob-kitob yoki majburiy harakatni belgilamaydi.",
  },
  en: {
    main: "Key point",
    law: "What the law says",
    branches: "When the answer changes",
    next: "What to do next",
    important: "Important considerations",
    deadlines: "Deadlines",
    prepare: "What to prepare",
    additional: "Additional materials",
    clarify: "What needs clarification",
    insufficient: "The answer cannot yet be verified",
    checked: "What was checked",
    checkedBody: "The available evidence is insufficient for a complete legal conclusion.",
    partial: "This answer is incomplete: some issues remain unverified",
    missing: "Additional facts or a verified applicable rule are required. JURO will not replace them with an assumption based on a model's general knowledge.",
    authority: {
      official: "Verified by official sources",
      mixed: "Official and contextual sources",
      secondary_only: "Reference materials only",
      private_only: "Facts from your documents",
      none: "Legal basis not verified",
    },
    citationLabel: "Legal authorities",
    openSource: "Open source",
    criticalUrgency: "Critical urgency: check the nearest deadline and whether immediate assistance is available.",
    priorityUrgency: "This matter requires priority attention.",
    secondaryNote: "These materials explain context, but do not establish legal rules, deadlines, calculations or mandatory actions.",
  },
};

function publicSourceUrl(source: LegalAnswerViewSource): string | null {
  try {
    const url = new URL(source.originalUrl);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
    if (source.sourceClass === "SECONDARY_REFERENCE" || ["lex.uz", "www.lex.uz"].includes(url.hostname.toLocaleLowerCase())) return url.href;
    return null;
  } catch {
    return null;
  }
}

function citationText(source: LegalAnswerViewSource, locale: PlatformLocale): string {
  const article = source.article?.replace(/^(?:статья|ст\.?|modda)\s*/iu, "").trim();
  const act = source.actTitle
    .replace(/Республики Узбекистан/giu, { ru: "РУз", uz: "O‘zR", en: "Uzbekistan" }[locale])
    .replace(/O‘zbekiston Respublikasi/giu, { ru: "РУз", uz: "O‘zR", en: "Uzbekistan" }[locale]);
  if (article) return locale === "ru" ? `Ст. ${article} — ${act}` : locale === "uz" ? `${article}-modda — ${act}` : `Art. ${article} — ${act}`;
  if (source.documentNumber) return `${act} · № ${source.documentNumber}`;
  return act;
}

function CitationList({
  sourceIds,
  result,
  locale,
  onCitationSelect,
}: {
  sourceIds?: readonly string[];
  result: LegalAnswerViewResult;
  locale: PlatformLocale;
  onCitationSelect?: (sourceId: string) => void;
}) {
  const copy = COPY[locale];
  const sources = (sourceIds ?? []).flatMap((sourceId) => {
    const source = result.sources.find((candidate) => candidate.sourceId === sourceId);
    return source ? [source] : [];
  });
  if (!sources.length) return null;
  return <span className="legal-answer__citations" aria-label={copy.citationLabel}>
    {sources.map((source) => {
      const label = citationText(source, locale);
      const href = publicSourceUrl(source);
      return href
        ? <a href={href} target="_blank" rel="noopener noreferrer" key={source.sourceId} title={copy.openSource} onClick={() => onCitationSelect?.(source.sourceId)}>{label}<ExternalLink aria-hidden="true" /></a>
        : <span key={source.sourceId}>{label}</span>;
    })}
  </span>;
}

function Markdown({ children, result, locale }: { children: string; result: LegalAnswerViewResult; locale: PlatformLocale }) {
  const allowedLinks = result.sources.flatMap((source) => publicSourceUrl(source) ?? []);
  return <Suspense fallback={<p className="legal-answer__markdown-fallback" aria-busy="true">{children}</p>}>
    <SafeMarkdown locale={locale} allowedLinks={allowedLinks}>{children}</SafeMarkdown>
  </Suspense>;
}

function Section({ id, title, children, className = "" }: { id: string; title: string; children: ReactNode; className?: string }) {
  return <section className={`legal-answer__section ${className}`.trim()} aria-labelledby={id}>
    <h2 id={id}>{title}</h2>
    {children}
  </section>;
}

export function LegalAnswerView({
  result,
  locale,
  className = "",
  onQuestionSelect,
  onCitationSelect,
}: {
  result: LegalAnswerViewResult;
  locale: PlatformLocale;
  className?: string;
  onQuestionSelect?: (question: string) => void;
  onCitationSelect?: (sourceId: string) => void;
}) {
  const id = useId().replace(/:/gu, "");
  const copy = COPY[locale];
  const mode = deriveLegalEvidenceMode(result);
  const incomplete = Boolean(result.coverageGaps?.length)
    || (result.coverageStatus !== undefined && result.coverageStatus !== "good_coverage");
  const rootClass = `legal-answer ${className}`.trim();
  const usesInternet = result.sources.some((source) => source.sourceOrigin === "web"
    || source.sourceOrigin === "live" || source.sourceClass === "SECONDARY_REFERENCE");
  const internetNotice = usesInternet && <p className="legal-answer__authority legal-answer__authority--secondary_only" data-source-notice="internet">
    {locale === "ru" ? "Ответ использует интернет-источники" : locale === "uz"
      ? "Javobda internet manbalaridan foydalanilgan" : "This answer uses internet sources"}
  </p>;
  const coverageGaps = (result.coverageGaps ?? []).length > 0 && <Section id={`${id}-gaps`}
    title={locale === "ru" ? "Что ещё не подтверждено" : locale === "uz" ? "Hali tasdiqlanmagan jihatlar" : "What remains unverified"}>
    <ul>{result.coverageGaps!.map((gap, index) => <li key={index}>{gap}</li>)}</ul>
  </Section>;

  if (result.responseKind === "clarification_required") {
    const interpretationFailed = result.failureReason === "question_interpretation_unavailable";
    const researchFailed = result.failureReason === "official_research_unavailable";
    const verificationFailed = result.failureReason === "answer_verification_unavailable";
    return <article className={`${rootClass} legal-answer--insufficient`} data-answer-kind="insufficient-evidence">
      {internetNotice}
      <p className="legal-answer__authority">{copy.authority.none}</p>
      <header className="legal-answer__insufficient-heading">
        <span>{copy.checked}</span>
        <h2>{copy.insufficient}</h2>
        <Markdown result={result} locale={locale}>{interpretationFailed ? questionInterpretationFailureText(locale)
          : researchFailed ? officialResearchFailureText(locale)
          : verificationFailed ? answerVerificationFailureText(locale) : result.answer}</Markdown>
      </header>
      {!verificationFailed && <section className="legal-answer__checked" aria-labelledby={`${id}-checked`}>
        <h3 id={`${id}-checked`}>{copy.checked}</h3>
        <p>{copy.checkedBody}</p>
        {!interpretationFailed && !researchFailed && <p>{copy.missing}</p>}
      </section>}
      {result.confirmedFindings.length > 0 && <Section id={`${id}-found`} title={copy.law}>
        {result.confirmedFindings.map((finding, index) => <div className="legal-answer__finding" key={index}>
          <h3>{finding.title}</h3>
          <Markdown result={result} locale={locale}>{finding.explanation}</Markdown>
          <CitationList sourceIds={finding.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
        </div>)}
      </Section>}
      {coverageGaps}
      {(result.referenceNotes ?? []).length > 0 && <Section id={`${id}-additional`} title={copy.additional} className="legal-answer__section--additional">
        <p className="legal-answer__secondary-note">{copy.secondaryNote}</p>
        {(result.referenceNotes ?? []).map((note) => <article key={`${note.title}:${note.sourceIds.join(":")}`}>
          <h3>{note.title}</h3><Markdown result={result} locale={locale}>{note.note}</Markdown>
          <CitationList sourceIds={note.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
        </article>)}
      </Section>}
      {result.clarificationQuestions.length > 0 && <section className="legal-answer__questions" aria-labelledby={`${id}-clarify`}>
        <h3 id={`${id}-clarify`}>{copy.clarify}</h3>
        <div>{result.clarificationQuestions.map((question) => onQuestionSelect
          ? <button type="button" key={question} onClick={() => onQuestionSelect(question)}>{question}</button>
          : <p key={question}>{question}</p>)}</div>
      </section>}
    </article>;
  }

  const important = result.assumptions.length > 0 || result.risks.length > 0 || result.urgency !== "normal";
  const prepare = result.requiredDocuments.length > 0 || Boolean(result.suggestedDocument);
  const mainSourceIds = result.summarySourceIds ?? [...new Set([
    ...result.confirmedFindings.map((finding) => finding.sourceIds),
    ...(result.conditionalBranches ?? []).map((branch) => branch.sourceIds),
    ...result.actionPlan.map((step) => step.sourceIds),
    ...result.risks.map((risk) => risk.sourceIds),
    ...result.deadlines.map((deadline) => deadline.sourceIds),
  ].flatMap((sourceIds) => sourceIds ?? []))];
  return <article className={rootClass} data-answer-kind="legal-answer">
    {internetNotice}
    <p className={`legal-answer__authority legal-answer__authority--${mode}`}>{incomplete ? copy.partial : copy.authority[mode]}</p>
    <Section id={`${id}-main`} title={copy.main} className="legal-answer__section--main">
      <Markdown result={result} locale={locale}>{result.summary}</Markdown>
      <CitationList sourceIds={mainSourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
    </Section>
    {(result.conditionalBranches ?? []).length > 0 && <Section id={`${id}-branches`} title={copy.branches}>
      <div className="legal-answer__findings">{(result.conditionalBranches ?? []).map((branch) => <article key={`${branch.condition}:${branch.sourceIds.join(":")}`}>
        <h3>{branch.condition}</h3>
        <Markdown result={result} locale={locale}>{branch.outcome}</Markdown>
        <CitationList sourceIds={branch.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
      </article>)}</div>
    </Section>}
    {result.issues?.map((issue,index)=>{
      const finding=result.confirmedFindings[issue.findingIndex]!;
      return <section className="legal-answer__section" data-answer-issue={index} key={issue.findingIndex} aria-labelledby={`${id}-issue-${index}`}>
        <h2 id={`${id}-issue-${index}`}>{finding.title}</h2>
        <Markdown result={result} locale={locale}>{finding.explanation}</Markdown>
        <CitationList sourceIds={finding.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
        {issue.actionIndices.length>0 && <>
          <h3>{copy.next}</h3>
          <ol className="legal-answer__steps">{issue.actionIndices.map(actionIndex=>{
            const step=result.actionPlan[actionIndex]!;
            return <li key={actionIndex}>
              <div><h4>{step.title}</h4><Markdown result={result} locale={locale}>{step.description}</Markdown></div>
              <CitationList sourceIds={step.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
            </li>;
          })}</ol>
        </>}
      </section>;
    })}
    {!result.issues && result.confirmedFindings.length > 0 && <Section id={`${id}-law`} title={copy.law}>
      <div className="legal-answer__findings">{result.confirmedFindings.map((finding) => <article key={`${finding.title}:${finding.sourceIds?.join(":") ?? ""}`}>
        <h3>{finding.title}</h3>
        <Markdown result={result} locale={locale}>{finding.explanation}</Markdown>
        <CitationList sourceIds={finding.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
      </article>)}</div>
    </Section>}
    {!result.issues && result.actionPlan.length > 0 && <Section id={`${id}-next`} title={copy.next}>
      <ol className="legal-answer__steps">{result.actionPlan.map((step) => <li key={step.title}>
        <div><h3>{step.title}</h3><Markdown result={result} locale={locale}>{step.description}</Markdown></div>
        <CitationList sourceIds={step.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
      </li>)}</ol>
    </Section>}
    {important && <Section id={`${id}-important`} title={copy.important} className="legal-answer__section--important">
      {result.urgency !== "normal" && <p className={`legal-answer__urgency legal-answer__urgency--${result.urgency}`}>{result.urgency === "critical"
        ? copy.criticalUrgency
        : copy.priorityUrgency}</p>}
      {result.assumptions.map((assumption) => <article key={assumption.statement}><h3>{assumption.statement}</h3><Markdown result={result} locale={locale}>{assumption.impact}</Markdown></article>)}
      {result.risks.map((risk) => <article className={`legal-answer__risk legal-answer__risk--${risk.level}`} key={`${risk.level}:${risk.title}`}>
        <h3>{risk.title}</h3><Markdown result={result} locale={locale}>{risk.explanation}</Markdown>
        <CitationList sourceIds={risk.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
      </article>)}
    </Section>}
    {result.deadlines.length > 0 && <Section id={`${id}-deadlines`} title={copy.deadlines}>
      <div className="legal-answer__deadlines">{result.deadlines.map((deadline) => <article key={deadline.title}>
        <h3>{deadline.title}{deadline.dueDate ? ` · ${deadline.dueDate}` : ""}</h3>
        <Markdown result={result} locale={locale}>{deadline.calculationMethod}</Markdown>
        <CitationList sourceIds={deadline.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
      </article>)}</div>
    </Section>}
    {prepare && <Section id={`${id}-prepare`} title={copy.prepare}>
      {result.requiredDocuments.length > 0 && <ul className="legal-answer__documents">{result.requiredDocuments.map((document) => <li key={document.name}>
        <strong>{document.name}</strong><span>{document.reason}</span>
      </li>)}</ul>}
      {result.suggestedDocument && <article className="legal-answer__suggested-document"><h3>{result.suggestedDocument.title}</h3><p>{result.suggestedDocument.reason}</p></article>}
    </Section>}
    {(result.referenceNotes ?? []).length > 0 && <Section id={`${id}-additional`} title={copy.additional} className="legal-answer__section--additional">
      <p className="legal-answer__secondary-note">{copy.secondaryNote}</p>
      {(result.referenceNotes ?? []).map((note) => <article key={`${note.title}:${note.sourceIds.join(":")}`}>
        <h3>{note.title}</h3><Markdown result={result} locale={locale}>{note.note}</Markdown>
        <CitationList sourceIds={note.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
      </article>)}
    </Section>}
    {coverageGaps}
    {result.clarificationQuestions.length > 0 && <section className="legal-answer__questions" aria-labelledby={`${id}-clarify`}>
      <h2 id={`${id}-clarify`}>{copy.clarify}</h2>
      <div>{result.clarificationQuestions.map((question) => onQuestionSelect
        ? <button type="button" key={question} onClick={() => onQuestionSelect(question)}>{question}</button>
        : <p key={question}>{question}</p>)}</div>
    </section>}
  </article>;
}
