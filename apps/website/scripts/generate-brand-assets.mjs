import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { searchPages } from "../content/search-pages.ts";
import { seoLandings } from "../content/seo-landings.ts";
import { knowledgeArticles } from "../content/knowledge.ts";

const require = createRequire(import.meta.url);
const { createElement: h } = require("react");
const { ImageResponse } = require("next/og");
const root = new URL("../../../", import.meta.url);
const website = new URL("../public/", import.meta.url);
const platform = new URL("apps/platform/public/", root);
const icon = "data:image/png;base64," + (await readFile(new URL("brand/juro-app-icon.png", website))).toString("base64");
const locales = ["ru", "uz", "en"];
const regions = { ru: "Право Узбекистана", uz: "O‘zbekiston huquqi", en: "Uzbekistan law" };
const entries = locales.flatMap(locale => [
  ...Object.entries(searchPages[locale]).map(([key, copy]) => ({ locale, key, ...copy })),
  ...Object.entries(seoLandings[locale]).map(([key, copy]) => ({ locale, key, title: copy.title, description: copy.description })),
  ...Object.entries(knowledgeArticles[locale]).map(([key, copy]) => ({ locale, key: "knowledge-" + key, title: copy.title, description: copy.description })),
]);
const characters = [...new Set((entries.map(copy => copy.title + copy.description).join("") + Object.values(regions).join("") + "JUROjuro.uz ").split(""))].sort().join("");
const fontCache = new URL(".scratch/public-brand-fonts/", root);
await mkdir(fontCache, { recursive: true });
const fontHash = createHash("sha256").update(characters).digest("hex").slice(0, 16);
const fonts = [];
for (const weight of [500, 700]) {
  const destination = new URL(`manrope-${weight}-${fontHash}.ttf`, fontCache);
  let data;
  try { data = await readFile(destination); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const cssUrl = new URL("https://fonts.googleapis.com/css");
    cssUrl.searchParams.set("family", "Manrope:" + weight);
    cssUrl.searchParams.set("text", characters);
    const cssResponse = await fetch(cssUrl, { headers: { "user-agent": "Mozilla/4.0" }, signal: AbortSignal.timeout(30000) });
    if (!cssResponse.ok) throw Error("Unable to load Manrope font stylesheet");
    const css = await cssResponse.text();
    const source = /src:\s*url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)\s*format\('truetype'\)/.exec(css)?.[1];
    if (!source) throw Error("Manrope static TrueType font is unavailable");
    const response = await fetch(source, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error("Unable to load Manrope font");
    data = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, data);
  }
  fonts.push({ name: "Manrope", data, weight, style: "normal" });
}

async function render(element, width, height) {
  return Buffer.from(await new ImageResponse(element, { width, height, fonts }).arrayBuffer());
}

function preview(copy) {
  const title = copy.title.replace(/^JURO\s*[—–-]\s*/, "");
  return h("div", { style: { display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "52px 64px", background: "#f8f6f2", color: "#062844", fontFamily: "Manrope", borderBottom: "12px solid #bd8a32" } },
    h("div", { style: { display: "flex", alignItems: "center", gap: 22 } },
      h("img", { src: icon, width: 76, height: 76, style: { borderRadius: 15 } }),
      h("div", { style: { fontSize: 48, fontWeight: 700, letterSpacing: -2 } }, "JURO")),
    h("div", { style: { display: "flex", flexDirection: "column", gap: 22, padding: "22px 0" } },
      h("div", { style: { fontSize: title.length > 65 ? 48 : 58, fontWeight: 700, lineHeight: 1.16, letterSpacing: -1.6 } }, title),
      h("div", { style: { fontSize: 25, fontWeight: 500, lineHeight: 1.4, color: "#41596a" } }, copy.description)),
    h("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 23, fontWeight: 700, borderTop: "1px solid #d7d9d7", paddingTop: 22 } },
      h("span", null, regions[copy.locale]), h("span", null, "juro.uz")));
}

let largest = 0;
for (const copy of entries) {
  const directory = new URL(`og/${copy.locale}/`, website);
  await mkdir(directory, { recursive: true });
  const bytes = await render(preview(copy), 1200, 630);
  largest = Math.max(largest, bytes.length);
  await writeFile(new URL(copy.key + ".png", directory), bytes);
}

const sizes = [32, 48, 96, 180, 192];
const icons = new Map();
for (const size of sizes) icons.set(size, await render(h("img", { src: icon, width: size, height: size }), size, size));
const packed = [32, 48, 96].map(size => ({ size, bytes: icons.get(size) }));
const header = Buffer.alloc(6 + packed.length * 16);
header.writeUInt16LE(1, 2); header.writeUInt16LE(packed.length, 4);
let offset = header.length;
for (const [index, entry] of packed.entries()) {
  const position = 6 + index * 16;
  header[position] = entry.size; header[position + 1] = entry.size;
  header.writeUInt16LE(1, position + 4); header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(entry.bytes.length, position + 8); header.writeUInt32LE(offset, position + 12);
  offset += entry.bytes.length;
}
const ico = Buffer.concat([header, ...packed.map(entry => entry.bytes)]);
for (const directory of [website, platform]) {
  await mkdir(new URL("brand/", directory), { recursive: true });
  await writeFile(new URL("favicon.ico", directory), ico);
  await writeFile(new URL("favicon.png", directory), icons.get(96));
  await writeFile(new URL("brand/juro-icon-96.png", directory), icons.get(96));
  await writeFile(new URL("brand/juro-icon-192.png", directory), icons.get(192));
  await writeFile(new URL("brand/juro-apple-touch-icon.png", directory), icons.get(180));
}
console.log(JSON.stringify({ previews: entries.length, width: 1200, height: 630, largestPreviewBytes: largest, faviconSizes: packed.map(entry => entry.size), output: fileURLToPath(website) }));
