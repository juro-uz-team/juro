import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

let browser, server, origin;
before(async () => {
  const bundle = await build({
    stdin: { resolveDir: fileURLToPath(new URL("../../", import.meta.url)), loader: "tsx", contents: `
      import {createRoot} from 'react-dom/client';
      import {useState} from 'react';
      import {Select} from './app/_components/Select';
      import {ThemeSwitcher} from './app/_theme/ThemeSwitcher';
      function App(){const [value,setValue]=useState('active');return <main>
        <ThemeSwitcher locale="en" compact persistAccount={false}/>
        <form onSubmit={e=>{e.preventDefault();document.querySelector('output').textContent=JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))}}>
          <label>Status<Select name="status" value={value} onChange={e=>setValue(e.target.value)}><option value="active">Active</option><option value="all">All</option><option value="open">Open</option><option value="closed">Completed</option><option value="disabled" disabled>Unavailable</option></Select></label>
          <label>Workspace<Select name="workspace" defaultValue="second"><option value="">None</option><option value="first">First workspace</option><option value="second">Second workspace</option></Select></label>
          <label>Required choice<Select name="required" defaultValue="" required><option value="">Choose one</option><option value="chosen">Chosen</option></Select></label>
          <label>Disabled<Select disabled><option>Unavailable</option></Select></label>
          <label>Long menu<Select name="long">{Array.from({length:50},(_,i)=><option key={i} value={i}>Option {i} — a longer label that wraps on small screens</option>)}</Select></label>
          <button type="submit">Submit</button><button type="reset">Reset</button><output/>
        </form>
        <button onClick={()=>document.querySelector('dialog').showModal()}>Open dialog</button>
        <dialog><label>Dialog choice<Select><option>First</option><option>Second</option></Select></label></dialog>
      </main>};createRoot(document.getElementById('root')).render(<App/>);`,
    }, bundle: true, write: false, jsx: "automatic",
  });
  const css = (await Promise.all(["globals.css", "_components/select.css", "_components/motion.css"].map(file => readFile(new URL(`../../app/${file}`, import.meta.url), "utf8")))).join("\n").replace('@import "tailwindcss";', "");
  server = createServer((req, res) => {
    if (req.url === "/bundle.js") { res.setHeader("content-type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}main{max-width:360px;margin:24px;padding:16px;background:var(--surface-raised)}form,label{display:grid;gap:12px}form{margin-top:20px}label{gap:4px}</style><div id="root"></div><script src="/bundle.js"></script></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: process.env.WORKSPACE_BROWSER_CHANNEL || undefined });
});
after(async () => { await browser?.close(); server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); });

test("shared select preserves keyboard, real change events, validation, form values and reset", async () => {
  const page = await browser.newPage();
  try {
    await page.goto(origin);
    const status = page.getByRole("combobox", { name: "Status" });
    await status.focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("End");
    await page.waitForFunction(() => document.activeElement?.textContent === "Completed");
    await page.keyboard.press("Enter");
    assert.match(await status.textContent(), /Completed/);
    await status.click();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
    assert.equal(await status.evaluate(e => e === document.activeElement), true);
    await status.click();
    await page.keyboard.type("Open");
    await page.waitForFunction(() => document.activeElement?.textContent === "Open");
    await page.keyboard.press("Enter");
    assert.match(await status.textContent(), /Open/);
    const workspace = page.getByRole("combobox", { name: "Workspace" });
    await workspace.click();
    await page.getByRole("option", { name: "None", exact: true }).click();
    assert.equal(await page.locator('select[name="workspace"]').inputValue(), "");
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    assert.equal(await page.getByRole("alert").count(), 1);
    const required = page.getByRole("combobox", { name: "Required choice" });
    assert.equal(await required.evaluate(e => e === document.activeElement), true);
    await required.click();
    await page.getByRole("option", { name: "Chosen", exact: true }).click();
    await page.getByRole("button", { name: "Submit", exact: true }).click();
    const data = JSON.parse(await page.locator("output").textContent());
    assert.equal(data.status, "open"); assert.equal(data.workspace, ""); assert.equal(data.required, "chosen");
    await page.getByRole("button", { name: "Reset", exact: true }).click();
    assert.match(await workspace.textContent(), /Second workspace/);
    assert.equal(await page.locator('select[name="workspace"]').inputValue(), "second");
    assert.match(await status.textContent(), /Open/);
    assert.equal(await page.locator('select[name="status"]').inputValue(), "open");
    assert.equal(await page.getByRole("combobox", { name: "Disabled", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "Open dialog" }).click();
    await page.getByRole("combobox", { name: "Dialog choice" }).click();
    await page.getByRole("option", { name: "Second", exact: true }).click();
    assert.match(await page.getByRole("combobox", { name: "Dialog choice" }).textContent(), /Second/);
    assert.equal(await page.locator("dialog").evaluate(e => e.open), true);
  } finally { await page.close(); }
});

test("theme toggle and menus remain readable and inside mobile and desktop viewports", async () => {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 800 } });
    try {
      await page.goto(origin);
      assert.equal(await page.locator(".theme-switcher button").count(), 1);
      for (const theme of ["light", "dark"]) {
        if (theme === "dark") await page.getByRole("button", { name: "Switch to dark theme" }).click();
        const themeBox = await page.locator(".theme-switcher button").boundingBox();
        assert.equal(themeBox.width, 44); assert.equal(themeBox.height, 44);
        await page.getByRole("combobox", { name: "Long menu" }).click();
        const box = await page.getByRole("listbox").boundingBox();
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 800);
        const contrast = await page.locator(".juro-select-menu").evaluate(el => {
          const l = color => color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s,v,i) => s + v * [.2126,.7152,.0722][i],0);
          const ratio = (a,b) => (Math.max(l(a),l(b))+.05)/(Math.min(l(a),l(b))+.05);
          const css = getComputedStyle(el);
          const field = getComputedStyle(document.querySelector('.juro-select'));
          const selected = getComputedStyle(el.querySelector('[data-state="checked"]'));
          return { menu: ratio(css.color,css.backgroundColor), field: ratio(field.color,field.backgroundColor), border: ratio(field.borderColor,field.backgroundColor), selected: ratio(selected.color,selected.backgroundColor) };
        });
        assert.ok(contrast.menu >= 4.5 && contrast.field >= 4.5 && contrast.selected >= 4.5);
        assert.ok(contrast.border >= 3);
        await page.keyboard.press("End");
        await page.waitForFunction(() => document.activeElement?.textContent?.startsWith("Option 49"));
        await page.keyboard.press("Enter");
        assert.equal(await page.locator('select[name="long"]').inputValue(), "49");
      }
      await page.getByRole("button", { name: "Switch to light theme" }).click();
      assert.equal(await page.evaluate(() => localStorage.getItem("juro-theme")), "light");
    } finally { await page.close(); }
  }
});
