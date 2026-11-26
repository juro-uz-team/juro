"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowUpRight, MapPin } from "lucide-react";
import { homepageCopy } from "../../../content/homepage";
import type { PublicLanguage } from "../../../content/types";
import { OfficialLogo } from "./OfficialLogo";
import { platformRegistrationHref } from "./platform-hrefs";
import styles from "./juro-home.module.css";

export function SiteFooter({ initialLocale }: { initialLocale: PublicLanguage }) {
  const segment = usePathname()?.split("/", 2)[1];
  const locale = segment === "ru" || segment === "uz" || segment === "en" ? segment : initialLocale;
  const copy = homepageCopy[locale];
  const register = platformRegistrationHref(locale);

  return (
    <footer className={styles.footer} id="resources">
      <div className={styles.wrap}>
        <div className={styles.anchors} aria-hidden="true"><span id="audiences" /></div>
        <div className={styles.closing} id="start" data-nosnippet="">
          <h2>{copy.closing}</h2>
          <a className={styles.primary} href={register}>{copy.start}<ArrowUpRight aria-hidden="true" size={19} /></a>
        </div>
        <div className={styles.footerLinks} data-nosnippet="">
          <Link aria-label="JURO" href={`/${locale}`}><OfficialLogo inverse /></Link>
          <Link href={`/${locale}/video`}>{copy.video}</Link>
          <Link href={`/${locale}/knowledge`}>{copy.knowledge}</Link>
          <Link href={`/${locale}/legal`}>{copy.legal}</Link>
          <a href={`${register}&returnTo=${encodeURIComponent(`/${locale}/workspace/team`)}`}>{copy.business}</a>
        </div>
        <address className={styles.contact}>
          <span><MapPin aria-hidden="true" size={15} />{copy.location}</span>
          <a href="mailto:admin@juro.uz">admin@juro.uz</a>
          <a href="tel:+998200023112">+998 20 002 31 12</a>
        </address>
        <div className={styles.footerNote} data-nosnippet=""><span>© {new Date().getFullYear()} JURO</span><p>{copy.note}</p></div>
      </div>
    </footer>
  );
}
