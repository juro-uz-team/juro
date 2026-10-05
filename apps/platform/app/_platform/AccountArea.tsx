"use client";

import Link from "next/link";
import { ChevronDown, ChevronRight, Fingerprint, Settings2, ShieldCheck, UserRound, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { PlatformLocale } from "../../lib/platform/routing";
import { accountSettingsCopy, type AccountView } from "./account-settings-copy";
import { usePlatformBasePath } from "./PlatformRouteContext";
import "./account-area.css";

const sections: { view: AccountView; path: string; icon: LucideIcon }[] = [
  { view: "profile", path: "profile", icon: UserRound },
  { view: "settings", path: "settings", icon: Settings2 },
  { view: "security", path: "settings/security", icon: ShieldCheck },
  { view: "privacy", path: "settings/privacy", icon: Fingerprint },
];

export function AccountArea({ locale, view, name, email, children }: {
  locale: PlatformLocale; view: AccountView; name?: string | null; email?: string; children: ReactNode;
}) {
  const copy = accountSettingsCopy[locale];
  const base = usePlatformBasePath();
  const initials = name?.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  return (
    <section className="profile-workspace account-area">
      <div className="account-heading"><p>{copy.account}</p><h1>{copy[view].title}</h1><span>{copy[view].description}</span></div>
      <div className="account-layout">
        <aside className="account-rail">
          <div className="account-identity"><span className="account-avatar" aria-hidden="true">{initials || <UserRound />}</span><div><strong>{name || copy.account}</strong><span title={email}>{email || copy.personal}</span></div></div>
          <nav aria-label={copy.navigation}>
            {sections.map(({ view: item, path, icon: Icon }) => (
              <Link key={item} href={`${base}/${path}`} aria-current={view === item ? "page" : undefined}>
                <Icon aria-hidden="true" /><span><strong>{copy[item].title}</strong><small>{copy[item].short}</small></span><ChevronRight className="account-nav-arrow" aria-hidden="true" />
              </Link>
            ))}
          </nav>
        </aside>
        <div className="account-content" key={view}>{children}</div>
      </div>
    </section>
  );
}

export function AccountDisclosure({ title, description, icon: Icon, danger = false, children }: {
  title: string; description: string; icon: LucideIcon; danger?: boolean; children: ReactNode;
}) {
  return <details className={`account-disclosure${danger ? " account-disclosure-danger" : ""}`}>
    <summary><Icon aria-hidden="true" /><span><strong>{title}</strong><small>{description}</small></span><ChevronDown className="account-disclosure-chevron" aria-hidden="true" /></summary>
    <div className="account-disclosure-body">{children}</div>
  </details>;
}
