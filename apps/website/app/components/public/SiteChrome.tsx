"use client";

import { OfficialLogo } from "./OfficialLogo";
import Link from "next/link";
import { platformAuthHref, platformRegistrationHref } from "./platform-hrefs";
import { ArrowRight, ChevronDown, Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PublicLanguage } from "../../../content/types";
import brandStyles from "./brand-lockup.module.css";
import headerTouchStyles from "./header-touch-targets.module.css";
import styles from "./site-chrome.module.css";
import { PublicThemeSwitcher } from "./ThemeSwitcher";

type Locale = PublicLanguage;

const copy = {
  ru: {
    nav: "Главная навигация",
    product: "Продукт",
    people: "Для кого",
    trust: "Доверие",
    resources: "Ресурсы",
    lawyers: "Юристы",
    video: "Видео",
    legal: "Документы",
    signIn: "Войти",
    start: "Начать с JURO",
    open: "Открыть меню",
    close: "Закрыть меню",
    skip: "К основному содержанию",
  },
  uz: {
    nav: "Asosiy navigatsiya",
    product: "Mahsulot",
    people: "Kim uchun",
    trust: "Ishonch",
    resources: "Resurslar",
    lawyers: "Yuristlar",
    video: "Video",
    legal: "Hujjatlar",
    signIn: "Kirish",
    start: "JURO bilan boshlash",
    open: "Menyuni ochish",
    close: "Menyuni yopish",
    skip: "Asosiy mazmunga o‘tish",
  },
  en: {
    nav: "Main navigation", product: "Product", people: "Who it is for", trust: "Trust", resources: "Resources", lawyers: "Professionals", video: "Video", legal: "Legal Centre", signIn: "Sign in", start: "Start with JURO", open: "Open menu", close: "Close menu", skip: "Skip to main content",
  },
} as const;

const languageLabels: Record<Locale, string> = { ru: "RU", uz: "UZ", en: "EN" };
const languageNames: Record<Locale, string> = { ru: "Русский", uz: "O‘zbekcha", en: "English" };
const languagePickerLabels: Record<Locale, string> = { ru: "Язык", uz: "Til", en: "Language" };
const languages: Locale[] = ["ru", "uz", "en"];

