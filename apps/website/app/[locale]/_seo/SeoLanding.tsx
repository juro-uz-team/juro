import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { seoLandings, seoLandingSlugs, type SeoLandingSlug } from "../../../content/seo-landings";
import type { PublicLanguage } from "../../../content/types";
import { SiteFooter, SiteHeader } from "../../components/public/SiteChrome";
import styles from "./seo-landing.module.css";

type Props = { params: Promise<{ locale: string }> };

function localeOf(value: string): PublicLanguage | null {
  return value === "ru" || value === "uz" || value === "en" ? value : null;
}

export function generateStaticParams() {
  return ["ru", "uz", "en"].flatMap((locale) => seoLandingSlugs.map((slug) => ({ locale, slug })));
}

export async function generateSeoLandingMetadata(slug: SeoLandingSlug, { params }: Props): Promise<Metadata> {
  const locale = localeOf((await params).locale);
  if (!locale) return {};
  const content = seoLandings[locale][slug];
  const canonical = `https://juro.uz/${locale}/${slug}`;
  return {
    title: content.title,
    description: content.description,
    alternates: {
      canonical,
      languages: Object.fromEntries(["ru", "uz", "en"].map((language) => [language, `https://juro.uz/${language}/${slug}`]).concat([["x-default", `https://juro.uz/ru/${slug}`]])),
    },
    openGraph: {
      title: content.title,
      description: content.description,
      url: canonical,
      siteName: "JURO",
      locale: locale === "ru" ? "ru_RU" : locale === "uz" ? "uz_UZ" : "en_US",
      type: "website",
      images: [{ url: "/juro-og.png", width: 1681, height: 909, alt: "JURO" }],
    },
    twitter: { card: "summary_large_image", title: content.title, description: content.description, images: ["/juro-og.png"] },
  };
}

export async function SeoLanding({ slug, params }: { slug: SeoLandingSlug; params: Props["params"] }) {
  const locale = localeOf((await params).locale);
  if (!locale) notFound();
  const content = seoLandings[locale][slug];
  const canonical = `https://juro.uz/${locale}/${slug}`;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": canonical, url: canonical, name: content.title, description: content.description, inLanguage: locale, isPartOf: { "@id": "https://juro.uz/#website" } },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "JURO", item: `https://juro.uz/${locale}` }, { "@type": "ListItem", position: 2, name: content.title, item: canonical }] },
    ],
  }).replaceAll("<", "\\u003c");

  return <div className={styles.page} lang={locale}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
    <SiteHeader languageHref={`/${locale}/${slug}`} locale={locale} />
    <main id="main-content">
      <section className={styles.hero}>
        <div><p className={styles.eyebrow}>{content.eyebrow}</p><h1>{content.heading}</h1><p className={styles.lead}>{content.lead}</p><a className={styles.primary} href={content.cta.href}>{content.cta.label}</a></div>
        <aside className={styles.scenario}><span>{content.scenarioTitle}</span><p>{content.scenario}</p></aside>
      </section>
      <section className={styles.steps} aria-label={content.scenarioTitle}>
        {content.steps.map((step, index) => <article key={step.title}><span>0{index + 1}</span><h2>{step.title}</h2><p>{step.body}</p></article>)}
      </section>
      <section className={styles.boundaries}><div><p className={styles.eyebrow}>JURO</p><h2>{content.boundariesTitle}</h2></div><ul>{content.boundaries.map((item) => <li key={item}>{item}</li>)}</ul></section>
      <section className={styles.next}><div><p>{content.related.label}</p><Link href={content.related.href}>→</Link></div><a className={styles.secondary} href={content.cta.href}>{content.cta.label}</a></section>
    </main>
    <SiteFooter locale={locale} />
  </div>;
}
