import Link from "next/link";
import { headers } from "next/headers";
import styles from "./not-found.module.css";

const copy = {
  ru: {
    eyebrow: "JURO · НАВИГАЦИЯ",
    title: "Неверный адрес не должен обрывать путь.",
    body: "Этой страницы нет, но следующий юридический шаг можно начать с главной JURO или проверить, как мы работаем с данными.",
    primary: "На главную",
    secondary: "Открыть Trust Center",
    signal: "Маршрут не найден · данные аккаунта не затронуты",
  },
  uz: {
    eyebrow: "JURO · NAVIGATSIYA",
    title: "Noto‘g‘ri manzil yo‘lingizni to‘xtatmasin.",
    body: "Bu sahifa mavjud emas, biroq keyingi yuridik qadamni JURO bosh sahifasidan boshlashingiz yoki ma’lumotlar bilan qanday ishlashimizni tekshirishingiz mumkin.",
    primary: "Bosh sahifaga",
    secondary: "Trust Centerni ochish",
    signal: "Manzil topilmadi · akkaunt ma’lumotlariga ta’sir qilinmadi",
  },
  en: {
    eyebrow: "JURO · NAVIGATION",
    title: "A wrong route should not stop the right next step.",
    body: "This page is not available, but you can start the next legal step from JURO’s home page or see how we handle data.",
    primary: "Go to home",
    secondary: "Open Trust Center",
    signal: "Route not found · account data remains untouched",
  },
} as const;

export default async function NotFound() {
  const path = (await headers()).get("x-juro-request-path") ?? "";
  const language = /^\/uz(?:\/|$)/.test(path) ? "uz" : /^\/en(?:\/|$)/.test(path) ? "en" : "ru";
  return (
    <main className={styles.page}>
      <div aria-hidden="true" className={styles.grid} />
      {Object.entries(copy).filter(([locale]) => locale === language).map(([locale, t]) => (
        <section className={styles.content} data-locale={locale} key={locale} lang={locale}>
          <div className={styles.brand}><span aria-hidden="true">J</span><strong>JURO</strong></div>
          <div className={styles.body}>
            <p className={styles.eyebrow}>{t.eyebrow}</p>
            <span aria-hidden="true" className={styles.code}>404</span>
            <h1>{t.title}</h1>
            <p className={styles.lead}>{t.body}</p>
            <div className={styles.actions}>
              <Link href={`/${locale}`}>{t.primary}</Link>
              <Link href={`/${locale}/trust`}>{t.secondary}</Link>
            </div>
            <p className={styles.signal}>{t.signal}</p>
          </div>
          <aside aria-hidden="true" className={styles.routeCard}>
            <span>01</span><i />
            <strong>JURO</strong>
            <p>→</p>
          </aside>
        </section>
      ))}
    </main>
  );
}
