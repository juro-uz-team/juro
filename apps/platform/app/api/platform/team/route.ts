import { normalizeEmail, randomToken, sha256 } from "../../../../lib/auth/crypto";
import {
  prepareEncryptedIdentityEvidence,
  resolveEncryptedIdentityEvidence,
} from "../../../../lib/auth/identity-evidence";
import {
  resolveUserIdentity,
  userIdByEmail,
  userIdentitySelect,
  type UserIdentityRow,
} from "../../../../lib/auth/identity-protection";
import { runtimeIdentityProtection } from "../../../../lib/auth/identity-runtime";
import { assertSafeWrite, requireApiUser, withApiErrors } from "../../../../lib/document-builder/auth/api";
import { isoNow } from "../../../../lib/document-builder/storage/db";
import { requireD1, runtimeEnv } from "../../../../lib/document-builder/storage/runtime";
import { canManageTeam, isWorkspaceRole, requireTeamManager } from "../../../../lib/platform/permissions";
import { isLocale, type PlatformLocale } from "../../../../lib/platform/routing";
import { workspaceForUser } from "../../../../lib/platform/workspace";
import { sendEmailRequest } from "../../../../lib/runtime/email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITABLE_ROLES = new Set(["admin", "lawyer", "employee", "viewer", "external"]);

const invitationCopy: Record<PlatformLocale, {
  providerUnavailable: string;
  invalidEmail: string;
  invalidRole: string;
  alreadyMember: string;
  subject: string;
  title: string;
  intro: (email: string) => string;
  action: string;
  expiry: string;
  support: string;
  footer: string;
  sendFailed: string;
}> = {
  ru: {
    providerUnavailable: "Приглашение не отправлено: почтовый сервис временно недоступен.",
    invalidEmail: "Проверьте email участника.",
    invalidRole: "Выберите допустимую роль.",
    alreadyMember: "Этот пользователь уже состоит в команде.",
    subject: "Приглашение в пространство JURO",
    title: "Вас пригласили в JURO",
    intro: email => `Откройте защищённую ссылку, войдите с адресом ${email} и подтвердите участие.`,
    action: "Принять приглашение",
    expiry: "Ссылка действует 7 дней.",
    support: "Нужна помощь? Напишите в поддержку: admin@juro.uz",
    footer: "JURO — цифровая юридическая платформа. Ташкент, Республика Узбекистан.",
    sendFailed: "Приглашение не отправлено. Попробуйте позже.",
  },
  uz: {
    providerUnavailable: "Taklif yuborilmadi: pochta xizmati vaqtincha mavjud emas.",
    invalidEmail: "Ishtirokchi emailini tekshiring.",
    invalidRole: "Ruxsat etilgan rolni tanlang.",
    alreadyMember: "Bu foydalanuvchi allaqachon jamoada.",
    subject: "JURO makoniga taklif",
    title: "Siz JURO makoniga taklif qilindingiz",
    intro: email => `Himoyalangan havolani oching, ${email} manzili bilan kiring va ishtirokni tasdiqlang.`,
    action: "Taklifni qabul qilish",
    expiry: "Havola 7 kun amal qiladi.",
    support: "Yordam kerakmi? admin@juro.uz manziliga yozing",
    footer: "JURO — raqamli yuridik platforma. Toshkent, O‘zbekiston Respublikasi.",
    sendFailed: "Taklif yuborilmadi. Keyinroq urinib ko‘ring.",
  },
  en: {
    providerUnavailable: "The invitation could not be sent because the email service is temporarily unavailable.",
    invalidEmail: "Check the team member's email address.",
    invalidRole: "Select an available team role.",
    alreadyMember: "This user is already a member of the team.",
    subject: "Invitation to a JURO workspace",
    title: "You have been invited to JURO",
    intro: email => `Open the secure link, sign in with ${email}, and confirm that you want to join.`,
    action: "Accept invitation",
    expiry: "This link is valid for 7 days.",
    support: "Need help? Contact support at admin@juro.uz",
    footer: "JURO — a digital legal platform. Tashkent, Republic of Uzbekistan.",
    sendFailed: "The invitation could not be sent. Please try again later.",
  },
};

