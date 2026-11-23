
import { WorkspaceTitle } from "./WorkspaceTitle";
import { ArrowLeft, ArrowRight, BookOpenCheck } from "lucide-react";
import Link from "next/link";

import type { KnowledgeBaseArticle } from "../../lib/platform/knowledge-base";
import type { PlatformLocale } from "../../lib/platform/routing";
import { KnowledgeBaseFeedback } from "./KnowledgeBaseFeedback";

const articleCopy = {
  ru: {
    navigation: "Навигация по базе знаний",
    allArticles: "Все статьи",
    version: "Версия",
    updated: "Обновлено",
    related: "Связанные статьи",
  },
  uz: {
    navigation: "Bilimlar bazasi navigatsiyasi",
    allArticles: "Barcha maqolalar",
    version: "Versiya",
    updated: "Yangilangan",
    related: "Bog‘liq maqolalar",
  },
  en: {
    navigation: "Knowledge base navigation",
    allArticles: "All articles",
    version: "Version",
    updated: "Updated",
    related: "Related articles",
  },
} as const;

export function KnowledgeBaseArticleView({ article, locale, backHref, articleBaseHref, feedbackEnabled }: {
  article: KnowledgeBaseArticle;
  locale: PlatformLocale;
  backHref: string;
  articleBaseHref: string;
  feedbackEnabled: boolean;
}) {
  const copy = articleCopy[locale];
  return <main className="knowledge-article" id="main-content">
    <nav aria-label={copy.navigation}>
      <Link href={backHref}><ArrowLeft aria-hidden="true" />{copy.allArticles}</Link>
    </nav>
    <article>
      <WorkspaceTitle icon={<BookOpenCheck />} title={article.title} description={<><p>{article.summary}</p><dl>
            <div><dt>{copy.version}</dt><dd>{article.versionNumber}</dd></div>
            <div><dt>{copy.updated}</dt><dd>{formatDate(article.updatedAt, locale)}</dd></div>
          </dl></>} />
      <div className="knowledge-article-body">
        {article.sections.map((section) => <section key={section.heading}>
          <h2>{section.heading}</h2>
          {section.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </section>)}
      </div>
      {feedbackEnabled && <KnowledgeBaseFeedback articleSlug={article.slug} versionId={article.versionId} locale={locale} />}
    </article>
    {article.related.length > 0 && <aside className="knowledge-related" aria-labelledby="related-title">
      <h2 id="related-title">{copy.related}</h2>
      <ul>{article.related.map((related) => <li key={related.slug}><Link href={`${articleBaseHref}/${related.slug}`}><span><strong>{related.title}</strong><small>{related.summary}</small></span><ArrowRight aria-hidden="true" /></Link></li>)}</ul>
    </aside>}
  </main>;
}

function formatDate(value: string, locale: PlatformLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], { day: "2-digit", month: "long", year: "numeric" }).format(date);
}
