import { isLawyerMarketplaceProfileComplete } from "./lawyer-marketplace";
import { localizedLawyerProfileStatusNotification } from "./lawyer-profile-notifications";
import type { PlatformLocale } from "./routing";

type PendingProfile = {
  id: string;
  userId: string;
  workspaceId: string | null;
  locale: PlatformLocale;
  profileRevision: number;
  displayName: string;
  specialtiesJson: string;
  languagesJson: string;
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
  hasPhone: number;
};

export class LawyerProfileModerationError extends Error {
  constructor(public readonly code: "PROFILE_UNAVAILABLE" | "PROFILE_INCOMPLETE") {
    super(code);
    this.name = "LawyerProfileModerationError";
  }
}

function stringList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(hash), (item) => item.toString(16).padStart(2, "0")).join("");
}

/**
 * The mutable status transition is centralized because it is reached both by
 * the legacy in-app admin route and the isolated admin Worker. The database
 * trigger remains the authority that applies the public profile status.
 */
export async function moderateLawyerProfile(
  db: D1Database,
  input: {
    profileId: string;
    moderatorUserId: string | null;
    adminSessionId?: string;
    decision: "approved" | "changes_requested" | "rejected";
    reason: string;
    now?: Date;
  },
): Promise<{ status: "public_approved" | "changes_requested" | "rejected" }> {
  const profile = await db.prepare(
    `SELECT p.id,p.user_id AS userId,u.default_workspace_id AS workspaceId,
       CASE u.locale WHEN 'uz' THEN 'uz' WHEN 'en' THEN 'en' ELSE 'ru' END AS locale,
       p.profile_revision AS profileRevision,
       p.display_name AS displayName,p.specialties_json AS specialtiesJson,
       p.languages_json AS languagesJson,p.experience_years AS experienceYears,
       p.price_description AS priceDescription,
       p.consultation_duration_minutes AS consultationDurationMinutes,
       p.additional_services_json AS additionalServicesJson,
       p.availability_status AS availabilityStatus,
       p.next_available_at AS nextAvailableAt,p.advocate_status AS advocateStatus,
       p.firm_name AS firmName,p.bio,p.city,p.region,p.education,
       p.consultation_formats_json AS consultationFormatsJson,
       p.profile_photo_key AS profilePhotoKey,
       CASE WHEN u.phone IS NOT NULL AND length(trim(u.phone))>0 THEN 1 ELSE 0 END AS hasPhone
     FROM lawyer_profiles p JOIN user_profiles u ON u.id=p.user_id
     WHERE p.id=? AND p.status='pending' AND p.marketplace_status='pending_review'
     LIMIT 1`,
  ).bind(input.profileId).first<PendingProfile>();
  if (!profile?.workspaceId) throw new LawyerProfileModerationError("PROFILE_UNAVAILABLE");
  if (!isLawyerMarketplaceProfileComplete({
    displayName: profile.displayName,
    specialties: stringList(profile.specialtiesJson),
    languages: stringList(profile.languagesJson),
    experienceYears: profile.experienceYears,
    education: profile.education,
    firmName: profile.firmName,
    city: profile.city,
    region: profile.region,
    priceDescription: profile.priceDescription,
    consultationFormats: stringList(profile.consultationFormatsJson),
    availabilityStatus: profile.availabilityStatus,
    profilePhotoKey: profile.profilePhotoKey,
    hasPhone: profile.hasPhone === 1,
  })) throw new LawyerProfileModerationError("PROFILE_INCOMPLETE");

  const now = (input.now ?? new Date()).toISOString();
  const moderationId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const notificationId = crypto.randomUUID();
  const profileSha256 = await sha256(JSON.stringify({
    id: profile.id,
    revision: profile.profileRevision,
    displayName: profile.displayName,
    specialtiesJson: profile.specialtiesJson,
    languagesJson: profile.languagesJson,
    experienceYears: profile.experienceYears,
    priceDescription: profile.priceDescription,
    consultationDurationMinutes: profile.consultationDurationMinutes,
    additionalServicesJson: profile.additionalServicesJson,
    availabilityStatus: profile.availabilityStatus,
    nextAvailableAt: profile.nextAvailableAt,
    advocateStatus: profile.advocateStatus,
    firmName: profile.firmName,
    bio: profile.bio,
    city: profile.city,
    region: profile.region,
    education: profile.education,
    consultationFormatsJson: profile.consultationFormatsJson,
    profilePhotoKey: profile.profilePhotoKey,
  }));
  const resultStatus = input.decision === "approved"
    ? "public_approved"
    : input.decision === "changes_requested"
      ? "changes_requested"
      : "rejected";
  // The legacy status column remains the booking authority. A profile awaiting
  // corrections stays non-bookable (`pending`); marketplace_status carries the
  // reviewer-visible correction state until the lawyer edits and resubmits it.
  const expectedProfileStatus = resultStatus === "changes_requested" ? "pending" : resultStatus;
  const notification = localizedLawyerProfileStatusNotification(profile.locale, resultStatus, input.reason);
  try {
    const results = await db.batch([
      db.prepare(
        `INSERT INTO lawyer_profile_moderation (
           id,lawyer_profile_id,profile_revision,moderator_user_id,decision,
           reason,profile_sha256,created_at,admin_session_id
         ) SELECT ?,?,?,?,?,?,?,?,?
         WHERE EXISTS (
           SELECT 1 FROM lawyer_profiles
           WHERE id=? AND profile_revision=? AND status='pending'
         )`,
      ).bind(
        moderationId, profile.id, profile.profileRevision, input.moderatorUserId,
        input.decision, input.reason, profileSha256, now, input.adminSessionId??null,
        profile.id, profile.profileRevision,
      ),
      db.prepare(
        `INSERT INTO workspace_audit_events (
           id,workspace_id,actor_user_id,entity_type,entity_id,action,
           metadata_json,created_at
         ) SELECT ?,?,?,'lawyer_profile',?,'lawyer_profile_moderated',?,?
         WHERE EXISTS (
           SELECT 1 FROM lawyer_profile_moderation
           WHERE id=? AND lawyer_profile_id=? AND profile_revision=?
             AND moderator_user_id IS NOT DISTINCT FROM ? AND decision=?
         )`,
      ).bind(
        auditId, profile.workspaceId, input.moderatorUserId, profile.id,
        JSON.stringify({ decision: input.decision, profileRevision: profile.profileRevision, profileSha256 }),
        now, moderationId, profile.id, profile.profileRevision,
        input.moderatorUserId, input.decision,
      ),
      db.prepare(
        `INSERT INTO notifications
          (id,workspace_id,user_id,document_id,type,title,body,read_at,created_at)
         SELECT ?,?,?,NULL,'lawyer_profile_status',?,?,NULL,?
         WHERE EXISTS (
           SELECT 1 FROM lawyer_profile_moderation
           WHERE id=? AND lawyer_profile_id=? AND profile_revision=?
             AND moderator_user_id IS NOT DISTINCT FROM ? AND decision=?
         )`,
      ).bind(
        notificationId, profile.workspaceId, profile.userId, notification.title,
        notification.body, now, moderationId, profile.id, profile.profileRevision,
        input.moderatorUserId, input.decision,
      ),
      db.prepare(
        `UPDATE lawyer_profiles SET marketplace_status=?,public_approved_at=CASE WHEN ?='public_approved' THEN ? ELSE NULL END,updated_at=?
         WHERE id=? AND profile_revision=? AND status=?`,
      ).bind(resultStatus, resultStatus, now, now, profile.id, profile.profileRevision, expectedProfileStatus),
    ]);
    if (
      Number(results[0]?.meta.changes ?? 0) !== 1
      || Number(results[1]?.meta.changes ?? 0) !== 1
      || Number(results[2]?.meta.changes ?? 0) !== 1
      || Number(results[3]?.meta.changes ?? 0) !== 1
    ) throw new LawyerProfileModerationError("PROFILE_UNAVAILABLE");
  } catch (error) {
    if (error instanceof LawyerProfileModerationError) throw error;
    throw new LawyerProfileModerationError("PROFILE_UNAVAILABLE");
  }
  return { status: resultStatus };
}
