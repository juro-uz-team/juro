import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rootLayout = fs.readFileSync("app/layout.tsx", "utf8");
const themeSwitcher = fs.readFileSync("app/components/public/ThemeSwitcher.tsx", "utf8");
const platformHrefs = fs.readFileSync("app/components/public/platform-hrefs.ts", "utf8");
const globalStyles = fs.readFileSync("app/globals.css", "utf8");
const rootPage = fs.readFileSync("app/page.tsx", "utf8");
const localizedPage = fs.readFileSync("app/[locale]/page.tsx", "utf8");
const adapter = fs.readFileSync("app/components/cinematic/CinematicLandingPage.tsx", "utf8");
const homepage = fs.readFileSync("app/components/public/JuroHomepage.tsx", "utf8");
const homepageStyles = fs.readFileSync("app/components/public/juro-home.module.css", "utf8");
const motionDirector = fs.readFileSync("app/components/public/JuroMotionDirector.tsx", "utf8");
const motionStyles = fs.readFileSync("app/components/public/juro-motion.module.css", "utf8");
const editorialStyles = fs.readFileSync("app/components/public/juro-editorial.module.css", "utf8");
const decisionStyles = fs.readFileSync("app/components/public/juro-decision.module.css", "utf8");
const scenarioStyles = fs.readFileSync("app/components/public/scenario-process.module.css", "utf8");
const laptopStyles = fs.readFileSync("app/components/public/juro-laptop.module.css", "utf8");
const chrome = fs.readFileSync("app/components/public/SiteChrome.tsx", "utf8");
const chromeStyles = fs.readFileSync("app/components/public/site-chrome.module.css", "utf8");
const footerRailStyles = fs.readFileSync("app/components/public/footer-rail.module.css", "utf8");
const headerTouchStyles = fs.readFileSync("app/components/public/header-touch-targets.module.css", "utf8");
const sitemap = fs.readFileSync("app/sitemap.ts", "utf8");
const lawyerCatalog = fs.readFileSync("app/[locale]/lawyers/catalog.ts", "utf8");
const lawyerAvatar = fs.readFileSync("app/[locale]/lawyers/LawyerAvatar.tsx", "utf8");

test("selected JURO direction is the only public homepage implementation", () => {
  assert.match(rootPage, /CinematicLandingPage language="ru"/);
  assert.match(localizedPage, /CinematicLandingPage language=\{locale\}/);
  assert.match(adapter, /JuroHomepage/);
  assert.doesNotMatch(rootPage + localizedPage + adapter, /PrototypeHarness|prototypeRoot|router\.push/);
  assert.equal(fs.existsSync("app/prototypes/homepage/page.tsx"), false);
});

test("homepage explains the legal journey through concrete product states", () => {
  for (const marker of [
    "activeScenario.facts",
    "activeScenario.source",
    "activeScenario.risk",
    "activeScenario.action",
    "activeClause",
    "continuity",
    "handoff",
    "audiences",
  ]) assert.match(homepage, new RegExp(marker));
  assert.match(homepage, /document-analysis/);
  assert.match(homepage, /\/lawyers/);
  assert.match(homepage, /\/video/);
  assert.match(homepage, /\/trust/);
  assert.doesNotMatch(homepage, /<textarea|type="file"/);
});

test("production interactions have complete keyboard and reduced-motion contracts", () => {
  assert.match(homepage, /onKeyDown=\{\(event\) => moveTab/);
  assert.match(homepage, /role="tabpanel"/);
  assert.match(homepage, /tabIndex=\{scenario === index \? 0 : -1\}/);
  assert.match(chrome, /aria-modal="true"/);
  assert.match(chrome, /event\.key === "Escape"/);
  assert.match(chrome, /trigger\?\.focus\(\)/);
  assert.match(homepageStyles, /prefers-reduced-motion:\s*reduce/);
  assert.match(motionStyles, /prefers-reduced-motion:\s*reduce/);
  assert.match(motionDirector, /IntersectionObserver/);
  assert.match(motionDirector, /requestAnimationFrame/);
  assert.match(chromeStyles, /prefers-reduced-motion:\s*reduce/);
  assert.doesNotMatch(homepageStyles + motionStyles + editorialStyles + decisionStyles + laptopStyles + chromeStyles, /transition:\s*all/);
  assert.doesNotMatch(homepageStyles + motionStyles + editorialStyles + decisionStyles + laptopStyles + chromeStyles, /ease-in(?:\s|;|,|\))/);
});

