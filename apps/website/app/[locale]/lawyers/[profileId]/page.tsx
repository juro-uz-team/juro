import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { PublicLanguage } from "../../../../content/types";
import { SiteFooter, SiteHeader } from "../../../components/public/SiteChrome";
import { platformPersonalHref } from "../../../components/public/platform-hrefs";
import { getPublicLawyer, localizePublicLawyer, publicPhotoUrl } from "../catalog";
import { LawyerAvatar } from "../LawyerAvatar";
import styles from "../lawyers.module.css";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ locale: string; profileId: string }> };
function localeOf(value: string): PublicLanguage | null { return value === "ru" || value === "uz" || value === "en" ? value : null; }

const copy = {
  ru: { back: "Каталог юристов", pending: "ПРОФИЛЬ НА ПРОВЕРКЕ JURO", approved: "ОДОБРЕН JURO", independent: "Независимый специалист", pendingNotice: "Профиль уже публичный, но запись станет доступна только после завершения проверки JURO.", about: "О специалисте", unknown: "Профессиональная информация уточняется.", education: "Образование", languages: "Языки", city: "Город", experience: "Опыт", price: "Стоимость", format: "Формат", request: "Оставить заявку", privacy: "Конфиденциальность до передачи дела", privacyLead: "Контактные данные не публикуются. Юрист получает ограниченное описание для проверки конфликта интересов; материалы дела передаются только после вашего отдельного подтверждения.", years: "лет" },
  uz: { back: "Yuristlar katalogi", pending: "PROFIL JURO TEKSHIRUVIDA", approved: "JURO TASDIQLAGAN", independent: "Mustaqil mutaxassis", pendingNotice: "Profil ochiq, biroq so‘rov yuborish faqat JURO tekshiruvi tugagandan keyin mumkin.", about: "Mutaxassis haqida", unknown: "Kasbiy ma’lumot aniqlashtirilmoqda.", education: "Ta’lim", languages: "Tillar", city: "Shahar", experience: "Tajriba", price: "Narx", format: "Format", request: "So‘rov qoldirish", privacy: "Ish topshirilishidan oldingi maxfiylik", privacyLead: "Kontakt ma’lumotlari ochiq e’lon qilinmaydi. Yurist manfaatlar to‘qnashuvini tekshirish uchun cheklangan tavsif oladi; ish materiallari faqat alohida tasdiqlashingizdan keyin beriladi.", years: "yil" },
  en: { back: "Professional catalogue", pending: "PROFILE UNDER JURO REVIEW", approved: "APPROVED BY JURO", independent: "Independent professional", pendingNotice: "This profile is public, but requests become available only after JURO’s review is complete.", about: "About this professional", unknown: "Professional information is being clarified.", education: "Education", languages: "Languages", city: "City", experience: "Experience", price: "Price", format: "Format", request: "Request a consultation", privacy: "Privacy before case handoff", privacyLead: "Contact details are not published. The professional receives a limited description to check conflicts of interest; case materials are shared only after your separate confirmation.", years: "years" },
} as const;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: rawLocale, profileId } = await params;
  const locale = localeOf(rawLocale);
  if (!locale) return {};
  const sourceLawyer = await getPublicLawyer(profileId);
  const lawyer = sourceLawyer && localizePublicLawyer(sourceLawyer, locale);
  if (!lawyer) return {};
  const pending = lawyer.marketplaceStatus === "pending_review";
  const description = lawyer.bio || lawyer.specialties.join(", ");
  const canonical = `https://juro.uz/${locale}/lawyers/${lawyer.id}`;
  const photo = publicPhotoUrl(lawyer.profilePhotoUrl);
  const images = photo ? [{ url: photo, alt: lawyer.displayName }] : [];
  return {
    title: lawyer.displayName,
    description,
    robots: { index: !pending, follow: true },
    alternates: { canonical, languages: { ru: `https://juro.uz/ru/lawyers/${lawyer.id}`, uz: `https://juro.uz/uz/lawyers/${lawyer.id}`, en: `https://juro.uz/en/lawyers/${lawyer.id}`, "x-default": `https://juro.uz/ru/lawyers/${lawyer.id}` } },
    openGraph: { title: lawyer.displayName, description, url: canonical, siteName: "JURO", type: "profile", images },
    twitter: { card: "summary", title: lawyer.displayName, description, images: photo ? [photo] : [] },
  };
}

export default async function LawyerProfilePage({ params }: Props) {
  const { locale: rawLocale, profileId } = await params;
  const locale = localeOf(rawLocale);
  if (!locale) notFound();
  const sourceLawyer = await getPublicLawyer(profileId);
  if (!sourceLawyer) notFound();
  const lawyer = localizePublicLawyer(sourceLawyer, locale);
  const t = copy[locale];
  const pending = lawyer.marketplaceStatus === "pending_review";
  const photo = publicPhotoUrl(lawyer.profilePhotoUrl);
  const canonical = `https://juro.uz/${locale}/lawyers/${lawyer.id}`;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": canonical,
    url: canonical,
    name: lawyer.displayName,
    inLanguage: locale,
    mainEntity: { "@type": "Person", name: lawyer.displayName, image: photo || undefined, jobTitle: lawyer.specialties.join(", "), knowsLanguage: lawyer.languages },
  }).replaceAll("<", "\\u003c");
  return <div className={styles.page} lang={locale}><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: structuredData }} /><SiteHeader languageHref={`/ru/lawyers/${profileId}`} locale={locale} /><main id="main-content"><article className={styles.profile}>
    <Link className={styles.back} href={`/${locale}/lawyers`}>← {t.back}</Link>
    <div className={styles.profileHead}><LawyerAvatar className={styles.profilePhoto} fallbackClassName={styles.profileInitials} initials={lawyer.displayName.slice(0, 1)} size={144} src={photo} /><div><span className={pending ? styles.pending : styles.approved}>{pending ? t.pending : t.approved}</span><h1>{lawyer.displayName}</h1><p>{lawyer.firmName || t.independent}</p><p className={styles.specialties}>{lawyer.specialties.join(" · ")}</p></div></div>
    {pending && <aside className={styles.reviewNotice}>{t.pendingNotice}</aside>}
    <div className={styles.profileGrid}><section><h2>{t.about}</h2><p>{lawyer.bio || t.unknown}</p>{lawyer.education && <><h2>{t.education}</h2><p>{lawyer.education}</p></>}</section><aside><dl className={styles.detailFacts}><div><dt>{t.languages}</dt><dd>{lawyer.languages.join(", ")}</dd></div>{lawyer.city && <div><dt>{t.city}</dt><dd>{[lawyer.city, lawyer.region].filter(Boolean).join(", ")}</dd></div>}{lawyer.experienceYears !== null && <div><dt>{t.experience}</dt><dd>{lawyer.experienceYears} {t.years}</dd></div>}{lawyer.priceDescription && <div><dt>{t.price}</dt><dd>{lawyer.priceDescription}</dd></div>}<div><dt>{t.format}</dt><dd>{lawyer.consultationFormats.join(", ") || "—"}</dd></div></dl>{!pending && <a className={styles.profileCta} href={platformPersonalHref(locale, `/consultations?lawyer=${encodeURIComponent(lawyer.id)}`)}>{t.request}</a>}</aside></div>
    <section className={styles.privacy}><h2>{t.privacy}</h2><p>{t.privacyLead}</p></section>
  </article></main><SiteFooter locale={locale} /></div>;
}
