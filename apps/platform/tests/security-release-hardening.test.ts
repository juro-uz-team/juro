import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path: string): Promise<string> {
  return readFile(new URL(path, root), "utf8");
}

test("shared-case mutation routes require content-editor authority while reads remain available", async () => {
  const [requests, grants, drafts, aiPlan, archive] = await Promise.all([
    source("app/api/platform/lawyer-requests/route.ts"),
    source("app/api/platform/lawyer-requests/[requestId]/access-grant/route.ts"),
    source("app/api/document-builder/configured-drafts/route.ts"),
    source("app/api/platform/ai/action-plan/route.ts"),
    source("app/api/platform/archive/route.ts"),
  ]);
  assert.match(requests, /export const GET[\s\S]*workspaceForUser\(user\)/u);
  assert.match(requests, /export const POST[\s\S]*workspaceForContentEditor\(user\)/u);
  assert.match(grants, /export const POST[\s\S]*workspaceForContentEditor\(user\)/u);
  assert.match(grants, /export const DELETE[\s\S]*workspaceForUser\(user\)/u);
  assert.match(drafts, /if \(parsed\.data\.caseId\)[\s\S]*workspaceForContentEditor\(user\)/u);
  assert.match(aiPlan, /workspaceForContentEditor\(user\)/u);
  assert.match(archive, /body\.type === "document"[\s\S]*workspaceForContentEditor\(user\)[\s\S]*action: "restore"/u);
});

test("member offboarding and migration revoke capabilities issued by removed requesters", async () => {
  const [route, migration] = await Promise.all([
    source("app/api/platform/team/members/[memberId]/route.ts"),
    source("drizzle/0147_signed_share_verification_hardening.sql"),
  ]);
  for (const text of [route, migration]) {
    assert.match(text, /lawyer_access_grants/u);
    assert.match(text, /revoked_at/u);
    assert.match(text, /requester_removed/u);
    assert.match(text, /lawyer_requests/u);
    assert.match(text, /access_revoked/u);
  }
});

test("profile, development authentication, and production configuration preserve their trust boundaries", async () => {
  const [profile, auth, vite, platformConfig, adminConfig] = await Promise.all([
    source("app/api/platform/profile/route.ts"),
    source("app/chatgpt-auth.ts"),
    source("vite.config.ts"),
    source("wrangler.jsonc"),
    readFile(new URL("../../admin/wrangler.jsonc", import.meta.url), "utf8"),
  ]);
  assert.match(profile, /canManageTeam\(workspace\.role\)/u);
  assert.match(auth, /ALLOW_PLATFORM_AUTH_HEADERS === "true"/u);
  assert.match(auth, /env\.APP_ENV !== "production"/u);
  assert.doesNotMatch(auth, /process\.env\.NODE_ENV !== "production" \|\|/u);
  assert.match(vite, /host: "127\.0\.0\.1"/u);
  assert.doesNotMatch(vite, /host: "0\.0\.0\.0"/u);
  assert.match(platformConfig, /"keep_vars": false/u);
  assert.match(adminConfig, /"keep_vars": false/u);
  assert.equal(typeof JSON.parse(platformConfig).env.production.d1_databases[0].migrations_pattern,
    "string");
});

test("production workflow pins third-party actions and exposes Cloudflare credentials only to deploy steps", async () => {
  const workflow = await readFile(new URL("../../../.github/workflows/deploy-production.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node)@v\d+/u);
  assert.equal(workflow.match(/uses: actions\/checkout@[0-9a-f]{40}/gu)?.length, 4);
  assert.equal(workflow.match(/uses: actions\/setup-node@[0-9a-f]{40}/gu)?.length, 3);
  assert.equal(workflow.match(/CLOUDFLARE_ACCOUNT_ID:/gu)?.length, 3);
  assert.equal(workflow.match(/CLOUDFLARE_API_TOKEN:/gu)?.length, 3);
  assert.match(workflow, /- name: Deploy public website[\s\S]*?run: npm run deploy:production[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:/u);
  assert.match(workflow, /- name: Deploy legal retrieval services and user platform[\s\S]*?run: npm run deploy:production:stack[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:/u);
  assert.match(workflow, /- name: Deploy admin Worker[\s\S]*?run: npm run deploy:production[\s\S]*?env:[\s\S]*?CLOUDFLARE_API_TOKEN:/u);
});

test("multipart upload routes enforce a declared aggregate bound before form-data parsing", async () => {
  const routes = await Promise.all([
    source("app/api/document-builder/documents/[id]/attachments/route.ts"),
    source("app/api/document-builder/documents/[id]/signed-file/route.ts"),
    source("app/api/platform/document-comparisons/route.ts"),
  ]);
  for (const route of routes) {
    const bound = route.indexOf("requiredContentLength(request");
    const parse = route.indexOf("request.formData()");
    assert.ok(bound >= 0 && parse > bound);
    assert.match(route, /PAYLOAD_TOO_LARGE|UPLOAD_PAYLOAD_TOO_LARGE/u);
  }
});

test("voice upload requires an exact declared length before streaming to quarantine", async () => {
  const route = await source("app/api/platform/voice/recordings/[recordingId]/route.ts");
  const bound = route.indexOf("requiredContentLength(request, state.recording.sizeBytes)");
  const put = route.indexOf("requireQuarantineR2().put");
  assert.ok(bound >= 0 && put > bound);
  assert.match(route, /!contentLength\.ok/u);
  assert.match(route, /contentLength\.bytes !== state\.recording\.sizeBytes/u);
});

test("team reads disclose active invitations only to team managers", async () => {
  const route = await source("app/api/platform/team/route.ts");
  assert.match(route, /canManageTeam\(workspace\.role\)[\s\S]*workspace_invitations/u);
  assert.match(route, /accepted_at IS NULL AND revoked_at IS NULL[\s\S]*expires_at>\?/u);
  assert.match(route, /: null;[\s\S]*invitations\?\.results \?\? \[\]/u);
  assert.match(route, /members:\s*resolvedMembers/u);
});

test("worker bounds actual API request bytes before application parsing", async () => {
  const worker = await source("worker/index.ts");
  const policy = worker.indexOf("publicApiRequestBodyLimit(");
  const boundedRead = worker.indexOf("requestWithBoundedBody(");
  const internalAdmin = worker.indexOf("handleInternalAdminRequest(routedRequest");
  const framework = worker.indexOf("handler.fetch(");
  assert.ok(policy >= 0 && boundedRead > policy);
  assert.ok(internalAdmin >= 0 && policy > internalAdmin && framework > boundedRead);
  assert.match(worker, /status:\s*413/u);
  assert.match(worker, /code:\s*"PAYLOAD_TOO_LARGE"/u);
});