test("public chrome exposes every primary public destination in both locales", () => {
  for (const route of ["/trust", "/video", "/lawyers", "/legal", "/knowledge"]) {
    assert.match(chrome, new RegExp(route.replaceAll("/", "\\/")));
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
  assert.match(headerTouchStyles, /aria-current="page"/);
});

test("Jurobek uses reference-based 2D assets and motion-safe lifecycle", () => {
  const avatar = fs.readFileSync("app/components/public/JurobekAvatar.tsx", "utf8");
  const player = fs.readFileSync("public/characters/jurobek/jurobek.mjs", "utf8");
  assert.match(homepage, /JurobekAvatar language/);
  assert.match(avatar, /characters\/jurobek\/reference\.webp/);
  assert.match(player, /IntersectionObserver/);
  assert.match(player, /prefers-reduced-motion/);
  assert.match(player, /document\.hidden/);
  assert.match(player, /cancelAnimationFrame/);
  assert.match(player, /removeEventListener/);
  assert.doesNotMatch(avatar, /jurobek-renderer/);
  for (const asset of ['reference','idle','wave','blink','smile']) assert.ok(fs.existsSync('public/characters/jurobek/' + asset + '.webp'));
});

test("homepage chapters provide orientation without hiding SSR content", () => {
  assert.match(homepage, /data-chapter-link/);
  assert.match(homepage, /id="analysis"/);
  assert.match(homepage, /id="case-flow"/);
  assert.match(homepage, /id="lawyer-handoff"/);
  assert.doesNotMatch(homepage, /data-motion-ready="true"/);
  assert.match(motionDirector, /aria-current/);
  assert.match(motionDirector, /revealObserver\.unobserve/);
});

test("trust and resource gateways use an editorial hierarchy", () => {
  assert.match(homepage, /editorialStyles\.trustGrid/);
  assert.match(homepage, /editorialStyles\.resourceGrid/);
  assert.match(homepage, /data-primary=\{index === 0/);
  assert.match(homepage, /Смотреть обзор/);
  assert.match(homepage, /Sharhni ko‘rish/);
  assert.match(editorialStyles, /prefers-reduced-motion:\s*reduce/);
});

test("start pathways retain direct-linking and responsive decision states", () => {
  assert.match(homepage, /hashchange/);
  assert.match(homepage, /navigateToSection/);
  assert.match(homepage, /history\.pushState/);
  assert.match(homepage, /popstate/);
  assert.match(homepage, /window\.scrollTo/);
  assert.match(homepage, /decodeURIComponent/);
  assert.match(homepage, /decisionStyles\.accessPlans/);
  assert.match(homepage, /data-featured=\{index === 1/);
  assert.match(decisionStyles, /prefers-reduced-motion:\s*reduce/);
  assert.match(decisionStyles, /@media \(max-width: 620px\)/);
});

test("laptop layouts prevent large headline and product-grid clipping", () => {
  assert.match(homepage, /laptopStyles\.heroGrid/);
  assert.match(homepage, /laptopStyles\.heroProduct/);
  assert.match(homepage, /laptopStyles\.transitionSection/);
  assert.match(laptopStyles, /@media \(max-width: (?:980|1100)px\)/);
  assert.match(laptopStyles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(laptopStyles, /min-width: 0/);
});

test("brand uses official complete JURO logo assets in both themes", () => {
  assert.match(chrome, /OfficialLogo/);
  const logo = fs.readFileSync("app/components/public/OfficialLogo.tsx", "utf8");
  for (const asset of ["juro-logo-primary.avif", "juro-logo-light.avif"]) {
    assert.ok(logo.includes(asset));
    assert.ok(fs.existsSync("public/" + asset));
  }
  assert.doesNotMatch(chrome, /brandStyles\.wordmark\}>JURO/);
});

test("hero demonstrates a short, anonymised question-to-action decision flow", () => {
  assert.match(homepage, /const \[processStep, setProcessStep\]/);
  assert.match(homepage, /\[t\.hero\.facts, t\.hero\.risk, t\.hero\.source, t\.hero\.action\]/);
  assert.match(homepage, /activeScenario\.facts[\s\S]*?activeScenario\.risk[\s\S]*?activeScenario\.source[\s\S]*?activeScenario\.action/);
  assert.match(homepage, /Обезличенный пример/);
  assert.match(scenarioStyles, /prefers-reduced-motion/);
});

test("mobile product labels retain a readable minimum visual scale", () => {
  assert.match(homepageStyles, /@media \(max-width: 720px\)[\s\S]*?font-size: \.7rem/);
  assert.match(scenarioStyles, /@media \(max-width: 720px\)[\s\S]*?font-size: \.7rem/);
});

test("footer publishes the requested contact details and reveal states stay inside the viewport", () => {
  for (const value of ["Ташкент, Узбекистан", "+998974022292", "admin@juro.uz"]) assert.match(chrome, new RegExp(value.replaceAll("+", "\\+")));
  assert.match(chrome, /mailto:admin@juro\.uz/);
  assert.match(chrome, /tel:\+998974022292/);
  assert.match(chrome, /footerRailStyles\.brandCta/);
  assert.match(footerRailStyles, /grid-template-columns: repeat\(3, max-content\)/);
  assert.match(footerRailStyles, /@media \(max-width: 620px\)/);
  assert.match(footerRailStyles, /safe-area-inset-top/);
  assert.match(motionDirector, /footerVisible/);
  assert.doesNotMatch(motionStyles, /translate3d\(-48px|translate3d\(48px, 0, 0\)/);
});

test("English marketplace presentation localizes published taxonomy and tolerates missing external photos", () => {
  assert.match(lawyerCatalog, /Banking and finance law/);
  assert.match(lawyerCatalog, /Tashkent State University of Law/);
  assert.match(lawyerCatalog, /Unknown future values intentionally fall back/);
  assert.match(lawyerAvatar, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(lawyerAvatar, /if \(!src \|\| failed\)/);
});

test("initial scroll geometry waits until paint and public chrome avoids synchronous scroll reads", () => {
  assert.match(
    motionDirector,
    /scrollFrame = requestAnimationFrame\(\(\) => \{[\s\S]*?scrollFrame = requestAnimationFrame\(\(\) => \{[\s\S]*?refreshGeometry\(\);[\s\S]*?updateScrollStory\(\);/,
  );
  assert.doesNotMatch(
    motionDirector,
    /\n\s*refreshGeometry\(\);\s*\n\s*root\.dataset\.motionReady = "true";/,
  );
  assert.match(chrome, /new IntersectionObserver\([\s\S]*?rootMargin: "18px 0px 0px"/);
  assert.match(chrome, /observer\.observe\(sentinel\)/);
  assert.doesNotMatch(chrome, /window\.scrollY/);
  assert.match(chrome, /style=\{\{[^}]*position: "absolute"[^}]*top: 0/);
});

test("mobile chrome keeps both sign-in and registration available", () => {
  assert.match(chrome, /platformAuthHref\(locale, "login"\)/u);
  assert.match(chrome, /platformRegistrationHref\(locale\)/u);
  assert.match(platformHrefs, /\$\{PLATFORM_ORIGIN\}\/\$\{locale\}\/auth\/\$\{mode\}/u);
  assert.match(platformHrefs, /\$\{PLATFORM_ORIGIN\}\/\$\{locale\}\/individual\$\{normalizedPath\}/u);
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
