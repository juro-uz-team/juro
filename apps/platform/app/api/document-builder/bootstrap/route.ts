import { assertSafeWrite, optionalApiUser, requireApiUser } from "../../../../lib/document-builder/auth/api";
import { prepareUserIdentityWrite } from "../../../../lib/auth/identity-protection";
import { runtimeIdentityProtection } from "../../../../lib/auth/identity-runtime";
import { apiError, badRequest, jsonResponse } from "../../../../lib/document-builder/auth/responses";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import { runtimeEnv } from "../../../../lib/document-builder/storage/runtime";
import type { IdentityDocumentType, UserProfile } from "../../../../lib/document-builder/types";
import { workspaceForUser } from "../../../../lib/platform/workspace";
import { countWebsiteNotifications, readWebsiteNotificationPreferences } from "../../../../lib/platform/website-notifications";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const bindings = runtimeEnv();
    if (!bindings.DB) {
      return jsonResponse({ user: null, storage: { d1: false, r2: Boolean(bindings.BUCKET) } });
    }
    const user = await optionalApiUser();
    let counts = { documents: 0, notifications: 0 };
    if (user) {
      const workspace = await workspaceForUser(user);
      const documents = await bindings.DB.prepare("SELECT count(*) AS count FROM documents WHERE owner_user_id = ? AND workspace_id = ?")
        .bind(user.id, workspace.id).first<{ count: number }>();
      const preferences = await readWebsiteNotificationPreferences(bindings.DB, user.id, workspace.id);
      const notifications = await countWebsiteNotifications(bindings.DB, user.id, workspace.id, preferences);
      counts = { documents: Number(documents?.count ?? 0), notifications };
    }
    return jsonResponse({ user, counts, storage: { d1: true, r2: Boolean(bindings.BUCKET) } });
  } catch (error) {
    return apiError(error);
  }
}

function optionalText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, max) : null;
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const body = await request.json() as Record<string, unknown>;
    const idDocumentType = body.idDocumentType === "passport" || body.idDocumentType === "id_card"
      ? body.idDocumentType as IdentityDocumentType
      : null;
    if (body.idDocumentType && !idDocumentType) return badRequest("Выберите паспорт или ID-карту.");
    const pinfl = optionalText(body.pinfl, 14);
    if (pinfl && !/^[0-9]{14}$/.test(pinfl)) return badRequest("ПИНФЛ должен содержать ровно 14 цифр.");
    const profile: UserProfile = {
      ...user,
      fullName: optionalText(body.fullName, 300),
      birthDate: optionalText(body.birthDate, 20),
      idDocumentType,
      idDocumentNumber: optionalText(body.idDocumentNumber, 100),
      idIssuedBy: optionalText(body.idIssuedBy, 500),
      idIssueDate: optionalText(body.idIssueDate, 20),
      pinfl,
      registeredAddress: optionalText(body.registeredAddress, 1_000),
      phone: optionalText(body.phone, 100),
    };
    const identityContext = runtimeIdentityProtection();
    const protectedIdentity = identityContext.mode === "dual_write"
      ? await prepareUserIdentityWrite(identityContext, {
          userId: user.id,
          email: user.email,
          phone: profile.phone,
        })
      : null;
    const statement = protectedIdentity
      ? runtimeEnv().DB!.prepare(
        `UPDATE user_profiles SET
         full_name=?,birth_date=?,id_document_type=?,id_document_number=?,
         id_issued_by=?,id_issue_date=?,pinfl=?,registered_address=?,phone=?,
         email_ciphertext=?,email_iv=?,email_key_version=?,
         email_lookup_hash=?,email_lookup_key_version=?,
         phone_ciphertext=?,phone_iv=?,phone_key_version=?,
         phone_lookup_hash=?,phone_lookup_key_version=?,updated_at=?
         WHERE id=?`,
      ).bind(
        profile.fullName,
        profile.birthDate,
        profile.idDocumentType,
        profile.idDocumentNumber,
        profile.idIssuedBy,
        profile.idIssueDate,
        profile.pinfl,
        profile.registeredAddress,
        protectedIdentity.phone,
        protectedIdentity.emailCiphertext,
        protectedIdentity.emailIv,
        protectedIdentity.emailKeyVersion,
        protectedIdentity.emailLookupHash,
        protectedIdentity.emailLookupKeyVersion,
        protectedIdentity.phoneCiphertext,
        protectedIdentity.phoneIv,
        protectedIdentity.phoneKeyVersion,
        protectedIdentity.phoneLookupHash,
        protectedIdentity.phoneLookupKeyVersion,
        isoNow(),
        user.id,
      )
      : runtimeEnv().DB!.prepare(
        `UPDATE user_profiles SET
         full_name=?,birth_date=?,id_document_type=?,id_document_number=?,
         id_issued_by=?,id_issue_date=?,pinfl=?,registered_address=?,
         phone=?,updated_at=? WHERE id=?`,
      ).bind(
        profile.fullName,
        profile.birthDate,
        profile.idDocumentType,
        profile.idDocumentNumber,
        profile.idIssuedBy,
        profile.idIssueDate,
        profile.pinfl,
        profile.registeredAddress,
        profile.phone,
        isoNow(),
        user.id,
      );
    await statement.run();
    return jsonResponse({ user: profile });
  } catch (error) {
    return apiError(error);
  }
}
