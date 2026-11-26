import { parseJsonRequest } from "../../../../../../lib/auth/input";
import {
  assertSafeWrite,
  requireApiUser,
  withApiErrors,
} from "../../../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../../../lib/document-builder/storage/db";
import { requireD1 } from "../../../../../../lib/document-builder/storage/runtime";
import { lawyerText } from "../../../../../../lib/platform/lawyer-localization";
import {
  lawyerRequestMessageError,
  lawyerRequestMessageSchema,
} from "../../../../../../lib/platform/lawyer-request-message";
import type { PlatformLocale } from "../../../../../../lib/platform/routing";
import { requireSelectedWorkspace } from "../../../../../../lib/platform/workspace";

type Context = { params: Promise<{ requestId: string }> };
type Participant = {
  workspaceId: string;
  caseId: string;
  clientUserId: string;
  lawyerUserId: string;
  clientLocale: PlatformLocale;
  lawyerLocale: PlatformLocale;
  intakeOnly: boolean;
  role: "client" | "lawyer";
};

function response(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "private, no-store", pragma: "no-cache" },
  });
}

async function participantForRequest(
  userId: string,
  ownWorkspaceId: string,
  requestId: string,
): Promise<Participant | null> {
  const db = requireD1();
  const client = await db.prepare(
    `SELECT r.workspace_id AS workspaceId,r.case_id AS caseId,
      r.requester_user_id AS clientUserId,p.user_id AS lawyerUserId,
      CASE client.locale WHEN 'uz' THEN 'uz' WHEN 'en' THEN 'en' ELSE 'ru' END AS clientLocale,
      CASE lawyer.locale WHEN 'uz' THEN 'uz' WHEN 'en' THEN 'en' ELSE 'ru' END AS lawyerLocale,
      json_extract(r.requested_scope_json,'$.paidTransfer')='required' AS intakeOnly
     FROM lawyer_requests r JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id
     JOIN user_profiles client ON client.id=r.requester_user_id
     JOIN user_profiles lawyer ON lawyer.id=p.user_id
     WHERE r.id=? AND r.workspace_id=? AND r.requester_user_id=? AND case_visible_to(r.case_id,?)
       AND (json_extract(r.requested_scope_json,'$.paidTransfer') IS DISTINCT FROM 'required' OR r.status='awaiting_user_consent') LIMIT 1`,
  ).bind(requestId, ownWorkspaceId, userId, userId).first<Omit<Participant, "role">>();
  if (client) return { ...client, role: "client" };
  const lawyer = await db.prepare(
    `SELECT r.workspace_id AS workspaceId,r.case_id AS caseId,
      r.requester_user_id AS clientUserId,p.user_id AS lawyerUserId,
      CASE client.locale WHEN 'uz' THEN 'uz' WHEN 'en' THEN 'en' ELSE 'ru' END AS clientLocale,
      CASE lawyer.locale WHEN 'uz' THEN 'uz' WHEN 'en' THEN 'en' ELSE 'ru' END AS lawyerLocale,
      g.id IS NULL AS intakeOnly
     FROM lawyer_requests r
     JOIN lawyer_profiles p ON p.id=r.lawyer_profile_id AND p.user_id=?
     JOIN user_profiles client ON client.id=r.requester_user_id
     JOIN user_profiles lawyer ON lawyer.id=p.user_id
       AND p.status='public_approved' AND p.marketplace_status='public_approved'
     LEFT JOIN lawyer_access_grants g ON g.lawyer_request_id=r.id AND g.case_id=r.case_id
       AND g.lawyer_user_id=? AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at>?)
     WHERE r.id=? AND (g.id IS NOT NULL OR (
       r.status='awaiting_user_consent' AND json_extract(r.requested_scope_json,'$.paidTransfer')='required'
       AND case_visible_to(r.case_id,r.requester_user_id)
     )) LIMIT 1`,
  ).bind(userId, userId, new Date().toISOString(), requestId)
    .first<Omit<Participant, "role">>();
  return lawyer ? { ...lawyer, role: "lawyer" } : null;
}

