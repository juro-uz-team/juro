import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellSource = new URL("../app/_platform/PlatformShell.tsx", import.meta.url);
const searchStylesheet = new URL("../app/_platform/global-search.css", import.meta.url);
const shellStylesheet = new URL("../app/_platform/platform-shell.css", import.meta.url);
const profileStylesheet = new URL("../app/_platform/profile-settings.css", import.meta.url);
const casesStylesheet = new URL("../app/_platform/cases.css", import.meta.url);
const lawyerStylesheet = new URL("../app/_platform/lawyer-workspace.css", import.meta.url);
const dashboardSource = new URL("../app/_platform/DashboardClient.tsx", import.meta.url);
const dashboardStylesheet = new URL("../app/_platform/dashboard.css", import.meta.url);
const calendarStylesheet = new URL("../app/_platform/calendar.css", import.meta.url);
const aiStylesheet = new URL("../app/_platform/ai-lawyer.css", import.meta.url);
const documentBuilderStylesheet = new URL("../app/_document-builder/document-builder.css", import.meta.url);
const accountDocumentsLayout = new URL("../app/[locale]/[accountType]/documents/layout.tsx", import.meta.url);
const businessDocumentsLayout = new URL("../app/[locale]/business/[workspaceId]/documents/layout.tsx", import.meta.url);
const accountNotificationsLayout = new URL("../app/[locale]/[accountType]/notifications/layout.tsx", import.meta.url);
const businessNotificationsLayout = new URL("../app/[locale]/business/[workspaceId]/notifications/layout.tsx", import.meta.url);

test("skip link moves focus to the platform main landmark", async () => {
  const shell = await readFile(shellSource, "utf8");

  assert.match(shell, /className="platform-skip-link" href="#main-content"/);
  assert.match(shell, /<main className="platform-content" id="main-content" tabIndex=\{-1\}>/);
});

