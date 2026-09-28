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
const responseSchema = z.object({text: z.string(), fullArticle: z.boolean(), articleNumber: z.string().nullable(),
  officialUrl: z.string(), evidenceUnavailable: z.boolean().optional(),
  evidenceIdentity: z.object({textSha256: z.string()}).passthrough().optional()}).passthrough();
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(`CREATE TABLE conversations(id TEXT, workspace_id TEXT, owner_user_id TEXT);
  CREATE TABLE legal_source_references(conversation_id TEXT, message_id TEXT, canonical_url TEXT,
    citation_validation_status TEXT, title TEXT, article_reference TEXT, excerpt TEXT,
    document_status TEXT, effective_date TEXT, source_locale TEXT, validated_at TEXT,
    source_kind TEXT, content_sha256 TEXT, evidence_receipt_json TEXT, created_at TEXT, answer_source_id TEXT);
  INSERT INTO conversations VALUES ('conversation', 'workspace', 'owner');`);
let userId = "owner";
let workspaceId = "workspace";
let serviceCalls = 0;
const successfulServiceResponse = () => Response.json({text: fullText, fullArticle: true, truncated: false},
  {headers: {"x-juro-citation-evidence-contract": "1"}});
let serviceResponse = successfulServiceResponse;
let expectedReceipt: CitationEvidenceReceipt = receipt;
const service = {async fetch(_url: string, init: RequestInit) {
  serviceCalls++;
  assert.deepEqual(JSON.parse(String(init.body)), expectedReceipt);
  return serviceResponse();
}};
type RouteContext = {params: Promise<{messageId: string}>};
mock.module(new URL("lib/document-builder/auth/api.ts", root).href, {namedExports: {
  requireApiUser: async () => ({id: userId}),
  withApiErrors: (handler: (request: Request, context: RouteContext) => Promise<Response>) => handler,
}});
mock.module(new URL("lib/platform/workspace.ts", root).href, {namedExports: {
  workspaceForUser: async () => ({id: workspaceId}),
  workspaceForUserById: async (_user:string,id:string) => id==="workspace"?{id}:null,
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
  sqlite.prepare("INSERT INTO legal_source_references VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run("conversation", messageId, officialUrl, "validated", "Official provision", "7", savedFragment,
      "current", "2026-01-01", "ru", "2026-08-15T00:00:00.000Z", "lex", receipt.sha256,
      evidenceReceiptJson, "2026-08-15T00:00:00.000Z", "source-7");
  userId = "owner";
  workspaceId = "workspace";
  serviceCalls = 0;
  serviceResponse = successfulServiceResponse;
  expectedReceipt = receipt;
}
const get = (article: string | null = "7", sourceId?: string, sourceUrl=officialUrl) => {
  const query=new URLSearchParams({sourceUrl});
  if(article)query.set("article",article);
  if(sourceId)query.set("sourceId",sourceId);
  return GET(new Request(`https://example.com/api/citation?${query}`),{params:Promise.resolve({messageId})});
};
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
  await test("historical citations reopen their exact saved revision and reject other dates", async () => {
    const historicalUrl=officialUrl+"?ONDATE=30.10.2021";
    const historicalReceipt: CitationEvidenceReceipt={...receipt,capability:"history",officialUrl:historicalUrl};
    seed(JSON.stringify(historicalReceipt));
    sqlite.prepare("UPDATE legal_source_references SET canonical_url=?").run(historicalUrl);
    expectedReceipt=historicalReceipt;
    const response=await get("7","source-7",historicalUrl);
    assert.equal(response.status,200);
    const body=responseSchema.parse(await response.json());
    assert.equal(body.text,fullText);
    assert.equal(body.officialUrl,historicalUrl);
    assert.equal(body.evidenceIdentity?.textSha256,hash(fullText));
    assert.equal(serviceCalls,1);
    for(const url of [officialUrl,officialUrl+"?ONDATE=31.10.2021"]){
      assert.equal((await get("7","source-7",url)).status,404);
      assert.equal(serviceCalls,1,"A different revision cannot fetch the saved receipt");
    }
    userId="other";
    assert.equal((await get("7","source-7",historicalUrl)).status,404);
    assert.equal(serviceCalls,1);
  });
  await test("unsupported or invalid revision queries cannot reopen even a matching saved citation", async () => {
    for(const query of ["?ONDATE=31.02.2021","?ONDATE=30.10.2021&ONDATE=31.10.2021",
      "?ONDATE=30.10.2021&redirect=https://example.com","?ondate=30.10.2021","?search=leave"]){
      const url=officialUrl+query;
      seed(JSON.stringify({...receipt,capability:"history",officialUrl:url}));
      sqlite.prepare("UPDATE legal_source_references SET canonical_url=?").run(url);
      assert.equal((await get("7","source-7",url)).status,404);
      assert.equal(serviceCalls,0);
    }
  });
  await test("source identity selects the exact saved provision when URL and article collide", async () => {
    for(const article of ["7",null]) {
      seed(JSON.stringify({...receipt,articleNumber:article}));
      sqlite.prepare("UPDATE legal_source_references SET article_reference=?").run(article);
      sqlite.exec("INSERT INTO legal_source_references SELECT * FROM legal_source_references");
      const secondText="The second immutable provision.",secondReceipt: CitationEvidenceReceipt={...receipt,articleNumber:article,
        kind:article===null?"provision":"normalized-article",
        textSha256:hash(secondText),sha256:hash("second snapshot"),r2Key:"corpus/second.json"};
      sqlite.prepare("UPDATE legal_source_references SET answer_source_id=?,evidence_receipt_json=?,content_sha256=? WHERE rowid=2")
        .run("second-source",JSON.stringify(secondReceipt),secondReceipt.sha256);
      expectedReceipt=secondReceipt;
      serviceResponse=()=>Response.json({text:secondText,fullArticle:article!==null,truncated:false},
        {headers:{"x-juro-citation-evidence-contract":"1"}});
      const selected=await get(article,"second-source"),body=responseSchema.parse(await selected.json());
      assert.equal(selected.status,200);assert.equal(body.text,secondText);
      assert.equal(body.evidenceIdentity?.textSha256,secondReceipt.textSha256);
      assert.equal((await get(article,"unknown-source")).status,404);
      assert.equal((await get(article)).status,404,"Ambiguous legacy locators must not choose the first row");
    }
  });
  await test("an unambiguous legacy citation remains accessible without a saved source ID", async () => {
    seed(JSON.stringify(receipt));sqlite.exec("UPDATE legal_source_references SET answer_source_id=NULL");
    const opened=responseSchema.parse(await (await get("7","legacy-source")).json());
    assert.equal(opened.text,fullText);
  });
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
  await test("an explicitly selected member workspace determines citation scope", async () => {
    seed(JSON.stringify(receipt));workspaceId="other-default";
    const request=new Request(`https://example.com/api/citation?${new URLSearchParams({sourceUrl:officialUrl,article:"7"})}`,
      {headers:{"x-juro-workspace-id":"workspace"}});
    assert.equal((await GET(request,{params:Promise.resolve({messageId})})).status,200);
    const denied=new Request(request,{headers:{"x-juro-workspace-id":"not-a-member"}});
    assert.equal((await GET(denied,{params:Promise.resolve({messageId})})).status,404);
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
