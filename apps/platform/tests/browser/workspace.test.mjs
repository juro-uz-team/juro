import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
let browser, server, origin;
const root = fileURLToPath(new URL("../../", import.meta.url));
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
 import {PlatformShell} from './app/_platform/PlatformShell'; import {DashboardClient} from './app/_platform/DashboardClient';
 const q=new URLSearchParams(location.search),locale=q.get('locale')||'en',accountType=q.get('account')||'individual';
 document.documentElement.dataset.theme=q.get('theme')||'light'; const props={locale,accountType,userName:'Aziza Karimova'};
 createRoot(document.getElementById('root')).render(<PlatformShell {...props} activeWorkspaceId="workspace-one" workspaces={[{id:'workspace-one',name:'My workspace',type:accountType,role:'owner'}]}><DashboardClient {...props}/></PlatformShell>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    jsx: "automatic",
    plugins: [
      {
        name: "next-adapters",
        setup(b) {
          b.onResolve({ filter: /^next\/(navigation|image|link)$/ }, (a) => ({
            path: a.path,
            namespace: "adapter",
          }));
          b.onLoad({ filter: /.*/, namespace: "adapter" }, (a) => ({
            contents: a.path.endsWith("navigation")
              ? `export const usePathname=()=>location.pathname; export const useSearchParams=()=>new URLSearchParams(location.search); export const useRouter=()=>({push:url=>{window.__destination=url},replace:url=>{window.__destination=url},prefetch:()=>{}});`
              : `import React from 'react'; export default function Adapter({children,priority,unoptimized,...props}){return React.createElement('${a.path.endsWith("image") ? "img" : "a"}',props,children)}`,
            loader: "js",
            resolveDir: root,
          }));
        },
      },
    ],
  });
  const css = (
    await Promise.all(
      [
        "app/globals.css",
        "app/_platform/platform-shell.css",
        "app/_platform/dashboard.css",
        "app/_platform/global-search.css",
        "app/_components/motion.css",
        "app/_components/brand.css",
        "app/_components/select.css",
      ].map((p) => readFile(root + p, "utf8")),
    )
  )
    .join("\n")
    .replace('@import "tailwindcss";', "");
  server = createServer(async (req, res) => {
    if (req.url.startsWith("/juro-logo") || req.url.startsWith("/brand/")) {
      res.setHeader("Content-Type", req.url.endsWith(".svg") ? "image/svg+xml" : "image/png");
      res.end(await readFile(root + "public" + req.url));
      return;
    }
    if (req.url.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      res.end("{}");
      return;
    }
    res.setHeader(
      "Content-Type",
      req.url === "/bundle.js" ? "text/javascript" : "text/html",
    );
    res.end(
      req.url === "/bundle.js"
        ? bundle.outputFiles[0].text
        : `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`,
    );
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({
    channel: process.env.WORKSPACE_BROWSER_CHANNEL || undefined,
  });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise((r) => (server ? server.close(r) : r()));
});
const data = {
  serverNow: "2026-10-05T08:00:00Z",
  counts: {
    activeCases: 2,
    documents: 3,
    consultations: 0,
    unreadNotifications: 0,
  },
  cases: [
    {
      id: "lease",
      title: "Office lease · Tashkent",
      status: "active",
      updatedAt: "2026-10-04T12:00:00Z",
      progressPercent: 40,
    },
  ],
  documents: [
    {
      id: "contract",
      title: "Service agreement",
      category: "Contract",
      status: "draft",
      updatedAt: "2026-10-05T07:00:00Z",
    },
  ],
  deadlines: [
    {
      id: "deadline",
      title: "Review the lease terms",
      dueAt: "2026-10-06T10:00:00Z",
      caseId: "lease",
      caseTitle: "Office lease · Tashkent",
    },
  ],
  notifications: [],
  analyses: [],
  comparisons: [],
};
async function pageFor(
  t,
  {
    width = 1440,
    locale = "en",
    theme = "light",
    account = "individual",
    empty = false,
    failed = false,
    path = "dashboard",
  } = {},
) {
  const page = await browser.newPage({ viewport: { width, height: 960 } });
  t.after(() => page.close());
  await page.route("**/api/platform/dashboard", (r) =>
    r.fulfill({
      status: failed ? 503 : 200,
      json: failed
        ? { error: "Unavailable" }
        : empty
          ? { ...data, cases: [], documents: [], deadlines: [] }
          : data,
    }),
  );
  await page.goto(
    `${origin}/${locale}/${account}${account === "business" ? "/workspace-one" : ""}/${path}?locale=${locale}&theme=${theme}&account=${account}`,
  );
  await page.locator("h1").waitFor();
  return page;
}
async function screenshot(page, name) {
  if (process.env.WORKSPACE_SCREENSHOTS) {
    await mkdir(process.env.WORKSPACE_SCREENSHOTS, { recursive: true });
    await page.screenshot({
      path: `${process.env.WORKSPACE_SCREENSHOTS}/${name}.png`,
      fullPage: true,
    });
  }
}
test("four main destinations, searchable tools, focus containment and restoration", async (t) => {
  const p = await pageFor(t);
  assert.equal(await p.locator(".platform-nav-group a").count(), 4);
  await screenshot(p, "desktop-light");
  const trigger = p.getByRole("button", { name: "All tools", exact: true });
  await trigger.click();
  const search = p.getByRole("textbox", { name: "Find a tool" });
  await search.fill("compare");
  assert.equal(await p.locator("dialog a").count(), 1);
  assert.match(
    await p.locator("dialog a").getAttribute("href"),
    /document-review\?mode=compare$/,
  );
  await search.fill("no such tool");
  assert.equal(await p.locator("dialog [role=status]").count(), 1);
  await search.fill("");
  await screenshot(p, "tools-light");
  for (let i = 0; i < 25; i++) {
    await p.keyboard.press("Tab");
    assert.equal(
      await p.evaluate(() => !!document.activeElement.closest("dialog")),
      true,
    );
  }
  await p.keyboard.press("Escape");
  assert.equal(await p.locator("dialog").count(), 0);
  assert.equal(
    await trigger.evaluate((el) => el === document.activeElement),
    true,
  );
});
test("existing tools retain business workspace destinations", async (t) => {
  const p = await pageFor(t, { account: "business" });
  await p.getByRole("button", { name: "All tools", exact: true }).click();
  const hrefs = await p
    .locator("dialog a")
    .evaluateAll((links) => links.map((l) => l.getAttribute("href")));
  for (const route of [
    "document-builder",
    "document-review",
    "documents",
    "document-review?mode=compare",
    "action-plan",
    "calendar",
    "archive",
    "history",
    "consultations",
    "lawyers",
    "monitoring",
    "team",
    "notifications",
    "billing",
  ])
    assert.ok(hrefs.includes("/en/business/workspace-one/" + route), route);
});
test("Uzbek dark layouts and dialogs fit at 320, 390 and 850px", async (t) => {
  for (const width of [320, 390, 850]) {
    const p = await pageFor(t, { width, locale: "uz", theme: "dark" });
    assert.equal(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await screenshot(p, `mobile-${width}-dark`);
    await p.locator(".platform-mobile-nav button").click();
    await p.locator(".platform-tools-trigger").click();
    assert.equal(await p.locator("dialog").isVisible(), true);
    assert.equal(
      await p
        .locator("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
      true,
    );
    await screenshot(p, `tools-${width}-dark`);
    await p.keyboard.press("Escape");
    assert.equal(
      await p
        .locator(".platform-mobile-nav button")
        .evaluate((el) => el === document.activeElement),
      true,
    );
  }
});
test("language picker selects directly and preserves page context", async (t) => {
  const p = await pageFor(t, { account: "lawyer", width: 320 });
  const url = new URL(p.url());
  url.searchParams.set("conversationId", "conversation-one");
  url.searchParams.set("prompt", "private draft");
  url.hash = "details";
  await p.goto(url.href);
  const picker = p.getByRole("combobox", { name: "Interface language" });
  await picker.click();
  assert.deepEqual(await p.getByRole("option").allTextContents(), ["RU", "UZ", "EN"]);
  await p.getByRole("option", { name: "UZ", exact: true }).click();
  const destination = new URL(await p.evaluate(() => window.__destination), origin);
  assert.equal(destination.pathname, "/uz/lawyer/dashboard");
  assert.equal(destination.searchParams.get("conversationId"), "conversation-one");
  assert.equal(destination.searchParams.has("prompt"), false);
  assert.equal(destination.hash, "#details");
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await picker.click();
  await p.keyboard.press("Escape");
  assert.equal(await picker.evaluate(el => document.activeElement === el), true);
});

test("account controls, collapsed navigation and lawyer tools stay reachable", async (t) => {
  const p = await pageFor(t, { account: "lawyer" });
  assert.equal(await p.locator('.platform-sidebar nav a[href="/en/lawyer/ai-chat"]').count(), 1);
  await p.setViewportSize({ width: 390, height: 844 });
  assert.equal(await p.locator('.platform-mobile-nav a[href="/en/lawyer/ai-chat"]').isVisible(), true);
  assert.equal(await p.locator('.platform-mobile-nav > *').count(), 5);
  await p.setViewportSize({ width: 1440, height: 960 });
  await p.locator(".platform-collapse").click();
  await p.locator(".platform-profile-menu summary").click();
  assert.equal(
    await p.getByRole("button", { name: "Sign out", exact: true }).isVisible(),
    true,
  );
  await p.locator(".platform-profile-menu summary").click();
  await p.locator(".platform-tools-trigger").click();
  for (const view of ["clients", "messages", "documents", "tasks"])
    assert.equal(await p.locator(`dialog a[href$="view=${view}"]`).count(), 1);
});
test("sidebar selection has no edge marker and account menu dismisses outside", async (t) => {
  for (const theme of ["light", "dark"]) {
    const p = await pageFor(t, { theme });
    const menu = p.locator(".platform-profile-menu");
    const summary = menu.locator("summary");
    assert.match(await p.locator(".platform-sidebar nav a.active").evaluate(el => getComputedStyle(el).boxShadow), /0px 0px 0px 1px inset$/);
    await summary.click();
    await menu.locator(".platform-sidebar-bottom").click({ position: { x: 2, y: 2 } });
    assert.equal(await menu.evaluate(el => el.open), true);
    await p.locator("h1").click();
    assert.equal(await menu.evaluate(el => el.open), false);
    await summary.click();
    await p.keyboard.press("Escape");
    assert.equal(await menu.evaluate(el => el.open), false);
    assert.equal(await summary.evaluate(el => el === document.activeElement), true);
  }
});

test("question submission preserves the authenticated intake contract", async (t) => {
  const p = await pageFor(t);
  let intake;
  await p.route("**/api/platform/ai/intake", async (r) => {
    intake = r.request().postDataJSON();
    await r.fulfill({ json: { handle: "question-handle" } });
  });
  await p
    .locator("#dashboard-legal-task")
    .fill("What should I check before signing a lease?");
  await p.locator(".dashboard-start").click();
  await p.waitForFunction(() => window.__destination);
  assert.deepEqual(intake, {
    question: "What should I check before signing a lease?",
    workspaceId: "workspace-one",
  });
  assert.equal(
    await p.evaluate(() => window.__destination),
    "/en/individual/ai-chat?intake=question-handle",
  );
});
test("empty and failed dashboards stay honest; attachments require consent", async (t) => {
  const p = await pageFor(t, { empty: true });
  await p.locator(".dashboard-list-empty").first().waitFor();
  await screenshot(p, "empty-light");
  await p
    .locator("input[type=file]")
    .setInputFiles({
      name: "lease.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("document"),
    });
  assert.equal(await p.locator(".dashboard-start").isDisabled(), true);
  await p.locator(".dashboard-upload-consent input").check();
  assert.equal(await p.locator(".dashboard-start").isEnabled(), true);
  const failed = await pageFor(t, { failed: true });
  await failed.getByRole("alert").waitFor();
  assert.equal(await failed.locator(".dashboard-list-empty").count(), 0);
});

test("Russian desktop and English dark layouts keep the same hierarchy", async t => {
  for (const [locale, theme] of [["ru", "light"], ["en", "dark"]]) {
    const page = await pageFor(t, { locale, theme });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.locator(".dashboard-work-list").first().waitFor();
    await screenshot(page, `desktop-${locale}-${theme}`);
  }
});

test("sidebar motion settles after rapid toggles and honors reduced motion", async t => {
  const p = await pageFor(t);
  // Next's CSS optimizer serializes 220ms as .22s in the served stylesheet.
  await p.addStyleTag({ content: ':root { --motion-drawer: .22s; --motion-surface: .18s; }' });
  const main = p.locator('.platform-main');
  const quickAction = p.locator('.dashboard-quick-grid > a').first();
  await quickAction.hover();
  assert.ok(await quickAction.evaluate(el => getComputedStyle(el).transitionProperty.includes('background-color')));
  const expanded = (await main.boundingBox()).x;
  await p.locator('.platform-collapse').evaluate(button => button.click());
  assert.equal(await main.evaluate(el => el.getAnimations()[0]?.effect?.getTiming().duration), 220);
  await p.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.ok((await main.boundingBox()).x < expanded);
  for (let i = 0; i < 3; i++) await p.locator('.platform-collapse').evaluate(button => button.click());
  await p.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.equal((await main.boundingBox()).x, expanded);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await screenshot(p, 'motion-sidebar-expanded');
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.locator('.platform-collapse').evaluate(button => button.click());
  assert.equal(await main.evaluate(el => el.getAnimations().length), 0);
  assert.ok((await main.boundingBox()).x < expanded);
});

test("hover feedback and mobile drawer transitions preserve focus and closed-state hit testing", async t => {
  const p = await pageFor(t, { width: 390, theme: 'dark' });
  const opener = p.getByRole('button', { name: 'Open menu', exact: true });
  await opener.click();
  const sidebar = p.locator('.platform-sidebar');
  await p.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.equal(Math.round((await sidebar.boundingBox()).x), 0);
  await screenshot(p, 'motion-mobile-open');
  await p.keyboard.press('Escape');
  assert.equal(await opener.evaluate(el => el === document.activeElement), true);
  assert.equal(await sidebar.getAttribute('inert'), '');
  await p.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  assert.equal(await p.locator('.platform-backdrop').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
  assert.ok((await sidebar.boundingBox()).x < 0);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await opener.click();
  assert.equal(Math.round((await sidebar.boundingBox()).x), 0);
  assert.equal(await sidebar.evaluate(el => getComputedStyle(el).transitionProperty.includes('transform')), false);
});
