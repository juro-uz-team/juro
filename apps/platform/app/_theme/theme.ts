export type ThemeMode = "light" | "dark";

// The server inserts this blocking bootstrap before page content. Cookie wins over
// localStorage so all JURO hosts agree, while a missing or retired `system`
// preference becomes explicit light before application content can paint.
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var c=document.cookie.match(/(?:^|; )juro_theme=(system|light|dark)(?:;|$)/);var l=localStorage.getItem("juro-theme");var r=c?c[1]:(l==="light"||l==="dark"||l==="system"?l:"light");var m=r==="dark"?"dark":"light";document.documentElement.dataset.theme=m;document.documentElement.dataset.themeMode=m;document.documentElement.style.colorScheme=m;}catch(e){document.documentElement.dataset.theme="light";document.documentElement.dataset.themeMode="light";document.documentElement.style.colorScheme="light";}})();`;

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark";
}