test("compact global-search trigger retains a 44px touch target", async () => {
  const css = await readFile(searchStylesheet, "utf8");

  assert.match(css, /\.global-search-trigger\{[^}]*min-height:44px/);
  assert.match(css, /@media\(max-width:1050px\)\{\.global-search-trigger\{min-width:44px!important\}/);
});

test("closed mobile navigation cannot create horizontal page scrolling", async () => {
  const [shell, css] = await Promise.all([
    readFile(shellSource, "utf8"),
    readFile(shellStylesheet, "utf8"),
  ]);

  assert.match(css, /@media\(max-width:800px\)\{\.platform-shell\{display:block;overflow-x:clip\}/);
  assert.match(shell, /if \(event\.key === "Escape"\) \{\s+setOpen\(false\);\s+openButtonRef\.current\?\.focus\(\);/);
  assert.match(shell, /const closeMobileMenu = \(\) => \{\s+setOpen\(false\);\s+window\.requestAnimationFrame\(\(\) => openButtonRef\.current\?\.focus\(\)\);/);
});

test("320px and 360px topbars keep actions reachable without clipping", async () => {
  const [shell, css] = await Promise.all([
    readFile(shellSource, "utf8"),
    readFile(shellStylesheet, "utf8"),
  ]);

  assert.match(shell, /className="platform-language-switcher"/);
  assert.match(shell, /className="platform-sidebar-logout"/);
  assert.doesNotMatch(shell, /className="platform-topbar-logout"/);
  assert.match(shell, /className="platform-profile-menu"/);
  assert.match(css, /\.platform-topbar button,.platform-topbar a,.platform-menu\{min-width:44px;height:44px\}/);
  assert.match(css, /@media\(max-width:420px\)\{\s+\.platform-topbar\{padding-inline:3px\}\s+\.platform-topbar>div:last-child\{gap:4px\}/);
  assert.match(css, /\.platform-topbar \.platform-language-switcher\{width:88px;padding-inline:6px;gap:6px\}/);
  assert.match(css, /@media\(max-width:340px\)\{\.platform-topbar-logout\{display:none!important\}\}/);
  assert.match(css, /@media\(max-width:520px\)\{\.platform-topbar>div:first-of-type\{display:none\}\}/);
  assert.match(css, /@media\(max-width:800px\)\{\s+\.platform-sidebar-logout\{display:flex;/);
});

test("mid-width profile controls shrink inside the platform content column", async () => {
  const css = await readFile(profileStylesheet, "utf8");

  assert.match(css, /\.profile-form\{min-width:0;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}/);
  assert.match(css, /\.profile-form section,\.profile-form label\{min-width:0\}/);
  assert.match(css, /\.profile-form input,\.profile-form :is\(select, \.juro-select\),\.profile-form textarea\{width:100%;max-width:100%;min-width:0\}/);
});

test("individual case links and settings tabs retain 44px touch targets", async () => {
  const [cases, profile] = await Promise.all([
    readFile(casesStylesheet, "utf8"),
    readFile(profileStylesheet, "utf8"),
  ]);

  assert.match(cases, /\.cases-live-list article>a\{display:inline-flex;min-height:44px;align-items:center/);
  assert.match(profile, /\.profile-workspace>nav a\{min-height:44px/);
});

test("case filters expose focus and plan and session actions retain 44px targets", async () => {
  const [cases, shell, profile] = await Promise.all([
    readFile(casesStylesheet, "utf8"),
    readFile(shellStylesheet, "utf8"),
    readFile(profileStylesheet, "utf8"),
  ]);

  assert.match(cases, /\.cases-live-tools label:focus-within\{outline:3px solid var\(--focus-ring,#87631f\);outline-offset:2px\}/);
  assert.match(shell, /\.scenario-pills button\{min-height:44px\}/);
  assert.match(shell, /\.plan-section-title button\{width:44px;height:44px\}/);
  assert.match(profile, /\.session-actions button \{ min-height: 44px; \}/);
});

test("lawyer calendar actions retain a 44px touch target", async () => {
  const css = await readFile(lawyerStylesheet, "utf8");

  assert.match(css, /\.lawyer-schedule-section>header>button\{min-height:44px\}/);
});

test("client dashboard and calendar actions retain 44px touch targets", async () => {
  const [dashboard, calendar] = await Promise.all([
    readFile(dashboardStylesheet, "utf8"),
    readFile(calendarStylesheet, "utf8"),
  ]);

  assert.match(dashboard, /\.dashboard-section-title-row > button \{[^}]*min-height: 44px;/);

  assert.match(calendar, /\.calendar-tabs button\s*\{[^}]*min-width:\s*0;[^}]*min-height:\s*44px/s);
  assert.match(calendar, /@media\s*\(max-width:\s*430px\)\s*\{[\s\S]*?\.calendar-range button\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
});

test("dashboard keyboard focus stays visible in the composer and mobile action scroller", async () => {
  const [dashboard, css] = await Promise.all([
    readFile(dashboardSource, "utf8"),
    readFile(dashboardStylesheet, "utf8"),
  ]);

  assert.match(css, /\.dashboard-command-form:focus-within\s*\{\s*outline:\s*3px solid var\(--focus-ring, #87631f\);\s*outline-offset:\s*3px;/);
  assert.match(css, /\.dashboard-quick-grid > a:focus-visible\s*\{\s*outline:\s*3px solid var\(--focus-ring, #87631f\);\s*outline-offset:\s*3px;/);
  assert.match(dashboard, /onFocus=\{\(event\) => event\.currentTarget\.scrollIntoView\(\{\s*block: "nearest",\s*inline: "nearest",\s*\}\)\}/);
});

test("canonical document routes load the builder styles and keep folder controls touchable", async () => {
  const [css, accountLayout, businessLayout] = await Promise.all([
    readFile(documentBuilderStylesheet, "utf8"),
    readFile(accountDocumentsLayout, "utf8"),
    readFile(businessDocumentsLayout, "utf8"),
  ]);

  assert.match(css, /:where\(\.dbt-root, \.dbt-signed-access\) :where\(button, a, :is\(select, \.juro-select\), textarea,[^}]+\) \{ min-height: 44px; \}/);
  assert.match(css, /:where\(\.dbt-root, \.dbt-signed-access\) :where\(button, a\) \{ min-width: 44px; \}/);
  assert.match(css, /\.dbt-folders button \{/);
  assert.match(css, /@media \(max-width: 1180px\) \{\s+\.platform-shell \.dbt-docs-layout \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.platform-shell \.dbt-doc-filters \{ grid-template-columns: 1fr 1fr; \}/);
  assert.match(accountLayout, /import "\.\.\/\.\.\/\.\.\/_document-builder\/document-builder\.css";/);
  assert.match(businessLayout, /import "\.\.\/\.\.\/\.\.\/\.\.\/_document-builder\/document-builder\.css";/);
});

test("mobile AI, notification, and privacy actions retain 44px touch targets", async () => {
  const [ai, documents, profile, accountNotifications, businessNotifications] = await Promise.all([
    readFile(aiStylesheet, "utf8"),
    readFile(documentBuilderStylesheet, "utf8"),
    readFile(profileStylesheet, "utf8"),
    readFile(accountNotificationsLayout, "utf8"),
    readFile(businessNotificationsLayout, "utf8"),
  ]);

  assert.match(ai, /\.ai-composer-options > summary \{[\s\S]*?min-height: 44px;/);
  assert.match(ai, /@media \(max-width: 520px\) \{[\s\S]*?\.ai-composer-mode button \{ width: 44px; min-width: 44px;/);
  assert.match(documents, /:where\(\.dbt-root, \.dbt-signed-access\) :where\(button, a, :is\(select, \.juro-select\), textarea,[^}]+\) \{ min-height: 44px; \}/);
  assert.match(documents, /:where\(\.dbt-root, \.dbt-signed-access\) :where\(button, a\) \{ min-width: 44px; \}/);
  assert.match(documents, /\.dbt-notification-list article > a, \.dbt-notification-list article > button \{/);
  assert.match(documents, /\.dbt-notification-list article > a, \.dbt-notification-list article > button \{ grid-column: 2; justify-self: start; \}/);
  assert.match(accountNotifications, /import "\.\.\/\.\.\/\.\.\/_document-builder\/document-builder\.css";/);
  assert.match(businessNotifications, /import "\.\.\/\.\.\/\.\.\/\.\.\/_document-builder\/document-builder\.css";/);
  assert.match(profile, /\.delete-request button \{ min-height: 44px; \}/);
});
