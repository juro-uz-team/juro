import { parseJsonRequest } from "../../../../lib/auth/input";
import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import {
  requireD1,
  runtimeEnv,
} from "../../../../lib/document-builder/storage/runtime";
import {
  lawyerProfileCreateSchema,
  lawyerProfileError,
  lawyerProfileUpdateSchema,
} from "../../../../lib/platform/lawyer-profile";
import { isLawyerProfileDirectoryPreviewEnabled } from "../../../../lib/platform/lawyer-profile-preview";
import {
  isRestrictedLawyerMarketplaceStatus,
  missingLawyerMarketplaceFields,
} from "../../../../lib/platform/lawyer-marketplace";
import { localizedLawyerProfileStatusNotification } from "../../../../lib/platform/lawyer-profile-notifications";
import { workspaceForUser } from "../../../../lib/platform/workspace";

type LawyerProfile = {
  id: string;
  displayName: string;
  specialtiesJson: string;
  languagesJson: string;
  status: string;
  marketplaceStatus: string;
  publicApprovedAt: string | null;
  experienceYears: number | null;
  priceDescription: string | null;
  consultationDurationMinutes: number;
  additionalServicesJson: string;
  availabilityStatus: string;
  nextAvailableAt: string | null;
  advocateStatus: string;
  firmName: string | null;
  bio: string | null;
  city: string | null;
  region: string | null;
  education: string | null;
  consultationFormatsJson: string;
  profilePhotoKey: string | null;
  profileRevision: number;
  hasPhone: number;
  moderationReason: string | null;
  updatedAt: string;
};

type ModerationHistoryItem = {
  profileRevision: number;
  decision: string;
  reason: string | null;
  createdAt: string;
};

