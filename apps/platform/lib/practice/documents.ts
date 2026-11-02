import type { PoolClient } from "pg";
import { audit, requireCase } from "./access";
import { notifyParticipants } from "./crm";
import { contentText, sanitizeHtml } from "./content";
import {
  hash,
  isLegal,
  isManager,
  PracticeError,
  transitionAllowed,
  type Actor,
  type Command,
} from "./domain";

export async function documentAllowed(
  client: PoolClient,
  actor: Actor,
  documentId: string,
) {
  const doc = (
    await client.query(
      `SELECT p.*,d.title,d.language,d.owner_user_id FROM practice_documents p JOIN documents d ON d.id=p.document_id AND d.workspace_id=p.workspace_id
    WHERE p.document_id=$1 AND p.workspace_id=$2 FOR UPDATE OF p`,
      [documentId, actor.workspaceId],
    )
  ).rows[0];
  if (!doc) throw new PracticeError("NOT_FOUND", 404);
  await requireCase(client, actor, doc.case_id);
  if (actor.role === "client" && !doc.client_visible)
    throw new PracticeError("NOT_FOUND", 404);
  return doc;
}
export async function snapshot(
  client: PoolClient,
  actor: Actor,
  doc: { document_id: string; revision: number; content: object },
  reason: string,
) {
  const id = crypto.randomUUID();
  const value = JSON.stringify(doc.content);
  const stored = (
    await client.query(
      `INSERT INTO practice_document_versions(id,document_id,revision,content,author_user_id,reason,sha256) VALUES($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT(document_id,revision) DO NOTHING RETURNING id`,
      [
        id,
        doc.document_id,
        doc.revision,
        value,
        actor.userId,
        reason,
        hash(value),
      ],
    )
  ).rows[0];
  if (stored) return stored.id as string;
  return (
    await client.query(
      `SELECT id FROM practice_document_versions WHERE document_id=$1 AND revision=$2`,
      [doc.document_id, doc.revision],
    )
  ).rows[0].id as string;
}

