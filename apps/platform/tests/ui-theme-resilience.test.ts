import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = (relativePath: string) =>
  readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

test("authentication entrypoints use full document navigation", () => {
  const authForm = source("app/_auth/AuthForm.tsx");

  assert.ok(authForm.includes('<a className="auth-submit" href={`/api/auth/dev-login'));
  assert.ok(authForm.includes('<a className="auth-submit" href={`/signin-with-chatgpt'));
  assert.ok(authForm.includes('<a className="auth-secondary-login" href={`/api/auth/dev-login'));
  assert.ok(authForm.includes('<a className="auth-secondary-login" href={`/signin-with-chatgpt'));
  assert.doesNotMatch(authForm, /<Link[^>]+(?:dev-login|signin-with-chatgpt)/s);
});

test("authentication surfaces inherit semantic light and dark theme tokens", () => {
  const globals = source("app/globals.css");
  const auth = source("app/_auth/auth.css");

  assert.match(globals, /html\[data-theme=dark\]/);
  assert.match(globals, /--background:var\(--surface-canvas\)/);
  assert.match(globals, /--border-default:var\(--border-subtle\)/);
  assert.match(auth, /\.auth-page\s*\{[^}]*background:[^;]*var\(--background\)/s);
  assert.match(auth, /\.auth-card\s*\{[^}]*min-width:\s*0;[^}]*background:[^;]*var\(--(?:surface-raised|white)\)/s);
  assert.match(auth, /\.auth-brand\s*\{[\s\S]*?min-width:\s*0/);
  assert.match(auth, /\.auth-card input\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%/s);
  assert.match(auth, /\[data-theme="dark"\] \.auth-card\s*\{/);
});

test("compact theme controls retain a 44px touch target", () => {
  const globals = source("app/globals.css");

  assert.match(globals, /\.theme-switcher button\s*\{[^}]*min-width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(globals, /\.theme-switcher\.is-compact button\s*\{[^}]*width:\s*44px;/s);
});

test("the global theme picker is one button switching light and dark", () => {
  const switcher = source("app/_theme/ThemeSwitcher.tsx");
  assert.match(switcher, /const next = mode === "dark" \? "light" : "dark"/);
  assert.equal((switcher.match(/<button\b/g) ?? []).length, 1);
  assert.match(switcher, /aria-label=\{label\}/);
  assert.match(switcher, /select\(next\)/);
});

test("first visit and legacy system preferences resolve to explicit light before paint", () => {
  const theme = source("app/_theme/theme.ts");
  const layout = source("app/layout.tsx");
  const switcher = source("app/_theme/ThemeSwitcher.tsx");
  const globals = source("app/globals.css");

  assert.match(theme, /export type ThemeMode = "light" \| "dark"/);
  assert.match(theme, /var r=c\?c\[1\]:/);
  assert.match(theme, /var m=r==="dark"\?"dark":"light"/);
  assert.match(theme, /dataset\.themeMode="light"/);
  assert.doesNotMatch(theme, /matchMedia/);
  const bootstrap = source("app/_theme/DocumentBootstrap.tsx");
  assert.match(layout, /<DocumentBootstrap\s*\/>/);
  assert.match(bootstrap, /useServerInsertedHTML\(\(\) =>/);
  assert.match(bootstrap, /<script id="theme-bootstrap" dangerouslySetInnerHTML=\{\{ __html: THEME_BOOTSTRAP_SCRIPT \}\}/);
  assert.doesNotMatch(layout, /<script\b/);
  assert.match(switcher, /readThemeMode,\s*\(\) => "light"/s);
  assert.doesNotMatch(switcher, /prefers-color-scheme|matchMedia/);
  assert.match(globals, /:root\s*\{\s*color-scheme:\s*light;/s);
});

test("theme bootstrap enforces cookie precedence without consulting the operating system", () => {
  const theme = source("app/_theme/theme.ts");
  const script = theme.match(/THEME_BOOTSTRAP_SCRIPT = `([^`]+)`;/)?.[1];
  assert.ok(script);

  const apply = (cookie: string, localPreference: string | null) => {
    const document = {
      cookie,
      documentElement: {
        dataset: {} as Record<string, string>,
        style: {} as Record<string, string>,
      },
    };
    const localStorage = { getItem: () => localPreference };
    vm.runInNewContext(script, { document, localStorage });
    return document.documentElement;
  };

  assert.deepEqual(apply("", null).dataset, { theme: "light", themeMode: "light" });
  assert.deepEqual(apply("", "dark").dataset, { theme: "dark", themeMode: "dark" });
  assert.deepEqual(apply("juro_theme=light", "dark").dataset, { theme: "light", themeMode: "light" });
  assert.deepEqual(apply("juro_theme=dark", "light").dataset, { theme: "dark", themeMode: "dark" });
  assert.deepEqual(apply("juro_theme=system", "dark").dataset, { theme: "light", themeMode: "light" });
});

test("a delayed account theme response cannot override a newer user choice", () => {
  const switcher = source("app/_theme/ThemeSwitcher.tsx");

  assert.match(switcher, /function readThemeInteractionRevision\(\)/);
  assert.match(switcher, /document\.documentElement\.dataset\.themeInteractionRevision/);
  assert.match(switcher, /const startedRevision = readThemeInteractionRevision\(\)/);
  assert.match(switcher, /readThemeInteractionRevision\(\) !== startedRevision/);
  assert.match(switcher, /async function select\(next: ThemeMode\)\s*\{\s*markThemeInteraction\(\)/);
});

test("the account theme API scopes shared cookies only to JURO application hosts", () => {
  const route = source("app/api/platform/theme/route.ts");
  const preference = source("lib/platform/theme-preference.ts");

  assert.match(route, /themePreferenceCookie\(theme, requestUrl\)/);
  assert.match(preference, /sharedAuthCookieDomain\(requestUrl\.hostname\)/);
  assert.match(preference, /requestUrl\.protocol === "https:"/);
  assert.match(route, /function GET\(request: Request\)/);
  assert.doesNotMatch(route, /SameSite=Lax; Domain=\.juro\.uz; Secure/);
});

test("account theme sync accepts only explicit choices and normalizes legacy system to light", () => {
  const route = source("app/api/platform/theme/route.ts");
  const preference = source("lib/platform/theme-preference.ts");

  assert.match(route, /z\.enum\(\["light", "dark"\]\)/);
  assert.match(route, /resolveThemePreference\(row\?\.theme\)/);
  assert.match(route, /authLocaleFromRequest\(request\)/);
  assert.match(route, /Choose the light or dark theme\./);
  assert.doesNotMatch(route, /Проверьте тему \/ Mavzuni tekshiring/);
  assert.match(preference, /return value === "dark" \? "dark" : "light"/);
  assert.doesNotMatch(route, /z\.enum\(\["system"/);
});

test("calendar, case workspace, and document builder use shared dark-safe surfaces", () => {
  const globals = source("app/globals.css");
  const calendar = source("app/_platform/calendar.css");
  const cases = source("app/_platform/case-workspace.css");
  const builder = source("app/_document-builder/document-builder.css");

  assert.match(globals, /--surface-hover:\s*#3a4c5c/);
  assert.match(globals, /--surface-document:\s*#eeeae2/);
  assert.match(calendar, /\.calendar-month > span\s*\{[^}]*background:\s*var\(--(?:surface-subtle|soft)\)/s);
  assert.match(calendar, /\.status-overdue\s*\{[^}]*background:\s*var\(--red-bg\)/s);
  assert.match(cases, /\.case-workspace-summary article\s*\{[^}]*border:\s*1px solid var\(--(?:border-subtle|line)\)/s);
  assert.match(cases, /\.case-workspace-records strong\s*\{[^}]*color:\s*var\(--(?:text-primary|ink)\)/s);
  assert.match(builder, /--dbt-paper:\s*var\(--surface-raised/);
  assert.match(builder, /--dbt-document-paper:\s*var\(--surface-document/);
  assert.match(builder, /\.dbt-editor textarea\s*\{[^}]*background:\s*var\(--dbt-document-paper\)/s);
});
