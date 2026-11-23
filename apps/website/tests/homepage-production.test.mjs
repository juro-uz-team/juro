import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rootLayout = fs.readFileSync("app/layout.tsx", "utf8");
const themeSwitcher = fs.readFileSync("app/components/public/ThemeSwitcher.tsx", "utf8");
const platformHrefs = fs.readFileSync("app/components/public/platform-hrefs.ts", "utf8");
const globalStyles = fs.readFileSync("app/globals.css", "utf8");
const chrome = fs.readFileSync("app/components/public/SiteChrome.tsx", "utf8");
const footer = fs.readFileSync("app/components/public/SiteFooter.tsx", "utf8");
const homepage = fs.readFileSync("content/homepage.ts", "utf8");
const chromeStyles = fs.readFileSync("app/components/public/site-chrome.module.css", "utf8");
const headerTouchStyles = fs.readFileSync("app/components/public/header-touch-targets.module.css", "utf8");
const sitemap = fs.readFileSync("app/sitemap.ts", "utf8");
const lawyerCatalog = fs.readFileSync("app/[locale]/lawyers/catalog.ts", "utf8");
const lawyerAvatar = fs.readFileSync("app/[locale]/lawyers/LawyerAvatar.tsx", "utf8");

test("public chrome exposes every primary public destination in both locales", () => {
  for (const route of ["/trust", "/video", "/lawyers", "/legal", "/knowledge"]) {
    assert.match(chrome + footer, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(chrome, /languageHref/);
  assert.match(chrome, /platformRegistrationHref/);
  assert.match(sitemap, /\/lawyers/);
  assert.doesNotMatch(sitemap, /prototype/);
});

test("mobile chrome keeps fixed controls clear of iOS safe areas", () => {
  assert.match(chromeStyles, /safe-area-inset-top/);
  assert.match(chromeStyles, /safe-area-inset-bottom/);
  assert.match(chromeStyles, /safe-area-inset-left/);
  assert.match(chromeStyles, /safe-area-inset-right/);
  assert.match(chrome, /headerTouchStyles\.language/);
  assert.match(headerTouchStyles, /min-height: 44px/);
  assert.match(chromeStyles, /\.languageOptions a\[aria-current="page"\]/);
  assert.match(chrome, /aria-modal="true"/);
  assert.match(chrome, /event\.key === "Escape"/);
  assert.match(chrome, /trigger\?\.focus\(\)/);
});

test("Jurobek uses reference-based 2D assets and motion-safe lifecycle", () => {
  const player = fs.readFileSync("public/characters/jurobek/jurobek.mjs", "utf8");
  assert.match(player, /IntersectionObserver/);
  assert.match(player, /prefers-reduced-motion/);
  assert.match(player, /document\.hidden/);
  assert.match(player, /cancelAnimationFrame/);
  assert.match(player, /removeEventListener/);
  for (const asset of ['reference','idle','wave','blink','smile']) assert.ok(fs.existsSync('public/characters/jurobek/' + asset + '.webp'));
});

test("brand uses official complete JURO logo assets in both themes", () => {
  assert.match(chrome, /OfficialLogo/);
  const logo = fs.readFileSync("app/components/public/OfficialLogo.tsx", "utf8");
  for (const asset of ["brand/juro-logo-on-light.png", "brand/juro-logo-on-dark.png"]) {
    assert.ok(logo.includes(asset));
    assert.ok(fs.existsSync("public/" + asset));
  }
  assert.doesNotMatch(chrome, /brandStyles\.wordmark\}>JURO/);
});

test("shared public footer publishes the contact details", () => {
  assert.match(rootLayout, /<SiteFooter initialLocale=\{locale\}/);
  assert.match(homepage, /Ташкент, Узбекистан/);
  assert.match(footer, /mailto:admin@juro\.uz/);
  assert.match(footer, /tel:\+998974022292/);
});

test("English marketplace presentation localizes published taxonomy and tolerates missing external photos", () => {
  assert.match(lawyerCatalog, /Banking and finance law/);
  assert.match(lawyerCatalog, /Tashkent State University of Law/);
  assert.match(lawyerCatalog, /Unknown future values intentionally fall back/);
  assert.match(lawyerAvatar, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(lawyerAvatar, /if \(!src \|\| failed\)/);
});

test("mobile chrome keeps both sign-in and registration available", () => {
  assert.match(chrome, /platformAuthHref\(locale, "login"\)/u);
  assert.match(chrome, /platformRegistrationHref\(locale\)/u);
  assert.match(platformHrefs, /\$\{PLATFORM_ORIGIN\}\/\$\{locale\}\/auth\/\$\{mode\}/u);
  assert.match(platformHrefs, /platformAccountHref\(locale, "individual", path\)/u);
  assert.doesNotMatch(platformHrefs, /locale === "en"/u);
  assert.doesNotMatch(chrome + platformHrefs, /locale === "en" \? "ru"/u);
});

test("public theme defaults to explicit light and persists only light or dark", () => {
  assert.match(rootLayout, /var r=c\?c\[1\]:/);
  assert.match(rootLayout, /var m=r==="dark"\?"dark":"light"/);
  assert.match(rootLayout, /dataset\.themeMode="light"/);
  assert.match(rootLayout, /colorScheme:\s*"light"/);
  assert.doesNotMatch(rootLayout, /matchMedia/);
  assert.match(rootLayout, /<body>\s*<script dangerouslySetInnerHTML=\{\{ __html: themeBootstrap \}\}/s);
  assert.match(themeSwitcher, /type ThemeMode = "light" \| "dark"/);
  assert.match(themeSwitcher, /const modes = \[\["light", Sun\], \["dark", Moon\]\]/);
  assert.match(themeSwitcher, /function select\(next: ThemeMode\) \{\s*apply\(next\);/u);
  assert.match(themeSwitcher, /try \{\s*localStorage\.setItem\("juro-theme", next\);[\s\S]*?catch \{/u);
  assert.match(themeSwitcher, /try \{[\s\S]*?document\.cookie = `[\s\S]*?catch \{/u);
  assert.match(themeSwitcher, /catch \{[\s\S]*?announceThemeMode\(\);/u);
  assert.doesNotMatch(themeSwitcher, /Laptop|prefers-color-scheme|matchMedia/);
  assert.match(globalStyles, /:root\s*\{[^}]*color-scheme:\s*light;/s);
  assert.match(globalStyles, /--brand-navy:\s*#062844/);
});
