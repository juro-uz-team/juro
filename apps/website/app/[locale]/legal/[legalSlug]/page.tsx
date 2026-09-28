import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../../components/public/SiteChrome";
import { legalConfig } from "../../../legal-config";
import { getLegalDocument, isLegalLocale, legalPath, relatedLegalDocuments, type LegalBlock } from "../../../legal-content";
import styles from "../legal.module.css";
import { LegalPrintButton } from "../LegalPrintButton";

type Props = { params: Promise<{ locale: string; legalSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, legalSlug } = await params;
  if (!isLegalLocale(locale)) return {};
  const document = getLegalDocument(locale, legalSlug);
  if (!document) return {};
  const canonical = `https://juro.uz${legalPath(locale, legalSlug)}`;
  return {
    title: document.title,
    description: document.description,
    robots: legalConfig.mode === "PRE_INCORPORATION_PREVIEW" ? { index: false, follow: true, nocache: true } : { index: true, follow: true },
    alternates: { canonical, languages: { ru: `https://juro.uz${legalPath("ru", legalSlug)}`, uz: `https://juro.uz${legalPath("uz", legalSlug)}`, "x-default": `https://juro.uz${legalPath("ru", legalSlug)}` } },
  };
}

function LegalBlockView({ block }: { block: LegalBlock }) {
  if (block.type === "paragraph") return <p>{block.text}</p>;
  if (block.type === "heading3") return <h3>{block.text}</h3>;
  if (block.type === "bullet_list" || block.type === "ordered_list") {
    const List = block.type === "ordered_list" ? "ol" : "ul";
    return <List>{block.items.map((item) => <li key={item}>{item}</li>)}</List>;
  }
  if (block.type === "table") {
    return <div className={styles.tableWrap}><table><thead><tr>{block.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{block.rows.map((row, index) => <tr key={`${row.join("-")}-${index}`}>{row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
  }
  return null;
}

export default async function LegalDocumentPage({ params }: Props) {
  const { locale, legalSlug } = await params;
  if (!isLegalLocale(locale)) notFound();
  const document = getLegalDocument(locale, legalSlug);
  if (!document) notFound();
  const ru = locale === "ru";
  const copy = legalConfig.publication[locale];
  const sections = document.sections.map((section, index) => ({ ...section, id: `section-${index + 1}` }));
  const related = relatedLegalDocuments(locale, legalSlug);
  return (
    <div className={styles.page} lang={locale}>
      <SiteHeader languageHref={legalPath(locale === "ru" ? "uz" : "ru", legalSlug)} locale={locale} />
      <main id="main-content">
      <article className={styles.document}>
        <nav className={styles.breadcrumb} aria-label={ru ? "Навигационная цепочка" : "Navigatsiya zanjiri"}><Link href={`/${locale}`}>JURO</Link><span aria-hidden="true">/</span><Link href={`/${locale}/legal`}>{ru ? "Юридический центр" : "Yuridik markaz"}</Link><span aria-hidden="true">/</span><span>{document.title}</span></nav>
        <header className={styles.documentHero}>
          <p className={styles.eyebrow}>{ru ? "ЮРИДИЧЕСКИЙ ДОКУМЕНТ" : "YURIDIK HUJJAT"}</p>
          <h1>{document.title}</h1>
          <p>{document.description}</p>
          <div className={styles.metadata}><span>{ru ? "Версия" : "Versiya"}: {document.version}</span><span>{copy.label}</span><LegalPrintButton label={ru ? "Печать / PDF" : "Chop etish / PDF"} /></div>
          <aside className={styles.previewNotice}><strong>{copy.label}</strong><span>{copy.notice}</span></aside>
        </header>
        <details className={styles.mobileToc}><summary>{ru ? "Содержание документа" : "Hujjat mazmuni"}</summary><ol>{sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>)}</ol></details>
        <div className={styles.documentLayout}>
          <aside className={styles.toc} aria-label={ru ? "Содержание документа" : "Hujjat mazmuni"}><p>{ru ? "Содержание" : "Mundarija"}</p><ol>{sections.map((section) => <li key={section.id}><a href={`#${section.id}`}>{section.heading}</a></li>)}</ol></aside>
          <div className={styles.documentContent}>{sections.map((section) => <section id={section.id} key={section.id}><h2>{section.heading}</h2>{section.blocks.map((block, index) => <LegalBlockView block={block} key={`${block.type}-${index}`} />)}</section>)}</div>
        </div>
        <aside className={styles.contactPanel}><div><p>{ru ? "Нужна помощь с данными или документом?" : "Ma’lumotlar yoki hujjat bo‘yicha yordam kerakmi?"}</p><span>{ru ? "Напишите по соответствующему каналу — обращение попадёт в нужную очередь." : "Tegishli kanal orqali yozing — murojaat kerakli navbatga tushadi."}</span></div><div><a href={`mailto:${legalConfig.contacts.privacyEmail}`}>{ru ? "Конфиденциальность" : "Maxfiylik"}</a><a href={`mailto:${legalConfig.contacts.legalEmail}`}>{ru ? "Юридическое обращение" : "Yuridik murojaat"}</a></div></aside>
        {related.length > 0 && <section className={styles.related}><p>{ru ? "Связанные документы" : "Bog‘liq hujjatlar"}</p><div>{related.map((item) => <Link href={legalPath(locale, item.slug)} key={item.slug}><span>{item.title}</span><i aria-hidden="true">→</i></Link>)}</div></section>}
      </article>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
