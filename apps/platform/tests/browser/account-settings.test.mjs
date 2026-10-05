import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

let browser, server, origin;
const root = fileURLToPath(new URL("../../", import.meta.url));
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
        import {ProfileSettingsClient} from './app/_platform/ProfileSettingsClient';
        import {ProfessionalCredentials} from './app/_platform/ProfessionalCredentials';
        import {LawyerProfessionalProfile} from './app/_platform/LawyerProfessionalProfile';
        import {AccountArea} from './app/_platform/AccountArea';
        import {PlatformRouteProvider} from './app/_platform/PlatformRouteContext';
        const parts=location.pathname.split('/'), locale=parts[1], view=parts.at(-1);
        document.documentElement.dataset.theme=new URLSearchParams(location.search).get('theme')||'light';
        createRoot(document.getElementById('root')).render(<PlatformRouteProvider basePath={'/'+locale+'/individual'} workspaceId="workspace-one">{view==='professional'?<AccountArea locale={locale} view="profile" name="Aziza Karimova"><LawyerProfessionalProfile locale={locale}/></AccountArea>:view==='credentials'?<AccountArea locale={locale} view="profile" name="Aziza Karimova"><ProfessionalCredentials locale={locale} profileId="lawyer-one"/></AccountArea>:<ProfileSettingsClient locale={locale} accountType="individual" view={view}/>}</PlatformRouteProvider>);`,
      resolveDir: root, loader: "tsx",
    },
    bundle: true, write: false, outdir: "account-test-bundle", jsx: "automatic",
    plugins: [{ name: "next-adapters", setup(b) {
      b.onResolve({ filter: /^next\/(navigation|image|link)$/ }, a => ({ path: a.path, namespace: "adapter" }));
      b.onLoad({ filter: /.*/, namespace: "adapter" }, a => ({
        contents: a.path.endsWith("navigation")
          ? `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:url=>location.assign(url)});`
          : `import React from 'react';export default function Adapter({children,priority,unoptimized,prefetch,...props}){return React.createElement('${a.path.endsWith("image") ? "img" : "a"}',props,children)}`,
        loader: "js", resolveDir: root,
      }));
    } }],
  });
  const css = (await Promise.all(["app/globals.css", "app/_components/select.css", "app/_platform/profile-settings.css"].map(p => readFile(root + p, "utf8")))).join("\n").replace('@import "tailwindcss";', "") + bundle.outputFiles.find(f => f.path.endsWith(".css")).text;
  const js = bundle.outputFiles.find(f => f.path.endsWith(".js")).text;
  server = createServer((req, res) => {
    res.setHeader("Content-Type", req.url === "/bundle.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/bundle.js" ? js : `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.WORKSPACE_BROWSER_CHANNEL || undefined });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise(r => server ? server.close(r) : r()); });

