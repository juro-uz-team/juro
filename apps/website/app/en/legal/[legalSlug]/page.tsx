import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../../components/public/SiteChrome";
import { getLegalDocument, legalSlugs } from "../../../legal-content";
import styles from "../../../[locale]/legal/legal.module.css";

type Props = { params: Promise<{ legalSlug: string }> };

export function generateStaticParams() { return legalSlugs.map((legalSlug) => ({ legalSlug })); }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { legalSlug } = await params;
  const document = getLegalDocument("ru", legalSlug);
  if (!document) return {};
  return { title: `${document.title} — English guide`, description: "English orientation for a JURO legal document, with the published Russian and Uzbek originals.", robots: { index: false, follow: true, nocache: true }, alternates: { canonical: `https://juro.uz/en/legal/${legalSlug}` } };
}

export default async function EnglishLegalDocumentGuide({ params }: Props) {
  const { legalSlug } = await params;
  const russian = getLegalDocument("ru", legalSlug);
  const uzbek = getLegalDocument("uz", legalSlug);
  if (!russian || !uzbek) notFound();
  return <div className={styles.page} lang="en"><SiteHeader languageHref={`/ru/legal/${legalSlug}`} locale="en" /><main id="main-content"><article className={styles.document}>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link href="/en">JURO</Link><span aria-hidden="true">/</span><Link href="/en/legal">Legal Centre</Link><span aria-hidden="true">/</span><span>Published original</span></nav>
    <header className={styles.documentHero}><p className={styles.eyebrow}>LEGAL DOCUMENT · ENGLISH GUIDE</p><h1>{russian.title}</h1><p>This page identifies the document and gives access to the published source-language versions. It is not an English legal translation and must not be used as one.</p><div className={styles.metadata}><span>Version: {russian.version}</span><span>Published originals: RU / UZ</span></div><aside className={styles.previewNotice}><strong>Read the original before relying on it</strong><span>Only the linked Russian and Uzbek texts are published here as legal documents.</span></aside></header>
    <div className={styles.documentContent}><section><h2>Available originals</h2><p>The following links lead to the published versions of this document in the languages currently provided by JURO.</p><p><Link href={`/ru/legal/${legalSlug}`}>Open Russian original: {russian.title}</Link></p><p><Link href={`/uz/legal/${legalSlug}`}>Open Uzbek original: {uzbek.title}</Link></p></section><section><h2>Need help with a document?</h2><p>For a question about a document or data, use the appropriate published JURO contact and seek individual professional advice where necessary.</p></section></div>
  </article></main><SiteFooter locale="en" /></div>;
}
