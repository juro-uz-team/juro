import { assertSafeWrite, requireApiUser } from "../../../../../../lib/document-builder/auth/api";
import { normalizeEmail } from "../../../../../../lib/auth/crypto";
import { prepareKeyedIdentityEvidence } from "../../../../../../lib/auth/identity-evidence";
import {
  normalizePhoneForLookup,
  resolveUserIdentity,
  userIdsByIdentifier,
  userIdentitySelect,
  type UserIdentityRow,
} from "../../../../../../lib/auth/identity-protection";
import { runtimeIdentityProtection } from "../../../../../../lib/auth/identity-runtime";
import { apiError, badRequest, forbidden, jsonResponse, notFound } from "../../../../../../lib/document-builder/auth/responses";
import { getDocumentAccess, hasDocumentPermission, loadStoredDocument } from "../../../../../../lib/document-builder/permissions";
import type { ParticipantRole } from "../../../../../../lib/document-builder/registry";
import { addActivity, addNotification, isoNow } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { requireR2 } from "../../../../../../lib/document-builder/storage/runtime";
import {
  applyProjectedDocumentContentVersion,
  createDocumentVersion,
} from "../../../../../../lib/document-builder/document-versions";
import { addDays, randomToken, sha256 } from "../../../../../../lib/document-builder/share-links/crypto";
import { resolvedDocument } from "../../../../../../lib/document-builder/registry/published";
import { workspaceEntitlements } from "../../../../../../lib/billing/entitlements";
import { ACCEPTED_COLLABORATOR_JOIN_SQL } from "../../../../../../lib/document-builder/permissions/collaboration-policy";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

async function canEditSharedDraft(access: NonNullable<Awaited<ReturnType<typeof getDocumentAccess>>>) {
  const { document, workspaceId } = access;
  if (access.participantRole !== "editor" || !hasDocumentPermission(access, "edit_all_fields")
    || !workspaceId || document.status === "Архив" || document.status === "Подписан" || document.signedFileId) return false;
  if (document.templateCode) {
    const definition = await resolvedDocument(document.templateCode, document.templateVersion ?? undefined);
    if (definition && (!definition.collaboration.enabled || !definition.collaboration.allowDirectEditing)) return false;
  }
  return !(await workspaceEntitlements(requireD1(), workspaceId)).readOnly;
}

