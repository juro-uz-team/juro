import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellSource = new URL("../app/_platform/PlatformShell.tsx", import.meta.url);
const stylesheet = new URL("../app/_platform/platform-shell.css", import.meta.url);
const comparisonEntry = new URL("../app/[locale]/[accountType]/documents/comparisons/page.tsx", import.meta.url);
const legacyBusinessComparisonEntry = new URL("../app/[locale]/business/documents/comparisons/page.tsx", import.meta.url);
const businessComparisonEntry = new URL("../app/[locale]/business/[workspaceId]/documents/comparisons/page.tsx", import.meta.url);

test("comparison entry always opens comparison mode instead of the document route", async () => {
  const [shell, css, entry, legacyEntry, businessEntry] = await Promise.all([
    readFile(shellSource, "utf8"),
    readFile(stylesheet, "utf8"),
    readFile(comparisonEntry, "utf8"),
    readFile(legacyBusinessComparisonEntry, "utf8"),
    readFile(businessComparisonEntry, "utf8"),
  ]);

  assert.match(shell, /const documentNav = \[/);
  assert.match(shell, /\["documents", Files, "Мои документы", "Mening hujjatlarim", "My documents"\]/);
  assert.match(shell, /\["document-builder", FilePenLine, "Создать документ", "Hujjat yaratish", "Create a document"\]/);
  assert.match(shell, /\["document-review", FileCheck2, "Проверить документ", "Hujjatni tekshirish", "Review a document"\]/);
  assert.match(
    shell,
    /\[\s*"document-review\?mode=compare",\s*Files,\s*"Сравнить версии",\s*"Versiyalarni solishtirish",\s*"Compare versions",?\s*\]/,
  );
  assert.doesNotMatch(shell, /\["documents\/comparisons", Files, "Сравнить версии", "Versiyalarni solishtirish"\]/);
  assert.match(shell, /const \[route, query\] = slug\.split\("\?"\)/);
  assert.match(shell, /new URLSearchParams\(query\)/);
  assert.match(shell, /searchParams\.get\(key\) === value/);
  assert.match(entry, /redirect\(`\/\$\{locale\}\/\$\{accountType\}\/document-review\?mode=compare`\)/);
  assert.match(legacyEntry, /redirectLegacyBusinessRoute\(locale, \["document-review"\], \{ mode: "compare" \}\)/);
  assert.match(businessEntry, /\/document-review\?mode=compare/);
  assert.match(css, /\.platform-nav-documents summary,\.platform-nav-more summary\{display:flex;min-height:44px/);
  assert.match(css, /\.platform-nav-documents\.is-active>summary\{box-shadow:none\}/);
  assert.doesNotMatch(css, /platform-nav-documents[^\n]*transition:/);
});
