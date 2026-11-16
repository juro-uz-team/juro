"use client";

import { BrandImage } from "../../_components/BrandImage";
import { useEffect, useRef } from "react";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, BookOpenText, BookUser, FilePenLine, Files, LogIn, Plus, UserRound } from "lucide-react";
import { builderNavigationPaths } from "../../../lib/platform/builder-paths";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderText } from "../builder-localization";

export interface BuilderUser {
  displayName: string;
  email: string;
  fullName: string | null;
}

export function BuilderHeader({ user, signInPath, compact = false, variant = "standalone", locale }: { user: BuilderUser | null; signInPath?: string; compact?: boolean; variant?: "standalone" | "embedded"; locale?: PlatformLocale }) {
  const pathname = usePathname();
  const paths = builderNavigationPaths(pathname);
  const headerRef = useRef<HTMLElement>(null);
  const copy = <T,>(ru: T, uz: T, en: T) => builderText(locale ?? paths.locale, { ru, uz, en });
  const embedded = variant === "embedded";
  const inPlatform = paths.locale !== null;
  useEffect(() => {
    const header = headerRef.current;
    if (!header || !inPlatform) return;
    const root = document.documentElement;
    const update = () => root.style.setProperty("--platform-tool-header-height", `${header.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => { observer.disconnect(); root.style.removeProperty("--platform-tool-header-height"); };
  }, [inPlatform]);
  const links = [
    { href: paths.library, label: copy("Библиотека", "Kutubxona", "Library"), Icon: BookOpenText },
    ...(paths.builder !== paths.library ? [{ href: paths.builder, label: copy("Создать", "Yaratish", "Create"), Icon: Plus }] : []),
    ...(user ? [
      { href: paths.documents, label: copy("Мои документы", "Mening hujjatlarim", "My documents"), Icon: Files },
      { href: paths.contacts, label: copy("Контакты", "Kontaktlar", "Contacts"), Icon: BookUser },
      { href: paths.notifications, label: copy("Уведомления", "Bildirishnomalar", "Notifications"), Icon: Bell },
    ] : []),
  ];
  return <header ref={headerRef} className={`dbt-header${embedded ? " dbt-header-embedded" : ""}`}>
    {embedded || inPlatform ? <Link href={paths.library} className="dbt-section-title"><FilePenLine aria-hidden="true"/><strong>{copy("Документы", "Hujjatlar", "Documents")}</strong></Link> : <Link className="dbt-brand" href={paths.builder} aria-label={copy("JURO — Создать документ", "JURO — Hujjat yaratish", "JURO — Create a document")}>
      <BrandImage mark alt="" width={38} height={38} aria-hidden="true"/>
      <b>JURO</b>
      {!compact && <span>{copy("Конструктор документов", "Hujjat konstruktori", "Document builder")}</span>}
    </Link>}
    {!embedded && <nav aria-label={copy("Навигация конструктора документов", "Hujjat konstruktori navigatsiyasi", "Document builder navigation")}>
      {links.map(({ href, label, Icon }) => <Link key={href} href={href} aria-current={pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined}><Icon size={17} aria-hidden="true"/><span>{label}</span></Link>)}
    </nav>}
    {!embedded && <div className="dbt-user">
      {user ? <><UserRound size={18}/><span><strong>{user.fullName || user.email}</strong><small>{user.email}</small></span></> : <a className="dbt-sign-in" href={signInPath}><LogIn size={17}/>{copy("Войти", "Kirish", "Sign in")}</a>}
    </div>}
  </header>;
}
