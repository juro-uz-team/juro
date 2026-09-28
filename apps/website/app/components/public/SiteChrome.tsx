"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Mail, MapPin, Menu, Phone, X } from "lucide-react";
import { type MouseEvent, useEffect, useId, useRef, useState } from "react";
import type { PublicLanguage } from "../../../content/types";
import brandStyles from "./brand-lockup.module.css";
import footerContactStyles from "./footer-contact.module.css";
import footerRailStyles from "./footer-rail.module.css";
import headerTouchStyles from "./header-touch-targets.module.css";
import styles from "./site-chrome.module.css";
import { PublicThemeSwitcher } from "./ThemeSwitcher";
import {
  platformAuthHref,
  platformPersonalHref,
  platformRegistrationHref,
} from "./platform-hrefs";

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
    productLabel: "Продукт",
    companyLabel: "JURO",
    legalLabel: "Правовая информация",
    description: "Юридическая ситуация превращается в проверяемый план, документ и следующий шаг.",
    ai: "AI-юрист",
    document: "Проверка документа",
    plan: "План действий",
    business: "Для бизнеса",
    knowledge: "База знаний",
    privacy: "Конфиденциальность",
    terms: "Условия использования",
    data: "Персональные данные",
    aiRules: "Правила AI",
    contacts: "Контакты",
    address: "Ташкент, Узбекистан",
    note: "AI помогает подготовить работу, но не заменяет обязательную профессиональную помощь.",
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
    productLabel: "Mahsulot",
    companyLabel: "JURO",
    legalLabel: "Huquqiy ma’lumot",
    description: "Yuridik vaziyat tekshiriladigan reja, hujjat va keyingi qadamga aylanadi.",
    ai: "AI-yurist",
    document: "Hujjatni tekshirish",
    plan: "Harakatlar rejasi",
    business: "Biznes uchun",
    knowledge: "Bilimlar bazasi",
    privacy: "Maxfiylik",
    terms: "Foydalanish shartlari",
    data: "Shaxsiy ma’lumotlar",
    aiRules: "AI qoidalari",
    contacts: "Aloqa",
    address: "Toshkent, O‘zbekiston",
    note: "AI ishni tayyorlashga yordam beradi, ammo majburiy professional yordamni almashtirmaydi.",
  },
  en: {
    nav: "Main navigation", product: "Product", people: "Who it is for", trust: "Trust", resources: "Resources", lawyers: "Professionals", video: "Video", legal: "Legal Centre", signIn: "Sign in", start: "Start with JURO", open: "Open menu", close: "Close menu", skip: "Skip to main content", productLabel: "Product", companyLabel: "JURO", legalLabel: "Legal information", description: "A legal situation becomes a verifiable plan, a document and a clear next step.", ai: "AI legal assistant", document: "Document review", plan: "Action plan", business: "For business", knowledge: "Knowledge base", privacy: "Privacy", terms: "Terms of use", data: "Personal data", aiRules: "AI rules", contacts: "Contact", address: "Tashkent, Uzbekistan", note: "AI helps prepare legal work, but does not replace required professional advice.",
  },
} as const;

const languageLabels: Record<Locale, string> = { ru: "RU", uz: "UZ", en: "EN" };
const languages: Locale[] = ["ru", "uz", "en"];

