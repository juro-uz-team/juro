import { z } from "zod";
import { parseLegalChatResponse } from "./legal-chat-schema";
import { aiText } from "./localization";

export const saveAiActionPlanInputSchema = z.object({
  assistantMessageId: z.string().uuid(),
  targetCaseId: z.string().uuid().optional(),
  locale: z.enum(["ru", "uz", "en"]).default("uz"),
}).strict();

export type SaveAiActionPlanInput = z.infer<typeof saveAiActionPlanInputSchema>;

export class AiActionPlanSaveError extends Error {
  constructor(
    readonly code:
      | "AI_ACTION_PLAN_NOT_FOUND"
      | "AI_ACTION_PLAN_CASE_NOT_FOUND"
      | "AI_ACTION_PLAN_INVALID"
      | "AI_ACTION_PLAN_EMPTY"
      | "AI_ACTION_PLAN_PERSISTENCE_FAILED",
  ) {
    super(code);
    this.name = "AiActionPlanSaveError";
  }
}

type PlanSaveScope = {
  db: D1Database;
  workspaceId: string;
  userId: string;
  assistantMessageId: string;
  targetCaseId?: string;
  locale?: "ru" | "uz" | "en";
  now?: string;
};
type SavedPlan = { caseId: string; planId: string; taskCount: number; replay: boolean };

async function planIdentity(parts: string[]) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts))));
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

async function savedConfirmation(input: PlanSaveScope, eventId: string): Promise<SavedPlan | null> {
  const row = await input.db.prepare(`SELECT c.id AS caseId,p.id AS planId,
    COALESCE(json_extract(e.metadata_json,'$.taskCount'),(SELECT count(*) FROM tasks WHERE case_id=c.id)) AS taskCount
    FROM case_events e JOIN cases c ON c.id=e.case_id JOIN action_plans p ON p.case_id=c.id
    WHERE c.workspace_id=? AND c.archived_at IS NULL AND e.actor_user_id=? AND (
      e.id=? OR (json_valid(e.metadata_json) AND json_extract(e.metadata_json,'$.assistantMessageId')=?
        AND ((? IS NULL AND e.event_type='ai_action_plan_confirmed') OR
          (c.id=? AND e.event_type IN ('ai_action_plan_confirmed','ai_action_plan_appended')))))
    ORDER BY e.created_at,e.id LIMIT 1`).bind(input.workspaceId,input.userId,eventId,input.assistantMessageId,input.targetCaseId??null,input.targetCaseId??null)
    .first<{caseId:string;planId:string;taskCount:number}>();
  return row ? {...row,replay:true} : null;
}

/** Explicit confirmation copies only saved practical steps. Dates and document
 * templates require their own confirmed workflow and are never inferred here. */