type WorkspaceInvitationRow = {
  id: string;
  workspaceId: string;
  email: string | null;
  emailCiphertext: string | null;
  emailIv: string | null;
  emailKeyVersion: string | null;
  emailLookupHash: string | null;
  emailLookupKeyVersion: string | null;
  role: string;
  expiresAt: string;
  createdAt: string;
};

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "private, no-store", pragma: "no-cache" } });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function renderInvitationEmail(locale: PlatformLocale, email: string, inviteUrl: string) {
  const copy = invitationCopy[locale];
  const intro = copy.intro(email);
  const safeUrl = escapeHtml(inviteUrl);
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(copy.subject)}</title></head><body style="margin:0;padding:0;background:#f8f6f2;color:#102333;font-family:Arial,'Helvetica Neue',sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f8f6f2"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid #e3ddd2;border-radius:18px;overflow:hidden"><tr><td style="padding:24px 32px;background:#062844"><span style="font-size:24px;line-height:1;font-weight:800;letter-spacing:3px;color:#ffffff">JURO</span></td></tr><tr><td style="padding:36px 32px 16px"><h1 style="margin:0;font-size:26px;line-height:1.25;color:#062844">${escapeHtml(copy.title)}</h1><p style="margin:16px 0 0;font-size:16px;line-height:1.6;color:#405568">${escapeHtml(intro)}</p></td></tr><tr><td style="padding:12px 32px 32px"><a href="${safeUrl}" style="display:inline-block;padding:14px 22px;border-radius:10px;background:#be974f;color:#062844;font-size:15px;font-weight:700;text-decoration:none">${escapeHtml(copy.action)}</a><p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#607182">${escapeHtml(copy.expiry)}</p></td></tr><tr><td style="padding:24px 32px;background:#edf1f3;border-top:1px solid #dce3e7"><p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#405568"><a href="mailto:admin@juro.uz" style="color:#062844">${escapeHtml(copy.support)}</a></p><p style="margin:0;font-size:12px;line-height:1.5;color:#6a7a87">${escapeHtml(copy.footer)}</p></td></tr></table></td></tr></table></body></html>`;
  const text = [copy.title, "", intro, "", `${copy.action}: ${inviteUrl}`, copy.expiry, "", copy.support, copy.footer].join("\n");
  return { subject: copy.subject, html, text };
}

export const GET = withApiErrors(async function GET() {
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  const db = requireD1();
  const [workspaceRow, members] = await db.batch([
    db.prepare("SELECT id,name,full_name AS fullName,short_name AS shortName,type,locale FROM workspaces WHERE id=? LIMIT 1").bind(workspace.id),
    db.prepare(
      `SELECT m.id,m.user_id AS userId,m.role,m.status,m.joined_at AS joinedAt,
        u.full_name AS fullName,${userIdentitySelect("u")}
       FROM workspace_members m JOIN user_profiles u ON u.id=m.user_id
       WHERE m.workspace_id=? AND m.status='active'
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
        u.full_name,m.joined_at`,
    ).bind(workspace.id),
  ]);
  const invitations = canManageTeam(workspace.role)
    ? await db.prepare(
      `SELECT id,workspace_id AS workspaceId,email,
        email_ciphertext AS emailCiphertext,email_iv AS emailIv,
        email_key_version AS emailKeyVersion,
        email_lookup_hash AS emailLookupHash,
        email_lookup_key_version AS emailLookupKeyVersion,
        role,expires_at AS expiresAt,created_at AS createdAt
       FROM workspace_invitations
       WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL
        AND expires_at>?
       ORDER BY created_at DESC`,
    ).bind(workspace.id, isoNow()).all<WorkspaceInvitationRow>()
    : null;
  const identityContext = runtimeIdentityProtection();
  const resolvedMembers = await Promise.all(
    (members.results as Array<UserIdentityRow & {
      userId: string;
      role: string;
      status: string;
      joinedAt: string;
      fullName: string | null;
    }>).map(async member => {
      const identity = await resolveUserIdentity(
        identityContext,
        { ...member, id: member.userId },
      );
      return {
        id: member.id,
        userId: member.userId,
        role: member.role,
        status: member.status,
        joinedAt: member.joinedAt,
        fullName: member.fullName,
        email: identity.email,
      };
    }),
  );
  const resolvedInvitations = await Promise.all(
    (invitations?.results ?? []).map(
      async invitation => {
        const identity = await resolveEncryptedIdentityEvidence(
          identityContext,
          {
            rawValue: invitation.email,
            ciphertext: invitation.emailCiphertext,
            iv: invitation.emailIv,
            keyVersion: invitation.emailKeyVersion,
            lookupHash: invitation.emailLookupHash,
            lookupKeyVersion: invitation.emailLookupKeyVersion,
            purpose: "workspace-invitation-email",
            subjectId: invitation.workspaceId,
            recordId: invitation.id,
            normalize: normalizeEmail,
          },
        );
        return {
          id: invitation.id,
          email: identity.value,
          role: invitation.role,
          expiresAt: invitation.expiresAt,
          createdAt: invitation.createdAt,
        };
      },
    ),
  );
  return response({
    workspace: workspaceRow.results[0] ?? null,
    currentRole: workspace.role,
    members: resolvedMembers,
    invitations: resolvedInvitations,
  });
});

