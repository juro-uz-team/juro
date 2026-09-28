import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "../../components/public/SiteChrome";
import { getLegalDocument, legalGroups } from "../../legal-content";
import styles from "../../[locale]/legal/legal.module.css";

const groupCopy: Record<string, { title: string; description: string }> = {
  "using-juro": { title: "Using JURO", description: "Platform status, access rules and digital-feature terms." },
  privacy: { title: "Privacy and data", description: "Data processing, cookies, consents and data-subject rights." },
  "ai-documents": { title: "AI and documents", description: "The boundaries of AI, file handling and electronic communications." },
  marketplace: { title: "Professional marketplace", description: "Rules for clients, lawyers and advocates." },
  "payments-communications": { title: "Payments and requests", description: "Subscriptions, messages, complaints and dispute handling." },
};

const documentLabels: Record<string, string> = {
  "legal-information": "Legal information", "user-agreement": "User agreement", "public-offer": "Public offer", "privacy-policy": "Privacy policy", "personal-data-processing-policy": "Personal data processing policy", "personal-data-consent": "Personal data consent", "cross-border-ai-consent": "Cross-border AI consent", "cookie-policy": "Cookie policy", "payments-subscriptions-refunds": "Payments, subscriptions and refunds", "ai-use-policy": "AI use policy", "marketplace-client-rules": "Marketplace client rules", "lawyer-platform-terms": "Terms for legal professionals", "document-storage-rules": "Document storage rules", "electronic-communications-consent": "Electronic communications consent", "marketing-consent": "Marketing consent", "acceptable-use-policy": "Acceptable use policy", "complaints-disputes": "Complaints and disputes", "data-subject-request-form": "Data subject request form",
};

export const metadata: Metadata = {
  title: "Legal Centre",
  description: "English navigation for JURO’s published legal documents, with links to the Russian and Uzbek originals.",
  robots: { index: false, follow: true, nocache: true },
  alternates: { canonical: "https://juro.uz/en/legal", languages: { ru: "https://juro.uz/ru/legal", uz: "https://juro.uz/uz/legal", en: "https://juro.uz/en/legal", "x-default": "https://juro.uz/ru/legal" } },
};

export default function EnglishLegalCenter() {
  return <div className={styles.page} lang="en">
    <SiteHeader languageHref="/ru/legal" locale="en" />
    <main id="main-content"><section className={styles.hero}><p className={styles.eyebrow}>JURO · LEGAL CENTRE</p><h1>Find the published legal documents</h1><p>English navigation and document summaries are provided for orientation. The published Russian and Uzbek originals are the available legal texts; no English legal translation is represented here.</p><aside className={styles.previewNotice}><strong>Source-language originals</strong><span>Choose a document to see its scope and open the Russian or Uzbek published original.</span></aside></section>
      <section className={styles.catalogue} aria-label="Legal document catalogue">{legalGroups.map((group) => { const groupText = groupCopy[group.id]; return <section className={styles.group} key={group.id}><header><p>{groupText.title}</p><span>{groupText.description}</span></header><div className={styles.cards}>{group.documents.map((slug) => { const document = getLegalDocument("ru", slug); if (!document) return null; return <Link className={styles.card} href={`/en/legal/${slug}`} key={slug}><small>Version {document.version} · RU / UZ original</small><strong>{documentLabels[slug] ?? slug}</strong><span>Open the English guide and the published original-language documents.</span><b>View document <i aria-hidden="true">→</i></b></Link>; })}</div></section>; })}</section>
    </main>
    <SiteFooter locale="en" />
  </div>;
}