export function SiteHeader({ locale, tone = "light", languageHref, home = false }: { locale: Locale; tone?: "light" | "dark"; languageHref?: string; home?: boolean }) {
  const t = copy[locale];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelId = useId();
  const scrollSentinelRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const languagePickerRef = useRef<HTMLDetailsElement>(null);
  const localizedSuffix = languageHref?.replace(/^\/(?:ru|uz|en)(?=\/|$)/, "") ?? "";
  const localeHref = (target: Locale) => `/${target}${localizedSuffix}`;

  useEffect(() => {
    const picker = languagePickerRef.current;
    if (!picker) return;
    const dismiss = (event: PointerEvent) => {
      if (!picker.contains(event.target as Node)) picker.open = false;
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);

  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry?.isIntersecting), { rootMargin: "18px 0px 0px", threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    document.body.style.overflow = "hidden";
    const focusable = panel
      ? Array.from(panel.querySelectorAll<HTMLElement>("a[href],button:not([disabled])"))
      : [];
    focusable[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
      trigger?.focus();
    };
  }, [open]);

  const nav = home ? [
    [t.product, "#product"],
    [t.lawyers, `/${locale}/lawyers`],
    [{ ru: "Вопросы", uz: "Savollar", en: "FAQ" }[locale], "#faq"],
  ] : [
    [t.product, `/${locale}#product`],
    [t.people, `/${locale}#audiences`],
    [t.trust, `/${locale}/trust`],
    [t.resources, `/${locale}#resources`],
  ] as const;

  return (
    <>
    <span ref={scrollSentinelRef} aria-hidden="true" style={{ position: "absolute", top: 0, width: 1, height: 1, pointerEvents: "none" }} />
    <header className={styles.header} data-scrolled={scrolled || undefined} data-tone={tone} data-home={home || undefined}>
      <a className={styles.skipLink} href="#main-content">{t.skip}</a>
      <div className={styles.headerInner}>
        <Link aria-label="JURO" className={`${styles.logo} ${brandStyles.logo}`} href={`/${locale}`}>
          <OfficialLogo inverse={tone === "dark" && !scrolled} priority />
        </Link>
        <nav aria-label={t.nav} className={styles.desktopNav}>
          {nav.map(([label, href]) => <Link href={href} key={href}>{label}</Link>)}
        </nav>
        <div className={styles.actions}>
          <PublicThemeSwitcher locale={locale} />
          <div aria-label={languagePickerLabels[locale]} className={styles.languageSet}>{languages.map((target) => <a aria-current={target === locale ? "page" : undefined} className={`${styles.language} ${headerTouchStyles.language}`} href={localeHref(target)} key={target}>{languageLabels[target]}</a>)}</div>
          <details className={styles.mobileLanguage} ref={languagePickerRef} onBlur={(event) => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
          }} onKeyDown={(event) => {
            if (event.key === "Escape" && event.currentTarget.open) {
              event.currentTarget.open = false;
              event.currentTarget.querySelector("summary")?.focus();
            }
          }}>
            <summary aria-label={`${languagePickerLabels[locale]} (${languageLabels[locale]})`}>
              {languageLabels[locale]}<ChevronDown aria-hidden="true" size={14} />
            </summary>
            <div className={styles.languageOptions}>
              {languages.map((target) => <a aria-current={target === locale ? "page" : undefined} href={localeHref(target)} key={target} lang={target}>{languageNames[target]}</a>)}
            </div>
          </details>
          <a className={`${styles.login} ${headerTouchStyles.login}`} href={platformAuthHref(locale, "login")}>{t.signIn}</a>
          <a className={styles.primary} href={platformRegistrationHref(locale)}>{t.start}<ArrowRight aria-hidden="true" size={17} /></a>
          <button aria-controls={panelId} aria-expanded={open} aria-label={t.open} className={styles.menuButton} onClick={() => { languagePickerRef.current?.removeAttribute("open"); setOpen(true); }} ref={triggerRef} type="button"><Menu aria-hidden="true" size={22} /></button>
        </div>
      </div>
      {open ? (
        <div className={styles.mobileLayer}>
          <button aria-label={t.close} className={styles.scrim} onClick={() => setOpen(false)} type="button" />
          <div aria-label={t.nav} aria-modal="true" className={styles.mobilePanel} id={panelId} ref={panelRef} role="dialog">
            <div className={styles.mobileTop}>
              <div className={brandStyles.mobileBrand}>
                <OfficialLogo />
              </div>
              <button aria-label={t.close} className={styles.closeButton} onClick={() => setOpen(false)} type="button"><X aria-hidden="true" size={22} /></button>
            </div>
            <nav>
              {nav.map(([label, href], index) => <Link href={href} key={href} onClick={() => setOpen(false)}>{!home && <span>0{index + 1}</span>}{label}<ArrowRight aria-hidden="true" size={18} /></Link>)}
              {!home && <>
                <Link href={`/${locale}/lawyers`} onClick={() => setOpen(false)}><span>05</span>{t.lawyers}<ArrowRight aria-hidden="true" size={18} /></Link>
                <Link href={`/${locale}/video`} onClick={() => setOpen(false)}><span>06</span>{t.video}<ArrowRight aria-hidden="true" size={18} /></Link>
                <Link href={`/${locale}/legal`} onClick={() => setOpen(false)}><span>07</span>{t.legal}<ArrowRight aria-hidden="true" size={18} /></Link>
              </>}
            </nav>
            <div className={styles.mobileActions}>
              {home && <a href={platformAuthHref(locale, "login")}>{t.signIn}</a>}
              <a href={platformRegistrationHref(locale)}>{t.start}<ArrowRight aria-hidden="true" size={17} /></a>
            </div>
          </div>
        </div>
      ) : null}
    </header>
    </>
  );
}
