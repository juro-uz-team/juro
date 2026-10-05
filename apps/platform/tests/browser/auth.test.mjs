import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";
import { createChallenge } from "altcha-lib/v1";

let browser, server, origin;
before(async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  // Only Next's routing/image adapters are substituted; the form, React state,
  // challenge widget and browser fetch/navigation are the production code.
  const bundle = await build({
    stdin: {
      contents: `import {createRoot} from 'react-dom/client';
        import {AuthForm} from './app/_auth/AuthForm';
        const query = new URLSearchParams(location.search);
        createRoot(document.getElementById('root')).render(<AuthForm
          mode="login" initialLocale={query.get('locale') || 'en'}
          passwordAuthEnabled emailAuthEnabled
          turnstileSiteKey={query.get('challenge') || 'private-local'} />);`,
      resolveDir: root, loader: "tsx",
    },
    bundle: true, write: false, jsx: "automatic",
    plugins: [{ name: "next-adapters", setup(builder) {
      builder.onResolve({ filter: /^next\/(navigation|image|link)$/ }, args => ({ path: args.path, namespace: "adapter" }));
      builder.onLoad({ filter: /.*/, namespace: "adapter" }, args => ({
        contents: args.path.endsWith("navigation")
          ? `export const usePathname=()=>'/en/auth/login'; export const useSearchParams=()=>new URLSearchParams(location.search);`
          : `import React from 'react'; export default function Adapter({children,...props}) {return React.createElement('${args.path.endsWith("image") ? "img" : "a"}',props,children)}`,
        loader: "js", resolveDir: root,
      }));
    } }],
  });
  server = createServer((request, response) => {
    if (request.headers["x-test-stalled-body"] === "1") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"redirectTo":');
      return;
    }
    response.setHeader("Content-Type", request.url === "/bundle.js" ? "text/javascript" : "text/html");
    response.end(request.url === "/bundle.js" ? bundle.outputFiles[0].text
      : '<div id="root"></div><script src="/bundle.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.AUTH_BROWSER_CHANNEL || undefined });
});
after(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise(resolve => server ? server.close(resolve) : resolve());
});

async function loginPage(context, query = "") {
  const page = await browser.newPage();
  context.after(() => page.close());
  await page.goto(origin + query);
  await page.locator("#auth-email").fill("person@gmail.com");
  await page.locator("#auth-password").fill("correct-password");
  return page;
}

test("a stalled sign-in shows an error and permits a successful retry", async context => {
  const page = await loginPage(context);
  let attempts = 0;
  await page.route("**/api/auth/password-login", async route => {
    attempts++;
    if (attempts === 1) return; // Network accepts the request but never responds.
    await route.fulfill({ json: { redirectTo: "/en/individual/dashboard" } });
  });
  await page.clock.install();
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.clock.fastForward(61_000);
  await page.getByRole("alert").waitFor({ timeout: 2000 });
  assert.match(await page.getByRole("alert").innerText(), /timed out/i);
  assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/en/individual/dashboard");
});

test("a stalled security check offers retry and then enables sign-in", async context => {
  const page = await browser.newPage();
  context.after(() => page.close());
  let attempts = 0;
  await page.route("**/api/auth/challenge?*", async route => {
    attempts++;
    if (attempts === 1) return;
    await route.fulfill({ json: await createChallenge({ algorithm: "SHA-256", hmacKey: "test-only", maxnumber: 10,
      expires: new Date(Date.now() + 300_000) }) });
  });
  await page.clock.install();
  await page.goto(origin + "?challenge=native-altcha");
  await page.locator("#auth-email").fill("person@gmail.com");
  await page.locator("#auth-password").fill("correct-password");
  await page.waitForFunction(() => document.querySelector("altcha-widget")?.getState() === "verifying");
  await page.clock.fastForward(61_000);
  await page.getByRole("button", { name: "Retry security check" }).click({ timeout: 2000 });
  await page.waitForFunction(() => !document.querySelector(".auth-submit").disabled);
  assert.equal(attempts, 2);
});

