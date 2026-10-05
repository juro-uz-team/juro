import { z } from "zod";
import { parseJsonRequest } from "../../../../../lib/auth/input";
import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../lib/document-builder/storage/db";
import {
  requireD1,
  runtimeEnv,
} from "../../../../../lib/document-builder/storage/runtime";
import { missingLawyerMarketplaceFields } from "../../../../../lib/platform/lawyer-marketplace";
import { lawyerText } from "../../../../../lib/platform/lawyer-localization";
import { localizedLawyerProfileStatusNotification } from "../../../../../lib/platform/lawyer-profile-notifications";
import { lawyerProfileError } from "../../../../../lib/platform/lawyer-profile";
import { isLawyerProfileDirectoryPreviewEnabled } from "../../../../../lib/platform/lawyer-profile-preview";
import { workspaceForUser } from "../../../../../lib/platform/workspace";

const input = z.object({ locale: z.enum(["ru", "uz", "en"]) }).strict();

type SubmissionProfile = {
  id: string;
  displayName: string;
  specialtiesJson: string;
  languagesJson: string;
  experienceYears: number | null;
  education: string | null;
  firmName: string | null;
  city: string | null;
  region: string | null;
  priceDescription: string | null;
  consultationFormatsJson: string;
  availabilityStatus: string;
  profilePhotoKey: string | null;
  hasPhone: number;
  marketplaceStatus: string;
  profileRevision: number;
};

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

function list(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export const POST = withApiErrors(async function POST(request: Request) {
  if (!isLawyerProfileDirectoryPreviewEnabled(runtimeEnv()))
    return response({ code: "NOT_AVAILABLE" }, 404);
  assertSafeWrite(request);
  const user = await requireApiUser();
  const parsed = await parseJsonRequest(request, input, 1_024);
  if (!parsed.ok)
    return response(
      {
        code: "INVALID_INPUT",
      },
      400,
    );
  const db = requireD1();
  const profile = await db
    .prepare(
      `SELECT p.id,p.display_name AS displayName,p.specialties_json AS specialtiesJson,
      p.languages_json AS languagesJson,p.experience_years AS experienceYears,p.education,
      p.firm_name AS firmName,p.city,p.region,p.price_description AS priceDescription,
      p.consultation_formats_json AS consultationFormatsJson,p.availability_status AS availabilityStatus,
      p.profile_photo_key AS profilePhotoKey,p.marketplace_status AS marketplaceStatus,
      p.profile_revision AS profileRevision,
      CASE WHEN u.phone IS NOT NULL AND length(trim(u.phone))>0 THEN 1 ELSE 0 END AS hasPhone
     FROM lawyer_profiles p JOIN user_profiles u ON u.id=p.user_id
     WHERE p.user_id=? AND u.account_type IN ('lawyer','business') LIMIT 1`,
    )
    .bind(user.id)
    .first<SubmissionProfile>();
  if (!profile)
    return response(
      {
        code: "PROFILE_UNAVAILABLE",
        error: lawyerProfileError(parsed.data.locale, "PROFILE_UNAVAILABLE"),
      },
      404,
    );
  if (
    ["pending_review", "public_approved"].includes(profile.marketplaceStatus)
  ) {
    return response({
      ok: true,
      marketplaceStatus: profile.marketplaceStatus,
      missingRequiredFields: [],
    });
  }
  if (
    ["suspended", "blocked", "archived"].includes(profile.marketplaceStatus)
  ) {
    return response(
      {
        code: "PROFILE_LOCKED",
        error: lawyerProfileError(parsed.data.locale, "PROFILE_LOCKED"),
      },
      423,
    );
  }
  const missingRequiredFields = missingLawyerMarketplaceFields({
    displayName: profile.displayName,
    specialties: list(profile.specialtiesJson),
    languages: list(profile.languagesJson),
    experienceYears: profile.experienceYears,
    education: profile.education,
    firmName: profile.firmName,
    city: profile.city,
    region: profile.region,
    priceDescription: profile.priceDescription,
    consultationFormats: list(profile.consultationFormatsJson),
    availabilityStatus: profile.availabilityStatus,
    profilePhotoKey: profile.profilePhotoKey,
    hasPhone: profile.hasPhone === 1,
  });
  if (missingRequiredFields.length) {
    return response(
      {
        code: "PROFILE_INCOMPLETE",
        error: lawyerText(
          parsed.data.locale,
          "Заполните обязательные поля перед отправкой.",
          "Yuborishdan oldin majburiy maydonlarni to‘ldiring.",
          "Complete the required fields before submitting your profile.",
        ),
        missingRequiredFields,
      },
      409,
    );
  }
  const workspace = await workspaceForUser(user);
  const now = isoNow();
  const notification = localizedLawyerProfileStatusNotification(
    parsed.data.locale,
    "pending_review",
  );
  const results = await db.batch([
    db
      .prepare(
        `UPDATE lawyer_profiles SET status='pending',marketplace_status='pending_review',public_approved_at=NULL,updated_at=?
       WHERE id=? AND user_id=? AND profile_revision=? AND marketplace_status IN ('profile_incomplete','changes_requested','rejected')`,
      )
      .bind(now, profile.id, user.id, profile.profileRevision),
    db
      .prepare(
        `INSERT INTO notifications (id,workspace_id,user_id,document_id,type,title,body,read_at,created_at)
       SELECT ?,?,?,NULL,'lawyer_profile_status',?,?,NULL,?
       WHERE EXISTS (SELECT 1 FROM lawyer_profiles WHERE id=? AND user_id=? AND profile_revision=?
         AND marketplace_status='pending_review' AND updated_at=?)`,
      )
      .bind(
        crypto.randomUUID(),
        workspace.id,
        user.id,
        notification.title,
        notification.body,
        now,
        profile.id,
        user.id,
        profile.profileRevision,
        now,
      ),
    db
      .prepare(
        `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       SELECT ?,?,?,'lawyer_profile',?,'lawyer_profile_submitted',?,?
       WHERE EXISTS (SELECT 1 FROM lawyer_profiles WHERE id=? AND user_id=? AND profile_revision=?
         AND marketplace_status='pending_review' AND updated_at=?)`,
      )
      .bind(
        crypto.randomUUID(),
        workspace.id,
        user.id,
        profile.id,
        JSON.stringify({ profileRevision: profile.profileRevision }),
        now,
        profile.id,
        user.id,
        profile.profileRevision,
        now,
      ),
  ]);
  if (results.some((result) => Number(result?.meta.changes ?? 0) !== 1)) {
    return response(
      {
        code: "PROFILE_UNAVAILABLE",
        error: lawyerText(
          parsed.data.locale,
          "Профиль изменился. Обновите страницу и повторите отправку.",
          "Profil o‘zgardi. Sahifani yangilang va qayta yuboring.",
          "The profile changed. Refresh the page and submit it again.",
        ),
      },
      409,
    );
  }
  return response({
    ok: true,
    marketplaceStatus: "pending_review",
    missingRequiredFields: [],
    updatedAt: now,
  });
});