export const POST = withApiErrors(async function POST(request: Request) {
  assertSafeWrite(request);
  const user = await requireApiUser();
  const workspace = await workspaceForUser(user);
  requireTeamManager(workspace.role);
  const env = runtimeEnv();

  const body = await request.json().catch(() => null) as { email?: string; role?: string; locale?: string } | null;
  const email = normalizeEmail(body?.email ?? "");
  const role = body?.role;
  const locale: PlatformLocale = isLocale(body?.locale ?? "") ? body!.locale as PlatformLocale : "ru";
  const copy = invitationCopy[locale];
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    return response({ code: "EMAIL_PROVIDER_UNAVAILABLE", error: copy.providerUnavailable }, 503);
  }
  if (!EMAIL_RE.test(email) || email.length > 254) {
    return response({ error: copy.invalidEmail }, 400);
  }
  if (!isWorkspaceRole(role) || !INVITABLE_ROLES.has(role)) {
    return response({ error: copy.invalidRole }, 400);
  }

  const db = requireD1();
  const identityContext = runtimeIdentityProtection();
  const emailHash = await sha256(email);
  const existingUserId = await userIdByEmail(db, identityContext, email);
  const existingMember = existingUserId
    ? await db.prepare(
      `SELECT id FROM workspace_members
       WHERE workspace_id=? AND user_id=? AND status='active' LIMIT 1`,
    ).bind(workspace.id, existingUserId).first()
    : null;
  if (existingMember) return response({ error: copy.alreadyMember }, 409);

  const now = isoNow();
  const invitationId = crypto.randomUUID();
  const emailEvidence = await prepareEncryptedIdentityEvidence(
    identityContext,
    {
      plaintext: email,
      normalizedValue: email,
      purpose: "workspace-invitation-email",
      subjectId: workspace.id,
      recordId: invitationId,
    },
  );
  const rawToken = randomToken(32);
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare(
      "UPDATE workspace_invitations SET revoked_at=?,updated_at=? WHERE workspace_id=? AND email_hash=? AND accepted_at IS NULL AND revoked_at IS NULL",
    ).bind(now, now, workspace.id, emailHash),
    db.prepare(
      `INSERT INTO workspace_invitations
       (id,workspace_id,invited_by_user_id,email,email_hash,
        email_ciphertext,email_iv,email_key_version,
        email_lookup_hash,email_lookup_key_version,
        token_hash,role,expires_at,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      invitationId,
      workspace.id,
      user.id,
      email,
      emailHash,
      emailEvidence.ciphertext,
      emailEvidence.iv,
      emailEvidence.keyVersion,
      emailEvidence.lookupHash,
      emailEvidence.lookupKeyVersion,
      tokenHash,
      role,
      expiresAt,
      now,
      now,
    ),
  ]);

  const requestOrigin = new URL(request.url).origin;
  const configuredOrigin = env.APP_URL && /^https:\/\/[^/]+$/i.test(env.APP_URL) ? env.APP_URL : requestOrigin;
  const inviteUrl = new URL(`/invite/${encodeURIComponent(rawToken)}?lang=${locale}`, configuredOrigin).toString();
  const invitation = renderInvitationEmail(locale, email, inviteUrl);

  let sent: Response | null = null;
  try {
    sent = await sendEmailRequest({
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], ...invitation }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    sent = null;
  }
  if (!sent?.ok) {
    await db.prepare("UPDATE workspace_invitations SET revoked_at=?,updated_at=? WHERE id=?").bind(isoNow(), isoNow(), invitationId).run();
    return response({ code: "EMAIL_PROVIDER_ERROR", error: copy.sendFailed }, 502);
  }
  await db.prepare(
    "INSERT INTO workspace_audit_events (id,workspace_id,actor_user_id,entity_type,entity_id,action,metadata_json,created_at) VALUES (?,?,?,'invitation',?,'invitation_sent',?,?)",
  ).bind(crypto.randomUUID(), workspace.id, user.id, invitationId, JSON.stringify({ role }), now).run();
  return response({ ok: true, invitationId, expiresAt }, 201);
});