test("a response that stalls after its headers also times out", async context => {
  const page = await loginPage(context);
  await page.route("**/api/auth/password-login", route => route.continue({
    headers: { ...route.request().headers(), "x-test-stalled-body": "1" },
  }));
  await page.clock.install();
  const headers = page.waitForResponse("**/api/auth/password-login");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await headers;
  await page.clock.fastForward(31_000);
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /timed out/i);
  assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
});

test("a failed security check can be retried with a fresh verified challenge", async context => {
  const page = await browser.newPage();
  context.after(() => page.close());
  let attempts = 0;
  await page.route("**/api/auth/challenge?*", async route => {
    if (++attempts === 1) return route.abort("failed");
    await route.fulfill({ json: await createChallenge({ algorithm: "SHA-256", hmacKey: "test-only",
      maxnumber: 10, expires: new Date(Date.now() + 300_000) }) });
  });
  await page.goto(origin + "?challenge=native-altcha");
  await page.locator("#auth-email").fill("person@gmail.com");
  await page.locator("#auth-password").fill("correct-password");
  await page.getByRole("button", { name: "Retry security check" }).click();
  await page.waitForFunction(() => !document.querySelector(".auth-submit").disabled);
  assert.equal(attempts, 2);
});

test("a network failure shows actionable feedback and allows retry", async context => {
  const page = await loginPage(context);
  await page.route("**/api/auth/password-login", route => route.abort("failed"));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /check your connection/i);
  assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
});

test("mobile keyboard submission sends credentials and follows the successful redirect", async context => {
  const page = await loginPage(context);
  await page.setViewportSize({ width: 375, height: 812 });
  let submitted;
  await page.route("**/api/auth/password-login", async route => {
    submitted = route.request().postDataJSON();
    await route.fulfill({ json: { redirectTo: "/en/individual/dashboard" } });
  });
  await page.locator("#auth-password").press("Enter");
  await page.waitForURL("**/en/individual/dashboard");
  assert.equal(submitted.email, "person@gmail.com");
  assert.equal(submitted.password, "correct-password");
  assert.equal(submitted.turnstileToken, "private-local");
});

for (const scenario of [
  { name: "incorrect credentials", status: 401, json: { error: "Check your email and password." } },
  { name: "rate limiting", status: 429, json: { error: "Too many sign-in attempts. Try again later." } },
  { name: "expired security challenge", status: 400, json: { error: "The security check could not be verified. Try again." } },
  { name: "server error", status: 502, body: "Bad gateway" },
  { name: "unsafe redirect", status: 200, json: { redirectTo: "https://untrusted.example/" } },
]) {
  test(`${scenario.name} displays feedback and unlocks the form`, async context => {
    const page = await loginPage(context);
    await page.route("**/api/auth/password-login", route => route.fulfill(scenario));
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.ok((await page.getByRole("alert").innerText()).length > 0);
    assert.equal(await page.getByRole("button", { name: "Sign in", exact: true }).isEnabled(), true);
    assert.equal(new URL(page.url()).origin, origin);
  });
}

test("verified credentials advance to MFA and then navigate on success", async context => {
  const page = await loginPage(context);
  await page.route("**/api/auth/password-login", route => route.fulfill({ json: { requiresTwoFactor: true } }));
  await page.route("**/api/auth/verify-mfa", route => route.fulfill({ json: { redirectTo: "/en/individual/dashboard" } }));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.locator('[name="mfa-code"]').fill("123456");
  await page.getByRole("button", { name: "Finish sign-in" }).click();
  await page.waitForURL("**/en/individual/dashboard");
});

test("unverified email opens the verification recovery flow", async context => {
  const page = await loginPage(context);
  await page.route("**/api/auth/password-login", route => route.fulfill({ status: 403, json: { code: "EMAIL_NOT_VERIFIED" } }));
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: "Send a new code" }).waitFor();
});
