import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";

test("the authenticated citation route executes pinned evidence and fragment fallbacks", async () => {
  await promisify(execFile)(process.execPath, ["--experimental-test-module-mocks",
    "--import", new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url).href,
    "--experimental-loader", new URL("../scripts/cloudflare-workers-loader.mjs", import.meta.url).href,
    fileURLToPath(new URL("./fixtures/citation-route-runtime.mts", import.meta.url))]);
});

test("citation endpoint is private, ownership-scoped and revalidates Lex or private document evidence", async () => {
  const route = await readFile(
    new URL("../app/api/platform/ai/citations/[messageId]/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /requireApiUser\(\)/);
  assert.match(route, /workspaceForUser\(user\)/);
  assert.match(route, /conversation\.workspace_id=\? AND conversation\.owner_user_id=\?/);
  assert.match(route, /citation_validation_status='validated'/);
  assert.match(route, /searchParams\.get\("article"\)/);
  assert.match(route, /normalizedArticle\(candidate\.articleReference\) === requestedArticle/);
  assert.match(route, /hostname === "lex\.uz" \|\| url\.hostname === "www\.lex\.uz"/);
  assert.doesNotMatch(route, /legal_corpus_variants/);
  assert.match(route, /assertCitationEvidenceIdentity/);
  assert.match(route, /fetchCitationEvidence/);
  assert.match(route, /availableLanguages/);
  assert.match(route, /versionHistory/);
  assert.match(route, /parsePrivateDocumentLocator\(sourceUrl\)/);
  assert.match(route, /user_document_vector_chunks/);
  assert.match(route, /job\.workspace_id=\?/);
  assert.match(route, /job\.owner_user_id=\?/);
  assert.match(route, /requireR2\(\)\.get\(privateDocument\.r2Key\)/);
  assert.match(route, /checksumHex\(object\.checksums\.sha256\) !== privateDocument\.sourceHash/);
  assert.match(route, /await sha256\(bytes\) !== privateDocument\.sourceHash/);
  assert.match(route, /privateSource: true/);
  assert.match(route, /text: citation\.excerpt, fullArticle: false, truncated: false, evidenceUnavailable: true/);
  assert.match(route, /cache-control": "private, no-store/);
  assert.doesNotMatch(route, /fetch\(/);
  assert.doesNotMatch(route, /dangerouslySetInnerHTML/);
});

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