export const GET = withApiErrors(async function GET(
  request: Request,
  context: Context,
) {
  const user = await requireApiUser();
  const ownWorkspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const { requestId } = await context.params;
  const participant = await participantForRequest(
    user.id,
    ownWorkspace.id,
    requestId,
  );
  if (!participant) {
    return response({ code: "REQUEST_UNAVAILABLE" }, 404);
  }
  const db = requireD1();
  const [messages, unread, documents] = await Promise.all([
    db.prepare(
      `SELECT m.id,m.author_role AS authorRole,m.body,m.read_at AS readAt,
        m.created_at AS createdAt,a.document_id AS documentId,
        d.title AS documentTitle,d.status AS documentStatus,
        a.status AS attachmentStatus
       FROM lawyer_request_messages m
       LEFT JOIN lawyer_request_message_attachments a ON a.message_id=m.id
       LEFT JOIN documents d ON d.id=a.document_id
       WHERE m.lawyer_request_id=? ORDER BY m.created_at ASC,m.id ASC LIMIT 200`,
    ).bind(requestId).all(),
    db.prepare(
      `SELECT count(*) AS count FROM lawyer_request_messages
       WHERE lawyer_request_id=? AND author_user_id<>? AND read_at IS NULL`,
    ).bind(requestId, user.id).first<{ count: number }>(),
    participant.intakeOnly ? { results: [] }
      : participant.role === "client"
      ? db.prepare(
        `SELECT id,title,status,updated_at AS updatedAt FROM documents
         WHERE owner_user_id=? AND workspace_id=? AND case_id=? AND archived_at IS NULL
         ORDER BY updated_at DESC LIMIT 100`,
      ).bind(user.id, participant.workspaceId, participant.caseId).all()
      : db.prepare(
        `SELECT id,title,status,updated_at AS updatedAt FROM documents
         WHERE owner_user_id=? AND workspace_id=? AND archived_at IS NULL
         ORDER BY updated_at DESC LIMIT 100`,
      ).bind(user.id, ownWorkspace.id).all(),
  ]);
  return response({
    messages: messages.results,
    unreadCount: Number(unread?.count ?? 0),
    documents: documents.results,
    role: participant.role,
    intakeOnly: participant.intakeOnly,
  });
});

