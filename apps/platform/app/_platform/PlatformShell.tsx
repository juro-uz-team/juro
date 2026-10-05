"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- the persisted sidebar preference is restored after hydration */

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  Bell,
  Bot,
  BriefcaseBusiness,
  CalendarCheck2,
  CalendarDays,
  ChevronDown,
  Ellipsis,
  FileCheck2,
  FilePenLine,
  Files,
  HelpCircle,
  History,
  Home,
  Languages,
  Menu,
  PanelLeftClose,
  MessageSquareText,
  PanelLeftOpen,
  Layers3,
  ReceiptText,
  CreditCard,
  Scale,
  ShieldCheck,
  Settings,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  AUTHENTICATED_PLATFORM_UI_LOCALES,
  platformBasePath,
  type AccountType,
  type PlatformLocale,
} from "../../lib/platform/routing";
import type { WorkspaceOption } from "../../lib/platform/workspace";
import { GlobalSearch } from "./GlobalSearch";
import { LogoutButton } from "./LogoutButton";
import { PlatformRouteProvider } from "./PlatformRouteContext";
import { useSessionRefresh } from "./useSessionRefresh";
import { ThemeSwitcher } from "../_theme/ThemeSwitcher";
import { WorkspaceTools } from "./WorkspaceTools";
import { platformApiError, platformLocaleValue } from "../../content/platform-ui";

// CSS optimization can serialize milliseconds as seconds; WAAPI always uses milliseconds.
function motionDuration(style: CSSStyleDeclaration, property: string, fallback: number): number {
  const value = style.getPropertyValue(property).trim();
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount) || amount < 0) return fallback;
  if (value.endsWith("ms")) return amount;
  if (value.endsWith("s")) return amount * 1000;
  return fallback;
}

type Props = {
  locale: PlatformLocale;
  accountType: AccountType;
  userName: string;
  activeWorkspaceId: string;
  workspaces: WorkspaceOption[];
  children: React.ReactNode;
};

const primaryNav = [
  ["dashboard", Home, "Главная", "Bosh sahifa", "Home"],
  ["ai-chat", Bot, "Спросить Juro", "Juro’dan so‘rash", "Ask Juro"],
  ["cases", BriefcaseBusiness, "Мои дела", "Mening ishlarim", "My matters"],
  ["documents", Files, "Мои документы", "Mening hujjatlarim", "My documents"],
] as const;

const lawyerPrimaryNav = [
  ["dashboard", Home, "Главная", "Bosh sahifa", "Home"],
  ["ai-chat", Bot, "Спросить Juro", "Juro’dan so‘rash", "Ask Juro"],
  ["consultations?view=requests", Bell, "Заявки", "So‘rovlar", "Requests"],
  [
    "consultations?view=schedule",
    CalendarCheck2,
    "Консультации",
    "Maslahatlar",
    "Consultations",
  ],
  ["consultations?view=matters", BriefcaseBusiness, "Дела", "Ishlar", "Matters"],
] as const;

const lawyerClientNav = [
  ["consultations?view=clients", UsersRound, "Клиенты", "Mijozlar", "Clients"],
  ["consultations?view=messages", MessageSquareText, "Сообщения", "Xabarlar", "Messages"],
  ["consultations?view=documents", Files, "Документы", "Hujjatlar", "Documents"],
  ["consultations?view=tasks", CalendarCheck2, "Задачи", "Vazifalar", "Tasks"],
] as const;

const lawyerPracticeNav = [
  ["calendar", CalendarDays, "Календарь", "Kalendar", "Calendar"],
  ["profile", UserRound, "Публичный профиль", "Ommaviy profil", "Public profile"],
  ["settings", Settings, "Настройки", "Sozlamalar", "Settings"],
] as const;

const documentNav = [
  ["document-builder", FilePenLine, "Создать документ", "Hujjat yaratish", "Create a document"],
  ["document-review", FileCheck2, "Проверить документ", "Hujjatni tekshirish", "Review a document"],
  ["documents", Files, "Мои документы", "Mening hujjatlarim", "My documents"],
  [
    "document-review?mode=compare",
    Files,
    "Сравнить версии",
    "Versiyalarni solishtirish",
    "Compare versions",
  ],
] as const;

