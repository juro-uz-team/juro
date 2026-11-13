import type { MetadataRoute } from "next";
import { knowledgeArticles, knowledgeSlugs } from "../content/knowledge";
import { seoLandingSlugs } from "../content/seo-landings";
import { publicLanguages, publicOrigin, localizedAlternates, articleDate } from "../lib/public-seo";
import { publishedArticles } from "../lib/site-content";
import { getPublicLawyers } from "./[locale]/lawyers/catalog";
import { legalConfig } from "./legal-config";
import { legalSlugs } from "./legal-content";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  if (process.env.DEPLOYMENT_ENVIRONMENT === "staging") return [];
  const paths = ["", "/trust", "/video", "/lawyers", "/knowledge", ...seoLandingSlugs.map(slug => "/" + slug)];
  const entries: MetadataRoute.Sitemap = publicLanguages.flatMap(locale => paths.map(path => ({
    url: `${publicOrigin}/${locale}${path}`, alternates: { languages: localizedAlternates(path) },
  })));
  for (const locale of publicLanguages) for (const slug of knowledgeSlugs) entries.push({
    url: `${publicOrigin}/${locale}/knowledge/${slug}`,
    lastModified: articleDate(knowledgeArticles[locale][slug].updatedAt),
    alternates: { languages: localizedAlternates(`/knowledge/${slug}`) },
  });
  const [catalogue, editorial] = await Promise.all([
    getPublicLawyers(),
    Promise.all(publicLanguages.map(async locale => {
      const [pages, news] = await Promise.all([publishedArticles(locale, "page"), publishedArticles(locale, "news")]);
      return { locale, pages, news };
    })),
  ]);
  for (const lawyer of catalogue.lawyers.filter(profile => profile.marketplaceStatus === "public_approved")) {
    const path = "/lawyers/" + encodeURIComponent(lawyer.id);
    for (const locale of publicLanguages) entries.push({ url: `${publicOrigin}/${locale}${path}`, alternates: { languages: localizedAlternates(path) } });
  }
  for (const edition of editorial) {
    const newsLanguages = editorial.filter(value => value.news.some(article => article.body.trim())).map(value => value.locale);
    if (newsLanguages.includes(edition.locale)) entries.push({ url: `${publicOrigin}/${edition.locale}/news`, alternates: { languages: localizedAlternates("/news", newsLanguages) } });
    for (const page of edition.pages.filter(page => page.body.trim())) {
      const path = "/pages/" + encodeURIComponent(page.slug);
      const translations = editorial.filter(value => value.pages.some(other => other.slug === page.slug && other.body.trim())).map(value => value.locale);
      entries.push({ url: `${publicOrigin}/${edition.locale}${path}`, alternates: { languages: localizedAlternates(path, translations) } });
    }
  }
  if (legalConfig.mode === "INCORPORATED") {
    for (const locale of ["ru", "uz"] as const) for (const path of ["/legal", ...legalSlugs.map(slug => "/legal/" + slug)]) {
      entries.push({ url: `${publicOrigin}/${locale}${path}`, alternates: { languages: localizedAlternates(path, ["ru", "uz"]) } });
    }
  }
  return entries;
}
