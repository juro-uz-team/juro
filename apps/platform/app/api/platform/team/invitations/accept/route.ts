import { workspaceEntitlements } from "../../../../../../lib/billing/entitlements";
import { normalizeEmail, sha256 } from "../../../../../../lib/auth/crypto";
import { identityEvidenceMatches } from "../../../../../../lib/auth/identity-evidence";
import { parseJsonRequest } from "../../../../../../lib/auth/input";
import { runtimeIdentityProtection } from "../../../../../../lib/auth/identity-runtime";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import {
  acceptWorkspaceInvitation,
  workspaceInvitationAcceptInputSchema,
  workspaceInvitationByTokenHash,
  workspaceInvitationRedirect,
  type WorkspaceInvitationLocale,
} from "../../../../../../lib/platform/workspace-invitation";
import { isLocale } from "../../../../../../lib/platform/routing";

function response(body: unknown, status = 200, accountType?: string) {
  const headers = new Headers({
    "cache-control": "private, no-store",
    pragma: "no-cache",
  });
  if (accountType) {
    headers.append(
      "set-cookie",
      `juro_account_type=${accountType}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`,
    );
  }
  return Response.json(body, { status, headers });
}

function requestLocale(request: Request): WorkspaceInvitationLocale {
  const requested = new URL(request.url).searchParams.get("lang") ?? "";
  return isLocale(requested) ? requested : "ru";
}

function message(
  locale: WorkspaceInvitationLocale,
  ru: string,
  uz: string,
  en: string,
) {
  return locale === "uz" ? uz : locale === "en" ? en : ru;
}

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const fallbackLocale = requestLocale(request);
  const parsed = await parseJsonRequest(
    request,
    workspaceInvitationAcceptInputSchema,
    4_096,
  );
  if (!parsed.ok) {
    const status = parsed.error === "payload_too_large"
      ? 413
      : parsed.error === "invalid_content_type"
        ? 415
        : 400;
    return response({
      code: parsed.error.toLocaleUpperCase(),
      error: message(
        fallbackLocale,
        "Проверьте формат приглашения.",
        "Taklif formatini tekshiring.",
        "Check the invitation format.",
      ),
    }, status);
  }
  const { token, locale } = parsed.data;
  const user = await requireApiUser();
  const tokenHash = await sha256(token);
  const normalizedEmail = normalizeEmail(user.email);
  const db = requireD1();
  const invitation = await workspaceInvitationByTokenHash(db, tokenHash);
  const matches = invitation && await identityEvidenceMatches(
    runtimeIdentityProtection(),
    {
      normalizedValue: normalizedEmail,
      purpose: "workspace-invitation-email",
      legacyHash: invitation.emailHash,
      lookupHash: invitation.emailLookupHash,
      lookupKeyVersion: invitation.emailLookupKeyVersion,
    },
  );
  if (!invitation || !matches) {
    return response({
      code: "INVITATION_NOT_FOUND",
      error: message(
        locale,
        "Приглашение не найдено для этого аккаунта.",
        "Bu hisob uchun taklif topilmadi.",
        "No invitation was found for this account.",
      ),
    }, 403);
  }
  if (invitation.revokedAt) {
    return response({
      code: "INVITATION_REVOKED",
      error: message(locale, "Приглашение отозвано.", "Taklif bekor qilingan.", "The invitation has been revoked."),
    }, 410);
  }
  if (invitation.acceptedAt) {
    return response({
      code: "INVITATION_ACCEPTED",
      error: message(locale, "Приглашение уже принято.", "Taklif allaqachon qabul qilingan.", "The invitation has already been accepted."),
    }, 409);
  }
  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    return response({
      code: "INVITATION_EXPIRED",
      error: message(locale, "Срок действия приглашения истёк.", "Taklif muddati tugagan.", "The invitation has expired."),
    }, 410);
  }
  const now = isoNow();
  if ((await workspaceEntitlements(db, invitation.workspaceId)).readOnly) {
    return response({ code: "WORKSPACE_TERM_EXPIRED" }, 403);
  }
  const accepted = await acceptWorkspaceInvitation(db, {
    invitationId: invitation.id,
    tokenHash,
    expectedEmailHash: invitation.emailHash,
    expectedEmailLookupHash: invitation.emailLookupHash,
    expectedEmailLookupKeyVersion: invitation.emailLookupKeyVersion,
    userId: user.id,
    now,
  });
  if (!accepted) {
    return response({
      code: "INVITATION_CONFLICT",
      error: message(
        locale,
        "Приглашение уже изменено. Обновите страницу.",
        "Taklif holati o‘zgargan. Sahifani yangilang.",
        "The invitation has changed. Refresh the page.",
      ),
    }, 409);
  }
  const accountType = invitation.workspaceType === "business"
    ? "business"
    : "individual";
  return response({
    ok: true,
    redirectTo: workspaceInvitationRedirect(
      locale,
      invitation.workspaceType,
      invitation.workspaceId,
    ),
  }, 200, accountType);
});
