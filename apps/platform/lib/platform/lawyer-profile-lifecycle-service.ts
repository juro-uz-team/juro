import {
  isLawyerMarketplaceProfileComplete,
  type LawyerMarketplaceStatus,
} from "./lawyer-marketplace";
import { localizedLawyerProfileStatusNotification } from "./lawyer-profile-notifications";
import type { PlatformLocale } from "./routing";

export type LawyerProfileLifecycleAction = "suspend" | "block" | "archive" | "restore";

type ProfileRow = {
  id: string;
  userId: string;
  workspaceId: string | null;
  locale: PlatformLocale;
  status: string;
  marketplaceStatus: LawyerMarketplaceStatus;
  profileRevision: number;
  displayName: string;
  specialtiesJson: string;
  languagesJson: string;
  experienceYears: number | null;
  priceDescription: string | null;
  availabilityStatus: string;
  firmName: string | null;
  city: string | null;
  region: string | null;
  education: string | null;
  consultationFormatsJson: string;
  profilePhotoKey: string | null;
  hasPhone: number;
};

export class LawyerProfileLifecycleError extends Error {
  constructor(public readonly code: "PROFILE_UNAVAILABLE" | "PROFILE_STATE_CONFLICT") {
    super(code);
    this.name = "LawyerProfileLifecycleError";
  }
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

function restoredStatus(profile: ProfileRow): "profile_incomplete" | "pending_review" {
  return isLawyerMarketplaceProfileComplete({
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
  }) ? "pending_review" : "profile_incomplete";
}

function targetFor(
  action: LawyerProfileLifecycleAction,
  profile: ProfileRow,
): { status: "pending"; marketplaceStatus: LawyerMarketplaceStatus; profileRevision: number } | null {
  if (action === "restore") {
    if (!["suspended", "blocked", "archived"].includes(profile.marketplaceStatus)) return null;
    return {
      status: "pending",
      marketplaceStatus: restoredStatus(profile),
      profileRevision: profile.profileRevision + 1,
    };
  }
  if (["suspended", "blocked", "archived"].includes(profile.marketplaceStatus)) return null;
  return {
    status: "pending",
    marketplaceStatus: action === "suspend" ? "suspended" : action === "block" ? "blocked" : "archived",
    profileRevision: profile.profileRevision,
  };
}

export async function transitionLawyerProfileLifecycle(
  db: D1Database,
  input: {
    profileId: string;
    actorUserId: string | null;
    adminSessionId?: string;
    action: LawyerProfileLifecycleAction;
    reason: string;
    now?: Date;
  },
): Promise<{ status: LawyerMarketplaceStatus; profileRevision: number }> {
  const profile = await db.prepare(
    `SELECT p.id,p.user_id AS userId,u.default_workspace_id AS workspaceId,
       CASE u.locale WHEN 'uz' THEN 'uz' WHEN 'en' THEN 'en' ELSE 'ru' END AS locale,
       p.status,p.marketplace_status AS marketplaceStatus,p.profile_revision AS profileRevision,
       p.display_name AS displayName,p.specialties_json AS specialtiesJson,
       p.languages_json AS languagesJson,p.experience_years AS experienceYears,
       p.price_description AS priceDescription,p.availability_status AS availabilityStatus,
       p.firm_name AS firmName,p.city,p.region,p.education,
       p.consultation_formats_json AS consultationFormatsJson,p.profile_photo_key AS profilePhotoKey,
       CASE WHEN u.phone IS NOT NULL AND length(trim(u.phone))>0 THEN 1 ELSE 0 END AS hasPhone
     FROM lawyer_profiles p JOIN user_profiles u ON u.id=p.user_id
     WHERE p.id=? LIMIT 1`,
  ).bind(input.profileId).first<ProfileRow>();
  if (!profile?.workspaceId) throw new LawyerProfileLifecycleError("PROFILE_UNAVAILABLE");

  const target = targetFor(input.action, profile);
  if (!target) throw new LawyerProfileLifecycleError("PROFILE_STATE_CONFLICT");

  const now = (input.now ?? new Date()).toISOString();
  const eventId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const notificationId = crypto.randomUUID();
  const notification = localizedLawyerProfileStatusNotification(profile.locale, target.marketplaceStatus, input.reason);
  const auditAction: Record<LawyerProfileLifecycleAction, string> = {
    suspend: "lawyer_profile_suspended",
    block: "lawyer_profile_blocked",
    archive: "lawyer_profile_archived",
    restore: "lawyer_profile_restored",
  };
  try {
    const statements = [
      db.prepare(
        `INSERT INTO lawyer_profile_lifecycle_events (
           id,lawyer_profile_id,from_profile_revision,to_profile_revision,
           actor_user_id,action,reason,from_profile_status,to_profile_status,
           from_marketplace_status,to_marketplace_status,created_at,admin_session_id
         ) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM lawyer_profiles
           WHERE id=? AND profile_revision=? AND status=? AND marketplace_status=?
         )`,
      ).bind(
        eventId, profile.id, profile.profileRevision, target.profileRevision,
        input.actorUserId, input.action, input.reason, profile.status, target.status,
        profile.marketplaceStatus, target.marketplaceStatus, now, input.adminSessionId ?? null,
        profile.id, profile.profileRevision, profile.status, profile.marketplaceStatus,
      ),
      db.prepare(
        `INSERT INTO workspace_audit_events (
           id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at
         ) SELECT ?,?,?,'lawyer_profile',?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM lawyer_profile_lifecycle_events
           WHERE id=? AND lawyer_profile_id=? AND actor_user_id IS NOT DISTINCT FROM ? AND action=?
         )`,
      ).bind(
        auditId, profile.workspaceId, input.actorUserId, profile.id,
        auditAction[input.action],
        JSON.stringify({
          action: input.action,
          fromMarketplaceStatus: profile.marketplaceStatus,
          toMarketplaceStatus: target.marketplaceStatus,
          fromProfileRevision: profile.profileRevision,
          toProfileRevision: target.profileRevision,
        }),
        now, eventId, profile.id, input.actorUserId, input.action,
      ),
      db.prepare(
        `INSERT INTO notifications
          (id,workspace_id,user_id,document_id,type,title,body,read_at,created_at)
         SELECT ?,?,?,NULL,'lawyer_profile_status',?,?,NULL,?
         WHERE EXISTS (SELECT 1 FROM lawyer_profile_lifecycle_events WHERE id=?)`,
      ).bind(
        notificationId, profile.workspaceId, profile.userId, notification.title,
        notification.body, now, eventId,
      ),
      db.prepare(
        `UPDATE lawyer_profiles
         SET status=?,marketplace_status=?,profile_revision=?,public_approved_at=NULL,updated_at=?
         WHERE id=? AND profile_revision=? AND status=? AND marketplace_status=?`,
      ).bind(
        target.status, target.marketplaceStatus, target.profileRevision, now,
        profile.id, profile.profileRevision, profile.status, profile.marketplaceStatus,
      ),
      ...(input.action === "restore" ? [] : [
        db.prepare(
          `UPDATE lawyer_access_grants
           SET revoked_at=?,revoke_reason=?
           WHERE lawyer_user_id=? AND revoked_at IS NULL`,
        ).bind(now, `profile_${input.action}`, profile.userId),
      ]),
    ];
    const results = await db.batch(statements);
    if (results.slice(0, 4).some((result) => Number(result.meta.changes ?? 0) !== 1)) {
      throw new LawyerProfileLifecycleError("PROFILE_STATE_CONFLICT");
    }
  } catch (error) {
    if (error instanceof LawyerProfileLifecycleError) throw error;
    throw new LawyerProfileLifecycleError("PROFILE_UNAVAILABLE");
  }
  return { status: target.marketplaceStatus, profileRevision: target.profileRevision };
}
