import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../components/public/SiteChrome";
import { legalConfig } from "../../legal-config";
import { getLegalDocument, isLegalLocale, legalGroups, legalPath } from "../../legal-content";
import styles from "./legal.module.css";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLegalLocale(locale)) return {};
  const ru = locale === "ru";
  const canonical = `https://juro.uz/${locale}/legal`;
  return {
    title: ru ? "Юридический центр" : "Yuridik markaz",
    description: ru ? "Все юридические документы JURO в одном каталоге." : "JUROning barcha yuridik hujjatlari bitta katalogda.",
    robots: legalConfig.mode === "PRE_INCORPORATION_PREVIEW" ? { index: false, follow: true, nocache: true } : { index: true, follow: true },
    alternates: { canonical, languages: { ru: "https://juro.uz/ru/legal", uz: "https://juro.uz/uz/legal", "x-default": "https://juro.uz/ru/legal" } },
  };
}

export default async function LegalCenter({ params }: Props) {
  const { locale } = await params;
  if (!isLegalLocale(locale)) notFound();
  const ru = locale === "ru";
  const copy = legalConfig.publication[locale];
  return (
    <div className={styles.page} lang={locale}>
      <SiteHeader languageHref={`/${locale === "ru" ? "uz" : "ru"}/legal`} locale={locale} />
      <main id="main-content">
      <section className={styles.hero}>
        <p className={styles.eyebrow}>{ru ? "JURO · ЮРИДИЧЕСКИЙ ЦЕНТР" : "JURO · YURIDIK MARKAZ"}</p>
        <h1>{ru ? "Документы, которые легко найти и прочитать" : "Topish va o‘qish oson bo‘lgan hujjatlar"}</h1>
        <p>{ru ? "Условия использования, конфиденциальность, AI, документы, маркетплейс и порядок обращений — в единой актуальной структуре." : "Foydalanish shartlari, maxfiylik, AI, hujjatlar, marketpleys va murojaat qilish tartibi — yagona tuzilmada."}</p>
        <aside className={styles.previewNotice}><strong>{copy.label}</strong><span>{copy.notice}</span></aside>
      </section>
      <section className={styles.catalogue} aria-label={ru ? "Каталог документов" : "Hujjatlar katalogi"}>
        {legalGroups.map((group) => (
          <section className={styles.group} key={group.id}>
            <header><p>{group[locale].title}</p><span>{group[locale].description}</span></header>
            <div className={styles.cards}>
              {group.documents.map((slug) => {
                const document = getLegalDocument(locale, slug);
                if (!document) return null;
                return <Link className={styles.card} href={legalPath(locale, slug)} key={slug}><small>{ru ? "Версия" : "Versiya"} {document.version}</small><strong>{document.title}</strong><span>{document.description}</span><b>{ru ? "Открыть" : "Ochish"} <i aria-hidden="true">→</i></b></Link>;
              })}
            </div>
          </section>
        ))}
      </section>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
