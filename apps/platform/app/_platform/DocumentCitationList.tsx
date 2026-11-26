import { BookOpen, ExternalLink } from "lucide-react";
import type { PlatformLocale } from "../../lib/platform/routing";
import { reviewText } from "./document-review-localization";
import "./document-citations.css";

type Citation = {
  id: string;
  title: string;
  identifier: string | null;
  article?: string | null;
  url: string;
  excerpt?: string | null;
};

export function DocumentCitationList({ citations, locale }: { citations: Citation[]; locale: PlatformLocale }) {
  const readExcerpt = reviewText(locale, "Выдержка из источника", "Manbadan parcha", "Source excerpt");
  const openOfficial = reviewText(locale, "Открыть на Lex.uz", "Lex.uz saytida ochish", "Open on Lex.uz");
  return <ul className="document-citations">{citations.map(citation => {
    const article = citation.article && /^\d+(?:-\d+)?$/u.test(citation.article)
      ? reviewText(locale, "Статья " + citation.article, citation.article + "-modda", "Article " + citation.article)
      : citation.article;
    return <li key={citation.id} className="document-citation">
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
      {!!citation.excerpt?.trim() && <details className="document-citation-excerpt">
        <summary className="juro-disclosure-summary">{readExcerpt}</summary>
        <blockquote>{citation.excerpt.trim().split(/\n\s*\n/u).map((paragraph, index) =>
          /^(?:Статья\s+\d|Article\s+\d|\d+(?:-\d+)?-(?:modda|модда))/iu.test(paragraph) && index === 0
            ? <p className="document-citation-excerpt-title" key={index}>{paragraph}</p>
            : <p key={index}>{paragraph}</p>)}</blockquote>
      </details>}
    </li>;
  })}</ul>;
}
