"use client";

import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";
import type { PublicLanguage } from "../../../content/types";

type ThemeMode = "light" | "dark";

const labels = {
  ru: { light: "Светлая тема", dark: "Тёмная тема", group: "Тема оформления" },
  uz: { light: "Yorug‘ mavzu", dark: "Qorong‘i mavzu", group: "Ko‘rinish mavzusi" },
  en: { light: "Light theme", dark: "Dark theme", group: "Appearance" },
} as const;

const modes = [["light", Sun], ["dark", Moon]] as const;
const THEME_CHANGE_EVENT = "juro-theme-change";

function readThemeMode(): ThemeMode {
  if (typeof document === "undefined") return "light";
  const value = document.documentElement.dataset.themeMode;
  return value === "dark" ? "dark" : "light";
}

function subscribeThemeMode(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
}

function announceThemeMode() {
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

function apply(mode: ThemeMode) {
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = mode;
  document.documentElement.style.colorScheme = mode;
}

function persistThemeCookie(mode: ThemeMode) {
  try {
    const shared = location.hostname === "juro.uz" || location.hostname.endsWith(".juro.uz");
    document.cookie = `juro_theme=${mode}; Path=/; Max-Age=31536000; SameSite=Lax${shared ? "; Domain=.juro.uz; Secure" : ""}`;
  } catch {
    // A blocked cookie must not prevent the visible theme change.
  }
}

export function PublicThemeSwitcher({ locale }: { locale: PublicLanguage }) {
  const mode = useSyncExternalStore<ThemeMode | null>(subscribeThemeMode, readThemeMode, () => null);

  function select(next: ThemeMode) {
    apply(next);
    try {
      localStorage.setItem("juro-theme", next);
    } catch {
      // Storage can be unavailable in privacy-restricted contexts. The active
      // document theme remains authoritative for this visit.
    }
    persistThemeCookie(next);
    announceThemeMode();
  }

  return (
    <div className="public-theme-switcher" role="group" aria-label={labels[locale].group}>
      {modes.map(([value, Icon]) => (
        <button
          aria-label={labels[locale][value]}
          aria-pressed={mode === null ? undefined : mode === value}
          data-theme-option={value}
          title={labels[locale][value]}
          key={value}
          onClick={() => select(value)}
          type="button"
        >
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