type EditableProfile = {
  displayName: string;
  specialties: string[];
  languages: string[];
  experienceYears: number | null;
  priceDescription: string | null;
  consultationDurationMinutes: number;
  additionalServices: string[];
  availabilityStatus: string;
  nextAvailableAt: string | null;
  advocateStatus: string;
  firmName: string | null;
  bio: string | null;
  city: string | null;
  region: string | null;
  education: string | null;
  consultationFormats: string[];
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
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function toEditable(profile: LawyerProfile): EditableProfile {
  return {
    displayName: profile.displayName,
    specialties: list(profile.specialtiesJson),
    languages: list(profile.languagesJson),
    experienceYears: profile.experienceYears,
    priceDescription: profile.priceDescription,
    consultationDurationMinutes: profile.consultationDurationMinutes,
    additionalServices: list(profile.additionalServicesJson),
    availabilityStatus: profile.availabilityStatus,
    nextAvailableAt: profile.nextAvailableAt,
    advocateStatus: profile.advocateStatus,
    firmName: profile.firmName,
    bio: profile.bio,
    city: profile.city,
    region: profile.region,
    education: profile.education,
    consultationFormats: list(profile.consultationFormatsJson),
  };
}

function completion(profile: LawyerProfile, value = toEditable(profile)) {
  return {
    displayName: value.displayName,
    specialties: value.specialties,
    languages: value.languages,
    experienceYears: value.experienceYears,
    education: value.education,
    firmName: value.firmName,
    city: value.city,
    region: value.region,
    priceDescription: value.priceDescription,
    consultationFormats: value.consultationFormats,
    availabilityStatus: value.availabilityStatus,
    profilePhotoKey: profile.profilePhotoKey,
    hasPhone: profile.hasPhone === 1,
  };
}

function serialize(
  profile: LawyerProfile,
  moderationHistory: ModerationHistoryItem[] = [],
) {
  const required = completion(profile);
  return {
    id: profile.id,
    displayName: profile.displayName,
    specialties: list(profile.specialtiesJson),
    languages: list(profile.languagesJson),
    status: profile.status,
    marketplaceStatus: profile.marketplaceStatus,
    publicApprovedAt: profile.publicApprovedAt,
    experienceYears: profile.experienceYears,
    priceDescription: profile.priceDescription,
    consultationDurationMinutes: profile.consultationDurationMinutes,
    additionalServices: list(profile.additionalServicesJson),
    availabilityStatus: profile.availabilityStatus,
    nextAvailableAt: profile.nextAvailableAt,
    advocateStatus: profile.advocateStatus,
    firmName: profile.firmName,
    bio: profile.bio,
    city: profile.city,
    region: profile.region,
    education: profile.education,
    consultationFormats: list(profile.consultationFormatsJson),
    hasPhone: profile.hasPhone === 1,
    profilePhotoUrl: profile.profilePhotoKey
      ? "/api/platform/lawyer-profile/photo"
      : null,
    moderationReason:
      profile.marketplaceStatus === "changes_requested"
        ? profile.moderationReason
        : null,
    missingRequiredFields: missingLawyerMarketplaceFields(required),
    profileRevision: profile.profileRevision,
    updatedAt: profile.updatedAt,
    moderationHistory,
  };
}

async function accountIsLawyer(userId: string) {
  return requireD1()
    .prepare(
      "SELECT 1 AS permitted FROM user_profiles WHERE id=? AND account_type IN ('lawyer','business') LIMIT 1",
    )
    .bind(userId)
    .first<{ permitted: number }>();
}

async function ownProfile(userId: string) {
  return requireD1()
    .prepare(
      `SELECT p.id,p.display_name AS displayName,p.specialties_json AS specialtiesJson,
       p.languages_json AS languagesJson,p.status,p.marketplace_status AS marketplaceStatus,
       p.public_approved_at AS publicApprovedAt,p.experience_years AS experienceYears,
       p.price_description AS priceDescription,
       p.consultation_duration_minutes AS consultationDurationMinutes,
       p.additional_services_json AS additionalServicesJson,
       p.availability_status AS availabilityStatus,
       p.next_available_at AS nextAvailableAt,p.advocate_status AS advocateStatus,
       p.firm_name AS firmName,p.bio,p.city,p.region,p.education,
       p.consultation_formats_json AS consultationFormatsJson,
       p.profile_photo_key AS profilePhotoKey,p.profile_revision AS profileRevision,
       p.updated_at AS updatedAt,
       CASE WHEN u.phone IS NOT NULL AND length(trim(u.phone))>0 THEN 1 ELSE 0 END AS hasPhone,
       (SELECT m.reason FROM lawyer_profile_moderation m
         WHERE m.lawyer_profile_id=p.id AND m.profile_revision=p.profile_revision
           AND m.decision='changes_requested'
         ORDER BY m.created_at DESC LIMIT 1) AS moderationReason
     FROM lawyer_profiles p
     JOIN user_profiles u ON u.id=p.user_id
     WHERE p.user_id=? LIMIT 1`,
    )
    .bind(userId)
    .first<LawyerProfile>();
}

async function ownModerationHistory(profileId: string) {
  const history = await requireD1().prepare(
    `SELECT profile_revision AS profileRevision,decision,reason,
      created_at AS createdAt
     FROM lawyer_profile_moderation
     WHERE lawyer_profile_id=?
     ORDER BY created_at DESC,id DESC LIMIT 25`,
  ).bind(profileId).all<ModerationHistoryItem>();
  return history.results;
}

function changed(current: EditableProfile, next: EditableProfile): boolean {
  return (
    current.displayName !== next.displayName ||
    JSON.stringify(current.specialties) !== JSON.stringify(next.specialties) ||
    JSON.stringify(current.languages) !== JSON.stringify(next.languages) ||
    current.experienceYears !== next.experienceYears ||
    current.priceDescription !== next.priceDescription ||
    current.consultationDurationMinutes !== next.consultationDurationMinutes ||
    JSON.stringify(current.additionalServices) !==
      JSON.stringify(next.additionalServices) ||
    current.availabilityStatus !== next.availabilityStatus ||
    current.nextAvailableAt !== next.nextAvailableAt ||
    current.advocateStatus !== next.advocateStatus ||
    current.firmName !== next.firmName ||
    current.bio !== next.bio ||
    current.city !== next.city ||
    current.region !== next.region ||
    current.education !== next.education ||
    JSON.stringify(current.consultationFormats) !==
      JSON.stringify(next.consultationFormats)
  );
}

function moderatedFieldsChanged(
  current: EditableProfile,
  next: EditableProfile,
): boolean {
  return (
    current.displayName !== next.displayName ||
    JSON.stringify(current.specialties) !== JSON.stringify(next.specialties) ||
    JSON.stringify(current.languages) !== JSON.stringify(next.languages) ||
    current.experienceYears !== next.experienceYears ||
    current.priceDescription !== next.priceDescription ||
    current.consultationDurationMinutes !== next.consultationDurationMinutes ||
    JSON.stringify(current.additionalServices) !==
      JSON.stringify(next.additionalServices) ||
    current.advocateStatus !== next.advocateStatus ||
    current.firmName !== next.firmName ||
    current.bio !== next.bio ||
    current.city !== next.city ||
    current.region !== next.region ||
    current.education !== next.education ||
    JSON.stringify(current.consultationFormats) !==
      JSON.stringify(next.consultationFormats)
  );
}

export const GET = withApiErrors(async function GET() {
  if (!isLawyerProfileDirectoryPreviewEnabled(runtimeEnv())) {
    return response({ code: "NOT_AVAILABLE" }, 404);
  }
  const user = await requireApiUser();
  if (!(await accountIsLawyer(user.id))) {
    return response(
      { code: "PROFILE_FORBIDDEN" },
      403,
    );
  }
  const profile = await ownProfile(user.id);
  return response({
    profile: profile
      ? serialize(profile, await ownModerationHistory(profile.id))
      : null,
  });
});

export const POST = withApiErrors(async function POST(request: Request) {
  if (!isLawyerProfileDirectoryPreviewEnabled(runtimeEnv())) {
    return response({ code: "NOT_AVAILABLE" }, 404);
  }
  assertSafeWrite(request);
  const user = await requireApiUser();
  const parsed = await parseJsonRequest(
    request,
    lawyerProfileCreateSchema,
    12_288,
  );
  const locale = parsed.ok ? parsed.data.locale : "ru";
  if (!parsed.ok) {
    return response(
      {
        code: "INVALID_INPUT",
        error: lawyerProfileError(locale, "INVALID_INPUT"),
      },
      parsed.error === "payload_too_large" ? 413 : 400,
    );
  }
  if (!(await accountIsLawyer(user.id))) {
    return response(
      {
        code: "PROFILE_FORBIDDEN",
        error: lawyerProfileError(locale, "PROFILE_FORBIDDEN"),
      },
      403,
    );
  }
  if (await ownProfile(user.id)) {
    return response(
      {
        code: "PROFILE_UNAVAILABLE",
        error: lawyerProfileError(locale, "PROFILE_UNAVAILABLE"),
      },
      409,
    );
  }
  const workspace = await workspaceForUser(user);
  const now = isoNow();
  const id = crypto.randomUUID();
  const db = requireD1();
  const value = parsed.data;
  const notification = localizedLawyerProfileStatusNotification(
    locale,
    "profile_incomplete",
  );
  await db.batch([
    db
      .prepare(
        `INSERT INTO lawyer_profiles (
        id,user_id,display_name,specialties_json,languages_json,status,marketplace_status,
        experience_years,price_description,consultation_duration_minutes,
        additional_services_json,availability_status,next_available_at,
        advocate_status,firm_name,bio,city,region,education,consultation_formats_json,
        created_at,updated_at
      ) VALUES (?,?,?,?,?,'pending','profile_incomplete',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        user.id,
        value.displayName,
        JSON.stringify(value.specialties),
        JSON.stringify(value.languages),
        value.experienceYears ?? null,
        value.priceDescription ?? null,
        value.consultationDurationMinutes,
        JSON.stringify(value.additionalServices ?? []),
        value.availabilityStatus,
        value.nextAvailableAt ?? null,
        value.advocateStatus,
        value.firmName ?? null,
        value.bio ?? null,
        value.city ?? null,
        value.region ?? null,
        value.education ?? null,
        JSON.stringify(value.consultationFormats ?? []),
        now,
        now,
      ),
    db
      .prepare(
        `INSERT INTO notifications
        (id,workspace_id,user_id,document_id,type,title,body,read_at,created_at)
       VALUES (?,?,?,NULL,'lawyer_profile_status',?,?,NULL,?)`,
      )
      .bind(
        crypto.randomUUID(),
        workspace.id,
        user.id,
        notification.title,
        notification.body,
        now,
      ),
    db
      .prepare(
        `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       VALUES (?,?,?,'lawyer_profile',?,'lawyer_profile_created',?,?)`,
      )
      .bind(
        crypto.randomUUID(),
        workspace.id,
        user.id,
        id,
        JSON.stringify({ marketplaceStatus: "profile_incomplete" }),
        now,
      ),
  ]);
  const profile = await ownProfile(user.id);
  return response({
    profile: profile
      ? serialize(profile, await ownModerationHistory(profile.id))
      : null,
  }, 201);
});

export const PATCH = withApiErrors(async function PATCH(request: Request) {
  if (!isLawyerProfileDirectoryPreviewEnabled(runtimeEnv())) {
    return response({ code: "NOT_AVAILABLE" }, 404);
  }
  assertSafeWrite(request);
  const user = await requireApiUser();
  const parsed = await parseJsonRequest(
    request,
    lawyerProfileUpdateSchema,
    12_288,
  );
  const locale = parsed.ok ? (parsed.data.locale ?? "ru") : "ru";
  if (!parsed.ok) {
    return response(
      {
        code: "INVALID_INPUT",
        error: lawyerProfileError(locale, "INVALID_INPUT"),
      },
      parsed.error === "payload_too_large" ? 413 : 400,
    );
  }
  if (!(await accountIsLawyer(user.id))) {
    return response(
      {
        code: "PROFILE_FORBIDDEN",
        error: lawyerProfileError(locale, "PROFILE_FORBIDDEN"),
      },
      403,
    );
  }
  const profile = await ownProfile(user.id);
  if (!profile) {
    return response(
      {
        code: "PROFILE_UNAVAILABLE",
        error: lawyerProfileError(locale, "PROFILE_UNAVAILABLE"),
      },
      404,
    );
  }
  if (isRestrictedLawyerMarketplaceStatus(profile.marketplaceStatus)) {
    return response(
      {
        code: "PROFILE_LOCKED",
        error: lawyerProfileError(locale, "PROFILE_LOCKED"),
      },
      423,
    );
  }
  const value = parsed.data;
  const current = toEditable(profile);
  const next: EditableProfile = {
    displayName: value.displayName ?? current.displayName,
    specialties: value.specialties ?? current.specialties,
    languages: value.languages ?? current.languages,
    experienceYears:
      value.experienceYears === undefined
        ? current.experienceYears
        : value.experienceYears,
    priceDescription:
      value.priceDescription === undefined
        ? current.priceDescription
        : value.priceDescription,
    consultationDurationMinutes:
      value.consultationDurationMinutes ?? current.consultationDurationMinutes,
    additionalServices:
      value.additionalServices ?? current.additionalServices,
    availabilityStatus: value.availabilityStatus ?? current.availabilityStatus,
    nextAvailableAt:
      value.nextAvailableAt === undefined
        ? current.nextAvailableAt
        : value.nextAvailableAt,
    advocateStatus:
      profile.advocateStatus === "verified"
        ? "verified"
        : (value.advocateStatus ?? current.advocateStatus),
    firmName: value.firmName === undefined ? current.firmName : value.firmName,
    bio: value.bio === undefined ? current.bio : value.bio,
    city: value.city === undefined ? current.city : value.city,
    region: value.region === undefined ? current.region : value.region,
    education:
      value.education === undefined ? current.education : value.education,
    consultationFormats:
      value.consultationFormats ?? current.consultationFormats,
  };
  if (!changed(current, next)) {
    return response({
      profile: serialize(profile, await ownModerationHistory(profile.id)),
    });
  }

  const preservesPublishedProfile = profile.status === "public_approved"
    && profile.marketplaceStatus === "public_approved"
    && !moderatedFieldsChanged(current, next);
  const marketplaceStatus = preservesPublishedProfile
    ? "public_approved"
    : "profile_incomplete";
  const profileStatus = preservesPublishedProfile
    ? "public_approved"
    : "pending";
  const missingRequiredFields = missingLawyerMarketplaceFields(
    completion(profile, next),
  );
  const workspace = await workspaceForUser(user);
  const now = isoNow();
  const db = requireD1();
  const auditId = crypto.randomUUID();
  const statusChanged = profile.marketplaceStatus !== marketplaceStatus;
  const notification = localizedLawyerProfileStatusNotification(
    locale,
    marketplaceStatus,
  );
  const resultingRevision = preservesPublishedProfile
    ? profile.profileRevision
    : profile.profileRevision + 1;
  const updateStatement = preservesPublishedProfile
    ? db
        .prepare(
          `UPDATE lawyer_profiles SET
         availability_status=?,next_available_at=?,updated_at=?
         WHERE id=? AND user_id=? AND profile_revision=?
           AND status='public_approved' AND marketplace_status='public_approved'
           AND updated_at=?`,
        )
        .bind(
          next.availabilityStatus,
          next.nextAvailableAt,
          now,
          profile.id,
          user.id,
          profile.profileRevision,
          profile.updatedAt,
        )
    : db
        .prepare(
          `UPDATE lawyer_profiles SET
         display_name=?,specialties_json=?,languages_json=?,experience_years=?,
         price_description=?,consultation_duration_minutes=?,additional_services_json=?,
         availability_status=?,next_available_at=?,advocate_status=?,
         firm_name=?,bio=?,city=?,region=?,education=?,consultation_formats_json=?,
         profile_revision=profile_revision+1,status=?,marketplace_status=?,
         public_approved_at=NULL,updated_at=?
         WHERE id=? AND user_id=? AND profile_revision=?`,
        )
        .bind(
          next.displayName,
          JSON.stringify(next.specialties),
          JSON.stringify(next.languages),
          next.experienceYears,
          next.priceDescription,
          next.consultationDurationMinutes,
          JSON.stringify(next.additionalServices),
          next.availabilityStatus,
          next.nextAvailableAt,
          next.advocateStatus,
          next.firmName,
          next.bio,
          next.city,
          next.region,
          next.education,
          JSON.stringify(next.consultationFormats),
          profileStatus,
          marketplaceStatus,
          now,
          profile.id,
          user.id,
          profile.profileRevision,
        );
  const statements = [
    updateStatement,
    db
      .prepare(
        `INSERT INTO workspace_audit_events
       (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       SELECT ?,?,?,'lawyer_profile',?,'lawyer_profile_draft_saved',?,?
       WHERE EXISTS (
         SELECT 1 FROM lawyer_profiles
         WHERE id=? AND user_id=? AND profile_revision=?
           AND status=? AND marketplace_status=? AND updated_at=?
       )`,
      )
      .bind(
        auditId,
        workspace.id,
        user.id,
        profile.id,
        JSON.stringify({
          previousRevision: profile.profileRevision,
          marketplaceStatus,
          missingRequiredFields,
          publicationPreserved: preservesPublishedProfile,
        }),
        now,
        profile.id,
        user.id,
        resultingRevision,
        profileStatus,
        marketplaceStatus,
        now,
      ),
  ];
  if (statusChanged) {
    statements.push(
      db
        .prepare(
          `INSERT INTO notifications
          (id,workspace_id,user_id,document_id,type,title,body,read_at,created_at)
         SELECT ?,?,?,NULL,'lawyer_profile_status',?,?,NULL,?
         WHERE EXISTS (
           SELECT 1 FROM lawyer_profiles
           WHERE id=? AND user_id=? AND profile_revision=?
           AND status=? AND marketplace_status=? AND updated_at=?
         )`,
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
          resultingRevision,
          profileStatus,
          marketplaceStatus,
          now,
        ),
    );
  }
  const results = await db.batch(statements);
  if (
    Number(results[0]?.meta.changes ?? 0) !== 1 ||
    Number(results[1]?.meta.changes ?? 0) !== 1 ||
    (statusChanged && Number(results[2]?.meta.changes ?? 0) !== 1)
  ) {
    return response(
      {
        code: "PROFILE_UNAVAILABLE",
        error: lawyerProfileError(locale, "PROFILE_UNAVAILABLE"),
      },
      409,
    );
  }
  const updated = await ownProfile(user.id);
  return response({
    profile: updated
      ? serialize(updated, await ownModerationHistory(updated.id))
      : null,
  });
});
