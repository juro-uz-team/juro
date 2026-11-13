import { publicMetadata } from "../../../lib/public-seo";
import { searchPages } from "../../../content/search-pages";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../components/public/SiteChrome";
import { investorVideo } from "../../investor-video";
import styles from "./video.module.css";

type Locale = "ru" | "uz";
type Props = { params: Promise<{ locale: string }> };

const copy = {
  ru: {
    back: "На главную",
    description: "Короткая видеопрезентация JURO: юридическая помощь, AI-инструменты и следующий шаг в одной платформе.",
    duration: "2 мин 42 сек · 1080p",
    eyebrow: "ВИДЕОПРЕЗЕНТАЦИЯ JURO",
    heading: "Посмотрите, как JURO помогает перейти от вопроса к действию",
    language: "O‘zbekcha",
    languageHref: "/uz/video",
    notice: "Видео начинается автоматически без звука. Включите звук в панели плеера, когда будете готовы.",
    title: "Видеопрезентация JURO",
  },
  uz: {
    back: "Bosh sahifaga",
    description: "JURO qisqa videotaqdimoti: yuridik yordam, AI vositalari va bitta platformadagi keyingi qadam.",
    duration: "2 daqiqa 42 soniya · 1080p",
    eyebrow: "JURO VIDEOTAQDIMOTI",
    heading: "JURO savoldan keyingi amaliy qadamga qanday olib borishini ko‘ring",
    language: "Русский",
    languageHref: "/ru/video",
    notice: "Video avtomatik ravishda ovozsiz boshlanadi. Tayyor bo‘lganingizda pleyer panelidan ovozni yoqing.",
    title: "JURO videotaqdimoti",
  },
} as const;

function parseLocale(value: string): Locale | null {
  return value === "ru" || value === "uz" ? value : null;
}

export function generateStaticParams() {
  return [{ locale: "ru" }, { locale: "uz" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
 const locale = parseLocale((await params).locale);
 if (!locale) return {};
 return publicMetadata({ locale, ...searchPages[locale].video, path: "/video", image: "video" });
}

export default async function InvestorVideoPage({ params }: Props) {
  const locale = parseLocale((await params).locale);
  if (!locale) notFound();
  const content = copy[locale];

  return (
    <div className={styles.page} lang={locale}>
      <SiteHeader languageHref={content.languageHref} locale={locale} tone="dark" />
      <main id="main-content">
      <section className={styles.hero}>
        <p>{content.eyebrow}</p>
        <h1>{content.heading}</h1>
        <span>{content.duration}</span>
      </section>

      <section aria-label={content.title} className={styles.player}>
        <video autoPlay controls muted playsInline poster={investorVideo.poster} preload="auto">
          <source src={investorVideo.source} type="video/mp4" />
            <a href={investorVideo.source}>
              {locale === "ru" ? "Открыть MP4" : "MP4 faylini ochish"}
            </a>
        </video>
        <p>{content.notice}</p>
      </section>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
