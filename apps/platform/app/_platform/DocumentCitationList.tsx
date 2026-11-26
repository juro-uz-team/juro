import { BookOpen, ExternalLink } from "lucide-react";
import { useEffect, useRef } from "react";
import type { PlatformLocale } from "../../lib/platform/routing";
import { reviewText } from "./document-review-localization";
import "./document-citations.css";

export type DocumentCitation = {
  id: string;
  title: string;
  identifier: string | null;
  article?: string | null;
  url: string;
  excerpt?: string | null;
  uses?: string[];
};

function articleLabel(article: string | null | undefined, locale: PlatformLocale) {
  return article && /^\d+(?:-\d+)?$/u.test(article)
    ? reviewText(locale, "Статья " + article, article + "-modda", "Article " + article)
    : article;
}

export function DocumentCitationLinks({ ids, citations, locale, onOpen }: {
  ids?: string[]; citations: ReadonlyMap<string, DocumentCitation>; locale: PlatformLocale; onOpen: (id: string) => void;
}) {
  const cited = [...new Set(ids)].flatMap(id => citations.get(id) ?? []);
  if (!cited.length) return null;
  return <div className="document-citation-links">{cited.map(citation =>
    <button className="document-citation-chip" type="button" key={citation.id} onClick={() => onOpen(citation.id)}>
      <BookOpen aria-hidden="true" />
      <span>{[citation.title, citation.identifier, articleLabel(citation.article, locale)].filter(Boolean).join(" · ")}</span>
    </button>)}</div>;
}

export function DocumentCitationList({ citations, locale, selected }: {
  citations: DocumentCitation[]; locale: PlatformLocale; selected?: string | null;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    if (!selected) return;
    const card = Array.from(list.current?.querySelectorAll<HTMLElement>("[data-citation-id]") ?? [])
      .find(item => item.dataset.citationId === selected);
    if (!card) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: "start", behavior: "instant" });
  }, [selected]);
  const readExcerpt = reviewText(locale, "Выдержка из источника", "Manbadan parcha", "Source excerpt");
  const openOfficial = reviewText(locale, "Открыть на Lex.uz", "Lex.uz saytida ochish", "Open on Lex.uz");
  return <ul className="document-citations" ref={list}>{citations.map(citation => {
    const article = articleLabel(citation.article, locale);
    const active = selected === citation.id;
    return <li key={citation.id} className="document-citation" data-citation-id={citation.id} data-selected={active || undefined} tabIndex={-1}>
      <div className="document-citation-heading">
        <span className="document-citation-icon"><BookOpen aria-hidden="true" /></span>
        <div>
          <h4>{citation.title}</h4>
          {(article || citation.identifier) && <div className="document-citation-meta">
            {article && <span>{article}</span>}{citation.identifier && <small>{citation.identifier}</small>}
          </div>}
        </div>
        {/^https:\/\/(?:www\.)?lex\.uz\//i.test(citation.url) &&
          <a className="juro-record-action" href={citation.url} target="_blank" rel="noreferrer" aria-label={openOfficial + " — " + citation.title + (article ? ", " + article : "")}>
            {openOfficial}<ExternalLink aria-hidden="true" />
          </a>}
      </div>
      {!!citation.uses?.length && <div className="document-citation-uses">
        <strong>{reviewText(locale, "Где используется", "Qayerda qo‘llangan", "Cited in")}</strong>
        <ul>{citation.uses.map(use => <li key={use}>{use}</li>)}</ul>
      </div>}
      {!!citation.excerpt?.trim() && <details className="document-citation-excerpt" open={active || undefined}>
        <summary className="juro-disclosure-summary">{readExcerpt}</summary>
        <blockquote>{citation.excerpt.trim().split(/\n\s*\n/u).map((paragraph, index) =>
          /^(?:Статья\s+\d|Article\s+\d|\d+(?:-\d+)?-(?:modda|модда))/iu.test(paragraph) && index === 0
            ? <p className="document-citation-excerpt-title" key={index}>{paragraph}</p>
            : <p key={index}>{paragraph}</p>)}</blockquote>
      </details>}
    </li>;
  })}</ul>;
}
