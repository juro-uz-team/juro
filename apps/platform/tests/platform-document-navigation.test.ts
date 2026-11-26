import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellSource = new URL("../app/_platform/PlatformShell.tsx", import.meta.url);
const stylesheet = new URL("../app/_platform/platform-shell.css", import.meta.url);
const comparisonEntry = new URL("../app/[locale]/[accountType]/documents/comparisons/page.tsx", import.meta.url);
const legacyBusinessComparisonEntry = new URL("../app/[locale]/business/documents/comparisons/page.tsx", import.meta.url);
const businessComparisonEntry = new URL("../app/[locale]/business/[workspaceId]/documents/comparisons/page.tsx", import.meta.url);

test("comparison has a dedicated authenticated entry in each workspace", async () => {
  const [shell, css, entry, legacyEntry, businessEntry] = await Promise.all([
    readFile(shellSource, "utf8"),
    readFile(stylesheet, "utf8"),
    readFile(comparisonEntry, "utf8"),
    readFile(legacyBusinessComparisonEntry, "utf8"),
    readFile(businessComparisonEntry, "utf8"),
  ]);

  assert.match(shell, /const documentNav = \[/);
  assert.match(shell, /\["documents", Files, "Мои документы", "Mening hujjatlarim", "My documents"\]/);
  assert.match(shell, /\["document-builder", FilePenLine, "Библиотека шаблонов"/);
  assert.match(shell, /\["contacts", BookUser, "Контакты"/);
  assert.match(shell, /\["document-review", FileCheck2, "Проверить документ", "Hujjatni tekshirish", "Review a document"\]/);
  assert.ok(shell.includes('"documents/comparisons"'));
  assert.doesNotMatch(shell, /document-review\?mode=compare/);
  for (const page of [entry, businessEntry]) {
    assert.match(page, /requireChatGPTUser/);
    assert.match(page, /<DocumentComparisonClient locale=\{locale\}/);
  }
  assert.ok(legacyEntry.includes('["documents", "comparisons"]'));
  assert.match(css, /\.platform-nav-documents summary,\.platform-nav-more summary\{display:flex;min-height:44px/);
  assert.match(css, /\.platform-nav-documents\.is-active>summary\{box-shadow:none\}/);
  assert.doesNotMatch(css, /platform-nav-documents[^\n]*transition:/);
});

test("library selections reach both tools through permission-checked document files", async () => {
  const [documents, inputs, snapshot] = await Promise.all([
    readFile(new URL("../app/_document-builder/documents/DocumentsClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_platform/document-tools.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/document-builder/documents/[id]/tool-file/route.ts", import.meta.url), "utf8"),
  ]);
  assert.ok(documents.includes("first: selection[0].source"));
  assert.ok(documents.includes("second: selection[1].source"));
  assert.ok(documents.includes("?source="));
  assert.match(inputs, /controller.abort\(\)/);
  assert.match(snapshot, /!access\?\.canView \|\| !access.canDownload/);
  assert.ok(snapshot.indexOf("!access.canDownload") < snapshot.indexOf("SELECT final_content"));
});
