import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { PublicLanguage } from "../../../content/types";
import { SiteFooter, SiteHeader } from "../../components/public/SiteChrome";
import { LawyerCard } from "./LawyerCard";
import { getPublicLawyers, localizePublicLawyer, localizePublicLawyerText } from "./catalog";
import styles from "./lawyers.module.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const copy = {
  ru: { title: "Юристы и адвокаты", description: "Публичный каталог специалистов JURO: специализации, опыт, язык и доступность.", eyebrow: "JURO · ЖИВОЙ ЮРИСТ", heading: "Найдите юриста для следующего шага", lead: "Сравните специализации, опыт и формат консультации. Перед передачей материалов дела JURO всегда запросит ваше отдельное согласие.", catalogue: "Каталог специалистов", filters: "Фильтры каталога", search: "Поиск", searchHint: "Имя, фирма или специализация", specialty: "Специализация", all: "Все", language: "Язык", any: "Любой", availability: "Доступность", available: "Доступен", limited: "Ограниченная", experience: "Опыт", show: "Показать", unavailable: "Каталог временно обновляется. Попробуйте позже.", count: "Найдено специалистов", pendingHeading: "Профили на проверке JURO", pendingLead: "Эти специалисты завершили публичный профиль. Пока проверка не завершена, оставить заявку нельзя.", emptyHeading: "Подходящих профилей пока нет", emptyLead: "Измените фильтры или вернитесь позже: каталог пополняется после проверки профилей." },
  uz: { title: "Yuristlar va advokatlar", description: "JURO mutaxassislari ochiq katalogi: yo‘nalish, tajriba, til va mavjudlik.", eyebrow: "JURO · JONLI YURIST", heading: "Keyingi qadam uchun yurist toping", lead: "Mutaxassislik, tajriba va maslahat formatini taqqoslang. Ish materiallarini topshirishdan oldin JURO har doim alohida roziligingizni so‘raydi.", catalogue: "Mutaxassislar katalogi", filters: "Katalog filtrlari", search: "Qidiruv", searchHint: "Ism, firma yoki mutaxassislik", specialty: "Mutaxassislik", all: "Barchasi", language: "Til", any: "Istalgan", availability: "Mavjudlik", available: "Mavjud", limited: "Cheklangan", experience: "Tajriba", show: "Ko‘rsatish", unavailable: "Katalog vaqtincha yangilanmoqda. Keyinroq urinib ko‘ring.", count: "Topilgan mutaxassislar", pendingHeading: "JURO tekshiruvidagi profillar", pendingLead: "Bu mutaxassislar ochiq profilini to‘ldirgan. Tekshiruv tugamaguncha so‘rov qoldirib bo‘lmaydi.", emptyHeading: "Mos profillar hozircha yo‘q", emptyLead: "Filtrlarni o‘zgartiring yoki keyinroq qayting: katalog profillar tekshirilgach to‘ldiriladi." },
  en: { title: "Legal professionals", description: "JURO’s public catalogue of professionals: specialisms, experience, languages and availability.", eyebrow: "JURO · LEGAL PROFESSIONAL", heading: "Find a professional for the next step", lead: "Compare specialisms, experience and consultation formats. JURO will always request your separate confirmation before case materials are shared.", catalogue: "Professional catalogue", filters: "Catalogue filters", search: "Search", searchHint: "Name, firm or specialism", specialty: "Specialism", all: "All", language: "Language", any: "Any", availability: "Availability", available: "Available", limited: "Limited", experience: "Experience", show: "Show results", unavailable: "The catalogue is being updated. Please try again later.", count: "Professionals found", pendingHeading: "Profiles under JURO review", pendingLead: "These professionals have completed a public profile. Requests are unavailable until JURO’s review is complete.", emptyHeading: "No matching profiles yet", emptyLead: "Change the filters or return later: the catalogue grows after profiles are reviewed." },
} as const;

function localeOf(value: string): PublicLanguage | null { return value === "ru" || value === "uz" || value === "en" ? value : null; }
function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] || "" : value || ""; }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const locale = localeOf((await params).locale);
  if (!locale) return {};
  const t = copy[locale];
  const canonical = `https://juro.uz/${locale}/lawyers`;
  return {
    title: t.title,
    description: t.description,
    robots: { index: true, follow: true },
    alternates: { canonical, languages: { ru: "https://juro.uz/ru/lawyers", uz: "https://juro.uz/uz/lawyers", en: "https://juro.uz/en/lawyers", "x-default": "https://juro.uz/ru/lawyers" } },
    openGraph: { title: t.title, description: t.description, url: canonical, siteName: "JURO", type: "website", images: [{ url: "/juro-og.png", width: 1681, height: 909, alt: "JURO" }] },
    twitter: { card: "summary_large_image", title: t.title, description: t.description, images: ["/juro-og.png"] },
  };
}

