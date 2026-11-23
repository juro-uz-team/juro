import { z } from "zod";
import { withApiErrors, assertSafeWrite } from "../../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../../lib/document-builder/storage/runtime";
import { jsonNoStore, mfaErrorResponse } from "../../../../../lib/auth/mfa-http";
import { parseJsonRequest } from "../../../../../lib/auth/input";
import { authReturnDestination } from "../../../../../lib/auth/return-path";
import { clearGoogleProof, googleOAuthConfig, readGoogleProof } from "../../../../../lib/auth/google-oauth";
import {
  consumeGoogleProof, createGoogleAccount, existingGoogleEmailUserId, googleAccountUserId,
  googleLinkSession, googleSessionResponse, linkGoogleAccount,
} from "../../../../../lib/auth/google-accounts";

const completion = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("login") }),
  z.object({ kind: z.literal("link") }),
  z.object({
    kind: z.literal("signup"),
    accountType: z.enum(["individual", "entrepreneur", "lawyer"]),
    name: z.string().trim().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]+$/u),
    acceptTerms: z.literal(true),
    acceptPrivacy: z.literal(true),
    acceptPersonalData: z.literal(true),
  }),
]);

function rejected(code: string, status: number, clear = false) {
  return jsonNoStore({ code }, status, clear ? [clearGoogleProof()] : []);
}

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const config = googleOAuthConfig();
  if (!config || new URL(request.url).origin !== config.origin) return rejected("GOOGLE_UNAVAILABLE", 503);
  const proof = readGoogleProof(config, request.headers.get("cookie"));
  if (!proof) return rejected("GOOGLE_EXPIRED", 401, true);
  const parsed = await parseJsonRequest(request, completion, 8192);
  if (!parsed.ok || proof.kind !== parsed.data.kind) return rejected("GOOGLE_INVALID_REQUEST", 400);
  const db = requireD1();
  const body = parsed.data;
  const linkSession = body.kind === "link" ? await googleLinkSession(db, request, proof) : null;
  if (body.kind === "link" && !linkSession) return rejected("GOOGLE_LINK_ACCOUNT_REQUIRED", 403);
  if (!(await consumeGoogleProof(db, proof.token))) return rejected("GOOGLE_EXPIRED", 409, true);
  try {
    if (linkSession) {
      if (!(await linkGoogleAccount(db, proof.subjectHash, linkSession.userId, linkSession.sessionId))) {
        return rejected("GOOGLE_LINK_CONFLICT", 409, true);
      }
      const redirectTo = authReturnDestination(`/${proof.request.locale}/main`, proof.request.returnTo);
      return jsonNoStore({ ok: true, redirectTo }, 200, [clearGoogleProof()]);
    }
    let userId = await googleAccountUserId(db, proof.subjectHash);
    if (body.kind === "signup" && !userId) {
      if (await existingGoogleEmailUserId(db, proof.email)) return rejected("GOOGLE_LINK_ACCOUNT_REQUIRED", 409, true);
      try {
        userId = await createGoogleAccount(db, proof, body.accountType, body.name);
      } catch (error) {
        if ((error as { code?: unknown }).code === "23505") return rejected("GOOGLE_ACCOUNT_CONFLICT", 409, true);
        throw error;
      }
    }
    if (!userId) return rejected("GOOGLE_ACCOUNT_UNAVAILABLE", 403, true);
    const response = await googleSessionResponse(db, request, proof, userId);
    response.headers.append("set-cookie", clearGoogleProof());
    return response;
  } catch (error) {
    const response = mfaErrorResponse(error, proof.request.locale);
    response?.headers.append("set-cookie", clearGoogleProof());
    return response ?? rejected("GOOGLE_UNAVAILABLE", 503, true);
  }
});
