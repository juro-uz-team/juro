"use client";

import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { trackProductEvent } from "./product-analytics";
import styles from "./ProductAnalytics.module.css";

const copy = {
  en: {
    title: "Your privacy, your choice",
    description: "Optional analytics help us improve JURO. Your documents, messages and AI questions are never included.",
    necessary: "Essential only", allow: "Allow analytics",
    note: "Change this anytime in Account settings → Privacy.",
  },
  ru: {
    title: "Ваша приватность — ваш выбор",
    description: "Необязательная аналитика помогает улучшать JURO. Документы, переписка и вопросы к AI в неё не входят.",
    necessary: "Только необходимые", allow: "Разрешить аналитику",
    note: "Изменить выбор: настройки аккаунта → Приватность.",
  },
  uz: {
    title: "Maxfiylik — sizning tanlovingiz",
    description: "Ixtiyoriy tahliliy ma’lumotlar JURO’ni yaxshilashga yordam beradi. Hujjatlar, yozishmalar va AI savollari bunga kiritilmaydi.",
    necessary: "Faqat zaruriy", allow: "Tahlilga ruxsat berish",
    note: "Tanlovni hisob sozlamalari → Maxfiylik bo‘limida o‘zgartiring.",
  },
};

type Consent = "necessary" | "analytics";
const consentChanged = "juro-consent-changed";
let transientChoice: Consent | undefined;

function readConsent(): Consent | null | "loading" {
  if (transientChoice) return transientChoice;
  try {
    const saved = localStorage.getItem("juro-cookie-consent");
    return saved === "analytics" || saved === "necessary" ? saved : null;
  } catch { return "necessary"; }
}

function subscribeConsent(notify: () => void) {
  window.addEventListener("storage", notify);
  window.addEventListener(consentChanged, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(consentChanged, notify);
  };
}

const serverConsent = () => "loading" as const;

function saveConsent(value: Consent) {
  try {
    localStorage.setItem("juro-cookie-consent", value);
    transientChoice = undefined;
  } catch { transientChoice = value; }
  window.dispatchEvent(new Event(consentChanged));
}

export function AnalyticsPreferences({ locale }: { locale: "en" | "ru" | "uz" }) {
  const text = copy[locale];
  const choice = useSyncExternalStore(subscribeConsent, readConsent, serverConsent);
  const detail = {
    en: { title: "Analytics & privacy", scope: "This choice applies to this browser. Changes are saved automatically." },
    ru: { title: "Аналитика и приватность", scope: "Выбор действует в этом браузере. Изменения сохраняются автоматически." },
    uz: { title: "Tahlil va maxfiylik", scope: "Tanlov ushbu brauzer uchun amal qiladi. O‘zgarishlar avtomatik saqlanadi." },
  }[locale];
  return (
    <section className={styles.preferences} aria-labelledby="analytics-preferences-title">
      <h2 id="analytics-preferences-title" className={styles.title}><ShieldCheck size={20} aria-hidden="true" />{detail.title}</h2>
      <p className={styles.description}>{text.description}</p>
      <fieldset className={styles.options} disabled={choice === "loading"}>
        <legend className="sr-only">{detail.title}</legend>
        {(["necessary", "analytics"] as const).map(value => (
          <label key={value} className={styles.option}>
            <input type="radio" name="analytics-consent" value={value} checked={choice === value} onChange={() => saveConsent(value)} />
            {value === "necessary" ? text.necessary : text.allow}
          </label>
        ))}
      </fieldset>
      <p className={styles.scope}>{detail.scope}</p>
    </section>
  );
}

export function ProductAnalytics() {
  const path = usePathname();
  const locale = path.split("/")[1];
  const text = copy[locale === "en" || locale === "uz" ? locale : "ru"];
  const choice = useSyncExternalStore(subscribeConsent, readConsent, serverConsent);
  useEffect(() => {
    if (choice === "loading") return;
    if (choice === "analytics" && navigator.doNotTrack !== "1") {
      trackProductEvent("page_view");
      trackProductEvent("registration_completed");
    } else {
      void fetch("/api/product-events", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ consent: false }),
      }).catch(() => {});
    }
  }, [choice, path]);

  if (choice !== null) return null;

  return (
    <aside className={styles.card} aria-labelledby="analytics-title">
      <div className={styles.header}>
        <span className={styles.icon}><ShieldCheck size={21} strokeWidth={1.7} aria-hidden="true" /></span>
        <h2 id="analytics-title" className={styles.title}>{text.title}</h2>
      </div>
      <p className={styles.description}>{text.description}</p>
      <div className={styles.actions}>
        <button type="button" className={styles.necessary} onClick={() => saveConsent("necessary")}>{text.necessary}</button>
        <button type="button" className={styles.allow} onClick={() => saveConsent("analytics")}>{text.allow}</button>
      </div>
      <p className={styles.note}>{text.note}</p>
    </aside>
  );
}
