import type { PoolClient } from "pg";
import {
  isFinance,
  isLegal,
  isManager,
  PracticeError,
  type Actor,
  type Locale,
} from "./domain";
import { requireCase } from "./access";
import { documentAllowed } from "./documents";
import { templateCatalog } from "./content";
import { tashkentToday } from "../platform/calendar";
import { currencyScales } from "./money";
import { hasAiConfiguration } from "../document-builder/ai/openai";
import { matterScopeFor } from "./case-scope";
import { juroMaterial } from "./juro";

export const matterScope = matterScopeFor();
const values = (actor: Actor) => [actor.workspaceId, actor.role, actor.userId];

export async function readPractice(
  client: PoolClient,
  actor: Actor,
  resource: string,
  search: URLSearchParams,
  locale: Locale,
): Promise<unknown> {
  const matterScope = matterScopeFor(
    [
      "invoices",
      "expenses",
      "payments",
      "reports",
      "recurring",
      "invoice-contracts",
      "invoice-stages",
      "finance-matters",
      "time",
    ].includes(resource),
  );
  const caseId = search.get("caseId"),
    caseCondition = caseId ? ` AND m.case_id=$4` : "";
  const args = [...values(actor), ...(caseId ? [caseId] : [])];
  if (caseId)
    await requireCase(
      client,
      actor,
      caseId,
      [
        "invoices",
        "expenses",
        "payments",
        "reports",
        "recurring",
        "invoice-contracts",
        "invoice-stages",
        "time",
      ].includes(resource)
        ? "finance"
        : "legal",
    );
  switch (resource) {
    case "overview": {
      const readable = actor.role !== "accountant";
      const cases = readable
        ? await readPractice(
            client,
            actor,
            "cases",
            new URLSearchParams(),
            locale,
          )
        : null;
      const leads = isLegal(actor)
        ? await readPractice(
            client,
            actor,
            "cases",
            new URLSearchParams({ leads: "true" }),
            locale,
          )
        : null;
      const taskRows = readable
        ? (
            await client.query(
              `SELECT t.id,t.title,t.due_at,t.status,count(*) OVER()::integer AS full_count FROM tasks t JOIN practice_tasks p ON p.task_id=t.id JOIN practice_matters m ON m.case_id=t.case_id
        WHERE m.workspace_id=$1 AND ${matterScope} AND ($2<>'client' OR p.client_visible) AND t.status NOT IN ('completed','cancelled') AND (t.due_at::timestamptz AT TIME ZONE 'Asia/Tashkent')::date=(now() AT TIME ZONE 'Asia/Tashkent')::date ORDER BY t.due_at LIMIT 12`,
              values(actor),
            )
          ).rows
        : null;
      const eventRows = readable
        ? (
            await client.query(
              `SELECT e.id,e.title,e.starts_at,count(*) OVER()::integer AS full_count FROM practice_events e JOIN practice_matters m ON m.case_id=e.case_id WHERE m.workspace_id=$1 AND ${matterScope} AND ($2<>'client' OR e.client_visible) AND e.status<>'cancelled' AND e.starts_at>=now() AND e.starts_at<now()+interval '7 days' ORDER BY e.starts_at LIMIT 12`,
              values(actor),
            )
          ).rows
        : null;
      return {
        cases,
        leads,
        tasks: taskRows && {
          items: taskRows,
          total: taskRows[0]?.full_count ?? 0,
        },
        events: eventRows && {
          items: eventRows,
          total: eventRows[0]?.full_count ?? 0,
        },
        report: isFinance(actor)
          ? await financialReport(client, actor, new URLSearchParams())
          : null,
      };
    }
    case "bootstrap": {
      const config = (
        await client.query(
          `SELECT w.name,w.type,w.locale,p.provider_details,p.settings,p.features,p.seat_limit FROM workspaces w JOIN practice_workspaces p ON p.workspace_id=w.id WHERE w.id=$1`,
          [actor.workspaceId],
        )
      ).rows[0];
      const workspaces = (
        await client.query(
          `SELECT DISTINCT w.id,w.name FROM workspaces w JOIN practice_workspaces p ON p.workspace_id=w.id
        WHERE EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=$1 AND m.status='active')
        OR EXISTS(SELECT 1 FROM practice_invitations i WHERE i.workspace_id=w.id AND i.accepted_by=$1 AND i.confirmed_at IS NOT NULL AND i.revoked_at IS NULL) ORDER BY w.name`,
          [actor.userId],
        )
      ).rows;
      const pipelines =
        actor.role !== "client" && actor.role !== "accountant"
          ? (
              await client.query(
                `SELECT * FROM practice_pipelines WHERE workspace_id=$1 ORDER BY name`,
                [actor.workspaceId],
              )
            ).rows
          : [];
      const members = isLegal(actor)
        ? (
            await client.query(
              `SELECT m.user_id,m.id,m.role,coalesce(p.full_name,'JURO') AS name FROM workspace_members m JOIN user_profiles p ON p.id=m.user_id WHERE m.workspace_id=$1 AND m.status='active'`,
              [actor.workspaceId],
            )
          ).rows
        : actor.role === "client"
          ? (
              await client.query(
                `SELECT DISTINCT a.user_id,p.full_name AS name,w.role FROM practice_assignments a JOIN practice_matters m ON m.case_id=a.case_id JOIN workspace_members w ON w.user_id=a.user_id AND w.workspace_id=m.workspace_id AND w.status='active' JOIN user_profiles p ON p.id=a.user_id WHERE m.workspace_id=$1 AND ${matterScope} AND w.role IN ('owner','admin','lawyer')`,
                values(actor),
              )
            ).rows
          : [];
      const preferences =
        (
          await client.query(
            `SELECT value FROM practice_preferences WHERE workspace_id=$1 AND user_id=$2`,
            [actor.workspaceId, actor.userId],
          )
        ).rows[0]?.value ?? {};
      return {
        actor,
        workspace: { name: config.name, type: config.type },
        workspaces,
        pipelines,
        members,
        preferences,
        provider: isFinance(actor) ? config.provider_details : {},
        settings: isManager(actor)
          ? config.settings
          : { sources: config.settings.sources ?? [] },
        integrations: {
          google: (
            await client.query(
              `SELECT state,last_error,last_synced_at,calendar_id FROM practice_calendar_connections WHERE workspace_id=$1 AND user_id=$2`,
              [actor.workspaceId, actor.userId],
            )
          ).rows[0] ?? { state: "not_connected" },
          ai:
            process.env.PRACTICE_AI_ALLOWED === "true" &&
            config.settings.aiConsent === true &&
            hasAiConfiguration()
              ? "configured_by_policy"
              : "not_connected",
          payments: "not_connected",
          signature: "external",
        },
      };
    }
    case "cases": {
      if (!isLegal(actor) && actor.role !== "client")
        throw new PracticeError("ACCESS_DENIED", 403);
      const clientView = actor.role === "client";
      const filteredArgs = [...args],
        pipelineId = search.get("pipelineId");
      const filter =
        (pipelineId
          ? ` AND m.pipeline_id=$${filteredArgs.push(pipelineId)}`
          : "") +
        (search.get("leads") === "true"
          ? ` AND m.stage_id=(SELECT stages->0->>'id' FROM practice_pipelines WHERE id=m.pipeline_id)`
          : "");
      return page(
        client,
        search,
        `SELECT m.case_id AS id,c.title,${clientView ? "m.client_status AS description" : "c.description"},c.status,m.stage_id,m.client_status,
        ${clientView ? "NULL::text AS next_action,NULL::bigint AS expected_minor" : "m.next_action,m.expected_minor"},m.currency,m.revision,m.pipeline_id,
        ${clientView ? "NULL::text AS source" : "m.source"},m.contact_id,${clientView ? "'{}'::jsonb" : "m.custom_fields"} AS custom_fields,
        ${clientView ? "'[]'::jsonb" : "coalesce((SELECT t.fields FROM practice_case_templates t WHERE t.id=(SELECT e.metadata_json::jsonb->>'templateId' FROM case_events e WHERE e.case_id=m.case_id AND e.event_type='practice_work_started' ORDER BY e.created_at DESC LIMIT 1)),'[]'::jsonb)"} AS custom_schema,
        ct.full_name AS client_name,c.updated_at,c.title AS search FROM practice_matters m JOIN cases c ON c.id=m.case_id JOIN contacts ct ON ct.id=m.contact_id
        WHERE m.workspace_id=$1 AND ${matterScope}${caseCondition}${filter}`,
        filteredArgs,
        { updated: "updated_at DESC,id", title: "title,id" },
      );
    }
    case "juro-cases": {
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      if (actor.role === "assistant")
        return { items: [], total: 0, page: 1, pageSize: 30 };
      return page(
        client,
        search,
        `SELECT DISTINCT c.id,c.title,c.title AS search FROM cases c JOIN lawyer_requests r ON r.case_id=c.id AND r.workspace_id=c.workspace_id
        JOIN lawyer_access_grants g ON g.lawyer_request_id=r.id AND g.case_id=c.id
        JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id AND p.user_id=g.lawyer_user_id
        WHERE $1::text IS NOT NULL AND $2::text IS NOT NULL AND g.lawyer_user_id=$3 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at::timestamptz>now())
        AND p.status='public_approved' AND p.marketplace_status='public_approved' AND NOT EXISTS(SELECT 1 FROM practice_matters WHERE case_id=c.id)`,
        values(actor),
        { updated: "title,id", title: "title,id" },
      );
    }
    case "finance-matters": {
      if (!isFinance(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT m.case_id AS id,c.full_name || ' · ' || left(m.case_id,8) AS title,c.full_name AS search FROM practice_matters m JOIN contacts c ON c.id=m.contact_id WHERE m.workspace_id=$1 AND ${matterScope}`,
        values(actor),
        { updated: "title,id", title: "title,id" },
      );
    }
    case "organizers": {
      if (!caseId) throw new PracticeError("CASE_REQUIRED");
      return {
        items: (
          await client.query(
            `SELECT a.user_id,coalesce(p.full_name,'JURO') AS name FROM practice_assignments a JOIN workspace_members w ON w.user_id=a.user_id AND w.workspace_id=$2 AND w.status='active' JOIN user_profiles p ON p.id=a.user_id WHERE a.case_id=$1 AND w.role IN ('owner','admin','lawyer')`,
            [caseId, actor.workspaceId],
          )
        ).rows,
      };
    }
    case "contacts": {
      if (actor.role === "client")
        throw new PracticeError("ACCESS_DENIED", 403);
      const contactId = search.get("contactId"),
        contactArgs = [...values(actor), ...(contactId ? [contactId] : [])];
      return page(
        client,
        search,
        `SELECT p.contact_id AS id,c.full_name AS name,p.kind,p.email,c.phone,p.company_name,p.requisites,c.updated_at,
        c.full_name AS search FROM practice_contacts p JOIN contacts c ON c.id=p.contact_id WHERE p.workspace_id=$1
        AND ($2 IN ('owner','admin','accountant') OR c.owner_user_id=$3 OR EXISTS(SELECT 1 FROM practice_matters m JOIN practice_assignments a ON a.case_id=m.case_id WHERE m.workspace_id=p.workspace_id AND m.contact_id=p.contact_id AND a.user_id=$3))${contactId ? " AND p.contact_id=$4" : ""}`,
        contactArgs,
        { updated: "updated_at DESC,id", title: "name,id" },
      );
    }
    case "tasks": {
      if (actor.role === "accountant")
        throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT t.id,t.case_id,t.title,${actor.role === "client" ? "NULL::text" : "t.description"} AS description,t.due_at,t.status,p.priority,p.assignee_user_id,t.updated_at,t.title AS search
        FROM tasks t JOIN practice_tasks p ON p.task_id=t.id JOIN practice_matters m ON m.case_id=t.case_id AND m.workspace_id=t.workspace_id
        WHERE m.workspace_id=$1 AND ${matterScope} AND ($2<>'client' OR p.client_visible)${caseCondition}`,
        args,
        { updated: "due_at NULLS LAST,id", title: "title,id" },
      );
    }
    case "entries": {
      if (!caseId) throw new PracticeError("CASE_REQUIRED");
      return page(
        client,
        search,
        `SELECT e.*,'practice' AS source,e.body AS search FROM practice_entries e JOIN practice_matters m ON m.case_id=e.case_id
        WHERE m.workspace_id=$1 AND ${matterScope} AND ($2<>'client' OR e.client_visible)${caseCondition}
        UNION ALL SELECT e.id,r.case_id,e.author_user_id,'message',e.body,true,NULL::text,e.created_at::timestamptz,'juro',e.body FROM lawyer_request_messages e JOIN lawyer_requests r ON r.id=e.lawyer_request_id JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id JOIN practice_matters m ON m.case_id=r.case_id AND m.responsible_user_id=p.user_id
        WHERE m.workspace_id=$1 AND ${matterScope}${caseCondition}`,
        args,
        { updated: "created_at DESC,id" },
      );
    }
    case "plan": {
      if (!caseId) throw new PracticeError("CASE_REQUIRED");
      const current = await requireCase(client, actor, caseId);
      const source = (
        await client.query(`SELECT * FROM action_plans WHERE case_id=$1`, [
          caseId,
        ])
      ).rows[0];
      const steps = (
        await client.query(
          `SELECT s.id,s.title,s.description,s.status,s.due_at,'plan_step' AS source FROM action_plan_steps s JOIN action_plans p ON p.id=s.plan_id JOIN cases c ON c.id=p.case_id
        WHERE c.id=$1 AND ($2<>'client' OR c.owner_user_id=$3 OR EXISTS(SELECT 1 FROM tasks t JOIN practice_tasks pt ON pt.task_id=t.id WHERE t.plan_step_id=s.id AND pt.client_visible)) ORDER BY s.ordinal`,
          [caseId, actor.role, actor.userId],
        )
      ).rows;
      const tasks = (
        await client.query(
          `SELECT t.id,t.title,CASE WHEN $2='client' THEN NULL ELSE t.description END AS description,t.status,t.due_at,'task' AS source FROM tasks t JOIN practice_tasks p ON p.task_id=t.id WHERE t.case_id=$1 AND t.workspace_id=$4 AND $3::text IS NOT NULL AND ($2<>'client' OR p.client_visible) AND (t.plan_step_id IS NULL OR NOT EXISTS(SELECT 1 FROM action_plan_steps WHERE id=t.plan_step_id)) ORDER BY t.created_at`,
          [caseId, actor.role, actor.userId, actor.workspaceId],
        )
      ).rows;
      return {
        title: source?.title ?? current.title,
        items: [...steps, ...tasks],
      };
    }
    case "documents": {
      if (actor.role === "accountant")
        throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT d.id,d.title,d.language,p.case_id,p.state,p.revision,d.updated_at,p.client_visible,d.title AS search
        FROM documents d JOIN practice_documents p ON p.document_id=d.id JOIN practice_matters m ON m.case_id=p.case_id AND m.workspace_id=p.workspace_id
        WHERE m.workspace_id=$1 AND ${matterScope} AND ($2<>'client' OR p.client_visible)${caseCondition}`,
        args,
        { updated: "updated_at DESC,id", title: "title,id" },
      );
    }
    case "materials": {
      if (!caseId || actor.role === "accountant")
        throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT d.id,d.title,d.language,'material' AS kind,d.updated_at,d.title AS search FROM documents d JOIN practice_matters m ON m.case_id=d.case_id JOIN cases c ON c.id=m.case_id AND c.workspace_id=d.workspace_id
        WHERE m.workspace_id=$1 AND ${matterScope}${caseCondition} AND NOT EXISTS(SELECT 1 FROM practice_documents WHERE document_id=d.id)
        AND (d.owner_user_id=$3 OR ($2<>'client' AND d.owner_user_id=c.owner_user_id) OR EXISTS(SELECT 1 FROM document_collaborators dc WHERE dc.document_id=d.id AND dc.user_id=$3 AND dc.can_view=1 AND dc.invitation_status='accepted' AND dc.status IN ('active','opened','confirmed') AND dc.revoked_at IS NULL))`,
        args,
        { updated: "updated_at DESC,id", title: "title,id" },
      );
    }
    case "source-files": {
      const doc = await juroMaterial(
        client,
        actor,
        search.get("documentId") ?? "",
        true,
      );
      return {
        items: (
          await client.query(
            `SELECT id,file_name,mime_type,size_bytes FROM document_files WHERE document_id=$1 AND archived_at IS NULL ORDER BY created_at DESC LIMIT 100`,
            [doc.id],
          )
        ).rows,
      };
    }
    case "document": {
      const doc = await documentAllowed(
        client,
        actor,
        search.get("documentId") ?? "",
      );
      if (actor.role === "client") {
        // Never publish interim autosaves, internal checkpoints or earlier drafts.
        const published = (
          await client.query(
            `SELECT * FROM practice_document_versions WHERE document_id=$1 AND id=$2`,
            [doc.document_id, doc.published_version_id],
          )
        ).rows[0];
        if (!published) throw new PracticeError("NOT_FOUND", 404);
        doc.content = published.content;
        doc.revision = published.revision;
      }
      const versions = (
        await client.query(
          `SELECT v.id,v.revision,v.reason,v.sha256,v.author_user_id,p.full_name AS author_name,v.created_at FROM practice_document_versions v JOIN user_profiles p ON p.id=v.author_user_id WHERE v.document_id=$1
        AND ($2<>'client' OR v.reason IN ('published','agreed')) ORDER BY v.revision DESC LIMIT 100`,
          [doc.document_id, actor.role],
        )
      ).rows;
      const reviews = (
        await client.query(
          `SELECT r.*,p.full_name AS author_name FROM practice_document_reviews r JOIN user_profiles p ON p.id=r.author_user_id WHERE r.document_id=$1 ORDER BY r.created_at`,
          [doc.document_id],
        )
      ).rows;
      const signatures = (
        await client.query(
          `SELECT s.*,p.full_name AS confirmed_name FROM practice_signatures s JOIN practice_document_versions v ON v.id=s.version_id JOIN user_profiles p ON p.id=s.confirmed_by WHERE v.document_id=$1 ORDER BY s.confirmed_at DESC`,
          [doc.document_id],
        )
      ).rows;
      return { document: doc, versions, reviews, signatures };
    }
    case "templates": {
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const templates = (
        await client.query(
          `SELECT * FROM practice_document_templates WHERE workspace_id=$1 OR workspace_id IS NULL ORDER BY name LIMIT 200`,
          [actor.workspaceId],
        )
      ).rows;
      const language = search.get("language");
      return {
        items: [
          ...templateCatalog(
            language === "uz" || language === "en" ? language : locale,
          ),
          ...templates.filter((row) => !language || row.language === language),
        ],
      };
    }
    case "case-templates": {
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      return {
        items: (
          await client.query(
            `SELECT * FROM practice_case_templates WHERE workspace_id=$1 OR workspace_id IS NULL ORDER BY name LIMIT 100`,
            [actor.workspaceId],
          )
        ).rows,
      };
    }
    case "ai-drafts": {
      if (!caseId || !isLegal(actor))
        throw new PracticeError("ACCESS_DENIED", 403);
      return {
        items: (
          await client.query(
            `SELECT d.id,d.result,d.created_at,p.full_name AS author_name FROM practice_ai_drafts d JOIN user_profiles p ON p.id=d.user_id WHERE d.case_id=$1 AND d.workspace_id=$2 AND d.state='completed' ORDER BY d.created_at DESC LIMIT 10`,
            [caseId, actor.workspaceId],
          )
        ).rows,
      };
    }
    case "invoice-contracts": {
      if (!caseId || !isFinance(actor))
        throw new PracticeError("ACCESS_DENIED", 403);
      return {
        items: (
          await client.query(
            `SELECT p.document_id AS id,CASE WHEN $3='accountant' THEN left(p.document_id,8) ELSE d.title END AS title FROM practice_documents p JOIN documents d ON d.id=p.document_id WHERE p.workspace_id=$1 AND p.case_id=$2 AND p.state IN ('agreed','awaiting_signed','signed_confirmed') ORDER BY d.updated_at DESC LIMIT 100`,
            [actor.workspaceId, caseId, actor.role],
          )
        ).rows,
      };
    }
    case "invoice-stages": {
      if (!caseId || !isFinance(actor))
        throw new PracticeError("ACCESS_DENIED", 403);
      const matter = await requireCase(client, actor, caseId, "finance");
      return {
        items: (
          await client.query(
            `SELECT stages FROM practice_pipelines WHERE id=$1 AND workspace_id=$2`,
            [matter.pipeline_id, actor.workspaceId],
          )
        ).rows[0].stages,
      };
    }
    case "invoices": {
      if (!isFinance(actor) && actor.role !== "client")
        throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT i.*,coalesce(p.paid_minor,0)::bigint AS paid_minor,i.number AS search FROM practice_invoices i JOIN practice_matters m ON m.case_id=i.case_id
        LEFT JOIN (SELECT invoice_id,sum(amount_minor) AS paid_minor FROM practice_payments GROUP BY invoice_id) p ON p.invoice_id=i.id
        WHERE m.workspace_id=$1 AND ${matterScope}${caseCondition}`,
        args,
        { updated: "created_at DESC,id", title: "number,id" },
      );
    }
    case "payments": {
      if (!isFinance(actor) && actor.role !== "client")
        throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT p.*,i.number,${actor.role === "client" ? "NULL::bigint" : "c.amount_minor"} AS commission_minor,
        ${actor.role === "client" ? "NULL::integer AS rate_bps,NULL::integer AS rule_version" : "c.rate_bps,c.rule_version"},i.number AS search
        FROM practice_payments p JOIN practice_invoices i ON i.id=p.invoice_id JOIN practice_matters m ON m.case_id=i.case_id
        LEFT JOIN practice_commissions c ON c.payment_id=p.id WHERE m.workspace_id=$1 AND ${matterScope}${caseCondition}`,
        args,
        { updated: "created_at DESC,id" },
      );
    }
    case "expenses": {
      if (!isFinance(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT e.*,e.description AS search FROM practice_expenses e JOIN practice_matters m ON m.case_id=e.case_id WHERE m.workspace_id=$1 AND ${matterScope}${caseCondition}`,
        args,
        { updated: "incurred_on DESC,id" },
      );
    }
    case "time": {
      if (!isFinance(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT t.*,t.description AS search FROM practice_time_entries t JOIN practice_matters m ON m.case_id=t.case_id WHERE m.workspace_id=$1 AND ${matterScope}${caseCondition}`,
        args,
        { updated: "worked_on DESC,id" },
      );
    }
    case "recurring": {
      if (!isFinance(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      return page(
        client,
        search,
        `SELECT s.*,s.description AS search FROM practice_recurring_services s JOIN practice_matters m ON m.case_id=s.case_id WHERE m.workspace_id=$1 AND ${matterScope}${caseCondition}`,
        args,
        { updated: "next_on,id" },
      );
    }
    case "events": {
      if (actor.role === "accountant")
        throw new PracticeError("ACCESS_DENIED", 403);
      const title = {
          ru: "Консультация JURO",
          uz: "JURO maslahati",
          en: "JURO consultation",
        }[locale],
        parameter = `$${args.length + 1}`;
      return page(
        client,
        search,
        `SELECT e.id,e.workspace_id,e.case_id,e.organizer_user_id,e.starts_at,e.ends_at,e.timezone,e.status,e.client_visible,e.title,e.revision,e.updated_at,'practice' AS source,e.title AS search FROM practice_events e JOIN practice_matters m ON m.case_id=e.case_id WHERE m.workspace_id=$1 AND ${matterScope} AND ($2<>'client' OR e.client_visible)${caseCondition}
        UNION ALL SELECT 'juro:' || e.id,m.workspace_id,e.case_id,p.user_id,e.starts_at::timestamptz,e.ends_at::timestamptz,e.timezone,e.status,true,${parameter}::text,1,e.updated_at::timestamptz,'juro',${parameter}::text FROM lawyer_consultations e JOIN lawyer_profiles p ON p.id=e.lawyer_profile_id JOIN practice_matters m ON m.case_id=e.case_id AND m.responsible_user_id=p.user_id WHERE m.workspace_id=$1 AND ${matterScope} AND ($2<>'client' OR e.client_user_id=$3)${caseCondition}`,
        [...args, title],
        { updated: "starts_at DESC,id", title: "title,id" },
      );
    }
    case "files": {
      if (!caseId) throw new PracticeError("CASE_REQUIRED");
      return {
        items: (
          await client.query(
            `SELECT d.id,d.document_id,d.file_name,d.mime_type,d.size_bytes,d.created_at,f.purpose,f.version_id,f.client_visible FROM document_files d JOIN practice_files f ON f.file_id=d.id JOIN practice_matters m ON m.case_id=f.case_id WHERE m.workspace_id=$1 AND ${matterScope} AND ($2<>'client' OR f.client_visible OR f.uploaded_by=$3)${caseCondition} ORDER BY d.created_at DESC LIMIT 200`,
            args,
          )
        ).rows,
      };
    }
    case "team": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const members = (
        await client.query(
          `SELECT m.id,m.user_id,m.role,m.status,p.full_name AS name FROM workspace_members m JOIN user_profiles p ON p.id=m.user_id WHERE m.workspace_id=$1 ORDER BY m.joined_at LIMIT 200`,
          [actor.workspaceId],
        )
      ).rows;
      const invitations = (
        await client.query(
          `SELECT i.id,i.contact_id,c.full_name AS client_name,i.accepted_by,p.full_name AS accepted_name,i.accepted_at,i.confirmed_at,i.revoked_at,i.expires_at FROM practice_invitations i JOIN contacts c ON c.id=i.contact_id LEFT JOIN user_profiles p ON p.id=i.accepted_by WHERE i.workspace_id=$1 ORDER BY i.expires_at DESC LIMIT 200`,
          [actor.workspaceId],
        )
      ).rows;
      return { members, invitations };
    }
    case "notifications":
      return page(
        client,
        search,
        `SELECT id,kind,entity_id,email_state,error_code,read_at,created_at,kind AS search FROM practice_notifications WHERE workspace_id=$1 AND user_id=$2`,
        [actor.workspaceId, actor.userId],
        { updated: "created_at DESC,id" },
      );
    case "reports":
      return financialReport(client, actor, search);
    default:
      throw new PracticeError("NOT_FOUND", 404);
  }
}
async function page(
  client: PoolClient,
  search: URLSearchParams,
  query: string,
  args: unknown[],
  sort: Record<string, string>,
) {
  const requested = Number(search.get("page") ?? "1"),
    pageNumber =
      Number.isInteger(requested) && requested > 0
        ? Math.min(requested, 10000)
        : 1;
  const limit = 30,
    q = (search.get("q") ?? "").slice(0, 100),
    offset = (pageNumber - 1) * limit;
  const order = sort[search.get("sort") ?? "updated"] ?? sort.updated;
  const n = args.length;
  const rows = (
    await client.query(
      `SELECT x.*,count(*) OVER()::integer AS full_count FROM (${query}) x
    WHERE x.search ILIKE $${n + 1} ORDER BY ${order} LIMIT $${n + 2} OFFSET $${n + 3}`,
      [...args, `%${q}%`, limit, offset],
    )
  ).rows;
  return {
    items: rows.map(({ search: _search, full_count: _count, ...row }) => row),
    total: rows[0]?.full_count ?? 0,
    page: pageNumber,
    pageSize: limit,
  };
}

async function financialReport(
  client: PoolClient,
  actor: Actor,
  search: URLSearchParams,
) {
  if (!isFinance(actor)) throw new PracticeError("ACCESS_DENIED", 403);
  const matterScope = matterScopeFor(true);
  const from = search.get("from") ?? `${tashkentToday().slice(0, 4)}-01-01`,
    to = search.get("to") ?? tashkentToday();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to) ||
    from > to
  )
    throw new PracticeError("INVALID_DATE_RANGE");
  const groupBy = search.get("group") ?? "currency";
  const groupColumn =
    {
      currency: "i.currency",
      client: "m.contact_id",
      lawyer: "m.responsible_user_id",
      case: "m.case_id",
    }[groupBy] ?? "i.currency";
  const args = [...values(actor), from, to];
  const rows = (
    await client.query(
      `SELECT ${groupColumn} AS group_id,i.currency,
    coalesce(sum(i.total_minor) FILTER(WHERE i.issued_on BETWEEN $4::date AND $5::date),0)::bigint AS invoiced_minor,
    coalesce(sum(p.paid_period),0)::bigint AS received_minor,
    coalesce(sum(greatest(0,i.total_minor-coalesce(p.paid_all,0))),0)::bigint AS outstanding_minor,
    coalesce(sum(p.commission),0)::bigint AS commission_minor
    FROM practice_invoices i JOIN practice_matters m ON m.case_id=i.case_id
    LEFT JOIN (SELECT p.invoice_id,sum(p.amount_minor) AS paid_all,
      coalesce(sum(p.amount_minor) FILTER(WHERE p.received_on BETWEEN $4::date AND $5::date),0) AS paid_period,
      coalesce(sum(c.amount_minor) FILTER(WHERE p.received_on BETWEEN $4::date AND $5::date),0) AS commission
      FROM practice_payments p LEFT JOIN practice_commissions c ON c.payment_id=p.id WHERE p.received_on<=$5::date GROUP BY p.invoice_id) p ON p.invoice_id=i.id
    WHERE m.workspace_id=$1 AND ${matterScope} AND i.issued_on<=$5::date GROUP BY ${groupColumn},i.currency ORDER BY group_id,i.currency`,
      args,
    )
  ).rows;
  const expenses = (
    await client.query(
      `SELECT e.currency,coalesce(sum(e.amount_minor) FILTER(WHERE e.paid),0)::bigint AS paid_minor,
    coalesce(sum(e.amount_minor) FILTER(WHERE NOT e.paid),0)::bigint AS expected_minor FROM practice_expenses e JOIN practice_matters m ON m.case_id=e.case_id
    WHERE m.workspace_id=$1 AND ${matterScope} AND e.incurred_on BETWEEN $4::date AND $5::date GROUP BY e.currency`,
      args,
    )
  ).rows;
  const scale = (expression: string) =>
    `CASE ${expression} ${Object.entries(currencyScales)
      .map(([currency, digits]) => `WHEN '${currency}' THEN ${digits}`)
      .join(" ")} ELSE 2 END`;
  const conversions = (
    await client.query(
      `WITH operations AS (
    SELECT 'invoices' AS kind,i.total_minor AS amount,i.currency,i.fx_snapshot FROM practice_invoices i JOIN practice_matters m ON m.case_id=i.case_id WHERE m.workspace_id=$1 AND ${matterScope} AND i.issued_on BETWEEN $4::date AND $5::date
    UNION ALL SELECT 'payments',p.amount_minor,p.currency,p.fx_snapshot FROM practice_payments p JOIN practice_invoices i ON i.id=p.invoice_id JOIN practice_matters m ON m.case_id=i.case_id WHERE m.workspace_id=$1 AND ${matterScope} AND p.received_on BETWEEN $4::date AND $5::date
    UNION ALL SELECT CASE WHEN e.paid THEN 'expenses' ELSE 'expected' END,e.amount_minor,e.currency,e.fx_snapshot FROM practice_expenses e JOIN practice_matters m ON m.case_id=e.case_id WHERE m.workspace_id=$1 AND ${matterScope} AND e.incurred_on BETWEEN $4::date AND $5::date
    ) SELECT kind,fx_snapshot->>'baseCurrency' AS base_currency,
      sum(round(amount*(fx_snapshot->>'rate')::numeric*power(10::numeric,${scale("fx_snapshot->>'baseCurrency'")}-${scale("currency")})))::text AS converted_minor,
      count(*) FILTER(WHERE NOT(fx_snapshot ? 'rate'))::integer AS missing_rates
    FROM operations GROUP BY kind,fx_snapshot->>'baseCurrency' ORDER BY kind,base_currency`,
      args,
    )
  ).rows;
  return {
    from,
    to,
    calculatedAt: new Date().toISOString(),
    groups: rows,
    expenses,
    conversions,
    grouping: groupBy,
    totalsByCurrency: true,
  };
}
