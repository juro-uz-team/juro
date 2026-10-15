import type { PoolClient } from "pg";
import { audit, memberAllowed, notify, requireCase } from "./access";
import {
  isLegal,
  isManager,
  minorUnits,
  PracticeError,
  type Actor,
  type Command,
  type Locale,
} from "./domain";

export async function initializePractice(
  client: PoolClient,
  workspaceId: string,
  locale: Locale,
) {
  const names = {
    ru: [
      "Консультации",
      "Судебные дела",
      "Договорная работа",
      "Корпоративное сопровождение",
      "Новое обращение",
      "В работе",
      "Завершено",
    ],
    uz: [
      "Maslahatlar",
      "Sud ishlari",
      "Shartnomalar",
      "Korporativ xizmatlar",
      "Yangi murojaat",
      "Jarayonda",
      "Yakunlangan",
    ],
    en: [
      "Consultations",
      "Litigation",
      "Contracts",
      "Corporate services",
      "New enquiry",
      "In progress",
      "Completed",
    ],
  }[locale];
  for (let i = 0; i < 4; i++) {
    await client.query(
      `INSERT INTO practice_pipelines(id,workspace_id,name,stages) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO NOTHING`,
      [
        `${workspaceId}:pipeline:${i}`,
        workspaceId,
        names[i],
        JSON.stringify([
          { id: "new", name: names[4] },
          { id: "active", name: names[5] },
          { id: "done", name: names[6] },
        ]),
      ],
    );
  }
  const templateNames = {
    ru: ["Консультация", "Договор", "Судебное дело"],
    uz: ["Maslahat", "Shartnoma", "Sud ishi"],
    en: ["Consultation", "Contract", "Court case"],
  }[locale];
  const tasks = {
    ru: ["Проверить документы", "Согласовать план с клиентом"],
    uz: ["Hujjatlarni tekshirish", "Rejani mijoz bilan kelishish"],
    en: ["Review documents", "Agree the plan with the client"],
  }[locale];
  for (let i = 0; i < templateNames.length; i++)
    await client.query(
      `INSERT INTO practice_case_templates(id,workspace_id,name,tasks)
    VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
      [
        `${workspaceId}:template:${i}`,
        workspaceId,
        templateNames[i],
        JSON.stringify(tasks),
      ],
    );
}

export async function crmCommand(
  client: PoolClient,
  actor: Actor,
  command: Command,
): Promise<object | undefined> {
  const now = new Date().toISOString(),
    id = crypto.randomUUID();
  switch (command.action) {
    case "contact.create": {
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      await client.query(
        `INSERT INTO contacts(id,owner_user_id,label,full_name,phone,created_at,updated_at) VALUES($1,$2,$3,$3,$4,$5,$5)`,
        [id, actor.userId, command.name, command.phone, now],
      );
      await client.query(
        `INSERT INTO practice_contacts(contact_id,workspace_id,kind,email,company_name,requisites) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          id,
          actor.workspaceId,
          command.kind,
          command.email,
          command.companyName,
          JSON.stringify(command.requisites),
        ],
      );
      await audit(client, actor, "contact", id, command.action);
      return { id };
    }
    case "contact.update": {
      await contactAllowed(client, actor, command.contactId);
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      await client.query(
        `UPDATE contacts SET full_name=$2,label=$2,phone=$3,updated_at=$4 WHERE id=$1`,
        [command.contactId, command.name, command.phone, now],
      );
      await client.query(
        `UPDATE practice_contacts SET email=$3,requisites=$4 WHERE contact_id=$1 AND workspace_id=$2`,
        [
          command.contactId,
          actor.workspaceId,
          command.email,
          JSON.stringify(command.requisites),
        ],
      );
      await audit(client, actor, "contact", command.contactId, command.action);
      return { id: command.contactId };
    }
    case "pipeline.save": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      if (command.pipelineId) {
        const current = (
          await client.query(
            `SELECT id FROM practice_pipelines WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,
            [actor.workspaceId, command.pipelineId],
          )
        ).rows[0];
        if (!current) throw new PracticeError("NOT_FOUND", 404);
        const used = (
          await client.query(
            `SELECT DISTINCT stage_id FROM practice_matters WHERE workspace_id=$1 AND pipeline_id=$2`,
            [actor.workspaceId, current.id],
          )
        ).rows;
        if (
          used.some(
            (row) => !command.stages.some((stage) => stage.id === row.stage_id),
          )
        )
          throw new PracticeError("STAGE_IN_USE", 409);
        await client.query(
          `UPDATE practice_pipelines SET name=$3,stages=$4 WHERE workspace_id=$1 AND id=$2`,
          [
            actor.workspaceId,
            current.id,
            command.name,
            JSON.stringify(command.stages),
          ],
        );
      } else
        await client.query(
          `INSERT INTO practice_pipelines(id,workspace_id,name,stages) VALUES($1,$2,$3,$4)`,
          [id, actor.workspaceId, command.name, JSON.stringify(command.stages)],
        );
      await audit(
        client,
        actor,
        "pipeline",
        command.pipelineId ?? id,
        command.action,
      );
      return { id: command.pipelineId ?? id };
    }
    case "case.create": {
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const contact = await contactAllowed(client, actor, command.contactId);
      if (!isManager(actor) && actor.userId !== command.responsibleUserId)
        throw new PracticeError("ACCESS_DENIED", 403);
      await memberAllowed(client, actor, command.responsibleUserId);
      await stageAllowed(client, actor, command.pipelineId, command.stageId);
      const caseId = command.existingCaseId ?? id;
      let source = command.source;
      if (command.existingCaseId) {
        // An existing case may only be attached by its actual owner or a workspace manager.
        const existing = (
          await client.query(`SELECT * FROM cases WHERE id=$1 FOR UPDATE`, [
            caseId,
          ])
        ).rows[0];
        if (!existing) throw new PracticeError("NOT_FOUND", 404);
        if (existing.workspace_id === actor.workspaceId) {
          if (existing.owner_user_id !== actor.userId && !isManager(actor))
            throw new PracticeError("NOT_FOUND", 404);
        } else {
          if (actor.role === "assistant")
            throw new PracticeError("ACCESS_DENIED", 403);
          if (command.responsibleUserId !== actor.userId)
            throw new PracticeError("ACCESS_DENIED", 403);
          const grant = (
            await client.query(
              `SELECT g.id FROM lawyer_access_grants g JOIN lawyer_requests r ON r.id=g.lawyer_request_id AND r.case_id=g.case_id JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id AND p.user_id=g.lawyer_user_id
            WHERE g.case_id=$1 AND g.lawyer_user_id=$2 AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at::timestamptz>now()) AND r.requester_user_id=$3 AND r.workspace_id=$4 AND p.status='public_approved' AND p.marketplace_status='public_approved'`,
              [
                caseId,
                actor.userId,
                existing.owner_user_id,
                existing.workspace_id,
              ],
            )
          ).rows[0];
          if (!grant) throw new PracticeError("NOT_FOUND", 404);
          const consent = (
            await client.query(
              `SELECT 1 FROM practice_invitations WHERE workspace_id=$1 AND contact_id=$2 AND accepted_by=$3 AND confirmed_at IS NOT NULL AND revoked_at IS NULL LIMIT 1`,
              [actor.workspaceId, command.contactId, existing.owner_user_id],
            )
          ).rows[0];
          if (contact.linked_user_id !== existing.owner_user_id || !consent)
            throw new PracticeError("CLIENT_LINK_REQUIRED", 409);
        }
        const marketplace = (
          await client.query(
            `SELECT 1 FROM lawyer_requests WHERE case_id=$1 LIMIT 1`,
            [caseId],
          )
        ).rows[0];
        if (marketplace) source = "juro_marketplace";
      } else
        await client.query(
          `INSERT INTO cases(id,workspace_id,owner_user_id,account_type,locale,title,description,legal_area,status,current_revision,created_at,updated_at)
        SELECT $1,w.id,$2,CASE WHEN w.type='business' THEN 'business' ELSE 'lawyer' END,w.locale,$3,$4,$5,'open',1,$6,$6 FROM workspaces w WHERE id=$7`,
          [
            caseId,
            actor.userId,
            command.title,
            command.description,
            command.category,
            now,
            actor.workspaceId,
          ],
        );
      await client.query(
        `INSERT INTO practice_matters(case_id,workspace_id,contact_id,pipeline_id,stage_id,source,service_type,responsible_user_id,expected_minor,currency,next_action,custom_fields)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          caseId,
          actor.workspaceId,
          command.contactId,
          command.pipelineId,
          command.stageId,
          source,
          command.serviceType,
          command.responsibleUserId,
          minorUnits(command.expected, command.currency),
          command.currency,
          command.nextAction,
          JSON.stringify(command.customFields),
        ],
      );
      for (const userId of new Set([actor.userId, command.responsibleUserId]))
        await client.query(
          `INSERT INTO practice_assignments(case_id,user_id) VALUES($1,$2)`,
          [caseId, userId],
        );
      await audit(client, actor, "case", caseId, command.action, {
        source,
        stageId: command.stageId,
      });
      return { id: caseId };
    }
    case "case.update": {
      const matter = await requireCase(client, actor, command.caseId);
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      await stageAllowed(client, actor, matter.pipeline_id, command.stageId);
      const schema =
        (
          await client.query(
            `SELECT t.fields FROM practice_case_templates t WHERE t.id=(SELECT metadata_json::jsonb->>'templateId' FROM case_events WHERE case_id=$1 AND event_type='practice_work_started' ORDER BY created_at DESC LIMIT 1)`,
            [command.caseId],
          )
        ).rows[0]?.fields ?? [];
      for (const field of schema) {
        const value = command.customFields[field.label];
        if (value === undefined) continue;
        if (
          (field.type === "number" && typeof value !== "number") ||
          (field.type === "boolean" && typeof value !== "boolean") ||
          (field.type === "date" &&
            value !== "" &&
            !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) ||
          (field.type === "text" && typeof value !== "string")
        )
          throw new PracticeError("INVALID_INPUT");
      }
      const updated = await client.query(
        `UPDATE practice_matters SET stage_id=$3,next_action=$4,client_status=$5,custom_fields=$6,revision=revision+1
        WHERE workspace_id=$1 AND case_id=$2 AND revision=$7 RETURNING revision`,
        [
          actor.workspaceId,
          command.caseId,
          command.stageId,
          command.nextAction,
          command.clientStatus,
          JSON.stringify(command.customFields),
          command.revision,
        ],
      );
      if (!updated.rowCount) throw new PracticeError("REVISION_CONFLICT", 409);
      await client.query(`UPDATE cases SET updated_at=$2 WHERE id=$1`, [
        command.caseId,
        now,
      ]);
      await client.query(
        `INSERT INTO case_events(id,case_id,actor_user_id,event_type,metadata_json,created_at) VALUES($1,$2,$3,'practice_stage_changed',$4,$5)`,
        [
          id,
          command.caseId,
          actor.userId,
          JSON.stringify({ from: matter.stage_id, to: command.stageId }),
          now,
        ],
      );
      await audit(client, actor, "case", command.caseId, command.action, {
        from: matter.stage_id,
        to: command.stageId,
      });
      return { revision: updated.rows[0].revision };
    }
    case "case.assign": {
      await requireCase(client, actor, command.caseId);
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      for (const userId of command.userIds)
        await memberAllowed(client, actor, userId);
      await client.query(`DELETE FROM practice_assignments WHERE case_id=$1`, [
        command.caseId,
      ]);
      for (const userId of new Set(command.userIds))
        await client.query(
          `INSERT INTO practice_assignments(case_id,user_id) VALUES($1,$2)`,
          [command.caseId, userId],
        );
      await audit(client, actor, "case", command.caseId, command.action, {
        userIds: command.userIds,
      });
      return { ok: true };
    }
    case "task.create": {
      await requireCase(client, actor, command.caseId);
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const assignee = await memberAllowed(
        client,
        actor,
        command.assigneeUserId,
      );
      await requireCase(
        client,
        { ...actor, userId: command.assigneeUserId, role: assignee.role },
        command.caseId,
      );
      await createTask(
        client,
        actor,
        id,
        command.caseId,
        command.title,
        command.assigneeUserId,
        command.dueAt,
        command.priority,
        command.clientVisible,
        command.description,
      );
      await audit(client, actor, "task", id, command.action);
      return { id };
    }
    case "task.update": {
      await requireCase(client, actor, command.caseId);
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const result = await client.query(
        `UPDATE tasks SET status=$4,completed_at=$5,updated_at=$6 WHERE id=$1 AND case_id=$2 AND workspace_id=$3 RETURNING id`,
        [
          command.taskId,
          command.caseId,
          actor.workspaceId,
          command.status,
          command.status === "completed" ? now : null,
          now,
        ],
      );
      if (!result.rowCount) throw new PracticeError("NOT_FOUND", 404);
      await audit(client, actor, "task", command.taskId, command.action);
      return { ok: true };
    }
    case "entry.create": {
      await requireCase(client, actor, command.caseId);
      if (
        actor.role === "client" &&
        (command.kind !== "message" || !command.clientVisible)
      )
        throw new PracticeError("ACCESS_DENIED", 403);
      await client.query(
        `INSERT INTO practice_entries(id,case_id,author_user_id,kind,body,client_visible) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          id,
          command.caseId,
          actor.userId,
          command.kind,
          command.body,
          command.clientVisible,
        ],
      );
      if (command.clientVisible)
        await notifyParticipants(
          client,
          actor,
          command.caseId,
          `entry:${id}`,
          "message",
          id,
        );
      await audit(client, actor, "entry", id, command.action);
      return { id };
    }
    case "entry.confirm": {
      await requireCase(client, actor, command.caseId);
      if (actor.role !== "client")
        throw new PracticeError("ACCESS_DENIED", 403);
      const result = await client.query(
        `UPDATE practice_entries SET confirmed_by=$3 WHERE id=$1 AND case_id=$2 AND kind='milestone' AND client_visible AND confirmed_by IS NULL RETURNING id`,
        [command.entryId, command.caseId, actor.userId],
      );
      if (!result.rowCount) throw new PracticeError("NOT_FOUND", 404);
      return { ok: true };
    }
    case "invitation.create": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      await contactAllowed(client, actor, command.contactId);
      const token = crypto.randomUUID() + crypto.randomUUID();
      const { hash } = await import("./domain");
      await client.query(
        `INSERT INTO practice_invitations(id,workspace_id,contact_id,token_hash,invited_by,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '7 days')`,
        [id, actor.workspaceId, command.contactId, hash(token), actor.userId],
      );
      await audit(client, actor, "invitation", id, command.action);
      return { id, token };
    }
    case "invitation.confirm": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const invite = (
        await client.query(
          `SELECT * FROM practice_invitations WHERE workspace_id=$1 AND id=$2 AND revoked_at IS NULL AND accepted_by IS NOT NULL AND confirmed_at IS NULL AND expires_at>now() FOR UPDATE`,
          [actor.workspaceId, command.invitationId],
        )
      ).rows[0];
      if (!invite) throw new PracticeError("NOT_FOUND", 404);
      const contact = (
        await client.query(
          `SELECT linked_user_id FROM practice_contacts WHERE contact_id=$1 AND workspace_id=$2 FOR UPDATE`,
          [invite.contact_id, actor.workspaceId],
        )
      ).rows[0];
      if (
        contact.linked_user_id &&
        contact.linked_user_id !== invite.accepted_by
      )
        throw new PracticeError("CONTACT_ALREADY_LINKED", 409);
      await client.query(
        `UPDATE practice_contacts SET linked_user_id=$3 WHERE workspace_id=$1 AND contact_id=$2`,
        [actor.workspaceId, invite.contact_id, invite.accepted_by],
      );
      await client.query(
        `UPDATE practice_invitations SET confirmed_by=$2,confirmed_at=now() WHERE id=$1`,
        [invite.id, actor.userId],
      );
      await audit(client, actor, "invitation", invite.id, command.action);
      return { ok: true };
    }
    case "invitation.revoke": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      await client.query(
        `UPDATE practice_invitations SET revoked_at=now() WHERE id=$1 AND workspace_id=$2`,
        [command.invitationId, actor.workspaceId],
      );
      await audit(
        client,
        actor,
        "invitation",
        command.invitationId,
        command.action,
      );
      return { ok: true };
    }
    case "preferences.save": {
      await client.query(
        `INSERT INTO practice_preferences(workspace_id,user_id,value) VALUES($1,$2,$3)
        ON CONFLICT(workspace_id,user_id) DO UPDATE SET value=excluded.value`,
        [
          actor.workspaceId,
          actor.userId,
          JSON.stringify({ blocks: command.blocks }),
        ],
      );
      return { ok: true };
    }
    case "settings.save": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      await client.query(
        `UPDATE practice_workspaces SET provider_details=$2,settings=$3,updated_at=now() WHERE workspace_id=$1`,
        [
          actor.workspaceId,
          JSON.stringify(command.providerDetails),
          JSON.stringify(command.settings),
        ],
      );
      await audit(
        client,
        actor,
        "workspace",
        actor.workspaceId,
        command.action,
      );
      return { ok: true };
    }
    case "member.role": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      if (command.active) {
        const capacity = (
          await client.query(
            `SELECT p.seat_limit,(SELECT count(*) FROM workspace_members WHERE workspace_id=$1 AND status='active' AND id<>$2)::integer AS count FROM practice_workspaces p WHERE p.workspace_id=$1`,
            [actor.workspaceId, command.memberId],
          )
        ).rows[0];
        if (capacity?.seat_limit && capacity.count >= capacity.seat_limit)
          throw new PracticeError("SEAT_LIMIT", 403);
      }
      const updated = await client.query(
        `UPDATE workspace_members SET role=$3,status=$4,updated_at=$5 WHERE workspace_id=$1 AND id=$2 AND role NOT IN ('owner','admin') RETURNING user_id`,
        [
          actor.workspaceId,
          command.memberId,
          command.role,
          command.active ? "active" : "inactive",
          now,
        ],
      );
      if (!updated.rowCount) throw new PracticeError("NOT_FOUND", 404);
      if (command.role === "accountant" || !command.active)
        await client.query(
          `DELETE FROM practice_assignments WHERE user_id=$1 AND case_id IN (SELECT case_id FROM practice_matters WHERE workspace_id=$2)`,
          [updated.rows[0].user_id, actor.workspaceId],
        );
      await audit(client, actor, "member", command.memberId, command.action);
      return { ok: true };
    }
    case "case-template.save": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      await client.query(
        `INSERT INTO practice_case_templates(id,workspace_id,name,fields,tasks,stages) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          id,
          actor.workspaceId,
          command.name,
          JSON.stringify(command.fields),
          JSON.stringify(command.tasks),
          JSON.stringify(command.stages),
        ],
      );
      return { id };
    }
    case "case.start": {
      await requireCase(client, actor, command.caseId);
      if (!isLegal(actor) || actor.role === "assistant")
        throw new PracticeError("ACCESS_DENIED", 403);
      const template = (
        await client.query(
          `SELECT * FROM practice_case_templates WHERE id=$1 AND (workspace_id=$2 OR workspace_id IS NULL)`,
          [command.templateId, actor.workspaceId],
        )
      ).rows[0];
      if (!template) throw new PracticeError("NOT_FOUND", 404);
      const prior = (
        await client.query(
          `SELECT 1 FROM case_events WHERE case_id=$1 AND event_type='practice_work_started'`,
          [command.caseId],
        )
      ).rows[0];
      if (prior) throw new PracticeError("WORK_ALREADY_STARTED", 409);
      const additions: Record<string, string | number | boolean | null> = {};
      for (const field of template.fields)
        additions[field.label] =
          field.type === "number" ? 0 : field.type === "boolean" ? false : "";
      await client.query(
        `UPDATE practice_matters SET custom_fields=custom_fields || $2::jsonb,revision=revision+1 WHERE case_id=$1`,
        [command.caseId, JSON.stringify(additions)],
      );
      if (template.stages.length) {
        const pipelineId = `${template.id}:pipeline`,
          stages = template.stages.map((name: string, index: number) => ({
            id: `stage-${index}`,
            name,
          }));
        await client.query(
          `INSERT INTO practice_pipelines(id,workspace_id,name,stages) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`,
          [
            pipelineId,
            actor.workspaceId,
            template.name,
            JSON.stringify(stages),
          ],
        );
        await client.query(
          `UPDATE practice_matters SET pipeline_id=$2,stage_id=$3 WHERE case_id=$1`,
          [command.caseId, pipelineId, stages[0].id],
        );
      }
      for (const title of template.tasks)
        await createTask(
          client,
          actor,
          crypto.randomUUID(),
          command.caseId,
          title,
          actor.userId,
          null,
          "normal",
          false,
          "",
        );
      await client.query(
        `INSERT INTO case_events(id,case_id,actor_user_id,event_type,metadata_json,created_at) VALUES($1,$2,$3,'practice_work_started',$4,$5)`,
        [
          id,
          command.caseId,
          actor.userId,
          JSON.stringify({ templateId: template.id }),
          now,
        ],
      );
      await audit(client, actor, "case", command.caseId, command.action);
      return { created: template.tasks.length };
    }
    case "notification.read": {
      await client.query(
        `UPDATE practice_notifications SET read_at=now() WHERE id=$1 AND workspace_id=$2 AND user_id=$3`,
        [command.notificationId, actor.workspaceId, actor.userId],
      );
      await client.query(
        `UPDATE notifications SET read_at=$4 WHERE id=$1 AND workspace_id=$2 AND user_id=$3`,
        [command.notificationId, actor.workspaceId, actor.userId, now],
      );
      return { ok: true };
    }
    case "file.visibility": {
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const file = (
        await client.query(
          `SELECT f.* FROM practice_files f JOIN document_files d ON d.id=f.file_id WHERE f.file_id=$1 AND d.workspace_id=$2`,
          [command.fileId, actor.workspaceId],
        )
      ).rows[0];
      if (!file) throw new PracticeError("NOT_FOUND", 404);
      await requireCase(client, actor, file.case_id);
      await client.query(
        `UPDATE practice_files SET client_visible=$2 WHERE file_id=$1`,
        [command.fileId, command.clientVisible],
      );
      await audit(client, actor, "file", file.file_id, command.action, {
        clientVisible: command.clientVisible,
      });
      return { ok: true };
    }
  }
}