async function accountPage(t, { view = "profile", locale = "en", theme = "light", width = 1280, failSave = false, failEmail = false } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 } });
  t.after(() => page.close());
  const writes = [], errors = [];
  const profile = { email: "aziza@example.test", fullName: "Aziza Karimova", phone: "+998901234567", locale, timezone: "Asia/Tashkent", accountType: "individual", companyName: null, organizationRole: null };
  let preferences = { marketing_email: false, weekly_case_summary: true, unfinished_document: false, comments: true, lawyer_request_updates: true };
  let professional = { id: "lawyer-one", displayName: "Aziza Karimova", specialties: [], languages: [], status: "active", marketplaceStatus: "profile_incomplete", publicApprovedAt: null, experienceYears: 5, priceDescription: "300 000 UZS", consultationDurationMinutes: 60, additionalServices: [], availabilityStatus: "available", nextAvailableAt: "2026-10-08T10:30:00.000Z", advocateStatus: "not_declared", firmName: "Legal Studio", bio: "", city: "", region: "", education: "Law degree", consultationFormats: [], hasPhone: true, profilePhotoUrl: null, missingRequiredFields: [], moderationReason: null, updatedAt: "2026-10-05T10:00:00Z", moderationHistory: [] };
  let mfaEnabled = false;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), body = request.postDataJSON();
    if (method !== "GET") writes.push({ path, method, body });
    let result = {}, status = 200;
    if (path === "/api/platform/profile") {
      if (method === "PATCH") { if (failSave) { status = 503; result = { error: "Unable to save right now." }; } else Object.assign(profile, body); }
      if (status === 200) result = { profile, workspace: { name: "Personal", type: "individual", locale }, role: "owner", consents: [], acceptances: [], deletionRequest: null };
    } else if (path === "/api/platform/security/email-change") {
      if (failEmail) { status = 503; result = { error: "Email settings unavailable." }; }
      else if (method === "POST" && body.action === "request_codes") result = { challengeId: "email-challenge", currentDestination: profile.email, newDestination: body.newEmail, expiresInSeconds: 600 };
      else result = { available: true, canManage: true, active: null };
    } else if (path === "/api/platform/security/sessions") result = { sessions: Array.from({ length: 6 }, (_, i) => ({ id: `session-${i}`, deviceName: `Device ${i}`, isCurrent: i === 0, createdAt: "2026-10-01T10:00:00Z", lastSeenAt: "2026-10-05T10:00:00Z", expiresAt: "2026-11-01T10:00:00Z", authMethod: "password", countryCode: "UZ" })) };
    else if (path === "/api/platform/security/mfa") result = { available: true, canManage: true, enabled: mfaEnabled, verifiedAt: null, backupCodesRemaining: 8 };
    else if (path === "/api/platform/security/mfa/setup") result = { credentialId: "mfa-one", secret: "EXAMPLESETUPSECRET", otpauthUri: "otpauth://totp/Example", expiresAt: "2026-11-01T10:00:00Z" };
    else if (path === "/api/platform/security/mfa/confirm") { mfaEnabled = true; result = { backupCodes: ["example-one", "example-two"] }; }
    else if (path === "/api/platform/notification-preferences") { if (method === "PUT") preferences = body.preferences; result = { preferences }; }
    else if (path === "/api/platform/ai/memory") result = { available: true, settings: { automaticEnabled: false }, memories: [] };
    else if (path === "/api/platform/lawyer-profile") { if (method === "PATCH") professional = {...professional, ...body}; result = {profile: professional}; }
    else if (path === "/api/platform/lawyer-schedule") result = {rules: [], unavailability: []};
    else if (path === "/api/platform/lawyer-profile/credentials") result = { defaultType: "firm", details: { professional_type: "firm", organization_name: "Legal Studio", registration_number: "12345", license_number: null, representatives: [] }, documents: [] };
    else if (path === "/api/platform/privacy/deletion-request") result = { challengeId: "delete-challenge", destination: profile.email, expiresInSeconds: 600 };
    await route.fulfill({ status, json: result });
  });
  await page.goto(`${origin}/${locale}/individual/${view}?theme=${theme}`);
  await page.locator(".account-identity strong").filter({ hasText: profile.fullName }).waitFor({ state: "attached" });
  t.after(() => assert.deepEqual(errors, []));
  return { page, writes };
}

test("each account tab owns distinct controls", async t => {
  const expected = { profile: ["Personal details"], settings: ["Language & region", "Email notifications"], security: ["Email & sign-in", "Two-factor authentication", "Your devices"], privacy: ["Analytics & privacy", "JURO memory", "Export data"] };
  for (const [view, titles] of Object.entries(expected)) {
    const { page } = await accountPage(t, { view });
    for (const title of titles) await page.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.deepEqual(await page.locator(".account-content h2:visible").allTextContents(), titles);
    assert.equal(await page.getByLabel("Name", { exact: true }).count(), view === "profile" ? 1 : 0);
    assert.equal(await page.getByRole("combobox", { name: "Language", exact: true }).count(), view === "settings" ? 1 : 0);
    assert.equal(await page.getByRole("radio", { name: "Allow analytics", exact: true }).count(), view === "privacy" ? 1 : 0);
    assert.equal(await page.getByLabel("New email address", { exact: true }).count(), view === "security" ? 1 : 0);
    assert.equal(await page.locator(".account-rail [aria-current=page]").count(), 1);
  }
});

test("profile supports discard, persisted save, and recoverable save failure", async t => {
  const { page, writes } = await accountPage(t);
  const name = page.getByLabel("Name", { exact: true }), save = page.getByRole("button", { name: "Save changes", exact: true });
  assert.equal(await save.isDisabled(), true);
  await name.fill("New name"); await page.getByRole("button", { name: "Discard changes" }).click(); assert.equal(await name.inputValue(), "Aziza Karimova");
  await name.fill("Aziza Updated"); await save.click(); await page.locator(".profile-message.success").waitFor();
  assert.equal(writes.at(-1).body.fullName, "Aziza Updated"); assert.equal(writes.at(-1).body.timezone, "Asia/Tashkent");
  await page.reload(); await name.waitFor(); assert.equal(await name.inputValue(), "Aziza Updated");
  const failed = await accountPage(t, { failSave: true });
  await failed.page.getByLabel("Name", { exact: true }).fill("Keep my draft"); await failed.page.getByRole("button", { name: "Save changes", exact: true }).click(); await failed.page.getByRole("alert").waitFor();
  assert.equal(await failed.page.getByLabel("Name", { exact: true }).inputValue(), "Keep my draft"); assert.equal(await failed.page.getByRole("button", { name: "Save changes", exact: true }).isEnabled(), true);
});

