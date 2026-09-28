import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const rootPage = fs.readFileSync("app/page.tsx", "utf8");
const localizedPage = fs.readFileSync("app/[locale]/page.tsx", "utf8");
const globalStyles = fs.readFileSync("app/globals.css", "utf8");
const rootLayout = fs.readFileSync("app/layout.tsx", "utf8");
const themeSwitcher = fs.readFileSync("app/components/public/ThemeSwitcher.tsx", "utf8");
const platformHrefs = fs.readFileSync("app/components/public/platform-hrefs.ts", "utf8");
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
const legalStyles = fs.readFileSync("app/[locale]/legal/legal.module.css", "utf8");
const trustStyles = fs.readFileSync("app/[locale]/trust/trust.module.css", "utf8");
const articleStyles = fs.readFileSync("app/[locale]/knowledge/[slug]/article.module.css", "utf8");
const lawyerStyles = fs.readFileSync("app/[locale]/lawyers/lawyers.module.css", "utf8");
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

test("document review opens on the first clause and changes only by direct selection", () => {
  assert.match(homepage, /const \[clause, setClause\] = useState\(0\)/);
  assert.match(homepage, /const selectClause = \(index: number\) => \{\s*setClause\(index\);\s*\}/);
  assert.doesNotMatch(homepage + motionDirector, /juro:document-step/);
});

