import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("root layout renders the canonical locale and keeps a local-development fallback", async () => {
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /headers\(\)/);
  assert.match(layout, /INTERNAL_REQUEST_PATH_HEADER/);
  assert.match(layout, /isLocale\(routeLocale\) \? routeLocale : "ru"/);
  assert.match(layout, /<html[\s\S]*?lang=\{initialLocale\}[\s\S]*?suppressHydrationWarning[\s\S]*?>/);
  assert.doesNotMatch(layout, /<body[^>]*suppressHydrationWarning/);
  const bootstrap = await readFile(new URL("../app/_theme/DocumentBootstrap.tsx", import.meta.url), "utf8");
  assert.match(layout, /<DocumentBootstrap\s*\/>/);
  assert.match(bootstrap, /useServerInsertedHTML/);
  assert.match(bootstrap, /location\.pathname\.match\(\/\^\\\\\/\(ru\|uz\|en\)/);
  assert.match(bootstrap, /document\.documentElement\.lang=m\?m\[1\]:\(q==="uz"\?"uz":q==="en"\?"en":"ru"\)/);
});

test("localized platform metadata is complete in RU, UZ, and EN", async () => {
  const layout = await readFile(new URL("../app/[locale]/layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /ru:\s*\{[\s\S]*?защищённое юридическое пространство/u);
  assert.match(layout, /uz:\s*\{[\s\S]*?himoyalangan huquqiy ish maydoni/u);
  assert.match(layout, /en:\s*\{[\s\S]*?secure legal workspace/u);
  assert.match(layout, /isLocale\(locale\)/);
});
