ALTER TABLE app.control_product_events ADD COLUMN user_id text REFERENCES app.user_profiles(id) ON DELETE SET NULL;
ALTER TABLE app.control_product_events ADD COLUMN feature text;
ALTER TABLE app.control_product_events ADD COLUMN account_type text;
ALTER TABLE app.control_product_events ADD COLUMN plan_code text;
CREATE INDEX control_event_user_time_idx ON app.control_product_events(user_id,created_at,event);
CREATE TABLE app.control_analytics_consent(user_id text PRIMARY KEY REFERENCES app.user_profiles(id) ON DELETE CASCADE,application text NOT NULL,visitor_id text NOT NULL,session_id text NOT NULL,device text NOT NULL,consented_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.control_template_categories(slug text PRIMARY KEY,title_ru text NOT NULL,title_uz text NOT NULL,position integer NOT NULL DEFAULT 0,active boolean NOT NULL DEFAULT true);
CREATE TABLE app.control_professional_details(profile_id text PRIMARY KEY REFERENCES app.lawyer_profiles(id) ON DELETE CASCADE,professional_type text NOT NULL CHECK(professional_type IN ('lawyer','advocate','firm','other')),organization_name text,registration_number text,license_number text,representatives jsonb NOT NULL DEFAULT '[]',revision bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE app.control_professional_documents(id text PRIMARY KEY,profile_id text NOT NULL REFERENCES app.lawyer_profiles(id) ON DELETE CASCADE,revision bigint NOT NULL,kind text NOT NULL CHECK(kind IN ('education','license','registration','authority','other')),file_name text NOT NULL,object_key text NOT NULL UNIQUE,mime text NOT NULL,size_bytes integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX control_professional_documents_profile_idx ON app.control_professional_documents(profile_id,revision);
CREATE TABLE app.control_subscription_snapshots(id text PRIMARY KEY,subscription_id text NOT NULL REFERENCES app.subscriptions(id),workspace_id text NOT NULL,status text NOT NULL,plan_code text NOT NULL,currency text,mrr_minor numeric,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX control_subscription_snapshot_time_idx ON app.control_subscription_snapshots(subscription_id,recorded_at);
CREATE FUNCTION app.control_snapshot_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE amount numeric; unit text;
BEGIN
 IF NEW.provider IN ('sandbox','demo') THEN RETURN NEW; END IF;
 SELECT currency,CASE WHEN billing_period IN ('year','yearly','annual') THEN price_minor/12.0 WHEN billing_period IN ('month','monthly') THEN price_minor ELSE NULL END INTO unit,amount FROM app.subscription_plan_versions WHERE id=NEW.plan_version_id;
 INSERT INTO app.control_subscription_snapshots(id,subscription_id,workspace_id,status,plan_code,currency,mrr_minor) VALUES(gen_random_uuid()::text,NEW.id,NEW.workspace_id,NEW.status,NEW.plan_code,unit,CASE WHEN NEW.status='active' THEN amount ELSE 0 END);
 RETURN NEW;
END; $$;
CREATE TRIGGER control_subscription_change AFTER INSERT OR UPDATE OF status,plan_code,plan_version_id ON app.subscriptions FOR EACH ROW EXECUTE FUNCTION app.control_snapshot_subscription();
-- Baseline is recorded now; no historical subscription states are fabricated.
INSERT INTO app.control_subscription_snapshots(id,subscription_id,workspace_id,status,plan_code,currency,mrr_minor)
 SELECT gen_random_uuid()::text,s.id,s.workspace_id,s.status,s.plan_code,v.currency,CASE WHEN s.status='active' THEN CASE WHEN v.billing_period IN ('year','yearly','annual') THEN v.price_minor/12.0 WHEN v.billing_period IN ('month','monthly') THEN v.price_minor END ELSE 0 END FROM app.subscriptions s LEFT JOIN app.subscription_plan_versions v ON v.id=s.plan_version_id WHERE s.provider NOT IN ('sandbox','demo');
CREATE FUNCTION app.control_feature_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE owner text; feature_name text; event_name text; consent record; item jsonb; identity text;
BEGIN
 item=to_jsonb(NEW);owner=coalesce(item->>'user_id',item->>'owner_user_id',item->>'requester_user_id');
 SELECT * INTO consent FROM app.control_analytics_consent WHERE user_id=owner;IF NOT FOUND THEN RETURN NEW; END IF;
 feature_name=CASE TG_TABLE_NAME WHEN 'ai_runs' THEN 'legal_chat' WHEN 'documents' THEN 'document_builder' WHEN 'document_analyses' THEN 'document_analysis' WHEN 'document_comparisons' THEN 'document_comparison' WHEN 'lawyer_requests' THEN 'consultation' ELSE 'unknown' END;
 event_name=CASE WHEN TG_OP='INSERT' THEN 'feature_started' WHEN item->>'status' IN ('completed','succeeded','ready','generated','published','resolved') OR (TG_TABLE_NAME='documents' AND item->>'generated_at' IS NOT NULL) THEN 'feature_completed' WHEN item->>'status' IN ('failed','error') OR item->>'error_code' IS NOT NULL THEN 'feature_error' ELSE NULL END;
 IF event_name IS NULL THEN RETURN NEW;END IF;
 identity=TG_TABLE_NAME||':'||(item->>'id')||':'||event_name;
 INSERT INTO app.control_product_events(id,event,application,visitor_id,session_id,page,device,user_id,feature,account_type,plan_code)
 SELECT identity,event_name,consent.application,consent.visitor_id,consent.session_id,'/',consent.device,u.id,feature_name,u.account_type,s.plan_code FROM app.user_profiles u LEFT JOIN app.subscriptions s ON s.workspace_id=u.default_workspace_id WHERE u.id=owner ON CONFLICT DO NOTHING;
 RETURN NEW;
END; $$;
CREATE TRIGGER control_ai_events AFTER INSERT OR UPDATE OF status ON app.ai_runs FOR EACH ROW EXECUTE FUNCTION app.control_feature_event();
CREATE TRIGGER control_document_events AFTER INSERT OR UPDATE OF status,generated_at ON app.documents FOR EACH ROW EXECUTE FUNCTION app.control_feature_event();
CREATE TRIGGER control_analysis_events AFTER INSERT OR UPDATE OF status ON app.document_analyses FOR EACH ROW EXECUTE FUNCTION app.control_feature_event();
CREATE TRIGGER control_comparison_events AFTER INSERT OR UPDATE OF status ON app.document_comparisons FOR EACH ROW EXECUTE FUNCTION app.control_feature_event();
CREATE TRIGGER control_consultation_events AFTER INSERT OR UPDATE OF status ON app.lawyer_requests FOR EACH ROW EXECUTE FUNCTION app.control_feature_event();
CREATE TABLE app.control_professional_flow_events(id text PRIMARY KEY,profile_id text NOT NULL REFERENCES app.lawyer_profiles(id) ON DELETE CASCADE,revision bigint NOT NULL,event text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(profile_id,revision,event));
CREATE FUNCTION app.control_professional_flow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.marketplace_status='pending_review' THEN INSERT INTO app.control_professional_flow_events(id,profile_id,revision,event) VALUES(gen_random_uuid()::text,NEW.id,NEW.profile_revision,'submitted') ON CONFLICT DO NOTHING;
 ELSIF NEW.marketplace_status='public_approved' THEN INSERT INTO app.control_professional_flow_events(id,profile_id,revision,event) VALUES(gen_random_uuid()::text,NEW.id,NEW.profile_revision,'approved'),(gen_random_uuid()::text,NEW.id,NEW.profile_revision,'published') ON CONFLICT DO NOTHING;
 END IF;RETURN NEW;
END; $$;
CREATE TRIGGER control_professional_flow_change AFTER INSERT OR UPDATE OF marketplace_status,profile_revision ON app.lawyer_profiles FOR EACH ROW EXECUTE FUNCTION app.control_professional_flow();