export const POST = withApiErrors(async function POST(
  request: Request,
  context: Context,
) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const ownWorkspace = await requireSelectedWorkspace(user, request.headers.get("x-juro-workspace-id"));
  const { requestId } = await context.params;
  const parsed = await parseJsonRequest(request, lawyerRequestMessageSchema, 8_192);
  const locale = parsed.ok ? parsed.data.locale : "ru";
  if (!parsed.ok) {
    return response({
      code: "INVALID_INPUT",
      error: lawyerRequestMessageError(locale, "INVALID_INPUT"),
    }, parsed.error === "payload_too_large" ? 413 : 400);
  }
  const participant = await participantForRequest(
    user.id,
    ownWorkspace.id,
    requestId,
  );
  if (!participant) {
    return response({
      code: "REQUEST_UNAVAILABLE",
      error: lawyerRequestMessageError(locale, "REQUEST_UNAVAILABLE"),
    }, 404);
  }
  const db = requireD1();
  const now = isoNow();
  if (participant.intakeOnly && parsed.data.action !== "mark_read" && parsed.data.documentId) {
    return response({ code: "DOCUMENT_UNAVAILABLE", error: lawyerRequestMessageError(locale, "DOCUMENT_UNAVAILABLE") }, 403);
  }

  if (parsed.data.action === "mark_read") {
    const results = await db.batch([
      db.prepare(
        `UPDATE lawyer_request_messages SET read_at=?
         WHERE lawyer_request_id=? AND author_user_id<>? AND read_at IS NULL`,
      ).bind(now, requestId, user.id),
      db.prepare(
        `UPDATE lawyer_request_message_attachments SET status='viewed',updated_at=?
         WHERE lawyer_request_id=? AND recipient_user_id=? AND status='sent'`,
      ).bind(now, requestId, user.id),
    ]);
    const changed = results.reduce(
      (sum, result) => sum + Number(result.meta?.changes ?? 0),
      0,
    );
    if (changed) {
      await db.prepare(
        `INSERT INTO workspace_audit_events
          (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
         VALUES (?,?,?,'lawyer_request',?,'lawyer_request_messages_read',?,?)`,
      ).bind(
        crypto.randomUUID(),
        participant.workspaceId,
        user.id,
        requestId,
        JSON.stringify({ changed }),
        now,
      ).run();
    }
    return response({ ok: true, unreadCount: 0, changed });
  }

  const document = parsed.data.documentId
    ? await (participant.role === "client"
      ? db.prepare(
        `SELECT id,title,status FROM documents
         WHERE id=? AND owner_user_id=? AND workspace_id=? AND case_id=?
           AND archived_at IS NULL LIMIT 1`,
      ).bind(
        parsed.data.documentId,
        user.id,
        participant.workspaceId,
        participant.caseId,
      )
      : db.prepare(
        `SELECT id,title,status FROM documents
         WHERE id=? AND owner_user_id=? AND workspace_id=?
           AND archived_at IS NULL LIMIT 1`,
      ).bind(parsed.data.documentId, user.id, ownWorkspace.id))
      .first<{ id: string; title: string; status: string }>()
    : null;
  if (parsed.data.documentId && !document) {
    return response({
      code: "DOCUMENT_UNAVAILABLE",
      error: lawyerRequestMessageError(locale, "DOCUMENT_UNAVAILABLE"),
    }, 404);
  }

  const id = crypto.randomUUID();
  const recipientUserId = participant.role === "client"
    ? participant.lawyerUserId
    : participant.clientUserId;
  const recipientLocale = participant.role === "client"
    ? participant.lawyerLocale
    : participant.clientLocale;
  const authorRole = participant.role === "client" ? "owner" : "lawyer";
  const attachmentId = document ? crypto.randomUUID() : null;
  await db.batch([
    db.prepare(
      `INSERT INTO lawyer_request_messages
        (id,lawyer_request_id,author_user_id,author_role,body,read_at,created_at)
       VALUES (?,?,?,?,?,NULL,?)`,
    ).bind(id, requestId, user.id, authorRole, parsed.data.body, now),
    ...(document && attachmentId ? [
      db.prepare(
        `INSERT INTO lawyer_request_message_attachments
          (id,message_id,lawyer_request_id,document_id,shared_by_user_id,recipient_user_id,status,created_at,updated_at)
         VALUES (?,?,?,?,?,?,'sent',?,?)`,
      ).bind(
        attachmentId,
        id,
        requestId,
        document.id,
        user.id,
        recipientUserId,
        now,
        now,
      ),
    ] : []),
    db.prepare(
      `INSERT INTO workspace_audit_events
        (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at)
       VALUES (?,?,?,'lawyer_request_message',?,'lawyer_request_message_sent',?,?)`,
    ).bind(
      crypto.randomUUID(),
      participant.workspaceId,
      user.id,
      id,
      JSON.stringify({ requestId, authorRole, documentId: document?.id ?? null }),
      now,
    ),
    db.prepare(
      `INSERT INTO case_events
        (id,case_id,actor_user_id,event_type,metadata_json,created_at)
       VALUES (?,?,?,'lawyer_request_message_sent',?,?)`,
    ).bind(
      crypto.randomUUID(),
      participant.caseId,
      user.id,
      JSON.stringify({ requestId, messageId: id, hasDocument: Boolean(document) }),
      now,
    ),
    db.prepare(
      `INSERT INTO notifications
        (id,workspace_id,user_id,document_id,type,title,body,read_at,created_at)
       VALUES (?,(SELECT default_workspace_id FROM user_profiles WHERE id=?),?,?,
         'lawyer_request_message_received',?,?,NULL,?)`,
    ).bind(
      crypto.randomUUID(),
      recipientUserId,
      recipientUserId,
      document?.id ?? null,
      lawyerText(recipientLocale, "Новое сообщение по делу", "Ish bo‘yicha yangi xabar", "New case message"),
      parsed.data.body || document?.title || "",
      now,
    ),
  ]);
  return response({
    ok: true,
    message: {
      id,
      authorRole,
      body: parsed.data.body,
      readAt: null,
      createdAt: now,
      documentId: document?.id ?? null,
      documentTitle: document?.title ?? null,
      documentStatus: document?.status ?? null,
      attachmentStatus: document ? "sent" : null,
    },
  }, 201);
});
