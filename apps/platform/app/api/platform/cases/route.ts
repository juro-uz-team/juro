import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { requireD1 } from "../../../../lib/document-builder/storage/runtime";
import { isoNow, parseJson } from "../../../../lib/document-builder/storage/db";
import { parseJsonRequest } from "../../../../lib/auth/input";
import { caseCreateInputSchema, caseScenarioMatchesAccount, caseScenarioSteps } from "../../../../lib/platform/case-create";
import { workspaceForContentEditor, workspaceForUser } from "../../../../lib/platform/workspace";

function response(body: unknown, status=200){return Response.json(body,{status,headers:{"cache-control":"private, no-store"}});}

export const GET = withApiErrors(async function GET(request:Request){
  const user=await requireApiUser(); const db=requireD1();
  const workspace=await workspaceForUser(user);
  const caseId=new URL(request.url).searchParams.get("caseId");
  const caseScope=caseId ? " AND c.id=?" : "";
  const query=`SELECT c.id,c.title,c.description,c.legal_area AS legalArea,c.status,c.next_deadline_at AS nextDeadlineAt,c.archived_at AS archivedAt,c.completed_at AS completedAt,c.lifecycle_revision AS lifecycleRevision,c.created_at AS createdAt,c.updated_at AS updatedAt,
    p.id AS planId,p.title AS planTitle,p.status AS planStatus,p.progress_percent AS progressPercent,p.current_revision AS planRevision,
    (SELECT json_group_array(json_object('id',s.id,'ordinal',s.ordinal,'title',s.title,'description',s.description,'status',s.status,'sourceDate',s.deadline_source_date,'dueAt',s.due_at,'safeDueAt',s.safe_due_at,'deadlineType',s.deadline_type,'calculationMethod',s.calculation_method,'legalBasis',s.deadline_legal_basis,'deadlineConfidence',s.deadline_confidence,'actionType',s.action_type,'templateCode',s.template_code,'revision',s.revision)) FROM (SELECT * FROM action_plan_steps WHERE plan_id=p.id ORDER BY ordinal) s) AS stepsJson
    FROM cases c LEFT JOIN action_plans p ON p.case_id=c.id WHERE c.workspace_id=?${caseScope} AND c.archived_at IS NULL ORDER BY c.updated_at DESC`;
  const rows=caseId ? await db.prepare(query).bind(workspace.id,caseId).all() : await db.prepare(query).bind(workspace.id).all();
  return response({cases:(rows.results as Array<Record<string,unknown>>).map(row=>({...row,steps:parseJson(String(row.stepsJson||"[]"),[])}))});
});

export const POST = withApiErrors(async function POST(request:Request){
  assertSafeWrite(request); const user=await requireApiUser();
  const parsed=await parseJsonRequest(request,caseCreateInputSchema,4_096);
  if(!parsed.ok)return response({error:"INVALID_CASE_INPUT",code:parsed.error},400);
  const {title,description,legalArea,locale}=parsed.data;
  const now=isoNow(); const caseId=crypto.randomUUID(); const planId=crypto.randomUUID();
  const steps=caseScenarioSteps(legalArea,locale).map((stepTitle,ordinal)=>({id:crypto.randomUUID(),title:stepTitle,ordinal:ordinal+1,status:"not_started"}));
  const planTitle=`${{ ru: "План", uz: "Reja", en: "Plan" }[locale]}: ${title}`;
  const initialSnapshot=JSON.stringify({version:1,title:planTitle,status:"in_progress",progressPercent:0,steps});
  const db=requireD1();
  const workspace=await workspaceForContentEditor(user);
  const accountType=workspace.type==="business"?"business":parsed.data.accountType==="business"?"individual":parsed.data.accountType;
  if(!caseScenarioMatchesAccount(legalArea,accountType))return response({error:"INVALID_CASE_SCENARIO"},400);
  await db.batch([
    db.prepare("INSERT INTO cases (id,workspace_id,owner_user_id,account_type,locale,title,description,legal_area,status,current_revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'open',1,?,?)").bind(caseId,workspace.id,user.id,accountType,locale,title,description||null,legalArea,now,now),
    db.prepare("INSERT INTO action_plans (id,case_id,created_by_user_id,title,status,progress_percent,current_revision,created_at,updated_at) VALUES (?,?,?,?,'in_progress',0,1,?,?)")
      .bind(planId,caseId,user.id,planTitle,now,now),
    ...steps.map((step)=>db.prepare("INSERT INTO action_plan_steps (id,plan_id,ordinal,title,status,deadline_type,revision,created_at,updated_at) VALUES (?,?,?,?,'not_started','calendar_days',1,?,?)")
      .bind(step.id,planId,step.ordinal,step.title,now,now)),
    db.prepare("INSERT INTO action_plan_versions (id,plan_id,version,created_by_user_id,reason,snapshot_json,created_at) VALUES (?,?,1,?,'plan_created',?,?)")
      .bind(crypto.randomUUID(),planId,user.id,initialSnapshot,now),    db.prepare("INSERT INTO case_events (id,case_id,actor_user_id,event_type,metadata_json,created_at) VALUES (?,?,?,'case_created',?,?)").bind(crypto.randomUUID(),caseId,user.id,JSON.stringify({legalArea}),now),
  ]);
  return response({ok:true,caseId,planId},201);
});
