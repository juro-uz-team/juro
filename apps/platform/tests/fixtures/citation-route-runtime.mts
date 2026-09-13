import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {DatabaseSync, type SQLInputValue} from "node:sqlite";
import {mock, test} from "node:test";
import {z} from "zod";
import type {CitationEvidenceReceipt} from "../../lib/legal-corpus/citation-evidence";

const root = new URL("../../", import.meta.url);
const messageId = "10000000-0000-4000-8000-000000000001";
const officialUrl = "https://lex.uz/ru/docs/777";
const savedFragment = "Saved fragment of the pinned provision.";
const fullText = `Article 7. ${"Complete pinned provision. ".repeat(80)}`;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const receipt: CitationEvidenceReceipt = {version: 1, capability: "current", kind: "normalized-article",
  r2Key: "corpus/normalized/sealed.json", byteCount: 123, sha256: hash("immutable snapshot"),
  officialUrl, languageTag: "ru", articleNumber: "7", textSha256: hash(fullText)};
const responseSchema = z.object({text: z.string(), fullArticle: z.boolean(), articleNumber: z.string(),
  officialUrl: z.string(), evidenceUnavailable: z.boolean().optional(),
  evidenceIdentity: z.object({textSha256: z.string()}).passthrough().optional()}).passthrough();
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE conversations(id TEXT, workspace_id TEXT, owner_user_id TEXT);
  CREATE TABLE legal_source_references(conversation_id TEXT, message_id TEXT, canonical_url TEXT,
    citation_validation_status TEXT, title TEXT, article_reference TEXT, excerpt TEXT,
    document_status TEXT, effective_date TEXT, source_locale TEXT, validated_at TEXT,
    source_kind TEXT, content_sha256 TEXT, evidence_receipt_json TEXT, created_at TEXT);
  INSERT INTO conversations VALUES ('conversation', 'workspace', 'owner');`);
let userId = "owner";
let workspaceId = "workspace";
let serviceCalls = 0;
const successfulServiceResponse = () => Response.json({text: fullText, fullArticle: true, truncated: false},
  {headers: {"x-juro-citation-evidence-contract": "1"}});
let serviceResponse = successfulServiceResponse;
const service = {async fetch(_url: string, init: RequestInit) {
  serviceCalls++;
  assert.deepEqual(JSON.parse(String(init.body)), receipt);
  return serviceResponse();
}};
type RouteContext = {params: Promise<{messageId: string}>};
mock.module(new URL("lib/document-builder/auth/api.ts", root).href, {namedExports: {
  requireApiUser: async () => ({id: userId}),
  withApiErrors: (handler: (request: Request, context: RouteContext) => Promise<Response>) => handler,
}});
mock.module(new URL("lib/platform/workspace.ts", root).href, {namedExports: {
  workspaceForUser: async () => ({id: workspaceId}),
}});
mock.module(new URL("lib/document-builder/storage/runtime.ts", root).href, {namedExports: {
  requireD1: () => ({prepare: (sql: string) => ({bind: (...values: SQLInputValue[]) => ({
    all: async () => ({results: sqlite.prepare(sql).all(...values)}),
  })})}),
  requireR2: () => {throw new Error("An official citation cannot read private document storage");},
  runtimeEnv: () => ({APP_ENV: "staging", LEGAL_RETRIEVAL_SERVICE: service}),
}});
const {GET} = await import("../../app/api/platform/ai/citations/[messageId]/route");

function seed(evidenceReceiptJson: string | null) {
  sqlite.exec("DELETE FROM legal_source_references");
  sqlite.prepare("INSERT INTO legal_source_references VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("conversation", messageId, officialUrl, "validated", "Official provision", "7", savedFragment,
      "current", "2026-01-01", "ru", "2026-08-15T00:00:00.000Z", "lex", receipt.sha256,
      evidenceReceiptJson, "2026-08-15T00:00:00.000Z");
  userId = "owner";
  workspaceId = "workspace";
  serviceCalls = 0;
  serviceResponse = successfulServiceResponse;
}
const get = (article = "7") => GET(new Request(`https://example.com/api/citation?${new URLSearchParams({sourceUrl: officialUrl, article})}`),
  {params: Promise.resolve({messageId})});
async function assertSavedFragment() {
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  const body = responseSchema.parse(await response.json());
  assert.equal(body.text, savedFragment);
  assert.equal(body.fullArticle, false);
  assert.equal(body.evidenceUnavailable, true);
  assert.equal(body.articleNumber, "7");
  assert.equal(body.officialUrl, officialUrl);
}

try {
  await test("the citation route opens and reloads the same complete pinned text", async () => {
    seed(JSON.stringify(receipt));
    const first = await get();
    const opened = responseSchema.parse(await first.json());
    assert.equal(first.status, 200);
    assert.equal(first.headers.get("cache-control"), "private, no-store");
    assert.equal(opened.text, fullText);
    assert.equal(opened.fullArticle, true);
    assert.equal(opened.evidenceIdentity?.textSha256, receipt.textSha256);
    assert.deepEqual(await (await get()).json(), opened);
    assert.equal(serviceCalls, 2);
  });
  await test("legacy saved citations remain fragments without fetching replacement evidence", async () => {
    seed(null);
    await assertSavedFragment();
    assert.equal(serviceCalls, 0);
  });
  await test("corrupt or mismatched saved receipts remain fragments before service access", async () => {
    for (const stored of ["{", JSON.stringify({...receipt, articleNumber: "8"}),
      JSON.stringify({...receipt, languageTag: "en"}), JSON.stringify({...receipt, sha256: hash("other revision")})]) {
      seed(stored);
      await assertSavedFragment();
      assert.equal(serviceCalls, 0);
    }
  });
  await test("unavailable, obsolete or changed citation responses retain the saved fragment", async () => {
    for (const reply of [() => Response.json({code: "CITATION_UNAVAILABLE"}, {status: 503}),
      () => Response.json({text: fullText, fullArticle: true, truncated: false}),
      () => Response.json({text: "Different current text", fullArticle: true, truncated: false},
        {headers: {"x-juro-citation-evidence-contract": "1"}})]) {
      seed(JSON.stringify(receipt));
      serviceResponse = reply;
      await assertSavedFragment();
      assert.equal(serviceCalls, 1);
    }
  });
  await test("the actual citation query excludes another owner and another workspace", async () => {
    for (const identity of [{user: "other", workspace: "workspace"}, {user: "owner", workspace: "other"}]) {
      seed(JSON.stringify(receipt));
      userId = identity.user;
      workspaceId = identity.workspace;
      const response = await get();
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), {code: "CITATION_UNAVAILABLE"});
      assert.equal(serviceCalls, 0);
    }
  });
  await test("an unsaved article cannot select another citation from the same document", async () => {
    seed(JSON.stringify(receipt));
    const response = await get("8");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {code: "CITATION_UNAVAILABLE"});
    assert.equal(serviceCalls, 0);
  });
} finally {
  mock.restoreAll();
  sqlite.close();
}
