"use client";
import { inlineReferences, referenceSourcesForPassage } from "../../lib/ai/legal-inline-references";

import { ExternalLink } from "lucide-react";
import { useId, type ReactNode } from "react";
import { deriveLegalEvidenceMode } from "../../lib/ai/legal-evidence-mode";
import { questionInterpretationFailureText, officialResearchFailureText, answerVerificationFailureText } from "../../lib/ai/legal-answer-failure";
import type { PlatformLocale } from "../../lib/platform/routing";

import { SafeMarkdown } from "./SafeMarkdown";

import {legalAnswerCopy as COPY, type LegalAnswerViewSource, type LegalAnswerViewResult} from "../../lib/ai/legal-answer-presentation";
export type {LegalAnswerViewSource,LegalAnswerViewResult} from "../../lib/ai/legal-answer-presentation";

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
  const articleText = source.article?.replace(/^(?:статья|ст\.?|modda)\s*/iu, "").trim();
  const article = articleText?.match(/^\d+(?:[-–]\d+)?/u)?.[0] ?? articleText;
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

function Markdown({ children, result, locale, sourceIds }: { children: string; result: LegalAnswerViewResult; locale: PlatformLocale; sourceIds?: readonly string[] }) {
  const allowedLinks = result.sources.flatMap(source => {
    const href = publicSourceUrl(source); if (!href) return [];
    const document = new URL(href); document.hash = ""; return [href, document.href];
  });
  const referenceSources = referenceSourcesForPassage(result.sources, sourceIds);
  const mentioned = new Set(inlineReferences(children,referenceSources).filter(ref=>ref.source && !ref.navigationOnly && (ref.articleNumber || !ref.source.article)).map(ref=>ref.source!.sourceId));
  const supportingLinks = [...new Set(children.trim() ? sourceIds ?? [] : [])].flatMap(id=>{
    const source=result.sources.find(item=>item.sourceId===id);
    const href=source && publicSourceUrl(source);
    return source && href && !mentioned.has(id) ? [{label:citationText(source,locale),href}] : [];
  });
  return <SafeMarkdown locale={locale} allowedLinks={allowedLinks} referenceSources={referenceSources} supportingLinks={supportingLinks}>{children}</SafeMarkdown>;
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
  streaming = false,
  toolbar,
}: {
  toolbar?: ReactNode;
  streaming?: boolean;
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
      {toolbar}
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
          <Markdown result={result} locale={locale} sourceIds={finding.sourceIds}>{finding.explanation}</Markdown>
          <CitationList sourceIds={finding.sourceIds} result={result} locale={locale} onCitationSelect={onCitationSelect} />
        </div>)}
      </Section>}
      {coverageGaps}
      {(result.referenceNotes ?? []).length > 0 && <Section id={`${id}-additional`} title={copy.additional} className="legal-answer__section--additional">
        <p className="legal-answer__secondary-note">{copy.secondaryNote}</p>
        {(result.referenceNotes ?? []).map((note, index) => <article key={`${id}-reference-note-${index}`}>
          <h3>{note.title}</h3><Markdown result={result} locale={locale} sourceIds={note.sourceIds}>{note.note}</Markdown>
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

  // Before presentationKind was persisted, conversational outcomes had this empty,
  // programmatically validated shape. Never apply it to an in-progress legal draft.
  const legacyConversation = !streaming && !result.presentationKind && result.validationMethod === "programmatic"
    && result.evidenceMode === "none" && result.sources.length === 0 && result.confirmedFindings.length === 0
    && result.actionPlan.length === 0 && result.assumptions.length === 0 && result.risks.length === 0
    && result.clarificationQuestions.length === 0 && result.requiredDocuments.length === 0
    && !(result.conditionalBranches?.length) && !(result.referenceNotes?.length) && !(result.coverageGaps?.length)
    && result.deadlines.length === 0 && result.urgency === "normal" && !result.suggestedDocument;
  if (result.presentationKind === "conversation" || legacyConversation) {
    return <article className={rootClass} data-answer-kind="conversation">{toolbar}
      <Markdown result={result} locale={locale}>{result.summary}</Markdown>
    </article>;
  }

  const important = result.assumptions.length > 0 || result.risks.length > 0 || result.urgency !== "normal";
  const prepare = result.requiredDocuments.length > 0 || Boolean(result.suggestedDocument);
  return <article className={rootClass} data-answer-kind="legal-answer" aria-busy={streaming || undefined}>
    {toolbar}
    {result.summary && <Section id={`${id}-main`} title={copy.main} className="legal-answer__section--main">
      <Markdown result={result} locale={locale} sourceIds={result.summarySourceIds}>{result.summary}</Markdown>
    </Section>}
    {(result.conditionalBranches ?? []).length > 0 && <Section id={`${id}-branches`} title={copy.branches}>
      <div className="legal-answer__findings">{(result.conditionalBranches ?? []).map((branch) => <article key={`${branch.condition}:${branch.sourceIds.join(":")}`}>
        <h3>{branch.condition}</h3>
        <Markdown result={result} locale={locale} sourceIds={branch.sourceIds}>{branch.outcome}</Markdown>
      </article>)}</div>
    </Section>}
    {result.issues?.map((issue,index)=>{
      const finding=result.confirmedFindings[issue.findingIndex]!;
      return <section className="legal-answer__section" data-answer-issue={index} key={issue.findingIndex} aria-labelledby={`${id}-issue-${index}`}>
        <h2 id={`${id}-issue-${index}`}>{finding.title}</h2>
        <Markdown result={result} locale={locale} sourceIds={finding.sourceIds}>{finding.explanation}</Markdown>
        {issue.actionIndices.length>0 && <>
          <h3>{copy.next}</h3>
          <ol className="legal-answer__steps">{issue.actionIndices.map(actionIndex=>{
            const step=result.actionPlan[actionIndex]!;
            return <li key={actionIndex}>
              <div><h4>{step.title}</h4><Markdown result={result} locale={locale} sourceIds={step.sourceIds}>{step.description}</Markdown></div>
            </li>;
          })}</ol>
        </>}
      </section>;
    })}
    {!result.issues && result.confirmedFindings.length > 0 && <Section id={`${id}-law`} title={copy.law}>
      <div className="legal-answer__findings">{result.confirmedFindings.map((finding) => <article key={`${finding.title}:${finding.sourceIds?.join(":") ?? ""}`}>
        <h3>{finding.title}</h3>
        <Markdown result={result} locale={locale} sourceIds={finding.sourceIds}>{finding.explanation}</Markdown>
      </article>)}</div>
    </Section>}
    {!result.issues && result.actionPlan.length > 0 && <Section id={`${id}-next`} title={copy.next}>
      <ol className="legal-answer__steps">{result.actionPlan.map((step) => <li key={step.title}>
        <div><h3>{step.title}</h3><Markdown result={result} locale={locale} sourceIds={step.sourceIds}>{step.description}</Markdown></div>
      </li>)}</ol>
    </Section>}
    {important && <Section id={`${id}-important`} title={copy.important} className="legal-answer__section--important">
      {result.urgency !== "normal" && <p className={`legal-answer__urgency legal-answer__urgency--${result.urgency}`}>{result.urgency === "critical"
        ? copy.criticalUrgency
        : copy.priorityUrgency}</p>}
      {result.assumptions.map((assumption) => <article key={assumption.statement}><h3>{assumption.statement}</h3><Markdown result={result} locale={locale}>{assumption.impact}</Markdown></article>)}
      {result.risks.map((risk) => <article className={`legal-answer__risk legal-answer__risk--${risk.level}`} key={`${risk.level}:${risk.title}`}>
        <h3>{risk.title}</h3><Markdown result={result} locale={locale} sourceIds={risk.sourceIds}>{risk.explanation}</Markdown>
      </article>)}
    </Section>}
    {result.deadlines.length > 0 && <Section id={`${id}-deadlines`} title={copy.deadlines}>
      <div className="legal-answer__deadlines">{result.deadlines.map((deadline) => <article key={deadline.title}>
        <h3>{deadline.title}{deadline.dueDate ? ` · ${deadline.dueDate}` : ""}</h3>
        <Markdown result={result} locale={locale} sourceIds={deadline.sourceIds}>{deadline.calculationMethod}</Markdown>
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
      {(result.referenceNotes ?? []).map((note, index) => <article key={`${id}-reference-note-${index}`}>
        <h3>{note.title}</h3><Markdown result={result} locale={locale} sourceIds={note.sourceIds}>{note.note}</Markdown>
      </article>)}
    </Section>}
    {coverageGaps}
    {result.clarificationQuestions.length > 0 && <section className="legal-answer__questions" aria-labelledby={`${id}-clarify`}>
      <h2 id={`${id}-clarify`}>{copy.clarify}</h2>
      <div>{result.clarificationQuestions.map((question) => onQuestionSelect
        ? <button type="button" key={question} onClick={() => onQuestionSelect(question)}>{question}</button>
        : <p key={question}>{question}</p>)}</div>
    </section>}
    {!streaming && (internetNotice || incomplete) && <footer className="legal-answer__sources">
    {internetNotice}
    {incomplete && <p className={`legal-answer__authority legal-answer__authority--${mode}`}>{copy.partial}</p>}
    </footer>}
  </article>;
}
