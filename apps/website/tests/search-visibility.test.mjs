import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { startNativePlatform } from "../../platform/tests/helpers/native-server.mjs";

const require = createRequire(new URL("../../platform/package.json", import.meta.url));
const { parse } = await import(pathToFileURL(require.resolve("parse5")));
const sharp = require("sharp");
const attributes = node => Object.fromEntries((node.attrs || []).map(item => [item.name, item.value]));
function find(node, predicate, result = []) { if (predicate(node)) result.push(node); for (const child of node.childNodes || []) find(child, predicate, result); return result; }
const text = node => node.nodeName === "#text" ? node.value : (node.childNodes || []).map(text).join("");
function document(html) {
  const root = parse(html), links = find(root, node => node.tagName === "link").map(attributes);
  const meta = Object.fromEntries(find(root, node => node.tagName === "meta").map(node => { const item = attributes(node); return [item.name || item.property, item.content]; }));
  return { root, links, meta, title: find(root, node => node.tagName === "title").map(text), canonical: links.find(item => item.rel === "canonical")?.href };
}
const editorial = { slug: "published-guide", title: "Published guide", description: "A useful published page about the service and available tools.", body: "This is a published service guide for this isolated website fixture.", image: null, seo_title: null, seo_description: null };
let platform, native, platformPort;
const savedEnvironment = Object.fromEntries(["ADMIN_INTERNAL_TOKEN", "JURO_PUBLIC_PLATFORM_ORIGIN", "PORT", "APP_URL", "NEXT_PUBLIC_PLATFORM_ORIGIN", "PRIVATE_DEVELOPMENT", "DEPLOYMENT_ENVIRONMENT"].map(key => [key, process.env[key]]));
before(async () => {
  delete process.env.JURO_PUBLIC_PLATFORM_ORIGIN;
  delete process.env.DEPLOYMENT_ENVIRONMENT;
  process.env.ADMIN_INTERNAL_TOKEN = "isolated-site-content-fixture";
  platform = createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    response.setHeader("content-type", "application/json");
    let result;
    if (url.pathname === "/api/internal/admin/site-content/published") {
      assert.equal(request.headers["x-juro-admin-internal-token"], "isolated-site-content-fixture");
      const locale = url.searchParams.get("locale"), kind = url.searchParams.get("kind");
      result = kind === "page" && ["en", "ru"].includes(locale) ? [editorial] : kind === "news" && locale === "en" ? [{ ...editorial, slug: "service-update" }] : [];
    } else { response.writeHead(404); response.end("{}"); return; }
    response.end(JSON.stringify(result));
  });
  await new Promise(resolve => platform.listen(0, "127.0.0.1", resolve));
  platformPort = platform.address().port;
  native = await startNativePlatform(3389, "website", { platformPort });
});
after(async () => {
  await native?.stop();
  await new Promise(resolve => platform.close(resolve));
  for (const [key, value] of Object.entries(savedEnvironment)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("every discoverable public page has consistent metadata, language links and a real preview", async () => {
  const xml = await (await fetch(native.origin + "/sitemap.xml")).text();
  const urls = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
  assert.equal(new Set(urls).size, urls.length);
  assert.equal(urls.length, 42, "39 product/editorial pages, two published pages and one news edition");
  assert.doesNotMatch(xml, /\/lawyers|\/legal\/|<priority>|<changefreq>/);
  assert.match(xml, /<lastmod>2026-07-26<\/lastmod>/);
  const pages = new Map(), images = new Map();
  for (const url of urls) {
    const path = new URL(url).pathname;
    const response = await fetch(native.origin + path);
    assert.equal(response.status, 200, path);
    const html = await response.text(), page = document(html);
    pages.set(url, page);
    assert.equal(page.canonical, url, path);
    assert.equal(page.title.length, 1, path);
    assert.equal((page.title[0].match(/\bJURO\b/g) || []).length, 1, path);
    assert.ok(page.meta.description?.length > 20, path);
    assert.equal(attributes(find(page.root, node => node.tagName === "html")[0]).lang, path.split("/")[1], path);
    assert.equal(find(page.root, node => node.tagName === "h1").length, 1, path);
    const snippetExclusions = find(page.root, node => Object.hasOwn(attributes(node), "data-nosnippet"));
    assert.ok(snippetExclusions.length >= 3, path);
    for (const node of snippetExclusions) assert.ok(["span", "div", "section"].includes(node.tagName), "Google-supported snippet exclusion: " + path);
    if (/^\/(ru|uz|en)$/.test(path)) {
      const hero = find(page.root, node => attributes(node)["aria-labelledby"] === "homepage-title")[0];
      assert.ok(hero, path);
      assert.match(text(hero), /AI/);
      assert.match(text(hero), /Uzbekistan|Узбекистан|O‘zbekiston/i);
    }
    assert.doesNotMatch(page.meta.robots, /noindex/, path);
    assert.doesNotMatch(page.meta.googlebot, /noindex/, path);
    assert.match(page.meta.googlebot, /max-image-preview:large/, path);
    assert.equal(page.meta["og:url"], url, path);
    assert.equal(page.meta["og:site_name"], "JURO", path);
    assert.equal(page.meta["og:title"], page.title[0], path);
    assert.equal(page.meta["og:image:width"], "1200", path);
    assert.equal(page.meta["og:image:height"], "630", path);
    assert.equal(page.meta["twitter:card"], "summary_large_image", path);
    assert.ok(page.links.some(link => link.hreflang === path.split("/")[1] && link.href === url), path);
    for (const script of find(page.root, node => node.tagName === "script" && attributes(node).type === "application/ld+json")) JSON.parse(text(script));
    images.set(page.meta["og:image"], new URL(page.meta["og:image"]).pathname);
  }
  for (const [url, page] of pages) for (const alternate of page.links.filter(link => link.hreflang)) {
    assert.ok(pages.has(alternate.href), alternate.href);
    assert.ok(pages.get(alternate.href).links.some(link => link.hreflang === new URL(url).pathname.split("/")[1] && link.href === url), url + " reciprocal alternate");
  }
  for (const path of images.values()) {
    const response = await fetch(native.origin + path);
    assert.equal(response.status, 200, path);
    assert.match(response.headers.get("content-type"), /^image\/png/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length < 160000, path);
    const size = await sharp(bytes).metadata();
    assert.equal(size.width, 1200, path); assert.equal(size.height, 630, path);
  }
});

test("legal previews stay out of search and retired lawyer catalogue routes return 404", async () => {
  for (const path of ["/ru/legal/legal-information", "/en/legal/legal-information", "/ru/news"]) {
    const response = await fetch(native.origin + path);
    assert.equal(response.status, 200, path);
    const page = document(await response.text());
    assert.match(page.meta.robots, /noindex/, path);
    assert.match(page.meta.googlebot, /noindex/, path);
    assert.ok(page.meta["og:image"], path);
  }
  for (const path of ["/xx/document-builder", "/en/missing-search-page", "/uz/pages/published-guide",
    ...["ru", "uz", "en"].flatMap(locale => [`/${locale}/lawyers`, `/${locale}/lawyers/retired-profile`]),
  ]) {
    const response = await fetch(native.origin + path);
    assert.equal(response.status, 404, path);
    assert.match(document(await response.text()).meta.robots, /noindex/, path);
  }
});

test("staging serves noindex metadata, a closed robots file and an empty sitemap", async () => {
  const previous = process.env.DEPLOYMENT_ENVIRONMENT;
  process.env.DEPLOYMENT_ENVIRONMENT = "staging";
  const staging = await startNativePlatform(3390, "website", { platformPort });
  try {
    const response = await fetch(staging.origin + "/en/document-builder");
    const page = document(await response.text());
    assert.match(page.meta.robots, /noindex/);
    assert.match(page.meta.googlebot, /noindex/);
    assert.match(response.headers.get("x-robots-tag"), /noindex/);
    assert.match(await (await fetch(staging.origin + "/robots.txt")).text(), /Disallow: \/\n/);
    assert.doesNotMatch(await (await fetch(staging.origin + "/sitemap.xml")).text(), /<loc>/);
  } finally {
    await staging.stop();
    if (previous === undefined) delete process.env.DEPLOYMENT_ENVIRONMENT; else process.env.DEPLOYMENT_ENVIRONMENT = previous;
  }
});

test("the browser, search favicon, Apple icon and manifest use correctly sized brand assets", async () => {
  const page = document(await (await fetch(native.origin + "/en")).text());
  const icon = page.links.find(link => link.rel === "icon" && link.type === "image/png");
  assert.equal(icon.sizes, "96x96");
  const apple = page.links.find(link => link.rel === "apple-touch-icon");
  for (const [path, expected] of [[icon.href, 96], [apple.href, 180]]) {
    const response = await fetch(native.origin + path);
    assert.equal(response.status, 200);
    const size = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
    assert.equal(size.width, expected); assert.equal(size.height, expected);
  }
  const ico = Buffer.from(await (await fetch(native.origin + "/favicon.ico")).arrayBuffer());
  assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 3);
  assert.deepEqual([ico[6], ico[22], ico[38]], [32, 48, 96]);
  const manifest = await (await fetch(native.origin + "/manifest.webmanifest")).json();
  for (const entry of manifest.icons) {
    const bytes = Buffer.from(await (await fetch(native.origin + entry.src)).arrayBuffer());
    const size = await sharp(bytes).metadata();
    assert.equal(entry.sizes, size.width + "x" + size.height);
  }
});