export async function saveAiActionPlanToCase(input: PlanSaveScope): Promise<SavedPlan> {
  const {db,workspaceId,userId,assistantMessageId} = input;
  const message = await db.prepare(`SELECT m.structured_json AS structuredJson,CASE WHEN w.type='business' THEN 'business' WHEN u.account_type='business' THEN 'individual' ELSE u.account_type END AS accountType
    FROM conversation_messages m JOIN conversations conversation ON conversation.id=m.conversation_id
    JOIN user_profiles u ON u.id=conversation.owner_user_id
    JOIN workspaces w ON w.id=conversation.workspace_id
    JOIN workspace_members member ON member.workspace_id=conversation.workspace_id AND member.user_id=?
    WHERE m.id=? AND m.author_type='assistant' AND conversation.workspace_id=? AND conversation.owner_user_id=?
      AND member.status='active' AND member.role IN ('owner','admin','lawyer','employee')`)
    .bind(userId,assistantMessageId,workspaceId,userId).first<{structuredJson:string|null;accountType:string}>();
  if(!message) throw new AiActionPlanSaveError("AI_ACTION_PLAN_NOT_FOUND");
  const eventId = await planIdentity(["legal-plan-confirmation",workspaceId,userId,assistantMessageId,input.targetCaseId ?? "new"]);
  const replay = await savedConfirmation(input,eventId);
  if(replay) return replay;
  if(!input.targetCaseId){
    const legacy = await db.prepare(`SELECT c.id AS caseId,p.id AS planId,
      (SELECT count(*) FROM tasks WHERE case_id=c.id AND workspace_id=c.workspace_id) AS taskCount
      FROM cases c JOIN action_plans p ON p.case_id=c.id
      WHERE c.id=? AND c.workspace_id=? AND c.owner_user_id=? AND c.archived_at IS NULL`)
      .bind(`case_ai_plan_${assistantMessageId.replaceAll("-", "")}`,workspaceId,userId)
      .first<{caseId:string;planId:string;taskCount:number}>();
    if(legacy) return {...legacy,replay:true};
  }
  let answer: ReturnType<typeof parseLegalChatResponse>;
  try{answer=parseLegalChatResponse(JSON.parse(message.structuredJson ?? "null"));}
  catch{throw new AiActionPlanSaveError("AI_ACTION_PLAN_INVALID");}
  if(answer.responseKind!=="answer" || !answer.actionPlan.length) throw new AiActionPlanSaveError("AI_ACTION_PLAN_EMPTY");
  const target = input.targetCaseId ? await db.prepare(`SELECT c.id AS caseId,p.id AS planId,p.current_revision AS revision
    FROM cases c LEFT JOIN action_plans p ON p.case_id=c.id
    WHERE c.id=? AND c.workspace_id=? AND c.archived_at IS NULL`).bind(input.targetCaseId,workspaceId)
    .first<{caseId:string;planId:string|null;revision:number|null}>() : null;
  if(input.targetCaseId && !target) throw new AiActionPlanSaveError("AI_ACTION_PLAN_CASE_NOT_FOUND");
  const caseId = target?.caseId ?? await planIdentity([eventId,"case"]);
  const planId = target?.planId ?? await planIdentity([eventId,"plan"]);
  const revision = (target?.revision ?? 0)+1;
  const now = input.now ?? new Date().toISOString();
  const locale = input.locale ?? answer.language;
  const title = answer.summary.slice(0,240);
  const planTitle = aiText(locale,"План действий","Harakatlar rejasi","Action plan");
  const ordinal = target?.planId ? (await db.prepare("SELECT COALESCE(max(ordinal),0) AS value FROM action_plan_steps WHERE plan_id=?")
    .bind(planId).first<{value:number}>())!.value : 0;
  const statements: D1PreparedStatement[] = [
    // Recheck mutable permissions and source identity in the same transaction as
    // every write. A stale read must roll back the complete confirmation.
    db.prepare(`SELECT CASE WHEN EXISTS (
      SELECT 1 FROM conversation_messages m JOIN conversations c ON c.id=m.conversation_id
      JOIN workspace_members member ON member.workspace_id=c.workspace_id AND member.user_id=?
      WHERE m.id=? AND m.author_type='assistant' AND m.structured_json=? AND c.workspace_id=? AND c.owner_user_id=?
        AND member.status='active' AND member.role IN ('owner','admin','lawyer','employee')
      ) THEN 1 ELSE json_extract('PLAN_SOURCE_UNAVAILABLE','$') END`)
      .bind(userId,assistantMessageId,message.structuredJson,workspaceId,userId),
  ];
  if(target){
    statements.push(db.prepare(`SELECT CASE WHEN EXISTS(SELECT 1 FROM cases WHERE id=? AND workspace_id=? AND archived_at IS NULL)
      THEN 1 ELSE json_extract('PLAN_CASE_UNAVAILABLE','$') END`).bind(caseId,workspaceId));
  }else{
    statements.push(db.prepare(`INSERT INTO cases(id,workspace_id,owner_user_id,account_type,locale,title,description,legal_area,status,current_revision,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'ai_proposed','open',1,?,?)`).bind(caseId,workspaceId,userId,message.accountType,locale,title,answer.answer,now,now));
  }
  if(target?.planId){
    statements.push(db.prepare(`SELECT CASE WHEN current_revision=? THEN 1 ELSE json_extract('PLAN_REVISION_CONFLICT','$') END
      FROM action_plans WHERE id=?`).bind(target.revision,planId));
  }else{
    statements.push(db.prepare(`INSERT INTO action_plans(id,case_id,created_by_user_id,title,status,progress_percent,current_revision,created_at,updated_at)
      VALUES (?,?,?,?,'in_progress',0,1,?,?)`).bind(planId,caseId,userId,planTitle,now,now));
  }
  for(const [index,step] of answer.actionPlan.entries()){
    const stepId = await planIdentity([eventId,"step",String(index)]);
    statements.push(db.prepare(`INSERT INTO action_plan_steps(id,plan_id,ordinal,title,description,status,deadline_type,action_type,revision,created_at,updated_at)
      VALUES (?,?,?,?,?,'not_started','calendar_days','manual',1,?,?)`).bind(stepId,planId,ordinal+index+1,step.title,step.description,now,now));
    statements.push(db.prepare(`INSERT INTO tasks(id,workspace_id,case_id,plan_step_id,owner_user_id,title,description,deadline_type,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'calendar_days','planned',?,?)`).bind(stepId,workspaceId,caseId,stepId,userId,step.title,step.description,now,now));
  }
  statements.push(db.prepare(`UPDATE action_plans SET current_revision=?,status='in_progress',updated_at=?,
    progress_percent=(SELECT round(100.0*sum(CASE WHEN status='completed' THEN 1 ELSE 0 END)/count(*)) FROM action_plan_steps WHERE plan_id=?)
    WHERE id=?`).bind(revision,now,planId,planId));
  statements.push(db.prepare(`INSERT INTO action_plan_versions(id,plan_id,version,created_by_user_id,reason,snapshot_json,created_at)
    SELECT ?,p.id,?,?,?,json_object('version',p.current_revision,'assistantMessageId',?,'title',p.title,'status',p.status,'progressPercent',p.progress_percent,
      'steps',(SELECT json_group_array(json_object('id',s.id,'ordinal',s.ordinal,'title',s.title,'description',s.description,'status',s.status,
      'dueAt',s.due_at,'safeDueAt',s.safe_due_at,'sourceDate',s.deadline_source_date,'deadlineType',s.deadline_type,'calculationMethod',s.calculation_method,
      'deadlineConfidence',s.deadline_confidence,'actionType',s.action_type,'templateCode',s.template_code,'revision',s.revision))
      FROM (SELECT * FROM action_plan_steps WHERE plan_id=p.id ORDER BY ordinal) s)),? FROM action_plans p WHERE p.id=?`)
    .bind(await planIdentity([eventId,"version"]),revision,userId,target?.planId?"ai_plan_appended":"ai_plan_confirmed",assistantMessageId,now,planId));
  statements.push(db.prepare(`INSERT INTO case_events(id,case_id,actor_user_id,event_type,metadata_json,created_at) VALUES (?,?,?,?,?,?)`)
    .bind(eventId,caseId,userId,target?"ai_action_plan_appended":"ai_action_plan_confirmed",JSON.stringify({assistantMessageId,planId,taskCount:answer.actionPlan.length}),now));
  statements.push(db.prepare("UPDATE cases SET current_revision=current_revision+?,updated_at=? WHERE id=? AND workspace_id=?").bind(target?1:0,now,caseId,workspaceId));
  try{await db.batch(statements);}
  catch{
    // A concurrent identical confirmation can finish between the initial read
    // and the batch. Only a committed receipt permits a successful replay.
    const committed = await savedConfirmation(input,eventId);
    if(committed) return committed;
    throw new AiActionPlanSaveError("AI_ACTION_PLAN_PERSISTENCE_FAILED");
  }
  return {caseId,planId,taskCount:answer.actionPlan.length,replay:false};
}