export function SiteHeader({ locale, tone = "light", languageHref, onSectionNavigation }: { locale: Locale; tone?: "light" | "dark"; languageHref?: string; onSectionNavigation?: (event: MouseEvent<HTMLAnchorElement>) => void }) {
  const t = copy[locale];
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const panelId = useId();
  const scrollSentinelRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const loginHref = platformAuthHref(locale, "login");
  const registrationHref = platformRegistrationHref(locale);
  const localizedSuffix = languageHref?.replace(/^\/(?:ru|uz|en)(?=\/|$)/, "") ?? "";
  const localeHref = (target: Locale) => `/${target}${localizedSuffix}`;

  useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolled(!entry?.isIntersecting),
      { rootMargin: "18px 0px 0px", threshold: 0 },
    );
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

  const nav = [
    [t.product, onSectionNavigation ? "#product" : `/${locale}#product`],
    [t.people, onSectionNavigation ? "#audiences" : `/${locale}#audiences`],
    [t.trust, `/${locale}/trust`],
    [t.resources, onSectionNavigation ? "#resources" : `/${locale}#resources`],
  ] as const;

  return (
    <>
      <span
        aria-hidden="true"
        ref={scrollSentinelRef}
        style={{ height: 1, left: 0, pointerEvents: "none", position: "absolute", top: 0, width: 1 }}
      />
      <header className={styles.header} data-scrolled={scrolled || undefined} data-tone={tone}>
        <a className={styles.skipLink} href="#main-content">{t.skip}</a>
        <div className={styles.headerInner}>
          <Link aria-label="JURO" className={`${styles.logo} ${brandStyles.logo}`} href={`/${locale}`}>
            <span className={brandStyles.markFrame}><Image alt="" className={brandStyles.mark} height={1024} priority src={tone === "dark" && !scrolled ? "/juro-mark-light.png" : "/juro-mark.png"} unoptimized width={1024} /></span>
            <span className={brandStyles.wordmark}>JURO</span>
          </Link>
          <nav aria-label={t.nav} className={styles.desktopNav}>
            {nav.map(([label, href]) => onSectionNavigation && href.startsWith("#") ? <a href={href} key={href} onClick={onSectionNavigation}>{label}</a> : <Link href={href} key={href}>{label}</Link>)}
          </nav>
          <div className={styles.actions}>
            <PublicThemeSwitcher locale={locale} />
            <div aria-label="Language" className={`${styles.languageSet} ${headerTouchStyles.languageSet}`}>{languages.map((target) => <Link aria-current={target === locale ? "page" : undefined} className={`${styles.language} ${headerTouchStyles.language}`} href={localeHref(target)} key={target}>{languageLabels[target]}</Link>)}</div>
            <a className={`${styles.login} ${headerTouchStyles.login}`} href={loginHref}>{t.signIn}</a>
            <a className={styles.primary} href={registrationHref}>{t.start}<ArrowRight aria-hidden="true" size={17} /></a>
            <button aria-controls={panelId} aria-expanded={open} aria-label={t.open} className={styles.menuButton} onClick={() => setOpen(true)} ref={triggerRef} type="button"><Menu aria-hidden="true" size={22} /></button>
          </div>
        </div>
        {open ? (
          <div className={styles.mobileLayer}>
            <button aria-label={t.close} className={styles.scrim} onClick={() => setOpen(false)} type="button" />
            <div aria-label={t.nav} aria-modal="true" className={styles.mobilePanel} id={panelId} ref={panelRef} role="dialog">
              <div className={styles.mobileTop}>
                <div className={brandStyles.mobileBrand}>
                  <span className={brandStyles.mobileMarkFrame}><Image alt="" className={brandStyles.mobileMark} height={1024} src="/juro-mark.png" unoptimized width={1024} /></span>
                  <span>JURO</span>
                </div>
                <button aria-label={t.close} className={styles.closeButton} onClick={() => setOpen(false)} type="button"><X aria-hidden="true" size={22} /></button>
              </div>
              <nav>
                {nav.map(([label, href], index) => onSectionNavigation && href.startsWith("#") ? <a href={href} key={href} onClick={(event) => { onSectionNavigation(event); setOpen(false); }}><span>0{index + 1}</span>{label}<ArrowRight aria-hidden="true" size={18} /></a> : <Link href={href} key={href} onClick={() => setOpen(false)}><span>0{index + 1}</span>{label}<ArrowRight aria-hidden="true" size={18} /></Link>)}
                <Link href={`/${locale}/lawyers`} onClick={() => setOpen(false)}><span>05</span>{t.lawyers}<ArrowRight aria-hidden="true" size={18} /></Link>
                <Link href={`/${locale}/video`} onClick={() => setOpen(false)}><span>06</span>{t.video}<ArrowRight aria-hidden="true" size={18} /></Link>
                <Link href={`/${locale}/legal`} onClick={() => setOpen(false)}><span>07</span>{t.legal}<ArrowRight aria-hidden="true" size={18} /></Link>
              </nav>
              <div className={styles.mobileActions}>
                <PublicThemeSwitcher locale={locale} />
                <div aria-label="Language" className={styles.mobileLanguageSet}>{languages.map((target) => <Link aria-current={target === locale ? "page" : undefined} href={localeHref(target)} key={target} onClick={() => setOpen(false)}>{languageLabels[target]}</Link>)}</div>
                <a href={loginHref}>{t.signIn}</a>
                <a href={registrationHref}>{t.start}<ArrowRight aria-hidden="true" size={17} /></a>
              </div>
            </div>
          </div>
        ) : null}
      </header>
    </>
  );
}

