SET LOCAL search_path = app, public;

-- Public versions describe review submissions, independently of edit revisions.
CREATE TABLE lawyer_profile_submission_versions (
  lawyer_profile_id text NOT NULL REFERENCES lawyer_profiles(id) ON DELETE CASCADE,
  profile_revision bigint NOT NULL,
  submission_version integer NOT NULL CHECK (submission_version > 0),
  submitted_at text NOT NULL,
  PRIMARY KEY (lawyer_profile_id, profile_revision),
  UNIQUE (lawyer_profile_id, submission_version)
);

-- Preserve existing review history. A decision without a retained submission
-- event still proves that this revision reached review; drafts do not.
WITH evidence AS (
  SELECT e.entity_id AS profile_id,
    (e.metadata_json::jsonb->>'profileRevision')::bigint AS revision,
    e.created_at
  FROM workspace_audit_events e JOIN lawyer_profiles p ON p.id=e.entity_id
  WHERE e.entity_type='lawyer_profile' AND e.action='lawyer_profile_submitted'
    AND (e.metadata_json::jsonb->>'profileRevision') ~ '^[0-9]+$'
  UNION ALL
  SELECT lawyer_profile_id,profile_revision,created_at FROM lawyer_profile_moderation
), reviewed AS (
  SELECT profile_id,revision,min(created_at) AS submitted_at
  FROM evidence GROUP BY profile_id,revision
)
INSERT INTO lawyer_profile_submission_versions
SELECT profile_id,revision,
  row_number() OVER (PARTITION BY profile_id ORDER BY submitted_at,revision)::integer,
  submitted_at FROM reviewed;

CREATE FUNCTION record_lawyer_submission_version(profile_id text, revision bigint, submitted text)
RETURNS void LANGUAGE plpgsql SET search_path = app, public AS $$
BEGIN
  -- Serialize version allocation with edits/submissions for this profile.
  PERFORM 1 FROM lawyer_profiles WHERE id=profile_id FOR UPDATE;
  INSERT INTO lawyer_profile_submission_versions
    (lawyer_profile_id,profile_revision,submission_version,submitted_at)
  SELECT profile_id,revision,coalesce(max(submission_version),0)+1,submitted
  FROM lawyer_profile_submission_versions WHERE lawyer_profile_id=profile_id
  ON CONFLICT (lawyer_profile_id,profile_revision) DO NOTHING;
END;
$$;

CREATE FUNCTION record_lawyer_submission_event_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, public AS $$
BEGIN
  PERFORM record_lawyer_submission_version(NEW.entity_id,
    (NEW.metadata_json::jsonb->>'profileRevision')::bigint,NEW.created_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER lawyer_submission_event_version AFTER INSERT ON workspace_audit_events
FOR EACH ROW WHEN (NEW.entity_type='lawyer_profile' AND NEW.action='lawyer_profile_submitted')
EXECUTE FUNCTION record_lawyer_submission_event_version();

-- Also cover review entry paths that predate explicit submission events.
-- Approval of an already submitted revision keeps the same public version.
CREATE FUNCTION record_lawyer_moderation_version() RETURNS trigger
LANGUAGE plpgsql SET search_path = app, public AS $$
BEGIN
  PERFORM record_lawyer_submission_version(NEW.lawyer_profile_id,NEW.profile_revision,NEW.created_at);
  RETURN NEW;
END;
$$;
CREATE TRIGGER lawyer_moderation_submission_version AFTER INSERT ON lawyer_profile_moderation
FOR EACH ROW EXECUTE FUNCTION record_lawyer_moderation_version();
