"use client";

import Link from "next/link";
import Image from "next/image";
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
  const paths = builderNavigationPaths(usePathname());
  const copy = <T,>(ru: T, uz: T, en: T) => builderText(locale ?? paths.locale, { ru, uz, en });
  const embedded = variant === "embedded";
  return <header className={`dbt-header${embedded ? " dbt-header-embedded" : ""}`}>
    {embedded ? <div className="dbt-embedded-title"><FilePenLine aria-hidden="true"/><span><small>JURO</small><strong>{copy("Документы", "Hujjatlar", "Documents")}</strong></span></div> : <Link className="dbt-brand" href={paths.builder} aria-label={copy("JURO — Создать документ", "JURO — Hujjat yaratish", "JURO — Create a document")}>
      <Image src="/brand/JURO_avatar_1080.png" alt="" width={38} height={38} aria-hidden="true" unoptimized/>
      <b>JURO</b>
      {!compact && <span>{copy("Конструктор документов", "Hujjat konstruktori", "Document builder")}</span>}
    </Link>}
    {!embedded && <nav aria-label={copy("Навигация конструктора документов", "Hujjat konstruktori navigatsiyasi", "Document builder navigation")}>
      <Link href={paths.library}><BookOpenText size={17}/>{copy("Библиотека", "Kutubxona", "Library")}</Link>
      <Link href={paths.builder}><Plus size={17}/>{copy("Создать", "Yaratish", "Create")}</Link>
      {user && <><Link href={paths.documents}><Files size={17}/>{copy("Мои документы", "Mening hujjatlarim", "My documents")}</Link><Link href={paths.contacts}><BookUser size={17}/>{copy("Контакты", "Kontaktlar", "Contacts")}</Link><Link href={paths.notifications} aria-label={copy("Уведомления", "Bildirishnomalar", "Notifications")}><Bell size={17}/><span className="dbt-nav-wide">{copy("Уведомления", "Bildirishnomalar", "Notifications")}</span></Link></>}
    </nav>}
    {!embedded && <div className="dbt-user">
      {user ? <><UserRound size={18}/><span><strong>{user.fullName || user.email}</strong><small>{user.email}</small></span></> : <a className="dbt-sign-in" href={signInPath}><LogIn size={17}/>{copy("Войти", "Kirish", "Sign in")}</a>}
    </div>}
  </header>;
}
