import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";

test("brand artwork follows theme and fixed surfaces without filters or layout shift", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {BrandImage} from './app/_components/BrandImage'; createRoot(document.getElementById('root')).render(<><section id="adaptive"><BrandImage alt="JURO" width={112} height={112}/></section><section id="fixed"><BrandImage tone="dark" mark width={40} height={48}/></section><section className="dbt-a4"><BrandImage mark width={18} height={18}/></section></>);`, resolveDir: root, loader: "tsx" }, bundle: true, write: false, jsx: "automatic" });
  const css = await readFile(root + "app/_components/brand.css", "utf8");
  const server = createServer(async (req, res) => {
    if (req.url.startsWith("/brand/")) {
      try { res.setHeader("Content-Type", "image/png"); res.end(await readFile(root + "public" + req.url)); }
      catch { res.writeHead(404); res.end(); }
    } else if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); }
    else { res.setHeader("Content-Type", "text/html"); res.end(`<html><style>${css}</style><div id="root"></div><script src="/bundle.js"></script></html>`); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: process.env.WORKSPACE_BROWSER_CHANNEL || undefined });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator("#adaptive img").first().waitFor();
    await page.locator("img").evaluateAll(images => Promise.all(images.map(image => image.decode())));
    let bounds;
    for (const theme of ["light", "dark", "light"]) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const image = page.locator("#adaptive img:visible");
      assert.equal(await image.count(), 1);
      assert.match(await image.getAttribute("src"), new RegExp(`on-${theme}\\.png$`));
      assert.equal(await image.evaluate(el => el.complete && el.naturalWidth > 0), true);
      assert.equal(await image.evaluate(el => getComputedStyle(el).filter), "none");
      const current = await image.boundingBox();
      if (bounds) assert.deepEqual(current, bounds);
      bounds = current;
      assert.match(await page.locator("#fixed img:visible").getAttribute("src"), /on-dark/);
      assert.match(await page.locator(".dbt-a4 img:visible").getAttribute("src"), /on-light/);
    }
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