const caseworkNav = [
  ["action-plan", CalendarCheck2, "Планы действий", "Harakatlar rejalari", "Action plans"],
  ["calendar", CalendarDays, "Календарь", "Kalendar", "Calendar"],
  ["archive", Archive, "Архив", "Arxiv", "Archive"],
  ["history", History, "История", "Tarix", "History"],
] as const;

const helpNav = [
  ["consultations", ReceiptText, "Консультации", "Maslahatlar", "Consultations"],
  ["lawyers", UsersRound, "Юристы", "Yuristlar", "Lawyers"],
  [
    "monitoring",
    Scale,
    "Мониторинг законодательства",
    "Qonunchilik monitoringi",
    "Legal monitoring",
  ],
] as const;

const managementNav = [
  ["team", UsersRound, "Команда", "Jamoa", "Team"],
  ["notifications", Bell, "Уведомления", "Bildirishnomalar", "Notifications"],
  ["billing", CreditCard, "Тариф", "Tarif", "Plan"],
] as const;

export function PlatformShell({
  locale,
  accountType,
  userName,
  activeWorkspaceId,
  workspaces,
  children,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const sidebarSurfaceRef = useRef<HTMLDivElement>(null);
  const sidebarAnimations = useRef<Animation[]>([]);
  useEffect(() => () => sidebarAnimations.current.forEach(animation => animation.cancel()), []);
  const [moreOpen, setMoreOpen] = useState(false);
  const [switchingWorkspace, setSwitchingWorkspace] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const sidebarRef = useRef<HTMLElement>(null);
  const profileMenuRef = useRef<HTMLDetailsElement>(null);
  const openButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useSessionRefresh(locale);
  const base = platformBasePath(locale, accountType, activeWorkspaceId);
  const business = accountType === "business";
  const lawyer = accountType === "lawyer";
  const text = (value: { ru: string; uz: string; en: string }) =>
    platformLocaleValue(locale, value);
  const primaryItems = lawyer ? lawyerPrimaryNav : primaryNav;
  const mobileItems = primaryItems.filter(([slug]) => !lawyer || slug !== "consultations?view=schedule");
  const toolGroups = lawyer
    ? ([
        {
          key: "clients",
          ru: "Клиенты и работа",
          uz: "Mijozlar va ish",
          en: "Clients and work",
          items: lawyerClientNav,
        },
        {
          key: "practice",
          ru: "Практика",
          uz: "Amaliyot",
          en: "Practice",
          items: lawyerPracticeNav,
        },
      ] as const)
    : ([
        {
          key: "documents",
          ru: "Документы",
          uz: "Hujjatlar",
          en: "Documents",
          items: documentNav,
        },
        { key: "casework", ru: "Дела", uz: "Ishlar", en: "Matters", items: caseworkNav },
        { key: "help", ru: "Помощь", uz: "Yordam", en: "Support", items: helpNav },
        {
          key: "management",
          ru: "Управление",
          uz: "Boshqaruv",
          en: "Management",
          items: managementNav.filter(([slug]) => slug !== "team" || business),
        },
      ] as const);
  const routeIsActive = (slug: string) => {
    const [route, query] = slug.split("?");
    const href = `${base}/${route}`;
    const matchesRoute = pathname === href || pathname.startsWith(`${href}/`);
    if (!matchesRoute) return false;
    if (!query) return route !== "document-review" || searchParams.get("mode") !== "compare";
    const expectedParams = new URLSearchParams(query);
    return Array.from(expectedParams.entries()).every(
      ([key, value]) => searchParams.get(key) === value,
    );
  };
  const documentRouteIsActive = (slug: string) => {
    if (slug !== "documents") return routeIsActive(slug);
    const href = `${base}/${slug}`;
    return (
      pathname === href ||
      (pathname.startsWith(`${href}/`) &&
        !pathname.startsWith(`${href}/comparisons`))
    );
  };
  const moreHasActiveRoute = !primaryItems.some(([slug]) => routeIsActive(slug)) && toolGroups.some((group) =>
    group.items.some(([slug]) => documentRouteIsActive(slug)),
  );
  useEffect(() => {
    setCollapsed(localStorage.getItem("juro-sidebar-collapsed") === "1");
  }, []);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const menu = profileMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      const menu = profileMenuRef.current;
      if (event.key === "Escape" && menu?.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, []);

  useEffect(() => {
    if (profileMenuRef.current) profileMenuRef.current.open = false;
  }, [pathname]);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 900px)");
    const sync = () => setMobile(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    if (!open || !mobile) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        openButtonRef.current?.focus();
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          sidebarRef.current?.querySelectorAll<HTMLElement>(
            "a[href],button:not(:disabled),select:not(:disabled),[tabindex]:not([tabindex='-1'])",
          ) ?? [],
        );
        const visible = focusable.filter(element => element.getClientRects().length > 0);
        const first = visible[0];
        const last = visible.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, mobile]);
  const switchLanguage = (nextLocale: PlatformLocale) => {
    if (nextLocale === locale) return;
    document.documentElement.lang = nextLocale;
    document.cookie = `juro_locale=${nextLocale}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    // Preserve the concrete object state (conversation, branch, comparison,
    // selected case) instead of sending a user back to an empty screen after
    // changing language. Route-level authorization still validates every ID.
    const nextPath = pathname.replace(`/${locale}/`, `/${nextLocale}/`);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("prompt");
    const query = nextParams.toString();
    router.push(`${nextPath}${query ? `?${query}` : ""}${window.location.hash}`);
  };
  const toggleCollapsed = () => {
    const next = !collapsed;
    const main = mainRef.current;
    const surface = sidebarSurfaceRef.current;
    const previousLeft = main?.getBoundingClientRect().left ?? 0;
    const previousWidth = surface?.getBoundingClientRect().width ?? 0;
    sidebarAnimations.current.forEach(animation => animation.cancel());
    sidebarAnimations.current = [];
    flushSync(() => setCollapsed(next));
    if (main && surface && !mobile && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const motion = getComputedStyle(main);
      const duration = motionDuration(motion, "--motion-drawer", 220);
      const easing = motion.getPropertyValue("--ease-out").trim() || "cubic-bezier(.16,1,.3,1)";
      const delta = previousLeft - main.getBoundingClientRect().left;
      const width = surface.getBoundingClientRect().width;
      sidebarAnimations.current = [
        main.animate([{ transform: `translateX(${delta}px)` }, { transform: "translateX(0)" }], { duration, easing }),
        surface.animate([{ transform: `scaleX(${width ? previousWidth / width : 1})` }, { transform: "scaleX(1)" }], { duration, easing }),
      ];
      if (!next && sidebarRef.current) {
        for (const element of sidebarRef.current.querySelectorAll<HTMLElement>("nav a span, .platform-account div, .platform-tools-trigger > span")) {
          sidebarAnimations.current.push(element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: motionDuration(motion, "--motion-surface", 180), easing }));
        }
      }
    }
    localStorage.setItem("juro-sidebar-collapsed", next ? "1" : "0");
  };
  const closeMobileMenu = () => {
    setOpen(false);
    window.requestAnimationFrame(() => openButtonRef.current?.focus());
  };
  const switchWorkspace = async (workspaceId: string) => {
    if (!workspaceId || workspaceId === activeWorkspaceId || switchingWorkspace)
      return;
    setSwitchingWorkspace(true);
    setWorkspaceError("");
    try {
      const response = await fetch("/api/platform/workspaces", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ workspaceId, locale }),
      });
      const body = (await response.json()) as {
        redirectTo?: string;
        error?: string;
      };
      if (!response.ok || !body.redirectTo) {
        throw new Error(platformApiError(locale, body.error, text({
          ru: "Не удалось переключить пространство.",
          uz: "Makonni almashtirib bo‘lmadi.",
          en: "We could not switch workspaces.",
        })));
      }
      window.location.assign(body.redirectTo);
    } catch (value) {
      setWorkspaceError(value instanceof Error ? value.message : String(value));
      setSwitchingWorkspace(false);
    }
  };
  return (
    <PlatformRouteProvider basePath={base} workspaceId={activeWorkspaceId}>
      <div className={`platform-shell ${collapsed ? "is-collapsed" : ""}`}>
        <a className="platform-skip-link" href="#main-content">
          {text({ ru: "Перейти к содержанию", uz: "Asosiy mazmunga o‘tish", en: "Skip to main content" })}
        </a>
        <aside
          ref={sidebarRef}
          id="platform-navigation"
          className={`platform-sidebar ${open ? "open" : ""}`}
          aria-label={
            text({ ru: "Основная навигация", uz: "Asosiy navigatsiya", en: "Main navigation" })
          }
          aria-hidden={mobile && !open ? true : undefined}
          inert={mobile && !open ? true : undefined}
        >
          <div ref={sidebarSurfaceRef} className="platform-sidebar-surface" aria-hidden="true" />
          <div className="platform-brand">
            <Link href={`${base}/dashboard`} aria-label="JURO">
              <Image
                className="platform-logo-avatar"
                src="/brand/JURO_avatar_1080.png"
                alt=""
                width={1080}
                height={1080}
                priority
                unoptimized
              />
              <span className="platform-brand-wordmark" aria-hidden="true">JURO</span>
            </Link>
            <button
              type="button"
              className="platform-mobile-close"
              ref={closeButtonRef}
              onClick={closeMobileMenu}
              aria-label={text({ ru: "Закрыть меню", uz: "Menyuni yopish", en: "Close menu" })}
            >
              <X />
            </button>
          </div>
          <div
            className={`platform-account ${switchingWorkspace ? "switching" : ""}`}
          >
            <span>{business ? <BriefcaseBusiness /> : <Layers3 />}</span>
            <div>
              <small>{text({ ru: "Пространство", uz: "Makon", en: "Workspace" })}</small>
              {!lawyer && workspaces.length > 1 ? (
                <Select
                  value={activeWorkspaceId}
                  disabled={switchingWorkspace}
                  onChange={(event) => void switchWorkspace(event.target.value)}
                  aria-label={
                    text({
                      ru: "Выбрать личное или бизнес-пространство",
                      uz: "Shaxsiy yoki biznes makonini tanlash",
                      en: "Choose a personal or business workspace",
                    })
                  }
                >
                  {workspaces.map((workspace) => (
                    <option value={workspace.id} key={workspace.id}>
                      {workspace.type === "business"
                        ? text({ ru: "Бизнес", uz: "Biznes", en: "Business" })
                        : text({ ru: "Личное", uz: "Shaxsiy", en: "Personal" })}{" "}
                      · {workspace.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <b>
                  {lawyer
                    ? text({ ru: "Кабинет юриста", uz: "Yurist kabineti", en: "Lawyer workspace" })
                    : business
                      ? text({ ru: "Бизнес", uz: "Biznes", en: "Business" })
                      : text({ ru: "Личное", uz: "Shaxsiy", en: "Personal" })}
                </b>
              )}
            </div>
          </div>
          {workspaceError && (
            <p className="platform-workspace-error" role="alert">
              {workspaceError}
            </p>
          )}
          <nav>
            <div className="platform-nav-group">
              {primaryItems.map(([slug, Icon, ru, uz, en]) => {
                const href = `${base}/${slug}`;
                const active = routeIsActive(slug);
                const label = platformLocaleValue(locale, { ru, uz, en });
                return (
                  <Link
                    key={slug}
                    className={active ? "active" : ""}
                    aria-current={active ? "page" : undefined}
                    href={href}
                    onClick={() => setOpen(false)}
                    title={collapsed ? label : undefined}
                  >
                    <Icon />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
            <button type="button" className={`platform-tools-trigger ${moreHasActiveRoute ? "active" : ""}`}
              onClick={() => { setOpen(false); setMoreOpen(true); }} aria-haspopup="dialog"
              title={text({ ru: "Все инструменты", uz: "Barcha vositalar", en: "All tools" })}>
              <Ellipsis /><span>{text({ ru: "Все инструменты", uz: "Barcha vositalar", en: "All tools" })}</span>
            </button>
          </nav>
          <details ref={profileMenuRef} className="platform-profile-menu">
            <summary title={userName || text({ ru: "Аккаунт", uz: "Hisob", en: "Account" })}>
              <Settings /><span>{userName.trim() && <strong>{userName}</strong>}<small>{text({ ru: "Аккаунт и настройки", uz: "Hisob va sozlamalar", en: "Account & settings" })}</small></span><ChevronDown />
            </summary>
            <div className="platform-sidebar-bottom">
              <Link href={`${base}/profile`} onClick={() => setOpen(false)}><UserRound /><span>{text({ ru: "Профиль", uz: "Profil", en: "Profile" })}</span></Link>
              <Link href={`${base}/settings`} onClick={() => setOpen(false)}><Settings /><span>{text({ ru: "Настройки", uz: "Sozlamalar", en: "Settings" })}</span></Link>
              <Link href={`${base}/security`} onClick={() => setOpen(false)}><ShieldCheck /><span>{text({ ru: "Безопасность", uz: "Xavfsizlik", en: "Security" })}</span></Link>
              <Link href={`${base}/help`} onClick={() => setOpen(false)}><HelpCircle /><span>{text({ ru: "Помощь", uz: "Yordam", en: "Help" })}</span></Link>
              <LogoutButton className="platform-sidebar-logout" locale={locale} label={text({ ru: "Выйти", uz: "Chiqish", en: "Sign out" })} />
            </div>
          </details>
          <button
            className="platform-collapse"
            onClick={toggleCollapsed}
            aria-label={
              collapsed
                ? text({ ru: "Развернуть меню", uz: "Menyuni kengaytirish", en: "Expand menu" })
                : text({ ru: "Свернуть меню", uz: "Menyuni yig‘ish", en: "Collapse menu" })
            }
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            <span>{text({ ru: "Свернуть", uz: "Yig‘ish", en: "Collapse" })}</span>
          </button>
        </aside>
        {mobile && (
          <button
            type="button"
            className={`platform-backdrop ${open ? "is-open" : ""}`}
            aria-hidden={!open}
            tabIndex={-1}
            disabled={!open}
            aria-label={text({ ru: "Закрыть меню", uz: "Menyuni yopish", en: "Close menu" })}
            onClick={closeMobileMenu}
          />
        )}
        {moreOpen && <WorkspaceTools locale={locale} base={base} groups={toolGroups} isActive={documentRouteIsActive} onClose={() => {
          setMoreOpen(false);
          if (mobile) window.requestAnimationFrame(() => openButtonRef.current?.focus());
        }} />}
        <div className="platform-main" ref={mainRef}>
          <header className="platform-topbar">
            <div>
              <small>
                {lawyer
                  ? text({ ru: "JURO · практика юриста", uz: "JURO · yurist amaliyoti", en: "JURO · legal practice" })
                  : text({ ru: "JURO · защищённое пространство", uz: "JURO · himoyalangan makon", en: "JURO · secure workspace" })}
              </small>
              {userName ? <strong>{userName}</strong> : null}
            </div>
            <div>
              <GlobalSearch locale={locale} accountType={accountType} />
              <ThemeSwitcher locale={locale} compact />
              <Select
                className="platform-language-switcher"
                value={locale}
                aria-label={text({ ru: "Язык интерфейса", uz: "Interfeys tili", en: "Interface language" })}
                displayValue={<span className="platform-language-value"><Languages aria-hidden="true" />{locale.toUpperCase()}</span>}
                onChange={event => {
                  const selected = AUTHENTICATED_PLATFORM_UI_LOCALES.find(value => value === event.target.value);
                  if (selected) switchLanguage(selected);
                }}
              >
                <option value="ru">RU</option>
                <option value="uz">UZ</option>
                <option value="en">EN</option>
              </Select>
              <Link
                href={`${base}/profile`}
                aria-label={text({ ru: "Профиль", uz: "Profil", en: "Profile" })}
              >
                <UserRound />
              </Link>

            </div>
          </header>
          <main className="platform-content" id="main-content" tabIndex={-1}>
            {children}
          </main>
          <nav
            className="platform-mobile-nav"
            aria-label={
              text({ ru: "Мобильная навигация", uz: "Mobil navigatsiya", en: "Mobile navigation" })
            }
          >
            {mobileItems.map(([slug, Icon, ru, uz, en]) => {
              const label = platformLocaleValue(locale, { ru, uz, en });
              const href = `${base}/${slug as string}`;
              const active = routeIsActive(slug as string);
              const NavIcon = Icon as typeof Home;
              return (
                <Link
                  href={href}
                  key={slug as string}
                  className={active ? "active" : ""}
                  aria-current={active ? "page" : undefined}
                >
                  <NavIcon />
                  <span>{label as string}</span>
                </Link>
              );
            })}
            <button
              ref={openButtonRef}
              type="button"
              onClick={() => setOpen(true)}
              aria-label={text({ ru: "Открыть меню", uz: "Menyuni ochish", en: "Open menu" })}
              aria-expanded={open}
              aria-controls="platform-navigation"
            >
              <Menu />
              <span>{text({ ru: "Ещё", uz: "Yana", en: "More" })}</span>
            </button>
          </nav>
        </div>
      </div>
    </PlatformRouteProvider>
  );
}