test("public chrome exposes every primary public destination in all three locales", () => {
  for (const route of ["/trust", "/video", "/lawyers", "/legal", "/knowledge"]) {
    assert.match(chrome, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(chrome, /languageHref/);
  assert.match(chrome, /const languages: Locale\[\] = \["ru", "uz", "en"\]/);
  assert.match(chrome, /localeHref\(target\)/);
  assert.match(platformHrefs, /NEXT_PUBLIC_PLATFORM_ORIGIN/);
  assert.match(platformHrefs, /localhost:3000/);
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
  assert.match(globalStyles, /\.public-theme-switcher button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
  assert.match(globalStyles, /@media \(max-width: 420px\)[\s\S]*?\.public-theme-switcher button\[aria-pressed="true"\][\s\S]*?display:\s*none/);
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

test("every light public content family has an explicit semantic dark treatment", () => {
  assert.match(globalStyles, /html\[data-theme="dark"\]\s*\{[^}]*--surface-canvas:\s*#09141e/s);
  assert.match(globalStyles, /--status-success-surface:\s*rgba\(73, 153, 116, 0\.16\)/);
  for (const stylesheet of [
    homepageStyles,
    motionStyles,
    editorialStyles,
    scenarioStyles,
    chromeStyles,
    legalStyles,
    trustStyles,
    articleStyles,
    lawyerStyles,
  ]) {
    assert.match(stylesheet, /:global\(html\[data-theme="dark"\]\)/);
  }
  assert.match(homepageStyles, /html\[data-theme="dark"\][\s\S]*?\.documentToolbar[\s\S]*?background:\s*var\(--surface-subtle\)/);
  assert.match(legalStyles, /html\[data-theme="dark"\][\s\S]*?\.tableWrap th[\s\S]*?background:\s*var\(--surface-elevated\)/);
  assert.match(lawyerStyles, /html\[data-theme="dark"\][\s\S]*?\.filters input[\s\S]*?border-color:\s*var\(--border-strong\)/);
  assert.doesNotMatch(globalStyles + themeSwitcher, /prefers-color-scheme|matchMedia/);
});

test("Jurobek uses a lightweight, reduced-motion-safe ambient treatment", () => {
  assert.match(homepage, /jurobek-point\.webp/);
  assert.match(homepage, /unoptimized/);
  assert.match(homepage, /jurobekMotion/);
  assert.match(motionStyles, /jurobek-breathe/);
  assert.match(motionStyles, /prefers-reduced-motion:\s*reduce/);
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

test("story progress rail ends at the active row without shifting its marker", () => {
  assert.match(motionDirector, /rect\.top - railRect\.top \+ rect\.height \/ 2/);
  assert.match(motionDirector, /--story-track-start-px/);
  assert.match(motionDirector, /--story-track-height-px/);
  assert.match(motionDirector, /--story-progress-px/);
  assert.match(motionStyles, /\.storyRail::after/);
  assert.match(motionStyles, /height: var\(--story-track-height-px\)/);
  assert.match(motionStyles, /top: var\(--story-track-start-px\)/);
  assert.match(motionStyles, /height: var\(--story-progress-px\)/);
  assert.match(motionStyles, /\.storyRail[\s\S]*?align-self: start/);
  assert.match(motionStyles, /\.storyRail[\s\S]*?position: sticky[\s\S]*?top: clamp\(6rem, 12vh, 9rem\)/);
  assert.match(motionStyles, /@media \(max-width: 980px\)[\s\S]*?\.storyRail \{ position: relative; top: auto; \}/);
  assert.match(motionDirector, /const storyProgress = section \? clamp\(\(stickyOffset - \(section\.top - scrollY\)\) \/ storyRange\) : 0/);
  assert.match(motionStyles, /\.storyStep\[data-active="true"\][\s\S]*?transform: none/);
  assert.match(motionDirector, /step\.dataset\.complete = index < storyState\.active/);
  assert.match(motionStyles, /\.storyStep\[data-complete="true"\]::after/);
  assert.match(motionStyles, /\.storyStep::after[\s\S]*?height: 12px[\s\S]*?opacity: 1/);
  assert.match(motionStyles, /\.storyStep\.storyStep[\s\S]*?padding-inline: clamp\(\.9rem, 2vw, 1\.35rem\)/);
  assert.match(motionStyles, /\.storyStep\.storyStep[\s\S]*?grid-template-columns: 3rem minmax\(0, 1fr\)/);
  assert.doesNotMatch(homepage, /ChevronRight/);
  assert.match(motionStyles, /box-shadow: inset 0 0 0 1px rgba\(190, 151, 79, \.2\)/);
  assert.doesNotMatch(motionStyles, /scaleY\(var\(--story-progress\)\)/);
  assert.match(laptopStyles, /\.transitionSection\.transitionSection[\s\S]*?min-height: auto/);
});

test("case continuity timeline keeps active and pending segments on one axis", () => {
  assert.match(motionStyles, /\.continuityMotion[\s\S]*?min-height: 180vh/);
  assert.match(motionStyles, /\.continuityVisualMotion[\s\S]*?position: sticky[\s\S]*?top: clamp\(1rem, 5vh, 3\.5rem\)/);
  assert.match(motionStyles, /@media \(max-width: 1100px\)[\s\S]*?\.continuityVisualMotion \{ position: relative; top: auto; \}/);
  assert.match(motionStyles, /\.continuityVisualMotion li\[data-active\][^}]*transform: none/);
  assert.doesNotMatch(motionStyles, /\.continuityVisualMotion li\[data-active\][^}]*translateX/);
  assert.match(homepage, /continuityStep/);
  assert.match(homepage, /selectContinuityStep/);
  assert.match(homepage, /aria-current=\{index === continuityStep \? "step"/);
  assert.match(homepage, /--continuity-stage-progress/);
  assert.match(motionDirector, /juro:continuity-step/);
  assert.match(motionDirector, /const continuityProgress = geometry\.continuity[\s\S]*?Math\.min\(56, viewport \* \.06\) - \(geometry\.continuity\.top - scrollY\)/);
  assert.match(motionStyles, /\.continuitySteps::after[\s\S]*?scaleY\(var\(--continuity-stage-progress\)\)/);
  assert.match(motionStyles, /\.continuitySteps button[\s\S]*?grid-template-columns: 2\.5rem 1fr/);
  assert.match(homepage, /<div className=\{styles\.nextCard\}><span>\{t\.continuity\.next\}<\/span><strong>\{t\.continuity\.nextBody\}<\/strong><\/div>/);
  assert.doesNotMatch(homepage, /nextCard[^\n]*ArrowDownRight/);
});

test("trust and resource gateways use an editorial hierarchy", () => {
  assert.match(homepage, /editorialStyles\.trustGrid/);
  assert.match(homepage, /data-trust-card/);
  assert.doesNotMatch(homepage, /data-trust-card[^>]*data-reveal|data-reveal[^>]*data-trust-card/);
  assert.match(homepage, /editorialStyles\.resourceGrid/);
  assert.match(homepage, /data-primary=\{index === 0/);
  assert.match(homepage, /Смотреть обзор/);
  assert.match(homepage, /Sharhni ko‘rish/);
  assert.match(homepage, /resourceFeatureMeta/);
  assert.match(homepage, /resourceFeatureCopy/);
  assert.match(homepage, /resourceFeaturePlay/);
  assert.match(homepage, /resourceFeatureAction/);
  assert.match(editorialStyles, /prefers-reduced-motion:\s*reduce/);
  assert.match(editorialStyles, /grid-template-columns: 64px minmax\(0, 1\.2fr\) minmax\(300px, \.8fr\)/);
  assert.match(editorialStyles, /grid-column: 1 \/ -1;\s*grid-row: 1;\s*justify-self: start/);
  assert.match(editorialStyles, /@media \(max-width: 1180px\)/);
  assert.match(editorialStyles, /radial-gradient\(circle at 82% 16%/);
  assert.match(editorialStyles, /border-radius: 18px 18px 0 0/);
  assert.match(editorialStyles, /max-width: 19ch/);
  assert.match(editorialStyles, /\.trustSection[\s\S]*?padding-bottom: clamp\(3rem, 5vw, 5rem\)/);
  assert.match(editorialStyles, /\.resourcesSection\.resourcesSection[\s\S]*?padding-top: clamp\(3rem, 5vw, 5rem\)/);
  assert.match(editorialStyles, /linear-gradient\(145deg, #123854/);
  assert.match(editorialStyles, /\.resourceFeatureMeta[\s\S]*?justify-content: space-between/);
  assert.match(editorialStyles, /\.resourceFeatureCopy[\s\S]*?gap: clamp\(6rem, 20vw, 17rem\)[\s\S]*?grid-template-columns: minmax\(0, max-content\) auto[\s\S]*?width: fit-content/);
  assert.match(editorialStyles, /\.resourceFeaturePlay[\s\S]*?border-radius: 50%/);
  assert.match(editorialStyles, /\.resourceItem\.resourceItem\[data-primary\] \.resourceFeaturePlay > svg[\s\S]*?position: static/);
  assert.match(editorialStyles, /\.resourceFeatureAction[\s\S]*?justify-content: flex-start/);
  assert.match(editorialStyles, /\.resourceItem\.resourceItem\[data-primary\] \.watchSignal > svg[\s\S]*?bottom: auto[\s\S]*?position: static[\s\S]*?right: auto[\s\S]*?transform: none/);
  assert.match(editorialStyles, /\.resourceItem\[data-primary\]:hover \.watchSignal[\s\S]*?background: #d7b56f/);
  assert.match(editorialStyles, /\.resourceItem\[data-primary\]:active \.watchSignal/);
});

test("start pathways retain direct-linking and responsive decision states", () => {
  assert.match(homepage, /hashchange/);
  assert.match(homepage, /navigateToSection/);
  assert.match(homepage, /history\.pushState/);
  assert.match(homepage, /popstate/);
  assert.match(homepage, /window\.scrollTo/);
  assert.match(homepage, /decodeURIComponent/);
  assert.match(homepage, /decisionStyles\.accessPlans/);
  assert.match(homepage, /data-access-plan/);
  assert.doesNotMatch(homepage, /data-access-plan[^>]*data-reveal|data-reveal[^>]*data-access-plan/);
  assert.match(homepage, /styles\.accessNote.*laptopStyles\.accessNote/);
  assert.match(laptopStyles, /\.accessNote\.accessNote[\s\S]*?line-height: 1\.65[\s\S]*?margin: clamp\(1\.35rem, 2\.4vw, 1\.75rem\) auto 0/);
  assert.match(homepage, /data-featured=\{index === 1/);
  assert.match(decisionStyles, /prefers-reduced-motion:\s*reduce/);
  assert.match(decisionStyles, /@media \(max-width: 620px\)/);
});

test("laptop layouts prevent large headline and product-grid clipping", () => {
  assert.match(homepage, /laptopStyles\.heroGrid/);
  assert.match(homepage, /laptopStyles\.heroProduct/);
  assert.match(homepage, /laptopStyles\.transitionSection/);
  assert.match(laptopStyles, /@media \(max-width: 1420px\)/);
  assert.match(laptopStyles, /grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(laptopStyles, /min-width: 0/);
  assert.match(laptopStyles, /\.heroCopy\.heroCopy \{ max-width: 900px; \}/);
  assert.match(homepage, /styles\.heroNote.*laptopStyles\.heroNote/);
  assert.match(laptopStyles, /\.heroNote\.heroNote[\s\S]*?margin: clamp\(1\.35rem, 2\.4vw, 1\.75rem\) 0 0[\s\S]*?line-height: 1\.65|\.heroNote\.heroNote[\s\S]*?line-height: 1\.65[\s\S]*?margin: clamp\(1\.35rem, 2\.4vw, 1\.75rem\) 0 0/);
  assert.match(motionStyles, /100% \{ clip-path: none; opacity: 1; transform: translateY\(0\); \}/);
  assert.match(laptopStyles, /font-size: clamp\(2\.05rem, 8vw, 3\.25rem\)/);
  assert.match(laptopStyles, /\.transitionTitle\.transitionTitle[\s\S]*?max-width: 100%/);
  assert.match(globalStyles, /\[data-reveal\]\[data-reveal-state="visible"\] \{\s*clip-path: none/);
  assert.match(globalStyles, /\[data-reveal="mask"\]\[data-reveal-state="visible"\] \{\s*clip-path: inset/);
});

test("public header language links keep a 44px touch target at every viewport", () => {
  assert.match(
    headerTouchStyles,
    /\.language\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/,
  );
});

test("brand mark uses a dedicated symbol asset and keeps one intentional wordmark", () => {
  assert.match(chrome, /brandStyles\.markFrame/);
  assert.match(chrome, /brandStyles\.mobileMarkFrame/);
  assert.match(chrome, /brandStyles\.footerMarkFrame/);
  assert.match(chrome, /src=\{tone === "dark" && !scrolled \? "\/juro-mark-light\.png" : "\/juro-mark\.png"\}/);
  assert.match(chrome, /src="\/juro-mark\.png"/);
  assert.match(chrome, /src="\/juro-mark-light\.png"/);
  assert.match(chrome, /brandStyles\.wordmark\}>JURO/);
  assert.match(chrome, /juro-mark-light\.png/);
  assert.match(chrome, /juro-mark\.png/);
  assert.doesNotMatch(chrome, /juro-logo-light\.avif|juro-logo-primary\.avif/);
  assert.match(fs.readFileSync("app\/components\/public\/brand-lockup.module.css", "utf8"), /\.markFrame[\s\S]*?overflow: hidden/);
  assert.match(fs.readFileSync("app\/components\/public\/brand-lockup.module.css", "utf8"), /\.wordmark[\s\S]*?font-size: 1\.38rem/);
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
