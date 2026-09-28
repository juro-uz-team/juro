import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { knowledgeArticles, knowledgeSlugs } from "../../../content/knowledge";
import type { PublicLanguage } from "../../../content/types";
import { SiteFooter, SiteHeader } from "../../components/public/SiteChrome";
import styles from "./knowledge.module.css";

type Props = { params: Promise<{ locale: string }> };

const copy = {
  ru: { title: "База знаний о правовых задачах", description: "Практические материалы JURO о договорах, фактах и моментах, когда нужен профессиональный юридический разбор.", eyebrow: "JURO · БАЗА ЗНАНИЙ", heading: "Понятные материалы для следующего юридического шага", lead: "Публикуем только материалы с конкретной задачей, источниками и предупреждением о границах общей информации.", read: "Открыть материал", updated: "Проверено", source: "Официальные источники указаны в каждом материале" },
  uz: { title: "Huquqiy vazifalar bo‘yicha bilimlar bazasi", description: "JUROning shartnomalar, faktlar va qachon professional yuridik tahlil kerakligi haqidagi amaliy materiallari.", eyebrow: "JURO · BILIMLAR BAZASI", heading: "Keyingi yuridik qadam uchun tushunarli materiallar", lead: "Faqat aniq vazifasi, manbalari va umumiy ma’lumot chegarasi ko‘rsatilgan materiallarni nashr qilamiz.", read: "Materialni ochish", updated: "Tekshirilgan sana", source: "Rasmiy manbalar har bir materialda ko‘rsatilgan" },
  en: { title: "Knowledge base for legal tasks in Uzbekistan", description: "Practical JURO guides on contracts, facts and the situations where professional legal review is needed.", eyebrow: "JURO · KNOWLEDGE BASE", heading: "Clear material for the next legal step", lead: "We publish guides with a specific task, sources and a clear boundary between general information and individual advice.", read: "Read the guide", updated: "Reviewed", source: "Each guide names its applicable official sources" },
} as const;

function localeOf(value: string): PublicLanguage | null { return value === "ru" || value === "uz" || value === "en" ? value : null; }

export function generateStaticParams() { return ["ru", "uz", "en"].map((locale) => ({ locale })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = localeOf((await params).locale);
  if (!locale) return {};
  const content = copy[locale];
  const canonical = `https://juro.uz/${locale}/knowledge`;
  return {
    title: content.title,
    description: content.description,
    alternates: { canonical, languages: { ru: "https://juro.uz/ru/knowledge", uz: "https://juro.uz/uz/knowledge", en: "https://juro.uz/en/knowledge", "x-default": "https://juro.uz/ru/knowledge" } },
    openGraph: { title: content.title, description: content.description, url: canonical, siteName: "JURO", type: "website", images: [{ url: "/juro-og.png", width: 1681, height: 909, alt: "JURO" }] },
    twitter: { card: "summary_large_image", title: content.title, description: content.description, images: ["/juro-og.png"] },
  };
}

export default async function KnowledgeHub({ params }: Props) {
  const locale = localeOf((await params).locale);
  if (!locale) notFound();
  const content = copy[locale];
  const canonical = `https://juro.uz/${locale}/knowledge`;
  const articles = knowledgeSlugs.map((slug) => ({ slug, ...knowledgeArticles[locale][slug] }));
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": canonical, url: canonical, name: content.title, description: content.description, inLanguage: locale, isPartOf: { "@id": "https://juro.uz/#website" }, hasPart: articles.map((article) => ({ "@type": "Article", headline: article.title, url: `https://juro.uz/${locale}/knowledge/${article.slug}` })) },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "JURO", item: `https://juro.uz/${locale}` }, { "@type": "ListItem", position: 2, name: content.title, item: canonical }] },
    ],
  }).replaceAll("<", "\\u003c");
  return <div className={styles.page} lang={locale}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
    <SiteHeader languageHref={`/${locale}/knowledge`} locale={locale} />
    <main id="main-content">
      <section className={styles.hero}><p>{content.eyebrow}</p><h1>{content.heading}</h1><span>{content.lead}</span></section>
      <section className={styles.grid} aria-label={content.title}>{articles.map((article) => <article className={styles.card} key={article.slug}><p>{article.category}</p><h2><Link href={`/${locale}/knowledge/${article.slug}`}>{article.title}</Link></h2><span>{article.description}</span><small>{content.updated}: {article.updatedAt}</small><Link className={styles.read} href={`/${locale}/knowledge/${article.slug}`}>{content.read} <b aria-hidden="true">→</b></Link></article>)}</section>
      <aside className={styles.sourceNote}>{content.source}</aside>
    </main>
    <SiteFooter locale={locale} />
  </div>;
}
