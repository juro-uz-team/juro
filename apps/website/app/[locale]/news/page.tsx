import { notFound } from "next/navigation";
import { publishedArticles, type SiteArticle } from "../../../lib/site-content";
import type { PublicLanguage } from "../../../content/types";
import { publicMetadata, breadcrumbSchema } from "../../../lib/public-seo";
import { searchPages } from "../../../content/search-pages";
import { SiteHeader, SiteFooter } from "../../components/public/SiteChrome";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }> };
async function edition(params: Props["params"]): Promise<{ locale: PublicLanguage; articles: SiteArticle[] }> {
  const { locale } = await params;
  if (locale !== "ru" && locale !== "uz" && locale !== "en") notFound();
  return { locale, articles: await publishedArticles(locale, "news") };
}
export async function generateMetadata({ params }: Props) {
  const { locale, articles } = await edition(params);
  const languages = (await Promise.all((["ru", "uz", "en"] as const).map(async language => ({ language, articles: await publishedArticles(language, "news") })))).filter(value => value.articles.some(article => article.body.trim())).map(value => value.language);
  return publicMetadata({ locale, ...searchPages[locale].news, path: "/news", image: "news", noindex: !articles.some(article => article.body.trim()), languages: languages.length ? languages : [locale] });
}
export default async function News({ params }: Props) {
  const { locale, articles } = await edition(params);
  return <>
    <SiteHeader locale={locale} languageHref={`/${locale}/news`} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema(locale, [{ name: searchPages[locale].news.title, path: "/news" }])).replaceAll("<", "\\u003c") }} />
    <main id="main-content" style={{ maxWidth: 920, margin: "96px auto 64px", padding: 24 }}><h1>{searchPages[locale].news.title}</h1><p>{searchPages[locale].news.description}</p>{articles.length ? articles.map(article => <article key={article.slug} style={{ borderBottom: "1px solid #d9dee1", padding: "32px 0" }}><h2>{article.title}</h2><p>{article.description}</p><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{article.body}</div></article>) : <p>{locale === "ru" ? "Пока нет опубликованных новостей." : locale === "uz" ? "Hozircha yangiliklar yo‘q." : "No published news yet."}</p>}</main>
    <SiteFooter locale={locale} />
  </>;
}
