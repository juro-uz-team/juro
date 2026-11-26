SET search_path TO app, public;

CREATE TABLE company_case_participants (
  case_id text NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES workspace_members(id) ON DELETE CASCADE,
  PRIMARY KEY (case_id, member_id)
);
CREATE INDEX company_case_participants_member ON company_case_participants(member_id,case_id);

INSERT INTO company_case_participants(case_id,member_id)
SELECT c.id,m.id
FROM cases c JOIN workspaces w ON w.id=c.workspace_id AND w.type='business'
JOIN workspace_members m ON m.workspace_id=w.id AND m.status='active';

CREATE FUNCTION app.case_visible_to(case_key text, actor text) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO app, public AS $$
  SELECT EXISTS(
    SELECT 1 FROM cases c JOIN workspaces w ON w.id=c.workspace_id
    JOIN workspace_members m ON m.workspace_id=c.workspace_id AND m.user_id=actor AND m.status='active'
    WHERE c.id=case_key AND (w.type<>'business' OR EXISTS(
      SELECT 1 FROM company_case_participants p WHERE p.case_id=c.id AND p.member_id=m.id
    ))
  );
$$;

CREATE FUNCTION app.assign_company_case_creator() RETURNS trigger
LANGUAGE plpgsql SET search_path TO app, public AS $$
BEGIN
  INSERT INTO company_case_participants(case_id,member_id)
  SELECT NEW.id,m.id FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id
  WHERE m.workspace_id=NEW.workspace_id AND w.type='business'
    AND m.user_id=NEW.owner_user_id AND m.status='active';
  RETURN NEW;
END;
$$;
CREATE TRIGGER company_case_creator AFTER INSERT ON cases
  FOR EACH ROW EXECUTE FUNCTION assign_company_case_creator();

CREATE FUNCTION app.revoke_company_case_membership() RETURNS trigger
LANGUAGE plpgsql SET search_path TO app, public AS $$
BEGIN
  DELETE FROM company_case_participants WHERE member_id=NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER company_case_membership_ended AFTER UPDATE OF status ON workspace_members
  FOR EACH ROW WHEN (OLD.status='active' AND NEW.status<>'active')
  EXECUTE FUNCTION revoke_company_case_membership();
