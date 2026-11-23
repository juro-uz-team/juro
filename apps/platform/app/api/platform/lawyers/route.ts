import { requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { projectPublicLawyerDirectory } from "../../../../lib/platform/lawyer-directory-reviews";

export const GET = withApiErrors(async function GET() {
  await requireApiUser();
  const db = requireD1();
  const lawyers = await db.prepare(
    `SELECT id,display_name AS displayName,specialties_json AS specialtiesJson,languages_json AS languagesJson,
       experience_years AS experienceYears,price_description AS priceDescription,
       consultation_duration_minutes AS consultationDurationMinutes,
       additional_services_json AS additionalServicesJson,availability_status AS availabilityStatus,
       next_available_at AS nextAvailableAt,advocate_status AS advocateStatus,firm_name AS firmName,bio,
       marketplace_status AS marketplaceStatus,city,region,education,
       consultation_formats_json AS consultationFormatsJson,
       juro_approval_status AS juroApprovalStatus,top_lawyer_status AS topLawyerStatus,
       top_lawyer_criteria AS topLawyerCriteria,
       CASE WHEN profile_photo_key IS NOT NULL THEN '/api/platform/lawyers/' || id || '/photo' ELSE NULL END AS profilePhotoUrl
     FROM lawyer_profiles
     WHERE status='public_approved' AND marketplace_status='public_approved'
       AND public_approved_at IS NOT NULL
     ORDER BY display_name COLLATE NOCASE LIMIT 100`,
  ).all<{ id: string; displayName: string; specialtiesJson: unknown; languagesJson: unknown; experienceYears: number | null; priceDescription: string | null; consultationDurationMinutes: number; additionalServicesJson: unknown; availabilityStatus: string; nextAvailableAt: string | null; advocateStatus: string; firmName: string | null; bio: string | null; marketplaceStatus: string; city: string | null; region: string | null; education: string | null; consultationFormatsJson: unknown; profilePhotoUrl: string | null; juroApprovalStatus: string; topLawyerStatus: string; topLawyerCriteria: string | null }>();
  const aggregates = await db.prepare(
    `SELECT r.lawyer_profile_id AS lawyerProfileId,
      COUNT(*) AS reviewCount,
      AVG(r.overall_rating) AS overallAverage,
      AVG(r.speed_rating) AS speedAverage,
      AVG(r.quality_rating) AS qualityAverage,
      AVG(r.communication_rating) AS communicationAverage
     FROM lawyer_reviews r
     JOIN lawyer_review_moderation m ON m.review_id=r.id AND m.decision='approved'
     JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id
     WHERE r.status='approved' AND p.status='public_approved' AND p.marketplace_status='public_approved' AND p.public_approved_at IS NOT NULL
     GROUP BY r.lawyer_profile_id`,
  ).all<{ lawyerProfileId: string; reviewCount: number; overallAverage: number; speedAverage: number; qualityAverage: number; communicationAverage: number }>();
  const reviews = await db.prepare(
    `WITH ranked_reviews AS (
      SELECT r.id AS reviewId,r.lawyer_profile_id AS lawyerProfileId,r.overall_rating AS overallRating,
        COALESCE(m.moderated_body,r.body) AS body,r.created_at AS createdAt,
        (SELECT COALESCE(replyModeration.moderated_body,reply.body)
         FROM lawyer_review_replies reply
         JOIN lawyer_review_reply_moderation replyModeration ON replyModeration.reply_id=reply.id AND replyModeration.decision='approved'
         WHERE reply.review_id=r.id AND reply.status='approved'
         ORDER BY reply.version DESC LIMIT 1) AS replyBody,
        (SELECT reply.created_at FROM lawyer_review_replies reply
         JOIN lawyer_review_reply_moderation replyModeration ON replyModeration.reply_id=reply.id AND replyModeration.decision='approved'
         WHERE reply.review_id=r.id AND reply.status='approved'
         ORDER BY reply.version DESC LIMIT 1) AS replyCreatedAt,
        ROW_NUMBER() OVER (PARTITION BY r.lawyer_profile_id ORDER BY m.created_at DESC,r.id DESC) AS reviewRank
      FROM lawyer_reviews r
      JOIN lawyer_review_moderation m ON m.review_id=r.id AND m.decision='approved'
      JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id
      WHERE r.status='approved' AND p.status='public_approved' AND p.marketplace_status='public_approved' AND p.public_approved_at IS NOT NULL
    )
    SELECT reviewId,lawyerProfileId,overallRating,body,createdAt,replyBody,replyCreatedAt
    FROM ranked_reviews WHERE reviewRank <= 3
    ORDER BY lawyerProfileId ASC,createdAt DESC`,
  ).all<{ reviewId: string; lawyerProfileId: string; overallRating: number; body: string | null; createdAt: string; replyBody: string | null; replyCreatedAt: string | null }>();
  return Response.json({
    lawyers: projectPublicLawyerDirectory(lawyers.results, aggregates.results, reviews.results),
  }, { headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
});
