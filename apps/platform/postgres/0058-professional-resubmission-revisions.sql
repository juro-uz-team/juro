-- Unchanged resubmissions previously reused an already decided edit revision.
-- Give those pending reviews a fresh identity without changing earlier decisions.
SET LOCAL search_path = app, public;

WITH repaired AS (
  UPDATE app.lawyer_profiles p
  SET profile_revision=p.profile_revision+1
  WHERE p.status='pending' AND p.marketplace_status='pending_review'
    AND EXISTS (
      SELECT 1 FROM app.lawyer_profile_moderation m
      WHERE m.lawyer_profile_id=p.id AND m.profile_revision=p.profile_revision
    )
  RETURNING p.id,p.profile_revision,p.updated_at
)
SELECT app.record_lawyer_submission_version(id,profile_revision,updated_at)
FROM repaired;
