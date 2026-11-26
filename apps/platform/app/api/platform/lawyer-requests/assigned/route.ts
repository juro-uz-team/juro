import { requireApiUser, withApiErrors } from "../../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../../lib/document-builder/storage/runtime";

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

export const GET = withApiErrors(async function GET() {
  const user = await requireApiUser();
  const db = requireD1();
  const requests = await db.prepare(
    `SELECT r.id,r.status,r.anonymized_summary AS anonymizedSummary,r.created_at AS createdAt,
      json_extract(r.requested_scope_json,'$.paidTransfer') AS paidTransfer,
      json_extract(r.requested_scope_json,'$.serviceCode') AS serviceCode,
      json_extract(r.requested_scope_json,'$.preferredFormat') AS preferredFormat,
      json_extract(r.requested_scope_json,'$.proposedStartsAt') AS proposedStartsAt,
      c.status AS conflictStatus,g.id AS accessGrantId,g.created_at AS accessGrantedAt,
      CASE WHEN g.id IS NOT NULL THEN cs.id END AS caseId,
      CASE WHEN g.id IS NOT NULL THEN cs.title END AS caseTitle,
      CASE WHEN g.id IS NOT NULL THEN cs.description END AS caseDescription,
      CASE WHEN g.id IS NOT NULL THEN cs.legal_area END AS legalArea,
      CASE WHEN g.id IS NOT NULL THEN cs.status END AS caseStatus,
      CASE WHEN g.id IS NOT NULL THEN (SELECT o.id FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) END AS offerId,
      CASE WHEN g.id IS NOT NULL THEN (SELECT o.status FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) END AS offerStatus,
      CASE WHEN g.id IS NOT NULL THEN (SELECT o.scope_description FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) END AS offerScopeDescription,
      CASE WHEN g.id IS NOT NULL THEN (SELECT o.price_description FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) END AS offerPriceDescription,
      CASE WHEN g.id IS NOT NULL THEN (SELECT o.duration_description FROM lawyer_offers o WHERE o.lawyer_request_id=r.id ORDER BY o.version DESC LIMIT 1) END AS offerDurationDescription
      ,(SELECT review.id FROM lawyer_reviews review JOIN lawyer_review_moderation moderation ON moderation.review_id=review.id AND moderation.decision='approved' WHERE review.lawyer_request_id=r.id AND review.status='approved' LIMIT 1) AS reviewId
      ,(SELECT review.overall_rating FROM lawyer_reviews review JOIN lawyer_review_moderation moderation ON moderation.review_id=review.id AND moderation.decision='approved' WHERE review.lawyer_request_id=r.id AND review.status='approved' LIMIT 1) AS reviewOverallRating
      ,(SELECT COALESCE(moderation.moderated_body,review.body) FROM lawyer_reviews review JOIN lawyer_review_moderation moderation ON moderation.review_id=review.id AND moderation.decision='approved' WHERE review.lawyer_request_id=r.id AND review.status='approved' LIMIT 1) AS reviewBody
      ,(SELECT reply.id FROM lawyer_review_replies reply JOIN lawyer_reviews review ON review.id=reply.review_id WHERE review.lawyer_request_id=r.id ORDER BY reply.version DESC LIMIT 1) AS reviewReplyId
      ,(SELECT reply.status FROM lawyer_review_replies reply JOIN lawyer_reviews review ON review.id=reply.review_id WHERE review.lawyer_request_id=r.id ORDER BY reply.version DESC LIMIT 1) AS reviewReplyStatus
      ,(SELECT reply.body FROM lawyer_review_replies reply JOIN lawyer_reviews review ON review.id=reply.review_id WHERE review.lawyer_request_id=r.id ORDER BY reply.version DESC LIMIT 1) AS reviewReplyBody
      ,(SELECT reply.version FROM lawyer_review_replies reply JOIN lawyer_reviews review ON review.id=reply.review_id WHERE review.lawyer_request_id=r.id ORDER BY reply.version DESC LIMIT 1) AS reviewReplyVersion
     FROM lawyer_requests r
     JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id AND p.user_id=? AND p.status='public_approved' AND p.marketplace_status='public_approved'
     JOIN conflict_checks c ON c.lawyer_request_id=r.id AND c.lawyer_profile_id=p.id
     LEFT JOIN lawyer_access_grants g ON g.lawyer_request_id=r.id AND g.lawyer_user_id=? AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at>?)
     LEFT JOIN cases cs ON cs.id=g.case_id
     ORDER BY r.updated_at DESC LIMIT 100`,
  ).bind(user.id, user.id, new Date().toISOString()).all();
  return response({ requests: requests.results });
});