export async function documentCommand(
  client: PoolClient,
  actor: Actor,
  command: Command,
): Promise<object | undefined> {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  switch (command.action) {
    case "document.create": {
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      await requireCase(client, actor, command.caseId);
      const html = sanitizeHtml(command.content),
        content = { html };
      const templateId = "practice-editable-v1";
      await client.query(
        `INSERT INTO document_templates(id,key,category,active,created_at,updated_at) VALUES($1,$1,'Practice',1,$2,$2) ON CONFLICT(id) DO NOTHING`,
        [templateId, now],
      );
      await client.query(
        `INSERT INTO documents(id,workspace_id,owner_user_id,template_id,template_code,template_version,language,participant_mode,title,category,status,case_id,created_at,updated_at)
        VALUES($1,$2,$3,$4,'practice-editable','1',$5,'parties',$6,'Practice','Черновик',$7,$8,$8)`,
        [
          id,
          actor.workspaceId,
          actor.userId,
          templateId,
          command.language,
          command.title,
          command.caseId,
          now,
        ],
      );
      await client.query(
        `INSERT INTO document_answers(document_id,answers_json,updated_at) VALUES($1,'{}',$2)`,
        [id, now],
      );
      await client.query(
        `INSERT INTO document_current_content(document_id,auto_content,final_content,manually_edited,updated_at) VALUES($1,$2,$2,1,$3)`,
        [id, contentText(html), now],
      );
      await client.query(
        `INSERT INTO practice_documents(document_id,workspace_id,case_id,content) VALUES($1,$2,$3,$4)`,
        [id, actor.workspaceId, command.caseId, JSON.stringify(content)],
      );
      await snapshot(
        client,
        actor,
        { document_id: id, revision: 1, content },
        "created",
      );
      await audit(client, actor, "document", id, command.action);
      return { id, revision: 1 };
    }
    case "document.save": {
      if (!isLegal(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const doc = await documentAllowed(client, actor, command.documentId);
      if (doc.revision !== command.revision)
        throw new PracticeError("REVISION_CONFLICT", 409);
      if (!["draft", "changes_requested"].includes(doc.state))
        throw new PracticeError("VERSION_LOCKED", 409);
      const content = { html: sanitizeHtml(command.content) };
      const revision = doc.revision + 1;
      await updateContent(client, doc.document_id, content, revision, now);
      if (command.checkpoint)
        await snapshot(
          client,
          actor,
          { document_id: doc.document_id, revision, content },
          "checkpoint",
        );
      await audit(client, actor, "document", doc.document_id, command.action, {
        revision,
        checkpoint: command.checkpoint,
      });
      return { id: doc.document_id, revision };
    }
    case "document.transition": {
      if (!isLegal(actor) || actor.role === "assistant")
        throw new PracticeError("ACCESS_DENIED", 403);
      const doc = await documentAllowed(client, actor, command.documentId);
      if (doc.revision !== command.revision)
        throw new PracticeError("REVISION_CONFLICT", 409);
      if (!transitionAllowed[doc.state]?.includes(command.state))
        throw new PracticeError("INVALID_TRANSITION", 409);
      if (
        command.state === "review" &&
        /\{\{[\w.]+\}\}/.test(contentText(doc.content.html))
      )
        throw new PracticeError("UNFILLED_FIELDS");
      let versionId = doc.agreed_version_id;
      let publishedVersionId = doc.published_version_id;
      if (command.state === "review")
        publishedVersionId = await snapshot(
          client,
          actor,
          { ...doc, revision: doc.revision + 1 },
          "published",
        );
      if (command.state === "agreed") {
        const clientUser = (
          await client.query(
            `SELECT p.linked_user_id FROM practice_matters m JOIN practice_contacts p ON p.contact_id=m.contact_id AND p.workspace_id=m.workspace_id WHERE m.case_id=$1`,
            [doc.case_id],
          )
        ).rows[0]?.linked_user_id;
        if (clientUser) {
          const approval = (
            await client.query(
              `SELECT id FROM practice_document_reviews WHERE document_id=$1 AND revision=$2 AND author_user_id=$3 AND kind='approval'`,
              [doc.document_id, doc.revision, clientUser],
            )
          ).rows[0];
          if (!approval)
            throw new PracticeError("CLIENT_APPROVAL_REQUIRED", 409);
        }
        const open = (
          await client.query(
            `SELECT id FROM practice_document_reviews WHERE document_id=$1 AND kind='proposal' AND state='open' LIMIT 1`,
            [doc.document_id],
          )
        ).rows[0];
        if (open) throw new PracticeError("OPEN_PROPOSALS", 409);
        versionId = await snapshot(client, actor, doc, "agreed");
      }
      if (command.state === "signed_confirmed") {
        if (!versionId || !command.signedFileId)
          throw new PracticeError("SIGNED_FILE_REQUIRED");
        const file = (
          await client.query(
            `SELECT f.file_id FROM practice_files f JOIN document_files d ON d.id=f.file_id WHERE f.file_id=$1 AND f.case_id=$2 AND f.version_id=$3 AND f.purpose='signed' AND d.document_id=$4`,
            [command.signedFileId, doc.case_id, versionId, doc.document_id],
          )
        ).rows[0];
        if (!file) throw new PracticeError("SIGNED_VERSION_MISMATCH", 409);
        await client.query(
          `INSERT INTO practice_signatures(id,version_id,file_id,confirmed_by) VALUES($1,$2,$3,$4)`,
          [id, versionId, file.file_id, actor.userId],
        );
      }
      // Starting another draft preserves the previous immutable agreement and signature records.
      const newDraft = command.state === "draft";
      await client.query(
        `UPDATE practice_documents SET state=$2,client_visible=CASE WHEN $2='review' THEN true ELSE client_visible END,
        agreed_version_id=$3,signed_file_id=$4,signed_confirmed_by=$5,signed_confirmed_at=$6,published_version_id=$7,revision=revision+1 WHERE document_id=$1`,
        [
          doc.document_id,
          command.state,
          newDraft ? null : versionId,
          command.state === "signed_confirmed"
            ? command.signedFileId
            : newDraft
              ? null
              : doc.signed_file_id,
          command.state === "signed_confirmed"
            ? actor.userId
            : newDraft
              ? null
              : doc.signed_confirmed_by,
          command.state === "signed_confirmed"
            ? now
            : newDraft
              ? null
              : doc.signed_confirmed_at,
          publishedVersionId,
        ],
      );
      await client.query(
        `UPDATE documents SET revision=revision+1,updated_at=$2 WHERE id=$1`,
        [doc.document_id, now],
      );
      if (command.state === "review")
        await notifyParticipants(
          client,
          actor,
          doc.case_id,
          `review:${doc.document_id}:${doc.revision + 1}`,
          "document_review",
          doc.document_id,
        );
      await audit(client, actor, "document", doc.document_id, command.action, {
        from: doc.state,
        to: command.state,
        versionId,
      });
      return { revision: doc.revision + 1 };
    }
    case "document.review": {
      const doc = await documentAllowed(client, actor, command.documentId);
      if (doc.revision !== command.revision)
        throw new PracticeError("REVISION_CONFLICT", 409);
      if (!["review", "changes_requested"].includes(doc.state))
        throw new PracticeError("VERSION_LOCKED", 409);
      if (command.kind === "approval" && actor.role !== "client")
        throw new PracticeError("CLIENT_APPROVAL_REQUIRED", 403);
      if (command.kind === "proposal" && !command.proposal)
        throw new PracticeError("INVALID_INPUT");
      await client.query(
        `INSERT INTO practice_document_reviews(id,document_id,revision,author_user_id,kind,anchor,body,proposal) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          id,
          doc.document_id,
          doc.revision,
          actor.userId,
          command.kind,
          command.anchor,
          command.body,
          command.proposal
            ? JSON.stringify({ html: sanitizeHtml(command.proposal) })
            : null,
        ],
      );
      if (command.kind === "proposal")
        await client.query(
          `UPDATE practice_documents SET state='changes_requested' WHERE document_id=$1`,
          [doc.document_id],
        );
      await notifyParticipants(
        client,
        actor,
        doc.case_id,
        `comment:${id}`,
        "document_comment",
        doc.document_id,
      );
      await audit(client, actor, "document_review", id, command.action);
      return { id };
    }
    case "document.resolve": {
      if (!isLegal(actor) || actor.role === "assistant")
        throw new PracticeError("ACCESS_DENIED", 403);
      const doc = await documentAllowed(client, actor, command.documentId);
      if (
        doc.revision !== command.revision ||
        !["review", "changes_requested"].includes(doc.state)
      )
        throw new PracticeError("REVISION_CONFLICT", 409);
      const review = (
        await client.query(
          `SELECT * FROM practice_document_reviews WHERE id=$1 AND document_id=$2 AND kind='proposal' AND state='open' FOR UPDATE`,
          [command.reviewId, doc.document_id],
        )
      ).rows[0];
      if (!review) throw new PracticeError("NOT_FOUND", 404);
      if (command.accept) {
        if (review.revision !== doc.revision)
          throw new PracticeError("STALE_PROPOSAL", 409);
        await snapshot(client, actor, doc, "before_proposal");
        await updateContent(
          client,
          doc.document_id,
          review.proposal,
          doc.revision + 1,
          now,
        );
        await snapshot(
          client,
          actor,
          { ...doc, content: review.proposal, revision: doc.revision + 1 },
          "accepted_proposal",
        );
      }
      await client.query(
        `UPDATE practice_document_reviews SET state=$2,resolved_by=$3 WHERE id=$1`,
        [review.id, command.accept ? "accepted" : "rejected", actor.userId],
      );
      await audit(client, actor, "document_review", review.id, command.action);
      return { revision: doc.revision + (command.accept ? 1 : 0) };
    }
    case "template.save": {
      if (!isLegal(actor) || command.global)
        throw new PracticeError("ACCESS_DENIED", 403);
      if (command.templateId) {
        const result = await client.query(
          `UPDATE practice_document_templates SET name=$3,kind=$4,language=$5,content=$6,fields=$7,updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id`,
          [
            command.templateId,
            actor.workspaceId,
            command.name,
            command.kind,
            command.language,
            JSON.stringify({ html: sanitizeHtml(command.content) }),
            JSON.stringify(command.fields),
          ],
        );
        if (!result.rowCount) throw new PracticeError("NOT_FOUND", 404);
      } else
        await client.query(
          `INSERT INTO practice_document_templates(id,workspace_id,name,kind,language,content,fields,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            actor.workspaceId,
            command.name,
            command.kind,
            command.language,
            JSON.stringify({ html: sanitizeHtml(command.content) }),
            JSON.stringify(command.fields),
            actor.userId,
          ],
        );
      await audit(
        client,
        actor,
        "template",
        command.templateId ?? id,
        command.action,
      );
      return { id: command.templateId ?? id };
    }
    case "template.publication": {
      if (!isManager(actor)) throw new PracticeError("ACCESS_DENIED", 403);
      const template = (
        await client.query(
          `SELECT name,kind,language,content,fields FROM practice_document_templates WHERE id=$1 AND workspace_id=$2`,
          [command.templateId, actor.workspaceId],
        )
      ).rows[0];
      if (!template) throw new PracticeError("NOT_FOUND", 404);
      await audit(
        client,
        actor,
        "template",
        command.templateId,
        "template.publication_requested",
        {
          requested: command.requested,
          contentHash: hash(JSON.stringify(template)),
        },
      );
      return { ok: true };
    }
  }
}
async function updateContent(
  client: PoolClient,
  documentId: string,
  content: { html: string },
  revision: number,
  now: string,
) {
  await client.query(
    `UPDATE practice_documents SET content=$2,revision=$3 WHERE document_id=$1`,
    [documentId, JSON.stringify(content), revision],
  );
  await client.query(
    `UPDATE document_current_content SET final_content=$2,manually_edited=1,updated_at=$3 WHERE document_id=$1`,
    [documentId, contentText(content.html), now],
  );
  await client.query(
    `UPDATE documents SET revision=$2,updated_at=$3 WHERE id=$1`,
    [documentId, revision, now],
  );
}
