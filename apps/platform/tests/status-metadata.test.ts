import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  publicStatusMetadata,
  STATUS_ORIGIN_HEADER,
} from "../lib/operations/status-metadata";

test("status metadata keeps icons on each trusted status origin", () => {
  for (const origin of [
    "https://status.juro.uz",
    "https://STATUS.JURO.UZ:443",
    "https://status.staging.juro.uz",
    "http://status.localhost:8787",
  ]) {
    const metadata = publicStatusMetadata(origin);
    const expectedOrigin = new URL(origin).origin;
    assert.equal(metadata.metadataBase.href, `${expectedOrigin}/`);
    assert.equal(metadata.icons.icon.href, `${expectedOrigin}/favicon.png`);
    assert.equal(metadata.icons.shortcut.href, `${expectedOrigin}/favicon.png`);
    assert.equal(metadata.icons.apple.href, `${expectedOrigin}/apple-touch-icon.png`);
  }
});

test("status metadata fails closed to the application origin for untrusted origins", () => {
  for (const origin of [
    null,
    "",
    "https://app.juro.uz",
    "https://status.juro.uz.evil.example",
    "https://status.juro.uz@evil.example",
    "https://status.juro.uz.",
    "http://status.juro.uz",
    "https://status.juro.uz/path",
    "not a host",
  ]) {
    const metadata = publicStatusMetadata(origin);
    assert.equal(metadata.metadataBase.href, "https://app.juro.uz/");
    assert.equal(metadata.icons.icon.href, "https://app.juro.uz/favicon.png");
    assert.equal(metadata.robots.index, false);
    assert.equal(metadata.robots.follow, false);
  }
});

test("every status page derives metadata from the Worker-owned status origin", async () => {
  for (const relativePath of [
    "../app/[locale]/status/page.tsx",
    "../app/status/page.tsx",
  ]) {
    const page = await readFile(new URL(relativePath, import.meta.url), "utf8");
    assert.match(page, /import \{ headers \} from "next\/headers"/u);
    assert.match(page, /export async function generateMetadata\([\s\S]*?\): Promise<Metadata>/u);
    assert.match(page, /publicStatusMetadata\(\s*requestHeaders\.get\(STATUS_ORIGIN_HEADER\),/u);
    assert.doesNotMatch(page, /export const metadata:/u);
  }
});

test("private native server strips untrusted status-origin metadata", async () => {
  const server = await readFile(new URL("../server/index.ts", import.meta.url), "utf8");
  assert.match(server, /name === STATUS_ORIGIN_HEADER/u);
  assert.match(server, /delete request.headers\[name\]/u);
  assert.equal(STATUS_ORIGIN_HEADER, "x-juro-status-origin");
});