export function SiteFooter({ locale }: { locale: Locale }) {
  const t = copy[locale];
  const year = new Date().getFullYear();
  const productLinks = [
    [t.ai, `/${locale}/ai-lawyer`],
    [t.document, `/${locale}/contract-review`],
    [t.plan, platformPersonalHref(locale, "/cases")],
    [t.lawyers, `/${locale}/lawyers`],
  ] as const;
  return (
    <footer className={`${styles.footer} ${footerRailStyles.footer}`}>
      <div className={`${styles.footerTop} ${footerRailStyles.top}`}>
        <div className={`${styles.footerBrand} ${footerRailStyles.brand}`}>
          <Link aria-label="JURO" className={brandStyles.footerLogo} href={`/${locale}`}>
            <span className={brandStyles.footerMarkFrame}><Image alt="" className={brandStyles.footerMark} height={1024} src="/juro-mark-light.png" unoptimized width={1024} /></span>
            <span>JURO</span>
          </Link>
          <p>{t.description}</p>
          <a className={footerRailStyles.brandCta} href={platformRegistrationHref(locale)}>{t.start}<ArrowRight aria-hidden="true" size={16} /></a>
        </div>
        <div className={`${styles.footerColumn} ${footerRailStyles.column}`}><strong>{t.productLabel}</strong>{productLinks.map(([label, href]) => href.startsWith("/") ? <Link href={href} key={href}>{label}</Link> : <a href={href} key={href}>{label}</a>)}</div>
        <div className={`${styles.footerColumn} ${footerRailStyles.column}`}><strong>{t.companyLabel}</strong><Link href={`/${locale}/trust`}>Trust Center</Link><Link href={`/${locale}/video`}>{t.video}</Link><Link href={`/${locale}/knowledge`}>{t.knowledge}</Link></div>
        <div className={`${styles.footerColumn} ${footerRailStyles.column}`}><strong>{t.legalLabel}</strong><Link href={`/${locale}/legal`}>{t.legal}</Link><Link href={`/${locale}/privacy-policy`}>{t.privacy}</Link><Link href={`/${locale}/terms`}>{t.terms}</Link><Link href={`/${locale}/personal-data-processing`}>{t.data}</Link><Link href={`/${locale}/ai-rules`}>{t.aiRules}</Link></div>
      </div>
      <address aria-label={t.contacts} className={`${footerContactStyles.contacts} ${footerRailStyles.contacts}`}>
        <span><MapPin aria-hidden="true" size={16} />{t.address}</span>
        <a href="tel:+998974022292"><Phone aria-hidden="true" size={16} />+998974022292</a>
        <a href="mailto:admin@juro.uz"><Mail aria-hidden="true" size={16} />admin@juro.uz</a>
      </address>
      <div className={`${styles.footerBottom} ${footerContactStyles.bottom} ${footerRailStyles.bottom}`}><span>© {year} JURO</span><p>{t.note}</p><span className={styles.footerLanguages}>{languages.map((target) => <Link aria-current={target === locale ? "page" : undefined} href={`/${target}`} key={target}>{languageLabels[target]}</Link>)}</span></div>
    </footer>
  );
}