async function snapshot(documentId: string): Promise<Record<string, unknown>> {
  const db = requireD1();
  const identityContext = runtimeIdentityProtection();
  const [collaborators, comments, proposals, activity] = await Promise.all([
    db.prepare(
      `SELECT c.id, c.user_id AS userId, u.full_name AS fullName,
       ${userIdentitySelect("u")},
       c.status, c.role, c.party_number AS partyNumber, c.approval_status AS approvalStatus,
       c.confirmed_at AS confirmedAt, c.opened_at AS openedAt,
       c.can_view AS canView, c.can_download AS canDownload,
       COALESCE(sa.view_allowed, 0) AS signedViewAllowed,
       COALESCE(sa.download_allowed, 0) AS signedDownloadAllowed,
       COALESCE(sa.opened, 0) AS signedOpened,
       COALESCE(sa.restored_view_only, 0) AS restoredViewOnly
       FROM document_collaborators c JOIN user_profiles u ON u.id = c.user_id
       LEFT JOIN signed_document_access sa ON sa.document_id = c.document_id AND sa.collaborator_user_id = c.user_id
       WHERE c.document_id = ? AND c.status <> 'revoked' ORDER BY c.created_at`,
    ).bind(documentId).all(),
    db.prepare(
      `SELECT c.id, c.author_user_id AS authorUserId,
       u.full_name AS authorFullName,${userIdentitySelect("u")},
       c.body, c.anchor, c.thread_id AS threadId, c.parent_comment_id AS parentCommentId,
       t.status AS threadStatus, t.anchor_type AS anchorType, t.anchor_key AS anchorKey, c.created_at AS createdAt
       FROM document_comments c JOIN user_profiles u ON u.id = c.author_user_id
       LEFT JOIN document_comment_threads t ON t.id = c.thread_id
       WHERE c.document_id = ? ORDER BY c.created_at`,
    ).bind(documentId).all(),
    db.prepare(
      `SELECT id, author_user_id AS authorUserId, old_text AS oldText, new_text AS newText, anchor,
       owner_accepted AS ownerAccepted, collaborator_accepted AS collaboratorAccepted, status, created_at AS createdAt
       FROM document_change_proposals WHERE document_id = ? ORDER BY created_at DESC`,
    ).bind(documentId).all(),
    db.prepare("SELECT id, type, created_at AS createdAt FROM activity_events WHERE document_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(documentId).all(),
  ]);
  const resolvedCollaborators = await Promise.all(
    (collaborators.results as Array<UserIdentityRow & {
      userId: string;
      fullName: string | null;
      status: string;
      role: string | null;
      partyNumber: number | null;
      approvalStatus: string | null;
      confirmedAt: string | null;
      openedAt: string | null;
      canView: number;
      canDownload: number;
      signedViewAllowed: number;
      signedDownloadAllowed: number;
      signedOpened: number;
      restoredViewOnly: number;
    }>).map(async item => {
      const identity = await resolveUserIdentity(
        identityContext,
        { ...item, id: item.userId },
      );
      return {
        id: item.id,
        userId: item.userId,
        email: identity.email,
        displayName: item.fullName || identity.email,
        status: item.status,
        role: item.role,
        partyNumber: item.partyNumber,
        approvalStatus: item.approvalStatus,
        confirmedAt: item.confirmedAt,
        openedAt: item.openedAt,
        canView: Boolean(item.canView),
        canDownload: Boolean(item.canDownload),
        signedViewAllowed: Boolean(item.signedViewAllowed),
        signedDownloadAllowed: Boolean(item.signedDownloadAllowed),
        signedOpened: Boolean(item.signedOpened),
        restoredViewOnly: Boolean(item.restoredViewOnly),
      };
    }),
  );
  const resolvedComments = await Promise.all(
    (comments.results as Array<UserIdentityRow & {
      authorUserId: string;
      authorFullName: string | null;
      body: string;
      anchor: string | null;
      threadId: string | null;
      parentCommentId: string | null;
      threadStatus: string | null;
      anchorType: string | null;
      anchorKey: string | null;
      createdAt: string;
    }>).map(async item => {
      const identity = await resolveUserIdentity(
        identityContext,
        { ...item, id: item.authorUserId },
      );
      return {
        id: item.id,
        authorUserId: item.authorUserId,
        authorName: item.authorFullName || identity.email,
        body: item.body,
        anchor: item.anchor,
        threadId: item.threadId,
        parentCommentId: item.parentCommentId,
        threadStatus: item.threadStatus,
        anchorType: item.anchorType,
        anchorKey: item.anchorKey,
        createdAt: item.createdAt,
      };
    }),
  );
  return {
    collaborators: resolvedCollaborators,
    comments: resolvedComments,
    proposals: proposals.results.map((item) => ({ ...item, ownerAccepted: Boolean(item.ownerAccepted), collaboratorAccepted: Boolean(item.collaboratorAccepted) })),
    activity: activity.results,
  };
}

export async function GET(_request: Request, context: Context): Promise<Response> {
  try {
    const user = await requireApiUser();
    const { id } = await context.params;
    const access = await getDocumentAccess(id, user.id);
    if (!access?.canView) return forbidden();
    const [details, canEditDraft] = await Promise.all([snapshot(id), canEditSharedDraft(access)]);
    return jsonResponse({ ...details, permissions: access.permissions, canEditDraft, viewerId: user.id, revision: access.document.revision });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    assertSafeWrite(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const access = await getDocumentAccess(id, user.id);
    if (!access?.canView) return forbidden();
    const document = await loadStoredDocument(id, user.id);
    if (!document) return notFound();
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "";
    const db = requireD1();
    const now = isoNow();

    if (action === "edit_draft") {
      if (!(await canEditSharedDraft(access))) return forbidden();
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim() || text.length > 500_000 || typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision < 1) {
        return badRequest("Введите текст документа и укажите его версию.");
      }
      const [updated] = await db.batch([
        db.prepare(`UPDATE documents SET revision=revision+1, updated_at=?,
          status=CASE WHEN status='Согласован' THEN 'Готов' ELSE status END
          WHERE id=? AND revision=? AND status NOT IN ('Архив','Подписан') AND signed_file_id IS NULL
          AND EXISTS (SELECT 1 FROM document_collaborators c WHERE c.document_id=documents.id AND c.user_id=?
            AND c.role='editor' AND ${ACCEPTED_COLLABORATOR_JOIN_SQL})`)
          .bind(now, id, body.revision, user.id),
        db.prepare(`UPDATE document_current_content SET final_content=?, manually_edited=1, updated_at=?
          WHERE document_id=? AND changes()=1`).bind(text, now, id),
        db.prepare(`INSERT INTO document_revisions (id,document_id,revision,actor_user_id,source,changes_json,created_at)
          SELECT ?,?,CAST(? AS bigint),?,'collaborator_edit','{}',? WHERE changes()=1`).bind(crypto.randomUUID(), id, body.revision + 1, user.id, now),
      ]);
      if (!updated.meta.changes) return jsonResponse({ error: "Документ был изменён. Загрузите последнюю версию.", code: "REVISION_CONFLICT" }, { status: 409 });
      return jsonResponse({ applied: true });
    }

    if (action === "invite") {
      if (!hasDocumentPermission(access, "invite_participant")) return forbidden();
      const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
      if (!identifier) return badRequest("Введите email или номер телефона.");
      const allowedRoles = new Set<ParticipantRole>(["party", "counterparty", "co-party", "representative", "editor", "commenter", "viewer", "legal-reviewer", "approver"]);
      const requestedRole = typeof body.role === "string" && allowedRoles.has(body.role as ParticipantRole) ? body.role as ParticipantRole : "counterparty";
      const partyNumber = typeof body.partyNumber === "number" && Number.isInteger(body.partyNumber) && body.partyNumber >= 2 && body.partyNumber <= 3 ? body.partyNumber : 2;
      const identityContext = runtimeIdentityProtection();
      const candidateIds = await userIdsByIdentifier(
        db,
        identityContext,
        identifier,
      );
      if (candidateIds.length > 1) return badRequest("Найдено несколько профилей. Уточните email.");
      const candidate = candidateIds[0]
        ? await db.prepare(
          `SELECT id,full_name AS fullName,${userIdentitySelect("user_profiles")}
           FROM user_profiles WHERE id=? LIMIT 1`,
        ).bind(candidateIds[0]).first<UserIdentityRow & {
          fullName: string | null;
        }>()
        : null;
      const candidateIdentity = candidate
        ? await resolveUserIdentity(identityContext, candidate)
        : null;
      const invitee = candidate && candidateIdentity ? {
        id: candidate.id,
        email: candidateIdentity.email,
        displayName: candidate.fullName || candidateIdentity.email,
      } : null;
      if (invitee?.id === user.id) return badRequest("Нельзя пригласить самого себя.");
      if (invitee) {
        const accepted = await db.prepare(
          `SELECT id
           FROM document_collaborators
           WHERE document_id = ?
             AND user_id = ?
             AND invitation_status = 'accepted'
             AND can_view = 1
             AND status IN ('active', 'opened', 'confirmed')
           LIMIT 1`,
        ).bind(id, invitee.id).first<{ id: string }>();
        if (accepted) {
          return jsonResponse(
            {
              error: "Этот пользователь уже имеет доступ к документу.",
              code: "ALREADY_COLLABORATOR",
            },
            { status: 409 },
          );
        }
      }
      const pendingCount = await db.prepare("SELECT COUNT(*) AS count FROM document_invitations WHERE document_id = ? AND revoked_at IS NULL AND declined_at IS NULL AND accepted_at IS NULL AND expires_at > ?").bind(id, now).first<{ count: number }>();
      const activeCount = await db.prepare("SELECT COUNT(*) AS count FROM document_collaborators WHERE document_id = ? AND invitation_status = 'accepted' AND status IN ('active', 'opened', 'confirmed')").bind(id).first<{ count: number }>();
      if ((pendingCount?.count ?? 0) + (activeCount?.count ?? 0) >= 2) return badRequest("Для этого документа уже добавлено максимально допустимое число участников.", "PARTICIPANT_LIMIT");
      const token = randomToken();
      const legacyNormalizedIdentifier = identifier.toLocaleLowerCase();
      const identifierKind = identifier.includes("@") ? "email" : "phone";
      const normalizedEvidenceIdentifier = identifierKind === "email"
        ? normalizeEmail(identifier)
        : normalizePhoneForLookup(identifier);
      const identityEvidence = await prepareKeyedIdentityEvidence(
        identityContext,
        {
          normalizedValue: normalizedEvidenceIdentifier,
          purpose: identifierKind === "email"
            ? "document-invitation-email"
            : "document-invitation-phone",
        },
      );
      const invitationId = crypto.randomUUID();
      const expiresAt = addDays(now, 7);
      await db.prepare(
        `INSERT INTO document_invitations (
           id,document_id,invited_by_user_id,target_user_id,
           target_identifier_hash,target_identifier_kind,
           target_identifier_lookup_hash,
           target_identifier_lookup_key_version,
           role,party_number,token_hash,expires_at,
           accepted_at,declined_at,revoked_at,created_at,updated_at
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,NULL,?,?)`,
      ).bind(
        invitationId,
        id,
        user.id,
        invitee?.id ?? null,
        await sha256(legacyNormalizedIdentifier),
        identityEvidence.lookupHash ? identifierKind : null,
        identityEvidence.lookupHash,
        identityEvidence.lookupKeyVersion,
        requestedRole,
        partyNumber,
        await sha256(token),
        expiresAt,
        now,
        now,
      ).run();
      if (invitee) {
        const existing = await db.prepare("SELECT id FROM document_collaborators WHERE document_id = ? AND user_id = ? LIMIT 1").bind(id, invitee.id).first<{ id: string }>();
        if (existing) {
          const staged = await db.prepare("UPDATE document_collaborators SET invited_by_user_id = ?, role = ?, party_number = ?, permission_set_json = NULL, invitation_status = 'invited', approval_status = 'pending', can_view = 0, can_download = 0, status = 'invited', opened_at = NULL, confirmed_at = NULL, joined_at = NULL, revoked_at = NULL, updated_at = ? WHERE id = ? AND NOT (invitation_status = 'accepted' AND can_view = 1 AND status IN ('active', 'opened', 'confirmed'))")
            .bind(user.id, requestedRole, partyNumber, now, existing.id).run();
          if (!staged.meta.changes) {
            await db.prepare("UPDATE document_invitations SET revoked_at = ?, updated_at = ? WHERE id = ? AND accepted_at IS NULL")
              .bind(now, now, invitationId).run();
            return jsonResponse(
              {
                error: "Этот пользователь уже имеет доступ к документу.",
                code: "ALREADY_COLLABORATOR",
              },
              { status: 409 },
            );
          }
        } else {
          await db.prepare(
            "INSERT INTO document_collaborators (id, document_id, user_id, invited_by_user_id, role, party_number, permission_set_json, invitation_status, approval_status, can_view, can_download, status, opened_at, confirmed_at, joined_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, NULL, 'invited', 'pending', 0, 0, 'invited', NULL, NULL, NULL, NULL, ?, ?)",
          ).bind(crypto.randomUUID(), id, invitee.id, user.id, requestedRole, partyNumber, now, now).run();
        }
        await addNotification(invitee.id, id, "invitation", "Приглашение к документу", `${user.fullName || user.email} приглашает вас проверить документ «${document.title}».`);
      }
      await addActivity(id, user.id, "invitation_sent", { role: requestedRole, partyNumber });
      return jsonResponse({ invited: true, user: invitee, invitation: { path: `/document-builder/invitations/${token}`, expiresAt }, snapshot: await snapshot(id) });
    }

    if (action === "comment") {
      if (!hasDocumentPermission(access, "add_comment")) return forbidden();
      const text = typeof body.body === "string" ? body.body.trim() : "";
      if (!text || text.length > 10_000) return badRequest("Введите комментарий до 10 000 символов.");
      const requestedThreadId = typeof body.threadId === "string" ? body.threadId : null;
      const thread = requestedThreadId ? await db.prepare("SELECT id FROM document_comment_threads WHERE id = ? AND document_id = ? LIMIT 1").bind(requestedThreadId, id).first<{ id: string }>() : null;
      const threadId = thread?.id ?? crypto.randomUUID();
      if (!thread) {
        const anchor = typeof body.anchor === "string" ? body.anchor : null;
        const anchorType = typeof body.anchorType === "string" && ["document", "section", "clause", "field"].includes(body.anchorType) ? body.anchorType : "document";
        await db.prepare("INSERT INTO document_comment_threads (id, document_id, anchor_type, anchor_key, created_by_user_id, status, resolved_by_user_id, resolved_at, reopened_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', NULL, NULL, NULL, ?, ?)")
          .bind(threadId, id, anchorType, anchor, user.id, now, now).run();
      }
      const parentCommentId = typeof body.parentCommentId === "string" ? body.parentCommentId : null;
      if (parentCommentId) {
        const parent = await db.prepare("SELECT id FROM document_comments WHERE id = ? AND document_id = ? AND thread_id = ? LIMIT 1").bind(parentCommentId, id, threadId).first<{ id: string }>();
        if (!parent) return badRequest("Исходный комментарий для ответа не найден.");
      }
      await db.prepare("INSERT INTO document_comments (id, document_id, author_user_id, thread_id, parent_comment_id, body, anchor, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)")
        .bind(crypto.randomUUID(), id, user.id, threadId, parentCommentId, text, typeof body.anchor === "string" ? body.anchor : null, now, now).run();
      if (access.role === "collaborator") {
        await addNotification(document.ownerUserId, id, "comment_added", "Добавлен комментарий", `${user.fullName || user.email} оставил(а) комментарий к документу.`);
      } else {
        const collaborators = await db.prepare("SELECT user_id AS userId FROM document_collaborators WHERE document_id = ? AND invitation_status = 'accepted' AND status IN ('active', 'opened', 'confirmed')").bind(id).all<{ userId: string }>();
        await Promise.all(collaborators.results.map((item) => addNotification(item.userId, id, "comment_added", "Добавлен комментарий", "Создатель документа оставил комментарий.")));
      }
      return jsonResponse({ created: true, snapshot: await snapshot(id) }, { status: 201 });
    }

    if (action === "resolve_comment" || action === "reopen_comment") {
      if (!hasDocumentPermission(access, "resolve_comment")) return forbidden();
      const threadId = typeof body.threadId === "string" ? body.threadId : "";
      if (!threadId) return badRequest("Не указана цепочка комментариев.");
      const nextStatus = action === "resolve_comment" ? "resolved" : "open";
      const result = await db.prepare(
        "UPDATE document_comment_threads SET status = ?, resolved_by_user_id = ?, resolved_at = ?, reopened_at = ?, updated_at = ? WHERE id = ? AND document_id = ?",
      ).bind(nextStatus, nextStatus === "resolved" ? user.id : null, nextStatus === "resolved" ? now : null, nextStatus === "open" ? now : null, now, threadId, id).run();
      if (!result.meta.changes) return notFound("Цепочка комментариев не найдена.");
      await addActivity(id, user.id, nextStatus === "resolved" ? "comment_resolved" : "comment_reopened");
      return jsonResponse({ updated: true, snapshot: await snapshot(id) });
    }

    if (action === "proposal") {
      if (!hasDocumentPermission(access, "create_suggestion")) return forbidden();
      const oldText = typeof body.oldText === "string" ? body.oldText.trim() : "";
      const newText = typeof body.newText === "string" ? body.newText.trim() : "";
      if (!oldText || !newText || oldText === newText) return badRequest("Укажите различающиеся исходный и предложенный тексты.");
      const match = document.finalContent.indexOf(oldText);
      if (match === -1 || match !== document.finalContent.lastIndexOf(oldText)) {
        return badRequest("Укажите фрагмент, который встречается в актуальном документе ровно один раз.", "STALE_PROPOSAL");
      }
      const proposalId = crypto.randomUUID();
      await db.prepare(
        "INSERT INTO document_change_proposals (id, document_id, author_user_id, old_text, new_text, anchor, owner_accepted, collaborator_accepted, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
      ).bind(proposalId, id, user.id, oldText, newText, typeof body.anchor === "string" ? body.anchor : null, access.role === "owner" ? 1 : 0, access.role === "collaborator" ? 1 : 0, now, now).run();
      if (access.role === "collaborator") await addNotification(document.ownerUserId, id, "change_proposed", "Предложено изменение", `${user.fullName || user.email} предложил(а) изменение документа.`);
      else {
        const collaborators = await db.prepare("SELECT user_id AS userId FROM document_collaborators WHERE document_id = ? AND invitation_status = 'accepted' AND status IN ('active', 'opened', 'confirmed')").bind(id).all<{ userId: string }>();
        await Promise.all(collaborators.results.map((item) => addNotification(item.userId, id, "change_proposed", "Предложено изменение", "Создатель предложил изменение документа.")));
      }
      await addActivity(id, user.id, "change_proposed");
      return jsonResponse({ created: true, proposalId, snapshot: await snapshot(id) }, { status: 201 });
    }

    if (action === "accept_proposal") {
      if (!hasDocumentPermission(access, "accept_suggestion")) return forbidden();
      if (document.status === "Архив" || document.status === "Подписан" || document.signedFileId) return forbidden();
      const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
      const proposal = await db.prepare(
        "SELECT id, old_text AS oldText, new_text AS newText, owner_accepted AS ownerAccepted, collaborator_accepted AS collaboratorAccepted, status FROM document_change_proposals WHERE id = ? AND document_id = ? LIMIT 1",
      ).bind(proposalId, id).first<{ id: string; oldText: string; newText: string; ownerAccepted: number; collaboratorAccepted: number; status: string }>();
      if (!proposal || proposal.status !== "pending") return notFound("Предложение недоступно.");
      const ownerAccepted = access.role === "owner" ? true : Boolean(proposal.ownerAccepted);
      const collaboratorAccepted = access.role === "collaborator" ? true : Boolean(proposal.collaboratorAccepted);
      if (ownerAccepted && collaboratorAccepted) {
        if (!access.workspaceId) return forbidden();
        const current = await db.prepare("SELECT final_content AS finalContent FROM document_current_content WHERE document_id = ?").bind(id).first<{ finalContent: string }>();
        const match = current?.finalContent.indexOf(proposal.oldText) ?? -1;
        if (!current || match === -1 || match !== current.finalContent.lastIndexOf(proposal.oldText)) {
          return jsonResponse({ error: "Документ уже изменён; предложение устарело.", code: "STALE_PROPOSAL" }, { status: 409 });
        }
        const nextText = current.finalContent.replace(proposal.oldText, () => proposal.newText);
        await applyProjectedDocumentContentVersion({
          db,
          bucket: requireR2(),
          documentId: id,
          workspaceId: access.workspaceId,
          ownerUserId: document.ownerUserId,
          actorUserId: user.id,
          revision: document.revision,
          source: "suggestion",
          sourceEntityId: proposal.id,
          idempotencyKey: `builder-proposal-apply-${proposal.id}`,
          finalContent: nextText,
          nextStatus: document.status === "Согласован" ? "Готов" : document.status,
          revisionSource: "suggestion",
          changes: { proposalId, anchor: proposal.id, oldText: proposal.oldText, newText: proposal.newText },
          mutationStatements: (appliedAt) => [
            db.prepare(
              `UPDATE document_change_proposals
               SET owner_accepted=1,collaborator_accepted=1,status='applied',updated_at=?
               WHERE id=? AND document_id=? AND status='pending'`,
            ).bind(appliedAt, proposalId, id),
          ],
        });
        await addActivity(id, user.id, "change_agreed");
      } else {
        await db.prepare("UPDATE document_change_proposals SET owner_accepted = ?, collaborator_accepted = ?, updated_at = ? WHERE id = ?")
          .bind(ownerAccepted ? 1 : 0, collaboratorAccepted ? 1 : 0, now, proposalId).run();
      }
      const notifyUserIds = access.role === "owner"
        ? (await db.prepare("SELECT user_id AS userId FROM document_collaborators WHERE document_id = ? AND invitation_status = 'accepted' AND status IN ('active', 'opened', 'confirmed')").bind(id).all<{ userId: string }>()).results.map((item) => item.userId)
        : [document.ownerUserId];
      await Promise.all(notifyUserIds.map((userId) => addNotification(userId, id, "change_confirmed", "Изменение подтверждено", ownerAccepted && collaboratorAccepted ? "Изменение согласовано обеими сторонами и применено." : "Одна из сторон подтвердила предложенное изменение.")));
      return jsonResponse({ accepted: true, applied: ownerAccepted && collaboratorAccepted, snapshot: await snapshot(id) });
    }

    if (action === "reject_proposal") {
      if (!hasDocumentPermission(access, "reject_suggestion")) return forbidden();
      const proposalId = typeof body.proposalId === "string" ? body.proposalId : "";
      await db.prepare("UPDATE document_change_proposals SET status = 'rejected', updated_at = ? WHERE id = ? AND document_id = ? AND status = 'pending'")
        .bind(now, proposalId, id).run();
      if (access.role === "collaborator") await addNotification(document.ownerUserId, id, "agreement_rejected", "Изменение отклонено", `${user.fullName || user.email} отклонил(а) предложенное изменение.`);
      return jsonResponse({ rejected: true, snapshot: await snapshot(id) });
    }

    if (action === "confirm_data") {
      if (access.role !== "collaborator" || !hasDocumentPermission(access, "approve_document")) return forbidden();
      if (!access.workspaceId) return forbidden();
      await createDocumentVersion({
        db, bucket: requireR2(), documentId: id, workspaceId: access.workspaceId,
        ownerUserId: document.ownerUserId, revision: document.revision, source: "approval",
        idempotencyKey: `builder-auto-collaborator-approval-${id}-${document.revision}-${user.id}`,
      });
      await db.batch([
        db.prepare("UPDATE document_collaborators SET confirmed_at = ?, approval_status = 'approved', status = 'confirmed', joined_at = COALESCE(joined_at, ?), updated_at = ? WHERE document_id = ? AND user_id = ?")
          .bind(now, now, now, id, user.id),
        db.prepare("INSERT INTO document_approvals (id, document_id, participant_user_id, status, revision, approved_at, revoked_at, created_at, updated_at) VALUES (?, ?, ?, 'approved', ?, ?, NULL, ?, ?) ON CONFLICT(document_id, participant_user_id, revision) DO UPDATE SET status = 'approved', approved_at = excluded.approved_at, revoked_at = NULL, updated_at = excluded.updated_at")
          .bind(crypto.randomUUID(), id, user.id, document.revision, now, now, now),
      ]);
      await addNotification(document.ownerUserId, id, "agreement_completed", "Данные подтверждены", `${user.fullName || user.email} подтвердил(а) данные документа.`);
      return jsonResponse({ confirmed: true, snapshot: await snapshot(id) });
    }

    if (action === "signed_access") {
      if (!hasDocumentPermission(access, "invite_participant") || !document.signedFileId) return forbidden();
      const collaboratorUserId = typeof body.collaboratorUserId === "string" ? body.collaboratorUserId : "";
      const collaborator = await db.prepare("SELECT user_id AS userId FROM document_collaborators WHERE document_id = ? AND user_id = ? AND invitation_status = 'accepted' AND status IN ('active', 'opened', 'confirmed') LIMIT 1")
        .bind(id, collaboratorUserId).first<{ userId: string }>();
      if (!collaborator) return notFound("Участник не найден.");
      const existing = await db.prepare("SELECT id, restored_view_only AS restoredViewOnly FROM signed_document_access WHERE document_id = ? AND collaborator_user_id = ? LIMIT 1")
        .bind(id, collaboratorUserId).first<{ id: string; restoredViewOnly: number }>();
      const viewAllowed = Boolean(body.viewAllowed);
      const downloadAllowed = Boolean(body.downloadAllowed);
      if (existing?.restoredViewOnly && downloadAllowed) return badRequest("После восстановления из архива скачивание подписанной версии нельзя разрешить повторно.", "DOWNLOAD_LOCKED_AFTER_RESTORE");
      if (existing) {
        await db.prepare("UPDATE signed_document_access SET view_allowed = ?, download_allowed = ?, updated_at = ? WHERE id = ?")
          .bind(viewAllowed ? 1 : 0, viewAllowed && downloadAllowed ? 1 : 0, now, existing.id).run();
      } else {
        await db.prepare("INSERT INTO signed_document_access (id, document_id, collaborator_user_id, view_allowed, download_allowed, opened, restored_view_only, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)")
          .bind(crypto.randomUUID(), id, collaboratorUserId, viewAllowed ? 1 : 0, viewAllowed && downloadAllowed ? 1 : 0, now, now).run();
      }
      return jsonResponse({ updated: true, viewAllowed, downloadAllowed: viewAllowed && downloadAllowed });
    }

    if (action === "revoke_collaborator") {
      if (!hasDocumentPermission(access, "revoke_participant")) return forbidden();
      const collaboratorUserId = typeof body.collaboratorUserId === "string" ? body.collaboratorUserId : "";
      await db.batch([
        db.prepare("UPDATE document_collaborators SET status = 'revoked', invitation_status = 'revoked', approval_status = 'revoked', revoked_at = ?, can_view = 0, can_download = 0, updated_at = ? WHERE document_id = ? AND user_id = ?").bind(now, now, id, collaboratorUserId),
        db.prepare("UPDATE signed_document_access SET view_allowed = 0, download_allowed = 0, updated_at = ? WHERE document_id = ? AND collaborator_user_id = ?").bind(now, id, collaboratorUserId),
      ]);
      await addActivity(id, user.id, "access_revoked");
      return jsonResponse({ revoked: true, snapshot: await snapshot(id) });
    }

    return badRequest("Неизвестное действие совместной работы.");
  } catch (error) {
    return apiError(error);
  }
}