export default async function LawyersPage({ params, searchParams }: Props) {
  const locale = localeOf((await params).locale);
  if (!locale) notFound();
  const t = copy[locale];
  const query = await searchParams;
  const term = first(query.q).trim().toLowerCase();
  const specialty = first(query.specialty);
  const language = first(query.language);
  const availability = first(query.availability);
  const minExperience = Number(first(query.experience) || "0");
  const { lawyers, available } = await getPublicLawyers();
  const specialties = [...new Set(lawyers.flatMap((item) => item.specialties))].sort();
  const languages = [...new Set(lawyers.flatMap((item) => item.languages))].sort();
  const results = lawyers.filter((lawyer) => {
    const searchable = [lawyer.displayName, lawyer.firmName, lawyer.bio, lawyer.city, lawyer.region, ...lawyer.specialties, ...lawyer.languages].filter(Boolean).join(" ").toLowerCase();
    return (!term || searchable.includes(term)) && (!specialty || lawyer.specialties.includes(specialty)) && (!language || lawyer.languages.includes(language)) && (!availability || lawyer.availabilityStatus === availability) && (!minExperience || (lawyer.experienceYears || 0) >= minExperience);
  });
  const approved = results.filter((lawyer) => lawyer.canReceiveRequests);
  const pending = results.filter((lawyer) => !lawyer.canReceiveRequests);
  const canonical = `https://juro.uz/${locale}/lawyers`;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": canonical, url: canonical, name: t.title, description: t.description, inLanguage: locale, isPartOf: { "@id": "https://juro.uz/#website" } },
      { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "JURO", item: `https://juro.uz/${locale}` }, { "@type": "ListItem", position: 2, name: t.title, item: canonical }] },
    ],
  }).replaceAll("<", "\\u003c");
  return <div className={styles.page} lang={locale}>
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} />
    <SiteHeader languageHref="/ru/lawyers" locale={locale} tone="dark" />
    <main id="main-content">
      <section className={styles.hero}><span>{t.eyebrow}</span><h1>{t.heading}</h1><p>{t.lead}</p></section>
      <section className={styles.catalogue} aria-labelledby="catalogue-heading"><h2 id="catalogue-heading" className={styles.srOnly}>{t.catalogue}</h2>
        <form className={styles.filters} method="get" aria-label={t.filters}>
          <label>{t.search}<input name="q" defaultValue={term} maxLength={160} placeholder={t.searchHint} /></label>
          <label>{t.specialty}<select name="specialty" defaultValue={specialty}><option value="">{t.all}</option>{specialties.map((item) => <option key={item} value={item}>{localizePublicLawyerText(item, locale)}</option>)}</select></label>
          <label>{t.language}<select name="language" defaultValue={language}><option value="">{t.any}</option>{languages.map((item) => <option key={item} value={item}>{localizePublicLawyerText(item, locale)}</option>)}</select></label>
          <label>{t.availability}<select name="availability" defaultValue={availability}><option value="">{t.any}</option><option value="available">{t.available}</option><option value="limited">{t.limited}</option></select></label>
          <label>{t.experience}<select name="experience" defaultValue={minExperience ? String(minExperience) : ""}><option value="">{t.any}</option><option value="3">3+</option><option value="5">5+</option><option value="10">10+</option></select></label>
          <button type="submit">{t.show}</button>
        </form>
        {!available ? <p className={styles.notice} role="status">{t.unavailable}</p> : <><p className={styles.count}>{t.count}: {results.length}</p><div className={styles.grid}>{approved.map((lawyer) => <LawyerCard key={lawyer.id} lawyer={localizePublicLawyer(lawyer, locale)} locale={locale} />)}</div>{pending.length > 0 && <section className={styles.pendingSection} aria-labelledby="pending-heading"><h2 id="pending-heading">{t.pendingHeading}</h2><p>{t.pendingLead}</p><div className={styles.grid}>{pending.map((lawyer) => <LawyerCard key={lawyer.id} lawyer={localizePublicLawyer(lawyer, locale)} locale={locale} />)}</div></section>}{results.length === 0 && <section className={styles.empty}><h2>{t.emptyHeading}</h2><p>{t.emptyLead}</p></section>}</>}
      </section>
    </main>
    <SiteFooter locale={locale} />
  </div>;
}