test("notification changes can be discarded and saved independently", async t => {
  const { page, writes } = await accountPage(t, { view: "settings" }), panel = page.locator(".notification-preferences-panel");
  await panel.getByRole("checkbox").first().waitFor(); const save = panel.getByRole("button", { name: "Save notifications" }); assert.equal(await save.isDisabled(), true);
  await panel.getByRole("checkbox").first().check(); await panel.getByRole("button", { name: "Discard changes" }).click(); assert.equal(await panel.getByRole("checkbox").first().isChecked(), false);
  await panel.getByRole("checkbox").first().check(); await save.click(); await panel.getByRole("status").waitFor(); assert.equal(writes.at(-1).body.preferences.marketing_email, true);
});

test("security retains email and MFA verification and bounds the device list", async t => {
  const { page, writes } = await accountPage(t, { view: "security" }); await page.locator(".session-row").first().waitFor(); assert.equal(await page.locator(".session-row").count(), 4);
  await page.getByRole("button", { name: "Show all devices (6)" }).click(); assert.equal(await page.locator(".session-row").count(), 6);
  await page.getByRole("button", { name: "Show fewer devices" }).click(); assert.equal(await page.locator(".session-row").count(), 4);
  await page.getByLabel("New email address", { exact: true }).fill("new@example.test"); await page.getByRole("button", { name: "Send two codes" }).click(); await page.locator(".email-change-verification").waitFor();
  assert.equal(writes.at(-1).body.action, "request_codes"); assert.equal(await page.getByRole("button", { name: "Verify and change" }).isDisabled(), true);
  await page.getByRole("button", { name: "Set up 2FA" }).click(); await page.locator(".mfa-setup").waitFor(); assert.equal(await page.getByRole("button", { name: "Confirm and enable" }).isDisabled(), true);
  await page.locator(".mfa-setup input").fill("123456"); await page.getByRole("button", { name: "Confirm and enable" }).click(); await page.locator(".backup-codes").waitFor(); assert.equal(await page.locator(".backup-codes code").count(), 2);
});

test("email service failure does not hide working MFA and device controls", async t => {
  const { page } = await accountPage(t, { view: "security", failEmail: true }); await page.getByRole("alert").waitFor(); await page.getByRole("button", { name: "Set up 2FA" }).waitFor(); await page.locator(".session-row").first().waitFor();
});

test("privacy persists consent and requires explicit deletion disclosure and verification", async t => {
  const { page, writes } = await accountPage(t, { view: "privacy" });
  await page.getByRole("radio", { name: "Allow analytics", exact: true }).check(); assert.equal(await page.evaluate(() => localStorage.getItem("juro-cookie-consent")), "analytics");
  await page.reload(); await page.getByRole("radio", { name: "Allow analytics", exact: true }).waitFor(); assert.equal(await page.getByRole("radio", { name: "Allow analytics", exact: true }).isChecked(), true);
  await page.getByRole("radio", { name: "Essential only", exact: true }).check(); assert.equal(await page.evaluate(() => localStorage.getItem("juro-cookie-consent")), "necessary");
  assert.equal(await page.locator(".delete-request").isVisible(), false); await page.locator(".account-disclosure-danger summary").click(); await page.getByRole("button", { name: "Get a code by email" }).click(); await page.locator(".deletion-code-destination").waitFor();
  assert.equal(writes.at(-1).body.action, "request_code"); assert.equal(await page.locator(".deletion-actions button[type=submit]").isDisabled(), true);
  assert.equal(writes.filter(w => w.path.includes("deletion") && w.body.action === "confirm").length, 0);
});

test("professional representatives use labelled fields and preserve the credentials payload", async t => {
  const { page, writes } = await accountPage(t, { view: "credentials" });
  await page.getByRole("button", { name: "Add representative" }).click();
  const person = page.locator(".credential-person");
  await person.getByLabel("Name", { exact: true }).fill("Aziza Karimova");
  await person.getByLabel("Position", { exact: true }).fill("Partner");
  await person.getByLabel("Email", { exact: true }).fill("aziza@example.test");
  await page.getByRole("button", { name: "Save details", exact: true }).click();
  await page.getByRole("status").waitFor();
  assert.deepEqual(writes.at(-1).body, { professionalType: "firm", organizationName: "Legal Studio", registrationNumber: "12345", licenseNumber: null, representatives: [{ name: "Aziza Karimova", position: "Partner", email: "aziza@example.test" }] });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
});

