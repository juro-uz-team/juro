import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";





test("AI source cards expose a safe full-text modal and official URL separately", async () => {
  const client = await readFile(
    new URL("../app/_platform/AiLawyerClient.tsx", import.meta.url),
    "utf8",
  );
  assert.match(client, /function LegalSourceCard/);
  assert.match(client, /role="dialog" aria-modal="true"/);
  assert.match(client, /api\/platform\/ai\/citations\/\$\{encodeURIComponent\(messageId\)\}/);
  assert.match(client, /query\.set\("article", source\.article\)/);
  assert.match(client, /target="_blank" rel="noreferrer"/);
  assert.match(client, /event\.key === "Escape"/);
  assert.match(client, /Тип документа/);
  assert.match(client, /Принявший орган/);
  assert.match(client, /Доступные языки/);
  assert.match(client, /История редакций/);
  assert.match(client, /function isTrustedPrivateSource/);
  assert.match(client, /JURO · PRIVATE DOCUMENT/);
  assert.match(client, /Доступ и целостность файла проверены/);
  assert.match(client, /!privateSource && <a href=\{source\.originalUrl\}/);
  assert.match(client, /!privateSource && !secondarySource && <SourceBookmarkControl/);
  assert.doesNotMatch(client, /dangerouslySetInnerHTML/);
});
