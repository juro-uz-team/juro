import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

let browser;
let css;
before(async () => {
  const files = [
    "globals.css", "_components/motion.css", "_platform/platform-shell.css",
    "_platform/ai-lawyer-phase4.css", "_platform/ai-document-prefill.css",
    "_platform/ai-evidence.css", "_platform/ai-lawyer.css",
    "_platform/profile-settings.css", "_platform/calendar.css",
    "_platform/action-plan.css",
    "invite/invite.css", "onboarding/onboarding.css", "_guest/guest-ai.css",
    "_document-builder/document-builder.css", "_auth/auth.css",
    "_platform/consultations-phase7.css", "_staff/legal-source-reviews.css",
  ];
  css = (await Promise.all(files.map(file => readFile(
    new URL(`../../app/${file}`, import.meta.url), "utf8",
  )))).join("\n").replace('@import "tailwindcss";', "");
  browser = await chromium.launch({ channel: process.env.WORKSPACE_BROWSER_CHANNEL || undefined });
});
after(async () => { await browser?.close(); });

// These specimens exercise the production cascade, including later overrides.
const specimens = `
  <div class="platform-shell" style="display:block"><nav class="platform-mobile-nav" style="position:static;display:flex"><a class="active"><span data-check>Home</span></a></nav></div>
  <div class="ai-conversation-list"><p data-check>History appears after your first question.</p></div>
  <button class="ai-new" data-check>New question</button>
  <div class="ai-voice-controls"><p data-check>Microphone starts only when requested.</p></div>
  <div class="profile-workspace"><form class="profile-form"><button data-check>Save changes</button></form></div>
  <div class="scenario-pills"><button data-check>Employment</button><button class="active" data-check>Housing</button></div>
  <header class="plan-heading"><h1 data-check>Your action plan</h1><p data-check>Connect steps, deadlines, and documents.</p></header>
  <div class="calendar-header"><h1 data-check>Calendar</h1><p data-check>Upcoming deadlines</p></div>
  <button class="plan-primary" data-check>Create plan</button>
  <div class="today"><strong data-check>Today</strong></div>
  <div class="ai-document-prefill"><footer><button data-check>Use document</button></footer></div>
  <div class="ai-feedback-form"><button data-check>Send feedback</button></div>
  <div class="ai-source-bookmark"><button data-check>Save citation</button></div>
  <div class="ai-human-message"><small data-check>Your question</small><p data-check>What should I prepare?</p></div>
  <span class="risk risk-high" data-check>High risk</span>
  <span class="risk risk-medium" data-check>Medium risk</span>
  <span class="risk risk-low" data-check>Low risk</span>
  <span class="icon-btn"><i data-check>2</i></span>
  <div class="completed"><span class="step-check" data-check>✓</span></div>
  <button class="btn btn-primary" data-check>Continue</button>
  <button class="btn btn-secondary" data-check>Cancel</button>
  <div class="invite-accept"><section><small data-check>Workspace invitation</small><p data-check>Join your legal team.</p><div class="invite-status accepted" data-check>Invitation accepted</div><div class="invite-status error" data-check>Invitation expired</div><button data-check>Join workspace</button></section></div>
  <div class="onboarding-card"><div class="onboarding-copy"><h1 data-check>Welcome to JURO</h1><p data-check>Set up your workspace.</p></div></div>
  <button class="onboarding-submit" data-check>Continue setup</button>
  <button class="dbt-start" data-check>Create document</button>
  <header class="dbt-library-hero"><h1 data-check>Document library</h1><p data-check>Prepare your legal documents</p><div class="dbt-library-summary"><strong data-check>623</strong><small data-check>Available templates</small></div></header>
  <div class="dbt-success-hero"><span data-check>✓</span></div>
  <button class="auth-submit" data-check>Sign in</button>
  <div class="staff-sync"><button data-check>Sync sources</button></div>
  <a class="lawyer-phone-link" data-check>Contact lawyer</a>
  <div class="guest-ai-workspace"><form class="guest-ai-form"><label data-check>Your question</label><button data-check>Ask JURO</button></form></div>
`;

async function contrastFailures(page) {
  return page.locator("[data-check]").evaluateAll(elements => {
    const channels = value => {
      const values = value.match(/[\d.]+/g).map(Number);
      return value.startsWith("color(srgb")
        ? values.map((number, index) => index < 3 ? number * 255 : number)
        : values;
    };
    const luminance = color => color.slice(0, 3).reduce((sum, value, index) => {
      const channel = value / 255;
      const linear = channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      return sum + linear * [.2126, .7152, .0722][index];
    }, 0);
    return elements.flatMap(element => {
      const layers = [];
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        // Do not silently claim contrast coverage for unmeasured gradients.
        if (style.backgroundImage !== "none") return [{ text: element.textContent, error: "Gradient requires visual verification" }];
        layers.push(channels(style.backgroundColor));
      }
      const background = layers.reverse().reduce((below, above) => {
        const alpha = above[3] ?? 1;
        return below.map((value, index) => above[index] * alpha + value * (1 - alpha));
      }, [255, 255, 255]);
      const values = [luminance(channels(getComputedStyle(element).color)), luminance(background)].sort((a, b) => b - a);
      const ratio = (values[0] + .05) / (values[1] + .05);
      return ratio >= 4.5 ? [] : [{ text: element.textContent, ratio }];
    });
  });
}

for (const theme of ["light", "dark"]) {
  test(`${theme} theme keeps text and actions readable through the production cascade`, async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(`<html data-theme="${theme}"><style>${css}</style><body>${specimens}</body></html>`);
      assert.deepEqual(await contrastFailures(page), []);
      const actionColors = await page.locator(".ai-new, .btn-primary, .dbt-start, .auth-submit, .staff-sync button, .lawyer-phone-link").evaluateAll(elements => elements.map(element => getComputedStyle(element).backgroundColor));
      assert.ok(actionColors.every(color => color === actionColors[0]), "Primary actions share one brand color across modules");
      assert.equal(actionColors[0], theme === "dark" ? "rgb(73, 70, 56)" : "rgb(243, 236, 223)");
      const weights = await page.locator(".ai-new, .btn-primary, .dbt-start, .auth-submit, .staff-sync button, .lawyer-phone-link").evaluateAll(elements => elements.map(element => ({ weight: getComputedStyle(element).fontWeight, shadow: getComputedStyle(element).boxShadow })));
      assert.ok(weights.every(style => style.weight === "600" && style.shadow === "none"), "Actions have consistent medium weight without raised shadows");
      for (const selector of [".btn-primary", ".btn-secondary", ".ai-new", ".scenario-pills button"]) {
        await page.locator(selector).first().hover();
        await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState === "finished"));
        assert.deepEqual(await contrastFailures(page), [], `Hover: ${selector}`);
      }
      await page.locator(".btn-primary").focus();
      assert.notEqual(await page.locator(".btn-primary").evaluate(element => getComputedStyle(element).outlineStyle), "none");
      const historyColor = await page.locator(".ai-conversation-list > p").evaluate(element => getComputedStyle(element).backgroundColor);
      assert.equal(historyColor, theme === "dark" ? "rgb(44, 59, 72)" : "rgb(255, 255, 255)");
      await page.evaluate(() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "light" ? "dark" : "light"; });
      await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState === "finished"));
      assert.deepEqual(await contrastFailures(page), [], "Switching themes must update both surfaces and text");
    } finally {
      await page.close();
    }
  });
}