export async function contactAllowed(
  client: PoolClient,
  actor: Actor,
  contactId: string,
) {
  const row = (
    await client.query(
      `SELECT p.* FROM practice_contacts p JOIN contacts c ON c.id=p.contact_id WHERE p.workspace_id=$1 AND p.contact_id=$2
    AND ($3 IN ('owner','admin','accountant') OR c.owner_user_id=$4 OR EXISTS(SELECT 1 FROM practice_matters m JOIN practice_assignments a ON a.case_id=m.case_id WHERE m.workspace_id=$1 AND m.contact_id=p.contact_id AND a.user_id=$4))`,
      [actor.workspaceId, contactId, actor.role, actor.userId],
    )
  ).rows[0];
  if (!row) throw new PracticeError("NOT_FOUND", 404);
  return row;
}
async function stageAllowed(
  client: PoolClient,
  actor: Actor,
  pipelineId: string,
  stageId: string,
) {
  const row = (
    await client.query(
      `SELECT stages FROM practice_pipelines WHERE id=$1 AND workspace_id=$2`,
      [pipelineId, actor.workspaceId],
    )
  ).rows[0];
  if (!row?.stages.some((stage: { id: string }) => stage.id === stageId))
    throw new PracticeError("INVALID_STAGE");
}
async function createTask(
  client: PoolClient,
  actor: Actor,
  taskId: string,
  caseId: string,
  title: string,
  userId: string,
  dueAt: string | null,
  priority: string,
  visible: boolean,
  description: string,
) {
  const now = new Date().toISOString();
  await client.query(
    `INSERT INTO tasks(id,workspace_id,case_id,owner_user_id,title,description,due_at,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,'planned',$8,$8)`,
    [
      taskId,
      actor.workspaceId,
      caseId,
      actor.userId,
      title,
      description,
      dueAt,
      now,
    ],
  );
  await client.query(
    `INSERT INTO practice_tasks(task_id,assignee_user_id,priority,client_visible) VALUES($1,$2,$3,$4)`,
    [taskId, userId, priority, visible],
  );
  await notify(
    client,
    actor.workspaceId,
    userId,
    `task:${taskId}`,
    "task",
    taskId,
  );
}
export async function notifyParticipants(
  client: PoolClient,
  actor: Actor,
  caseId: string,
  key: string,
  kind: string,
  entityId: string,
) {
  const users = (
    await client.query(
      `SELECT a.user_id FROM practice_assignments a JOIN workspace_members m ON m.user_id=a.user_id AND m.workspace_id=$2 AND m.status='active' WHERE a.case_id=$1
    UNION SELECT p.linked_user_id FROM practice_matters c JOIN practice_contacts p ON p.contact_id=c.contact_id AND p.workspace_id=c.workspace_id WHERE c.case_id=$1 AND p.linked_user_id IS NOT NULL`,
      [caseId, actor.workspaceId],
    )
  ).rows;
  for (const user of users)
    if (user.user_id !== actor.userId)
      await notify(
        client,
        actor.workspaceId,
        user.user_id,
        key,
        kind,
        entityId,
      );
}
