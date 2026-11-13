import { notFound } from "next/navigation";
import { publishedArticles, type SiteArticle } from "../../../../lib/site-content";
import type { PublicLanguage } from "../../../../content/types";
import { publicMetadata, breadcrumbSchema } from "../../../../lib/public-seo";
import { SiteHeader, SiteFooter } from "../../../components/public/SiteChrome";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; slug: string }> };
async function article(params: Props["params"]): Promise<{ locale: PublicLanguage; found: SiteArticle }> {
  const { locale, slug } = await params;
  if (locale !== "ru" && locale !== "uz" && locale !== "en") notFound();
  const found = (await publishedArticles(locale, "page")).find(page => page.slug === slug);
  if (!found) notFound();
  return { locale, found };
}

export async function generateMetadata({ params }: Props) {
  const { locale, found } = await article(params);
  const translations = (await Promise.all((["ru", "uz", "en"] as const).map(async language => ({ language, pages: await publishedArticles(language, "page") })))).filter(edition => edition.pages.some(page => page.slug === found.slug && page.body.trim())).map(edition => edition.language);
  return publicMetadata({ locale, title: found.seo_title || found.title, description: found.seo_description || found.description, path: "/pages/" + encodeURIComponent(found.slug), languages: translations.length ? translations : [locale], noindex: !found.body.trim() });
}

export default async function ContentPage({ params }: Props) {
  const { locale, found } = await article(params);
  return <>
    <SiteHeader locale={locale} languageHref={`/${locale}`} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema(locale, [{ name: found.title, path: "/pages/" + encodeURIComponent(found.slug) }])).replaceAll("<", "\\u003c") }} />
    <main id="main-content" style={{ maxWidth: 920, margin: "96px auto 64px", padding: 24 }}><h1>{found.title}</h1><p>{found.description}</p><div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{found.body}</div></main>
    <SiteFooter locale={locale} />
  </>;
}
