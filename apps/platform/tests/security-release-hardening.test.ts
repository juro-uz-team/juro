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
  assert.match(aiPlan, /legalChatOwner\(request\)/u);
  assert.match(await source("lib/ai/action-plan-save.ts"), /member\.role IN \('owner','admin','lawyer','employee'\)/u);
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

test("private native servers preserve authentication and loopback boundaries", async () => {
  const [profile, auth, server, admin] = await Promise.all([
    source("app/api/platform/profile/route.ts"), source("app/chatgpt-auth.ts"),
    source("server/index.ts"), readFile(new URL("../../admin/src/server.ts", import.meta.url), "utf8"),
  ]);
  assert.match(profile, /canManageTeam\(workspace\.role\)/u);
  assert.match(auth, /ALLOW_PLATFORM_AUTH_HEADERS === "true"/u);
  assert.match(auth, /env\.APP_ENV !== "production"/u);
  for (const runtime of [server, admin]) {
    assert.match(runtime, /PRIVATE_DEVELOPMENT !== "true"/u);
    assert.match(runtime, /listen\(port, "127\.0\.0\.1"/u);
  }
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

test("native server bounds actual API bytes before handing the request to the application", async () => {
  const server = await source("server/index.ts");
  assert.match(server, /publicApiRequestBodyLimit\(url\.pathname/u);
  assert.match(server, /received > limit/u);
  assert.match(server, /response\.writeHead\(413(?:,|\))/u);
  assert.ok(server.indexOf("if (!boundedBody(") < server.indexOf("const webRequest = new Request("));
});