for (const locale of ["en", "ru", "uz"]) for (const theme of ["light", "dark"]) test(`${locale} ${theme} account tabs fit mobile`, async t => {
  for (const view of ["profile", "settings", "security", "privacy"]) {
    const { page } = await accountPage(t, { locale, theme, view, width: 390 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const link of await page.locator(".account-rail nav a").all()) { const box = await link.boundingBox(); assert.ok(box.width >= 40 && box.height >= 44 && box.x >= 0 && box.x + box.width <= 390); }
  }
});



test("professional choices support keyboard options, custom chips, removal, and compatible save payloads", async t => {
  const {page,writes} = await accountPage(t, {view: "professional"});
  const formats = page.getByRole("combobox", {name: "Consultation formats", exact:true});
  await formats.fill("Video"); await formats.press("ArrowDown"); await formats.press("Enter"); await page.keyboard.press("Escape");
  await page.getByRole("button", {name: "Remove: Video call", exact:true}).waitFor();
  await formats.fill("Custom format"); await formats.press("Enter"); await page.keyboard.press("Escape");
  await page.getByRole("button", {name: "Remove: Custom format", exact:true}).click();
  await formats.fill("Chat"); await formats.press("Enter"); await page.keyboard.press("Escape");
  await formats.fill("chat"); await formats.press("Enter"); await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("button", {name: "Remove: Chat", exact:true}).count(),1);
  const city = page.getByRole("combobox", {name: "City", exact:true});
  await city.click(); await city.fill("Samar"); await city.press("ArrowDown");
  await page.getByRole("option", {name: "Samarkand",exact:true}).click();
  await page.getByRole("combobox", {name: "Region",exact:true}).fill("Custom region");
  await page.keyboard.press("Tab");
  await page.getByRole("combobox", {name:"Additional services",exact:true}).fill("Custom service");
  await page.keyboard.press("Tab");
  await page.getByRole("button", {name: "45 min",exact:true}).click();
  await page.getByRole("button", {name: "3 years",exact:true}).click();
  const education = page.getByRole("combobox", {name:"Education",exact:true});
  await education.click(); await education.fill("Bachelor"); await education.press("ArrowDown");
  await page.getByRole("option", {name:"Bachelor’s degree in law",exact:true}).click();
  await education.fill("Bachelor’s degree in law — Example University");
  await page.keyboard.press("Tab");
  await page.getByRole("textbox", {name:"About you",exact:true}).fill("I help clients understand their options.");
  await page.getByRole("button", {name:"Save draft",exact:true}).click();
  await page.getByText("Draft saved. It has not been submitted for review.",{exact:true}).waitFor();
  const saved=writes.find(write=>write.path==="/api/platform/lawyer-profile").body;
  assert.deepEqual(saved.consultationFormats,["Video call","Chat"]);
  assert.equal(saved.city,"Samarkand"); assert.equal(saved.region,"Custom region");
  assert.equal(saved.consultationDurationMinutes,45);
  assert.equal(saved.experienceYears,3);
  assert.equal(saved.education,"Bachelor’s degree in law — Example University");
  assert.equal(saved.bio,"I help clients understand their options.");
  assert.deepEqual(saved.additionalServices,["Custom service"]);
  assert.equal(saved.nextAvailableAt,"2026-10-08T10:30:00.000Z");
});

test("professional calendar is localized and file selection shows the selected name", async t => {
  const {page,writes} = await accountPage(t, {view:"professional",locale:"ru",width:390,theme:"dark"});
  await page.getByRole("button",{name:"Открыть календарь"}).click();
  const dialog=page.getByRole("dialog"); await dialog.waitFor();
  assert.match(await dialog.textContent(),/октябрь/i);
  const rect=await dialog.boundingBox(); assert.ok(rect.x>=0 && rect.x+rect.width<=390);
  await dialog.locator(".react-aria-CalendarCell").filter({hasText:/^15$/}).click();
  await page.getByRole("button",{name:"Сохранить черновик",exact:true}).click();
  await page.getByText("Черновик сохранён. Отправка на проверку не выполнена.",{exact:true}).waitFor();
  const instant=writes.find(write=>write.path==="/api/platform/lawyer-profile").body.nextAvailableAt;
  assert.equal(await page.evaluate(value=>new Date(value).getDate(),instant),15);
  await page.getByRole("button",{name:"Очистить дату"}).click();
  assert.equal(await page.getByRole("button",{name:"Очистить дату"}).count(),0);
  await page.locator('input[name="file"]').setInputFiles({name:"qualification.pdf",mimeType:"application/pdf",buffer:Buffer.from("example")});
  await page.locator(".juro-file-name").filter({hasText:"qualification.pdf"}).waitFor();
  await page.locator(".credential-upload").evaluate(form=>form.reset());
  await page.locator(".credential-upload .juro-file-name").filter({hasText:"Файл не выбран"}).waitFor();
  assert.equal(await page.locator('input[name="file"]').evaluate(input=>input.files.length),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
});
