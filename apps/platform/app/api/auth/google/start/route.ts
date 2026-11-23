import { withApiErrors, assertSafeWrite } from "../../../../../lib/document-builder/auth/api";
import { parseJsonRequest } from "../../../../../lib/auth/input";
import { jsonNoStore } from "../../../../../lib/auth/mfa-http";
import { clearGoogleProof, googleOAuthConfig, googleStartInput, startGoogleOAuth } from "../../../../../lib/auth/google-oauth";

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const config = googleOAuthConfig();
  if (!config || new URL(request.url).origin !== config.origin) {
    return jsonNoStore({ code: "GOOGLE_UNAVAILABLE" }, 503);
  }
  const parsed = await parseJsonRequest(request, googleStartInput, 8192);
  if (!parsed.ok) return jsonNoStore({ code: "GOOGLE_INVALID_REQUEST" }, 400);
  const start = startGoogleOAuth(config, parsed.data);
  return jsonNoStore({ authorizationUrl: start.url }, 200, [start.cookie, clearGoogleProof()]);
});
